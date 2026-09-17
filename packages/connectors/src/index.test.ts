// packages/connectors/src/index.test.ts
// createConnectors（docs/05 §8.1 / §13.1）: 選択結果を instantiate するだけであること、
// 🔴 未登録の実装をモックで代替しないこと（CLAUDE.md §11.1）。
import { describe, expect, it, vi } from 'vitest';

import { createConnectors, createEmailSender } from './index.js';
import { ConnectorImplementationNotAvailableError, MockEmailScriptNotApplicableError } from './errors.js';
import { SandboxRecipientScopedEmailSender } from './email/sandbox-recipient-scoped.js';
import { SesEmailSender } from './email/ses/index.js';
import { MockEmailSender } from './mock/index.js';
import { S3ObjectStore } from './storage/index.js';
import {
  CONNECTOR_CATEGORIES,
  dispatchTokenFor,
  type ConnectorCategory,
  type ConnectorImplementationKind,
  type ConnectorSelectionInput,
} from './types.js';

const allMock: ConnectorSelectionInput = {
  email: 'mock',
  objectStore: 'mock',
  malwareScanner: 'mock',
  esign: 'mock',
  billing: 'mock',
};

function selectionWith(category: ConnectorCategory, kind: ConnectorImplementationKind): ConnectorSelectionInput {
  const next: Record<ConnectorCategory, ConnectorImplementationKind> = { ...allMock };
  next[category] = kind;
  return next;
}

describe('createConnectors', () => {
  it('全区分 mock の選択（demo 相当）で 5 区分すべてが組み立てられる', () => {
    const connectors = createConnectors(allMock);
    expect(connectors.email).toBeInstanceOf(MockEmailSender);
    expect(connectors.email.callCount()).toBe(0);
    expect(connectors.objectStore.callCount()).toBe(0);
    expect(connectors.malwareScanner.callCount()).toBe(0);
    expect(connectors.billing.callCount()).toBe(0);
  });

  it('🔴 esign は「1 実装」ではなく全プロバイダのマップを返す（docs/05 §8.1 / §8.4）', () => {
    const { esign } = createConnectors(allMock);
    expect(esign.mock?.key).toBe('mock');
    // 🔴 未登録のプロバイダは undefined。フォールバックで別プロバイダを選ばない。
    expect(esign.docusign).toBeUndefined();
    expect(esign.cloudsign).toBeUndefined();
  });

  it.each([...CONNECTOR_CATEGORIES])(
    '🔴 %s の実装が未登録（real）なら起動時に throw する（モックに倒さない）',
    (category) => {
      expect(() => createConnectors(selectionWith(category, 'real'))).toThrow(
        ConnectorImplementationNotAvailableError,
      );
    },
  );

  it('🔴 SES の設定を渡さずに email: real を選ぶと throw する（モックに倒さない）', () => {
    expect(() => createConnectors(selectionWith('email', 'real'), {})).toThrow(
      ConnectorImplementationNotAvailableError,
    );
  });

  it('🔴 sandboxRecipientScoped も SES の設定が無ければモックに倒さず throw する', () => {
    expect(() => createConnectors(selectionWith('email', 'sandboxRecipientScoped'))).toThrow(
      ConnectorImplementationNotAvailableError,
    );
  });

  it('例外は「どの区分のどの実装種別か」を持つ（起動ログから原因が分かる）', () => {
    let captured: unknown = null;
    try {
      createConnectors(selectionWith('email', 'real'));
    } catch (error) {
      captured = error;
    }
    expect(captured).toBeInstanceOf(ConnectorImplementationNotAvailableError);
    const typed = captured as ConnectorImplementationNotAvailableError;
    expect(typed.category).toBe('email');
    expect(typed.kind).toBe('real');
    // 🔴 例外メッセージにシークレットを含めない（変数名と理由だけ。docs/05 §13.4 規則 6）。
    expect(typed.message).toContain('email');
  });

  it('呼び出しごとに独立したインスタンスを返す（起動時 1 回の DI を前提にした状態を共有しない）', () => {
    const a = createConnectors(allMock);
    const b = createConnectors(allMock);
    expect(a.email).not.toBe(b.email);
  });
});

