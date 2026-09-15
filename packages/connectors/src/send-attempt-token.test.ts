// packages/connectors/src/send-attempt-token.test.ts
// 🔴 T-09-05 の完了判定（docs/sprints/SP-09 §T-09-05 / docs/05 §10.1 / docs/03 `program-design` 申し送り 3）:
//    **`SendAttemptToken` なしで送信関数を呼べない**ことを型で固定する。
//
// 🔴 `tsconfig.typecheck.json` がテストも型検査するため、`@ts-expect-error` は「その行が実際にコンパイルエラーになる」
//    ときだけ通り、エラーが出なくなった瞬間に「未使用の @ts-expect-error」として `pnpm typecheck` が落ちる
//    （`queues.test.ts` の `attempts: 2` と同じ仕組み）。
//
// 🔴 ここで見ているのは「予約（`packages/db` の `reserveSendAttempt`）を経ない外部送信がコンパイルできない」こと。
//    ブランド（`declare const` のモジュール内シンボル）は export されていないため、構造が同じオブジェクトリテラルも
//    通らない。`as SendAttemptToken` による偽造が `packages/db/src/send.ts` 以外に無いことは
//    `tests/static/send-attempt-token-single-path.test.ts` が走査する。
import { describe, expect, it } from 'vitest';
import type { EmailSendInput, EmailSender, EsignProvider } from './interfaces.js';
import type { DispatchToken, EsignConnectionSecret, EsignSigner, SendAttemptToken } from './types.js';

const connection: EsignConnectionSecret = {
  refreshToken: 'mock-refresh',
  externalAccountId: 'mock-account',
  baseUri: 'https://esign.mock.invalid',
};

const signers: readonly EsignSigner[] = [
  { role: 'HOST', name: '自社 太郎', email: 'host@example.co.jp', routingOrder: 1 },
];

/** 型テスト用の送信関数（実装は呼ばない。`never` で到達不能にする）。 */
declare const emailSender: EmailSender;
declare const esignProvider: EsignProvider;

/** 🔴 ブランドの無い「構造だけ同じ」オブジェクト。`reserveSendAttempt` を経ていない値の代表。 */
const forgedSendToken = {
  idempotencyKey: 'proposal:p1:1',
  attemptSeq: 1,
  entityType: 'PROPOSAL',
  entityId: 'p1',
} as const;

const forgedDispatchToken = { dispatchId: 'd1', dedupeKey: 'k1' } as const;

function emailInputWithout(token?: unknown): Omit<EmailSendInput, 'token'> & { readonly token?: unknown } {
  return {
    recipientClass: 'CLIENT',
    to: 'client@example.test',
    templateKey: 'PROPOSAL',
    params: {},
    tenantId: 't1',
    fromDomain: { domain: 'example.co.jp', mailFromDomain: 'mail.example.co.jp', verifiedAt: new Date(0) },
    ...(token === undefined ? {} : { token }),
  };
}

describe('🔴 SendAttemptToken なしで送信関数を呼べない（docs/05 §10.1 / F-022 AC-1 の型側）', () => {
  it('型テスト（実行時には何もしない）', () => {
    // この関数は呼ばれない。型検査だけが目的。
    const typeOnly = (): void => {
      // @ts-expect-error 🔴 EmailSender.send は `token` が必須（予約を経ない送信はコンパイルできない）
      void emailSender.send(emailInputWithout());

      // @ts-expect-error 🔴 ブランドの無いオブジェクトは SendAttemptToken にも DispatchToken にもならない
      void emailSender.send({ ...emailInputWithout(), token: forgedSendToken });

      // @ts-expect-error 🔴 同上（運用メールのトークンも偽造できない）
      void emailSender.send({ ...emailInputWithout(), token: forgedDispatchToken });

      const esignInput = {
        connection,
        subject: '個別契約書',
        documentName: 'contract.pdf',
        documentBytes: new Uint8Array([1]),
        signers,
      };

      // @ts-expect-error 🔴 EsignProvider.createAndSend はトークンが必須引数（省略できない）
      void esignProvider.createAndSend(esignInput);

      // @ts-expect-error 🔴 ブランドの無いオブジェクトは SendAttemptToken ではない
      void esignProvider.createAndSend(esignInput, forgedSendToken);

      // @ts-expect-error 🔴 DispatchToken（運用メール用）は電子署名の予約トークンとして使えない
      void esignProvider.createAndSend(esignInput, forgedDispatchToken as unknown as DispatchToken);
    };
    expect(typeof typeOnly).toBe('function');
  });

  it('対照: 型としては SendAttemptToken を受け取る形になっている（テストが空振りしていない）', () => {
    // 🔴 `as` でブランドを偽造してよいのはテストファイルだけ（本番ソースは静的テストが走査する）。
    const token = forgedSendToken as unknown as SendAttemptToken;
    const accepts = (input: EmailSendInput): string => input.templateKey;
    expect(accepts({ ...emailInputWithout(), token })).toBe('PROPOSAL');
  });
});
