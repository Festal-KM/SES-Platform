'use client';

// apps/web/app/(main)/proposals/[id]/proposal-detail-screen.tsx
// `S-023` 提案の詳細と履歴 — 本体（docs/04 §S-023 / `F-024` / `F-025` / `F-021 AC-5` / docs/05 §6.5 #46 / #47）。T-09-09。
//
// ============================================================================
// 🔴 この画面が守るもの（`docs/04` §S-023 / `F-019 AC-5` / `BR-08` / `BR-18`）
// ============================================================================
//   ① 🔴 **概要は `S-021` の判断ヘッダと同じ材料**（提案先 / エンジニア / 案件 / 単価 / 開始日 / 作成者 / 経過時間。凍結側だけ）。
//      モバイルでは「状態 + 提案先 + 単価」を固定ヘッダにし、**状態と単価は折りたたみの外**（`docs/04` §S-023 デバイス別）。
//   ② 🔴 **履歴は `kind` ごとに描き分ける**（作成 / 遷移 / 却下 / 承認〔検査 #…〕/ 再送〔理由〕/ 送信失敗〔種別〕/ 下書きの更新〔項目名〕/
//      メモ）。行は `data-event-kind` を持つ。**自動承認は「システム（全層 PASS のため）」**（`F-021 AC-5`）。
//   ③ 🔴 **凍結内容は凍結された行をそのまま描き、台帳の現在値と混ぜない**（`F-019 AC-5`）。経歴の見出しに凍結日時を必ず添える。
//      「最新の情報に更新する」に相当する操作は無い。
//   ④ 🔴 **状態に応じた導線**（`DRAFT` → `S-020` / `APPROVAL_PENDING` → `S-021` / `APPROVED` → `S-021`「送信する」/ `SUBMIT_FAILED` → `S-022` /
//      商談中 → `S-024`）。却下由来の `DRAFT` には「内容を変更してからレビューに出してください」を添える（T-09-03 の申し送り =
//      内容を変えずに再依頼すると 422 `GATE_ALREADY_COMPLETED`）。**ゲート FAIL を無視して送る導線は無い。**
//   ⑤ 🔴 **メモ（#47）は状態を動かさない。** 成功後は手元で履歴を書き換えず `router.refresh()`（サーバの履歴が正）。
//      導線は `canAddNote`（立場）× `denialMessage === null`（テナントが実行可）のときだけ。
//   ⑥ 🔴 取引先の props に承認者・送信試行・保留・作成会社は**来ない**（`proposalDetailRows` が `null` にする。型の分離は `views.ts`）。
//      重複提案（`F-037`。Phase 2）の欄はこの画面に存在しない。
//
// 🔴 `'use client'` はメモの投稿フォームのためだけである。**`@ses/db` に依存するモジュールから値を import しない**
//    （`tests/static/client-db-boundary.test.ts`）。文言と表示値は props で受け取る。
// 🔴 応答の `messageKey` を UI で解釈しない。文言は応答コード（`error.code`）と HTTP 状態で選ぶ。
import { useState, type FormEvent } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Badge, Button, Field, SECONDARY_LINK_CLASSES, Table, TableBody, TableCell, TableHead, TableHeader, TableRow, Textarea, type BadgeVariant } from '@ses/ui';
import type { GateLayerState } from '@ses/domain';
import type { ProposalDetailRows, ProposalStateTone, ProposalTimelineRow } from '../../../../lib/proposals/detail-rows';

export type ProposalDetailScreenMessages = {
  readonly sectionHeader: string;
  readonly sectionHold: string;
  readonly sectionTimeline: string;
  readonly sectionFrozen: string;
  readonly sectionGate: string;
  readonly sectionActions: string;
  readonly sectionNote: string;
  readonly fieldState: string;
  readonly fieldApprover: string;
  readonly fieldSubmittedAt: string;
  readonly fieldSendAttempts: string;
  readonly fieldLastFailure: string;
  readonly sendAttemptsNone: string;
  readonly frozenSubject: string;
  readonly frozenBody: string;
  readonly frozenAttachment: string;
  readonly careerColumnPeriod: string;
  readonly careerColumnRole: string;
  readonly careerColumnDescription: string;
  readonly careerColumnTechnologies: string;
  readonly gateNotRequested: string;
  readonly gateWarningsTitle: string;
  readonly gateFindingsTitle: string;
  readonly gateFindingsEmpty: string;
  readonly gateWarningsEmpty: string;
  readonly noteLabel: string;
  readonly noteLead: string;
  readonly noteSubmit: string;
  readonly noteSubmitting: string;
  readonly noteAdded: string;
  readonly noteViewerNotice: string;
  readonly noteForbiddenNotice: string;
  readonly noteErrorValidation: string;
  readonly noteErrorForbidden: string;
  readonly noteErrorGeneric: string;
  readonly deniedTitle: string;
  readonly backToList: string;
};

