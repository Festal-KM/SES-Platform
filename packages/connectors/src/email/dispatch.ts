// packages/connectors/src/email/dispatch.ts
// `email.dispatch`（運用メール）の payload 型（docs/05 §9.4 / §3.9 `EmailDispatch`）。T-04-02。
//
// 🔴 なぜ payload に型の制約を置くのか（docs/05 §9.4 の 🔴）:
//    `email.dispatch` は送信系キューの中で**唯一 `attempts: 3` を許される**。その根拠は
//      ① 🔴 **業務上の外部送信（分類 3 / 4 = 提案先・エンジニア本人）を載せられない**こと
//      ② `EmailDispatch.dedupeKey` の `UNIQUE` と `QUEUED` からの CAS で、
//         何回再試行しても実送信は 1 通に収束すること
//    の 2 つである。①は運用の約束ではなく**型で保証**しなければならない。
//
// 🔴 T-05-08 で分類 2（パートナー所属利用者）を運べるようにした（`CLAUDE.md` §8.7 で docs 追従済み）。
//    理由と、`attempts: 3` の前提が崩れないことの説明は
//    `packages/domain/src/recipient/scope.ts` の `OPERATIONAL_MAIL_RECIPIENT_CLASSES` にある。
//    ⚠️ **`sandbox` での実送信 / モックの振り分けはこの型と無関係**である（判定は
//    `isMockedDelivery` / `SandboxRecipientScopedEmailSender` が
//    `HOST_OR_PLATFORM_RECIPIENT_CLASSES` で行う）。分類 2 は `sandbox` ではモックのままである。
//
// 🔴 キュー定義（名前・`attempts`）そのものは `packages/connectors/src/queues.ts` の 1 箇所にある。

import type { OperationalMailRecipientClass } from '@ses/domain';

/**
 * 🔴 `email.dispatch` の payload（docs/05 §9.4）。
 *
 * - `dispatchId`: 先に作成済みの `EmailDispatch` 行。**宛先・本文は DB 側にあり payload に載せない**
 *   （平文トークンを載せてよいのは `account.mail` だけである。docs/05 §9.4 / §16.2）。
 * - `tenantId`: 🔴 docs/05 §9.1「payload に `tenantId` を必ず含め、ハンドラ冒頭で `withTenant` の
 *   ctx を組み立てる」。**運営者宛（分類外）はテナントに属さないため `null`** になる
 *   （`EmailDispatch.tenantId` も nullable。docs/05 §3.9）。
 * - `recipientClass`: 🔴 **分類 1 / 2 / 分類外しか載らない。** 分類 3 / 4 を代入すると
 *   コンパイルエラーになる（`packages/connectors/src/email/dispatch.test.ts` が型テストで固定）。
 *   値の出所は `packages/db` の `resolveRecipientClass`（`Membership` から機械的に導く）であり、
 *   呼び出し側が文字列を書くことはない。
 */
export type OperationalMailDispatch = {
  readonly dispatchId: string;
  readonly tenantId: string | null;
  readonly recipientClass: OperationalMailRecipientClass;
};
