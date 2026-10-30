// apps/web/lib/projects/list-rows.ts
// `S-010` 案件一覧・検索の表示値の組み立て（docs/04 §S-010）。T-06-03。
//
// 🔴 画面（`app/(main)/projects/**`）ではなくここに置く理由は `lib/engineers/list-rows.ts` /
//    `lib/projects/detail.ts` と同じである: `app/**` はユニットテストの対象外
//    （`vitest.config.ts` の注記）であり、「必須要件の要約の畳み方」「`未設定` / `N 社に公開中`
//    の書き分け」「検索条件を保ったページングのリンク」を固定できる場所が要る。
//    ここは **I/O を持たない純粋関数だけ**で、`@ses/db` にも Prisma にも触れない。
// 🔴 文言は `packages/i18n` が唯一の出所（`CLAUDE.md` §3.5）。本ファイルは**日本語の語を書かない**。
import { PAGE_SIZE_DEFAULT } from '@ses/config';
import type { ProjectStatus } from '@ses/db';
import type { ProjectPublishListStatus } from '@ses/domain';
import { t } from '@ses/i18n';
import { formatManYen, formatThousands } from '../format/number';
import { PREFECTURE_MESSAGE_KEYS } from '../format/prefectures';
// 🔴 型だけを import する（帯の primary の形は `lib/shell/page-trail.ts` が持つ 1 箇所である）。
import type { PagePrimaryAction } from '../shell/page-trail';
import {
  HIDDEN_COLUMNS_PARAM,
  hiddenColumnsParamValue,
  parseHiddenColumns,
  toggleHiddenColumn,
} from '../ui/hidden-columns';
import { formatUnitPriceRangeManYen } from '../format/number';
import { PROJECT_REMOTE_MODE_MESSAGE_KEYS, PROJECT_STATUS_MESSAGE_KEYS } from './labels';
import type { ProjectMustRequirementView, ProjectView } from './list';
import type { ProjectListQuery } from './schemas';

/** `S-010` の入口（`PROJECT_FORM_CANCEL_HREF` と同じ値である）。 */
export const PROJECT_LIST_PATH = '/projects';

/** 未設定（`docs/04` §11「`null` は空文字にしない」）。 */
function none(): string {
  return t('projects.detail.valueNone');
}

/** 1 行分の表示値（すべて文字列。画面は組み立てをせず、そのまま描く）。 */
export type ProjectListRowView = {
  /** nullは取引先（非表示）。ホストの未設定値は「—」。 */
  readonly purchaseUnitPrice: string | null;
  readonly id: string;
  readonly name: string;
  readonly status: string;
  /**
   * 🔴 **状態の値そのもの**（表示用の語ではない）。✅ 2026-10-14 に足した。
   *
   * 🔴 **色を渡すためではなく、色を決めさせないために在る。** 一覧と副カラムは
   *    `@ses/ui` の `StatusBadge`（`entity="project"`）に**状態名**を渡し、
   *    色と形状は `STATUS_BADGE_APPEARANCES` の 1 箇所が決める
   *    （`docs/04` §5-13「状態名から表示を導出し、画面側で色を指定させない」）。
   *    🔴 したがって**画面に `variant` を渡す口は無い**（渡せる prop が存在しない）。
   * ⚠️ 語（`status`）は `packages/i18n` 由来のままである。**値と語の 2 本持ちになる**が、
   *    `packages/ui` は `@ses/i18n` を import できない（`docs/05` §2.3.1）ので、
   *    「色は部品 / 語は呼び出し側」の分担はこの形にしかならない。
   */
  readonly statusState: ProjectStatus;
  /** 必須要件の要約（上位 3 件を `、` で連ねたもの）。0 件なら `—`。 */
  readonly mustRequirements: string;
  /** 🔴 超過件数の表示（`+2`）。0 件なら `null`（`+0` を描かない）。 */
  readonly moreMustRequirements: string | null;
  readonly unitPrice: string;
  readonly startDate: string;
  /**
   * 勤務地（都道府県）。
   * ✅ **2026-10-15: リモート可否を別の列に分けた**（[Issue #101](https://github.com/Festal-KM/SES-Platform/issues/101)
   *    の回答 C「勤務地と稼働形態を分けて `埼玉` + Badge」）。**1 列に畳んでいた頃は
   *    `東京都・一部リモート可` で 144px あり、表の幅を決めていた**（`#101` の実測）。
   */
  readonly location: string;
  /** 稼働形態（リモート可否）。未設定は `null`（Badge を描かない）。 */
  readonly remoteMode: string | null;
  readonly headcount: string;
  readonly updatedOn: string;
  /**
   * 🔴 公開先の設定状況（`未設定` / `N 社に公開中`）。**ホストのみ**であり、
   *    取引先の行では `null` になる（`docs/04` §S-010「🔴 取引先にはこの列を出さない」/
   *    `F-014 AC-4` / `BR-07`）。値の出所は `ProjectView` の判別子であり、
   *    **`PartnerProjectView` には `visibleToCount` が型として存在しない**ので、
   *    ここで取引先の行に社数を入れる実装はコンパイルできない。
   */
  readonly visibility: string | null;
};

