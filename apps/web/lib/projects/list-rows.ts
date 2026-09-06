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
import { t } from '@ses/i18n';
import { formatThousands } from '../format/number';
import { PREFECTURE_MESSAGE_KEYS } from '../format/prefectures';
import { formatProjectUnitPriceRange } from './detail';
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
  readonly id: string;
  readonly name: string;
  readonly status: string;
  /** 必須要件の要約（上位 3 件を `、` で連ねたもの）。0 件なら `—`。 */
  readonly mustRequirements: string;
  /** 🔴 超過件数の表示（`+2`）。0 件なら `null`（`+0` を描かない）。 */
  readonly moreMustRequirements: string | null;
  readonly unitPrice: string;
  readonly startDate: string;
  /** 勤務地・リモート可否（`docs/04` §S-010 の 1 列）。 */
  readonly location: string;
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
 * 勤務地とリモート可否を 1 列に畳む（`docs/04` §S-010 の「勤務地・リモート」列）。
 * 🔴 片方しか無い行を `—` にしない（`formatLocation`（人材側）と同じ判断。片側でも判断に使える）。
 * 🔴 案件の語彙（`projects.remoteMode.*`）を使う。人材のキーを共有しない（`labels.ts` 冒頭）。
 */
export function formatProjectLocation(
  prefecture: ProjectView['prefecture'],
  remoteMode: ProjectView['remoteMode'],
): string {
  const parts = [
    prefecture === null ? null : t(PREFECTURE_MESSAGE_KEYS[prefecture]),
    remoteMode === null ? null : t(PROJECT_REMOTE_MODE_MESSAGE_KEYS[remoteMode]),
  ].filter((part): part is string => part !== null);
  return parts.length === 0 ? none() : parts.join('・');
}

/**
 * 🔴 公開先の設定状況（`docs/04` §S-010「ホストのみ 9 列目に `未設定` / `N 社に公開中`」）。
 *
 * 🔴 **0 件を「0 社に公開中」と書かない。** 既定は誰にも公開されない（`F-014 AC-2`）ので、
 *    0 は「設定を忘れている」ことを指す状態であり、件数ではなく**状態の語**で出す。
 */
export function formatVisibilityStatus(visibleToCount: number): string {
  if (visibleToCount === 0) return t('projects.list.visibility.unset');
  return `${formatThousands(visibleToCount)} ${t('projects.list.visibility.publishedTo')}`;
}

export function projectListRow(view: ProjectView): ProjectListRowView {
  return {
    id: view.id,
    name: view.name,
    status: t(PROJECT_STATUS_MESSAGE_KEYS[view.status]),
    mustRequirements: formatMustRequirementSummary(view.mustRequirements),
    // 🔴 `+N` は語ではなく記号 + 数値である（人材の主要スキルと同じ扱い）。
    moreMustRequirements:
      view.moreMustRequirementCount === 0 ? null : `+${String(view.moreMustRequirementCount)}`,
    unitPrice: formatProjectUnitPriceRange(view.unitPriceMin, view.unitPriceMax),
    startDate: view.startDate ?? none(),
    location: formatProjectLocation(view.prefecture, view.remoteMode),
    headcount: `${formatThousands(view.headcount)} ${t('projects.headcount.unit')}`,
    updatedOn: view.updatedOn,
    // 🔴 判別子で絞り込んだ枝でしか `visibleToCount` に到達できない（型で保証されている）。
    visibility: view.audience === 'HOST' ? formatVisibilityStatus(view.visibleToCount) : null,
  };
}

export function projectListRows(items: readonly ProjectView[]): readonly ProjectListRowView[] {
  return items.map(projectListRow);
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
 * 検索条件を保ったままの `S-010` へのリンクを作る。
 *
 * 🔴 **ページングで条件が落ちない**ことが目的である（`docs/04` §10.1 `S-010` Err
 *    「条件保持の再試行」と同じ趣旨。条件が落ちると、利用者は毎回組み立て直すことになる）。
 * 🔴 `cursor` は引数で**明示**する（`null` = 先頭ページ）。呼び出し側が「今のカーソルを
 *    引き継ぐのか捨てるのか」を書かずに済ませられないようにするためである。
 * 🔴 パラメータの並びは固定である（同じ条件からは必ず同じ URL になる。テストで固定できる）。
 * 🔴 `limit` は**既定値と違うときだけ**載せる（既定の URL を `?limit=50` で汚さない）。
 */
export function projectListHref(query: ProjectListQuery, cursor: string | null): string {
  const params = new URLSearchParams();
  if (query.q !== undefined) params.set('q', query.q);
  if (query.status !== undefined) params.set('status', query.status);
  if (query.startFrom !== undefined) params.set('startFrom', query.startFrom);
  if (query.prefecture !== undefined) params.set('prefecture', query.prefecture);
  if (query.limit !== PAGE_SIZE_DEFAULT) params.set('limit', String(query.limit));
  if (cursor !== null) params.set('cursor', cursor);
  const search = params.toString();
  return search === '' ? PROJECT_LIST_PATH : `${PROJECT_LIST_PATH}?${search}`;
}

/**
 * 🔴 **絞り込みが 1 つでも効いているか**（`docs/04` §10.1 `S-010`: 初回空と絞込 0 で文言が違う）。
 *    ページング（`cursor`）と表示件数（`limit`）は絞り込みではないので数えない ——
 *    2 ページ目が 0 件でも「条件に一致する案件はありません」にはならない。
 */
export function hasProjectListFilters(query: ProjectListQuery): boolean {
  return (
    query.q !== undefined ||
    query.status !== undefined ||
    query.startFrom !== undefined ||
    query.prefecture !== undefined
  );
}
