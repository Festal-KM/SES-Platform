// packages/db/src/search/engineers.ts
// エンジニアの複合検索（`GET /api/engineers`。docs/05 §6.4 #15 / `F-009` / `S-005`）の
// **検索条件の評価と決定的順序**。T-06-04 → 🔴 T-06-05 で `apps/web/lib/engineers/search.ts`
// から**そのままここへ移した**（docs/05 TBD-8 / SP-06 T-06-05 の完了条件）。
//
// ============================================================================
// 🔴 ここに境界の条件を 1 つも書かない（`F-009 AC-3` / `BR-56` / `CLAUDE.md` §3.1）
// ============================================================================
// `engineers` の RLS は C3 OWNER_SCOPED であり、母集団はそれだけが決める。本モジュールが返す
// 述語は**すべて業務上の絞り込み**であり、`tenant_id` / `partner_company_id` /
// `owner_partner_company_id` は 1 度も現れない（`engineers.test.ts` が文字列として数える）。
// 🔴 **`packages/db` に置いても意味は変わらない。** ここは「検索の実装の置き場所」であって
//    「境界の実装の置き場所」ではない（境界は RLS と `withTenant` / `scope-injection` が持つ）。
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
//    チェックボックスがオン）は**適合の差が生じない**ので、`buckets` は 1 要素になり、
//    並びは `updated_at` 降順 → `id` 降順だけになる（T-05-09 の既定順序と完全に同じ）。
import type { PrefectureCode } from '@ses/domain';
import { toDateOnly } from '../date-only.js';
import type { EngineerAvailability, RemoteMode } from '../schema-value-sets.js';
import { freeWordOr, type FreeWordFilter } from './free-word.js';
import type { SearchPlan, SoftCondition } from './plan.js';

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
  displayName?: FreeWordFilter;
  preferenceNote?: FreeWordFilter;
  AND?: EngineerWhereFragment[];
  OR?: EngineerWhereFragment[];
};

/**
 * スキル条件の組み合わせ（`docs/02` `F-009` 入力「スキル（複数・AND / OR）」）。
 * 🔴 **既定は `AND`**（`docs/02` / `docs/04` のいずれも `AND` を先に挙げている）。案件の必須要件から
 *    候補を探す業務では「指定したスキルをすべて持つ人」が既定の期待である。1 件しか指定しなければ
 *    `AND` と `OR` は同じ結果になるので、既定値が候補を隠す向きに働くのは複数指定時だけであり、
 *    そのときは画面の選択肢（`S-005`）で切り替えられる。
 * 🔴 T-06-05 で `apps/web/lib/engineers/schemas.ts` からここへ移した。値集合は**述語を組み立てる
 *    側が持つ**のが筋である（API 境界の Zod スキーマはこれを参照するだけ。
 *    `ENGINEER_AVAILABILITIES` などと同じ扱いになる）。
 */
export const ENGINEER_SKILL_MODES = ['AND', 'OR'] as const;

export type EngineerSkillMode = (typeof ENGINEER_SKILL_MODES)[number];

export const ENGINEER_SKILL_MODE_DEFAULT: EngineerSkillMode = 'AND';

/**
 * `GET /api/engineers`（#15）の検索条件。
 *
 * 🔴 **API 境界の Zod スキーマ（`apps/web/lib/engineers/schemas.ts` の `EngineerListQuery`）が
 *    この型に構造的に適合する**。`packages/db` から `apps/web` を import できない（`CLAUDE.md` §2.1）
 *    ため、契約は「型の形」で結ぶ。ずれたら `apps/web` 側の呼び出しがコンパイルで落ちる。
 * 🔴 ページング（`cursor` / `limit`）を含めない。**母集団と並びの話ではない**ためである。
 * 🔴 分離キー（`tenantId` / `partnerCompanyId` / `ownerPartnerCompanyId`）を持たない。
 */
export type EngineerSearchCriteria = {
  /** スキル（グローバル辞書 `Skill` の ID。複数可）。 */
  readonly skills?: readonly string[];
  readonly skillMode: EngineerSkillMode;
  /** 経験年数の下限（集約の定義は `engineerSkillConditions` の JSDoc）。 */
  readonly yearsMin?: number;
  readonly priceMin?: number;
  readonly priceMax?: number;
  /** 稼働可能時期（`YYYY-MM-DD`）。「この日までに稼働できる」。🔴 ソフト条件。 */
  readonly availableBy?: string;
  /** 勤務地（都道府県）。🔴 ソフト条件。 */
  readonly prefecture?: PrefectureCode;
  /** リモート可否。🔴 こちらは**ハード条件**である（下記）。 */
  readonly remote?: RemoteMode;
  readonly availability?: EngineerAvailability;
  /** フリーワード。 */
  readonly q?: string;
  /** 🔴 既定オフ（`F-009 AC-5`）。「開始日に間に合う人だけ」。 */
  readonly onlyInTime: boolean;
  /** 🔴 既定オフ（`F-009 AC-5`）。「通勤可能な人だけ」。 */
  readonly onlyCommutable: boolean;
};