describe('🔴 email の 3 種別すべてが解決できる（T-04-03。docs/05 §8.2 の表）', () => {
  const ses = {
    api: {
      sendEmail: async () => ({ MessageId: 'ses-1' }),
      getAccount: async () => ({ SendQuota: { Max24HourSend: 200, SentLast24Hours: 0 } }),
    },
    defaultFromAddress: 'no-reply@ses-platform.example',
    configurationSet: 'ses-platform-test',
  };

  it('real（staging / production）は SES 実装になる', () => {
    const connectors = createConnectors(selectionWith('email', 'real'), { ses });
    expect(connectors.email).toBeInstanceOf(SesEmailSender);
  });

  it('🔴 sandboxRecipientScoped は宛先分類で振り分ける実装になる（sandbox の起動が通る）', () => {
    const connectors = createConnectors(selectionWith('email', 'sandboxRecipientScoped'), { ses });
    expect(connectors.email).toBeInstanceOf(SandboxRecipientScopedEmailSender);
  });

  it('🔴 sandbox の分類 2 はモック側へ流れ、SES を 1 回も呼ばない（Issue #10）', async () => {
    const sendEmail = vi.fn(async () => ({ MessageId: 'ses-1' }));
    const connectors = createConnectors(selectionWith('email', 'sandboxRecipientScoped'), {
      ses: { ...ses, api: { ...ses.api, sendEmail } },
    });
    await connectors.email.send({
      recipientClass: 'PARTNER_MEMBER',
      to: 'partner@example.co.jp',
      templateKey: 'ACCOUNT_INVITATION',
      params: {},
      tenantId: '01930000-0000-7000-8000-0000000000a1',
      fromDomain: {
        domain: 'example.co.jp',
        mailFromDomain: 'mail.example.co.jp',
        verifiedAt: new Date('2026-09-01T00:00:00.000Z'),
      },
      token: dispatchTokenFor({ dispatchId: 'd1', dedupeKey: 'k1' }),
    });
    expect(sendEmail).not.toHaveBeenCalled();
    expect(connectors.email.callCount()).toBe(1);
  });

  // ✅ T-10-07: `F-053 AC-5` / `BR-45`。`demo`（全区分 `mock`）では、`sandbox` なら SES へ出る分類 1（`HOST_MEMBER`）であっても
  //    モックが受け、SES の設定（`ses`）を渡していても 1 回も呼ばれない。「宛先による区別を適用せず全送信系がモック」を、
  //    分類の値に**関係なく**モックになる形で固定する（分類関数の結果が何であってもモックに落ちる）。
  it('🔴 F-053 AC-5: demo（email: mock）では sandbox なら SES へ出る分類 1 でも SES を 1 回も呼ばず、モック実装が受ける', async () => {
    const sendEmail = vi.fn(async () => ({ MessageId: 'ses-1' }));
    const connectors = createConnectors(allMock, { ses: { ...ses, api: { ...ses.api, sendEmail } } });
    expect(connectors.email).toBeInstanceOf(MockEmailSender);
    expect(connectors.email).not.toBeInstanceOf(SandboxRecipientScopedEmailSender);
    for (const recipientClass of ['HOST_MEMBER', 'PARTNER_MEMBER', 'CLIENT', 'ENGINEER'] as const) {
      await connectors.email.send({
        recipientClass,
        to: `${recipientClass.toLowerCase()}@example.co.jp`,
        templateKey: 'ACCOUNT_INVITATION',
        params: {},
        tenantId: '01930000-0000-7000-8000-0000000000a1',
        // 分類 2 / 3 / 4 は検証済みドメインが必須（`BR-51`。モックでも同じ判定）。分類 1 も同じ値で通る。
        fromDomain: {
          domain: 'example.co.jp',
          mailFromDomain: 'mail.example.co.jp',
          verifiedAt: new Date('2026-09-01T00:00:00.000Z'),
        },
        token: dispatchTokenFor({ dispatchId: `d-${recipientClass}`, dedupeKey: `k-${recipientClass}` }),
      });
    }
    expect(sendEmail).not.toHaveBeenCalled();
    expect(connectors.email.callCount()).toBe(4);
  });

  it('🔴 sandbox の分類 1 は SES を呼ぶ（本人に届かないと sandbox に入れない）', async () => {
    const sendEmail = vi.fn(async () => ({ MessageId: 'ses-1' }));
    const connectors = createConnectors(selectionWith('email', 'sandboxRecipientScoped'), {
      ses: { ...ses, api: { ...ses.api, sendEmail } },
    });
    await connectors.email.send({
      recipientClass: 'HOST_MEMBER',
      to: 'owner@example.co.jp',
      templateKey: 'ACCOUNT_INVITATION',
      params: {},
      tenantId: '01930000-0000-7000-8000-0000000000a1',
      fromDomain: null,
      token: dispatchTokenFor({ dispatchId: 'd1', dedupeKey: 'k1' }),
    });
    expect(sendEmail).toHaveBeenCalledTimes(1);
  });
});

describe('🔴 objectStore の real（T-05-04。docs/05 §13.1 の表）', () => {
  const s3 = {
    api: {
      presignPut: async () => 'https://s3.test/put',
      presignGet: async () => 'https://s3.test/get',
      putObject: async () => undefined,
      deleteObject: async () => undefined,
      headObject: async () => null,
      listObjects: async () => ({ Contents: [] }),
    },
    bucket: 'ses-platform-test',
    presignedUrlTtlSeconds: 300,
  };

  it('S3 の設定（AWS SDK のアダプタ）を渡せば real が解決できる', () => {
    const connectors = createConnectors(selectionWith('objectStore', 'real'), { s3 });
    expect(connectors.objectStore).toBeInstanceOf(S3ObjectStore);
    expect(connectors.objectStore.callCount()).toBe(0);
  });

  it('🔴 S3 の設定が無ければモックに倒さず throw する（CLAUDE.md §11.1）', () => {
    let captured: unknown = null;
    try {
      createConnectors(selectionWith('objectStore', 'real'), {});
    } catch (error) {
      captured = error;
    }
    expect(captured).toBeInstanceOf(ConnectorImplementationNotAvailableError);
    expect((captured as ConnectorImplementationNotAvailableError).category).toBe('objectStore');
  });
});

