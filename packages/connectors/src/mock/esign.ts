// packages/connectors/src/mock/esign.ts
// docs/05 §13.2 / §8.4。非本番（`development` / `demo` / `sandbox` / E2E）で使う電子署名の実装。
// 🔴 `production` では `assertNoMockInProduction`（`packages/config`）が起動を止めるため選ばれない。

import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';

import type { EsignConnectFlow, EsignProvider } from '../interfaces.js';
import type {
  EsignConnectionSecret,
  EsignSendInput,
  EsignSigner,
  NormalizedEsignStatus,
  NormalizedSigner,
  SendAttemptToken,
} from '../types.js';

/**
 * Webhook 署名ヘッダの接頭辞。
 * 🔴 実装（DocuSign の `X-Docusign-Signature-{n}`）と**同じ形**（複数キーのローテーション対応）に揃える。
 *    サービス固有のヘッダ名はコネクタ実装の内側に閉じ、外へは出さない（docs/05 §8.1）。
 */
export const MOCK_WEBHOOK_SIGNATURE_HEADER_PREFIX = 'x-mock-signature-';

export const MOCK_AUTHORIZE_BASE_URL = 'https://esign.mock.invalid/oauth/auth';

type MockEnvelope = {
  readonly externalDocumentId: string;
  readonly signers: NormalizedSigner[];
  withdrawnAt: Date | null;
  declinedAt: Date | null;
};

export type MockEsignProviderOptions = {
  readonly now?: () => Date;
};

/** 🔴 生ボディに対する HMAC-SHA256（base64）。実装と同じ計算をする。 */
export function mockWebhookSignature(key: string, rawBody: Uint8Array): string {
  return createHmac('sha256', key).update(rawBody).digest('base64');
}

