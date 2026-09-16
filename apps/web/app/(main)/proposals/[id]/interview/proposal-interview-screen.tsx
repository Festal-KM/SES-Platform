'use client';

// apps/web/app/(main)/proposals/[id]/interview/proposal-interview-screen.tsx
// `S-024` 商談結果の記録 — 本体（docs/04 §S-024 / `F-025 AC-1`〜`AC-3` / docs/05 §6.5 #48「`S-024` の実装の決着（T-09-10）」）。
// T-09-10。🔴 **Tier 1（モバイル完結）。**
//
// ============================================================================
// 🔴 この画面が守るもの（`docs/04` §S-024 / `F-025` / `CLAUDE.md` §4.2 / §13.3）
// ============================================================================
//   ① 🔴 **現在の状態に応じて「次に記録できる遷移」だけをボタンで出す。** 候補は `proposalInterviewRows`（遷移表 × #48 の射程 ×
//      立場）がサーバで決め、この画面は並べるだけである。取引先には面談日程の確定・結果の確定のボタンが**来ない**（props に無い）。
//   ② 🔴 **結果（決定 / 見送り / 辞退）はこの画面の操作でのみ確定する。** 期限・未返答で自動確定する仕組みも設定も無い（`F-025 AC-1`）。
//   ③ 🔴 **終端（`WON` / `LOST` / `WITHDRAWN`）は確認ステップを経る**（戻れない）。確認には提案先・エンジニア・単価を再掲する。
//   ④ 🔴 **`note` は利用者が書いたものと状態を表す固定の語だけで組む**（`buildProposalInterviewNote`）。単価・本文・氏名を画面が
//      勝手に混ぜない。送る前に「履歴に残る記録」として同じ文字列を見せる。
//   ⑤ 🔴 判断材料（提案先 / エンジニア / 案件 / 単価 / 開始日 / 現在の状態 / 直近の履歴）を同一画面に置く。モバイルでも 1 本の
//      縦スクロールで、折りたたみ・タブに入れない。ボタンはタップ幅（`min-h-11` / モバイルは全幅）。
//   ⑥ 成功後は手元で状態を書き換えず `router.refresh()`（サーバの状態が正）。422（状態が動いていた）は #46 で現在の状態を読み、
//      「この操作はいまの状態では実行できません（現在: …）」と伝えてから読み直す（`docs/04` §S-024 エラー / `F-024 AC-1`）。
//   ⑦ 🔴 `WON` の後は `Assignment` を作らない（Phase 2 `F-042`）。注記だけを出す。
//
// 🔴 `'use client'` は操作フォームのためだけである。**`@ses/db` に依存するモジュールから値を import しない**
//    （`tests/static/client-db-boundary.test.ts`）。`interview-note.ts` は import を持たない純粋モジュール。文言と表示値は props で受け取る。
// 🔴 応答の `messageKey` を UI で解釈しない。文言は応答コード（`error.code`）と HTTP 状態で選ぶ。
import { useState, type FormEvent } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Badge, Button, Field, Input, SECONDARY_LINK_CLASSES, Textarea, type BadgeVariant } from '@ses/ui';
import type { ProposalState } from '@ses/domain';
import type { ProposalStateTone, ProposalTimelineRow } from '../../../../../lib/proposals/detail-rows';
import {
  buildProposalInterviewNote,
  isInterviewInputComplete,
  type ProposalInterviewNoteInput,
  type ProposalInterviewNoteLabels,
} from '../../../../../lib/proposals/interview-note';
import type { ProposalInterviewOperation, ProposalInterviewRows } from '../../../../../lib/proposals/interview-rows';

export type ProposalInterviewScreenMessages = {
  readonly lead: string;
  readonly sectionSummary: string;
  readonly sectionRecent: string;
  readonly sectionOperations: string;
  readonly fieldState: string;
  readonly recentEmpty: string;
  readonly recentOpenDetail: string;
  readonly backToDetail: string;
  readonly inputScheduledAt: string;
  readonly inputInterviewedOn: string;
  readonly inputMemo: string;
  readonly inputReason: string;
  readonly inputMemoHint: string;
  readonly notePreview: string;
  readonly notePreviewNone: string;
  readonly submit: string;
  readonly submitting: string;
  readonly cancel: string;
  readonly confirmTitle: string;
  readonly confirmSubmit: string;
  readonly confirmCancel: string;
  readonly recorded: string;
  readonly recordedStatePrefix: string;
  readonly operationsNone: string;
  readonly viewerNotice: string;
  readonly deniedTitle: string;
  readonly errorValidation: string;
  readonly errorStatePrefix: string;
  readonly errorStateSuffix: string;
  readonly errorForbidden: string;
  readonly errorConflict: string;
  readonly errorGeneric: string;
};