/**
 * 🔴 **並びの第 2・第 3 キー**（第 1 キーは「適合」＝ `SearchPlan.buckets` の順序）。
 *
 * `updated_at` の降順 → `id` の降順。`id` は `uuid(7)`（時系列で単調増加）なので、同時刻の行でも
 * 順序が**一意**に決まる（`F-009 AC-1`「実行のたびに同じ並び順」）。
 * 🔴 **`ORDER BY` に「全体件数」「順位」「スコア」を持ち込まない**（docs/05 §4.8）。境界外の行の
 *    有無で順位が動くと、並び順そのものが他社の存在を漏らす。両キーとも**その行の列の値**だけで
 *    決まり、母集団の大きさに依存しない。
 * 🔴 索引は `@@index([tenantId, updatedAt(sort: Desc), id(sort: Desc)])`（T-06-05。
 *    migration `20260912000000_search_indexes`）。**`tenant_id` が先頭列**であり、RLS の
 *    `tenant_id = app_tenant_id()`（STABLE）が等値で枝刈りできる（`docs/03` §3.7.2 懸念 1）。
 * 🔴 SP-08 では、この配列が**自社スコープと共有スコープのマージ比較子の出所**になる
 *    （`plan.ts` の「第 2 軸」）。並びのキーを 2 箇所に書かないこと。
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
 * 🔴 フリーワードの対象列（`docs/04` §S-005 の検索条件）。
 *
 * 🔴 探索先は **氏名（`display_name`）と 希望条件（`preference_note`）の 2 列だけ**である。
 *    連絡先・現所属会社名を検索対象にしない —— どちらも画面が出さない PII であり
 *    （docs/05 §6.4 #17 の決着）、**一致・不一致から値を推測できる経路**を作らないためである。
 * 🔴 フリーワードは索引で加速されない（`free-word.ts` 冒頭の実測）。母集団は RLS の
 *    `tenant_id` 等値（索引条件）でテナント分に絞られており、その中を走査する。
 */
const ENGINEER_FREE_WORD_COLUMNS = ['displayName', 'preferenceNote'] as const;

/**
 * 稼働可能時期（`availableBy`）— 「この日までに稼働できるか」。
 *
 * 🔴 **稼働可能時期が未設定（NULL）の人材は「間に合う」と断定できないので不適合**とする。
 *    単価レンジの NULL（＝ その端の希望が無い ＝ **制約なし**）とは意味が違う ——
 *    こちらは**値そのものが不明**であり、「未設定だから何でも一致する」とすると
 *    「間に合う人だけ」（チェックボックス）の約束が守られない。
 *    🔴 既定（チェックボックスがオフ）では**一覧から消えず**、後ろに並ぶだけである。
 */
