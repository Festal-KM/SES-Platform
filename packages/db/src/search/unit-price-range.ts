// packages/db/src/search/unit-price-range.ts
// 単価レンジの**重なり**（`docs/04` §S-005 の人材検索 / §S-010 の案件検索の「単価レンジ」条件）。
//
// ✅ **2026-10-15: `engineers.ts` から切り出した。** T-06-03 が「人材側と同じ定義を 2 か所で
//    別々に決めない」として先送りしていた申し送り（`docs/05` §6.4「#25 の実装の決着」）であり、
//    案件一覧（`#25`）に単価レンジの絞り込みを足した時点で**実際に 2 人目の呼び手が現れた**。
//    🔴 **述語の意味はこのファイル 1 本にしか無い。** 人材と案件で重なりの定義がずれると、
//    「人材検索では出るのに案件検索では出ない（またはその逆）」が利用者から説明不能になる。

/**
 * 単価レンジを持つ表の述語の形（`EngineerWhereFragment` / `ProjectWhereFragment` の共通部分）。
 *
 * 🔴 **列名は 2 つの表で同じである**（`engineers` / `projects` のいずれも
 *    `unit_price_min` / `unit_price_max` が**外部公開用**のレンジである）。案件側の
 *    `internal_unit_price`（商流情報）は**この型に現れない** —— 検索対象にしたくなった実装が
 *    コンパイルで落ちる（`CLAUDE.md` §3.1 経路 5 / `F-013 AC-2`）。
 */
export type UnitPriceRangeFragment = {
  unitPriceMin?: null | { lte: number };
  unitPriceMax?: null | { gte: number };
  OR?: UnitPriceRangeFragment[];
};

/** 検索レンジ（指定しなかった端は無限）。 */
export type UnitPriceRangeCriteria = {
  readonly priceMin?: number;
  readonly priceMax?: number;
};

/**
 * 検索レンジ `[priceMin, priceMax]`（指定しなかった端は無限）と、台帳・案件のレンジ
 * `[unitPriceMin, unitPriceMax]` が**重なる**ことを、独立した 2 つの述語の AND で表す:
 *   - `priceMax` 指定 … 相手の**下限**がそれ以下（下限が高すぎるものを外す）
 *   - `priceMin` 指定 … 相手の**上限**がそれ以上（上限が低すぎるものを外す）
 *
 * 🔴 **レンジの端の NULL は「制約なし（無限）」として扱う**（＝ 一致する側に倒す）。
 *    `unit_price_min IS NULL` は「下限の希望が無い」であって「該当しない」ではない。
 *    NULL を不一致に倒すと、**単価未登録の人材・案件が単価で絞った瞬間に全部消える** ——
 *    `docs/01` §1.1-2「見えていない候補が増える」の再発であり、`docs/04` §S-005
 *    「なぜこの構成か」（フィルタで候補を消さない）にも反する。
 *    ⚠️ 稼働可能時期の NULL（`inTimeCondition`）を**不適合**に倒すのと向きが逆に見えるが、
 *    意味が違う: あちらは**値そのものが不明**、こちらは**レンジの端が無い ＝ 制約が無い**である。
 * 🔴 **`priceMin` と `priceMax` の大小関係を検証しない。** 片方だけの指定が正当な検索であり
 *    （「70 万円以下で探す」）、2 つは独立した述語として意味を持つ。加えて項目をまたぐ検証を
 *    トップレベルの `.refine()` で書くと `withApiRoute` の `assertBoundarySchema` が `.shape` を
 *    読めなくなる（`engineers/schemas.ts` 冒頭の制約）。
 * 🔴 **返すのは「AND で重ねる条件の配列」である**（1 つの object に畳まない）。呼び手は
 *    フリーワード（`OR`）と衝突しない場所（`AND`）に置く —— 畳むと `OR` のキーが上書きされ、
 *    **フリーワードが静かに消える**。
 */
export function unitPriceOverlapConditions(
  criteria: UnitPriceRangeCriteria,
): UnitPriceRangeFragment[] {
  const conditions: UnitPriceRangeFragment[] = [];
  if (criteria.priceMax !== undefined) {
    conditions.push({ OR: [{ unitPriceMin: null }, { unitPriceMin: { lte: criteria.priceMax } }] });
  }
  if (criteria.priceMin !== undefined) {
    conditions.push({ OR: [{ unitPriceMax: null }, { unitPriceMax: { gte: criteria.priceMin } }] });
  }
  return conditions;
}

