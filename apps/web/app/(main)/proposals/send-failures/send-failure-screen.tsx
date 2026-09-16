'use client';

// apps/web/app/(main)/proposals/send-failures/send-failure-screen.tsx
// `S-022` 送信失敗一覧と再送 — 本体（docs/04 §S-022 / `F-023` / docs/05 §6.5 #44 / §10.6）。T-09-08。
//
// ============================================================================
// 🔴 この画面が守るもの（`docs/04` §S-022 / `F-023 AC-1` `AC-2` / `BR-22` / `CLAUDE.md` §3.4 / §13.3）
// ============================================================================
//   ① 🔴 **`SUBMIT_FAILED` 専用**。行の出所は `listProposalSendFailures`（`where: { state: 'SUBMIT_FAILED' }`）であり、保留中
//      （`APPROVED` + `sendHoldReasonKey`）/ `GATE_FAILED` / `LOST` / `DECLINED` はここに来ない（`F-024 AC-2` の 4 区分）。
//   ② 🔴 **再送は確認ステップを必ず経る**（`F-023 AC-2`）: 「先方に届いている可能性があります」+ 提案先・エンジニア・単価・最終試行
//      日時の再掲 + 「届いていないことを確認した」のチェック + 理由の入力 → `acknowledged: true` で #44。チェックか理由が
//      無ければ**送らない**（API 側でも 400。`RESEND_NOT_ACKNOWLEDGED` / `VALIDATION`）。
//   ③ 🔴 **自動再送・一括再送に相当する導線が無い**（`F-023 AC-1` / `BR-50`）。行ごとの 1 操作だけであり、モバイルでも同じ
//      （`docs/04` §S-022 デバイス別「モバイルでも 1 件ずつの再送は可能。ただし確認ステップは省略せず、一括再送は表示しない」）。
//      ⚠️ デスクトップの一括再送も本タスクでは置かない（一括でも確認は 1 件ずつの内容を列挙する必要があり、T-09-09 以降の判断）。
//   ④ 🔴 **「応答不明」は「失敗」と別の見た目**（琥珀の注記 + `data-delivery-unknown`）。届いている可能性が最も高い区分であり、
//      再送の判断が変わる（`docs/04` §S-022 失敗理由の語）。
//   ⑤ 202 の後は **`S-021` へ遷移**する（送信中の表示は `S-021` が持つ。押した瞬間に「送信済み」と見せない）。
//   ⑥ 再送の導線は `canResend`（ロール）× `denialMessage === null`（テナント状態）のときだけ。`VIEWER` は閲覧のみ。
//      ⚠️ これは UI の配慮であり、拒否の本体は #44 のガード（`requireRole` / `requireExecutable` / `requireNotViewer`）と
//      `assertResendable` の 3 段 + CAS である。
//
// 🔴 **T2（モバイル閲覧可）**。モバイルでは補助列（案件 / 最終試行日時 / 試行回数）を間引くが、判断材料は詳細パネルに
//    すべて出す（`CLAUDE.md` §13.3「狭い画面を理由に判断材料を隠さない」）。ブレークポイントは Tailwind の既定（`sm` / `lg`）のみ。
// 🔴 `'use client'` は行の選択・確認ステップ・fetch のためだけである。**`@ses/db` に依存するモジュールから値を import しない**
//    （`tests/static/client-db-boundary.test.ts`）。行の型は `lib/proposals/send-failure-rows` から型だけを読む。
import { useState, type FormEvent, type KeyboardEvent } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  Badge,
  Button,
  Checkbox,
  Field,
  SECONDARY_LINK_CLASSES,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  Textarea,
} from '@ses/ui';
import type { SendFailureAttemptRowView, SendFailureRowView, SendFailureSummaryView } from '../../../../lib/proposals/send-failure-rows';