function inTimeCondition(availableBy: string): SoftCondition<EngineerWhereFragment> {
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
function commutableCondition(prefecture: PrefectureCode): SoftCondition<EngineerWhereFragment> {
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
 * 🔴 副問い合わせの索引は `@@index([tenantId, skillId, yearsOfExperience])`（`schema.prisma`）。
 *    **`tenant_id` が先頭列**である（`docs/03` §3.7.2 懸念 1）。
 */
export function engineerSkillConditions(
  criteria: EngineerSearchCriteria,
): EngineerWhereFragment[] {
  const years =
    criteria.yearsMin === undefined ? {} : { yearsOfExperience: { gte: criteria.yearsMin } as const };
  const skills = criteria.skills ?? [];

  if (skills.length === 0) {
    // 経験年数だけの指定は「いずれかのスキルがその年数以上」＝ 集約（最大値）の下限。
    return criteria.yearsMin === undefined ? [] : [{ engineerSkills: { some: { ...years } } }];
  }
  if (criteria.skillMode === 'OR') {
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
export function engineerPriceConditions(
  criteria: EngineerSearchCriteria,
): EngineerWhereFragment[] {
  const conditions: EngineerWhereFragment[] = [];
  if (criteria.priceMax !== undefined) {
    conditions.push({ OR: [{ unitPriceMin: null }, { unitPriceMin: { lte: criteria.priceMax } }] });
  }
  if (criteria.priceMin !== undefined) {
    conditions.push({ OR: [{ unitPriceMax: null }, { unitPriceMax: { gte: criteria.priceMin } }] });
  }
  return conditions;
}

/**
 * 🔴 有効なソフト条件（＝ **指定されていて、かつ対応するチェックボックスがオフ**のもの）。
 *
 * チェックボックスがオンのものは `where`（母集団）側へ移るので、ここには現れない
 * （＝ 母集団の全行がその条件を満たしており、適合の差にならない）。
 */
function softConditions(
  criteria: EngineerSearchCriteria,
): SoftCondition<EngineerWhereFragment>[] {
  const conditions: SoftCondition<EngineerWhereFragment>[] = [];
  if (criteria.availableBy !== undefined && !criteria.onlyInTime) {
    conditions.push(inTimeCondition(criteria.availableBy));
  }
  if (criteria.prefecture !== undefined && !criteria.onlyCommutable) {
    conditions.push(commutableCondition(criteria.prefecture));
  }
  return conditions;
}

/**
 * 🔴 **「並びの第 1 キー（適合）が効くか」の唯一の判定**（T-06-04 のレビュー申し送り 2 の解消）。
 *
 * `engineerSearchPlan`（母集団を分割するか）と画面（`S-005` の並び順の説明文を切り替えるか）は、
 * **同じ関数**を通る。条件式を 2 か所に書くと、「並びは分割したのに説明は分割前のまま」
 * （またはその逆）が静かに起きる —— 利用者から見れば**並び順の説明が嘘になる**。
 * 🔴 `engineerSearchPlan(criteria).buckets.length > 1` と必ず一致する
 *    （`engineers.test.ts` が両者の一致を固定する）。
 */
export function ordersByFit(criteria: EngineerSearchCriteria): boolean {
  return softConditions(criteria).length > 0;
}

/** `#15` の計画（`where` = 母集団 / `buckets` = 適合による分割。`plan.ts`）。 */
export type EngineerSearchPlan = SearchPlan<EngineerWhereFragment>;

/**
 * `GET /api/engineers`（#15）の検索条件 → 計画（`F-009` の入力）。**唯一の入口**である。
 *
 * 🔴 条件を 1 つも指定しなければ `where` は `{}`（＝ 母集団そのもの）、`buckets` は `[{}]` になり、
 *    T-05-09 の骨格と**完全に同じ挙動**になる（既定の見え方を変えない）。
 * 🔴 **「分割するかどうか」を決めるのはこの関数だけ**である（`plan.ts` の 🔴）。読み出し側は
 *    `buckets` を先頭から読むだけで、適合の判定を持たない。
 */
export function engineerSearchPlan(criteria: EngineerSearchCriteria): EngineerSearchPlan {
  const softs = softConditions(criteria);

  const and: EngineerWhereFragment[] = [
    ...engineerSkillConditions(criteria),
    ...engineerPriceConditions(criteria),
  ];
  // 🔴 チェックボックスがオンのソフト条件は**母集団を絞る**（`F-009 AC-5` の「オンのとき」）。
  if (criteria.availableBy !== undefined && criteria.onlyInTime) {
    and.push(inTimeCondition(criteria.availableBy).match);
  }
  if (criteria.prefecture !== undefined && criteria.onlyCommutable) {
    and.push(commutableCondition(criteria.prefecture).match);
  }
  if (criteria.q !== undefined) and.push(freeWordOr(criteria.q, ENGINEER_FREE_WORD_COLUMNS));

  const where: EngineerWhereFragment = {
    ...(criteria.availability === undefined ? {} : { availability: criteria.availability }),
    // 🔴 リモート可否は**ハード条件**である。`docs/02` A-03 が「減点 + 明示的なフィルタ」で
    //    扱うと定めたのは**勤務地の不一致**であり、「フルリモート可の人を探す」は
    //    利用者が明示的に選んだ絞り込みそのものである（`commutableCondition` が
    //    フルリモートを救済に使うのとは役割が違う）。
    ...(criteria.remote === undefined ? {} : { remoteMode: criteria.remote }),
    ...(and.length === 0 ? {} : { AND: and }),
  };

  if (softs.length === 0) return { where, buckets: [where] };
  return {
    where,
    buckets: [
      // 適合: ソフト条件を**すべて**満たす。
      { AND: [where, { AND: softs.map((condition) => condition.match) }] },
      // 🔴 ド・モルガン: 「すべて満たす」の否定は「どれか 1 つを満たさない」。
      { AND: [where, { OR: softs.map((condition) => condition.miss) }] },
    ],
  };
}
