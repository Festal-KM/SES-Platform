// apps/web/app/(main)/proposals/(list)/proposal-list-screen.tsx
// `S-019` 提案一覧 — 本体（docs/04 §S-019 / `F-024 AC-2` `AC-3` / docs/05 §6.5 #45 / §10.4）。
// T-09-09 → **SP-22 `T-22-06`（一覧の適用 ①）**。
//
// ============================================================================
// 🔴 この画面が守るもの（`docs/04` §S-019 / `F-024 AC-2` / `BR-23` / `BR-60`）
// ============================================================================
//   ① 🔴 **4 つの「うまくいかなかった」を別の区分として描く。** 状態フィルタは 14 状態が**それぞれ独立したチェックボックス**であり
//      （`GATE_FAILED` = 差し戻し（検査で不合格）/ `SUBMIT_FAILED` = 送信失敗 / `LOST` = 見送り）、「失敗」のような畳んだ選択肢を持たない。
//      提案依頼の `DECLINED`（依頼を辞退）は**別のブロック**（`S-017` への導線）であり、提案の表もチップも絞り込まない。
//      行は `data-failure-kind`（3 値）を持ち、E2E / render テストが別区分であることを掴む。
//   ② 🔴 **保留（`APPROVED` + 保留理由）は `SUBMIT_FAILED` と別の印**（`data-send-hold` + 「送信を保留中」の注記。状態バッジは `承認済み` のまま）。
//      保留の行を「失敗」の語で描かない（docs/05 §10.4「失敗率の指標に混入させない」）。
//   ③ 🔴 **`SUBMIT_FAILED` が 1 件以上あるときだけ `S-022` への導線**（ホストだけ。取引先は `S-022` に到達しない）。
//   ④ 母集団の明示（ホスト = 自社と取引先の全提案 / 取引先 = 御社が作成した提案）。件数は境界適用後（`F-004 AC-4`）。
//   ⑤ 行 → `S-023`（提案詳細と履歴）。承認待ち・送信失敗の行からの直接の導線は `S-023` 側に置く（1 行に導線を 3 本並べない）。
//   ⑥ 🔴 **一括承認・一括送信の操作を持たない**（`BR-50` / `U-18`。一括承認は **Phase 2**）。
//
// ============================================================================
// 🔴 `T-22-06` で何が変わったか（**見せ方だけ**。`SP-22` §3.1）
// ============================================================================
// ローカルの `<Table>` → `@ses/ui` の **`DataTable`** / 母集団の帯 → **`Toolbar`** / ページ送り →
// **`Pagination`** / 空状態 → **`EmptyState`** / 幅 → **`PageBody widthClass="full"`**（クラス A）。
// 色と文字サイズは §7.9 の semantic トークンと 6 トークンへ寄せた。
//
// 🔴 **`selection` を渡さない**（`U-18`: **選択チェックボックスも「選択した提案を承認」も描かない。**
//    disabled で置くのでもなく、存在しない）。検査 (m)③ が「渡している呼び出しが 0 件」を見る。
// 🔴 **状態の絞り込みはフィルタであってタブではない**（§10.3「多数タブ」: 14 状態をタブにしない。
//    `Tabs` を import しない）。
// 🔴 **列を 1 つも増減させていない**（受け入れ基準 2）。`hidden lg:table-cell` の直書きを列定義の
//    `priority` に移しただけである（§S-019「デバイス別」= モバイル 4 / タブレット 6 / デスクトップ 8）:
//
//   | # | 列 | `priority` | 根拠 |
//   |---|---|---|---|
//   | 1 | 状態 | `always` | モバイル 4 列（状態バッジ + エンジニア + 提案先 + 経過時間） |
//   | 2 | エンジニア | `always` | 同上 |
//   | 3 | 提案先 | `always` | 同上 |
//   | 4 | 案件 | `sm` | タブレット 6 列で戻る |
//   | 5 | 単価 | `sm` | 同上 |
//   | 6 | 作成者 | `lg` | §10.3「優先度の低い列: 作成者 → …」 |
//   | 7 | 最終更新 | `lg` | 同上 |
//   | 8 | 経過時間 | `always` | 🔴 **モバイルに残す**（§S-019「デバイス別」が正。`検査中` /
//        `送信中` の滞留はここでしか読めない。§10.3 の列挙は「隠す順序」であって、
//        **画面固有のデバイス別の定めを上書きしない** —— `S-005` / `S-015` と同じ扱い） |
//
// ⚠️ **名称の 3 列（提案先 / エンジニア / 案件）を `NameCell` に委譲していない**（§10.3 は「切り詰める列」と
//    定めるが、`U-16` の規約は「**切り詰め + 全文へ到達する導線**」の**組**である）:
//      - エンジニア列は `S-023` への導線に加えて**作成会社の 1 行**（`row.owner`。ホストのみ）を持つ。
//        `NameCell` は名称 1 つだけを描くので、委譲すると**表示項目が 1 つ減る**（受け入れ基準 2 違反）。
//      - 提案先・案件には詳細画面への導線が無く、`NameCell` の `href={null}` の枝は
//        **どのブレークポイントでも折り返し**（§11-14 の 🔴）であり、現行の描き方と同じ結果になる。
//    🔴 したがって**判断材料は 1 つも隠れていない**。`T-22-11`（`S-023` / `S-020` の刷新）で導線の形が
//    変わるなら、そのときに併せて見直す。
//
// 🔴 **T2（モバイル閲覧可）**。🔴 サーバコンポーネント（`'use client'` を持たない）。検索は素の
//    `<form method="get">`（`S-010` と同じ「検索は同期」）。文言は props（`packages/i18n`）で受け取る
//    （`t()` を画面本体で呼ばない = render テストが文言の実体に依存しない）。
import Link from 'next/link';
import {
  Badge,
  Button,
  Checkbox,
  DataTable,
  EmptyState,
  Field,
  FOCUS_RING_CLASSES,
  Input,
  Pagination,
  SECONDARY_LINK_CLASSES,
  TRANSITION_CLASSES,
  Toolbar,
  cn,
  type BadgeVariant,
  type DataTableColumn,
  type EmptyStateLinkProps,
  type PaginationLinkProps,
} from '@ses/ui';
import type {
  ProposalListRowView,
  ProposalListSummaryView,
  ProposalRequestStateChip,
  ProposalStateChip,
  ProposalStateTone,
} from '../../../../lib/proposals/list-rows';

