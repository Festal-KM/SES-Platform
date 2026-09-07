// apps/web/lib/engineers/search.ts
// `GET /api/engineers`（docs/05 §6.4 #15。`F-009` / `S-005`）の**検索条件の評価**。T-06-04。
//
// ============================================================================
// 🔴 この 1 モジュールに閉じる（SP-06 T-06-05 / docs/05 TBD-8）
// ============================================================================
// 検索の実装は **`packages/db/src/search/*.ts` の 1 箇所に閉じる**のが T-06-05 の完了条件である。
// 本タスクではまだそこへ移していないが、**移せる形**にしてある:
//   - I/O を持たない（`withTenant` も Prisma のインスタンスも触らない。述語を組み立てるだけ）
//   - `next/*` にも `@ses/i18n` にも依存しない
//   - 入口は `engineerSearchPlan` の 1 本だけ（`list.ts` はこれ以外の述語を作らない）
// フリーワードは `contains`（`ILIKE '%…%'`）の **seam** である（T-06-03 の `projectListWhere` と
// 同じ）。`pg_trgm` の GIN を使わず、`%` / `_` がワイルドカードとして働くという 2 点の限界は
// **母集団の外へは出ない**（RLS が先に効く）ので情報境界の問題ではなく、T-06-05 が実装ごと差し替える。
//
// ============================================================================
// 🔴 ここに境界の条件を 1 つも書かない（`F-009 AC-3` / `BR-56` / `CLAUDE.md` §3.1）
// ============================================================================
// `engineers` の RLS は C3 OWNER_SCOPED であり、母集団はそれだけが決める。本モジュールが返す
// 述語は**すべて業務上の絞り込み**であり、`tenant_id` / `partner_company_id` /
// `owner_partner_company_id` は 1 度も現れない（`search.test.ts` が文字列として数える）。
//
// ============================================================================
// 🔴 Phase 1 の並び順（`F-009 AC-1` / `AC-2` / `docs/02` `F-009` 処理②）
// ============================================================================
// 「**検索条件への適合**と**更新日時**による決定的な順序」であり、**重みという概念を持たない**。
// 本実装の「適合」は **1 ビット**である —— 重み付き合計でも、条件ごとの優先順位でもない:
//
//   適合 = 「一覧に残すが一致はしていない」ことが起こりうる条件（＝ ソフト条件）を**すべて**満たす
//
// ソフト条件は 2 つしかない。**`docs/02` A-03 が「減点 + 明示的なフィルタ」で扱うと決めた
// 2 項目**、すなわち **稼働可能時期（開始日）** と **勤務地** である。この 2 つは対応する
// チェックボックス（`onlyInTime` / `onlyCommutable`。🔴 **既定オフ**）がオフのとき、
// 一致しなくても**一覧から消えず**、並びで後ろに回る（`F-009 AC-5`）。
// それ以外の条件（スキル・経験年数・単価・リモート可否・稼働状況・フリーワード）は AND の
// 絞り込みであり、一致しない行はそもそも母集団に残らない ＝ **適合の差が生じない**。
//
// 🔴 **条件ごとに順位を付けない。** 「開始日は満たすが勤務地は満たさない」候補と
//    「どちらも満たさない」候補を**区別しない**（区別すると 2 条件の間に優先順位 ＝ 重みを
//    置くことになり、`F-009 AC-1`「重みという概念を持たない」に反する。どちらを上に置くかは
//    [Issue #3](https://github.com/Festal-KM/SES-Platform/issues/3) が確定させる Phase 2 の
//    論点であり、Phase 1 で先取りしない）。
// 🔴 ソフト条件が 1 つも無いとき（＝ 稼働可能時期も勤務地も指定していない、または両方の
//    チェックボックスがオン）は**適合の差が生じない**ので、並びは `updated_at` 降順 → `id` 降順
//    だけになる（T-05-09 の既定順序と完全に同じ。既定の見え方を変えない）。
import type { PrefectureCode } from '@ses/domain';
import type { EngineerAvailability, RemoteMode } from '@ses/db';
import { toDateOnly } from '../format/db-values';
import type { EngineerListQuery } from './schemas';

/**
 * 本モジュールが組み立てる述語の形（Prisma の `EngineerWhereInput` の部分集合）。
 * 🔴 **`Record<string, unknown>` にしない。** 列名を型で固定しておくと、
 *    「`ownerPartnerCompanyId` を書いた」実装がコンパイルで落ちる（`CLAUDE.md` §3.1）。
 */
