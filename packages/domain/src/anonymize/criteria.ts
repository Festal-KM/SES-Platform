// packages/domain/src/anonymize/criteria.ts
// 🔴 匿名候補（`CLAUDE.md` §3.1 経路 4）に対する検索条件の評価 —— **丸めた後の区分に対して行う**。
//    T-08-05（`docs/05` §4.6 線引き表 #8 / `F-009` / `F-017 AC-3`）。
//
// ============================================================================
// 🔴 なぜ生値ではなく区分で評価するか
// ============================================================================
// 匿名候補の 5 項目は「7 年 → 5〜10 年」「65 万円 → 60〜70 万円」「2026-10-01 → 翌月」と
// 丸めて**表示**する（`rounding.ts`）。ところが検索条件を**生値の SQL 述語**で評価すると、
// `yearsMin=7` では当たり `yearsMin=8` では外れる、という**当たり方の差から 7 年が復元できる**。
// 単価は 1 万円刻み、稼働開始日は 1 日刻みで二分探索できてしまい、丸めは表示にしか効かない。
// したがって匿名候補への条件は「**その区分の中に条件を満たしうる値があるか**」で判定する。
// 帯の内側で生値をどう動かしても判定は変わらない（= 帯より細かい情報が当たり方に出ない）。
//
// 🔴 **評価に使えるのは開示している 5 項目だけである。** フリーワード（氏名・希望条件）と
//    稼働状況（`availability`）は匿名候補に対して評価しない —— 開示していない属性の当たり外れは、
//    それ自体が 6 項目目の開示になる（開示項目の追加は人間の承認事項。`CLAUDE.md` §8.6）。
//    本ファイルの関数はその 2 つを**引数に取らない**（渡せないものは評価できない）。
//
// 🔴 `packages/domain` の純粋関数である。`Date` を作らず、粒度の境界（`yearsBandBoundaries`）と
//    基準日（`referenceDate`）は引数で受ける（`rounding.ts` と同じ理由）。
import type { PrefectureCode } from '../ledger/prefectures.js';
import {
  ANONYMIZED_YEARS_BANDS,
  type AnonymizedAvailabilityBand,
  type AnonymizedPriceBand,
  type AnonymizedRemoteMode,
  type AnonymizedYearsBand,
  type AnonymizeRoundingConfig,
  type RoundedAnonymousAttributes,
} from './rounding.js';

/** 万円 ↔ 円（`rounding.ts` と同じ表示単位。粒度の設定値ではない）。 */
const YEN_PER_MAN_YEN = 10_000;

/** `YYYY-MM-DD`（`rounding.ts` の `DAY_PATTERN` と同じ）。 */
const DAY_PATTERN = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;

function assertDay(fieldName: string, value: string): void {
  if (!DAY_PATTERN.test(value)) {
    // 🔴 受け取った値そのものを載せない（`rounding.ts` の `parseDay` と同じ規律）。
    throw new RangeError(`${fieldName} は YYYY-MM-DD（日単位）である必要があります。`);
  }
}

/**
 * 基準日の `monthOffset` か月後の**月初**（`YYYY-MM-01`）。
 * 🔴 `Date` を使わない（`packages/domain` は `new Date()` を持ち込めない）。年月の繰り上げだけである。
 */
function firstDayOfMonthAfter(referenceDate: string, monthOffset: number): string {
  const year = Number(referenceDate.slice(0, 4));
  const month = Number(referenceDate.slice(5, 7));
  const total = year * 12 + (month - 1) + monthOffset;
  const nextYear = Math.floor(total / 12);
  const nextMonth = (total % 12) + 1;
  return `${String(nextYear).padStart(4, '0')}-${String(nextMonth).padStart(2, '0')}-01`;
}

/**
 * 経験年数の区分が「`yearsMin` 年以上」を満たしうるか。
 *
 * 区分 `[下限, 上限)` の**上限**が `yearsMin` より大きければ、帯の中に条件を満たす値がある。
 * `GTE_10Y` は上限が無いので常に満たしうる。`null`（スキル 0 件）は満たさない
 * （自社側の `engineerSkills.some` が 0 件で偽になるのと同じ向き）。
 */
export function yearsBandMayReach(
  band: AnonymizedYearsBand | null,
  yearsMin: number,
  boundaries: AnonymizeRoundingConfig['yearsBandBoundaries'],
): boolean {
  if (band === null) return false;
  const index = ANONYMIZED_YEARS_BANDS.indexOf(band);
  // 最上位の帯（`GTE_10Y`）は上限を持たない。
  if (index >= boundaries.length) return true;
  const upperExclusive = boundaries[index];
  return upperExclusive === undefined ? true : upperExclusive > yearsMin;
}