export type ProposalListScreenMessages = {
  readonly filterLegend: string;
  readonly filterStates: string;
  readonly filterQ: string;
  readonly filterApply: string;
  readonly filterClear: string;
  readonly filterCountPrefix: string;
  readonly filterCountSuffix: string;
  readonly requestsTitle: string;
  readonly requestsLead: string;
  readonly requestsOpen: string;
  readonly columnRecipient: string;
  readonly columnEngineer: string;
  readonly columnProject: string;
  readonly columnState: string;
  readonly columnUnitPrice: string;
  readonly columnCreatedBy: string;
  readonly columnUpdatedAt: string;
  readonly columnElapsed: string;
  readonly inProgress: string;
  readonly stuckSubmitting: string;
  readonly emptyTitle: string;
  /** 初回空にだけ出す説明と導線（絞込 0 件は `null`）。 */
  readonly emptyLead: string | null;
  readonly emptyOpenProjects: string | null;
  readonly nextPage: string;
  readonly firstPage: string;
};

export type ProposalListScreenProps = {
  readonly audience: 'HOST' | 'PARTNER';
  readonly rows: readonly ProposalListRowView[];
  readonly summary: ProposalListSummaryView;
  readonly stateChips: readonly ProposalStateChip[];
  /** 🔴 提案依頼の 5 状態（別ブロック）。 */
  readonly requestChips: readonly ProposalRequestStateChip[];
  readonly requestsHref: string;
  /** 検索欄の現在値（`''` = 指定なし）。 */
  readonly qValue: string;
  /** URL で固定された絞り込み（案件 / エンジニア）。フォームの hidden に載せて絞り込みを保つ。 */
  readonly hiddenFilters: readonly { readonly name: 'projectId' | 'engineerId'; readonly value: string }[];
  readonly filtered: boolean;
  readonly listHref: string;
  readonly projectsHref: string;
  readonly nextPageHref: string | null;
  readonly firstPageHref: string | null;
  readonly messages: ProposalListScreenMessages;
};

/** 色味 → バッジ。🔴 `progress` は進行中（点線枠 = `outline` の枝で描く）。 */
const TONE_VARIANTS = {
  neutral: 'neutral',
  progress: 'outline',
  success: 'success',
  warning: 'warning',
  danger: 'danger',
} as const satisfies Record<ProposalStateTone, BadgeVariant>;

