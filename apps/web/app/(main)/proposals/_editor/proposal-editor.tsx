'use client';

// apps/web/app/(main)/proposals/_editor/proposal-editor.tsx
// `S-020` 提案の作成・編集 — 本体（docs/04 §S-020 改訂 10 / `F-019` `F-020` `F-011` / docs/05 §6.5 #36 / #37 / #39 / #40）。
// T-09-01。
//
// ============================================================================
// 🔴 この画面が守るもの
// ============================================================================
//   ① 🔴 **提案先が未設定の欄を無言で空にしない**（`docs/04` §S-020 改訂 10）。経路 4 由来の `DRAFT` は提案先が空で
//      開くので、「提案先が未設定です。ゲート実行の前に設定してください」を欄の直上に出す。
//   ② 🔴 **提案先が空の `DRAFT` は「レビューに出す」が押せない**（サーバは #39 で 422）。押せない理由を隣に明示する。
//      保存していない変更があるときも押せない（検査するのは保存済みの内容だからである）。
//   ③ 🔴 **`DRAFT` 以外は入力欄を読み取り専用にする**（#37 は 422）。状態と理由を最上部に出す。
//   ④ 🔴 **ゲート FAIL を「無視して送信」する導線が無い**（`BR-18` / `F-020 AC-2`）。ゲート結果は層ごとに描き、
//      **不合格（層のブロック全体）と警告（指摘リストの中のラベル）を視覚的に別物にする**（`docs/04` §S-020）。
//      直せるのは元データだけ —— 不合格のときは本文へ戻って修正し、あらためてレビューに出す。
//   ⑤ 🔴 **添付の選択肢は `CLEAN` の版だけ**（props の `attachment.options` がそう。`F-011 AC-1` / `F-019 AC-3`）。
//   ⑥ 凍結の予告（新規）と凍結情報（編集）を、**経験内容の行数**とともに明示する（`F-019 AC-2` / `F-008 AC-6`）。
//   ⑦ 本文の由来を本文ブロックの直上に文字で示す（Phase 1 は `手入力` の 1 値）。
//
// 🔴 T2（モバイル閲覧可）。デスクトップ = 左に条件・本文、右に添付・ゲート結果。タブレット以下 = 縦積み。
//    **ゲート結果の確認はモバイルでも完全に提供する**（差し戻しの確認は移動中に起きる。`CLAUDE.md` §13.3）。
//    本文の編集はモバイルでも可能だが推奨しない旨を示す。
// 🔴 `'use client'` はフォーム・ゲート結果のポーリングのためだけである。**`@ses/db` に依存するモジュールから
//    値を import しない**（`tests/static/client-db-boundary.test.ts`）。値 import は `lib/proposals/hrefs.ts` /
//    `recipient.ts` / `form-body.ts`（外部 import を持たない純粋モジュール）だけ。文言と表示値は props で受け取る。
// 🔴 応答の `messageKey` を UI で解釈しない。文言は応答コード（`error.code`）と HTTP 状態で選ぶ。
import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Badge, Button, Field, Input, SECONDARY_LINK_CLASSES, Select, Textarea, type BadgeVariant } from '@ses/ui';
import type { GateFinding, GateLayerState, GateResultView, ProposalState } from '@ses/domain';
import type {
  ProposalAttachmentRows,
  ProposalEditorTargetRows,
  ProposalFormValues,
  ProposalFreezeRows,
  ProposalSendingDomainRows,
} from '../../../../lib/proposals/editor-rows';
import { toProposalCreateBody, toProposalPatchBody } from '../../../../lib/proposals/form-body';
import { buildProposalEditHref } from '../../../../lib/proposals/hrefs';
import { hasProposalRecipient } from '../../../../lib/proposals/recipient';

