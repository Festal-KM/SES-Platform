// apps/web/app/(main)/engineers/engineer-ledger-screen.tsx
// `S-005` エンジニア台帳（一覧）— 本体（docs/04 §S-005 / `F-009` / docs/05 §6.4 #15）。T-05-09。
//
// 🔴 **一覧はテーブルで描く。カードで並べない**（docs/04 §11-2「`S-005` は 1 万件規模を前提にした
//    テーブル」）。既定 50 行のカーソルページングで、無限スクロールにしない
//    （位置が失われ、比較の用を成さない）。
//
// 🔴 **T2（モバイル閲覧可）。列は間引くが遮断しない**（`CLAUDE.md` §13.3 / docs/04 §S-005 デバイス別）。
//    ブレークポイントは Tailwind の既定のみを使う（独自定義しない）:
//      - モバイル（< sm） … 氏名 / 主要スキル / 稼働可能時期 の 3 列
//      - タブレット（sm 〜 lg） … + 単価レンジ / 稼働状況 の 5 列
//      - デスクトップ（lg 〜） … + 所属区分 / 勤務地・リモート / 更新日 の 8 列
//    🔴 **移動中の判断に要る値（稼働可能時期・主要スキル）をモバイルで落とさない**
//    （docs/04 §S-005「移動中に『今すぐ動ける人』を探す業務がある」）。
//
// 🔴 **スコア・順位・重みに相当する表示項目を持たない**（`F-009 AC-2`。Phase 1）。
//    並び順の説明は 1 行で常時出す（docs/04 §S-005）。**重み設定を置かない**（`F-030 AC-4`。
//    `S-040` は Phase 2）。
// 🔴 **絞り込みチェックボックス 2 種は既定オフ**（`F-009 AC-5` / `docs/02` A-03）。
//    `defaultChecked` は query の値をそのまま反映し、**画面側で既定を作らない**
//    （既定は `checkboxFilter`〔`lib/api/query-filters.ts`〕にある 1 か所だけ）。
// 🔴 検索は**同期**（`docs/04` §S-005「検索は同期（1 秒以内が目標）」）。素の
//    `<form method="get">` で送るので、クライアント JavaScript を 1 バイトも要求しない
//    （`'use client'` を宣言しない）。実行した検索がそのまま URL になり、共有・再読込・戻るの
//    いずれでも同じ結果に戻る（docs/04 §S-005「条件は URL に反映」）。
// 🔴 **検索条件はモバイルでも全項目を提供する**（docs/04 §S-005 デバイス別「省略しない」）。
//    間引くのは結果テーブルの列だけである。
//
// 🔴 文言は props（`packages/i18n`）から受け取る。ここにベタ書きしない（`CLAUDE.md` §3.5）。
// ⚠️ 自画面へのパス（`/engineers` / `/engineers/new` / `/engineers/{id}`）はリテラルで書く
//    （`ProjectListScreen` と同じ）。`lib/engineers/list-rows.ts` の `ENGINEER_LIST_PATH` を
//    import すると `@ses/i18n` / `@ses/config` が `*.render.test.tsx` の依存に入り、
//    「文言が無い状態の描画」を試せなくなる。**検索条件つきのリンク（ページング・条件の解除）は
//    props で受け取る** —— 組み立てはテストできる場所（`engineerListHref`）に置く。
import Link from 'next/link';
import type {
  EngineerActiveFilterView,
  EngineerListRowView,
} from '../../../lib/engineers/list-rows';

/** 検索条件の選択肢 1 件（`value` は API の query に載る値そのもの）。 */
export type EngineerFilterOption = {
  readonly value: string;
  readonly label: string;
};

/** フォームに戻す現在の検索条件（未指定は空文字 / チェックボックスは真偽）。 */
export type EngineerListFilterValues = {
  readonly q: string;
  readonly skills: readonly string[];
  readonly skillMode: string;
  readonly yearsMin: string;
  readonly priceMin: string;
  readonly priceMax: string;
  readonly availableBy: string;
  readonly prefecture: string;
  readonly remote: string;
  readonly availability: string;
  readonly onlyInTime: boolean;
  readonly onlyCommutable: boolean;
};