/**
 * 必須要件 1 件の表示（`docs/04` §S-010 の「必須要件の要約」列。ワイヤーフレームの
 * 「COBOL 5 年以上, Java」に相当する）。
 * 🔴 辞書名を優先し、無ければ自由記述（どちらも無い要件は保存できない。`service.ts`）。
 */
export function formatMustRequirement(requirement: ProjectMustRequirementView): string {
  const label = requirement.skillName ?? requirement.freeText ?? none();
  if (requirement.requiredYears === null) return label;
  return `${label} ${String(requirement.requiredYears)} ${t('projects.list.requirements.yearsOrMore')}`;
}

/** 上位 3 件を 1 セルに畳む。0 件は `—`（空欄にしない）。 */
export function formatMustRequirementSummary(
  requirements: readonly ProjectMustRequirementView[],
): string {
  if (requirements.length === 0) return none();
  return requirements.map(formatMustRequirement).join(t('projects.list.requirements.separator'));
}

/**
 * 勤務地（都道府県）。
 * ✅ **2026-10-15: リモート可否をここから外した**（`#101` の C。下の
 *    `formatProjectRemoteMode` が別の列として持つ）。
 * 🔴 未設定は `—`（空欄にしない）。
 */
export function formatProjectLocation(prefecture: ProjectView['prefecture']): string {
  return prefecture === null ? none() : t(PREFECTURE_MESSAGE_KEYS[prefecture]);
}

/**
 * 稼働形態（リモート可否）。
 * 🔴 **未設定は `null` を返す（`—` ではない）** —— この列は Badge で描くので、
 *    語が無いときは**空の Badge を置かずに何も描かない**（器だけが並ぶと「空の状態」に見える）。
 * 🔴 案件の語彙（`projects.remoteMode.*`）を使う。人材のキーを共有しない（`labels.ts` 冒頭）。
 */
export function formatProjectRemoteMode(remoteMode: ProjectView['remoteMode']): string | null {
  return remoteMode === null ? null : t(PROJECT_REMOTE_MODE_MESSAGE_KEYS[remoteMode]);
}

/**
 * ✅ **2026-10-15: 一覧の表の単価レンジ（万円）**。[Issue #101](https://github.com/Festal-KM/SES-Platform/issues/101)
 * の回答 C「値の表記を短くする」。
 *
 * 🔴 **詳細（`S-011`）の `formatProjectUnitPriceRange`（円）とは別の関数である。**
 *    一覧は走査のための面であり、詳細・承認・提案は**金額を確定させる面**である。
 *    万円は 1,000 円未満を丸めるので、後者で使わない（`lib/format/number.ts` の 🔴）。
 * 🔴 **語は一覧専用のキーである**（`projects.list.unitPrice.*`）—— 円の語
 *    （`projects.unitPrice.unit` ほか）は**登録フォームの単位と詳細画面**が使い続ける。
 */