export type ProposalEditorMessages = {
  readonly sectionTarget: string;
  readonly sectionTerms: string;
  readonly sectionContent: string;
  readonly sectionAttachment: string;
  readonly sectionGate: string;
  readonly sectionSendingDomain: string;
  readonly fieldProject: string;
  readonly fieldEngineer: string;
  readonly fieldAffiliation: string;
  readonly fieldOwner: string;
  readonly fieldSkills: string;
  readonly fieldUnitPriceRange: string;
  readonly fieldAvailableFrom: string;
  readonly fieldCareerCount: string;
  readonly fieldState: string;
  readonly fieldRecipientCompanyName: string;
  readonly fieldRecipientEmail: string;
  readonly fieldOfferedUnitPrice: string;
  readonly fieldOfferedStartDate: string;
  readonly fieldWorkStyle: string;
  readonly fieldSubject: string;
  readonly fieldBody: string;
  readonly required: string;
  readonly projectNotShared: string;
  readonly recipientMissing: string;
  readonly recipientNote: string;
  readonly bodyOriginLabel: string;
  readonly bodyOriginManual: string;
  readonly bodyMobileNote: string;
  readonly attachmentNone: string;
  readonly attachmentOpenSheets: string;
  readonly attachmentFrozenNone: string;
  readonly openEngineer: string;
  readonly create: string;
  readonly creating: string;
  readonly save: string;
  readonly saving: string;
  readonly saved: string;
  readonly requestGate: string;
  readonly requestingGate: string;
  readonly gateRequested: string;
  /** 🔴 T-09-11: `GATE_FAILED → DRAFT`（#48 MANUAL）。不合格から修正へ戻る唯一の導線。 */
  readonly reopenDraft: string;
  readonly reopeningDraft: string;
  readonly reopenDraftLead: string;
  readonly unsavedNote: string;
  readonly viewerNotice: string;
  readonly deniedTitle: string;
  readonly errorValidation: string;
  readonly errorNotEditable: string;
  readonly errorGeneric: string;
  readonly errorNotClean: string;
  readonly errorGateAlreadyCompleted: string;
  readonly errorRecipientMissing: string;
  readonly gateNotRequested: string;
  readonly gateRunning: string;
  readonly gateHeld: string;
  readonly gateHeldResetAtPrefix: string;
  readonly gateLayerPii: string;
  readonly gateLayerCommerce: string;
  readonly gateLayerConsistency: string;
  readonly gateVerdict: Readonly<Record<GateLayerState, string>>;
  readonly gateAiFailed: string;
  readonly gateFindingsTitle: string;
  readonly gateWarningsTitle: string;
  /** 指摘リストの中の「警告」ラベル（不合格の指摘には付けない）。 */
  readonly gateWarningLabel: string;
  readonly gateFindingsEmpty: string;
  readonly gateField: Readonly<Record<GateFinding['field'], string>>;
  readonly gateFailedLead: string;
  readonly gatePassedLead: string;
};

export type ProposalEditorProps = {
  readonly mode: 'CREATE' | 'EDIT';
  /** `EDIT` のときだけ非 `null`。#37 / #39 / #40 の対象。 */
  readonly proposalId: string | null;
  /** `CREATE` のときだけ非 `null`。#36 の対象と、作成後の遷移先の雛形。 */
  readonly create: { readonly projectId: string; readonly engineerId: string; readonly editHrefPattern: string } | null;
  /** `EDIT` のときの状態。`CREATE` は `null`（まだ `Proposal` が無い）。 */
  readonly state: ProposalState | null;
  readonly stateLabel: string | null;
  readonly target: ProposalEditorTargetRows;
  readonly freeze: ProposalFreezeRows;
  readonly attachment: ProposalAttachmentRows;
  readonly initial: ProposalFormValues;
  /** 🔴 提案先が未設定（経路 4 由来）。欄の直上に理由を出す（`docs/04` §S-020 改訂 10）。 */
  readonly recipientMissing: boolean;
  readonly originNotice: string | null;
  /** 🔴 `DRAFT` 以外の理由（`null` なら編集できる状態）。 */
  readonly readOnlyNotice: string | null;
  /** 🔴 立場として編集・レビュー依頼ができるか（`canEditProposal` / `PROPOSAL_EDITOR_ROLES`）。 */
  readonly canEdit: boolean;
  /** 🔴 実行系を止めている理由（`F-004 AC-7`）。`null` なら実行可。拒否の本体は API のガード。 */
  readonly denialMessage: string | null;
  readonly sendingDomain: ProposalSendingDomainRows;
  readonly cancelHref: string;
  readonly cancelLabel: string;
  /**
   * 🔴 T-09-03: `S-021`（承認画面）への導線。`DRAFT` 以外のときだけ非 `null`（レビューに出した後は承認画面で
   *    判断材料を見る。`docs/04` §S-020「レビュー依頼 → `S-021`」）。承認できるかは `S-021` 側が決める。
   */
  readonly approveHref: string | null;
  readonly approveLabel: string;
  readonly messages: ProposalEditorMessages;
};

/** 状態バッジの色。`Record` で 14 状態の漏れをコンパイラに強制させる。 */
const STATE_BADGE_VARIANTS = {
  DRAFT: 'neutral',
  GATE_RUNNING: 'warning',
  GATE_FAILED: 'danger',
  APPROVAL_PENDING: 'warning',
  APPROVED: 'success',
  SUBMITTING: 'warning',
  SUBMITTED: 'success',
  SUBMIT_FAILED: 'danger',
  INTERVIEW_SCHEDULED: 'outline',
  INTERVIEWED: 'outline',
  RESULT_PENDING: 'outline',
  WON: 'success',
  LOST: 'neutral',
  WITHDRAWN: 'neutral',
} as const satisfies Record<ProposalState, BadgeVariant>;