export type SendFailureScreenMessages = {
  readonly lead: string;
  readonly columnRecipient: string;
  readonly columnEngineer: string;
  readonly columnProject: string;
  readonly columnFailureKind: string;
  readonly columnLastAttemptAt: string;
  readonly columnElapsed: string;
  readonly columnAttemptCount: string;
  readonly emptyTitle: string;
  readonly emptyLead: string;
  readonly detailTitle: string;
  readonly detailSelect: string;
  readonly detailFailureKind: string;
  readonly detailFailureKindRaw: string;
  readonly detailLastAttemptAt: string;
  readonly detailAttemptCount: string;
  readonly detailUnitPrice: string;
  /** 試行ごとの記録の見出し（詳細パネル / 再送の確認ステップの両方で使う）。 */
  readonly detailAttemptsTitle: string;
  readonly detailOpenApproval: string;
  readonly detailOpenSendingDomain: string;
  readonly resend: string;
  readonly resendConfirmTitle: string;
  readonly resendConfirmLead: string;
  readonly resendAcknowledge: string;
  readonly resendReasonLabel: string;
  readonly resendConfirmSubmit: string;
  readonly resendConfirmCancel: string;
  readonly resendSubmitting: string;
  readonly resendErrorValidation: string;
  readonly resendErrorState: string;
  readonly resendErrorForbidden: string;
  readonly resendErrorSendBlocked: string;
  readonly resendErrorGeneric: string;
  readonly viewerNotice: string;
  readonly deniedTitle: string;
};

export type SendFailureScreenProps = {
  readonly rows: readonly SendFailureRowView[];
  readonly summary: SendFailureSummaryView;
  /** 🔴 再送を行えるロールか（`PROPOSAL_RESEND_ROLES`）。`VIEWER` は `false`（閲覧のみ）。 */
  readonly canResend: boolean;
  /**
   * 🔴 実行系を止めている理由（`F-004 AC-7`）。`null` なら実行可。
   *    **拒否の本体は #44 の `requireExecutable`** であり、これはその理由の表示である。
   */
  readonly denialMessage: string | null;
  /** 202 の後の遷移先の雛形（`{id}` を置き換える。`S-021`）。 */
  readonly approveHrefPattern: string;
  readonly messages: SendFailureScreenMessages;
};

/** モバイルで間引く補助列（判断材料は詳細パネルに再掲する。`docs/04` §S-022 デバイス別）。 */
const TABLET_UP = 'hidden sm:table-cell';
const DESKTOP_ONLY = 'hidden lg:table-cell';

const RESEND_REASON_MAX_LENGTH = 2_000;

type ErrorBody = { readonly error?: { readonly code?: string } };

function DetailRow({ label, value, field }: { readonly label: string; readonly value: string; readonly field: string }) {
  return (
    <div className="flex gap-3 border-b border-slate-100 py-2 last:border-b-0">
      <dt className="w-28 shrink-0 text-slate-500">{label}</dt>
      <dd className="m-0 break-words text-slate-900" data-field={field}>
        {value}
      </dd>
    </div>
  );
}

/**
 * 🔴 試行ごとの記録（詳細パネル / 再送の確認ステップの両方から使う。`data-testid="send-failure-attempt-<seq>"`）。
 *    行を選択しなくても直接描画できる純粋な表示に切り出している —— `renderToStaticMarkup` は
 *    クリックによる状態遷移（行の選択）を再現できないため（`send-failure-screen.render.test.tsx` 冒頭の注記と同じ理由）。
 */
export function SendFailureAttemptList({
  title,
  attempts,
}: {
  readonly title: string;
  readonly attempts: readonly SendFailureAttemptRowView[];
}) {
  if (attempts.length === 0) return null;
  return (
    <div className="mb-3">
      <p className="mb-1 text-sm font-semibold text-slate-900">{title}</p>
      <ul className="m-0 list-none border border-slate-200 p-0 text-sm" data-testid="send-failure-attempt-list">
        {attempts.map((attempt) => (
          <li
            key={attempt.seq}
            className="flex flex-wrap items-center gap-2 border-b border-slate-100 px-3 py-2 last:border-b-0"
            data-testid={`send-failure-attempt-${attempt.seq}`}
          >
            <span className="font-semibold text-slate-900">{attempt.statusLabel}</span>
            {attempt.failureLabel === null ? null : <span className="text-slate-700">{attempt.failureLabel}</span>}
            {attempt.settledAt === null ? null : <span className="text-slate-500">{attempt.settledAt}</span>}
            {attempt.externalId === null ? null : <span className="text-slate-400">{attempt.externalId}</span>}
          </li>
        ))}
      </ul>
    </div>
  );
}

