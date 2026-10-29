import { parseProjectKeywordGroups, type ProjectKeywordGroup } from '@ses/domain';
// packages/db/src/search/projects.ts
// 案件の検索と既定の並び（`GET /api/projects`。docs/05 §6.4 #25 / `F-015` / `S-010`）。
// T-06-03 → 🔴 T-06-05 で `apps/web/lib/projects/list.ts` から**検索に相当する部分だけ**を
// ここへ移した（docs/05 TBD-8 / SP-06 T-06-05）。
//
// 🔴 **移したもの / 移していないもの**（T-06-05 の射程。`tests/static/search-sql-single-path.test.ts`
//    の冒頭に同じ定義がある）:
//      移した   … 検索条件 → 述語（特に**フリーワード**）、決定的な `ORDER BY` の定義とその自己検査
//      移さない … 一覧の `select` する列 / `count` の呼び出し / カーソルページング / 応答型の組み立て
//    理由: `docs/03` §3.7.3 の代替（段階 1〜4。最終的に OpenSearch）で**差し替わるのは前者だけ**
//    である。後者まで `packages/db` へ引き取ると、応答型（`HostProjectView` / `PartnerProjectView`）と
//    その射影の判断（`F-013 AC-2`）まで DB パッケージに移ってしまい、**射影の議論の置き場所が
//    2 つになる**。
//
// ============================================================================
// 🔴 ここに境界の条件を 1 つも書かない（`F-015 AC-1` / `F-014 AC-1` / `CLAUDE.md` §3.1）
// ============================================================================
// `projects` の RLS は **C4 VISIBILITY**（docs/05 §4.4 / migration 20260903050000）であり、
//   - ホスト文脈:     `tenant_id = app_tenant_id()` の全件
//   - パートナー文脈: **自社宛の `project_visibilities` の行が生きている案件だけ**
// が見える。したがって本モジュールの述語に `tenantId` / `partnerCompanyId` / `visibilities` は
// 1 度も現れない（`projects.test.ts` が文字列として数える）。
import type { PrefectureCode } from '@ses/domain';
import { toDateOnly } from '../date-only.js';
import {
  PROJECT_STATUSES,
  type ProjectCategory,
  type ProjectSourceKind,
  type ProjectStatus,
  type RemoteMode,
} from '../schema-value-sets.js';
import { freeWordAllOf, freeWordFilter, type FreeWordFilter } from './free-word.js';
import { unitPriceOverlapConditions } from './unit-price-range.js';

/**
 * 本モジュールが組み立てる述語の形（Prisma の `ProjectWhereInput` の部分集合）。
 * 🔴 **列名を型で固定する**（`EngineerWhereFragment` と同じ理由）。とりわけ
 *    `endClientName` / `internalUnitPrice`（商流情報）を**型として持たない** —— 検索対象に
 *    したくなった実装がコンパイルで落ちる（`F-013 AC-2` / 下記 `projectSearchWhere` の 🔴）。
 */
