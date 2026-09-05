// packages/connectors/src/email/ses/aws-sdk-api.test.ts
// 🔴 **実 SES に接続しない。** `SESv2Client` の代わりにスタブを注入し、
//    「どんなコマンドが組み立てられるか」と「応答をどう内部型に写すか」だけを固定する。
//
// ここで固定するのは 4 点である:
//   ① ポートの綴りが SDK の `SendEmailCommandInput` にそのまま乗る（詰め替えの取り違えが無い）
//   ② 🔴 `TenantName` が渡る / 未指定なら**プロパティごと落ちる**（SES Tenants。docs/05 §8.3）
//   ③ 🔴 SDK の optional な応答を既定値で埋めない（`MessageId` 欠落は「応答不明」）
//   ④ SDK の例外をここで握り潰さない（分類は `normalizeSesError` に一本化する）
//
// 🔴 「SDK を import してよいのはこのファイルだけ」「SDK 内部のリトライを止めている」は
//    リポジトリ全体を走査する `tests/static/aws-sdk-single-path.test.ts` が固定する
//    （`@anthropic-ai/sdk` に対する `tests/static/ai-single-path.test.ts` と同じ扱い）。
import { GetAccountCommand, SendEmailCommand } from '@aws-sdk/client-sesv2';
import { describe, expect, it, vi } from 'vitest';
import { createConnectors } from '../../index.js';
import { dispatchTokenFor } from '../../types.js';
import type { SesSendEmailRequest } from './api.js';
import { ExternalSendError } from './errors.js';
import { createSesApi, toSendEmailCommand, type SesCommandSender } from './aws-sdk-api.js';

const REQUEST: SesSendEmailRequest = {
  FromEmailAddress: 'no-reply@example.co.jp',
  Destination: { ToAddresses: ['owner@example.co.jp'] },
  ConfigurationSetName: 'ses-platform-test',
  TenantName: 't-01930000-0000-7000-8000-0000000000a1',
  Content: {
    Template: {
      TemplateName: 'ACCOUNT_INVITATION',
      TemplateData: '{"link":"https://app.example/invitations/tok"}',
    },
  },
};

/** 送ったコマンドを記録するだけのスタブ（ネットワークに出ない）。 */
function stub(response: unknown = { MessageId: 'ses-msg-1' }) {
  const send = vi.fn(async (command: unknown) => {
    void command;
    return response;
  });
  return { client: { send } as unknown as SesCommandSender, send };
}

describe('🔴 ① ② コマンドの組み立て（docs/05 §8.3）', () => {
  it('ポートのフィールドがそのまま SendEmailCommand の入力になる', () => {
    const command = toSendEmailCommand(REQUEST);
    expect(command).toBeInstanceOf(SendEmailCommand);
    expect(command.input).toEqual({
      FromEmailAddress: 'no-reply@example.co.jp',
      Destination: { ToAddresses: ['owner@example.co.jp'] },
      ConfigurationSetName: 'ses-platform-test',
      TenantName: 't-01930000-0000-7000-8000-0000000000a1',
      Content: {
        Template: {
          TemplateName: 'ACCOUNT_INVITATION',
          TemplateData: '{"link":"https://app.example/invitations/tok"}',
        },
      },
    });
  });

  it('🔴 TenantName が未指定ならプロパティごと落ちる（空文字を渡さない）', () => {
    const { TenantName: _omitted, ...withoutTenant } = REQUEST;
    void _omitted;
    expect(toSendEmailCommand(withoutTenant).input).not.toHaveProperty('TenantName');
  });

  it('ToAddresses は SDK 側の可変配列として複製される（readonly をそのまま渡さない）', () => {
    const command = toSendEmailCommand(REQUEST);
    expect(command.input.Destination?.ToAddresses).not.toBe(REQUEST.Destination.ToAddresses);
    expect(command.input.Destination?.ToAddresses).toEqual(['owner@example.co.jp']);
  });
});