export function formatProjectListUnitPriceRange(min: number | null, max: number | null): string {
  return formatUnitPriceRangeManYen(min, max, {
    unit: t('projects.list.unitPrice.manYen'),
    orMore: t('projects.list.unitPrice.orMore'),
    orLess: t('projects.list.unitPrice.orLess'),
    none: none(),
  });
}

/**
 * 🔴 公開先の設定状況（`docs/04` §S-010「ホストのみ 9 列目」。**T-12-10 で 3 値になった**）。
 *
 * 🔴 **0 件を「0 社に公開中」と書かない。** 既定は誰にも公開されない（`F-014 AC-2`）ので、
 *    0 は「設定を忘れている」ことを指す状態であり、件数ではなく**状態の語**で出す。
 * 🔴 **T-12-10: 3 値目（`AUTO_REVOKED` = `公開を解除（検査）`）を足した。** 再検査の FAIL で
 *    自動解除された案件も公開先は 0 社になるため、2 値のままだと `未設定`（一度も公開していない）と
 *    同じ表示になる —— **同じ 0 社を一覧と詳細が別の言葉で説明すると、営業は「設定し忘れた」と
 *    読んで原因の欄（`S-011` の帯）に辿り着けない**（`F-014 AC-9`）。
 * 🔴 **理由・原因の欄・指摘は一覧に出さない**（列は 1 語である。`docs/04` §S-010 / §7.1）。
 * 🔴 **保留は区別しない**（公開は維持されているので `N 社に公開中` のまま）。
 */
export function formatVisibilityStatus(
  visibleToCount: number,
  publishStatus: ProjectPublishListStatus,
): string {
  if (publishStatus === 'AUTO_REVOKED') return t('projects.list.visibility.autoRevoked');
  if (visibleToCount === 0) return t('projects.list.visibility.unset');
  return `${formatThousands(visibleToCount)} ${t('projects.list.visibility.publishedTo')}`;
}

export function projectListRow(view: ProjectView): ProjectListRowView {
  return {
    purchaseUnitPrice:
      view.audience !== 'HOST'
        ? null
        : view.internalUnitPrice === null
          ? none()
          : `${formatManYen(view.internalUnitPrice)} ${t('projects.list.unitPrice.manYen')}`,
    id: view.id,
    name: view.name,
    status: t(PROJECT_STATUS_MESSAGE_KEYS[view.status]),
    // 🔴 状態名はそのまま運ぶ（語に畳まない。上の型の 🔴）。
    statusState: view.status,
    mustRequirements: formatMustRequirementSummary(view.mustRequirements),
    // 🔴 `+N` は語ではなく記号 + 数値である（人材の主要スキルと同じ扱い）。
    moreMustRequirements:
      view.moreMustRequirementCount === 0 ? null : `+${String(view.moreMustRequirementCount)}`,
    // ✅ **2026-10-15: 一覧の表だけ万円表記**（`#101` の C）。
    //    🔴 **詳細（`S-011`）・承認・提案は円のまま**である —— 金額を確定させる面では
    //    丸めない（`lib/format/number.ts` の `formatManYen` の 🔴）。
    unitPrice: view.unitPriceMin === null && view.unitPriceMax === null
      ? none()
      : `${formatManYen(view.unitPriceMin ?? view.unitPriceMax ?? 0)} ${t('projects.list.unitPrice.manYen')}`,
    startDate: view.startDate ?? none(),
    location: formatProjectLocation(view.prefecture),
    remoteMode: formatProjectRemoteMode(view.remoteMode),
    headcount: `${formatThousands(view.headcount)} ${t('projects.headcount.unit')}`,
    updatedOn: view.updatedOn,
    // 🔴 判別子で絞り込んだ枝でしか `visibleToCount` に到達できない（型で保証されている）。
    visibility:
      view.audience === 'HOST'
        ? formatVisibilityStatus(view.visibleToCount, view.publishStatus)
        : null,
  };
}

export function projectListRows(items: readonly ProjectView[]): readonly ProjectListRowView[] {
  return items.map(projectListRow);
}

