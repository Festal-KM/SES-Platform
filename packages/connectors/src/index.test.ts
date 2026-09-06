// packages/connectors/src/index.test.ts
// createConnectors（docs/05 §8.1 / §13.1）: 選択結果を instantiate するだけであること、
// 🔴 未登録の実装をモックで代替しないこと（CLAUDE.md §11.1）。
import { describe, expect, it, vi } from 'vitest';

import { createConnectors } from './index.js';
import { ConnectorImplementationNotAvailableError } from './errors.js';
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
      deleteObject: async () => undefined,
      headObject: async () => null,
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