export type ProposalDetailScreenProps = {
  readonly proposalId: string;
  readonly rows: ProposalDetailRows;
  /** 🔴 `VIEWER` はメモを残せない（`requireNotViewer`）。導線を描かず理由を出す。 */
  readonly isViewer: boolean;
  /** 実行系を止めている理由（`F-004 AC-7`）。`null` なら実行可。拒否の本体は #47 の `requireExecutable`。 */
  readonly denialMessage: string | null;
  readonly listHref: string;
  readonly noteMaxLength: number;
  readonly messages: ProposalDetailScreenMessages;
};

const TONE_VARIANTS = {
  neutral: 'neutral',
  progress: 'outline',
  success: 'success',
  warning: 'warning',
  danger: 'danger',
} as const satisfies Record<ProposalStateTone, BadgeVariant>;

const LAYER_VARIANTS = {
  RUNNING: 'outline',
  PASS: 'success',
  FAIL: 'danger',
  HELD: 'warning',
} as const satisfies Record<GateLayerState, BadgeVariant>;

type NotePhase = { readonly kind: 'IDLE' } | { readonly kind: 'SUBMITTING' } | { readonly kind: 'ADDED' };

type ErrorBody = { readonly error?: { readonly code?: string } };

function TimelineItem({ row }: { readonly row: ProposalTimelineRow }) {
  return (
    <li
      className="border-l-2 border-slate-200 pl-4"
      data-testid={`proposal-detail-event-${row.id}`}
      data-event-kind={row.kind}
      data-actor-kind={row.actorKind}
    >
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 text-xs text-slate-500">
        <time>{row.occurredAt}</time>
        <span data-testid={`proposal-detail-event-actor-${row.id}`}>{row.actor}</span>
      </div>
      <div className="text-sm font-semibold text-slate-900" data-testid={`proposal-detail-event-title-${row.id}`}>
        {row.title}
      </div>
      {row.transition === null ? null : <div className="text-sm text-slate-700">{row.transition}</div>}
      {row.detail === null ? null : (
        <p className="whitespace-pre-wrap break-words text-sm text-slate-800" data-testid={`proposal-detail-event-detail-${row.id}`}>
          {row.detail}
        </p>
      )}
      {row.attachment === null ? null : <div className="text-xs text-slate-500">{row.attachment}</div>}
    </li>
  );
}

