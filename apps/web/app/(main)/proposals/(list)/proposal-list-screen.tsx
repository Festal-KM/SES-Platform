// apps/web/app/(main)/proposals/(list)/proposal-list-screen.tsx
// `S-019` 提案一覧 — 本体（docs/04 §S-019 / `F-024 AC-2` `AC-3` / docs/05 §6.5 #45 / §10.4）。T-09-09。
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
//   ⑥ 🔴 **一括承認・一括送信の操作を持たない**（`BR-50`。一括承認は本タスクでは置かない。T-09-11 / SP-12 の判断）。
//
// 🔴 **T2（モバイル閲覧可）**（docs/04 §S-019 デバイス別）。モバイル = 状態バッジ + エンジニア + 提案先 + 経過時間。タブレット = 6 列。
//    間引くのは補助列（案件 / 単価 / 作成者 / 最終更新）だけで、ブレークポイントは Tailwind の既定（`sm` / `lg`）のみ。
// 🔴 サーバコンポーネント（`'use client'` を持たない）。検索は素の `<form method="get">`（`S-010` と同じ「検索は同期」）。
//    文言は props（`packages/i18n`）で受け取る（`t()` を画面本体で呼ばない = render テストが文言の実体に依存しない）。
import Link from 'next/link';
import {
  Badge,
  Button,
  Checkbox,
  Field,
  Input,
  SECONDARY_LINK_CLASSES,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  type BadgeVariant,
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

/** モバイルで間引く補助列（判断材料ではない。`docs/04` §S-019 デバイス別）。 */
const TABLET_UP = 'hidden sm:table-cell';
const DESKTOP_ONLY = 'hidden lg:table-cell';

function StateChip({ chip, messages }: { readonly chip: ProposalStateChip; readonly messages: ProposalListScreenMessages }) {
  return (
    <label
      className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-1 text-sm text-slate-800 has-[:checked]:border-slate-900 has-[:checked]:bg-slate-900 has-[:checked]:text-white"
      data-testid={`proposal-list-state-chip-${chip.state}`}
      data-state={chip.state}
      data-indicator={chip.indicator}
      data-failure-kind={chip.failureKind ?? ''}
      data-checked={chip.checked ? 'true' : 'false'}
    >
      <Checkbox name="state" value={chip.state} defaultChecked={chip.checked} />
      <span>{chip.label}</span>
      <span className="text-xs opacity-80" data-testid={`proposal-list-state-count-${chip.state}`}>
        {messages.filterCountPrefix}
        {chip.count}
        {messages.filterCountSuffix}
      </span>
    </label>
  );
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
      <p className="mb-2 text-sm text-slate-600" data-testid="proposal-list-lead">
        {summary.lead}
      </p>
      <div className="mb-4 flex flex-wrap items-center gap-4">
        <span className="text-sm font-semibold text-slate-900" data-testid="proposal-list-total">
          {summary.total}
        </span>
        {/* 🔴 ③ `SUBMIT_FAILED` が 1 件以上のときだけ（ホストだけ）。 */}
        {summary.sendFailuresHref === null ? null : (
          <Link className={SECONDARY_LINK_CLASSES} href={summary.sendFailuresHref} data-testid="proposal-list-open-send-failures">
            {summary.sendFailuresLabel}
          </Link>
        )}
      </div>

      {/* 🔴 ① 状態フィルタ。14 状態が独立したチップ。 */}
      <form method="get" action={listHref} className="mb-6 flex flex-col gap-4" data-testid="proposal-list-filters">
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-1 text-sm font-semibold text-slate-900">{messages.filterStates}</legend>
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
            <input key={filter.name} type="hidden" name={filter.name} value={filter.value} data-testid={`proposal-list-hidden-${filter.name}`} />
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

      {/* 🔴 ① 提案依頼の 5 状態は**別のブロック**。表を絞り込まず `S-017` へ送る。 */}
      <section className="mb-6 rounded-md border border-slate-200 bg-slate-50 p-4" data-testid="proposal-list-requests">
        <h2 className="mb-1 text-sm font-semibold text-slate-900">{messages.requestsTitle}</h2>
        <p className="mb-3 text-xs text-slate-600">{messages.requestsLead}</p>
        <ul className="mb-3 flex flex-wrap gap-2">
          {requestChips.map((chip) => (
            <li key={chip.state}>
              <Link
                className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-1 text-sm text-slate-800 hover:border-slate-400"
                href={chip.href}
                data-testid={`proposal-list-request-chip-${chip.state}`}
                data-request-state={chip.state}
              >
                <span>{chip.label}</span>
                <span className="text-xs text-slate-500" data-testid={`proposal-list-request-count-${chip.state}`}>
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

      {rows.length === 0 ? (
        <div className="rounded-md border border-slate-200 bg-slate-50 p-6" data-testid="proposal-list-empty" data-filtered={filtered ? 'true' : 'false'}>
          <p className="text-sm font-semibold text-slate-900">{messages.emptyTitle}</p>
          {messages.emptyLead === null ? null : <p className="mt-1 text-sm text-slate-600">{messages.emptyLead}</p>}
          {messages.emptyOpenProjects === null ? null : (
            <Link className={`${SECONDARY_LINK_CLASSES} mt-3 inline-block`} href={projectsHref} data-testid="proposal-list-empty-open-projects">
              {messages.emptyOpenProjects}
            </Link>
          )}
        </div>
      ) : (
        <Table data-testid="proposal-list-table">
          <TableHeader>
            <TableRow>
              <TableHead>{messages.columnState}</TableHead>
              <TableHead>{messages.columnEngineer}</TableHead>
              <TableHead>{messages.columnRecipient}</TableHead>
              <TableHead className={TABLET_UP}>{messages.columnProject}</TableHead>
              <TableHead className={`${TABLET_UP} text-right`}>{messages.columnUnitPrice}</TableHead>
              <TableHead className={DESKTOP_ONLY}>{messages.columnCreatedBy}</TableHead>
              <TableHead className={DESKTOP_ONLY}>{messages.columnUpdatedAt}</TableHead>
              <TableHead>{messages.columnElapsed}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => (
              <TableRow
                key={row.id}
                data-testid={`proposal-list-row-${row.id}`}
                data-state={row.state}
                data-failure-kind={row.failureKind ?? ''}
                data-send-hold={row.hold === null ? '' : 'true'}
                data-in-progress={row.inProgress ? 'true' : 'false'}
                className={row.inProgress ? 'border-dashed' : undefined}
              >
                <TableCell>
                  <div className="flex flex-col items-start gap-1">
                    <Badge variant={TONE_VARIANTS[row.tone]} data-testid={`proposal-list-state-${row.id}`}>
                      {row.stateLabel}
                    </Badge>
                    {/* 🔴 ② 保留は `SUBMIT_FAILED` と別の印（状態は `承認済み` のまま）。 */}
                    {row.hold === null ? null : (
                      <span className="text-xs text-amber-800" data-testid={`proposal-list-hold-${row.id}`} title={row.hold.message}>
                        {row.hold.label}
                      </span>
                    )}
                    {row.inProgress ? <span className="text-xs text-slate-500">{messages.inProgress}</span> : null}
                    {row.stuckSubmitting ? (
                      <span className="text-xs text-amber-800" data-testid={`proposal-list-stuck-${row.id}`}>
                        {messages.stuckSubmitting}
                      </span>
                    ) : null}
                  </div>
                </TableCell>
                <TableCell>
                  <Link className={SECONDARY_LINK_CLASSES} href={row.href} data-testid={`proposal-list-link-${row.id}`}>
                    {row.engineer}
                  </Link>
                  {row.owner === null ? null : <div className="text-xs text-slate-500">{row.owner}</div>}
                </TableCell>
                <TableCell whitespace="normal" data-testid={`proposal-list-recipient-${row.id}`}>
                  {row.recipient}
                </TableCell>
                <TableCell className={TABLET_UP}>{row.project}</TableCell>
                <TableCell className={`${TABLET_UP} text-right`}>{row.unitPrice}</TableCell>
                <TableCell className={DESKTOP_ONLY}>{row.createdBy}</TableCell>
                <TableCell className={DESKTOP_ONLY}>{row.updatedAt}</TableCell>
                <TableCell>{row.elapsed}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      {nextPageHref !== null || firstPageHref !== null ? (
        <nav className="mt-4 flex flex-wrap items-center gap-4" data-testid="proposal-list-paging">
          {firstPageHref === null ? null : (
            <Link className={SECONDARY_LINK_CLASSES} href={firstPageHref} data-testid="proposal-list-first">
              {messages.firstPage}
            </Link>
          )}
          {nextPageHref === null ? null : (
            <Link className={SECONDARY_LINK_CLASSES} href={nextPageHref} data-testid="proposal-list-next">
              {messages.nextPage}
            </Link>
          )}
        </nav>
      ) : null}
    </div>
  );
}