export type EngineerWhereFragment = {
  engineerSkills?: {
    some: {
      skillId?: string | { in: string[] };
      yearsOfExperience?: { gte: number };
    };
  };
  unitPriceMin?: null | { lte: number };
  unitPriceMax?: null | { gte: number };
  availableFrom?: null | { lte: Date } | { gt: Date };
  prefecture?: null | PrefectureCode | { not: PrefectureCode };
  remoteMode?: null | RemoteMode | { not: RemoteMode };
  availability?: EngineerAvailability;
  displayName?: { contains: string; mode: 'insensitive' };
  preferenceNote?: { contains: string; mode: 'insensitive' };
  AND?: EngineerWhereFragment[];
  OR?: EngineerWhereFragment[];
};

/**
 * 🔴 **並びの第 2・第 3 キー**（第 1 キーは「適合」＝ `EngineerSearchPlan.fit`）。
 *
 * `updated_at` の降順 → `id` の降順。`id` は `uuid(7)`（時系列で単調増加）なので、同時刻の行でも
 * 順序が**一意**に決まる（`F-009 AC-1`「実行のたびに同じ並び順」）。
 * 🔴 **`ORDER BY` に「全体件数」「順位」「スコア」を持ち込まない**（docs/05 §4.8）。境界外の行の
 *    有無で順位が動くと、並び順そのものが他社の存在を漏らす。両キーとも**その行の列の値**だけで
 *    決まり、母集団の大きさに依存しない。
 * 索引は `@@index([tenantId, updatedAt])`（docs/05 §4.6 / schema.prisma）。
 */
export const ENGINEER_LIST_ORDER_BY = [{ updatedAt: 'desc' }, { id: 'desc' }] as const;

/**
 * 🔴 「通勤可能」と見なすリモート可否。
 *
 * **フルリモート可だけ**である。`PARTIAL_REMOTE`（一部リモート可）は出社を伴うので、
 * 勤務地が違えば通勤の問題は残る（`ONSITE_ONLY` は言うまでもない）。
 */
const COMMUTABLE_REMOTE_MODE: RemoteMode = 'FULL_REMOTE';

/**
 * ソフト条件 1 つ分。`match`（適合）と `miss`（不適合）を**両方**明示的に持つ。
 *
 * 🔴 **`miss` を `NOT: match` で作らない。** SQL の三値論理では `NOT (available_from <= X)` は
 *    `available_from IS NULL` の行に対して NULL（＝ 偽）になり、**その行がどちらのバケットにも
 *    入らない ＝ 一覧から消える**。Prisma の `NOT` が nullable 列をどう展開するかはバージョン
 *    依存でもある。`match` と `miss` が**母集団を過不足なく 2 分する**ことは実装で保証し、
 *    `tests/isolation/engineers.test.ts` が「チェックボックスがオフなら 1 件も消えない」で固定する。
 */
type SoftCondition = {
  readonly match: EngineerWhereFragment;
  readonly miss: EngineerWhereFragment;
};

/**
 * 稼働可能時期（`availableBy`）— 「この日までに稼働できるか」。
 *
 * 🔴 **稼働可能時期が未設定（NULL）の人材は「間に合う」と断定できないので不適合**とする。
 *    単価レンジの NULL（＝ その端の希望が無い ＝ **制約なし**）とは意味が違う ——
 *    こちらは**値そのものが不明**であり、「未設定だから何でも一致する」とすると
 *    「間に合う人だけ」（チェックボックス）の約束が守られない。
 *    🔴 既定（チェックボックスがオフ）では**一覧から消えず**、後ろに並ぶだけである。
 */
function inTimeCondition(availableBy: string): SoftCondition {
  const limit = toDateOnly(availableBy);
  return {
    match: { availableFrom: { lte: limit } },
    miss: { OR: [{ availableFrom: null }, { availableFrom: { gt: limit } }] },
  };
}

/**
 * 勤務地（`prefecture`）— 「通勤できるか」。
 *
 * 🔴 **勤務地が一致する、または フルリモート可**（`COMMUTABLE_REMOTE_MODE`）。フルリモートの
 *    人材は通勤しないので、勤務地の不一致は障害にならない。
 * 🔴 勤務地が未設定（NULL）の人材は、フルリモート可でない限り不適合とする（上と同じ理由）。
 */
function commutableCondition(prefecture: PrefectureCode): SoftCondition {
  return {
    match: { OR: [{ prefecture }, { remoteMode: COMMUTABLE_REMOTE_MODE }] },
    miss: {
      AND: [
        { OR: [{ prefecture: null }, { prefecture: { not: prefecture } }] },
        { OR: [{ remoteMode: null }, { remoteMode: { not: COMMUTABLE_REMOTE_MODE } }] },
      ],
    },
  };
}

