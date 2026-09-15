'use client';

// apps/web/app/(main)/proposal-requests/proposal-request-screen.tsx
// `S-017` 提案依頼の一覧 — 本体（docs/04 §S-017 / `F-018` / docs/05 §6.5 #32 / #35）。T-08-06。
//
// ============================================================================
// 🔴 この画面が守るもの（`docs/04` §S-017 / `F-018` / `CLAUDE.md` §3.1 経路 4）
// ============================================================================
//   ① 🔴 **ホストの行に依頼先の社名・`engineer_id`・辞退の理由を出す欄が無い。** 行の型
//      （`ProposalRequestRowView`）にそのフィールドが**存在しない**ので、描く枝が書けない（`F-018 AC-1`）。
//      候補列は「共有候補（匿名）」の一語（`row.candidate`。組み立ては `lib/proposal-requests/list-rows.ts`）。
//   ② 🔴 **`DECLINED` / `EXPIRED` / `WITHDRAWN_BY_HOST` は別のバッジ**（`F-018 AC-5` / `BR-60`）。
//      状態フィルタも 5 値 + 「すべて」であり、「失効」のような畳んだ選択肢を持たない。
//   ③ 🔴 **取り下げは確認 1 段で、`REQUESTED` の行にだけ導線がある**（`docs/04` §S-017「操作と結果」）。
//      判定は `row.canWithdraw`（状態）× `canAct`（ロール）× `denialMessage === null`（テナント状態）の 3 つ。
//      ⚠️ これは UI の配慮であり、拒否の本体は `#35` の 3 本のガードと `transition()` + CAS である。
//   ④ 取引先の応諾・辞退は `S-018`（T-08-07。`/proposal-requests/{id}`）。取引先の行の詳細パネルに導線を置く
//      （`row.respondHref`。ホストの行は `null` で描かれない）。応諾・辞退の可否は `S-018` 側が状態で決める。
//   ⑤ 🔴 T-08-07: **ホストの一覧は 60 秒ごとに読み直す**（`docs/04` §S-017「ホスト側の一覧はポーリングで反映
//      （60 秒）」）。実装は `page.tsx` が置く `PollingRefresher`（`router.refresh()`）であり、本コンポーネントは
//      選択状態を保ったままサーバの行が差し替わる。
//
// 🔴 **T1（モバイル完結）**（docs/04 §S-017 デバイス別 / `CLAUDE.md` §13.3）。
//    モバイル = 案件名 + 状態 + 残り時間の 3 列。**取り下げは詳細パネルにあり、モバイルでも押せる。**
//    間引くのは補助列（候補 / 依頼日 / 最終更新）だけで、ブレークポイントは Tailwind の既定（`sm` / `lg`）のみ。
//
// 🔴 期限までの残りは**クライアントで毎分再計算する**（`docs/04` §S-017 非同期処理の表現）。初回はサーバの時刻
//    （`nowMs`）で描き（hydration の不一致を作らない）、mount 後に端末時刻へ切り替える。
//    計算は `lib/proposal-requests/remaining.ts` の**同じ 1 関数**（サーバ側の行組み立てと二重にしない）。
// 🔴 変更後はページを再読込する（`engineer-share-screen.tsx` と同じ）。状態はサーバだけが正である。
// 🔴 `'use client'` は行の選択・確認ステップ・毎分更新のためだけである。**`@ses/db` に依存するモジュールから
//    値を import しない**（`tests/static/client-db-boundary.test.ts`）。文言は props（`packages/i18n`）で受け取る。
import { useEffect, useState, type KeyboardEvent } from 'react';
import Link from 'next/link';
import {
  Badge,
  Button,
  Field,
  SECONDARY_LINK_CLASSES,
  Select,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  type BadgeVariant,
} from '@ses/ui';
import type { ProposalRequestState } from '@ses/domain';
import type { ProposalRequestRowView } from '../../../lib/proposal-requests/list-rows';
import { formatRemaining, type RemainingLabels } from '../../../lib/proposal-requests/remaining';
import { FILTER_ACTIONS_CLASSES, FILTER_FORM_CLASSES } from '../_shared/filter-form-classes';