// ✅ T-09-07: モックの台本（`ConnectorRuntimeOptions.mockEmail`）は起動時 DI の 1 箇所から渡し、`real` には渡せない。
describe('🔴 mockEmail（T-09-07。docs/05 §13.2 / §10.6）: 台本はモック実装にだけ届き、real では起動が止まる', () => {
  const ses = {
    api: {
      sendEmail: async () => ({ MessageId: 'ses-1' }),
      getAccount: async () => ({ SendQuota: { Max24HourSend: 200, SentLast24Hours: 0 } }),
    },
    defaultFromAddress: 'no-reply@ses-platform.example',
    configurationSet: 'ses-platform-test',
  };
  const clientInput = {
    recipientClass: 'CLIENT' as const,
    to: 't0907-recipient@example.test',
    templateKey: 'PROPOSAL_SUBMISSION',
    params: {},
    tenantId: '01930000-0000-7000-8000-0000000000a1',
    fromDomain: {
      domain: 'example.co.jp',
      mailFromDomain: 'mail.example.co.jp',
      verifiedAt: new Date('2026-09-01T00:00:00.000Z'),
    },
    token: dispatchTokenFor({ dispatchId: 'd1', dedupeKey: 'k1' }),
  };

  it('mock（development / demo / E2E）: 台本どおり応答不明を再現し、callCount は 1（届いた可能性）', async () => {
    const email = createEmailSender('mock', { mockEmail: { script: [{ kind: 'unknown' }] } });
    await expect(email.send(clientInput)).rejects.toMatchObject({ name: 'ExternalSendError', kind: 'UNKNOWN' });
    expect(email.callCount()).toBe(1);
  });

  it('sandboxRecipientScoped: 分類 3 はモック側なので台本が効き、SES は 1 回も呼ばれない', async () => {
    const sendEmail = vi.fn(async () => ({ MessageId: 'ses-1' }));
    const email = createEmailSender('sandboxRecipientScoped', {
      ses: { ...ses, api: { ...ses.api, sendEmail } },
      mockEmail: { script: [{ kind: 'unreachable' }] },
    });
    await expect(email.send(clientInput)).rejects.toMatchObject({ name: 'ExternalSendError', kind: 'TRANSIENT' });
    expect(sendEmail).not.toHaveBeenCalled();
    expect(email.callCount()).toBe(0);
  });

  it('🔴 real（staging / production）に台本を渡すと起動時に throw する（黙って無視しない = 「再現のつもりで実送信」を作らない）', () => {
    expect(() => createEmailSender('real', { ses, mockEmail: { script: [{ kind: 'unknown' }] } })).toThrow(
      MockEmailScriptNotApplicableError,
    );
    // 台本が無ければ従来どおり real が組み立てられる（台本の有無で実装種別は変わらない）。
    expect(createEmailSender('real', { ses })).toBeInstanceOf(SesEmailSender);
  });

  it('createConnectors 経由でも同じ 1 実装を通る（台本は email 区分にだけ届く）', async () => {
    const connectors = createConnectors(allMock, { mockEmail: { script: [{ kind: 'reject' }] } });
    await expect(connectors.email.send(clientInput)).rejects.toMatchObject({ name: 'ExternalSendError', kind: 'PERMANENT' });
    expect(connectors.objectStore.callCount()).toBe(0);
  });

  // ✅ T-09-11: 宛先ドメイン別の台本も同じ口から届く（E2E ハーネスの注入口）。`real` に渡せば同じく起動が止まる。
  it('T-09-11: scriptByRecipientDomain はモック実装に届き、宛先ドメインが一致した送信だけに効く', async () => {
    const email = createEmailSender('mock', {
      mockEmail: { script: [], scriptByRecipientDomain: { 'unknown-once.example.test': [{ kind: 'unknown' }, { kind: 'deliver' }] } },
    });
    await expect(email.send({ ...clientInput, to: 'someone@unknown-once.example.test' })).rejects.toMatchObject({ kind: 'UNKNOWN' });
    await expect(email.send(clientInput)).resolves.toMatchObject({ externalId: expect.stringMatching(/^mock-/) as string });
    expect(() =>
      createEmailSender('real', { ses, mockEmail: { script: [], scriptByRecipientDomain: { 'unknown-once.example.test': [{ kind: 'unknown' }] } } }),
    ).toThrow(MockEmailScriptNotApplicableError);
  });
});