/**
 * スキルと経験年数（`docs/02` `F-009` 入力「スキル（複数・AND / OR）」「経験年数」）。
 *
 * 🔴 **1 人あたりの経験年数の集約は「登録されたスキルの経験年数の最大値」である**
 *    （docs/05 §6.4「#15 の実装の決着（T-06-04）」で決着。`S-005` の結果テーブルと `S-006` の
 *    基本情報が「定義が未確定」を理由に保留していたもの）。合計は並行して使ったスキルを
 *    二重に数え（1 年のスキルを 10 個持つ人が「10 年」になる）、平均は**新しく覚えたスキルを
 *    足すほど下がる**（台帳を充実させるほど不利になり、更新の動機を削ぐ ＝ `docs/01` §1.1-1 の再発）。
 *
 * 🔴 **`yearsMin` はスキル条件と同じ 1 本の述語で評価する。** 「Java 5 年以上」を探した人に
 *    「COBOL 20 年 / Java 1 年」の候補を返さないためである。3 通りの見え方は**同じ規則の帰結**である:
 *      - `skills` を指定 + `AND` … 指定した**各スキル**について「そのスキルを `yearsMin` 年以上」
 *      - `skills` を指定 + `OR`  … 指定したスキルの**いずれか**を「`yearsMin` 年以上」
 *      - `skills` 未指定        … **いずれかのスキル**を「`yearsMin` 年以上」
 *        ＝ **最大値 ≧ `yearsMin`**（上の集約の定義と一致する）
 * 🔴 `engineer_skills` にも同じ RLS（C3 + 継承トリガ。docs/05 §4.4.1）が効くため、
 *    関連の副問い合わせから他社の行に到達することはない。
 */
export function engineerSkillConditions(query: EngineerListQuery): EngineerWhereFragment[] {
  const years =
    query.yearsMin === undefined ? {} : { yearsOfExperience: { gte: query.yearsMin } as const };
  const skills = query.skills ?? [];

  if (skills.length === 0) {
    // 経験年数だけの指定は「いずれかのスキルがその年数以上」＝ 集約（最大値）の下限。
    return query.yearsMin === undefined ? [] : [{ engineerSkills: { some: { ...years } } }];
  }
  if (query.skillMode === 'OR') {
    return [{ engineerSkills: { some: { skillId: { in: [...skills] }, ...years } } }];
  }
  // AND: スキルごとに「そのスキルを持つ（かつ年数を満たす）」を重ねる。
  return skills.map((skillId) => ({ engineerSkills: { some: { skillId, ...years } } }));
}

/**
 * 単価レンジの**重なり**（`docs/04` §S-005 / §S-010 の「単価レンジ」条件）。
 *
 * 🔴 **この定義は `#25`（案件検索）と共有する**（T-06-03 が「人材側と同じ定義を 2 か所で
 *    別々に決めない」として先送りした申し送り。docs/05 §6.4「#25 の実装の決着」）。
 *
 * 検索レンジ `[priceMin, priceMax]`（指定しなかった端は無限）と、台帳のレンジ
 * `[unitPriceMin, unitPriceMax]` が**重なる**ことを、独立した 2 つの述語の AND で表す:
 *   - `priceMax` 指定 … 台帳の**下限**がそれ以下（下限が高すぎる人材を外す）
 *   - `priceMin` 指定 … 台帳の**上限**がそれ以上（上限が低すぎる人材を外す）
 *
 * 🔴 **レンジの端の NULL は「制約なし（無限）」として扱う**（＝ 一致する側に倒す）。
 *    `unit_price_min IS NULL` は「下限の希望が無い」であって「該当しない」ではない。
 *    NULL を不一致に倒すと、**単価未登録の人材が単価で絞った瞬間に全員消える** ——
 *    `docs/01` §1.1-2「見えていない候補が増える」の再発であり、`docs/04` §S-005
 *    「なぜこの構成か」（フィルタで候補を消さない）にも反する。
 *    ⚠️ 稼働可能時期の NULL（`inTimeCondition`）を**不適合**に倒すのと向きが逆に見えるが、
 *    意味が違う: あちらは**値そのものが不明**、こちらは**レンジの端が無い ＝ 制約が無い**である。
 * 🔴 **`priceMin` と `priceMax` の大小関係を検証しない。** 片方だけの指定が正当な検索であり
 *    （「70 万円以下で探す」）、2 つは独立した述語として意味を持つ。加えて項目をまたぐ検証を
 *    トップレベルの `.refine()` で書くと `withApiRoute` の `assertBoundarySchema` が `.shape` を
 *    読めなくなる（`engineers/schemas.ts` 冒頭の制約）。
 */
export function engineerPriceConditions(query: EngineerListQuery): EngineerWhereFragment[] {
  const conditions: EngineerWhereFragment[] = [];
  if (query.priceMax !== undefined) {
    conditions.push({ OR: [{ unitPriceMin: null }, { unitPriceMin: { lte: query.priceMax } }] });
  }
  if (query.priceMin !== undefined) {
    conditions.push({ OR: [{ unitPriceMax: null }, { unitPriceMax: { gte: query.priceMin } }] });
  }
  return conditions;
}