/**
 * 状態フィルタのチップ（`<label>` + チェックボックス）。
 * 🔴 選択中の見え方は §7.10 の `selected`（**背景 `--color-brand-bg` + 文字 `--color-brand`**）に
 *    合わせる。`has-[:checked]:` は 8 状態の `hover` / `focus` ではないので画面に書ける
 *    （検査 (j) の対象はプリミティブが持つ 6 バリアントである）。
 * 🔴 色は semantic トークンだけ（§7.9。`slate-900` のような実色を書かない）。
 */
const STATE_CHIP_CLASSES = cn(
  'inline-flex items-center gap-2 rounded-md border border-border bg-bg px-3 py-1 text-body text-fg',
  'has-[:checked]:border-brand has-[:checked]:bg-brand-bg has-[:checked]:text-brand',
  TRANSITION_CLASSES,
);

/** 提案依頼のチップ（リンク）。🔴 8 状態はプリミティブの語（`FOCUS_RING_CLASSES`）に委ねる。 */
const REQUEST_CHIP_CLASSES = cn(
  'inline-flex items-center gap-2 rounded-md border border-border bg-bg px-3 py-1 text-body text-fg',
  TRANSITION_CLASSES,
  FOCUS_RING_CLASSES,
);

/**
 * ページ送りのリンク。🔴 **凍結済み testid の維持**（`docs/04` `U-22` / `SP-22` §3.2 の代替 ④）:
 * `Pagination` は `proposal-list-pagination-prev` / `…-next` を出すが、凍結されている値は
 * **`proposal-list-first` / `proposal-list-next`** である。
 */
function ProposalPagingLink({ href, className, children, 'data-testid': testId }: PaginationLinkProps) {
  return (
    <Link
      href={href}
      className={className}
      data-testid={testId === undefined || testId.endsWith('-prev') ? 'proposal-list-first' : 'proposal-list-next'}
    >
      {children}
    </Link>
  );
}

/**
 * 初回空の Secondary（`S-010` へ戻る導線）。
 * 🔴 **凍結済み testid の維持**（`U-22`）: `EmptyState` は `…-empty-state-secondary` を出すが、
 *    凍結されている値は **`proposal-list-empty-open-projects`** である。`EmptyState` が
 *    `linkComponent` を使うのは `secondary` の 1 本だけなので、ここで固定してよい。
 */
function ProposalEmptyLink({ href, className, children }: EmptyStateLinkProps) {
  return (
    <Link href={href} className={className} data-testid="proposal-list-empty-open-projects">
      {children}
    </Link>
  );
}

function StateChip({ chip, messages }: { readonly chip: ProposalStateChip; readonly messages: ProposalListScreenMessages }) {
  return (
    <label
      className={STATE_CHIP_CLASSES}
      data-testid={`proposal-list-state-chip-${chip.state}`}
      data-state={chip.state}
      data-indicator={chip.indicator}
      data-failure-kind={chip.failureKind ?? ''}
      data-checked={chip.checked ? 'true' : 'false'}
    >
      <Checkbox name="state" value={chip.state} defaultChecked={chip.checked} />
      <span>{chip.label}</span>
      <span className="text-xs text-fg-muted" data-testid={`proposal-list-state-count-${chip.state}`}>
        {messages.filterCountPrefix}
        {chip.count}
        {messages.filterCountSuffix}
      </span>
    </label>
  );
}

/**
 * 列定義（🔴 **ファイル冒頭の表をそのまま写す**。§S-019「デバイス別」/ §10.3 の `S-019` の行）。
 * 🔴 **画面に `hidden lg:table-cell` を書かない**（検査 (m)④）。
 */