const LAYER_BADGE_VARIANTS = {
  RUNNING: 'warning',
  PASS: 'success',
  FAIL: 'danger',
  HELD: 'warning',
} as const satisfies Record<GateLayerState, BadgeVariant>;

/** #40 のポーリング間隔（`docs/04` §S-020「層ごとに確定する進捗」。目標 30 秒以内なので 5 秒で十分）。 */
const GATE_POLL_MS = 5_000;

type Phase =
  | { readonly kind: 'IDLE' }
  | { readonly kind: 'SUBMITTING'; readonly action: 'CREATE' | 'SAVE' | 'GATE' | 'REOPEN' }
  | { readonly kind: 'SAVED' }
  | { readonly kind: 'GATE_REQUESTED' };

type ErrorBody = { readonly error?: { readonly code?: string } };

function recipientOf(values: ProposalFormValues) {
  return { recipientCompanyName: values.recipientCompanyName, recipientEmail: values.recipientEmail };
}

function Section({ id, title, children }: { readonly id: string; readonly title: string; readonly children: ReactNode }) {
  return (
    <section className="border border-slate-200 bg-white" data-testid={`proposal-editor-section-${id}`}>
      <h2 className="border-b border-slate-200 px-4 py-3 text-base font-bold text-slate-900">{title}</h2>
      <div className="px-4 py-4">{children}</div>
    </section>
  );
}

function DetailRow({ label, value, field }: { readonly label: string; readonly value: string; readonly field: string }) {
  return (
    <div className="flex gap-3 border-b border-slate-100 py-2 last:border-b-0">
      <dt className="w-32 shrink-0 text-slate-500">{label}</dt>
      <dd className="m-0 break-words text-slate-900" data-field={field}>
        {value}
      </dd>
    </div>
  );
}

