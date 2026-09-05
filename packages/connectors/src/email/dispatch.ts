// packages/connectors/src/email/dispatch.ts
// `email.dispatch`（運用メール）の payload 型（docs/05 §9.4 / §3.9 `EmailDispatch`）。T-04-02。
//
// 🔴 なぜ payload に型の制約を置くのか（docs/05 §9.4 の 🔴）:
//    `email.dispatch` は送信系キューの中で**唯一 `attempts: 3` を許される**。その根拠は
//    「宛先が自テナントの利用者または運営者（分類 1 / 分類外）に限られ、`BR-21`
//    （取引先への二重送信）の射程外である」ことだけである。したがって
//    **分類 2 / 3 / 4 を載せられないことが `attempts: 3` の前提条件**であり、
//    運用の約束ではなく型で保証しなければならない。
//
// 🔴 キュー定義（名前・`attempts`）そのものは `packages/connectors/src/queues.ts` の 1 箇所にある。
//    `email.dispatch` / `account.mail` のキュー定義とハンドラは T-04-03 が同ファイルに追記する。
//    本タスク（T-04-02）が確定させるのは「単一経路が受け取れる宛先分類」だけである。

import type { HostOrPlatformRecipientClass } from '@ses/domain';

/**
 * 🔴 `email.dispatch` の payload（docs/05 §9.4）。
 *
 * - `dispatchId`: 先に作成済みの `EmailDispatch` 行。**宛先・本文は DB 側にあり payload に載せない**
 *   （平文トークンを載せてよいのは `account.mail` だけである。docs/05 §9.4 / §16.2）。
 * - `tenantId`: 🔴 docs/05 §9.1「payload に `tenantId` を必ず含め、ハンドラ冒頭で `withTenant` の
 *   ctx を組み立てる」。**運営者宛（分類外）はテナントに属さないため `null`** になる
 *   （`EmailDispatch.tenantId` も nullable。docs/05 §3.9）。
 * - `recipientClass`: 🔴 **分類 1 / 分類外しか載らない。** 分類 2 / 3 / 4 を代入すると
 *   コンパイルエラーになる（`packages/connectors/src/email/dispatch.test.ts` が型テストで固定）。
 *   値の出所は `packages/db` の `resolveRecipientClass`（`Membership` から機械的に導く）であり、
 *   呼び出し側が文字列を書くことはない。
 */
export type HostOrPlatformDispatch = {
  readonly dispatchId: string;
  readonly tenantId: string | null;
  readonly recipientClass: HostOrPlatformRecipientClass;
};
