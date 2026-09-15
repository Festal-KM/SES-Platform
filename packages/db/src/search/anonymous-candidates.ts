// packages/db/src/search/anonymous-candidates.ts
// 匿名候補（`CLAUDE.md` §3.1 経路 4）に対する **検索条件の評価計画**。T-08-05
// （docs/05 §4.6 線引き表 #8 / §6.5「#30 の実装の決着」/ `F-009` / `F-017 AC-3`）。
//
// ============================================================================
// 🔴 ここが「検索の実装の唯一の置き場所」に在る理由（`index.ts` 冒頭）
// ============================================================================
// 自社候補の検索条件 → 述語の変換は `engineers.ts`（`engineerSearchPlan`）が持つ。匿名候補にも
// **同じ検索条件**が効くが、評価の対象が SQL の行ではなく**丸めた後の区分**
// （`RoundedAnonymousAttributes`）である。「どの条件がハードか / ソフトか」「ソフト条件が
// 有効になる条件」を自社側と 1 か所で共有するために、同じディレクトリに置き、
// `engineerSoftCriteria`（`engineers.ts`）を通す。
//
// 🔴 **生値に対する述語（`engineerSearchPlan(criteria).where`）を共有スコープに渡してはならない。**
//    `yearsMin=7` で当たり `8` で外れる、という当たり方の差から「7 年」が復元できる
//    （丸めが表示にしか効かない）。区分に対する「重なりうるか」で判定すれば、
//    **帯の内側で生値をどう動かしても判定が変わらない**（判定の本体は `@ses/domain` の
//    `anonymize/criteria.ts`。ここはそれを検索条件の形に束ねるだけである）。
//
// 🔴 **評価に使えるのは開示している 5 項目だけ**である。`q`（フリーワード = 氏名・希望条件）と
//    `availability`（稼働状況）は匿名候補に**適用しない**（開示していない属性の当たり外れは、
//    それ自体が 6 項目目の開示になる。開示項目の追加は人間の承認事項。`CLAUDE.md` §8.6）。
//    本ファイルはその 2 つを**読まない**（`criteria.q` / `criteria.availability` がコード上に現れない
//    ことを `anonymous-candidates.test.ts` が文字列として固定する）。
import {
  anonymousMayCommute,
  anonymousSkillsInclude,
  availabilityBandMayBeBy,
  priceBandMayOverlap,
  yearsBandMayReach,
  type AnonymizeRoundingConfig,
  type RoundedAnonymousAttributes,
} from '@ses/domain';
import type { RemoteMode } from '../schema-value-sets.js';
import { engineerSoftCriteria, type EngineerSearchCriteria } from './engineers.js';

/** 匿名候補の評価に要る外部の値。🔴 分離キーは受け取らない。 */
export type AnonymousCandidateSearchDeps = {
  /**
   * 検索条件の `skills`（辞書 ID）→ `Skill.name`。
   * 🔴 丸め後の値に `skillId` は無い（`F-017 AC-2`。応答に載せない）ので名称で照合する。
   *    辞書に無い ID（写像に無い）は**どの候補にも当たらない名称**として扱う（黙って条件を落とさない）。
   */
  readonly skillNames: ReadonlyMap<string, string>;
  /** 丸めの基準日（JST の `YYYY-MM-DD`）。`anonymizeEngineer` に渡したものと同じ値を渡す。 */
  readonly referenceDate: string;
  /** 丸めの粒度（`@ses/config` の `ANONYMIZE_ROUNDING`。`anonymizeEngineer` に渡したものと同じ値）。 */
  readonly rounding: AnonymizeRoundingConfig;
};

/**
 * 匿名候補の評価計画（`engineerSearchPlan` の `{ where, buckets }` に対応する）。
 *
 * - `matches` … 母集団に残るか（＝ 自社側の `where`。ハード条件 + **オンのチェックボックス**）
 * - `bucketOf` … 何番目のバケットか（＝ 自社側の `buckets` の添字。**0 = 適合**）。
 *   ソフト条件が 1 つも無いときは常に `0`（`engineerSearchPlan(criteria).buckets.length === 1` と一致）
 */