/** 件数は境界適用後の応答から取り、カーソルを件数やページ番号に読み替えない。 */
export function projectPageSummary(total: number, displayed: number): string {
  return t('projects.list.pageSummary')
    .replace('{total}', formatThousands(total))
    .replace('{displayed}', formatThousands(displayed));
}

/**
 * 🔴 **母集団の明示**（`docs/04` §3.2 項目 2 / §S-010「母集団が違うことを画面上で明示する」）。
 *
 * ホスト:「自社案件 312 件」/ 取引先:「**御社に公開された案件** 14 件」。
 * 🔴 値は API の `total`（＝ 一覧と同じ `where` の `COUNT`。境界適用後）だけを使う。
 *    クライアントで数え直さない（数え直すと、ページングした瞬間に件数が変わる）。
 * 🔴 出所は `ctx.partnerCompanyId` である（行の値ではない）。
 */
export function projectPopulationLabel(partnerCompanyId: string | null, total: number): string {
  const scope =
    partnerCompanyId === null
      ? t('projects.list.population.host')
      : t('projects.list.population.partner');
  return `${scope} ${formatThousands(total)} ${t('projects.list.population.unit')}`;
}

/**
 * ✅✅ **2026-10-15（同日の 2 回目）: 空に戻した = 既定で格納する列は 1 つも無い。**
 *
 * 🔴 経緯: 同日午前に `必須要件の要約` / `公開先の設定状況` を既定オフにしたのは、
 *    **右の案件詳細パネルを表の横に並べる幅を作る**ためだった（表の min-content が 1,313px あり、
 *    1672px では入らなかった）。その後 [Issue #101](https://github.com/Festal-KM/SES-Platform/issues/101) への
 *    人間の回答が **C「値の表記を短くする」** だったので、**幅を値側で作り直した**:
 *    単価を万円表記（`660,000〜750,000 円` 160px → `66〜75 万円` 約 80px）にし、
 *    勤務地と稼働形態を分けた。**列を格納しなくても入る**ので、格納をやめた。
 * 🔴 **格納の仕組み（`hideable`）は残してある** —— 利用者が自分で隠せることは変わらない。
 *    変わったのは**既定値**だけである（`?hide=` が無い = 全部表示に戻った）。
 * ⚠️ `apps/web/lib/ui/hidden-columns.ts` の「キーが無い = 既定 / `?hide=` が空 = 全部表示」の
 *    区別は**そのまま残す**（既定が空に戻っただけで、仕組みは次に既定を置くときにまた要る）。
 */
export const PROJECT_DEFAULT_HIDDEN_COLUMN_IDS: readonly ProjectHideableColumnId[] = [];

/**
 * 検索条件を保ったままの `S-010` へのリンクを作る。
 *
 * 🔴 **ページングで条件が落ちない**ことが目的である（`docs/04` §10.1 `S-010` Err
 *    「条件保持の再試行」と同じ趣旨。条件が落ちると、利用者は毎回組み立て直すことになる）。
 * 🔴 `cursor` は引数で**明示**する（`null` = 先頭ページ）。呼び出し側が「今のカーソルを
 *    引き継ぐのか捨てるのか」を書かずに済ませられないようにするためである。
 * 🔴 パラメータの並びは固定である（同じ条件からは必ず同じ URL になる。テストで固定できる）。
 * 🔴 `limit` は**既定値と違うときだけ**載せる（既定の URL を `?limit=50` で汚さない）。
 * 🔴 `hiddenColumns`（`T-22-06`）は**最後**に載せ、既定（何も隠していない）では 1 文字も足さない
 *    —— ページングで**列の表示状態も落ちない**ようにするためである（次ページで隠した列が
 *    復活すると、利用者は「何が起きたか」を説明できない）。**API には渡さない**
 *    （`projectListQuerySchema` はこのキーを持たず、表示の状態にすぎない）。
 */