export type ProjectWhereFragment = {
  status?: ProjectStatus;
  /** ✅ 2026-10-16: 上端（`lt`。開始時期の区分で使う。`start-window.ts`）。 */
  startDate?: { gte?: Date; lt?: Date };
  prefecture?: PrefectureCode;
  /** ✅ 2026-10-16: 稼働形態（`RemoteMode` の 3 値）。🔴 **未設定（null）の案件は一致しない** */
  remoteMode?: RemoteMode;
  /** ✅ 2026-10-16（Issue #113 + 受領モック）: カテゴリ / 案件区分 / 並行可否。 */
  category?: ProjectCategory;
  sourceKind?: ProjectSourceKind;
  parallelOk?: boolean;
  name?: FreeWordFilter;
  publicSummary?: FreeWordFilter;
  /**
   * ✅ 2026-10-15: 単価レンジ（**外部公開用**の `unit_price_min` / `unit_price_max`）。
   * 🔴 **`internalUnitPrice`（内部限定の販売単価）はこの型に無い**（上の 🔴）。
   */
  unitPriceMin?: null | { lte: number };
  unitPriceMax?: null | { gte: number };
  /**
   * ✅✅ **2026-10-16（人間の明示指示「スキル（リストから複数選択できる、or 検索）」）。**
   *
   * 🔴 **`project_requirements` への `some` である**（1 件でも一致すれば案件が残る = **OR**）。
   *    `every` / `none` を置かない —— AND で絞りたくなった実装がここに現れないよう、
   *    **型として `some` しか持たない**。
   * 🔴 **`kind` を見ない** —— 必須（`MUST`）と尚可（`NICE`）の**どちらで一致してもよい**。
   *    営業が「Java の案件」を探すとき、Java が尚可要件の案件を落とすのは期待と違う
   *    （区分は一覧の `必須要件の要約` 列と詳細で読む）。
   * 🔴 **境界の条件ではない。** `project_requirements` にも `projects` と同じ C4 が効く
   *    （migration 20260903050000 の `project_requirements_c4_select`）ので、
   *    パートナー文脈では**自社に公開された案件の要件しか結合されない**。
   */
  requirements?: { some: { skillId?: { in: string[] }; OR?: { freeText?: FreeWordFilter; skill?: { name: FreeWordFilter } }[] } };
  publicMemo?: FreeWordFilter;
  remarks?: FreeWordFilter;
  developmentPhases?: { hasSome: string[] };
  developmentMethod?: string;
  utilizationRate?: { gte?: number; lte?: number };
  OR?: ProjectWhereFragment[];
  /**
   * 🔴 **単価レンジの 2 条件はここに入る**（`OR` ではなく `AND`）。フリーワードが
   *    トップレベルの `OR` を使っており、畳むと**フリーワードが静かに消える**
   *    （`unit-price-range.ts` の 🔴）。
   */
  AND?: ProjectWhereFragment[];
};

/**
 * `GET /api/projects`（#25）の検索条件。
 *
 * 🔴 API 境界の Zod スキーマ（`apps/web/lib/projects/schemas.ts` の `ProjectListQuery`）が
 *    この型に構造的に適合する（`EngineerSearchCriteria` と同じ契約の結び方）。
 */