function safeEquals(a: string, b: string): boolean {
  const left = Buffer.from(a, 'utf8');
  const right = Buffer.from(b, 'utf8');
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

export class MockEsignProvider implements EsignProvider {
  readonly key = 'mock' as const;

  private readonly envelopes = new Map<string, MockEnvelope>();
  private calls = 0;

  constructor(private readonly options: MockEsignProviderOptions = {}) {}

  readonly connect: EsignConnectFlow = {
    kind: 'OAUTH_AUTH_CODE',
    // 🔴 `extended` を必ず要求する（忘れると 30 日で接続が黙って切れる。`docs/03` §3.1.2a-3）。
    //    実装（DocuSign）と同じ形にしておかないと、モックで通って本番で切れる差が生まれる。
    buildAuthorizeUrl: (state: string): string => {
      const url = new URL(MOCK_AUTHORIZE_BASE_URL);
      url.searchParams.set('response_type', 'code');
      url.searchParams.set('scope', 'signature extended');
      url.searchParams.set('state', state);
      return url.toString();
    },
    exchangeCode: async (code: string) => ({
      refreshToken: `mock-refresh-${code}`,
      externalAccountId: 'mock-account',
      baseUri: 'https://esign.mock.invalid',
      accountName: 'モック署名アカウント',
    }),
    refresh: async (conn: EsignConnectionSecret) => ({
      // 実装（DocuSign）と同じく、リフレッシュのたびに**新しい**リフレッシュトークンを返す。
      ...conn,
      refreshToken: `mock-refresh-${randomUUID()}`,
    }),
  };

  async ensureWebhook(_conn: EsignConnectionSecret, url: string): Promise<{ configId: string; hmacKeys: string[] }> {
    this.calls += 1;
    return { configId: `mock-connect-${encodeURIComponent(url)}`, hmacKeys: ['mock-hmac-key'] };
  }

  verifyWebhook(rawBody: Uint8Array, headers: Headers, keys: readonly string[]): boolean {
    const presented: string[] = [];
    headers.forEach((value, name) => {
      if (name.toLowerCase().startsWith(MOCK_WEBHOOK_SIGNATURE_HEADER_PREFIX)) presented.push(value);
    });
    if (presented.length === 0 || keys.length === 0) return false;
    // 🔴 ローテーション中は複数キーが有効。いずれか 1 つが一致すれば true。
    return keys.some((key) => {
      const expected = mockWebhookSignature(key, rawBody);
      return presented.some((candidate) => safeEquals(candidate, expected));
    });
  }

  /**
   * 🔴 **重複呼び出しを黙って吸収しない。** 同じ `SendAttemptToken` で 2 回呼ばれたら
   *    2 回として記録する（`callCount()` が 2 になる）。二重送信を防ぐのは
   *    `packages/db` の CAS と `SendAttempt` の `UNIQUE`（docs/05 §10.2）であり、
   *    モックが握り潰すとその防御が効いていないことをテストで検出できなくなる。
   */
  async createAndSend(
    input: EsignSendInput & { readonly signers: readonly EsignSigner[] },
    token: SendAttemptToken,
  ): Promise<{ externalDocumentId: string }> {
    this.calls += 1;
    const externalDocumentId = `mock-doc-${token.idempotencyKey}-${randomUUID()}`;
    this.envelopes.set(externalDocumentId, {
      externalDocumentId,
      // 🔴 氏名・メールを保持しない（正規化の規約。docs/05 §8.1 `NormalizedSigner`）。
      signers: input.signers.map((signer) => ({
        role: signer.role,
        routingOrder: signer.routingOrder,
        status: 'PENDING',
        signedAt: null,
      })),
      withdrawnAt: null,
      declinedAt: null,
    });
    return { externalDocumentId };
  }

  async fetchStatus(_conn: EsignConnectionSecret, externalDocumentId: string): Promise<NormalizedEsignStatus> {
    this.calls += 1;
    const envelope = this.envelopes.get(externalDocumentId);
    if (envelope === undefined) return { kind: 'UNKNOWN' };
    if (envelope.withdrawnAt !== null) return { kind: 'WITHDRAWN', at: envelope.withdrawnAt };
    if (envelope.declinedAt !== null) return { kind: 'DECLINED', at: envelope.declinedAt };

    const signers = envelope.signers.map((signer) => ({ ...signer }));
    const signedAt = signers
      .map((signer) => signer.signedAt)
      .reduce<Date | null>((latest, at) => (at !== null && (latest === null || at > latest) ? at : latest), null);
    const allSigned = signers.length > 0 && signers.every((signer) => signer.status === 'SIGNED');
    // 🔴 一部未署名は `PENDING`（= `Contract` は `UNDER_REVIEW` のまま）。状態を増やさない。
    return allSigned && signedAt !== null ? { kind: 'SIGNED', signedAt, signers } : { kind: 'PENDING', signers };
  }

  async withdraw(_conn: EsignConnectionSecret, externalDocumentId: string): Promise<void> {
    this.calls += 1;
    const envelope = this.envelopes.get(externalDocumentId);
    if (envelope !== undefined) envelope.withdrawnAt = this.now();
  }

  async downloadExecuted(_conn: EsignConnectionSecret, externalDocumentId: string): Promise<Uint8Array> {
    this.calls += 1;
    return new TextEncoder().encode(`mock-executed-document:${externalDocumentId}`);
  }

  callCount(): number {
    return this.calls;
  }

  /**
   * モックの操作 API（署名の進行を再現する）。
   * 実装では Webhook / 先方の署名操作がこの役割を果たす。E2E はこれで
   * 「HOST 署名後も `UNDER_REVIEW` のまま、全員署名で `EXECUTED`」（docs/05 §17.3 #22）を確かめる。
   */
  completeSigning(externalDocumentId: string, role: 'HOST' | 'COUNTERPARTY', at: Date = this.now()): void {
    const envelope = this.envelopes.get(externalDocumentId);
    if (envelope === undefined) return;
    for (const signer of envelope.signers) {
      if (signer.role === role && signer.status === 'PENDING') {
        envelope.signers[envelope.signers.indexOf(signer)] = { ...signer, status: 'SIGNED', signedAt: at };
      }
    }
  }

  /** モックの操作 API（先方の辞退を再現する）。 */
  declineSigning(externalDocumentId: string, at: Date = this.now()): void {
    const envelope = this.envelopes.get(externalDocumentId);
    if (envelope !== undefined) envelope.declinedAt = at;
  }

  private now(): Date {
    return this.options.now?.() ?? new Date();
  }
}