export type ProposalInterviewScreenProps = {
  readonly proposalId: string;
  readonly rows: ProposalInterviewRows;
  /** 🔴 `VIEWER` は記録できない（`requireNotViewer`）。導線を描かず理由を出す。 */
  readonly isViewer: boolean;
  /** 実行系を止めている理由（`F-004 AC-7`）。`null` なら実行可。拒否の本体は #48 の `requireExecutable`。 */
  readonly denialMessage: string | null;
  readonly noteLabels: ProposalInterviewNoteLabels;
  readonly memoMaxLength: number;
  /** 状態の語（422 の「現在: …」と記録後の「現在の状態: …」に使う）。 */
  readonly stateLabels: Readonly<Record<ProposalState, string>>;
  readonly messages: ProposalInterviewScreenMessages;
};

const TONE_VARIANTS = {
  neutral: 'neutral',
  progress: 'outline',
  success: 'success',
  warning: 'warning',
  danger: 'danger',
} as const satisfies Record<ProposalStateTone, BadgeVariant>;

type Phase =
  | { readonly kind: 'IDLE' }
  | { readonly kind: 'FORM'; readonly operation: ProposalInterviewOperation }
  | { readonly kind: 'CONFIRM'; readonly operation: ProposalInterviewOperation; readonly note: string | undefined }
  | { readonly kind: 'SUBMITTING'; readonly operation: ProposalInterviewOperation; readonly note: string | undefined }
  | { readonly kind: 'RECORDED'; readonly to: ProposalState };

type ErrorBody = { readonly error?: { readonly code?: string } };
type TransitionedBody = { readonly state?: string };
type DetailBody = { readonly state?: string };

const EMPTY_INPUT: ProposalInterviewNoteInput = { scheduledAt: '', interviewedOn: '', memo: '' };

/** 🔴 タップ幅（44px 以上）。モバイルでは全幅（`CLAUDE.md` §13.2 Tier 1）。 */
const TAP_BUTTON_CLASSES = 'min-h-11 w-full sm:w-auto';

function RecentItem({ row }: { readonly row: ProposalTimelineRow }) {
  return (
    <li className="border-l-2 border-slate-200 pl-3" data-testid={`proposal-interview-recent-event-${row.id}`} data-event-kind={row.kind}>
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 text-xs text-slate-500">
        <time>{row.occurredAt}</time>
        <span>{row.actor}</span>
      </div>
      <div className="text-sm font-semibold text-slate-900">{row.title}</div>
      {row.transition === null ? null : <div className="text-sm text-slate-700">{row.transition}</div>}
      {row.detail === null ? null : <p className="whitespace-pre-wrap break-words text-sm text-slate-800">{row.detail}</p>}
    </li>
  );
}

