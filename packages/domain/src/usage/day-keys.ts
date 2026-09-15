// packages/domain/src/usage/day-keys.ts
// 🔴 `UsageCounter.periodKey`（`YYYY-MM-DD` / `YYYY-MM`）の**暦の演算**（docs/05 §9.8 / `F-026 AC-4`）。T-10-02。
//
// ============================================================================
// 🔴 なぜ `Date` を使わずに整数で暦を進めるのか
// ============================================================================
// `usage.gap-check` は「連続する暦日のうち、どの日の計測が無いか」を判定する。連続性の判定は
// 「日の列挙」そのものであり、`packages/domain` に置くのが自然だが、domain は `Date` の生成を
// 一切持てない（`tests/static/domain-purity.test.ts`。docs/05 §17.2 #14）。
// そこで暦日を **1970-01-01 からの日数（整数）** に写し、整数の加減算で進める
// （Howard Hinnant の civil-date アルゴリズム。閏年・月末を含めて決定的に求まる）。
// **同じ入力から必ず同じ列が得られる**ため、ジョブの再実行と結合テストが同じ判定を再現できる。
//
// 🔴 キーは `usagePeriodKey`（`period-key.ts`）が `Asia/Tokyo` で作ったものである前提であり、
//    ここではタイムゾーンを扱わない（文字列の暦だけを進める）。

const DAY_KEY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const MONTH_KEY_PATTERN = /^(\d{4})-(\d{2})$/;

function pad2(value: number): string {
  return value < 10 ? `0${value}` : String(value);
}

function assertValidCivil(year: number, month: number, day: number, key: string): void {
  if (month < 1 || month > 12 || day < 1 || day > daysInMonth(year, month)) {
    throw new RangeError(`暦日キーが不正です（${key}）。`);
  }
}

/** `YYYY-MM-DD` を年・月・日に分解する。🔴 形式も暦としての妥当性も検査する（`2026-02-30` は例外）。 */
export function parseDayKey(key: string): { readonly year: number; readonly month: number; readonly day: number } {
  const matched = DAY_KEY_PATTERN.exec(key);
  if (matched === null) throw new RangeError(`暦日キーの形式が不正です（${key}）。YYYY-MM-DD で渡してください。`);
  const year = Number(matched[1]);
  const month = Number(matched[2]);
  const day = Number(matched[3]);
  assertValidCivil(year, month, day, key);
  return { year, month, day };
}

/** `YYYY-MM` を年・月に分解する。 */
export function parseMonthKey(key: string): { readonly year: number; readonly month: number } {
  const matched = MONTH_KEY_PATTERN.exec(key);
  if (matched === null) throw new RangeError(`暦月キーの形式が不正です（${key}）。YYYY-MM で渡してください。`);
  const year = Number(matched[1]);
  const month = Number(matched[2]);
  if (month < 1 || month > 12) throw new RangeError(`暦月キーが不正です（${key}）。`);
  return { year, month };
}

function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

/** その月の日数（閏年を含む）。 */
export function daysInMonth(year: number, month: number): number {
  if (month === 2) return isLeapYear(year) ? 29 : 28;
  return [4, 6, 9, 11].includes(month) ? 30 : 31;
}

/** 暦日 → 1970-01-01 からの日数（Hinnant `days_from_civil`）。 */
function daysFromCivil(year: number, month: number, day: number): number {
  const y = month <= 2 ? year - 1 : year;
  const era = Math.floor(y / 400);
  const yoe = y - era * 400;
  const mp = month > 2 ? month - 3 : month + 9;
  const doy = Math.floor((153 * mp + 2) / 5) + day - 1;
  const doe = yoe * 365 + Math.floor(yoe / 4) - Math.floor(yoe / 100) + doy;
  return era * 146097 + doe - 719468;
}

/** 1970-01-01 からの日数 → 暦日（Hinnant `civil_from_days`）。 */
function civilFromDays(days: number): { year: number; month: number; day: number } {
  const z = days + 719468;
  const era = Math.floor(z / 146097);
  const doe = z - era * 146097;
  const yoe = Math.floor((doe - Math.floor(doe / 1460) + Math.floor(doe / 36524) - Math.floor(doe / 146096)) / 365);
  const doy = doe - (365 * yoe + Math.floor(yoe / 4) - Math.floor(yoe / 100));
  const mp = Math.floor((5 * doy + 2) / 153);
  const day = doy - Math.floor((153 * mp + 2) / 5) + 1;
  const month = mp < 10 ? mp + 3 : mp - 9;
  const year = yoe + era * 400 + (month <= 2 ? 1 : 0);
  return { year, month, day };
}

function formatDayKey(year: number, month: number, day: number): string {
  return `${year}-${pad2(month)}-${pad2(day)}`;
}

/** 暦日キーを `days` 日だけ進める（負なら戻す）。月末・閏年をまたいでも正しい。 */
export function shiftDayKey(key: string, days: number): string {
  if (!Number.isInteger(days)) throw new RangeError(`shiftDayKey: 日数は整数である必要があります（${days}）。`);
  const { year, month, day } = parseDayKey(key);
  const shifted = civilFromDays(daysFromCivil(year, month, day) + days);
  return formatDayKey(shifted.year, shifted.month, shifted.day);
}

/**
 * `from` から `to` までの暦日キーを**両端を含めて**昇順に列挙する。`from > to` なら空。
 *
 * 🔴 `usage.gap-check` の「期待される日の列」はこれで作る。列挙が `Date` に依存しないため、
 *    UTC / JST の取り違えで 1 日ずれる余地が無い。
 */
export function enumerateDayKeys(from: string, to: string): readonly string[] {
  const start = parseDayKey(from);
  const end = parseDayKey(to);
  const first = daysFromCivil(start.year, start.month, start.day);
  const last = daysFromCivil(end.year, end.month, end.day);
  const keys: string[] = [];
  for (let cursor = first; cursor <= last; cursor += 1) {
    const civil = civilFromDays(cursor);
    keys.push(formatDayKey(civil.year, civil.month, civil.day));
  }
  return keys;
}

/** 暦日キー → その日が属する月キー（`2026-09-16` → `2026-09`）。 */
export function monthKeyOfDay(dayKey: string): string {
  const { year, month } = parseDayKey(dayKey);
  return `${year}-${pad2(month)}`;
}

/** 月キーを `months` か月だけ進める（負なら戻す）。 */
export function shiftMonthKey(key: string, months: number): string {
  if (!Number.isInteger(months)) throw new RangeError(`shiftMonthKey: 月数は整数である必要があります（${months}）。`);
  const { year, month } = parseMonthKey(key);
  const index = year * 12 + (month - 1) + months;
  return `${Math.floor(index / 12)}-${pad2((index % 12 + 12) % 12 + 1)}`;
}

/** 月キー → その月の初日・末日の暦日キー。 */
export function dayRangeOfMonth(monthKey: string): { readonly first: string; readonly last: string } {
  const { year, month } = parseMonthKey(monthKey);
  return {
    first: formatDayKey(year, month, 1),
    last: formatDayKey(year, month, daysInMonth(year, month)),
  };
}

/** 2 つの暦日キーの大小（`a < b` なら負）。 */
export function compareDayKeys(a: string, b: string): number {
  const left = parseDayKey(a);
  const right = parseDayKey(b);
  return daysFromCivil(left.year, left.month, left.day) - daysFromCivil(right.year, right.month, right.day);
}