export type AnonymousCandidateSearchPlan = {
  readonly matches: (attributes: RoundedAnonymousAttributes) => boolean;
  readonly bucketOf: (attributes: RoundedAnonymousAttributes) => 0 | 1;
};

/** 辞書に無い ID に割り当てる「どの候補にも一致しない名称」。🔴 `Skill.name` は空文字を許さない。 */
const UNMATCHABLE_SKILL_NAME = '';

function skillNamesOf(
  criteria: EngineerSearchCriteria,
  skillNames: ReadonlyMap<string, string>,
): readonly string[] {
  return (criteria.skills ?? []).map((skillId) => skillNames.get(skillId) ?? UNMATCHABLE_SKILL_NAME);
}

/**
 * 🔴 匿名候補への検索条件の評価計画を組む。**唯一の入口**である。
 *
 * ハード条件（一致しなければ母集団から外れる。自社側の `where` と同じ集合）:
 *   - スキル（AND / OR。**表示される上位 8 件の名称**に対して）
 *   - 経験年数の下限（**集約の帯**に対して。スキル別の年数は開示していないので見ない）
 *   - 単価レンジの重なり（帯に対して。NULL は制約なし）
 *   - リモート可否（開示値そのまま。🔴 ハード条件である。`engineers.ts` の注記）
 *   - 🔴 チェックボックスが**オン**の稼働可能時期 / 勤務地（自社側で `where` に移るものと同じ）
 * ソフト条件（バケット = 適合 / 不適合。自社側の `buckets` と同じ分割）:
 *   - チェックボックスが**オフ**の稼働可能時期 / 勤務地（`engineerSoftCriteria` が唯一の判定）
 *
 * 🔴 `q` / `availability` は評価しない（冒頭の 🔴）。
 */
export function anonymousCandidateSearchPlan(
  criteria: EngineerSearchCriteria,
  deps: AnonymousCandidateSearchDeps,
): AnonymousCandidateSearchPlan {
  const soft = engineerSoftCriteria(criteria);
  const skillNames = skillNamesOf(criteria, deps.skillNames);
  const remote: RemoteMode | undefined = criteria.remote;

  const inTime = (attributes: RoundedAnonymousAttributes, availableBy: string): boolean =>
    availabilityBandMayBeBy(attributes.availabilityBand, availableBy, deps.referenceDate);

  const matches = (attributes: RoundedAnonymousAttributes): boolean => {
    if (!anonymousSkillsInclude(attributes.skills, skillNames, criteria.skillMode)) return false;
    if (
      criteria.yearsMin !== undefined &&
      !yearsBandMayReach(attributes.yearsBand, criteria.yearsMin, deps.rounding.yearsBandBoundaries)
    ) {
      return false;
    }
    if (!priceBandMayOverlap(attributes.priceBand, criteria.priceMin, criteria.priceMax)) {
      return false;
    }
    if (remote !== undefined && attributes.remoteMode !== remote) return false;
    // 🔴 チェックボックスがオンのものは母集団を絞る（自社側の `engineerSearchPlan` と同じ向き）。
    if (criteria.availableBy !== undefined && criteria.onlyInTime && !inTime(attributes, criteria.availableBy)) {
      return false;
    }
    if (
      criteria.prefecture !== undefined &&
      criteria.onlyCommutable &&
      !anonymousMayCommute(attributes, criteria.prefecture)
    ) {
      return false;
    }
    return true;
  };

  const bucketOf = (attributes: RoundedAnonymousAttributes): 0 | 1 => {
    if (!soft.hasAny) return 0;
    if (soft.availableBy !== undefined && !inTime(attributes, soft.availableBy)) return 1;
    if (soft.prefecture !== undefined && !anonymousMayCommute(attributes, soft.prefecture)) return 1;
    return 0;
  };

  return { matches, bucketOf };
}