function proposalColumns(
  messages: ProposalListScreenMessages,
): readonly DataTableColumn<ProposalListRowView>[] {
  return [
    {
      id: 'state',
      header: messages.columnState,
      priority: 'always',
      minWidth: '9rem',
      whitespace: 'normal',
      cell: (row) => (
        <div className="flex flex-col items-start gap-1">
          <Badge variant={TONE_VARIANTS[row.tone]} data-testid={`proposal-list-state-${row.id}`}>
            {row.stateLabel}
          </Badge>
          {/* 🔴 ② 保留は `SUBMIT_FAILED` と別の印（状態は `承認済み` のまま）。 */}
          {row.hold === null ? null : (
            <span className="text-xs text-warning" data-testid={`proposal-list-hold-${row.id}`} title={row.hold.message}>
              {row.hold.label}
            </span>
          )}
          {row.inProgress ? <span className="text-xs text-fg-muted">{messages.inProgress}</span> : null}
          {row.stuckSubmitting ? (
            <span className="text-xs text-warning" data-testid={`proposal-list-stuck-${row.id}`}>
              {messages.stuckSubmitting}
            </span>
          ) : null}
        </div>
      ),
    },
    {
      id: 'engineer',
      header: messages.columnEngineer,
      priority: 'always',
      minWidth: '10rem',
      whitespace: 'normal',
      // ⚠️ `NameCell` に委譲しない理由はファイル冒頭の ⚠️（作成会社の 1 行を失わないため）。
      cell: (row) => (
        <>
          <Link className={SECONDARY_LINK_CLASSES} href={row.href} data-testid={`proposal-list-link-${row.id}`}>
            {row.engineer}
          </Link>
          {row.owner === null ? null : <div className="text-xs text-fg-muted">{row.owner}</div>}
        </>
      ),
    },
    {
      id: 'recipient',
      header: messages.columnRecipient,
      priority: 'always',
      minWidth: '10rem',
      whitespace: 'normal',
      cell: (row) => <span data-testid={`proposal-list-recipient-${row.id}`}>{row.recipient}</span>,
    },
    {
      id: 'project',
      header: messages.columnProject,
      priority: 'sm',
      minWidth: '10rem',
      // 🔴 余りはこの列に配分する（§7.1 の `2xl`「列幅のゆとりに使う」）。
      grow: true,
      cell: (row) => row.project,
    },
    {
      id: 'unitPrice',
      header: messages.columnUnitPrice,
      priority: 'sm',
      // 🔴 単価は円単位・3 桁区切り（§10.3「大きい数値」）。数値は右寄せで桁を揃える。
      minWidth: '8rem',
      cell: (row) => <span className="block text-right">{row.unitPrice}</span>,
    },
    {
      id: 'createdBy',
      header: messages.columnCreatedBy,
      priority: 'lg',
      minWidth: '7rem',
      cell: (row) => row.createdBy,
    },
    {
      id: 'updatedAt',
      header: messages.columnUpdatedAt,
      priority: 'lg',
      minWidth: '8rem',
      cell: (row) => row.updatedAt,
    },
    {
      id: 'elapsed',
      header: messages.columnElapsed,
      priority: 'always',
      minWidth: '6rem',
      cell: (row) => row.elapsed,
    },
  ];
}

