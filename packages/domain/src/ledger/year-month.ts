// packages/domain/src/ledger/year-month.ts
// `YYYY-MM`（年月）の妥当性判定の**唯一の実装**。T-09-12（docs/05 §3.4.1）。
//
// 🔴 なぜ 1 本だけか: `EngineerCareer.periodFrom` / `periodTo` は `VarChar(7)` + 正規表現の CHECK
//    で持つ（`@db.Date` にしない —— 経歴は月精度でしか書かれておらず、日を捏造しないため）。
//    API 境界の Zod（`apps/web/lib/engineers/schemas.ts`）と DB の CHECK が**同じ正規表現**を指す
//    必要があり、TS 側の出所をここに 1 つだけ置く（`docs/05` §4.6.3 の `updatedOnJst` と同じ規律。
//    実装を 2 本にすると片方だけ緩む）。
//
// 🔴 `packages/domain` は `Date` を作らない（`CLAUDE.md` §2.1）。年月の分解は文字列操作だけである。

/**
 * `YYYY-MM`。月は `01`〜`12`。
 * 🔴 DB の CHECK（migration 20260917000000 `engineer_careers_period_from_format_check` /
 *    `engineer_careers_period_to_format_check`）と同じ式である。片方を変えるときは両方を変える。
 *    `tests/static/career-year-month-mirror.test.ts` が migration.sql のテキストと突合する。
 */
export const YEAR_MONTH_PATTERN = /^[0-9]{4}-(0[1-9]|1[0-2])$/;

/** CHECK 制約に書いた正規表現のソース（PostgreSQL の `~` 演算子に渡す形）。 */
export const YEAR_MONTH_SQL_PATTERN = '^[0-9]{4}-(0[1-9]|1[0-2])$';

export type YearMonth = {
  readonly year: number;
  /** 1〜12。 */
  readonly month: number;
};

/**
 * `YYYY-MM` を年月に分解する。形が違えば `null`。
 * 🔴 空文字は `null`（＝ 不正）である。「継続中」は値の**不在**（`null`）で表し、空文字で表さない
 *    （docs/05 §3.4.1「終了年月の `null` は継続中であり、空文字にしない」）。
 */
export function parseYearMonth(value: string): YearMonth | null {
  if (!YEAR_MONTH_PATTERN.test(value)) return null;
  return { year: Number(value.slice(0, 4)), month: Number(value.slice(5, 7)) };
}

export function isYearMonth(value: string): boolean {
  return parseYearMonth(value) !== null;
}

/**
 * 年月の大小比較。🔴 `YYYY-MM` は辞書順 = 時系列順なので文字列比較で足りる（docs/05 §3.4.1）が、
 *    形の検査を伴わせるためにここを通す（不正な形は `RangeError`）。
 */
export function compareYearMonth(left: string, right: string): number {
  if (parseYearMonth(left) === null || parseYearMonth(right) === null) {
    throw new RangeError('年月は YYYY-MM である必要があります。');
  }
  return left < right ? -1 : left > right ? 1 : 0;
}