export type ProjectSearchCriteria = {
  readonly developmentPhases?: readonly string[];
  readonly developmentMethod?: string;
  readonly utilizationMin?: number;
  readonly utilizationMax?: number;
  readonly keywordGroups?: string;
  /** 認証文脈からだけ指定する。リクエストから受け取らない。 */
  readonly searchInternalRemarks?: boolean;
  readonly status?: ProjectStatus;
  /** 開始日が**この日以降**（`YYYY-MM-DD`）。 */
  readonly startFrom?: string;
  /**
   * ✅ 2026-10-16: 開始日が**この日より前**（`YYYY-MM-DD`。🔴 **この日を含まない**）。
   * 区分（即日 / 今月 / 来月 / 再来月以降）から `resolveStartWindow` が組み立てる。
   */
  readonly startTo?: string;
  readonly prefecture?: PrefectureCode;
  readonly q?: string;
  /**
   * ✅ 2026-10-15: 単価レンジ（月額・円）。**人材検索（`#15`）と同じ名前・同じ意味**である
   * （`unitPriceOverlapConditions`）。🔴 **2 画面で重なりの定義を別々に決めない。**
   */
  readonly priceMin?: number;
  readonly priceMax?: number;
  /**
   * ✅ **2026-10-16（人間の明示指示「稼働形態」）: `RemoteMode` の 3 値。**
   *
   * 🔴 **値集合は `@ses/db` の `REMOTE_MODES` を再利用する**（人間の指示は 4 値
   *    〔フルリモート / リモート中心 / ハイブリッド / 常駐〕だったが、**列の値集合は 3 値**で
   *    あり、4 値に割るのは DB の値集合の変更にあたる = [Issue #113](https://github.com/Festal-KM/SES-Platform/issues/113)
   *    「設計から改訂して」の範囲である。**画面に無い選択肢を作らない**ほうを採った）。
   * 🔴 **未設定（`remote_mode IS NULL`）の案件は一致しない** —— 等値の述語であり、
   *    絞り込みを掛けたときだけ落ちる（`prefecture` と同じ挙動。既定では全件が出る）。
   */
  readonly remoteMode?: RemoteMode;
  /**
   * ✅✅ **2026-10-16（受領モックの絞り込み 2〜3 行目。[Issue #113](https://github.com/Festal-KM/SES-Platform/issues/113)
   *    「設計から改訂して」が列を足す承認である）: カテゴリ / 案件区分 / 並行可否。**
   *
   * 🔴 **いずれも等値で絞る。** `category` / `parallelOk` は `null` を許す列であり、
   *    **絞り込みを掛けると未設定の案件は落ちる**（`prefecture` / `remoteMode` と同じ挙動）。
   * 🔴 **`sourceKind` は「どこから来た案件か」の分類であって所有者ではない** ——
   *    述語は母集団の中を絞るだけで、`CLAUDE.md` §3.1 の境界には 1 ミリも触れない。
   */
  readonly category?: ProjectCategory;
  readonly sourceKind?: ProjectSourceKind;
  readonly parallelOk?: boolean;
  /**
   * ✅✅ **2026-10-16（人間の明示指示「スキル（リストから複数選択できる、or 検索）」）。**
   *
   * 🔴 **OR である** —— 指定したスキルの**いずれか**を要件に持つ案件が残る。選んだ全部を
   *    満たす案件（AND）に絞ると、2 つ選んだ瞬間にほぼ 0 件になり、使えない絞り込みになる。
   * 🔴 **グローバル辞書（`Skill`）の ID** である（`F-010`）。ここで名前を照合しない ——
   *    表記ゆれの吸収は `SkillAlias` の仕事であり、検索の述語に 2 本目の正規化を作らない。
   * 🔴 **空配列を渡さない**（呼び出し側が `undefined` に畳む）。`{ in: [] }` は**常に偽**なので、
   *    「スキルを 1 つも選んでいない」が**全件 0 件**になる。
   */
  readonly skills?: readonly string[];
  /**
   * ✅ **2026-10-16（人間の明示指示「チェックボックス『募集中のみ』。ON で ステータス = 募集中に
   *    絞る（ステータスセレクトと併用時は AND）」）。**
   *
   * 🔴 **`status` と独立した述語として `AND` に積む。** 併用して矛盾したとき
   *    （`status=CLOSED` かつ `recruitingOnly`）は**0 件になるのが正しい** ——
   *    どちらかを黙って優先すると、利用者が指定した条件と違う結果が出る。
   */
  readonly recruitingOnly?: boolean;
};

/**
 * 🔴 **既定の並びの第 1 キー**（`docs/04` §S-010 状態バッジ「`後任募集` は `F-045` の還流で
 *    自動生成される。**既定の並びで上位に置く**（放置すると還流が無意味になる）」）。
 *
 * `CLAUDE.md` §1.3 の「⑥ → ① の還流がこのプロダクトの中核」を一覧の既定の見え方で担保する。
 * 🔴 実装は `ORDER BY status DESC` である（`PROJECT_LIST_ORDER_BY`）。`CASE` 式で優先度を
 *    書くには raw SQL が要り、「検索の実装を `packages/db/src/search/**` の 1 箇所に閉じる」
 *    （SP-06 T-06-05 / docs/05 TBD-8）と衝突するためこの形を採った。
 * 🔴 したがって**値の綴りに順序が依存している**。依存を偶然のままにせず、本モジュールの
 *    読み込み時に「降順に並べた `PROJECT_STATUSES` がこの優先順位と一致すること」を検査する
 *    （`assertStatusPriority`）。状態を増やすと**その場で落ちる**ので、気づかないまま
 *    後任募集が沈むことはない。DB 側（照合順序）での実際の並びは
 *    `tests/isolation/projects.test.ts` が実データで固定する。
 */
export const PROJECT_STATUS_LIST_PRIORITY: readonly ProjectStatus[] = [
  // ✅✅ **2026-10-16（[Issue #98](https://github.com/Festal-KM/SES-Platform/issues/98) の回答
  //    「募集中と終了の二つだけでよい」）: 3 値 → 2 値。**
  // 🔴 **`ORDER BY status DESC` に依存した形はそのまま成立する** —— 降順に並べると
  //    `'OPEN' > 'CLOSED'` であり、**募集中が先・終了が後**という欲しい順になる
  //    （下の `assertStatusPriority` が読み込み時に照合する）。
  'OPEN',
  'CLOSED',
];