export function projectListHref(
  query: ProjectListQuery,
  cursor: string | null,
  // ✅ **2026-10-15: 既定は「この画面の既定」である**（空配列ではない）。🔴 省略が
  //    「1 つも隠していない」を意味すると、呼び手が黙って `?hide=` を生やしてしまう。
  hiddenColumns: readonly ProjectHideableColumnId[] = PROJECT_DEFAULT_HIDDEN_COLUMN_IDS,
  selectedId: string | null = null,
  // ✅✅ **2026-10-16: 案件サマリのタブ**（人間の明示指示「タイル内にタブを設置して」）。
  // 🔴 **既定（`BASIC`）は URL に痕跡を残さない**（`?hide=` と同じ扱い）。
  panelTab: ProjectPanelTab = PROJECT_PANEL_TAB_DEFAULT,
): string {
  const params = new URLSearchParams();
  if (query.q !== undefined) params.set('q', query.q);
  if (query.status !== undefined) params.set('status', query.status);
  if (query.startFrom !== undefined) params.set('startFrom', query.startFrom);
  if (query.prefecture !== undefined) params.set('prefecture', query.prefecture);
  // ✅ 2026-10-15: 単価レンジ（人材一覧と同じ名前）。🔴 ページングでも条件が落ちない。
  if (query.priceMin !== undefined) params.set('priceMin', String(query.priceMin));
  if (query.priceMax !== undefined) params.set('priceMax', String(query.priceMax));
  // ✅ 2026-10-16（人間の明示指示）: 稼働形態 / 募集中のみ。
  // 🔴 **ここに足し忘れると、ページを送った瞬間に条件が落ちる**（この 1 関数が
  //    ページング・列の表示切替・行の選択のすべての URL を作っている）。
  if (query.remoteMode !== undefined) params.set('remoteMode', query.remoteMode);
  // 🔴 `'1'` を載せる（`schemas.ts` が `z.literal('1')` で受ける唯一の形）。
  if (query.recruitingOnly === true) params.set('recruitingOnly', '1');
  // ✅ 2026-10-16（受領モック）: カテゴリ / 案件区分 / 並行可否 / 開始時期。
  if (query.category !== undefined) params.set('category', query.category);
  if (query.sourceKind !== undefined) params.set('sourceKind', query.sourceKind);
  // 🔴 `'1'` / `'0'` の 2 値（`false` を落とすと「不可」で絞った条件がページ送りで消える）。
  if (query.parallelOk !== undefined) params.set('parallelOk', query.parallelOk ? '1' : '0');
  if (query.startWithin !== undefined) params.set('startWithin', query.startWithin);
  // ✅✅ 2026-10-16（人間の明示指示「スキル（リストから複数選択できる、or 検索）」）。
  // 🔴 **`append` である**（`set` だと最後の 1 つしか残らず、ページを送った瞬間に
  //    選んだスキルが 1 件に減る）。`<select multiple>` が送るのと同じ形に戻す。
  if (query.skills !== undefined) {
    for (const skillId of query.skills) params.append('skills', skillId);
  }
  for (const phase of query.developmentPhases ?? []) params.append('developmentPhases', phase);
  for (const key of ['developmentMethod', 'utilizationBand', 'utilizationMin', 'utilizationMax', 'keywordGroups'] as const) { if (query[key] !== undefined) params.set(key, String(query[key])); }
  if (query.limit !== PAGE_SIZE_DEFAULT) params.set('limit', String(query.limit));
  if (cursor !== null) params.set('cursor', cursor);
  // ✅ 2026-10-15: 既定（2 列を格納）と同じなら URL に痕跡を残さない。既定から戻したときだけ
  //    `?hide=` が載る（空値 ＝ 1 つも隠していない）。
  const hide = hiddenColumnsParamValue(hiddenColumns, PROJECT_DEFAULT_HIDDEN_COLUMN_IDS);
  if (hide !== null) params.set(HIDDEN_COLUMNS_PARAM, hide);
  if (selectedId !== null) params.set(PROJECT_SELECTED_PARAM, selectedId);
  // ✅✅ 2026-10-16: 案件サマリのタブ。🔴 **既定は載せない**（URL を素のままに保つ）。
  if (panelTab !== PROJECT_PANEL_TAB_DEFAULT) params.set(PROJECT_PANEL_TAB_PARAM, panelTab);
  const search = params.toString();
  return search === '' ? PROJECT_LIST_PATH : `${PROJECT_LIST_PATH}?${search}`;
}