/**
 * フリーワード（`docs/04` §S-005 の検索条件）。
 *
 * 🔴 探索先は **氏名（`display_name`）と 希望条件（`preference_note`）の 2 列だけ**である。
 *    連絡先・現所属会社名を検索対象にしない —— どちらも画面が出さない PII であり
 *    （docs/05 §6.4 #17 の決着）、**一致・不一致から値を推測できる経路**を作らないためである。
 * 🔴 `contains` は T-06-05 が差し替える seam である（本ファイル冒頭）。
 */
function freeWordCondition(q: string): EngineerWhereFragment {
  return {
    OR: [
      { displayName: { contains: q, mode: 'insensitive' } },
      { preferenceNote: { contains: q, mode: 'insensitive' } },
    ],
  };
}

/**
 * 🔴 有効なソフト条件（＝ **指定されていて、かつ対応するチェックボックスがオフ**のもの）。
 *
 * チェックボックスがオンのものは `where`（母集団）側へ移るので、ここには現れない
 * （＝ 母集団の全行がその条件を満たしており、適合の差にならない）。
 */
function softConditions(query: EngineerListQuery): SoftCondition[] {
  const conditions: SoftCondition[] = [];
  if (query.availableBy !== undefined && !query.onlyInTime) {
    conditions.push(inTimeCondition(query.availableBy));
  }
  if (query.prefecture !== undefined && !query.onlyCommutable) {
    conditions.push(commutableCondition(query.prefecture));
  }
  return conditions;
}

/**
 * 検索条件を評価するための計画。
 *
 * 🔴 **`where` が母集団であり、一覧と `COUNT` はこの 1 つの値を共有する**（docs/05 §4.8）。
 *    `fit` / `miss` は `where` を**過不足なく 2 分する**ので、`COUNT(where)` は
 *    2 つのバケットの合計と必ず一致する（＝ 並びの都合で件数が変わらない）。
 */
export type EngineerSearchPlan = {
  /** 母集団（検索条件 + チェックボックスがオンのソフト条件）。 */
  readonly where: EngineerWhereFragment;
  /** 🔴 並びの第 1 キー（適合）。`null` なら適合の差が無い ＝ 分割しない。 */
  readonly fit: EngineerWhereFragment | null;
  /** 🔴 `fit` の補集合。`fit` が `null` なら `null`。 */
  readonly miss: EngineerWhereFragment | null;
};

/**
 * `GET /api/engineers`（#15）の検索条件 → 述語（`F-009` の入力）。**唯一の入口**である。
 *
 * 🔴 条件を 1 つも指定しなければ `where` は `{}`（＝ 母集団そのもの）、`fit` は `null` になり、
 *    T-05-09 の骨格と**完全に同じ挙動**になる（既定の見え方を変えない）。
 */
export function engineerSearchPlan(query: EngineerListQuery): EngineerSearchPlan {
  const softs = softConditions(query);

  const and: EngineerWhereFragment[] = [
    ...engineerSkillConditions(query),
    ...engineerPriceConditions(query),
  ];
  // 🔴 チェックボックスがオンのソフト条件は**母集団を絞る**（`F-009 AC-5` の「オンのとき」）。
  if (query.availableBy !== undefined && query.onlyInTime) {
    and.push(inTimeCondition(query.availableBy).match);
  }
  if (query.prefecture !== undefined && query.onlyCommutable) {
    and.push(commutableCondition(query.prefecture).match);
  }
  if (query.q !== undefined) and.push(freeWordCondition(query.q));

  const where: EngineerWhereFragment = {
    ...(query.availability === undefined ? {} : { availability: query.availability }),
    // 🔴 リモート可否は**ハード条件**である。`docs/02` A-03 が「減点 + 明示的なフィルタ」で
    //    扱うと定めたのは**勤務地の不一致**であり、「フルリモート可の人を探す」は
    //    利用者が明示的に選んだ絞り込みそのものである（`commutableCondition` が
    //    フルリモートを救済に使うのとは役割が違う）。
    ...(query.remote === undefined ? {} : { remoteMode: query.remote }),
    ...(and.length === 0 ? {} : { AND: and }),
  };

  if (softs.length === 0) return { where, fit: null, miss: null };
  return {
    where,
    fit: { AND: softs.map((condition) => condition.match) },
    // 🔴 ド・モルガン: 「すべて満たす」の否定は「どれか 1 つを満たさない」。
    miss: { OR: softs.map((condition) => condition.miss) },
  };
}
