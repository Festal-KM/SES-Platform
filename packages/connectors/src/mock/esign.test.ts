// packages/connectors/src/mock/esign.test.ts
import { describe, expect, it } from 'vitest';

import type { EsignConnectionSecret, SendAttemptToken } from '../types.js';
import { MOCK_WEBHOOK_SIGNATURE_HEADER_PREFIX, MockEsignProvider, mockWebhookSignature } from './esign.js';

const connection: EsignConnectionSecret = {
  refreshToken: 'mock-refresh',
  externalAccountId: 'mock-account',
  baseUri: 'https://esign.mock.invalid',
};

function sendToken(attemptSeq: number): SendAttemptToken {
  return {
    idempotencyKey: `contract:c1:${attemptSeq}`,
    attemptSeq,
    entityType: 'CONTRACT',
    entityId: 'c1',
  } as unknown as SendAttemptToken;
}

async function send(provider: MockEsignProvider, attemptSeq = 1): Promise<string> {
  const { externalDocumentId } = await provider.createAndSend(
    {
      connection,
      subject: '個別契約書',
      documentName: 'contract.pdf',
      documentBytes: new Uint8Array([1, 2, 3]),
      signers: [
        { role: 'HOST', name: '自社 太郎', email: 'host@example.co.jp', routingOrder: 1 },
        { role: 'COUNTERPARTY', name: '相手 花子', email: 'cp@partner.example', routingOrder: 2 },
      ],
    },
    sendToken(attemptSeq),
  );
  return externalDocumentId;
}

describe('MockEsignProvider の認可フロー', () => {
  it('🔴 buildAuthorizeUrl は extended スコープを必ず含む（忘れると 30 日で接続が切れる）', () => {
    const provider = new MockEsignProvider();
    if (provider.connect.kind !== 'OAUTH_AUTH_CODE') throw new Error('OAUTH_AUTH_CODE のはず');
    const url = provider.connect.buildAuthorizeUrl('state-1');
    expect(url).toContain('scope=signature+extended');
    expect(new URL(url).searchParams.get('scope')).toBe('signature extended');
    expect(new URL(url).searchParams.get('state')).toBe('state-1');
  });

  it('refresh は新しいリフレッシュトークンを返す（再暗号化して保存する前提）', async () => {
    const provider = new MockEsignProvider();
    if (provider.connect.kind !== 'OAUTH_AUTH_CODE') throw new Error('OAUTH_AUTH_CODE のはず');
    const refreshed = await provider.connect.refresh(connection);
    expect(refreshed.refreshToken).not.toBe(connection.refreshToken);
    expect(refreshed.externalAccountId).toBe(connection.externalAccountId);
  });
});

describe('MockEsignProvider の Webhook 検証', () => {
  const body = new TextEncoder().encode('{"event":"envelope-completed"}');

  it('正しい HMAC を持つ要求だけを受理する', () => {
    const provider = new MockEsignProvider();
    const headers = new Headers({
      [`${MOCK_WEBHOOK_SIGNATURE_HEADER_PREFIX}1`]: mockWebhookSignature('key-a', body),
    });
    expect(provider.verifyWebhook(body, headers, ['key-a'])).toBe(true);
    expect(provider.verifyWebhook(body, headers, ['key-b'])).toBe(false);
  });

  it('ローテーション中は複数キーのいずれか 1 つが一致すればよい', () => {
    const provider = new MockEsignProvider();
    const headers = new Headers({
      [`${MOCK_WEBHOOK_SIGNATURE_HEADER_PREFIX}1`]: mockWebhookSignature('old-key', body),
    });
    expect(provider.verifyWebhook(body, headers, ['new-key', 'old-key'])).toBe(true);
  });

  it('署名ヘッダが無い / キーが無い場合は false（fail-closed）', () => {
    const provider = new MockEsignProvider();
    expect(provider.verifyWebhook(body, new Headers(), ['key-a'])).toBe(false);
    const headers = new Headers({ [`${MOCK_WEBHOOK_SIGNATURE_HEADER_PREFIX}1`]: 'x' });
    expect(provider.verifyWebhook(body, headers, [])).toBe(false);
  });

  it('ボディが 1 バイトでも違えば false', () => {
    const provider = new MockEsignProvider();
    const headers = new Headers({
      [`${MOCK_WEBHOOK_SIGNATURE_HEADER_PREFIX}1`]: mockWebhookSignature('key-a', body),
    });
    expect(provider.verifyWebhook(new TextEncoder().encode('{}'), headers, ['key-a'])).toBe(false);
  });
});

describe('MockEsignProvider の署名状態（docs/05 §8.4 / §17.3 #22）', () => {
  it('🔴 一部未署名は PENDING のまま（Contract の状態を増やさない）', async () => {
    const provider = new MockEsignProvider({ now: () => new Date('2026-09-05T00:00:00.000Z') });
    const id = await send(provider);

    expect(await provider.fetchStatus(connection, id)).toMatchObject({ kind: 'PENDING' });

    provider.completeSigning(id, 'HOST');
    const afterHost = await provider.fetchStatus(connection, id);
    expect(afterHost.kind).toBe('PENDING');
    if (afterHost.kind !== 'PENDING') throw new Error('PENDING のはず');
    expect(afterHost.signers.find((s) => s.role === 'HOST')?.status).toBe('SIGNED');
    expect(afterHost.signers.find((s) => s.role === 'COUNTERPARTY')?.status).toBe('PENDING');
  });

  it('全署名者が完了すると SIGNED になる', async () => {
    const provider = new MockEsignProvider({ now: () => new Date('2026-09-05T00:00:00.000Z') });
    const id = await send(provider);
    provider.completeSigning(id, 'HOST');
    provider.completeSigning(id, 'COUNTERPARTY');

    const status = await provider.fetchStatus(connection, id);
    expect(status.kind).toBe('SIGNED');
  });

  it('🔴 正規化した署名者は氏名・メールを持たない（docs/05 §8.1）', async () => {
    const provider = new MockEsignProvider();
    const id = await send(provider);
    const status = await provider.fetchStatus(connection, id);
    expect(JSON.stringify(status)).not.toContain('host@example.co.jp');
    expect(JSON.stringify(status)).not.toContain('自社 太郎');
  });

  it('未知の書類 ID は UNKNOWN（推測で状態を進めない）', async () => {
    const provider = new MockEsignProvider();
    expect(await provider.fetchStatus(connection, 'unknown')).toEqual({ kind: 'UNKNOWN' });
  });

  it('withdraw / decline を状態として区別する', async () => {
    const provider = new MockEsignProvider({ now: () => new Date('2026-09-05T00:00:00.000Z') });
    const withdrawn = await send(provider);
    await provider.withdraw(connection, withdrawn);
    expect((await provider.fetchStatus(connection, withdrawn)).kind).toBe('WITHDRAWN');

    const declined = await send(provider, 2);
    provider.declineSigning(declined);
    expect((await provider.fetchStatus(connection, declined)).kind).toBe('DECLINED');
  });

  it('🔴 同じトークンで 2 回呼ばれたら 2 回として記録する（モックが二重送信を隠さない）', async () => {
    const provider = new MockEsignProvider();
    const before = provider.callCount();
    const first = await send(provider, 1);
    const second = await send(provider, 1);
    expect(first).not.toBe(second);
    expect(provider.callCount()).toBe(before + 2);
  });
});