export type ProposalRequestScreenMessages = {
  readonly lead: string;
  readonly filterLegend: string;
  readonly filterState: string;
  readonly filterApply: string;
  readonly columnProject: string;
  readonly columnCandidate: string;
  readonly columnCreatedAt: string;
  readonly columnRemaining: string;
  readonly columnState: string;
  readonly columnUpdatedAt: string;
  readonly emptyTitle: string;
  /** ホストの初回空にだけ出す説明と導線（取引先・絞込 0 件は `null`）。 */
  readonly emptyLead: string | null;
  readonly emptyOpenProjects: string | null;
  readonly detailTitle: string;
  readonly detailSelect: string;
  readonly detailMessage: string;
  readonly detailExpiresAt: string;
  readonly detailCreatedAt: string;
  readonly detailUpdatedAt: string;
  readonly detailOpenProject: string;
  /** 🔴 T-08-07: 取引先の行から `S-018` へ進む導線の文言（行の `respondHref` が `null` でないときだけ描く）。 */
  readonly partnerRespond: string;
  readonly withdraw: string;
  readonly withdrawConfirmTitle: string;
  readonly withdrawConfirmLead: string;
  readonly withdrawConfirmSubmit: string;
  readonly withdrawConfirmCancel: string;
  readonly withdrawSubmitting: string;
  readonly withdrawError: string;
  readonly withdrawErrorState: string;
  readonly deniedTitle: string;
  readonly remaining: RemainingLabels;
  readonly remainingNone: string;
  readonly nextPage: string;
  readonly firstPage: string;
};

export type ProposalRequestScreenProps = {
  readonly rows: readonly ProposalRequestRowView[];
  readonly stateOptions: readonly { readonly value: string; readonly label: string }[];
  /** 選択中の状態フィルタ（`''` = すべて）。 */
  readonly stateValue: string;
  /** 絞り込みが効いているか（空状態の文言が変わる）。 */
  readonly filtered: boolean;
  /** 🔴 取り下げを行えるロールか（`PROPOSAL_REQUEST_ISSUER_ROLES`）。取引先・`VIEWER` は `false`。 */
  readonly canAct: boolean;
  /**
   * 🔴 実行系を止めている理由（`F-004 AC-7`）。`null` なら実行可。
   *    **拒否の本体は `#35` の `requireExecutable`** であり、これはその理由の表示である。
   */
  readonly denialMessage: string | null;
  /** サーバのリクエスト時刻（epoch ms）。初回描画の残り時間に使う。 */
  readonly nowMs: number;
  readonly projectsHref: string;
  readonly nextPageHref: string | null;
  readonly firstPageHref: string | null;
  readonly messages: ProposalRequestScreenMessages;
};

/** 状態バッジの色。🔴 5 値を別々に割り当てる（`Record` で漏れをコンパイラに強制させる）。 */
const STATE_BADGE_VARIANTS = {
  REQUESTED: 'warning',
  ACCEPTED: 'success',
  DECLINED: 'neutral',
  WITHDRAWN_BY_HOST: 'outline',
  EXPIRED: 'danger',
} as const satisfies Record<ProposalRequestState, BadgeVariant>;

/** モバイルで間引く補助列（判断材料ではない。`docs/04` §S-017 デバイス別）。 */
const TABLET_UP = 'hidden sm:table-cell';
const DESKTOP_ONLY = 'hidden lg:table-cell';

const REMAINING_TICK_MS = 60_000;

function DetailRow({ label, value, field }: { readonly label: string; readonly value: string; readonly field: string }) {
  return (
    <div className="flex gap-3 border-b border-slate-100 py-2 last:border-b-0">
      <dt className="w-24 shrink-0 text-slate-500">{label}</dt>
      <dd className="m-0 break-words text-slate-900" data-field={field}>
        {value}
      </dd>
    </div>
  );
}