export function SendFailureScreen({ rows, summary, canResend, denialMessage, approveHrefPattern, messages }: SendFailureScreenProps) {
  const router = useRouter();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [acknowledged, setAcknowledged] = useState(false);
  const [reason, setReason] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selected = rows.find((row) => row.id === selectedId) ?? null;
  const canExecute = canResend && denialMessage === null;
  const confirmReady = acknowledged && reason.trim().length > 0;

  function select(id: string): void {
    setError(null);
    setConfirming(false);
    setAcknowledged(false);
    setReason('');
    setSelectedId(id);
  }

  function onRowKeyDown(event: KeyboardEvent<HTMLTableRowElement>, id: string): void {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      select(id);
    }
  }

  function errorFor(status: number, code: string | undefined): string {
    if (code === 'RESEND_NOT_ACKNOWLEDGED' || status === 400) return messages.resendErrorValidation;
    if (code === 'SEND_JOB_BLOCKED') return messages.resendErrorSendBlocked;
    if (code === 'INVALID_STATE_TRANSITION' || code === 'PROPOSAL_TRANSITION_RESERVED') return messages.resendErrorState;
    if (status === 403) return messages.resendErrorForbidden;
    return messages.resendErrorGeneric;
  }

  async function resend(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (selected === null || submitting || !canExecute) return;
    // 🔴 確認のチェックと理由の両方が無ければ送らない（API 側でも 400）。
    if (!confirmReady) {
      setError(messages.resendErrorValidation);
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const response = await fetch(`/api/proposals/${selected.id}/resend`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        // 🔴 `acknowledged: true` はチェックの事実。宛先・本文・添付は送らない（行の値だけが決める）。
        body: JSON.stringify({ acknowledged: true, reason: reason.trim() }),
      });
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as ErrorBody | null;
        setSubmitting(false);
        setError(errorFor(response.status, body?.error?.code));
        return;
      }
      // 🔴 202 = 受け付け。「送信済み」と見せない。送信中の表示と確定は `S-021` が読み直して描く。
      router.push(approveHrefPattern.replace('{id}', selected.id));
    } catch {
      setSubmitting(false);
      setError(messages.resendErrorGeneric);
    }
  }

  return (
    <div data-testid="send-failure-screen" data-count={String(summary.count)} data-can-resend={canResend ? 'true' : 'false'}>
      <p className="mb-4 text-sm text-slate-600" data-testid="send-failure-lead">
        {messages.lead}
      </p>

      {/* 🔴 再送の権限は持つがテナント状態で止まっているときだけ理由を出す（`S-017` と同じ形）。 */}
      {canResend && denialMessage !== null ? (
        <div role="alert" className="mb-4 border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900" data-testid="send-failure-denied">
          <p className="font-bold">{messages.deniedTitle}</p>
          <p>{denialMessage}</p>
        </div>
      ) : null}
      {!canResend ? (
        <p className="mb-4 text-sm text-slate-600" data-testid="send-failure-viewer">
          {messages.viewerNotice}
        </p>
      ) : null}

      {/* セクション 1: 未対応の件数と最も古い経過時間 */}
      <div className="mb-4 flex flex-wrap items-baseline gap-4 text-sm" data-testid="send-failure-summary">
        <span className="font-semibold text-slate-900" data-testid="send-failure-summary-count">
          {summary.countLabel}
        </span>
        {summary.oldestElapsed === null ? null : (
          <span className="text-slate-700" data-testid="send-failure-summary-oldest">
            {summary.oldestElapsed}
          </span>
        )}
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_22rem]">
        {/* セクション 2: テーブル */}
        <div>
          {rows.length === 0 ? (
            <div className="border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700" data-testid="send-failure-empty">
              <p className="mb-1 font-semibold">{messages.emptyTitle}</p>
              <p className="m-0">{messages.emptyLead}</p>
            </div>
          ) : (
            <Table data-testid="send-failure-table">
              <TableHeader>
                <TableRow>
                  <TableHead>{messages.columnRecipient}</TableHead>
                  <TableHead>{messages.columnEngineer}</TableHead>
                  <TableHead className={TABLET_UP}>{messages.columnProject}</TableHead>
                  <TableHead>{messages.columnFailureKind}</TableHead>
                  <TableHead className={DESKTOP_ONLY}>{messages.columnLastAttemptAt}</TableHead>
                  <TableHead className={TABLET_UP}>{messages.columnElapsed}</TableHead>
                  <TableHead className={DESKTOP_ONLY}>{messages.columnAttemptCount}</TableHead>
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
                    data-testid={`send-failure-row-${row.id}`}
                    data-failure-category={row.failureCategory}
                    data-delivery-unknown={row.deliveryUnknown ? 'true' : 'false'}
                    data-repeated={row.repeated ? 'true' : 'false'}
                  >
                    <TableCell whitespace="normal" data-testid={`send-failure-recipient-${row.id}`}>
                      {row.recipient}
                    </TableCell>
                    <TableCell whitespace="normal" data-testid={`send-failure-engineer-${row.id}`}>
                      {row.engineer}
                    </TableCell>
                    <TableCell className={TABLET_UP} whitespace="normal">
                      {row.project}
                    </TableCell>
                    <TableCell whitespace="normal">
                      {/* 🔴 応答不明は失敗と別の色（琥珀）。届いている可能性が最も高い区分。 */}
                      <Badge variant={row.deliveryUnknown ? 'warning' : 'danger'} data-testid={`send-failure-kind-${row.id}`}>
                        {row.failureLabel}
                      </Badge>
                    </TableCell>
                    <TableCell className={DESKTOP_ONLY}>{row.lastAttemptAt}</TableCell>
                    <TableCell className={TABLET_UP}>{row.elapsed}</TableCell>
                    <TableCell className={DESKTOP_ONLY} data-testid={`send-failure-attempts-${row.id}`}>
                      {row.attemptCountLabel}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </div>

        {/* セクション 3: 選択した行の失敗理由と再送（lg 以上は右、未満は一覧の下） */}
        <aside className="border border-slate-200 bg-white" data-testid="send-failure-detail-panel">
          <h2 className="border-b border-slate-200 px-4 py-3 text-base font-bold text-slate-900">{messages.detailTitle}</h2>
          <div className="px-4 py-4">
            {selected === null ? (
              <p className="m-0 text-sm text-slate-600" data-testid="send-failure-detail-empty">
                {messages.detailSelect}
              </p>
            ) : (
              <div data-testid="send-failure-detail" data-failure-category={selected.failureCategory}>
                <p className="mb-1 text-base font-semibold text-slate-900" data-testid="send-failure-detail-recipient">
                  {selected.recipient}
                </p>
                <p className="mb-2 text-sm text-slate-700" data-testid="send-failure-detail-engineer">
                  {selected.engineer}
                </p>
                <dl className="mb-3 text-sm">
                  <DetailRow label={messages.detailFailureKind} value={selected.failureLabel} field="failure-kind" />
                  {selected.failureKindRaw === null ? null : (
                    <DetailRow label={messages.detailFailureKindRaw} value={selected.failureKindRaw} field="failure-kind-raw" />
                  )}
                  <DetailRow label={messages.detailLastAttemptAt} value={selected.lastAttemptAt} field="last-attempt-at" />
                  <DetailRow label={messages.detailAttemptCount} value={selected.attemptCountLabel} field="attempt-count" />
                  <DetailRow label={messages.detailUnitPrice} value={selected.unitPrice} field="unit-price" />
                </dl>
                <SendFailureAttemptList title={messages.detailAttemptsTitle} attempts={selected.attempts} />
                {/* 🔴 注記（応答不明 / 競合 / 繰り返し）。応答不明は「失敗」と別物として琥珀で描く。 */}
                {selected.notes.length === 0 ? null : (
                  <ul className="mb-3 list-disc border border-amber-300 bg-amber-50 py-2 pr-3 pl-7 text-sm text-amber-900" data-testid="send-failure-detail-notes">
                    {selected.notes.map((note) => (
                      <li key={note}>{note}</li>
                    ))}
                  </ul>
                )}
                <div className="flex flex-wrap items-center gap-4">
                  <Link className={SECONDARY_LINK_CLASSES} href={selected.approveHref} data-testid="send-failure-detail-open-approval">
                    {messages.detailOpenApproval}
                  </Link>
                  {selected.sendingDomainHref === null ? null : (
                    <Link className={SECONDARY_LINK_CLASSES} href={selected.sendingDomainHref} data-testid="send-failure-detail-open-sending-domain">
                      {messages.detailOpenSendingDomain}
                    </Link>
                  )}
                </div>

                {/* 🔴 再送（ホストの 3 ロール × 実行可）。確認ステップは省略しない（`F-023 AC-2`）。 */}
                {canExecute ? (
                  <div className="mt-4">
                    {confirming ? (
                      <form
                        onSubmit={(event) => void resend(event)}
                        className="border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900"
                        data-testid="send-failure-resend-confirm"
                      >
                        <p className="font-bold">{messages.resendConfirmTitle}</p>
                        <p>{messages.resendConfirmLead}</p>
                        {/* 🔴 提案先・エンジニア・単価・最終試行日時の再掲（`docs/04` §S-022 / §8.3）。 */}
                        <dl className="my-2 text-sm text-slate-900" data-testid="send-failure-resend-recap">
                          <DetailRow label={messages.columnRecipient} value={selected.recipient} field="recipient" />
                          <DetailRow label={messages.columnEngineer} value={selected.engineer} field="engineer" />
                          <DetailRow label={messages.detailUnitPrice} value={selected.unitPrice} field="unit-price" />
                          <DetailRow label={messages.detailLastAttemptAt} value={selected.lastAttemptAt} field="last-attempt-at" />
                        </dl>
                        <SendFailureAttemptList title={messages.detailAttemptsTitle} attempts={selected.attempts} />
                        <label className="mb-3 flex items-start gap-2 text-sm text-slate-900">
                          <Checkbox
                            name="acknowledged"
                            checked={acknowledged}
                            onChange={(event) => setAcknowledged(event.target.checked)}
                            className="mt-0.5"
                            data-testid="send-failure-resend-acknowledge"
                          />
                          <span>{messages.resendAcknowledge}</span>
                        </label>
                        <Field label={messages.resendReasonLabel} className="mb-3">
                          <Textarea
                            name="reason"
                            rows={3}
                            value={reason}
                            onChange={(event) => setReason(event.target.value)}
                            maxLength={RESEND_REASON_MAX_LENGTH}
                            required
                            data-testid="send-failure-resend-reason"
                          />
                        </Field>
                        <div className="flex flex-wrap items-center gap-4">
                          <Button type="submit" disabled={submitting || !confirmReady} data-testid="send-failure-resend-submit">
                            {submitting ? messages.resendSubmitting : messages.resendConfirmSubmit}
                          </Button>
                          <button
                            type="button"
                            className={SECONDARY_LINK_CLASSES}
                            disabled={submitting}
                            onClick={() => {
                              setConfirming(false);
                              setError(null);
                            }}
                            data-testid="send-failure-resend-cancel"
                          >
                            {messages.resendConfirmCancel}
                          </button>
                        </div>
                      </form>
                    ) : (
                      <Button
                        type="button"
                        variant="secondary"
                        disabled={submitting}
                        onClick={() => {
                          setError(null);
                          setConfirming(true);
                        }}
                        data-testid="send-failure-resend"
                      >
                        {messages.resend}
                      </Button>
                    )}
                  </div>
                ) : null}

                {error === null ? null : (
                  <p role="alert" className="mt-3 mb-0 text-sm text-red-700" data-testid="send-failure-resend-error">
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
