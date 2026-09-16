// apps/web/lib/admin-monitoring/view.types.test.ts
// 🔴 T-11-04: API-A8（`A-005`）の応答型に**内容（本文・氏名・宛先・トークン・単価・payload）に相当するキーが存在しない**
//    ことを型で固定する（docs/02 `F-059 AC-3` / `BR-40` / `CLAUDE.md` §10.5「運営者に必要なのは件数・状態・エラー」）。
//    `apps/web/lib/usage/view.types.test.ts` と同じ手口（「無いこと」はコンパイル時に全キーを列挙して確かめる）。
//    実データが JSON に現れないことは `tests/isolation/admin-monitoring.test.ts` が実測する。
import { describe, expect, it } from 'vitest';
import type { MonitoringItemView, MonitoringSnapshotView } from './view';

/** 配列・オブジェクト・合併を再帰的に辿って**すべてのプロパティ名**を列挙する。 */
type DeepKeys<T> = T extends readonly (infer U)[]
  ? DeepKeys<U>
  : T extends object
    ? { [K in keyof T & string]: K | DeepKeys<T[K]> }[keyof T & string]
    : never;

type SnapshotKeys = DeepKeys<MonitoringSnapshotView>;

/** 内容・身元・商流・秘匿値に相当する名前（`tests/static/admin-no-content-reach.test.ts` の非開示列と同じ語彙）。 */
type ContentLike =
  | `${string}${'body' | 'Body' | 'subject' | 'Subject' | 'title' | 'Title' | 'message' | 'Message' | 'note' | 'Note'}${string}`
  | `${string}${'name' | 'Name' | 'email' | 'Email' | 'phone' | 'Phone' | 'birth' | 'Birth' | 'address' | 'Address'}${string}`
  | `${string}${'recipient' | 'Recipient' | 'token' | 'Token' | 'dkim' | 'Dkim' | 'secret' | 'Secret' | 'payload' | 'Payload'}${string}`
  | `${string}${'price' | 'Price' | 'amount' | 'Amount' | 'findings' | 'Findings' | 'excerpt' | 'Excerpt' | 'reason' | 'Reason'}${string}`
  | `${string}${'data' | 'Data' | 'skills' | 'Skills' | 'careers' | 'Careers' | 'summary' | 'Summary' | 'detail' | 'Detail'}${string}`;

/**
 * 🔴 例外は 4 つだけであり、いずれも内容ではない:
 *  - `queueName` … 項目 3 のキュー名（`QUEUE_DEFINITIONS` のキー。列挙値であり利用者・エンジニアの氏名ではない）
 *  - `tenantName` … `A-005` 項目 11 の列（docs/04 §A-005 / `listUnverifiedSendingDomains` の DTO）。テナントの商号は
 *    `A-002` / `A-003` と同じく運営者に開示してよい（利用者・エンジニアの氏名ではない）
 *  - `countsByReason` / `reason` … 項目 12 の**理由の区別**（`AI_COST_LIMIT_HELD` / `JOB_FAILED` / `RUNNING_OVERDUE`。列挙値）
 *  - `byReason` … 項目 14 の理由別内訳（`SendHoldReasonKey` の 7 値。列挙値）
 */
type AllowedExceptions = 'queueName' | 'tenantName' | 'countsByReason' | 'reason' | 'byReason';

const NO_CONTENT_KEY: [Exclude<Extract<SnapshotKeys, ContentLike>, AllowedExceptions>] extends [never] ? true : never = true;

// 🔴 項目 13 / 17 は `tenantId` を持たない（環境全体。docs/05 §6.9 API-A8）。
type MailProviderKeys = DeepKeys<Extract<MonitoringItemView, { kind: 'MAIL_PROVIDER_QUOTA' }>>;
type ProviderSpendKeys = DeepKeys<Extract<MonitoringItemView, { kind: 'PROVIDER_SPEND' }>>;
const MAIL_PROVIDER_HAS_NO_TENANT: [Extract<MailProviderKeys, 'tenantId'>] extends [never] ? true : never = true;
const PROVIDER_SPEND_HAS_NO_TENANT: [Extract<ProviderSpendKeys, 'tenantId'>] extends [never] ? true : never = true;

// 🔴 項目 17 は `byRole` を載せない（`A-004` の材料。docs/sprints/SP-11 T-11-08 ①）。
const PROVIDER_SPEND_HAS_NO_BY_ROLE: [Extract<ProviderSpendKeys, 'byRole'>] extends [never] ? true : never = true;

// 🔴 失敗した項目は kind / ok / errorKind だけを持つ（0 件の材料で埋めない）。
type FailedKeys = keyof Extract<MonitoringItemView, { ok: false }>;
const FAILED_IS_MINIMAL: [Exclude<FailedKeys, 'kind' | 'ok' | 'errorKind'>] extends [never] ? true : never = true;

describe('🔴 API-A8 の応答型に内容へ到達するキーが無い（F-059 AC-3 / BR-40）', () => {
  it('型レベルの検査が成立している（コンパイルが通った時点で担保。ここは対照）', () => {
    expect(NO_CONTENT_KEY).toBe(true);
    expect(MAIL_PROVIDER_HAS_NO_TENANT).toBe(true);
    expect(PROVIDER_SPEND_HAS_NO_TENANT).toBe(true);
    expect(PROVIDER_SPEND_HAS_NO_BY_ROLE).toBe(true);
    expect(FAILED_IS_MINIMAL).toBe(true);
  });
});