export function ProposalListScreen({
  audience,
  rows,
  summary,
  stateChips,
  requestChips,
  requestsHref,
  qValue,
  hiddenFilters,
  filtered,
  listHref,
  projectsHref,
  nextPageHref,
  firstPageHref,
  messages,
}: ProposalListScreenProps) {
  return (
    <div data-testid="proposal-list-screen" data-audience={audience}>
      <p className="mb-2 text-body text-fg-muted" data-testid="proposal-list-lead">
        {summary.lead}
      </p>

      {/* 🔴 §5-13 の `Toolbar`: **母集団の 1 行（④）と状態フィルタの帯の置き場所をここに固定する。**
          ⚠️ **凍結済み testid の併記**（`U-22` / `SP-22` §3.2 の代替 ④）: `Toolbar` は母集団の 1 行を
             `proposal-list-toolbar-population` として描くが、凍結されている値は
             **`proposal-list-total`** である（件数の 1 行そのもの）。 */}
      <div data-testid="proposal-list-total">
        <Toolbar
          testIdPrefix="proposal-list-"
          population={summary.total}
          filters={
            /* 🔴 ① 状態フィルタ。14 状態が独立したチップ（**タブにしない**。§10.3「多数タブ」）。 */
            <form
              method="get"
              action={listHref}
              className="flex w-full flex-col gap-4"
              data-testid="proposal-list-filters"
            >
              <fieldset className="flex flex-col gap-2">
                <legend className="mb-1 text-body font-semibold text-fg">{messages.filterStates}</legend>
                <div className="flex flex-wrap gap-2" data-testid="proposal-list-state-chips">
                  {stateChips.map((chip) => (
                    <StateChip key={chip.state} chip={chip} messages={messages} />
                  ))}
                </div>
              </fieldset>
              <div className="grid grid-cols-1 items-end gap-4 sm:grid-cols-2 lg:grid-cols-3">
                <Field label={messages.filterQ}>
                  <Input name="q" type="search" defaultValue={qValue} data-testid="proposal-list-q" />
                </Field>
                {hiddenFilters.map((filter) => (
                  <input
                    key={filter.name}
                    type="hidden"
                    name={filter.name}
                    value={filter.value}
                    data-testid={`proposal-list-hidden-${filter.name}`}
                  />
                ))}
                <div className="flex flex-wrap items-center gap-4">
                  <Button type="submit" data-testid="proposal-list-filter-apply">
                    {messages.filterApply}
                  </Button>
                  {filtered ? (
                    <Link className={SECONDARY_LINK_CLASSES} href={listHref} data-testid="proposal-list-filter-clear">
                      {messages.filterClear}
                    </Link>
                  ) : null}
                </div>
              </div>
            </form>
          }
        />
      </div>

      {/* 🔴 ③ `SUBMIT_FAILED` が 1 件以上のときだけ（ホストだけ）。 */}
      {summary.sendFailuresHref === null ? null : (
        <div className="mt-2 mb-4">
          <Link
            className={SECONDARY_LINK_CLASSES}
            href={summary.sendFailuresHref}
            data-testid="proposal-list-open-send-failures"
          >
            {summary.sendFailuresLabel}
          </Link>
        </div>
      )}

      {/* 🔴 ① 提案依頼の 5 状態は**別のブロック**。表を絞り込まず `S-017` へ送る。 */}
      <section className="mt-4 mb-6 rounded-md border border-border bg-bg-subtle p-4" data-testid="proposal-list-requests">
        <h2 className="mb-1 text-body font-semibold text-fg">{messages.requestsTitle}</h2>
        <p className="mb-3 text-xs text-fg-muted">{messages.requestsLead}</p>
        <ul className="mb-3 flex flex-wrap gap-2">
          {requestChips.map((chip) => (
            <li key={chip.state}>
              <Link
                className={REQUEST_CHIP_CLASSES}
                href={chip.href}
                data-testid={`proposal-list-request-chip-${chip.state}`}
                data-request-state={chip.state}
              >
                <span>{chip.label}</span>
                <span className="text-xs text-fg-muted" data-testid={`proposal-list-request-count-${chip.state}`}>
                  {messages.filterCountPrefix}
                  {chip.count}
                  {messages.filterCountSuffix}
                </span>
              </Link>
            </li>
          ))}
        </ul>
        <Link className={SECONDARY_LINK_CLASSES} href={requestsHref} data-testid="proposal-list-open-requests">
          {messages.requestsOpen}
        </Link>
      </section>

      <DataTable
        testIdPrefix="proposal-list-"
        columns={proposalColumns(messages)}
        rows={rows}
        rowKey={(row) => row.id}
        linkComponent={Link}
        // 🔴 行の属性（① の 3 区分 / ② の保留 / 進行中）。**E2E がこの 4 つで「失敗と保留は別の印」を
        //    検証している**（`tests/e2e/proposal-cycle.spec.ts` / `home.mobile.spec.ts`。docs/05 §10.4）。
        rowAttributes={(row) => ({
          'data-state': row.state,
          'data-failure-kind': row.failureKind ?? '',
          'data-send-hold': row.hold === null ? '' : 'true',
          'data-in-progress': row.inProgress ? 'true' : 'false',
          // 🔴 進行中の表現（点線枠。§S-019 非同期処理の表現）。
          className: row.inProgress ? 'border-dashed' : undefined,
        })}
        empty={
          // 🔴 docs/04 §10.1 `S-019`: 初回空は導線つき、絞り込み 0 件は条件の解除だけ（文言の
          //    選び分けは `list-props.ts`）。⚠️ 器の `data-testid` は凍結済みの
          //    `proposal-list-empty` である（`U-22`）。`data-filtered` も維持する。
          <div data-testid="proposal-list-empty" data-filtered={filtered ? 'true' : 'false'}>
            <EmptyState
              testIdPrefix="proposal-list-empty-state-"
              description={messages.emptyLead === null ? messages.emptyTitle : `${messages.emptyTitle}${messages.emptyLead}`}
              secondary={
                messages.emptyOpenProjects === null
                  ? undefined
                  : { href: projectsHref, label: messages.emptyOpenProjects }
              }
              linkComponent={ProposalEmptyLink}
            />
          </div>
        }
      />

      {/* ⚠️ 器の `data-testid` は凍結済みの `proposal-list-paging` である（`U-22`）。 */}
      {nextPageHref !== null || firstPageHref !== null ? (
        <div className="mt-4" data-testid="proposal-list-paging">
          <Pagination
            testIdPrefix="proposal-list-"
            nextHref={nextPageHref}
            nextLabel={messages.nextPage}
            prevHref={firstPageHref}
            prevLabel={messages.firstPage}
            linkComponent={ProposalPagingLink}
          />
        </div>
      ) : null}
    </div>
  );
}
