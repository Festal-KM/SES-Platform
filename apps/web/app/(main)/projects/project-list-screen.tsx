// apps/web/app/(main)/projects/project-list-screen.tsx
// `S-010` 案件一覧・検索 — 本体（docs/04 §S-010 / `F-015` / docs/05 §6.4 #25）。T-06-03。
//
// 🔴 **一覧はテーブルで描く。カードで並べない**（docs/04 §11-2「`S-010` は 1 万件規模を前提に
//    したテーブル」）。既定 50 行のカーソルページングで、無限スクロールにしない。
//
// 🔴 **T2（モバイル閲覧可）。列は間引くが遮断しない**（`CLAUDE.md` §13.3 / docs/04 §S-010
//    デバイス別）。ブレークポイントは Tailwind の既定のみを使う（独自定義しない）:
//      - モバイル（< sm） … 案件名 / 状態 / 単価レンジ / 開始日 の 4 列
//      - タブレット（sm 〜 lg） … + 勤務地・リモート / 更新日 の 6 列
//      - デスクトップ（lg 〜） … + 必須要件の要約 / 募集人数（+ ホストのみ公開先の設定状況）
//    ⚠️ docs/04 §S-010 デバイス別は モバイルを「2 行構成」と書いているが、**列の間引きで表現した**
//    （項目は同じ 4 つ。案件名が長いときはセル内で折り返る）。理由は docs/04 §11-2
//    「一覧はテーブルで描く。カードで並べない」であり、行を 2 段に割ると `S-005` と描き方が
//    分かれる。docs/04 §S-010 に ⚠️ として記録した。
//
// 🔴 **スコア・順位・重みに相当する表示項目を持たない**（Phase 1。`F-009 AC-2` と同じ規律）。
//    並び順の説明は 1 行で常時出す（`docs/04` §S-010）。
// 🔴 **「全 N ページ中 M ページ目」「他に N 件」を描かない**（docs/05 §4.8）。
// 🔴 **公開先の設定状況の列は `showVisibilityColumn` が真のときだけ描く**（`F-014 AC-4` /
//    `BR-07`）。判定の出所は `ctx.partnerCompanyId` であり、行の値ではない。加えて
//    取引先の行には `visibility` が `null` で届く（`ProjectListRowView` の注記）。
//
// 🔴 文言は props（`packages/i18n`）から受け取る。ここにベタ書きしない（`CLAUDE.md` §3.5）。
// 🔴 検索は**同期**（`docs/04` §S-010 非同期処理の表現）。素の `<form method="get">` で送るので、
//    クライアント JavaScript を 1 バイトも要求しない（`'use client'` を宣言しない）。
// ⚠️ 自画面へのパス（`/projects` / `/projects/new` / `/projects/{id}`）はリテラルで書く
//    （`EngineerLedgerScreen` と同じ）。`lib/projects/list-rows.ts` の `PROJECT_LIST_PATH` を
//    import すると `@ses/i18n` / `@ses/config` が `*.render.test.tsx` の依存に入り、
//    「文言が無い状態の描画」を試せなくなる（`detail-props.ts` 冒頭と同じ理由）。
//    **検索条件つきのリンク（ページング）は props で受け取る** —— 組み立てはテストできる
//    場所（`projectListHref`）に置く。
import Link from 'next/link';
import type { ProjectListRowView } from '../../../lib/projects/list-rows';

/** 検索条件の選択肢 1 件（`value` は API の query に載る値そのもの）。 */
export type ProjectFilterOption = {
  readonly value: string;
  readonly label: string;
};

/** フォームに戻す現在の検索条件（未指定は空文字）。 */
export type ProjectListFilterValues = {
  readonly q: string;
  readonly status: string;
  readonly startFrom: string;
  readonly prefecture: string;
};

export type ProjectListScreenMessages = {
  readonly populationLabel: string;
  /** 🔴 取引先にだけ出す「見える範囲の説明」（`F-006 AC-2` と同じ規律）。ホストは `null`。 */
  readonly partnerScopeNotice: string | null;
  readonly orderNote: string;
  readonly searchComingSoon: string;
  readonly searchLegend: string;
  readonly searchQ: string;
  readonly searchStatus: string;
  readonly searchStartFrom: string;
  readonly searchPrefecture: string;
  readonly searchSubmit: string;
  readonly searchClear: string;
  readonly register: string;
  readonly readOnlyNote: string;
  readonly columnName: string;
  readonly columnStatus: string;
  readonly columnMustRequirements: string;
  readonly columnUnitPrice: string;
  readonly columnStartDate: string;
  readonly columnLocation: string;
  readonly columnHeadcount: string;
  readonly columnUpdatedOn: string;
  readonly columnVisibility: string;
  readonly emptyTitle: string;
  readonly emptyLead: string;
  readonly nextPage: string;
  readonly firstPage: string;
};