export type EngineerLedgerScreenMessages = {
  readonly populationLabel: string;
  /** 🔴 取引先にだけ出す「見える範囲の説明」（`F-006 AC-2` と同じ規律）。ホストは `null`。 */
  readonly partnerScopeNotice: string | null;
  readonly orderNote: string;
  readonly searchComingSoon: string;
  readonly experienceComingSoon: string;
  readonly searchLegend: string;
  readonly searchQ: string;
  readonly searchSkills: string;
  readonly searchSkillsHint: string;
  readonly searchSkillMode: string;
  readonly searchYearsMin: string;
  readonly searchPriceMin: string;
  readonly searchPriceMax: string;
  readonly searchAvailableBy: string;
  readonly searchPrefecture: string;
  readonly searchRemote: string;
  readonly searchAvailability: string;
  readonly searchOnlyInTime: string;
  readonly searchOnlyCommutable: string;
  readonly searchCheckboxNote: string;
  readonly searchSubmit: string;
  readonly searchClear: string;
  readonly activeFiltersTitle: string;
  /** 「スキル: Java **を外す**」の接尾辞。 */
  readonly removeFilterSuffix: string;
  readonly register: string;
  readonly readOnlyNote: string;
  readonly columnName: string;
  readonly columnOwnership: string;
  readonly columnSkills: string;
  readonly columnUnitPrice: string;
  readonly columnAvailableFrom: string;
  readonly columnLocation: string;
  readonly columnAvailability: string;
  readonly columnUpdatedOn: string;
  readonly emptyTitle: string;
  readonly emptyLead: string;
  /** 🔴 絞り込みチェックボックスがオンで 0 件のときだけ（`docs/04` §10.1 `S-005`）。 */
  readonly emptyCheckboxNotice: string | null;
  readonly nextPage: string;
  readonly firstPage: string;
  /** 未設定（`docs/04` §S-006 と同じく、空欄にせず `—` を置く）。 */
  readonly valueNone: string;
};

/** デスクトップでだけ出す列（docs/04 §S-005「優先度の低い列（先に隠す）」）。 */
const DESKTOP_ONLY = 'hidden lg:table-cell';
/** タブレット以上で出す列。 */
const TABLET_UP = 'hidden sm:table-cell';