export function ProposalInterviewScreen({
  proposalId,
  rows,
  isViewer,
  denialMessage,
  noteLabels,
  memoMaxLength,
  stateLabels,
  messages,
}: ProposalInterviewScreenProps) {
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>({ kind: 'IDLE' });
  const [input, setInput] = useState<ProposalInterviewNoteInput>(EMPTY_INPUT);
  const [error, setError] = useState<string | null>(null);

  const canRecord = rows.phase === 'RECORDABLE' && rows.operations.length > 0 && !isViewer && denialMessage === null;
  const submitting = phase.kind === 'SUBMITTING';
  const active = phase.kind === 'FORM' || phase.kind === 'CONFIRM' || phase.kind === 'SUBMITTING' ? phase.operation : null;
  // 終端は確認ステップから送る（送信中も確認パネルを保つ）。それ以外はフォームから送る。
  const showConfirm = phase.kind === 'CONFIRM' || (phase.kind === 'SUBMITTING' && phase.operation.terminal);
  const confirmNote = phase.kind === 'CONFIRM' || phase.kind === 'SUBMITTING' ? phase.note : undefined;
  const previewNote = active === null ? undefined : buildProposalInterviewNote(active.kind, input, noteLabels);
  const inputComplete = active !== null && isInterviewInputComplete(active.kind, input);
  const stateLabelOf = (state: string): string => (state in stateLabels ? stateLabels[state as ProposalState] : state);

  function open(operation: ProposalInterviewOperation): void {
    setError(null);
    setInput(EMPTY_INPUT);
    setPhase({ kind: 'FORM', operation });
  }

  function cancel(): void {
    setError(null);
    setInput(EMPTY_INPUT);
    setPhase({ kind: 'IDLE' });
  }

  async function readCurrentState(): Promise<string | null> {
    try {
      const response = await fetch(`/api/proposals/${proposalId}`, { cache: 'no-store' });
      if (!response.ok) return null;
      const body = (await response.json()) as DetailBody;
      return typeof body.state === 'string' ? body.state : null;
    } catch {
      return null;
    }
  }

  async function errorFor(status: number, code: string | undefined): Promise<string> {
    if (code === 'INVALID_STATE_TRANSITION' || code === 'PROPOSAL_TRANSITION_RESERVED') {
      // 🔴 読んでから押すまでに状態が動いていた。現在の状態を伝え、実行できる操作を読み直す（サイレントに無視しない）。
      const current = await readCurrentState();
      router.refresh();
      return `${messages.errorStatePrefix}${current === null ? rows.stateLabel : stateLabelOf(current)}${messages.errorStateSuffix}`;
    }
    if (status === 403) return messages.errorForbidden;
    if (status === 409) return messages.errorConflict;
    if (status === 400) return messages.errorValidation;
    return messages.errorGeneric;
  }

  async function record(operation: ProposalInterviewOperation, note: string | undefined): Promise<void> {
    setError(null);
    setPhase({ kind: 'SUBMITTING', operation, note });
    try {
      // 🔴 body は `{ to, note? }` だけ（#48）。判定は API（遷移表 → 所有者 → 立場 → CAS）。
      const response = await fetch(`/api/proposals/${proposalId}/transition`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(note === undefined ? { to: operation.to } : { to: operation.to, note }),
      });
      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as ErrorBody;
        setError(await errorFor(response.status, body.error?.code));
        setPhase({ kind: 'IDLE' });
        return;
      }
      const body = (await response.json()) as TransitionedBody;
      setInput(EMPTY_INPUT);
      setPhase({ kind: 'RECORDED', to: typeof body.state === 'string' && body.state in stateLabels ? (body.state as ProposalState) : operation.to });
      // 🔴 手元で状態を書き換えず、サーバの状態と次の操作を読み直す。
      router.refresh();
    } catch {
      setError(messages.errorGeneric);
      setPhase({ kind: 'IDLE' });
    }
  }

  function submitForm(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    if (phase.kind !== 'FORM' || !canRecord) return;
    const operation = phase.operation;
    if (!isInterviewInputComplete(operation.kind, input)) {
      setError(messages.errorValidation);
      return;
    }
    const note = buildProposalInterviewNote(operation.kind, input, noteLabels);
    if (operation.terminal) {
      // 🔴 終端は戻れないので確認ステップを置く。
      setError(null);
      setPhase({ kind: 'CONFIRM', operation, note });
      return;
    }
    void record(operation, note);
  }

  return (
    <div
      data-testid="proposal-interview"
      data-proposal-state={rows.state}
      data-audience={rows.audience}
      data-phase={rows.phase}
      data-can-record={canRecord ? 'true' : 'false'}
    >
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <Badge variant={TONE_VARIANTS[rows.tone]} data-testid="proposal-interview-state">
          {rows.stateLabel}
        </Badge>
        <Link className={`${SECONDARY_LINK_CLASSES} ml-auto`} href={rows.detailHref} data-testid="proposal-interview-back-to-detail">
          {messages.backToDetail}
        </Link>
      </div>

      {/* ② 自動確定は無い、を先頭で明示する。 */}
      <p className="mb-4 text-sm text-slate-700" data-testid="proposal-interview-lead">
        {messages.lead}
      </p>

      {rows.audienceNotice === null ? null : (
        <p className="mb-4 rounded-md border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700" data-testid="proposal-interview-partner-notice">
          {rows.audienceNotice}
        </p>
      )}

      {/* ⑤ 判断材料。折りたたまない。 */}
      <section className="mb-6" data-testid="proposal-interview-section-summary">
        <h2 className="mb-2 text-base font-semibold text-slate-900">{messages.sectionSummary}</h2>
        <dl className="grid grid-cols-1 gap-x-6 gap-y-2 text-sm sm:grid-cols-2" data-testid="proposal-interview-header">
          {rows.header.map((row) => (
            <div key={row.field} className="flex gap-3" data-testid={`proposal-interview-header-row-${row.field}`} data-emphasis={row.emphasis}>
              <dt className="w-28 shrink-0 text-slate-500">{row.label}</dt>
              <dd className={`m-0 break-words ${row.emphasis === 'ATTENTION' ? 'font-semibold text-amber-800' : 'text-slate-900'}`}>{row.value}</dd>
            </div>
          ))}
          <div className="flex gap-3" data-testid="proposal-interview-header-row-state">
            <dt className="w-28 shrink-0 text-slate-500">{messages.fieldState}</dt>
            <dd className="m-0 text-slate-900">{rows.stateLabel}</dd>
          </div>
        </dl>
      </section>

      {/* 直近の履歴（全件は S-023）。 */}
      <section className="mb-6" data-testid="proposal-interview-section-recent">
        <h2 className="mb-2 text-base font-semibold text-slate-900">{messages.sectionRecent}</h2>
        {rows.recent.length === 0 ? (
          <p className="mb-2 text-sm text-slate-600" data-testid="proposal-interview-recent-empty">
            {messages.recentEmpty}
          </p>
        ) : (
          <ol className="mb-2 flex flex-col gap-3" data-testid="proposal-interview-recent">
            {rows.recent.map((row) => (
              <RecentItem key={row.id} row={row} />
            ))}
          </ol>
        )}
        <Link className={SECONDARY_LINK_CLASSES} href={rows.detailHref} data-testid="proposal-interview-recent-open-detail">
          {messages.recentOpenDetail}
        </Link>
      </section>

      {/* ① 次に記録できる操作。 */}
      <section className="mb-6" data-testid="proposal-interview-section-operations">
        <h2 className="mb-2 text-base font-semibold text-slate-900">{messages.sectionOperations}</h2>

        {phase.kind === 'RECORDED' ? (
          <div role="status" className="mb-3 rounded-md border border-emerald-300 bg-emerald-50 p-3 text-sm text-emerald-900" data-testid="proposal-interview-result" data-result={phase.to}>
            <p className="font-semibold">{messages.recorded}</p>
            <p>
              {messages.recordedStatePrefix}
              {stateLabelOf(phase.to)}
            </p>
          </div>
        ) : null}

        {rows.closedNotice === null ? null : (
          <div className="mb-3 rounded-md border border-slate-200 bg-slate-50 p-3 text-sm text-slate-800" data-testid="proposal-interview-closed" data-closed-state={rows.state}>
            <p>{rows.closedNotice}</p>
            {rows.assignmentNote === null ? null : (
              <p className="mt-1 text-slate-700" data-testid="proposal-interview-won-note">
                {rows.assignmentNote}
              </p>
            )}
          </div>
        )}

        {rows.notRecordableNotice === null ? null : (
          <p className="mb-3 text-sm text-slate-700" data-testid="proposal-interview-not-recordable">
            {rows.notRecordableNotice}
          </p>
        )}

        {rows.phase !== 'RECORDABLE' ? null : isViewer ? (
          <p className="text-sm text-slate-600" data-testid="proposal-interview-viewer">
            {messages.viewerNotice}
          </p>
        ) : denialMessage !== null ? (
          <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900" data-testid="proposal-interview-denied">
            <p className="font-semibold">{messages.deniedTitle}</p>
            <p>{denialMessage}</p>
          </div>
        ) : rows.operations.length === 0 ? (
          <p className="text-sm text-slate-600" data-testid="proposal-interview-operations-empty">
            {messages.operationsNone}
          </p>
        ) : active !== null && showConfirm ? (
          /* ③ 終端の確認ステップ。判断材料を再掲する。 */
          <div className="rounded-md border border-amber-300 bg-amber-50 p-4" data-testid="proposal-interview-confirm" data-operation={active.kind}>
            <p className="mb-1 text-base font-semibold text-amber-900">{messages.confirmTitle}</p>
            {active.confirmLead === null ? null : <p className="mb-3 text-sm text-amber-900">{active.confirmLead}</p>}
            <dl className="mb-3 flex flex-col gap-1 text-sm text-slate-900" data-testid="proposal-interview-confirm-recap">
              {rows.header.map((row) => (
                <div key={row.field} className="flex gap-3">
                  <dt className="w-28 shrink-0 text-slate-600">{row.label}</dt>
                  <dd className="m-0 break-words">{row.value}</dd>
                </div>
              ))}
              <div className="flex gap-3">
                <dt className="w-28 shrink-0 text-slate-600">{messages.notePreview}</dt>
                <dd className="m-0 whitespace-pre-wrap break-words" data-testid="proposal-interview-confirm-note">
                  {confirmNote ?? messages.notePreviewNone}
                </dd>
              </div>
            </dl>
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
              <Button
                type="button"
                className={TAP_BUTTON_CLASSES}
                disabled={submitting}
                onClick={() => void record(active, confirmNote)}
                data-testid="proposal-interview-confirm-submit"
              >
                {submitting ? messages.submitting : `${messages.confirmSubmit}: ${active.label}`}
              </Button>
              <Button
                type="button"
                variant="secondary"
                className={TAP_BUTTON_CLASSES}
                disabled={submitting}
                onClick={() => setPhase({ kind: 'FORM', operation: active })}
                data-testid="proposal-interview-confirm-cancel"
              >
                {messages.confirmCancel}
              </Button>
            </div>
          </div>
        ) : active !== null ? (
          <form onSubmit={submitForm} className="rounded-md border border-slate-200 bg-slate-50 p-4" data-testid="proposal-interview-form" data-operation={active.kind}>
            <p className="mb-3 text-base font-semibold text-slate-900">{active.label}</p>
            {active.inputs.scheduledAt ? (
              <Field label={messages.inputScheduledAt} className="mb-3">
                <Input
                  type="datetime-local"
                  value={input.scheduledAt}
                  onChange={(event) => setInput({ ...input, scheduledAt: event.target.value })}
                  required
                  disabled={submitting}
                  data-testid="proposal-interview-scheduled-at"
                />
              </Field>
            ) : null}
            {active.inputs.interviewedOn ? (
              <Field label={messages.inputInterviewedOn} className="mb-3">
                <Input
                  type="date"
                  value={input.interviewedOn}
                  onChange={(event) => setInput({ ...input, interviewedOn: event.target.value })}
                  required
                  disabled={submitting}
                  data-testid="proposal-interview-interviewed-on"
                />
              </Field>
            ) : null}
            <Field label={active.inputs.memo === 'REASON' ? messages.inputReason : messages.inputMemo} description={messages.inputMemoHint} className="mb-3">
              <Textarea
                value={input.memo}
                onChange={(event) => setInput({ ...input, memo: event.target.value })}
                maxLength={memoMaxLength}
                rows={3}
                disabled={submitting}
                data-testid="proposal-interview-memo"
              />
            </Field>
            {/* ④ 送る前に、履歴に残る文字列そのものを見せる。 */}
            <div className="mb-3 text-sm">
              <div className="text-slate-500">{messages.notePreview}</div>
              <p className="m-0 whitespace-pre-wrap break-words text-slate-900" data-testid="proposal-interview-note-preview">
                {previewNote ?? messages.notePreviewNone}
              </p>
            </div>
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
              <Button type="submit" className={TAP_BUTTON_CLASSES} disabled={submitting || !inputComplete} data-testid="proposal-interview-submit">
                {submitting ? messages.submitting : messages.submit}
              </Button>
              <Button type="button" variant="secondary" className={TAP_BUTTON_CLASSES} disabled={submitting} onClick={cancel} data-testid="proposal-interview-cancel">
                {messages.cancel}
              </Button>
            </div>
          </form>
        ) : (
          <ul className="flex flex-col gap-3" data-testid="proposal-interview-operations">
            {rows.operations.map((operation) => (
              <li key={operation.kind}>
                <Button
                  type="button"
                  variant={operation.emphasis === 'PRIMARY' ? 'primary' : 'secondary'}
                  className={TAP_BUTTON_CLASSES}
                  onClick={() => open(operation)}
                  data-testid={`proposal-interview-operation-${operation.kind}`}
                  data-to={operation.to}
                  data-terminal={operation.terminal ? 'true' : 'false'}
                >
                  {operation.label}
                </Button>
              </li>
            ))}
          </ul>
        )}

        {error === null ? null : (
          <p role="alert" className="mt-3 text-sm font-semibold text-red-700" data-testid="proposal-interview-error">
            {error}
          </p>
        )}
      </section>
    </div>
  );
}