export function ProposalRequestScreen({
  rows,
  stateOptions,
  stateValue,
  filtered,
  canAct,
  denialMessage,
  nowMs,
  projectsHref,
  nextPageHref,
  firstPageHref,
  messages,
}: ProposalRequestScreenProps) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // 🔴 初回はサーバの時刻（props）。mount 後に端末時刻へ切り替え、以後 1 分ごとに進める。
  const [now, setNow] = useState(nowMs);

  useEffect(() => {
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), REMAINING_TICK_MS);
    return () => clearInterval(timer);
  }, []);

  const selected = rows.find((row) => row.id === selectedId) ?? null;
  const canExecute = canAct && denialMessage === null;

  function remainingOf(row: ProposalRequestRowView): string {
    return row.state === 'REQUESTED'
      ? formatRemaining(row.expiresAtIso, now, messages.remaining)
      : messages.remainingNone;
  }

  function select(id: string): void {
    setError(null);
    setConfirming(false);
    setSelectedId(id);
  }

  function onRowKeyDown(event: KeyboardEvent<HTMLTableRowElement>, id: string): void {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      select(id);
    }
  }

  async function withdraw(id: string): Promise<void> {
    if (submitting || !canExecute) return;
    setSubmitting(true);
    setError(null);
    try {
      // 🔴 body を送らない（#35 は `{}` すら取らない。送るものが無い操作に入力を作らない）。
      const response = await fetch(`/api/proposal-requests/${id}/withdraw`, { method: 'POST' });
      if (!response.ok) {
        setSubmitting(false);
        // 🔴 422 = `REQUESTED` 以外からの取り下げ（遷移表に無い）。状態が動いたことを伝える。
        setError(response.status === 422 ? messages.withdrawErrorState : messages.withdrawError);
        return;
      }
      // 🔴 サーバの状態を読み直す（手元で行を書き換えない）。
      window.location.reload();
    } catch {
      setSubmitting(false);
      setError(messages.withdrawError);
    }
  }

  return (
    <div data-testid="proposal-request-screen">
      <p className="mb-4 text-sm text-slate-600" data-testid="proposal-request-lead">
        {messages.lead}
      </p>

      {/* 🔴 取り下げの権限は持つがテナント状態で止まっているときだけ理由を出す（`S-015` と同じ形）。 */}
      {canAct && denialMessage !== null ? (
        <div
          role="alert"
          className="mb-4 border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900"
          data-testid="proposal-request-denied"
        >
          <p className="font-bold">{messages.deniedTitle}</p>
          <p>{denialMessage}</p>
        </div>
      ) : null}

      {/* セクション 1: 状態フィルタ（同期の GET。`S-005` と同じ） */}
      <form className={FILTER_FORM_CLASSES} method="get" action="/proposal-requests" data-testid="proposal-request-filters">
        <fieldset className="contents">
          <legend className="sr-only">{messages.filterLegend}</legend>
          <Field label={messages.filterState}>
            <Select name="state" defaultValue={stateValue} data-testid="proposal-request-filter-state">
              {stateOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </Select>
          </Field>
          <div className={FILTER_ACTIONS_CLASSES}>
            <Button type="submit" data-testid="proposal-request-filter-apply">
              {messages.filterApply}
            </Button>
          </div>
        </fieldset>
      </form>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_20rem]">
        {/* セクション 2: テーブル */}
        <div>
          {rows.length === 0 ? (
            <div className="border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700" data-testid="proposal-request-empty">
              <p className="mb-1 font-semibold">{messages.emptyTitle}</p>
              {messages.emptyLead === null ? null : <p className="m-0">{messages.emptyLead}</p>}
              {filtered || messages.emptyOpenProjects === null ? null : (
                <Link className={`${SECONDARY_LINK_CLASSES} mt-2 inline-block`} href={projectsHref} data-testid="proposal-request-empty-open-projects">
                  {messages.emptyOpenProjects}
                </Link>
              )}
            </div>
          ) : (
            <Table data-testid="proposal-request-table">
              <TableHeader>
                <TableRow>
                  <TableHead>{messages.columnProject}</TableHead>
                  <TableHead className={TABLET_UP}>{messages.columnCandidate}</TableHead>
                  <TableHead className={TABLET_UP}>{messages.columnCreatedAt}</TableHead>
                  <TableHead>{messages.columnRemaining}</TableHead>
                  <TableHead>{messages.columnState}</TableHead>
                  <TableHead className={DESKTOP_ONLY}>{messages.columnUpdatedAt}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row) => (
                  <TableRow
                    key={row.id}
                    role="button"
                    tabIndex={0}
                    aria-selected={row.id === selectedId}
                    className="cursor-pointer"
                    data-state={row.id === selectedId ? 'selected' : undefined}
                    onClick={() => select(row.id)}
                    onKeyDown={(event) => onRowKeyDown(event, row.id)}
                    data-testid={`proposal-request-row-${row.id}`}
                    data-request-state={row.state}
                  >
                    <TableCell whitespace="normal" data-testid={`proposal-request-project-${row.id}`}>
                      {row.projectName}
                    </TableCell>
                    <TableCell className={TABLET_UP} whitespace="normal" data-testid={`proposal-request-candidate-${row.id}`}>
                      {row.candidate}
                    </TableCell>
                    <TableCell className={TABLET_UP}>{row.createdAt}</TableCell>
                    <TableCell data-testid={`proposal-request-remaining-${row.id}`}>{remainingOf(row)}</TableCell>
                    <TableCell>
                      <Badge variant={STATE_BADGE_VARIANTS[row.state]} data-testid={`proposal-request-state-${row.id}`}>
                        {row.stateLabel}
                      </Badge>
                    </TableCell>
                    <TableCell className={DESKTOP_ONLY}>{row.updatedAt}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}

          {/* 🔴 カーソルページング。「全 N ページ中 M ページ目」を出さない（docs/05 §4.8）。 */}
          {nextPageHref === null && firstPageHref === null ? null : (
            <nav className="mt-4 flex flex-wrap gap-4" data-testid="proposal-request-paging">
              {firstPageHref === null ? null : (
                <Link className={SECONDARY_LINK_CLASSES} href={firstPageHref} data-testid="proposal-request-first">
                  {messages.firstPage}
                </Link>
              )}
              {nextPageHref === null ? null : (
                <Link className={SECONDARY_LINK_CLASSES} href={nextPageHref} data-testid="proposal-request-next">
                  {messages.nextPage}
                </Link>
              )}
            </nav>
          )}
        </div>

        {/* セクション 3: 選択した依頼の詳細パネル（lg 以上は右、未満は一覧の下。取り下げはここ） */}
        <aside className="border border-slate-200 bg-white" data-testid="proposal-request-detail-panel">
          <h2 className="border-b border-slate-200 px-4 py-3 text-base font-bold text-slate-900">
            {messages.detailTitle}
          </h2>
          <div className="px-4 py-4">
            {selected === null ? (
              <p className="m-0 text-sm text-slate-600" data-testid="proposal-request-detail-empty">
                {messages.detailSelect}
              </p>
            ) : (
              <div data-testid="proposal-request-detail">
                <p className="mb-1 text-base font-semibold text-slate-900" data-testid="proposal-request-detail-project">
                  {selected.projectName}
                </p>
                <p className="mb-2 text-sm text-slate-700" data-testid="proposal-request-detail-candidate">
                  {selected.candidate}
                  <Badge className="ml-2" variant={STATE_BADGE_VARIANTS[selected.state]}>
                    {selected.stateLabel}
                  </Badge>
                </p>
                <dl className="mb-3 text-sm">
                  <DetailRow label={messages.detailMessage} value={selected.message} field="message" />
                  <DetailRow label={messages.detailExpiresAt} value={`${selected.expiresAt}（${remainingOf(selected)}）`} field="expires-at" />
                  <DetailRow label={messages.detailCreatedAt} value={selected.createdAt} field="created-at" />
                  <DetailRow label={messages.detailUpdatedAt} value={selected.updatedAt} field="updated-at" />
                </dl>
                {selected.projectId === null ? null : (
                  <Link className={SECONDARY_LINK_CLASSES} href={`/projects/${selected.projectId}`} data-testid="proposal-request-detail-open-project">
                    {messages.detailOpenProject}
                  </Link>
                )}

                {/* 🔴 T-08-07: 取引先の行は `S-018`（応諾・辞退）へ進む。ホストの行は `respondHref` が null で描かれない。 */}
                {selected.respondHref === null ? null : (
                  <div className="mt-4">
                    <Link
                      className="inline-block text-sm font-semibold text-slate-900 underline"
                      href={selected.respondHref}
                      data-testid="proposal-request-detail-respond"
                    >
                      {messages.partnerRespond}
                    </Link>
                  </div>
                )}

                {/* 🔴 取り下げ（ホスト × REQUESTED × 実行可）。確認は 1 段。 */}
                {selected.canWithdraw && canExecute ? (
                  <div className="mt-4">
                    {confirming ? (
                      <div
                        className="border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900"
                        data-testid="proposal-request-withdraw-confirm"
                      >
                        <p className="font-bold">{messages.withdrawConfirmTitle}</p>
                        <p>{messages.withdrawConfirmLead}</p>
                        <div className="mt-3 flex flex-wrap items-center gap-4">
                          <Button
                            type="button"
                            variant="secondary"
                            disabled={submitting}
                            onClick={() => withdraw(selected.id)}
                            data-testid="proposal-request-withdraw-submit"
                          >
                            {submitting ? messages.withdrawSubmitting : messages.withdrawConfirmSubmit}
                          </Button>
                          <button
                            type="button"
                            className={SECONDARY_LINK_CLASSES}
                            onClick={() => setConfirming(false)}
                            data-testid="proposal-request-withdraw-cancel"
                          >
                            {messages.withdrawConfirmCancel}
                          </button>
                        </div>
                      </div>
                    ) : (
                      <Button
                        type="button"
                        variant="secondary"
                        disabled={submitting}
                        onClick={() => {
                          setError(null);
                          setConfirming(true);
                        }}
                        data-testid="proposal-request-withdraw"
                      >
                        {messages.withdraw}
                      </Button>
                    )}
                  </div>
                ) : null}

                {error === null ? null : (
                  <p role="alert" className="mt-3 mb-0 text-sm text-red-700" data-testid="proposal-request-withdraw-error">
                    {error}
                  </p>
                )}
              </div>
            )}
          </div>
        </aside>
      </div>
    </div>
  );
}