/**
 * 🔴 既定の並び（`F-015 AC-3`「同一条件・同一データで並び順が常に同じ」/ docs/05 §4.8）。
 *
 *   ①`status` 降順   … 後任募集 → 募集中 → 充足（`docs/04` §S-010。上記）
 *   ②`updated_at` 降順 … `F-015` 処理③「更新日時」
 *   ③`start_date` 昇順（NULL 最後）… 同処理③「開始日」。同じ更新時刻の案件は開始日の近い順
 *   ④`id` 降順        … `uuid(7)` は時系列で単調増加するので、ここで順序が**一意**に決まる
 *
 * 🔴 **`ORDER BY` に「全体件数」「順位」を持ち込まない**（docs/05 §4.8）。境界外の行の有無で
 *    順位が動くと、並び順そのものが他社の存在を漏らす。①〜④はすべて**その行の列の値**だけで
 *    決まり、母集団の大きさに依存しない。
 * 🔴 スコア・重みの概念を持たない（`F-009 AC-2` と同じ Phase 1 の規律。スコアは `F-029`）。
 * 🔴 索引は `projects_tenant_id_status_updated_at_start_date_id_idx`（T-06-05。
 *    migration `20260912000000_search_indexes`）。**`tenant_id` が先頭列**であり、
 *    ②〜④の向き（`DESC` / `DESC` / `ASC NULLS LAST` / `DESC`）まで索引の定義と一致させてある
 *    —— 一致していないと `ORDER BY` がソートに落ち、1 万件で p95 1 秒（`F-015 AC-2`）に届かない。
 */
export const PROJECT_LIST_ORDER_BY = [
  { status: 'desc' },
  { updatedAt: 'desc' },
  { startDate: { sort: 'asc', nulls: 'last' } },
  { id: 'desc' },
] as const;

/**
 * 🔴 **`ORDER BY status DESC` が `PROJECT_STATUS_LIST_PRIORITY` を与えることの検査。**
 *
 * 🔴 照合するのは**値集合の出所（`PROJECT_STATUSES`）**であって、優先順位の配列自身ではない。
 *    自身と照合すると「この配列が綴りの降順に並んでいる」ことしか言えず、
 *    **`PROJECT_STATUSES` に状態が増えても落ちない**（優先順位の側が古いまま残り、
 *    新しい状態が `後任募集` より上に来ても気づけない）。
 * 🔴 読み込み時に落とす（`assertNoIsolationKeys` と同じ形）。テストだけに置くと、
 *    状態を足した変更が「テストを直せば通る」ものに見えてしまう。
 * 🔴 これで**値集合の増減と並び替えの両方**が起動時に検出される。
 * ⚠️ export しているのは、**検査そのものが実際に落ちること**をユニットテストで示すためである。
 */
export function assertStatusPriority(priority: readonly ProjectStatus[]): void {
  // DB は `status` を値の綴りで並べる。その降順が優先順位そのものでなければならない。
  const byDescendingValue = [...PROJECT_STATUSES].sort().reverse();
  if (byDescendingValue.join(',') !== priority.join(',')) {
    throw new Error(
      '案件一覧の既定の並び（ORDER BY status DESC）が PROJECT_STATUS_LIST_PRIORITY と一致しません' +
        `（期待: ${byDescendingValue.join(',')} / 宣言: ${priority.join(',')}）。` +
        '状態を追加・改名したときは docs/04 §S-010 の「後任募集を上位に置く」を満たす手段を' +
        '選び直してください（CLAUDE.md §8.6 / §8.7）。',
    );
  }
}

assertStatusPriority(PROJECT_STATUS_LIST_PRIORITY);