/**
 * 🔴 **副カラム（案件の要点パネル）で開いている行**を表す URL のクエリ（SP-22 段④）。
 *
 * 🔴 **表示の状態であり、API には渡さない**（`?hide=` と同じ扱い。`projectListQuerySchema` は
 *    このキーを持たず、Zod の既定〔strip〕で落ちるので `safeParse` も URL も動かない）。
 * 🔴 **状態を画面側に持たない** —— 持つと再読込・共有・戻るで消え、`'use client'` が要る。
 */
export const PROJECT_SELECTED_PARAM = 'selected';

// ============================================================================
// ✅✅ 2026-10-16: 案件サマリのタブ（人間の明示指示「タイル内にタブを設置して、
//     基本情報とコピペ用サマリ（添付を参考）」）
// ============================================================================
/**
 * 🔴 **タブの状態も URL が持つ**（`?selected=` と同じ扱い）。
 *
 * 🔴 **`'use client'` を増やさない。** この画面はサーバだけで描かれており（水和の前から
 *    操作できる）、タブのために状態を画面側へ持ち込むと**再読込・共有・戻るで消える**。
 *    タブはリンク 2 本であり、押すとサーバが選ばれた面を描く。
 * 🔴 **API には渡さない** —— 表示の状態であり、取得する項目は変わらない
 *    （`projectListQuerySchema` はこのキーを持たず、Zod の既定〔strip〕で落ちる）。
 */
export const PROJECT_PANEL_TAB_PARAM = 'panelTab';

/** 🔴 **値集合がクエリの許可リストである**（ここに無い値が来ても既定に落ちる）。 */
export const PROJECT_PANEL_TABS = ['BASIC', 'COPY'] as const;

export type ProjectPanelTab = (typeof PROJECT_PANEL_TABS)[number];

/**
 * 🔴 **既定は `基本情報`**（人間の指示の並びの 1 つ目であり、添付の形でもある）。
 *    既定を URL に載せないので、素の `/projects` は基本情報で開く。
 */
export const PROJECT_PANEL_TAB_DEFAULT: ProjectPanelTab = 'BASIC';

/**
 * `?panelTab=` → タブ。
 *
 * 🔴 **未知の値は既定に落とす**（URL 直打ちで壊れない。`parseHiddenProjectColumns` と同じ構え）。
 *    🔴 **`redirect` しない** —— タブは表示の状態であり、検索条件を巻き戻す理由にならない。
 */
export function projectPanelTab(raw: string | readonly string[] | undefined): ProjectPanelTab {
  const requested = Array.isArray(raw) ? raw[0] : (raw as string | undefined);
  return PROJECT_PANEL_TABS.find((tab) => tab === requested) ?? PROJECT_PANEL_TAB_DEFAULT;
}

// ⚠️ **2026-10-19: `projectSkillRemoveHref` を削除した。** バッジの `×` が
//    **URL への遷移をやめ、チェックを外す操作**になったためである
//    （受領モックの「チェック = バッジ」に揃えた。
//    `app/(main)/projects/_search/skill-multi-select.tsx` 冒頭の 🔴。
//    ⚠️ 旧 `skill-filter-select.tsx` は 2026-10-19 の検索エリア改修で
//       `_search/` に吸収されて消えた）。
// 🔴 **使われない組み立てを残さない** —— 残すと「おそらくこっちが正」と読める
//    経路が 2 つになる。`skills` の query 自体は 1 文字も変えていない。

/**
 * そのタブを開く `S-010` の URL。
 * 🔴 **検索条件・ページの位置・列の表示状態・開いている行を保つ**（タブを変えたせいで
 *    1 ページ目に戻ったり、パネルが閉じたりしない。`projectSelectHref` と同じ理由）。
 */
