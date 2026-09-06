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
//    並び順の説明は 1 行で常時出す（docs/04 §S-005）。
//
// 🔴 文言は props（`packages/i18n`）から受け取る。ここにベタ書きしない（`CLAUDE.md` §3.5）。
import Link from 'next/link';
import type { EngineerListRowView } from '../../../lib/engineers/list-rows';

export type EngineerLedgerScreenMessages = {
  readonly populationLabel: string;
  /** 🔴 取引先にだけ出す「見える範囲の説明」（`F-006 AC-2` と同じ規律）。ホストは `null`。 */
  readonly partnerScopeNotice: string | null;
  readonly orderNote: string;
  readonly searchComingSoon: string;
  readonly experienceComingSoon: string;
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
  showOwnershipColumn,
  canRegister,
  nextCursor,
  showFirstPageLink,
  messages,
}: {
  readonly rows: readonly EngineerListRowView[];
  /**
   * 🔴 取引先には所属区分の列を出さない（docs/04 §S-005 権限差分「全件が自社であるため
   *    意味がない」）。判定の出所は `ctx.partnerCompanyId` であり、行の値ではない。
   */
  readonly showOwnershipColumn: boolean;
  readonly canRegister: boolean;
  /** 次ページの起点（`GET /api/engineers` の `nextCursor`）。無ければ `null`。 */
  readonly nextCursor: string | null;
  /** 2 ページ目以降でだけ「最初のページに戻る」を出す。 */
  readonly showFirstPageLink: boolean;
  readonly messages: EngineerLedgerScreenMessages;
}) {
  return (
    <div data-testid="engineer-ledger-screen">
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
        // 🔴 docs/04 §10.1 `S-005` 初回空。**絞り込み 0 件とは別物**であり、絞り込みが入る
        //    T-06-04 まではこちらにしか到達しない。
        <div
          className="border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700"
          data-testid="engineer-list-empty"
        >
          <p className="mb-1 font-semibold">{messages.emptyTitle}</p>
          <p className="m-0">{messages.emptyLead}</p>
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
          ページ番号は境界外の行を含む全体件数を前提にした概念であり、§4.8 の「順位」に当たる。 */}
      {nextCursor === null && !showFirstPageLink ? null : (
        <nav className="mt-4 flex flex-wrap gap-4" data-testid="engineer-list-paging">
          {showFirstPageLink ? (
            <Link className="ses-secondary-link" href="/engineers" data-testid="engineer-list-first">
              {messages.firstPage}
            </Link>
          ) : null}
          {nextCursor === null ? null : (
            <Link
              className="ses-secondary-link"
              href={`/engineers?cursor=${encodeURIComponent(nextCursor)}`}
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