/**
 * 🔴 フリーワードの対象列（`docs/04` §S-010 の検索条件）。
 *
 * 🔴 **`end_client_name` を検索対象にしない** —— ホストだけが一致する検索を作ると、`where` が
 *    ロールで分岐して「一覧と `COUNT` が同じ述語」という担保（docs/05 §4.8）が崩れる
 *    （`F-013 AC-2` の趣旨にも反する）。`ProjectWhereFragment` に列自体を持たせていない。
 * 🔴 フリーワードは索引で加速されない（`free-word.ts` 冒頭の実測）。母集団は RLS の C4 が
 *    テナント / 公開範囲で絞っており、その中を走査する。
 */
const PROJECT_FREE_WORD_COLUMNS = ['name', 'publicSummary'] as const;

/**
 * ✅ **2026-10-16: 「募集中のみ」が指す状態**（人間の明示指示のチェックボックス）。
 *
 * 🔴 **`'OPEN'` を直書きしない。** 状態の値集合は 2026-10-16 に 3 値から 2 値へ変わった
 *    （[Issue #98](https://github.com/Festal-KM/SES-Platform/issues/98)）。綴りを散らすと、
 *    次に値集合が動いたときに**ここだけ古いまま静かに 0 件を返す**。
 * 🔴 `PROJECT_STATUSES` の**先頭が募集中である**ことに依存しない —— 綴りで引き、
 *    値集合に無くなったら**その場で型エラーになる**形にしておく。
 */
const RECRUITING_STATUS: ProjectStatus = 'OPEN';

/**
 * 🔴 **検索条件 → 述語（`F-015` の入力）。これが一覧と `COUNT` の唯一の `where` である。**
 *
 * 🔴 ここに境界の条件を書かない（本ファイル冒頭）。返す述語はすべて**業務上の絞り込み**であり、
 *    条件が 1 つも指定されなければ `{}`（= 母集団そのもの）になる。
 * 🔴 **ソフト条件（適合による分割）を持たない。** `docs/02` A-03 が「減点 + 明示的なフィルタ」で
 *    扱うと定めた 2 項目（稼働可能時期 / 勤務地）は**人材側の条件**であり、案件検索には現れない。
 *    したがって `#25` は `SearchPlan` の形を採らず、単一の述語を返す（`plan.ts` の 🔴）。
 */