export function projectPanelTabHref(
  query: ProjectListQuery,
  cursor: string | null,
  hiddenColumns: readonly ProjectHideableColumnId[],
  selectedId: string | null,
  panelTab: ProjectPanelTab,
): string {
  return projectListHref(query, cursor, hiddenColumns, selectedId, panelTab);
}

/**
 * 🔴 `?selected=` → **いまのページに実在する行の ID**（無ければ先頭行、行が無ければ `null`）。
 *
 * 🔴 **いまのページの行に照合してから使う**（`docs/05` §6.4 #14 の条件②と同じ構え）。
 *    照合しないと、URL 直打ちで「このページに無い ID」を指した状態が作れてしまい、
 *    **パネルが空のまま「選択されている」ことになる**（何も読めない画面になる）。
 *    🔴 **ここで DB を引かない。** 他のページ・他テナントの案件を指されても、
 *    **この関数は与えられた行の集合しか見ない**（境界は `projects` の RLS が決めている）。
 * 🔴 **既定は先頭行である**（ワイヤーフレームどおり、パネルを空で置かない）。先頭行は
 *    サーバが確定させた決定的な並び（`PROJECT_LIST_ORDER_BY`）の 1 行目であり、
 *    **順位・スコアを表すものではない**。
 */
export function selectedProjectId(
  raw: string | readonly string[] | undefined,
  rows: readonly ProjectListRowView[],
): string | null {
  const first = rows[0];
  if (first === undefined) return null;
  const requested = Array.isArray(raw) ? raw[0] : (raw as string | undefined);
  if (requested === undefined) return first.id;
  return rows.some((row) => row.id === requested) ? requested : first.id;
}

/**
 * その行を副カラムで開く `S-010` の URL。
 * 🔴 **検索条件・ページの位置・列の表示状態を保つ**（パネルを開いたせいで 1 ページ目に
 *    戻されると、いま読んでいた行を見失う。`projectColumnToggleHref` と同じ理由）。
 */
export function projectSelectHref(
  query: ProjectListQuery,
  cursor: string | null,
  hiddenColumns: readonly ProjectHideableColumnId[],
  projectId: string,
  // ✅✅ 2026-10-16: 🔴 **開いているタブを保つ** —— 別の行を開いたときにタブが
  //    基本情報へ戻ると、コピペ用サマリを続けて何件も取るときに毎回押し直すことになる。
  panelTab: ProjectPanelTab = PROJECT_PANEL_TAB_DEFAULT,
): string {
  return projectListHref(query, cursor, hiddenColumns, projectId, panelTab);
}

/**
 * 🔴 **`S-010` で利用者が外せる列**（`docs/04` §7.1「既定 8 列 + 操作列。**9 列目以降は
 *    列表示切替に格納する**」）。9 列目 = 公開先の設定状況（**ホストのみ**。`F-014 AC-4` / `BR-07`）。
 *
 * 🔴 **この配列がクエリの許可リストである** —— ここに無い値が `?hide=` に来ても無視される。
 * 🔴 **並びが URL の正規形を決める**（`hidden-columns.ts`）。
 * 🔴 列を増やすときは `docs/04` §10.3 / §S-010 の列の定めが先である（画面の都合で足さない）。
 */
export const PROJECT_HIDEABLE_COLUMN_IDS = ['mustRequirements', 'visibility', 'purchaseUnitPrice'] as const;

export type ProjectHideableColumnId = (typeof PROJECT_HIDEABLE_COLUMN_IDS)[number];


/** URL のクエリ（`?hide=`）→ いま隠れている列。許可リスト外は捨てる。 */
export function parseHiddenProjectColumns(
  raw: string | readonly string[] | undefined,
): readonly ProjectHideableColumnId[] {
  return parseHiddenColumns(raw, PROJECT_HIDEABLE_COLUMN_IDS, PROJECT_DEFAULT_HIDDEN_COLUMN_IDS);
}

/**
 * その列の表示 / 非表示を反転した `S-010` の URL。
 * 🔴 **検索条件とページの位置（`cursor`）を保つ** —— 列を 1 つ外したせいで 1 ページ目に
 *    戻されると、いま読んでいた行を見失う。
 */