describe('createSesApi（スタブ注入。実 SES に接続しない）', () => {
  it('sendEmail は SendEmailCommand を 1 回だけ送り、MessageId を返す', async () => {
    const { client, send } = stub();
    expect(await createSesApi({ region: 'ap-northeast-1', client }).sendEmail(REQUEST)).toEqual({
      MessageId: 'ses-msg-1',
    });
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0]?.[0]).toBeInstanceOf(SendEmailCommand);
  });

  it('🔴 ③ MessageId が欠けていたら「応答不明」にする（既定値で埋めない）', async () => {
    const { client } = stub({});
    const api = createSesApi({ region: 'ap-northeast-1', client });
    await expect(api.sendEmail(REQUEST)).rejects.toBeInstanceOf(ExternalSendError);
    await expect(api.sendEmail(REQUEST)).rejects.toMatchObject({ kind: 'UNKNOWN' });
  });

  it('getAccount は SendQuota を内部型へ写す', async () => {
    const { client, send } = stub({
      SendQuota: { Max24HourSend: 200, SentLast24Hours: 12, MaxSendRate: 1 },
    });
    expect(await createSesApi({ region: 'ap-northeast-1', client }).getAccount()).toEqual({
      SendQuota: { Max24HourSend: 200, SentLast24Hours: 12 },
    });
    expect(send.mock.calls[0]?.[0]).toBeInstanceOf(GetAccountCommand);
  });

  it.each([{}, { SendQuota: {} }, { SendQuota: { Max24HourSend: 200 } }])(
    '🔴 ③ SendQuota が欠けていたら 0 を返さず throw する（枠が無限に見えない）',
    async (response) => {
      const { client } = stub(response);
      await expect(createSesApi({ region: 'ap-northeast-1', client }).getAccount()).rejects.toBeInstanceOf(
        ExternalSendError,
      );
    },
  );

  it('🔴 ④ SDK の例外をここで握り潰さない（分類は ses.ts の normalizeSesError に一本化する）', async () => {
    const send = vi.fn(async () => {
      throw { name: 'MessageRejected', message: 'rejected' };
    });
    const api = createSesApi({ region: 'ap-northeast-1', client: { send } as unknown as SesCommandSender });
    await expect(api.sendEmail(REQUEST)).rejects.toMatchObject({ name: 'MessageRejected' });
  });
});

describe('🔴 起動時 DI に噛み合うこと（docs/05 §13.1 / §8.2 の表）', () => {
  const selection = {
    email: 'real',
    objectStore: 'mock',
    malwareScanner: 'mock',
    esign: 'mock',
    billing: 'mock',
  } as const;

  const sesRuntime = (client: SesCommandSender) => ({
    api: createSesApi({ region: 'ap-northeast-1', client }),
    defaultFromAddress: 'no-reply@example.co.jp',
    configurationSet: 'ses-platform-test',
  });

  it('createSesApi の戻り値をそのまま createConnectors に渡して email: real が解決できる', async () => {
    const { client, send } = stub();
    const connectors = createConnectors(selection, { ses: sesRuntime(client) });

    await connectors.email.send({
      recipientClass: 'HOST_MEMBER',
      to: 'owner@example.co.jp',
      templateKey: 'ACCOUNT_INVITATION',
      params: { link: 'https://app.example/invitations/tok' },
      tenantId: '01930000-0000-7000-8000-0000000000a1',
      fromDomain: null,
      token: dispatchTokenFor({ dispatchId: 'd-1', dedupeKey: 'k-1' }),
    });

    expect(connectors.email.callCount()).toBe(1);
    const command = send.mock.calls[0]?.[0] as SendEmailCommand;
    expect(command).toBeInstanceOf(SendEmailCommand);
    // 🔴 起動時に渡した共通ドメインと `TenantName` が、コマンドまで通っていること。
    expect(command.input.FromEmailAddress).toBe('no-reply@example.co.jp');
    expect(command.input.TenantName).toBe('t-01930000-0000-7000-8000-0000000000a1');
  });

  it('🔴 sandbox（sandboxRecipientScoped）でも同じアダプタで解決でき、分類 2 は SES を呼ばない', async () => {
    const { client, send } = stub();
    const connectors = createConnectors(
      { ...selection, email: 'sandboxRecipientScoped' },
      { ses: sesRuntime(client) },
    );

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
      token: dispatchTokenFor({ dispatchId: 'd-1', dedupeKey: 'k-1' }),
    });

    expect(send).not.toHaveBeenCalled();
    expect(connectors.email.callCount()).toBe(1);
  });
});