function FindingList({
  id,
  title,
  findings,
  severityLabel,
  messages,
}: {
  readonly id: string;
  readonly title: string;
  readonly findings: readonly GateFinding[];
  /** 「警告」のラベル（不合格の指摘には付けない。視覚的に別物にする）。 */
  readonly severityLabel: string | null;
  readonly messages: ProposalEditorMessages;
}) {
  return (
    <div className="mt-3" data-testid={`proposal-editor-gate-${id}`}>
      <h3 className="mb-1 text-sm font-semibold text-slate-900">{title}</h3>
      {findings.length === 0 ? (
        <p className="m-0 text-sm text-slate-600">{messages.gateFindingsEmpty}</p>
      ) : (
        <ul className="m-0 list-disc pl-5 text-sm text-slate-900">
          {findings.map((finding, index) => (
            <li key={`${finding.layer}-${finding.kind}-${String(index)}`} data-finding-kind={finding.kind}>
              {severityLabel === null ? null : (
                <Badge variant="outline" className="mr-2">
                  {severityLabel}
                </Badge>
              )}
              <span className="text-slate-500">{messages.gateField[finding.field]}: </span>
              <span className="break-words">{finding.excerpt}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * ゲート結果（docs/05 §11.7 `GateResultView`）。🔴 **層ごとに確定を描き、ゲート状態は 3 値**（`RUNNING` / `DONE` /
 * `HELD_AI_COST_LIMIT`）。不合格は層のブロック全体を FAIL 表示にし、警告は指摘リストの中に「警告」ラベルで併記する。
 */
function GateResult({ result, messages }: { readonly result: GateResultView; readonly messages: ProposalEditorMessages }) {
  const layers: readonly { readonly key: 'pii' | 'commerce' | 'consistency'; readonly label: string }[] = [
    { key: 'pii', label: messages.gateLayerPii },
    { key: 'commerce', label: messages.gateLayerCommerce },
    { key: 'consistency', label: messages.gateLayerConsistency },
  ];
  const failed = layers.some((layer) => result.layers[layer.key].state === 'FAIL');
  const allPassed = layers.every((layer) => result.layers[layer.key].state === 'PASS');
  const blocking = layers.flatMap((layer) => result.layers[layer.key].findings);
  return (
    <div data-testid="proposal-editor-gate-result" data-gate-execution={result.execution}>
      <ul className="m-0 grid list-none grid-cols-1 gap-2 p-0 sm:grid-cols-3">
        {layers.map((layer) => {
          const state = result.layers[layer.key].state;
          return (
            <li
              key={layer.key}
              className={`border px-3 py-2 ${state === 'FAIL' ? 'border-red-300 bg-red-50' : 'border-slate-200 bg-slate-50'}`}
              data-testid={`proposal-editor-gate-layer-${layer.key}`}
              data-layer-state={state}
            >
              <p className="mb-1 text-xs text-slate-500">{layer.label}</p>
              <Badge variant={LAYER_BADGE_VARIANTS[state]}>{messages.gateVerdict[state]}</Badge>
            </li>
          );
        })}
      </ul>
      {result.execution === 'HELD_AI_COST_LIMIT' && result.held !== undefined ? (
        <p role="status" className="mt-3 mb-0 border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900" data-testid="proposal-editor-gate-held">
          {messages.gateHeld} {messages.gateHeldResetAtPrefix}
          {result.held.resetAt}
        </p>
      ) : null}
      {result.aiFailed ? (
        <p role="alert" className="mt-3 mb-0 border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-900" data-testid="proposal-editor-gate-ai-failed">
          {messages.gateAiFailed}
        </p>
      ) : null}
      {result.execution === 'DONE' ? (
        <p className={`mt-3 mb-0 text-sm ${failed ? 'text-red-800' : 'text-emerald-800'}`} data-testid="proposal-editor-gate-lead">
          {failed ? messages.gateFailedLead : allPassed ? messages.gatePassedLead : ''}
        </p>
      ) : null}
      {result.execution === 'DONE' ? (
        <FindingList id="findings" title={messages.gateFindingsTitle} findings={blocking} severityLabel={null} messages={messages} />
      ) : null}
      {result.aiWarnings.length === 0 ? null : (
        <FindingList
          id="warnings"
          title={messages.gateWarningsTitle}
          findings={result.aiWarnings}
          severityLabel={messages.gateWarningLabel}
          messages={messages}
        />
      )}
    </div>
  );
}

export function ProposalEditor(props: ProposalEditorProps) {
  const { mode, proposalId, create, target, freeze, attachment, initial, originNotice, readOnlyNotice, canEdit, denialMessage, sendingDomain, cancelHref, cancelLabel, approveHref, approveLabel, messages } = props;
  const router = useRouter();
  const [values, setValues] = useState<ProposalFormValues>(initial);
  const [dirty, setDirty] = useState(false);
  const [phase, setPhase] = useState<Phase>({ kind: 'IDLE' });
  const [error, setError] = useState<string | null>(null);
  /** 🔴 レビュー依頼（#39）が 202 を返したら、サーバの再読込を待たずに `GATE_RUNNING` として描く。 */
  const [localState, setLocalState] = useState<ProposalState | null>(props.state);
  const [gate, setGate] = useState<GateResultView | null>(null);
  /** 保存済みの提案先（レビューに出せるかの判定は**保存済みの値**で行う）。 */
  const [savedRecipient, setSavedRecipient] = useState(recipientOf(initial));

  // 🔴 `router.refresh()` でサーバの状態が進んだら（ゲート確定 → `APPROVAL_PENDING` / `GATE_FAILED`）手元の状態も追従させる。
  //    手元の `GATE_RUNNING` は「202 を受け取った直後の描画」のためだけであり、サーバの状態が正である。
  useEffect(() => {
    setLocalState(props.state);
  }, [props.state]);

  const editableState = mode === 'CREATE' || localState === 'DRAFT';
  const canExecute = canEdit && denialMessage === null;
  const editable = canExecute && editableState;
  const submitting = phase.kind === 'SUBMITTING';
  const recipientSaved = hasProposalRecipient(savedRecipient);
  const recipientMissing = mode === 'EDIT' && !recipientSaved;
  const gateBlockedReason = !recipientSaved ? messages.recipientMissing : dirty ? messages.unsavedNote : null;

  // 🔴 ゲート結果（#40）: `DRAFT` 以外の間は読み、`RUNNING` の間だけ 5 秒ごとに読み直す（層ごとに確定する進捗）。
  useEffect(() => {
    if (mode !== 'EDIT' || proposalId === null || localState === null || localState === 'DRAFT') return undefined;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    async function poll(): Promise<void> {
      try {
        const response = await fetch(`/api/proposals/${proposalId}/gate`, { cache: 'no-store' });
        if (!response.ok || cancelled) return;
        const result = (await response.json()) as GateResultView;
        if (cancelled) return;
        setGate((previous) => {
          if (previous?.execution === 'RUNNING' && result.execution !== 'RUNNING') router.refresh();
          return result;
        });
        if (result.execution === 'RUNNING') timer = setTimeout(() => void poll(), GATE_POLL_MS);
      } catch {
        if (!cancelled) timer = setTimeout(() => void poll(), GATE_POLL_MS);
      }
    }
    void poll();
    return () => {
      cancelled = true;
      if (timer !== null) clearTimeout(timer);
    };
  }, [mode, proposalId, localState, router]);

  function update(patch: Partial<ProposalFormValues>): void {
    setValues((current) => ({ ...current, ...patch }));
    setDirty(true);
    setPhase((current) => (current.kind === 'SAVED' ? { kind: 'IDLE' } : current));
  }

  function errorFor(status: number, code: string | undefined): string {
    if (code === 'PROPOSAL_NOT_EDITABLE') return messages.errorNotEditable;
    if (code === 'SKILL_SHEET_NOT_ATTACHABLE') return messages.errorNotClean;
    if (code === 'GATE_ALREADY_COMPLETED') return messages.errorGateAlreadyCompleted;
    if (code === 'PROPOSAL_RECIPIENT_MISSING') return messages.errorRecipientMissing;
    if (status === 400) return messages.errorValidation;
    return messages.errorGeneric;
  }

  async function readErrorCode(response: Response): Promise<string | undefined> {
    const body = (await response.json().catch(() => null)) as ErrorBody | null;
    return body?.error?.code;
  }

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (submitting || !editable) return;
    setError(null);
    if (mode === 'CREATE') {
      if (create === null) return;
      setPhase({ kind: 'SUBMITTING', action: 'CREATE' });
      try {
        const response = await fetch('/api/proposals', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ projectId: create.projectId, engineerId: create.engineerId, ...toProposalCreateBody(values) }),
        });
        if (!response.ok) {
          setError(errorFor(response.status, await readErrorCode(response)));
          setPhase({ kind: 'IDLE' });
          return;
        }
        const body = (await response.json()) as { id: string };
        setDirty(false);
        router.push(buildProposalEditHref(create.editHrefPattern, body.id));
      } catch {
        setError(messages.errorGeneric);
        setPhase({ kind: 'IDLE' });
      }
      return;
    }
    if (proposalId === null) return;
    setPhase({ kind: 'SUBMITTING', action: 'SAVE' });
    try {
      const response = await fetch(`/api/proposals/${proposalId}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        // 🔴 添付は変更したときだけ載せる（NG-1。凍結版をそのまま送り返すと、他社の台帳が見えないホストの保存が 404 になる）。
        body: JSON.stringify(toProposalPatchBody(values, initial)),
      });
      if (!response.ok) {
        setError(errorFor(response.status, await readErrorCode(response)));
        setPhase({ kind: 'IDLE' });
        return;
      }
      setDirty(false);
      setSavedRecipient(recipientOf(values));
      setPhase({ kind: 'SAVED' });
      router.refresh();
    } catch {
      setError(messages.errorGeneric);
      setPhase({ kind: 'IDLE' });
    }
  }

  async function requestGate(): Promise<void> {
    if (submitting || !editable || proposalId === null || gateBlockedReason !== null) return;
    setError(null);
    setPhase({ kind: 'SUBMITTING', action: 'GATE' });
    try {
      // 🔴 body を送らない（#39 は入力を 1 つも取らない。`force` / `skipLayers` に相当する入力は存在しない）。
      const response = await fetch(`/api/proposals/${proposalId}/gate`, { method: 'POST' });
      if (!response.ok) {
        setError(errorFor(response.status, await readErrorCode(response)));
        setPhase({ kind: 'IDLE' });
        return;
      }
      setLocalState('GATE_RUNNING');
      setGate(null);
      setPhase({ kind: 'GATE_REQUESTED' });
      router.refresh();
    } catch {
      setError(messages.errorGeneric);
      setPhase({ kind: 'IDLE' });
    }
  }

  // 🔴 T-09-11: 不合格（`GATE_FAILED`）から修正へ戻る唯一の導線。#48 の `MANUAL` `GATE_FAILED → DRAFT`（提案作成者の操作。
  //    docs/05 §6.5 #48）を呼ぶ。**ゲート結果は残る**（次の #39 が新しい内容で検査し直す）。「無視して送信」ではない ——
  //    戻した先は `DRAFT` であり、承認・送信へは #39 → 全層 PASS を経ないと進めない。
  const canReopen = mode === 'EDIT' && localState === 'GATE_FAILED' && canExecute;
  async function reopenDraft(): Promise<void> {
    if (submitting || !canReopen || proposalId === null) return;
    setError(null);
    setPhase({ kind: 'SUBMITTING', action: 'REOPEN' });
    try {
      const response = await fetch(`/api/proposals/${proposalId}/transition`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ to: 'DRAFT' }),
      });
      if (!response.ok) {
        setError(errorFor(response.status, await readErrorCode(response)));
        setPhase({ kind: 'IDLE' });
        return;
      }
      setLocalState('DRAFT');
      setGate(null);
      setPhase({ kind: 'IDLE' });
      router.refresh();
    } catch {
      setError(messages.errorGeneric);
      setPhase({ kind: 'IDLE' });
    }
  }

  const stateBadge =
    localState === null || props.stateLabel === null ? null : (
      <Badge variant={STATE_BADGE_VARIANTS[localState]} data-testid="proposal-editor-state">
        {localState === props.state ? props.stateLabel : messages.gateRunning}
      </Badge>
    );

  return (
    <form
      className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]"
      onSubmit={(event) => void submit(event)}
      data-testid="proposal-editor"
      data-mode={mode}
      data-proposal-state={localState ?? 'NEW'}
    >
      <div className="grid grid-cols-1 gap-4">
        {stateBadge === null ? null : (
          <div className="flex flex-wrap items-center gap-3" data-testid="proposal-editor-header">
            <span className="text-sm text-slate-500">{messages.fieldState}</span>
            {stateBadge}
          </div>
        )}

        {readOnlyNotice === null || localState !== props.state ? null : (
          <p role="status" className="m-0 border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700" data-testid="proposal-editor-read-only">
            {readOnlyNotice}
          </p>
        )}
        {canEdit && denialMessage !== null ? (
          <div role="alert" className="border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900" data-testid="proposal-editor-denied">
            <p className="font-bold">{messages.deniedTitle}</p>
            <p>{denialMessage}</p>
          </div>
        ) : null}
        {canEdit ? null : (
          <p className="m-0 text-sm text-slate-600" data-testid="proposal-editor-viewer">
            {messages.viewerNotice}
          </p>
        )}

        {/* セクション 1: 対象（案件 / エンジニア / 提案先） */}
        <Section id="target" title={messages.sectionTarget}>
          <dl className="mb-3 text-sm">
            {target.projectName === null ? (
              <DetailRow label={messages.fieldProject} value={messages.projectNotShared} field="project-not-shared" />
            ) : (
              <DetailRow label={messages.fieldProject} value={target.projectName} field="project-name" />
            )}
            <DetailRow label={messages.fieldEngineer} value={target.engineerName} field="engineer-name" />
            <DetailRow label={messages.fieldAffiliation} value={target.affiliation} field="affiliation" />
            {target.owner === null ? null : <DetailRow label={messages.fieldOwner} value={target.owner} field="owner" />}
            <DetailRow label={messages.fieldSkills} value={target.skills} field="skills" />
            {freeze.kind === 'FROZEN' ? (
              <>
                <DetailRow label={messages.fieldUnitPriceRange} value={target.unitPriceRange} field="unit-price-range" />
                <DetailRow label={messages.fieldAvailableFrom} value={target.availableFrom} field="available-from" />
              </>
            ) : null}
            <DetailRow label={messages.fieldCareerCount} value={freeze.careers} field="career-count" />
          </dl>
          {target.projectHref === null ? null : (
            <Link className={SECONDARY_LINK_CLASSES} href={target.projectHref} data-testid="proposal-editor-open-project">
              {messages.fieldProject}
            </Link>
          )}

          {/* 🔴 凍結の予告 / 凍結情報（`F-019 AC-2`。経験内容の行数とともに明示する） */}
          {freeze.kind === 'PREVIEW' ? (
            <div className="mt-3 border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-900" data-testid="proposal-editor-freeze-preview">
              <p className="mb-1">{freeze.lead}</p>
              <p className="mb-0 font-semibold" data-testid="proposal-editor-freeze-careers">
                {freeze.careers}
              </p>
              {freeze.zeroCareersNotice === null ? null : (
                <p role="status" className="mt-2 mb-0 border border-amber-300 bg-amber-50 px-3 py-2 text-amber-900" data-testid="proposal-editor-freeze-zero-careers">
                  {freeze.zeroCareersNotice}{' '}
                  <Link className="underline" href={freeze.engineerEditHref} data-testid="proposal-editor-open-engineer">
                    {messages.openEngineer}
                  </Link>
                </p>
              )}
            </div>
          ) : (
            <p className="mt-3 mb-0 border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-900" data-testid="proposal-editor-freeze-notice">
              {freeze.notice}
            </p>
          )}

          {/* 🔴 提案先。未設定なら無言で空にせず理由を出す（`docs/04` §S-020 改訂 10）。 */}
          <div className="mt-4" data-testid="proposal-editor-recipient">
            {recipientMissing ? (
              <p role="alert" className="mb-2 border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900" data-testid="proposal-editor-recipient-missing">
                {messages.recipientMissing}
              </p>
            ) : null}
            {originNotice === null ? null : (
              <p className="mb-2 text-sm text-slate-600" data-testid="proposal-editor-origin-notice">
                {originNotice}
              </p>
            )}
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Field label={`${messages.fieldRecipientCompanyName}（${messages.required}）`}>
                <Input
                  name="recipientCompanyName"
                  value={values.recipientCompanyName}
                  onChange={(event) => update({ recipientCompanyName: event.target.value })}
                  disabled={!editable || submitting}
                  required={mode === 'CREATE'}
                  maxLength={200}
                  data-testid="proposal-editor-recipient-company-name"
                />
              </Field>
              <Field label={`${messages.fieldRecipientEmail}（${messages.required}）`}>
                <Input
                  name="recipientEmail"
                  type="email"
                  value={values.recipientEmail}
                  onChange={(event) => update({ recipientEmail: event.target.value })}
                  disabled={!editable || submitting}
                  required={mode === 'CREATE'}
                  maxLength={254}
                  data-testid="proposal-editor-recipient-email"
                />
              </Field>
            </div>
            <p className="mt-2 mb-0 text-xs text-slate-500">{messages.recipientNote}</p>
          </div>
        </Section>

        {/* セクション 2: 提案条件 */}
        <Section id="terms" title={messages.sectionTerms}>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <Field label={messages.fieldOfferedUnitPrice}>
              <Input
                name="offeredUnitPrice"
                type="number"
                inputMode="numeric"
                min={0}
                step={1}
                value={values.offeredUnitPrice}
                onChange={(event) => update({ offeredUnitPrice: event.target.value })}
                disabled={!editable || submitting}
                data-testid="proposal-editor-offered-unit-price"
              />
            </Field>
            <Field label={messages.fieldOfferedStartDate}>
              <Input
                name="offeredStartDate"
                type="date"
                value={values.offeredStartDate}
                onChange={(event) => update({ offeredStartDate: event.target.value })}
                disabled={!editable || submitting}
                data-testid="proposal-editor-offered-start-date"
              />
            </Field>
            <Field label={messages.fieldWorkStyle}>
              <Input
                name="workStyle"
                value={values.workStyle}
                onChange={(event) => update({ workStyle: event.target.value })}
                disabled={!editable || submitting}
                maxLength={100}
                data-testid="proposal-editor-work-style"
              />
            </Field>
          </div>
        </Section>

        {/* セクション 3: 本文（由来を直上に示す） */}
        <Section id="content" title={messages.sectionContent}>
          <p className="mb-2 text-xs text-slate-500" data-testid="proposal-editor-body-origin">
            {messages.bodyOriginLabel}: {messages.bodyOriginManual}
          </p>
          <p className="mb-3 text-xs text-slate-500 sm:hidden" data-testid="proposal-editor-body-mobile-note">
            {messages.bodyMobileNote}
          </p>
          <Field label={messages.fieldSubject} className="mb-3">
            <Input
              name="subject"
              value={values.subject}
              onChange={(event) => update({ subject: event.target.value })}
              disabled={!editable || submitting}
              maxLength={200}
              data-testid="proposal-editor-subject"
            />
          </Field>
          <Field label={messages.fieldBody}>
            <Textarea
              name="body"
              rows={10}
              value={values.body}
              onChange={(event) => update({ body: event.target.value })}
              disabled={!editable || submitting}
              maxLength={20_000}
              data-testid="proposal-editor-body"
            />
          </Field>
        </Section>
      </div>

      <div className="grid grid-cols-1 gap-4">
        {/* セクション 4: 添付（`CLEAN` の版だけが選択肢） */}
        <Section id="attachment" title={messages.sectionAttachment}>
          {attachment.options.length === 0 ? (
            <div>
              {attachment.frozenUnknownNotice === null ? (
                <p className="m-0 text-sm text-slate-700" data-testid="proposal-editor-attachment-empty">
                  {attachment.emptyNotice ?? messages.attachmentFrozenNone}
                </p>
              ) : (
                <p className="m-0 text-sm text-slate-700" data-testid="proposal-editor-attachment-frozen-unknown">
                  {attachment.frozenUnknownNotice}
                </p>
              )}
              {attachment.sheetsHref === null ? null : (
                <Link className={`${SECONDARY_LINK_CLASSES} mt-2`} href={attachment.sheetsHref} data-testid="proposal-editor-attachment-open-sheets">
                  {messages.attachmentOpenSheets}
                </Link>
              )}
            </div>
          ) : (
            <Field label={messages.sectionAttachment}>
              <Select
                name="skillSheetId"
                value={values.skillSheetId}
                onChange={(event) => update({ skillSheetId: event.target.value })}
                // 🔴 新規作成では最新の CLEAN 版が自動で凍結される（差し替えは作成後）。
                disabled={mode === 'CREATE' || !editable || submitting}
                data-testid="proposal-editor-attachment"
              >
                <option value="">{messages.attachmentNone}</option>
                {attachment.options.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.label}
                  </option>
                ))}
              </Select>
            </Field>
          )}
          <p className="mt-2 mb-0 text-xs text-slate-500" data-testid="proposal-editor-attachment-clean-note">
            {attachment.cleanOnlyNote}
          </p>
        </Section>

        {/* セクション 5: ゲート結果（編集のみ。モバイルでも省略しない） */}
        {mode === 'EDIT' ? (
          <Section id="gate" title={messages.sectionGate}>
            {localState === 'DRAFT' && phase.kind !== 'GATE_REQUESTED' ? (
              <p className="m-0 text-sm text-slate-600" data-testid="proposal-editor-gate-not-requested">
                {messages.gateNotRequested}
              </p>
            ) : gate === null ? (
              <p role="status" className="m-0 text-sm text-slate-700" data-testid="proposal-editor-gate-loading">
                {phase.kind === 'GATE_REQUESTED' ? messages.gateRequested : messages.gateRunning}
              </p>
            ) : (
              <GateResult result={gate} messages={messages} />
            )}
          </Section>
        ) : null}

        {/* セクション 6: 送信元ドメインの状態（`U-04`） */}
        <Section id="sending-domain" title={messages.sectionSendingDomain}>
          {sendingDomain.kind === 'PARTNER' || sendingDomain.kind === 'NOT_REQUIRED' ? (
            <p className="m-0 text-sm text-slate-600" data-testid="proposal-editor-sending-domain">
              {sendingDomain.note}
            </p>
          ) : sendingDomain.kind === 'VERIFIED' ? (
            <p className="m-0 text-sm text-slate-900" data-testid="proposal-editor-sending-domain">
              {sendingDomain.label}
            </p>
          ) : (
            <div data-testid="proposal-editor-sending-domain">
              <p role="status" className="mb-2 border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
                {sendingDomain.notice}
              </p>
              <Link className={SECONDARY_LINK_CLASSES} href={sendingDomain.href} data-testid="proposal-editor-sending-domain-open">
                {sendingDomain.linkLabel}
              </Link>
            </div>
          )}
        </Section>

        {/* 操作 */}
        <div className="flex flex-wrap items-center gap-4" data-testid="proposal-editor-actions">
          {mode === 'CREATE' ? (
            <Button type="submit" disabled={!editable || submitting} data-testid="proposal-editor-create">
              {phase.kind === 'SUBMITTING' && phase.action === 'CREATE' ? messages.creating : messages.create}
            </Button>
          ) : (
            <>
              <Button type="submit" variant="secondary" disabled={!editable || submitting || !dirty} data-testid="proposal-editor-save">
                {phase.kind === 'SUBMITTING' && phase.action === 'SAVE' ? messages.saving : messages.save}
              </Button>
              {editableState ? (
                <Button
                  type="button"
                  disabled={!editable || submitting || gateBlockedReason !== null}
                  onClick={() => void requestGate()}
                  data-testid="proposal-editor-request-gate"
                >
                  {phase.kind === 'SUBMITTING' && phase.action === 'GATE' ? messages.requestingGate : messages.requestGate}
                </Button>
              ) : null}
              {canReopen ? (
                // 🔴 T-09-11: 不合格から修正へ戻る唯一の導線（`GATE_FAILED → DRAFT`）。「了解のうえ送信」は存在しない。
                <Button type="button" disabled={submitting} onClick={() => void reopenDraft()} data-testid="proposal-editor-reopen-draft">
                  {phase.kind === 'SUBMITTING' && phase.action === 'REOPEN' ? messages.reopeningDraft : messages.reopenDraft}
                </Button>
              ) : null}
            </>
          )}
          {approveHref === null ? null : (
            <Link className={SECONDARY_LINK_CLASSES} href={approveHref} data-testid="proposal-editor-open-approval">
              {approveLabel}
            </Link>
          )}
          <Link className={SECONDARY_LINK_CLASSES} href={cancelHref} data-testid="proposal-editor-cancel">
            {cancelLabel}
          </Link>
        </div>
        {canReopen ? (
          <p role="status" className="m-0 text-sm text-amber-900" data-testid="proposal-editor-reopen-draft-lead">
            {messages.reopenDraftLead}
          </p>
        ) : null}
        {/* 🔴 押せない理由を明示する（無言で disabled にしない）。 */}
        {mode === 'EDIT' && editable && gateBlockedReason !== null ? (
          <p role="status" className="m-0 text-sm text-amber-900" data-testid="proposal-editor-request-gate-blocked">
            {gateBlockedReason}
          </p>
        ) : null}
        {phase.kind === 'SAVED' ? (
          <p role="status" className="m-0 text-sm text-emerald-800" data-testid="proposal-editor-saved">
            {messages.saved}
          </p>
        ) : null}
        {error === null ? null : (
          <p role="alert" className="m-0 text-sm text-red-700" data-testid="proposal-editor-error">
            {error}
          </p>
        )}
      </div>
    </form>
  );
}