export function projectColumnToggleHref(
  query: ProjectListQuery,
  cursor: string | null,
  hidden: readonly ProjectHideableColumnId[],
  columnId: ProjectHideableColumnId,
  /** 🔴 副カラムで開いている行も保つ（列を 1 つ出し入れしてパネルが閉じない）。 */
  selectedId: string | null = null,
): string {
  return projectListHref(
    query,
    cursor,
    toggleHiddenColumn(hidden, PROJECT_HIDEABLE_COLUMN_IDS, columnId),
    selectedId,
  );
}

/**
 * 🔴 **帯（`PageHeader`）の primary**（SP-22 段④。`docs/04` §S-010「『案件を登録』（primary、
 *    ホストのみ）→ `S-012`」/ §7.6「primary は大きく」/ §3.1 のレイアウト図）。
 *
 * 🔴 **`canRegister` が偽なら `null` を返す** —— 押しても戻されるだけの導線を描かない
 *    （`docs/04` §S-010 権限差分「取引先は『案件を登録』が無い」。理由テキストは画面側が出す）。
 *    ⚠️ これは UI の配慮であり、拒否の本体は `#26` の `requireRole` / `S-012` の `redirect` /
 *    `projects` の RLS（C2 の `app_is_host()`）である。
 * 🔴 **判定をここ（`lib/**`）に置くのは、`page.tsx` がユニットテストの対象外だからである**
 *    （`vitest.config.ts`）。`T-22-05` の `page-heading.tsx` が「帯のテストだけを根拠にすると
 *    画面側の判定が外れても緑のまま通る」と記録しているのと同じ穴を、ここで塞ぐ。
 * 🔴 `kind` は **`ACTION`**（作成系）である。`PageHeading` 側でも `canAct` で落ちる二重の壁になる。
 */
export function projectListPrimaryAction(canRegister: boolean): PagePrimaryAction | null {
  return canRegister
    ? {
        labelKey: 'projects.list.register',
        href: `${PROJECT_LIST_PATH}/new`,
        kind: 'ACTION' as const,
        // ✅ 2026-10-16: 人間の明示指示「＋アイコンもつけて」。
        icon: 'plus' as const,
      }
    : null;
}

/**
 * 🔴 **絞り込みが 1 つでも効いているか**（`docs/04` §10.1 `S-010`: 初回空と絞込 0 で文言が違う）。
 *    ページング（`cursor`）と表示件数（`limit`）は絞り込みではないので数えない ——
 *    2 ページ目が 0 件でも「条件に一致する案件はありません」にはならない。
 */
export function hasProjectListFilters(query: ProjectListQuery): boolean {
  return (
    query.developmentPhases !== undefined || query.developmentMethod !== undefined ||
    query.utilizationBand !== undefined || query.utilizationMin !== undefined || query.utilizationMax !== undefined || query.keywordGroups !== undefined ||
    query.q !== undefined ||
    query.status !== undefined ||
    query.startFrom !== undefined ||
    query.prefecture !== undefined ||
    query.priceMin !== undefined ||
    query.priceMax !== undefined ||
    // ✅ 2026-10-16（人間の明示指示）: 稼働形態 / 募集中のみ。
    // 🔴 **ここに足し忘れると「条件をクリア」が出ない**（この 1 関数が、絞り込みが効いているか
    //    の唯一の判定であり、空状態の文言の出し分けにも使われる）。
    query.remoteMode !== undefined ||
    query.recruitingOnly !== undefined ||
    // ✅ 2026-10-16（受領モック）: カテゴリ / 案件区分 / 並行可否 / 開始時期。
    query.category !== undefined ||
    query.sourceKind !== undefined ||
    query.parallelOk !== undefined ||
    query.startWithin !== undefined ||
    // ✅✅ 2026-10-16: スキル（複数選択 / OR）。🔴 **空配列は `schemas.ts` が `undefined` に
    //    畳んでいる**ので、ここで長さを見なくても「1 つも選んでいない」は偽になる。
    query.skills !== undefined
  );
}