export function projectSearchWhere(criteria: ProjectSearchCriteria): ProjectWhereFragment {
  // ============================================================================
  // ✅ **2026-10-16: `AND` の配列 1 本に集約した**（人間の明示指示で条件が 3 つ増えたため）
  // ============================================================================
  // 🔴 **トップレベルに `OR` を置くのをやめた。** 以前はフリーワードが `{ OR: [...] }` を
  //    トップレベルに広げており、**`OR` を使う条件が 2 つ目になった瞬間に片方が静かに消える**
  //    形だった（オブジェクトの同じキーは後から書いたほうが勝つ）。複数語の AND
  //    （`freeWordAllOf`）は語ごとに `OR` を作るので、**まさにその 2 つ目が現れた。**
  // 🔴 したがって **`OR` を作る条件はすべて `AND` の要素として積む**。等値の条件
  //    （`status` / `prefecture` / `remoteMode`）はキーが衝突しないのでトップレベルに置く。
  const and: ProjectWhereFragment[] = [
    // ✅ 2026-10-15: 単価レンジ。🔴 **述語の定義は `unit-price-range.ts` の 1 本**であり、
    //    人材検索（`#15`）と同じものを通る（T-06-03 の申し送りの決着）。
    ...unitPriceOverlapConditions(criteria),
  ];
  const keywordCondition = (term: string): ProjectWhereFragment => ({ OR: [
    { name: freeWordFilter(term) }, { publicSummary: freeWordFilter(term) },
    { publicMemo: freeWordFilter(term) },
    { requirements: { some: { OR: [{ freeText: freeWordFilter(term) }, { skill: { name: freeWordFilter(term) } }] } } },
    ...(criteria.searchInternalRemarks === true ? [{ remarks: freeWordFilter(term) }] : []),
  ] });
  const groups: ProjectKeywordGroup[] = criteria.keywordGroups ? [...(parseProjectKeywordGroups(JSON.parse(criteria.keywordGroups)) ?? [])] : [];
  if (criteria.q?.includes('|')) groups.unshift({ mode: 'OR', terms: criteria.q.split('|').map(term => term.trim()).filter(Boolean) });
  for (const group of groups) {
    const terms = group.terms.map(term => term.trim()).filter(Boolean);
    if (terms.length) and.push(group.mode === 'AND' ? { AND: terms.map(keywordCondition) } : { OR: terms.map(keywordCondition) });
  }
  // 従来の空白区切りANDも、新しい検索対象で一貫して照合する。
  if (criteria.q !== undefined && !criteria.q.includes('|')) {
    const words = freeWordAllOf(criteria.q, PROJECT_FREE_WORD_COLUMNS);
    if (words) and.push(...words.AND.map(condition => keywordCondition(condition.OR[0]?.name?.contains ?? '')));
  }
  if (criteria.recruitingOnly === true) {
    // 🔴 `status` と独立に積む（併用して矛盾したら 0 件が正しい。`recruitingOnly` の 🔴）。
    and.push({ status: RECRUITING_STATUS });
  }
  // ✅✅ **2026-10-16: スキル（複数選択 / OR）。**
  // 🔴 **空配列は述語を積まない。** `{ in: [] }` は常に偽であり、1 つも選んでいない状態が
  //    **全件 0 件**になる（`ProjectSearchCriteria.skills` の 🔴）。境界側（Zod）でも
  //    空を `undefined` に畳んでいるが、**述語の側でも落ちないようにしておく**
  //    （この関数は API 以外の呼び手からも使われる）。
  if (criteria.skills !== undefined && criteria.skills.length > 0) {
    // 🔴 `AND` に積む（トップレベルに置くとフリーワードの `AND` と同じキーで衝突する
    //    …… ことは無いが、**`OR` を内包する条件はすべて `AND` の要素として積む**という
    //    この関数の規律に合わせる。`some` + `in` は 1 つの要素で OR を表せる）。
    and.push({ requirements: { some: { skillId: { in: [...criteria.skills] } } } });
  }
  return {
    ...(and.length === 0 ? {} : { AND: and }),
    ...(criteria.developmentPhases?.length ? { developmentPhases: { hasSome: [...criteria.developmentPhases] } } : {}),
    ...(criteria.developmentMethod === undefined ? {} : { developmentMethod: criteria.developmentMethod }),
    ...(criteria.utilizationMin === undefined && criteria.utilizationMax === undefined ? {} : { utilizationRate: { ...(criteria.utilizationMin === undefined ? {} : { gte: criteria.utilizationMin }), ...(criteria.utilizationMax === undefined ? {} : { lte: criteria.utilizationMax }) } }),
    ...(criteria.status === undefined ? {} : { status: criteria.status }),
    // 🔴 `start_date` が未設定の案件は「開始日 X 以降」に一致しない（NULL は比較で偽）。
    //    絞り込みを掛けたときだけ落ちる挙動であり、既定（未指定）では全件が出る。
    // ✅ 2026-10-16: 下端と上端を 1 つの `startDate` に畳む（両方が来るのが「今月」「来月」）。
    ...(criteria.startFrom === undefined && criteria.startTo === undefined
      ? {}
      : {
          startDate: {
            ...(criteria.startFrom === undefined ? {} : { gte: toDateOnly(criteria.startFrom) }),
            ...(criteria.startTo === undefined ? {} : { lt: toDateOnly(criteria.startTo) }),
          },
        }),
    ...(criteria.prefecture === undefined ? {} : { prefecture: criteria.prefecture }),
    ...(criteria.remoteMode === undefined ? {} : { remoteMode: criteria.remoteMode }),
    // ✅ 2026-10-16（Issue #113 + 受領モック）。🔴 等値のキーなので衝突しない（トップレベルでよい）。
    ...(criteria.category === undefined ? {} : { category: criteria.category }),
    ...(criteria.sourceKind === undefined ? {} : { sourceKind: criteria.sourceKind }),
    ...(criteria.parallelOk === undefined ? {} : { parallelOk: criteria.parallelOk }),
  };
}