export function ProposalDetailScreen({ proposalId, rows, isViewer, denialMessage, listHref, noteMaxLength, messages }: ProposalDetailScreenProps) {
  const router = useRouter();
  const [note, setNote] = useState('');
  const [phase, setPhase] = useState<NotePhase>({ kind: 'IDLE' });
  const [error, setError] = useState<string | null>(null);

  const canExecute = rows.canAddNote && !isViewer && denialMessage === null;
  const submitting = phase.kind === 'SUBMITTING';

  function errorFor(status: number, code: string | undefined): string {
    if (status === 400 || code === 'VALIDATION') return messages.noteErrorValidation;
    if (status === 403) return messages.noteErrorForbidden;
    return messages.noteErrorGeneric;
  }

  async function submitNote(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!canExecute || submitting) return;
    const trimmed = note.trim();
    if (trimmed.length === 0) {
      setError(messages.noteErrorValidation);
      return;
    }
    setPhase({ kind: 'SUBMITTING' });
    setError(null);
    try {
      // 🔴 body は `{ kind: 'NOTE', note }` だけ（#47。状態を動かす入力は存在しない）。
      const response = await fetch(`/api/proposals/${proposalId}/events`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ kind: 'NOTE', note: trimmed }),
      });
      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as ErrorBody;
        setError(errorFor(response.status, body.error?.code));
        setPhase({ kind: 'IDLE' });
        return;
      }
      setNote('');
      setPhase({ kind: 'ADDED' });
      // 🔴 手元で履歴を書き換えず、サーバの履歴を読み直す。
      router.refresh();
    } catch {
      setError(messages.noteErrorGeneric);
      setPhase({ kind: 'IDLE' });
    }
  }

  return (
    <div data-testid="proposal-detail" data-proposal-state={rows.state} data-failure-kind={rows.failureKind ?? ''} data-can-add-note={canExecute ? 'true' : 'false'}>
      {/* ① 固定ヘッダ（状態 + 提案先 + 単価）。折りたたみの外。 */}
      <div className="sticky top-0 z-10 mb-4 flex flex-wrap items-center gap-3 border-b border-slate-200 bg-white/95 py-2" data-testid="proposal-detail-fixed">
        <Badge variant={TONE_VARIANTS[rows.tone]} data-testid="proposal-detail-state">
          {rows.stateLabel}
        </Badge>
        <span className="text-sm text-slate-800" data-testid="proposal-detail-fixed-recipient">
          {rows.fixed.recipient}
        </span>
        <span className="text-sm font-semibold text-slate-900" data-testid="proposal-detail-fixed-unit-price">
          {rows.fixed.unitPrice}
        </span>
        <Link className={`${SECONDARY_LINK_CLASSES} ml-auto`} href={listHref} data-testid="proposal-detail-back-to-list">
          {messages.backToList}
        </Link>
      </div>

      {rows.audienceNotice === null ? null : (
        <p className="mb-4 rounded-md border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700" data-testid="proposal-detail-partner-notice">
          {rows.audienceNotice}
        </p>
      )}

      {/* ① 概要（判断ヘッダと同じ材料）。 */}
      <section className="mb-6" data-testid="proposal-detail-section-header">
        <h2 className="mb-2 text-base font-semibold text-slate-900">{messages.sectionHeader}</h2>
        <dl className="grid grid-cols-1 gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
          {rows.header.map((row) => (
            <div key={row.field} className="flex gap-3" data-testid={`proposal-detail-header-row-${row.field}`} data-emphasis={row.emphasis}>
              <dt className="w-28 shrink-0 text-slate-500">{row.label}</dt>
              <dd className={`m-0 break-words ${row.emphasis === 'ATTENTION' ? 'font-semibold text-amber-800' : 'text-slate-900'}`}>{row.value}</dd>
            </div>
          ))}
          <div className="flex gap-3" data-testid="proposal-detail-header-row-state">
            <dt className="w-28 shrink-0 text-slate-500">{messages.fieldState}</dt>
            <dd className="m-0 text-slate-900">{rows.stateLabel}</dd>
          </div>
          {rows.approver === null ? null : (
            <div className="flex gap-3" data-testid="proposal-detail-approver">
              <dt className="w-28 shrink-0 text-slate-500">{messages.fieldApprover}</dt>
              <dd className="m-0 text-slate-900">{rows.approver}</dd>
            </div>
          )}
          {rows.submittedAt === null ? null : (
            <div className="flex gap-3" data-testid="proposal-detail-submitted-at">
              <dt className="w-28 shrink-0 text-slate-500">{messages.fieldSubmittedAt}</dt>
              <dd className="m-0 text-slate-900">{rows.submittedAt}</dd>
            </div>
          )}
          {rows.sendAttempts === null ? null : (
            <div className="flex gap-3" data-testid="proposal-detail-send-attempts">
              <dt className="w-28 shrink-0 text-slate-500">{messages.fieldSendAttempts}</dt>
              <dd className="m-0 text-slate-900">
                {rows.sendAttempts.items.length === 0 ? messages.sendAttemptsNone : `${rows.sendAttempts.count} / ${rows.sendAttempts.last ?? ''}`}
              </dd>
            </div>
          )}
          {rows.lastFailureReason === null ? null : (
            <div className="flex gap-3" data-testid="proposal-detail-last-failure">
              <dt className="w-28 shrink-0 text-slate-500">{messages.fieldLastFailure}</dt>
              <dd className="m-0 text-slate-900">{rows.lastFailureReason}</dd>
            </div>
          )}
        </dl>
      </section>

      {/* 保留（ホストだけ。`SUBMIT_FAILED` とは別の枠）。 */}
      {rows.sendHold === null ? null : (
        <section className="mb-6 rounded-md border border-amber-200 bg-amber-50 p-4" data-testid="proposal-detail-send-hold" data-hold-reason={rows.sendHold.reasonKey}>
          <h2 className="mb-1 text-base font-semibold text-amber-900">{messages.sectionHold}</h2>
          <p className="text-sm text-amber-900">{rows.sendHold.message}</p>
          <p className="text-xs text-amber-800">{rows.sendHold.since}</p>
          {rows.sendHold.settingsLink === null ? null : (
            <Link className={`${SECONDARY_LINK_CLASSES} mt-2 inline-block`} href={rows.sendHold.settingsLink.href} data-testid="proposal-detail-send-hold-settings">
              {rows.sendHold.settingsLink.label}
            </Link>
          )}
        </section>
      )}

      {/* ④ 状態に応じた導線。 */}
      <section className="mb-6" data-testid="proposal-detail-section-actions">
        <h2 className="mb-2 text-base font-semibold text-slate-900">{messages.sectionActions}</h2>
        {rows.actionsEmpty === null ? null : (
          <p className="text-sm text-slate-600" data-testid="proposal-detail-actions-empty">
            {rows.actionsEmpty}
          </p>
        )}
        <ul className="flex flex-col gap-3">
          {rows.actions.map((action) => (
            <li key={action.key} data-testid={`proposal-detail-action-${action.key}`}>
              {action.lead === null ? null : (
                <p className="mb-1 text-sm text-amber-900" data-testid={`proposal-detail-action-lead-${action.key}`}>
                  {action.lead}
                </p>
              )}
              <Link className={SECONDARY_LINK_CLASSES} href={action.href} data-testid={`proposal-detail-action-link-${action.key}`}>
                {action.label}
              </Link>
            </li>
          ))}
        </ul>
      </section>

      {/* ② 履歴タイムライン。 */}
      <section className="mb-6" data-testid="proposal-detail-section-timeline">
        <h2 className="mb-2 text-base font-semibold text-slate-900">{messages.sectionTimeline}</h2>
        <ol className="flex flex-col gap-3" data-testid="proposal-detail-timeline">
          {rows.timeline.map((row) => (
            <TimelineItem key={row.id} row={row} />
          ))}
        </ol>
      </section>

      {/* ⑤ メモ追加（#47）。状態を動かさない。 */}
      <section className="mb-6" data-testid="proposal-detail-section-note">
        <h2 className="mb-2 text-base font-semibold text-slate-900">{messages.sectionNote}</h2>
        {isViewer ? (
          <p className="text-sm text-slate-600" data-testid="proposal-detail-note-viewer">
            {messages.noteViewerNotice}
          </p>
        ) : !rows.canAddNote ? (
          <p className="text-sm text-slate-600" data-testid="proposal-detail-note-forbidden">
            {messages.noteForbiddenNotice}
          </p>
        ) : denialMessage !== null ? (
          <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900" data-testid="proposal-detail-note-denied">
            <p className="font-semibold">{messages.deniedTitle}</p>
            <p>{denialMessage}</p>
          </div>
        ) : (
          <form onSubmit={(event) => void submitNote(event)} className="flex flex-col gap-3" data-testid="proposal-detail-note-form">
            <p className="text-xs text-slate-600">{messages.noteLead}</p>
            <Field label={messages.noteLabel}>
              <Textarea
                value={note}
                onChange={(event) => setNote(event.target.value)}
                maxLength={noteMaxLength}
                rows={3}
                disabled={submitting}
                data-testid="proposal-detail-note-input"
              />
            </Field>
            <div className="flex flex-wrap items-center gap-3">
              <Button type="submit" disabled={submitting || note.trim().length === 0} data-testid="proposal-detail-note-submit">
                {submitting ? messages.noteSubmitting : messages.noteSubmit}
              </Button>
              {phase.kind === 'ADDED' ? (
                <span className="text-sm text-emerald-800" data-testid="proposal-detail-note-added">
                  {messages.noteAdded}
                </span>
              ) : null}
            </div>
            {error === null ? null : (
              <p role="alert" className="text-sm font-semibold text-red-700" data-testid="proposal-detail-note-error">
                {error}
              </p>
            )}
          </form>
        )}
      </section>

      {/* ③ 凍結内容。 */}
      <section className="mb-6" data-testid="proposal-detail-section-frozen">
        <h2 className="mb-2 text-base font-semibold text-slate-900">{messages.sectionFrozen}</h2>
        <p className="mb-3 text-xs text-slate-600" data-testid="proposal-detail-frozen-notice">
          {rows.frozen.notice}
        </p>
        <dl className="mb-4 flex flex-col gap-2 text-sm">
          <div className="flex gap-3">
            <dt className="w-28 shrink-0 text-slate-500">{messages.frozenSubject}</dt>
            <dd className="m-0 break-words text-slate-900" data-testid="proposal-detail-frozen-subject">
              {rows.frozen.subject}
            </dd>
          </div>
          <div className="flex gap-3">
            <dt className="w-28 shrink-0 text-slate-500">{messages.frozenBody}</dt>
            <dd className="m-0 whitespace-pre-wrap break-words text-slate-900" data-testid="proposal-detail-frozen-body">
              {rows.frozen.body}
            </dd>
          </div>
          <div className="flex gap-3">
            <dt className="w-28 shrink-0 text-slate-500">{messages.frozenAttachment}</dt>
            <dd className="m-0 text-slate-900" data-testid="proposal-detail-frozen-attachment">
              {rows.frozen.attachment}
            </dd>
          </div>
        </dl>
        <h3 className="mb-2 text-sm font-semibold text-slate-900" data-testid="proposal-detail-frozen-careers-title">
          {rows.frozen.careersTitle}
        </h3>
        {rows.frozen.careersEmpty === null ? (
          <Table data-testid="proposal-detail-frozen-careers">
            <TableHeader>
              <TableRow>
                <TableHead>{messages.careerColumnPeriod}</TableHead>
                <TableHead>{messages.careerColumnRole}</TableHead>
                <TableHead>{messages.careerColumnDescription}</TableHead>
                <TableHead>{messages.careerColumnTechnologies}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.frozen.careers.map((career) => (
                <TableRow key={career.key} data-testid={`proposal-detail-frozen-career-${career.key}`}>
                  <TableCell>{career.period}</TableCell>
                  <TableCell whitespace="normal">{career.role}</TableCell>
                  <TableCell whitespace="normal">{career.description}</TableCell>
                  <TableCell whitespace="normal">{career.technologies}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        ) : (
          <p className="text-sm text-slate-600" data-testid="proposal-detail-frozen-careers-empty">
            {rows.frozen.careersEmpty}
          </p>
        )}
      </section>

      {/* ゲート結果（#40 と同じ形。3 値）。 */}
      <section className="mb-6" data-testid="proposal-detail-section-gate" data-gate-execution={rows.gate.execution}>
        <h2 className="mb-2 text-base font-semibold text-slate-900">{messages.sectionGate}</h2>
        {rows.gate.execution === 'RUNNING' && !rows.gate.layers.some((layer) => layer.state !== 'RUNNING') ? (
          <p className="text-sm text-slate-600" data-testid="proposal-detail-gate-not-requested">
            {messages.gateNotRequested}
          </p>
        ) : (
          <>
            <ul className="mb-3 flex flex-wrap gap-2">
              {rows.gate.layers.map((layer) => (
                <li key={layer.key} data-testid={`proposal-detail-gate-layer-${layer.key}`} data-layer-state={layer.state}>
                  <Badge variant={LAYER_VARIANTS[layer.state]}>
                    {layer.label}: {layer.verdictLabel}
                  </Badge>
                </li>
              ))}
            </ul>
            {rows.gate.lead === null ? null : <p className="mb-2 text-sm text-slate-700">{rows.gate.lead}</p>}
            <h3 className="text-sm font-semibold text-red-800">{messages.gateFindingsTitle}</h3>
            {rows.gate.findings.length === 0 ? (
              <p className="mb-2 text-sm text-slate-600">{messages.gateFindingsEmpty}</p>
            ) : (
              <ul className="mb-2 list-disc pl-5 text-sm text-red-800" data-testid="proposal-detail-gate-findings">
                {rows.gate.findings.map((finding) => (
                  <li key={finding.key}>
                    {finding.fieldLabel}: {finding.excerpt}
                  </li>
                ))}
              </ul>
            )}
            <h3 className="text-sm font-semibold text-amber-800">{messages.gateWarningsTitle}</h3>
            {rows.gate.warnings.length === 0 ? (
              <p className="text-sm text-slate-600">{messages.gateWarningsEmpty}</p>
            ) : (
              <ul className="list-disc pl-5 text-sm text-amber-800" data-testid="proposal-detail-gate-warnings">
                {rows.gate.warnings.map((warning) => (
                  <li key={warning.key}>
                    {warning.fieldLabel}: {warning.excerpt}
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </section>
    </div>
  );
}
