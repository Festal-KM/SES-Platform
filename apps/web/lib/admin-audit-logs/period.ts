// apps/web/lib/admin-audit-logs/period.ts
// `A-006` / API-A7 の期間（`from` / `to`）の相互検証と、日付入力 → ISO 日時の写像。T-11-03。
//
// 🔴 `@ses/db` に依存しない（`schemas.ts` から分けている理由）: 画面（`'use client'` の
//    `AdminAuditLogsView`）が送信前に**サーバと同じ判定**で期間を検査するために値 import する。
//    `schemas.ts` は `AUDIT_ACTOR_KINDS` を `@ses/db` から値 import するためクライアントに持ち込めない
//    （`tests/static/client-db-boundary.test.ts`）。判定を 2 箇所に書き写さず、ここ 1 つを両者が呼ぶ。
// 🔴 `maxDays` は引数で受ける（値の出所は `packages/config` の `AUDIT_LOG_SEARCH_MAX_PERIOD_DAYS`。
//    ここにベタ書きしない）。

export type AuditLogPeriodVerdict = 'OK' | 'INVERTED' | 'TOO_LONG';

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * 期間の相互検証。`from <= to` かつ `to - from <= maxDays` 日。
 * 「31 日」は `from` から `to` までの経過が 31 × 24 時間以内、の意味である（暦日の数え方に依存しない）。
 */
export function validateAuditLogPeriod(
  period: { readonly from: string; readonly to: string },
  maxDays: number,
): AuditLogPeriodVerdict {
  const from = new Date(period.from).getTime();
  const to = new Date(period.to).getTime();
  if (Number.isNaN(from) || Number.isNaN(to)) return 'INVERTED';
  if (from > to) return 'INVERTED';
  if (to - from > maxDays * DAY_MS) return 'TOO_LONG';
  return 'OK';
}

/** 🔴 UTC の日境界を使う（`S-041` と同じ。本画面に JST 丸めの明示要求は無い）。 */
export function toRangeStartIso(date: string): string {
  return `${date}T00:00:00.000Z`;
}

export function toRangeEndIso(date: string): string {
  return `${date}T23:59:59.999Z`;
}

/** `Date` → `YYYY-MM-DD`（UTC）。`<input type="date">` の値。 */
export function toDateInputValue(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/**
 * 既定の期間 = 直近 `days` 日（`docs/04` §A-006「期間入力は既定で直近 7 日を埋めて開く」）。
 * 🔴 `now` を引数で受ける（`packages/domain` ではないが、テストから固定できる形にしておく）。
 */
export function defaultAuditLogPeriod(
  now: Date,
  days: number,
): { readonly from: string; readonly to: string } {
  const to = toDateInputValue(now);
  const from = toDateInputValue(new Date(now.getTime() - days * DAY_MS));
  return { from, to };
}