export function EngineerLedgerScreen({
  rows,
  filters,
  skillOptions,
  skillModeOptions,
  prefectureOptions,
  remoteOptions,
  availabilityOptions,
  activeFilters,
  showOwnershipColumn,
  canRegister,
  nextPageHref,
  firstPageHref,
  messages,
}: {
  readonly rows: readonly EngineerListRowView[];
  readonly filters: EngineerListFilterValues;
  /** スキル辞書（`F-010`。値は `Skill.id`）。 */
  readonly skillOptions: readonly EngineerFilterOption[];
  readonly skillModeOptions: readonly EngineerFilterOption[];
  readonly prefectureOptions: readonly EngineerFilterOption[];
  readonly remoteOptions: readonly EngineerFilterOption[];
  readonly availabilityOptions: readonly EngineerFilterOption[];
  /**
   * 🔴 いま効いている条件（`docs/04` §10.1 `S-005`「効いている条件を列挙して 1 つずつ外せる
   *    導線」）。空配列なら絞り込みが効いていない。
   */
  readonly activeFilters: readonly EngineerActiveFilterView[];
  /**
   * 🔴 取引先には所属区分の列を出さない（docs/04 §S-005 権限差分「全件が自社であるため
   *    意味がない」）。判定の出所は `ctx.partnerCompanyId` であり、行の値ではない。
   */
  readonly showOwnershipColumn: boolean;
  readonly canRegister: boolean;
  /** 次ページ（無ければ `null`）。🔴 検索条件を保った URL である（`engineerListHref`）。 */
  readonly nextPageHref: string | null;
  /** 2 ページ目以降でだけ「最初のページに戻る」を出す（無ければ `null`）。 */
  readonly firstPageHref: string | null;
  readonly messages: EngineerLedgerScreenMessages;
}) {
  return (
    <div data-testid="engineer-ledger-screen">
      {/* 🔴 検索条件（docs/04 §S-005 セクション 1）。`method="get"` なので、実行した検索が
          そのまま URL になり、共有・再読込・戻るのいずれでも同じ結果に戻る。 */}
      <form
        className="ses-filter-form"
        method="get"
        action="/engineers"
        data-testid="engineer-list-filters"
      >
        <fieldset className="contents">
          <legend className="sr-only">{messages.searchLegend}</legend>
          <label className="ses-field">
            <span>{messages.searchQ}</span>
            <input
              type="search"
              name="q"
              defaultValue={filters.q}
              data-testid="engineer-list-filter-q"
            />
          </label>
          <label className="ses-field">
            <span>{messages.searchSkills}</span>
            {/* 🔴 辞書からの選択のみ（自由入力は別名候補の起票であり `S-007` の責務。
                `F-010 AC-1`「採用されるまで検索の正規化に使われない」）。 */}
            <select
              name="skills"
              multiple
              size={5}
              defaultValue={[...filters.skills]}
              data-testid="engineer-list-filter-skills"
            >
              {skillOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
            <span className="text-xs text-slate-500">{messages.searchSkillsHint}</span>
          </label>
          <label className="ses-field">
            <span>{messages.searchSkillMode}</span>
            <select
              name="skillMode"
              defaultValue={filters.skillMode}
              data-testid="engineer-list-filter-skill-mode"
            >
              {skillModeOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <label className="ses-field">
            <span>{messages.searchYearsMin}</span>
            <input
              type="number"
              name="yearsMin"
              min={0}
              step={0.5}
              defaultValue={filters.yearsMin}
              data-testid="engineer-list-filter-years-min"
            />
          </label>
          <label className="ses-field">
            <span>{messages.searchPriceMin}</span>
            <input
              type="number"
              name="priceMin"
              min={0}
              step={10000}
              defaultValue={filters.priceMin}
              data-testid="engineer-list-filter-price-min"
            />
          </label>
          <label className="ses-field">
            <span>{messages.searchPriceMax}</span>
            <input
              type="number"
              name="priceMax"
              min={0}
              step={10000}
              defaultValue={filters.priceMax}
              data-testid="engineer-list-filter-price-max"
            />
          </label>
          <label className="ses-field">
            <span>{messages.searchAvailableBy}</span>
            <input
              type="date"
              name="availableBy"
              defaultValue={filters.availableBy}
              data-testid="engineer-list-filter-available-by"
            />
          </label>
          <label className="ses-field">
            <span>{messages.searchPrefecture}</span>
            <select
              name="prefecture"
              defaultValue={filters.prefecture}
              data-testid="engineer-list-filter-prefecture"
            >
              {prefectureOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <label className="ses-field">
            <span>{messages.searchRemote}</span>
            <select
              name="remote"
              defaultValue={filters.remote}
              data-testid="engineer-list-filter-remote"
            >
              {remoteOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <label className="ses-field">
            <span>{messages.searchAvailability}</span>
            <select
              name="availability"
              defaultValue={filters.availability}
              data-testid="engineer-list-filter-availability"
            >
              {availabilityOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          {/* 🔴 絞り込みチェックボックス 2 種（docs/04 §S-005 セクション 2）。**既定オフ**であり、
              オフのときに何が起きるかを直下に書く（`F-009 AC-5` / `docs/02` A-03）。 */}
          <div className="ses-field">
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                name="onlyInTime"
                value="1"
                defaultChecked={filters.onlyInTime}
                data-testid="engineer-list-filter-only-in-time"
              />
              <span>{messages.searchOnlyInTime}</span>
            </label>
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                name="onlyCommutable"
                value="1"
                defaultChecked={filters.onlyCommutable}
                data-testid="engineer-list-filter-only-commutable"
              />
              <span>{messages.searchOnlyCommutable}</span>
            </label>
            <span className="text-xs text-slate-500" data-testid="engineer-list-checkbox-note">
              {messages.searchCheckboxNote}
            </span>
          </div>
          <button type="submit" className="ses-submit" data-testid="engineer-list-search">
            {messages.searchSubmit}
          </button>
          {activeFilters.length === 0 ? null : (
            <Link className="ses-secondary-link" href="/engineers" data-testid="engineer-list-clear">
              {messages.searchClear}
            </Link>
          )}
        </fieldset>
      </form>

      {/* 🔴 母集団を 1 行で明示する（docs/04 §3.2 項目 2）。件数は API の `total` だけを使う。 */}
      <p className="mb-1 text-sm font-semibold text-slate-900" data-testid="engineer-list-population">
        {messages.populationLabel}
      </p>
      {messages.partnerScopeNotice === null ? null : (
        <p className="mb-1 text-sm text-slate-600" data-testid="engineer-list-partner-scope-notice">
          {messages.partnerScopeNotice}
        </p>
      )}
      {/* 🔴 並び順の説明（docs/04 §S-005）。スコア・順位・重みの語を含めない（`F-009 AC-2`）。 */}
      <p className="mb-3 text-sm text-slate-600" data-testid="engineer-list-order-note">
        {messages.orderNote}
      </p>

      {/* 🔴 まだ無い機能を黙って消さない（`engineers.careers.comingSoon` と同じ規律）。
          押しても効かない検索欄を描くより、いま何ができないのかを書く。 */}
      <p className="mb-2 text-sm text-slate-500" data-testid="engineer-list-search-coming-soon">
        {messages.searchComingSoon}
      </p>
      <p className="mb-4 text-sm text-slate-500" data-testid="engineer-list-experience-coming-soon">
        {messages.experienceComingSoon}
      </p>

      <div className="mb-4">
        {canRegister ? (
          <Link className="ses-secondary-link" href="/engineers/new" data-testid="engineer-list-register">
            {messages.register}
          </Link>
        ) : (
          <p className="text-sm text-slate-500" data-testid="engineer-list-read-only-note">
            {messages.readOnlyNote}
          </p>
        )}
      </div>

      {rows.length === 0 ? (
        // 🔴 docs/04 §10.1 `S-005`: **初回空と絞込 0 件は文言も導線も別物**である
        //    （文言の選び分けは `engineerLedgerScreenMessages`）。絞込 0 件のときは
        //    **効いている条件を 1 つずつ外せる導線**と、チェックボックスの注意を添える。
        <div
          className="border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700"
          data-testid="engineer-list-empty"
        >
          <p className="mb-1 font-semibold">{messages.emptyTitle}</p>
          <p className="m-0">{messages.emptyLead}</p>
          {messages.emptyCheckboxNotice === null ? null : (
            <p className="mt-2 mb-0" data-testid="engineer-list-empty-checkbox-notice">
              {messages.emptyCheckboxNotice}
            </p>
          )}
          {activeFilters.length === 0 ? null : (
            <div className="mt-3" data-testid="engineer-list-active-filters">
              <p className="mb-1 font-semibold">{messages.activeFiltersTitle}</p>
              <ul className="m-0 flex list-none flex-wrap gap-2 p-0">
                {activeFilters.map((filter) => (
                  <li key={filter.key}>
                    <Link
                      className="ses-secondary-link"
                      href={filter.href}
                      data-testid={`engineer-list-remove-filter-${filter.key}`}
                    >
                      {filter.label} {messages.removeFilterSuffix}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-sm" data-testid="engineer-list-table">
            <thead>
              <tr className="border-b border-slate-200 text-left text-slate-500">
                <th className="px-3 py-2 font-medium">{messages.columnName}</th>
                {showOwnershipColumn ? (
                  <th className={`px-3 py-2 font-medium ${DESKTOP_ONLY}`}>
                    {messages.columnOwnership}
                  </th>
                ) : null}
                <th className="px-3 py-2 font-medium">{messages.columnSkills}</th>
                <th className={`px-3 py-2 font-medium ${TABLET_UP}`}>{messages.columnUnitPrice}</th>
                <th className="px-3 py-2 font-medium">{messages.columnAvailableFrom}</th>
                <th className={`px-3 py-2 font-medium ${DESKTOP_ONLY}`}>
                  {messages.columnLocation}
                </th>
                <th className={`px-3 py-2 font-medium ${TABLET_UP}`}>
                  {messages.columnAvailability}
                </th>
                <th className={`px-3 py-2 font-medium ${DESKTOP_ONLY}`}>
                  {messages.columnUpdatedOn}
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr
                  key={row.id}
                  className="border-b border-slate-100"
                  data-testid={`engineer-list-row-${row.id}`}
                >
                  <td className="px-3 py-2">
                    {/* 🔴 行から詳細へ（docs/04 §S-005「行クリックで `S-006`」）。
                        **閲覧の監査記録は遷移先が書く**（`readEngineerDetail`。`BR-27`）。 */}
                    <Link
                      className="font-medium text-slate-900 underline"
                      href={`/engineers/${row.id}`}
                      data-testid={`engineer-list-link-${row.id}`}
                    >
                      {row.displayName}
                    </Link>
                  </td>
                  {showOwnershipColumn ? (
                    <td className={`px-3 py-2 whitespace-nowrap ${DESKTOP_ONLY}`}>
                      {row.ownership}
                    </td>
                  ) : null}
                  <td className="px-3 py-2">
                    {row.skills.length === 0 ? (
                      messages.valueNone
                    ) : (
                      <span className="flex flex-wrap gap-1">
                        {row.skills.map((skill) => (
                          <span key={skill} className="border border-slate-300 px-1.5 py-0.5 text-xs">
                            {skill}
                          </span>
                        ))}
                        {/* 🔴 超過は `+N`（docs/04 §S-005）。0 件のときは描かない。 */}
                        {row.moreSkills === null ? null : (
                          <span
                            className="px-1.5 py-0.5 text-xs text-slate-500"
                            data-testid={`engineer-list-more-skills-${row.id}`}
                          >
                            {row.moreSkills}
                          </span>
                        )}
                      </span>
                    )}
                  </td>
                  <td className={`px-3 py-2 whitespace-nowrap ${TABLET_UP}`}>{row.unitPrice}</td>
                  <td className="px-3 py-2 whitespace-nowrap">{row.availableFrom}</td>
                  <td className={`px-3 py-2 whitespace-nowrap ${DESKTOP_ONLY}`}>{row.location}</td>
                  <td className={`px-3 py-2 whitespace-nowrap ${TABLET_UP}`}>{row.availability}</td>
                  <td className={`px-3 py-2 whitespace-nowrap ${DESKTOP_ONLY}`}>{row.updatedOn}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* 🔴 カーソルページング（docs/05 §6.1）。**「全 N ページ中 M ページ目」を出さない** ——
          ページ番号は境界外の行を含む全体件数を前提にした概念であり、§4.8 の「順位」に当たる。
          🔴 リンクは**検索条件を保った URL** である（`engineerListHref`）。 */}
      {nextPageHref === null && firstPageHref === null ? null : (
        <nav className="mt-4 flex flex-wrap gap-4" data-testid="engineer-list-paging">
          {firstPageHref === null ? null : (
            <Link
              className="ses-secondary-link"
              href={firstPageHref}
              data-testid="engineer-list-first"
            >
              {messages.firstPage}
            </Link>
          )}
          {nextPageHref === null ? null : (
            <Link
              className="ses-secondary-link"
              href={nextPageHref}
              data-testid="engineer-list-next"
            >
              {messages.nextPage}
            </Link>
          )}
        </nav>
      )}
    </div>
  );
}
