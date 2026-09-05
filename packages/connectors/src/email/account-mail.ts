// packages/connectors/src/email/account-mail.ts
// `account.mail`（招待・パスワード再設定）の payload と送達状態（docs/05 §9.4 / §6.4）。
//
// 🔴 T-04-03 で `apps/web/lib/jobs/account-mail.ts` から**ここへ移設した**（T-03-03 の申し送り）。
//    payload の形は `apps/web`（enqueue する側）と `apps/worker`（実行する側）の**契約**であり、
//    片方のアプリに置くと、もう片方が「同じ形のはずの型」を再定義することになる。
//    キュー定義（名前・`attempts`）は `packages/connectors/src/queues.ts` の 1 箇所にある。
//
// 🔴 `token` は**平文**である（docs/05 §9.4 / §16.2）:
//    - payload（Redis）にだけ載る。ジョブの完了とともに消える
//    - **DB・ログ・監査ログ・エラー追跡に載せない**（`packages/config` の redact denylist に `token`）
//    - 保留（`HELD_*`）に入った時点で平文は失われる。だから復帰は**トークンの再発行**でしか
//      できない（docs/05 §8.3 / §9.4。この非対称性は意図した設計である）

import type { AccountMailRecipientClass } from '@ses/domain';

/** docs/05 §9.4 の `account.mail` payload の `kind`。 */
export const ACCOUNT_MAIL_KINDS = ['INVITATION', 'PASSWORD_RESET'] as const;

export type AccountMailKind = (typeof ACCOUNT_MAIL_KINDS)[number];

/**
 * `account.mail` の payload（docs/05 §9.4）。
 *
 * 🔴 `recipientClass` は**必須**である（docs/05 §8.2「分類が未指定の送信を成立させない」）。
 *    型は `AccountMailRecipientClass`（分類 1 / 2）に限られ、業務上の外部送信（分類 3 / 4）を
 *    載せられない。値は `resolveRecipientClass` が `Membership` / `Invitation` から導いたものだけで、
 *    **呼び出し側が文字列を書く経路は無い。**
 */
export type AccountMailJob = {
  readonly tenantId: string;
  readonly kind: AccountMailKind;
  /** `INVITATION` なら `Invitation.id`、`PASSWORD_RESET` なら `User.id`。 */
  readonly targetId: string;
  readonly recipientClass: AccountMailRecipientClass;
  readonly token: string;
};

/**
 * enqueue の結果（#14 / #5 の `deliveryState`。docs/05 §6.4 / §8.3 / §8.3-Q ④）。
 *
 * - `QUEUED`: 実送信の経路に載った
 * - `MOCKED`: モックのメールコネクタで終わる（`development` / `demo`、および `sandbox` の分類 2）
 * - `HELD_DOMAIN_UNVERIFIED`: 🔴 取引先宛（分類 2）だが独自ドメインが未検証（docs/05 §8.3 /
 *   `F-007 AC-5`）。**障害ではない。** 招待は作成され、送達は検証完了後にトークンを再発行して行う
 * - `HELD_PROVIDER_QUOTA`: 🔴 送信基盤（環境全体）の 24h 枠に到達している（docs/05 §8.3-Q）。
 *   **利用者に「失敗」と見せない。** 復帰は `send.hold-release`
 *
 * 🔴 `FAILED` をここに置かない。送達の失敗は `EmailDispatch.status` の話であり、
 *    「操作が成立したか」を返すこの型に混ぜると、保留と障害が画面上で同じ扱いになる。
 */
export const ACCOUNT_MAIL_DELIVERY_STATES = [
  'QUEUED',
  'MOCKED',
  'HELD_DOMAIN_UNVERIFIED',
  'HELD_PROVIDER_QUOTA',
] as const;

export type AccountMailDeliveryState = (typeof ACCOUNT_MAIL_DELIVERY_STATES)[number];

/** enqueue の実装（BullMQ / 保留キュー）が満たす契約。 */
export type AccountMailQueue = {
  enqueue(job: AccountMailJob): Promise<AccountMailDeliveryState>;
};

/**
 * 🔴 `EmailDispatch.dedupeKey`（docs/05 §9.4 の `'{kind}:{targetId}:{sha256(token) の先頭 16 桁}'`）。
 *
 * トークンのハッシュを含めるので、**同じトークンでの再試行は必ず同じキー**になり `UNIQUE` で
 * 1 通に収束する（`attempts: 3` を許す根拠）。一方、再発行された新しいトークンは別のキーになり、
 * 保留からの復帰が「同じ行の重複」として弾かれない（docs/05 §8.3）。
 *
 * 🔴 ハッシュ計算は呼び出し側（`packages/db`）が行い、ここは組み立てだけを持つ ——
 *    `packages/connectors` に平文トークンを渡す経路を作らないため。
 */
export function accountMailDedupeKey(input: {
  readonly kind: AccountMailKind;
  readonly targetId: string;
  /** `sha256(token)` の先頭 16 桁（16 進）。 */
  readonly tokenHashPrefix: string;
}): string {
  return `${input.kind}:${input.targetId}:${input.tokenHashPrefix}`;
}