/** デスクトップでだけ出す列（docs/04 §11「優先度の低い列（先に隠す）」）。 */
const DESKTOP_ONLY = 'hidden lg:table-cell';
/** タブレット以上で出す列。 */
const TABLET_UP = 'hidden sm:table-cell';

export function ProjectListScreen({
  rows,
  filters,
  statusOptions,
  prefectureOptions,
  showVisibilityColumn,
  canRegister,
  showClearFilters,
  nextPageHref,
  firstPageHref,
  messages,
}: {
  readonly rows: readonly ProjectListRowView[];
  readonly filters: ProjectListFilterValues;
  readonly statusOptions: readonly ProjectFilterOption[];
  readonly prefectureOptions: readonly ProjectFilterOption[];
  /**
   * 🔴 取引先には公開先の列を出さない（docs/04 §S-010 / `F-014 AC-4`）。
   *    出所は `ctx.partnerCompanyId` であり、行の値ではない。
   */
  readonly showVisibilityColumn: boolean;
  readonly canRegister: boolean;
  /** 絞り込みが 1 つでも効いているとき（`docs/04` §10.1 `S-010` 絞込 0 の条件解除導線）。 */
  readonly showClearFilters: boolean;
  /** 次ページ（無ければ `null`）。検索条件を保った URL である。 */
  readonly nextPageHref: string | null;
  /** 2 ページ目以降でだけ「最初のページに戻る」を出す（無ければ `null`）。 */
  readonly firstPageHref: string | null;
  readonly messages: ProjectListScreenMessages;
}) {
  return (
    <div data-testid="project-list-screen">
      {/* 🔴 検索条件（docs/04 §S-010 セクション 1）。`method="get"` なので、実行した検索が
          そのまま URL になり、共有・再読込・戻るのいずれでも同じ結果に戻る。 */}
      <form className="ses-filter-form" method="get" action="/projects" data-testid="project-list-filters">
        <fieldset className="contents">
          <legend className="sr-only">{messages.searchLegend}</legend>
          <label className="ses-field">
            <span>{messages.searchQ}</span>
            <input type="search" name="q" defaultValue={filters.q} data-testid="project-list-filter-q" />
          </label>
          <label className="ses-field">
            <span>{messages.searchStatus}</span>
            <select name="status" defaultValue={filters.status} data-testid="project-list-filter-status">
              {statusOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <label className="ses-field">
            <span>{messages.searchStartFrom}</span>
            <input
              type="date"
              name="startFrom"
              defaultValue={filters.startFrom}
              data-testid="project-list-filter-start-from"
            />
          </label>
          <label className="ses-field">
            <span>{messages.searchPrefecture}</span>
            <select
              name="prefecture"
              defaultValue={filters.prefecture}
              data-testid="project-list-filter-prefecture"
            >
              {prefectureOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <button type="submit" className="ses-submit" data-testid="project-list-search">
            {messages.searchSubmit}
          </button>
          {showClearFilters ? (
            <Link className="ses-secondary-link" href="/projects" data-testid="project-list-clear">
              {messages.searchClear}
            </Link>
          ) : null}
        </fieldset>
      </form>

      {/* 🔴 まだ効かない条件を黙って描かない（`engineers.list.searchComingSoon` と同じ規律）。 */}
      <p className="mb-3 text-sm text-slate-500" data-testid="project-list-search-coming-soon">
        {messages.searchComingSoon}
      </p>

      {/* 🔴 母集団を 1 行で明示する（docs/04 §3.2 項目 2）。件数は API の `total` だけを使う。 */}
      <p className="mb-1 text-sm font-semibold text-slate-900" data-testid="project-list-population">
        {messages.populationLabel}
      </p>
      {messages.partnerScopeNotice === null ? null : (
        <p className="mb-1 text-sm text-slate-600" data-testid="project-list-partner-scope-notice">
          {messages.partnerScopeNotice}
        </p>
      )}
      {/* 🔴 並び順の説明（docs/04 §S-010）。スコア・順位・重みの語を含めない。 */}
      <p className="mb-3 text-sm text-slate-600" data-testid="project-list-order-note">
        {messages.orderNote}
      </p>

      <div className="mb-4">
        {canRegister ? (
          <Link className="ses-secondary-link" href="/projects/new" data-testid="project-list-register">
            {messages.register}
          </Link>
        ) : (
          <p className="text-sm text-slate-500" data-testid="project-list-read-only-note">
            {messages.readOnlyNote}
          </p>
        )}
      </div>

      {rows.length === 0 ? (
        // 🔴 docs/04 §10.1 `S-010`: **初回空と絞込 0 で文言が違う**（呼び出し側が選ぶ）。
        //    取引先の初回空は「案件が無い」ではなく「公開されていない」である。
        <div
          className="border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700"
          data-testid="project-list-empty"
        >
          <p className="mb-1 font-semibold">{messages.emptyTitle}</p>
          <p className="m-0">{messages.emptyLead}</p>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-sm" data-testid="project-list-table">
            <thead>
              <tr className="border-b border-slate-200 text-left text-slate-500">
                <th className="px-3 py-2 font-medium">{messages.columnName}</th>
                <th className="px-3 py-2 font-medium">{messages.columnStatus}</th>
                <th className={`px-3 py-2 font-medium ${DESKTOP_ONLY}`}>
                  {messages.columnMustRequirements}
                </th>
                <th className="px-3 py-2 font-medium">{messages.columnUnitPrice}</th>
                <th className="px-3 py-2 font-medium">{messages.columnStartDate}</th>
                <th className={`px-3 py-2 font-medium ${TABLET_UP}`}>{messages.columnLocation}</th>
                <th className={`px-3 py-2 font-medium ${DESKTOP_ONLY}`}>
                  {messages.columnHeadcount}
                </th>
                <th className={`px-3 py-2 font-medium ${TABLET_UP}`}>{messages.columnUpdatedOn}</th>
                {showVisibilityColumn ? (
                  <th className={`px-3 py-2 font-medium ${DESKTOP_ONLY}`}>
                    {messages.columnVisibility}
                  </th>
                ) : null}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr
                  key={row.id}
                  className="border-b border-slate-100"
                  data-testid={`project-list-row-${row.id}`}
                >
                  <td className="px-3 py-2">
                    {/* 🔴 行から詳細へ（docs/04 §S-010「行クリックで `S-011`」）。
                        **閲覧の監査記録は遷移先が書く**（`readProjectDetail`。`BR-27`）。 */}
                    <Link
                      className="font-medium text-slate-900 underline"
                      href={`/projects/${row.id}`}
                      data-testid={`project-list-link-${row.id}`}
                    >
                      {row.name}
                    </Link>
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap">{row.status}</td>
                  <td className={`px-3 py-2 ${DESKTOP_ONLY}`}>
                    {row.mustRequirements}
                    {row.moreMustRequirements === null ? null : (
                      <span
                        className="ml-1 text-xs text-slate-500"
                        data-testid={`project-list-more-requirements-${row.id}`}
                      >
                        {row.moreMustRequirements}
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap">{row.unitPrice}</td>
                  <td className="px-3 py-2 whitespace-nowrap">{row.startDate}</td>
                  <td className={`px-3 py-2 whitespace-nowrap ${TABLET_UP}`}>{row.location}</td>
                  <td className={`px-3 py-2 whitespace-nowrap ${DESKTOP_ONLY}`}>{row.headcount}</td>
                  <td className={`px-3 py-2 whitespace-nowrap ${TABLET_UP}`}>{row.updatedOn}</td>
                  {showVisibilityColumn ? (
                    <td
                      className={`px-3 py-2 whitespace-nowrap ${DESKTOP_ONLY}`}
                      data-testid={`project-list-visibility-${row.id}`}
                    >
                      {row.visibility}
                    </td>
                  ) : null}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* 🔴 カーソルページング（docs/05 §6.1）。**「全 N ページ中 M ページ目」を出さない** ——
          ページ番号は境界外の行を含む全体件数を前提にした概念であり、§4.8 の「順位」に当たる。
          🔴 リンクは検索条件を保った URL である（`projectListHref`）。 */}
      {nextPageHref === null && firstPageHref === null ? null : (
        <nav className="mt-4 flex flex-wrap gap-4" data-testid="project-list-paging">
          {firstPageHref === null ? null : (
            <Link className="ses-secondary-link" href={firstPageHref} data-testid="project-list-first">
              {messages.firstPage}
            </Link>
          )}
          {nextPageHref === null ? null : (
            <Link className="ses-secondary-link" href={nextPageHref} data-testid="project-list-next">
              {messages.nextPage}
            </Link>
          )}
        </nav>
      )}
    </div>
  );
}