/**
 * 単価の区分が検索レンジ `[priceMinYen, priceMaxYen]` と**重なりうる**か。
 *
 * 🔴 自社側の定義（`packages/db/src/search/engineers.ts` の `engineerPriceConditions`）と
 *    同じ向きで判定する: `priceMax` 指定 = 台帳の**下限**がそれ以下 / `priceMin` 指定 =
 *    台帳の**上限**がそれ以上。帯 `[from, to)` では、下限の最小値は `from`、上限の最大値は
 *    `to` 未満なので、「`from ≦ priceMax`」かつ「`to > priceMin`」で表す。
 * 🔴 `null`（単価未設定）は**制約なし**として重なる（自社側の NULL の扱いと同じ。
 *    不一致に倒すと単価で絞った瞬間に未登録の候補が全員消える）。
 */
export function priceBandMayOverlap(
  band: AnonymizedPriceBand | null,
  priceMinYen: number | undefined,
  priceMaxYen: number | undefined,
): boolean {
  if (band === null) return true;
  const fromYen = band.fromManYen * YEN_PER_MAN_YEN;
  if (priceMaxYen !== undefined && fromYen > priceMaxYen) return false;
  if (priceMinYen !== undefined && band.kind === 'RANGE') {
    const toYen = band.toManYen * YEN_PER_MAN_YEN;
    if (toYen <= priceMinYen) return false;
  }
  return true;
}

/**
 * 稼働可能時期の区分が「`availableBy` までに稼働できる」を満たしうるか。
 *
 * 区分ごとの**最も早い稼働開始日**が `availableBy` 以前であれば満たしうる:
 *   - `IMMEDIATE` … 基準日以前（常に満たしうる）
 *   - `THIS_MONTH` … 基準日の翌日以降・当月内 → `availableBy` が基準日より後
 *   - `NEXT_MONTH` / `MONTH_AFTER_NEXT` / `THREE_MONTHS_OR_LATER` … それぞれの月初以降
 * 🔴 `null`（未設定）は**満たさない**（自社側の `inTimeCondition` と同じ向き。値そのものが
 *    不明なので「間に合う」と断定できない）。
 * 🔴 ISO の日付は辞書順比較で日付順になる（`Date` を作らない）。
 */
export function availabilityBandMayBeBy(
  band: AnonymizedAvailabilityBand | null,
  availableBy: string,
  referenceDate: string,
): boolean {
  assertDay('availableBy', availableBy);
  assertDay('referenceDate', referenceDate);
  if (band === null) return false;
  switch (band) {
    case 'IMMEDIATE':
      return true;
    case 'THIS_MONTH':
      return availableBy > referenceDate;
    case 'NEXT_MONTH':
      return availableBy >= firstDayOfMonthAfter(referenceDate, 1);
    case 'MONTH_AFTER_NEXT':
      return availableBy >= firstDayOfMonthAfter(referenceDate, 2);
    case 'THREE_MONTHS_OR_LATER':
      return availableBy >= firstDayOfMonthAfter(referenceDate, 3);
  }
}

/** 「通勤可能」と見なすリモート可否（自社側の `COMMUTABLE_REMOTE_MODE` と同じ 1 値）。 */
const COMMUTABLE_REMOTE_MODE: AnonymizedRemoteMode = 'FULL_REMOTE';

/**
 * 勤務地 `prefecture` に通勤できるか（勤務地の一致 **または** フルリモート可）。
 * 都道府県とリモート可否はどちらも丸めずに開示している値なので、自社側と同じ判定になる。
 */
export function anonymousMayCommute(
  attributes: Pick<RoundedAnonymousAttributes, 'prefecture' | 'remoteMode'>,
  prefecture: PrefectureCode,
): boolean {
  return attributes.prefecture === prefecture || attributes.remoteMode === COMMUTABLE_REMOTE_MODE;
}

/** スキルの組み合わせ（`docs/02` `F-009` 入力「スキル（複数・AND / OR）」）。 */
export type AnonymousSkillMode = 'AND' | 'OR';

/**
 * 表示されるスキル（上位 8 件の**名称**）が指定を満たすか。
 *
 * 🔴 **照合は表示される名称に対してだけ行う**（`RoundedAnonymousAttributes.skills`）。
 *    9 件目以降のスキルで当たると、表示されないスキルの有無が当たり方から漏れる。
 * 🔴 名称で照合するのは、丸め後の値に `skillId` が無いため（`F-017 AC-2`。載せない）。
 *    `Skill.name` は辞書で一意なので名称照合は ID 照合と同じ厳密さを持つ。
 */
export function anonymousSkillsInclude(
  skills: RoundedAnonymousAttributes['skills'],
  skillNames: readonly string[],
  mode: AnonymousSkillMode,
): boolean {
  if (skillNames.length === 0) return true;
  const names = new Set(skills.map((skill) => skill.name));
  return mode === 'AND'
    ? skillNames.every((name) => names.has(name))
    : skillNames.some((name) => names.has(name));
}
