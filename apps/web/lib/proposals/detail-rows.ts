// apps/web/lib/proposals/detail-rows.ts
// `S-023` 提案の詳細と履歴の表示値の組み立て（docs/04 §S-023 / `F-024` / `F-021 AC-5` / docs/05 §10.4 / §11.10 ⑤）。T-09-09。
//
// 🔴 画面（`app/(main)/proposals/[id]/**`）ではなくここに置く理由は `approval-rows.ts` と同じ: `app/**` はユニットテストの対象外であり、
//    「履歴の 6 種が別の語で描き分けられる」「自動承認は『システム（全層 PASS のため）』」「却下由来の `DRAFT` の導線が『内容を変更してから』
//    と伝える」「取引先の行に承認者・送信試行・保留が現れない」を固定できる場所が要る。**I/O を持たない。**
// 🔴 文言は `packages/i18n` が唯一の出所（`CLAUDE.md` §3.5）。本ファイルは日本語の語を書かない。
// 🔴 **概要は `S-021` の判断ヘッダと同じ材料・同じ関数**（`approvalHeaderRows`）。凍結側だけを描き、台帳の現在値を混ぜない。
import { t, type MessageKey } from '@ses/i18n';
import type { GateExecution, GateResultHistoryItem, GateResultHistoryView, ProposalState } from '@ses/domain';
import { formatCareerPeriod } from '../engineers/detail';
import { formatDateTimeJst } from '../format/datetime';
import { formatThousands } from '../format/number';
import {
  approvalGateRows,
  approvalHeaderRows,
  approvalSendHoldRows,
  type ApprovalGateRows,
  type ApprovalHeaderRow,
  type ApprovalSendHoldRows,
} from './approval-rows';
import type { ProposalDetailScreenView } from './detail';
import { proposalStateLabel } from './editor-rows';
import { PROPOSAL_SEND_FAILURES_PATH, proposalApproveHref, proposalEditHref, proposalInterviewHref } from './hrefs';
import { PROPOSAL_FAILURE_STATES, proposalFailureKindOf, proposalStateTone, type ProposalFailureKind, type ProposalStateTone } from './list-rows';
import type { UpdateProposalBody } from './schemas';
import type { ProposalApprovalRecordView, ProposalEventView, ProposalSendAttemptView } from './views';

export type { ProposalFailureKind, ProposalStateTone } from './list-rows';

/** 履歴 1 件の表示（`kind` は `entry.kind` + 作成 / 却下の 2 つを足した 9 値。`data-event-kind` に載せる）。 */
export type ProposalTimelineKind =
  | 'CREATED'
  | 'TRANSITION'
  | 'REJECT'
  | 'APPROVAL'
  | 'RESEND'
  | 'SEND_FAILURE'
  | 'DRAFT_UPDATED'
  | 'NOTE'
  | 'OTHER';

export type ProposalTimelineRow = {
  readonly id: string;
  readonly occurredAt: string;
  readonly actor: string;
  readonly actorKind: 'USER' | 'SYSTEM';
  readonly kind: ProposalTimelineKind;
  readonly title: string;
  /** 遷移の表現（`from → to`）。遷移でなければ `null`。 */
  readonly transition: string | null;
  /** メモ / 理由 / 種別 / 項目名 / 検査 ID。無ければ `null`。 */
  readonly detail: string | null;
  readonly attachment: string | null;
};

export type ProposalFrozenCareerRow = {
  readonly key: string;
  readonly period: string;
  readonly role: string;
  readonly description: string;
  readonly technologies: string;
};

export type ProposalDetailFrozenRows = {
  readonly notice: string;
  readonly subject: string;
  readonly body: string;
  readonly attachment: string;
  /** 「YYYY-MM-DD HH:mm 時点の経験内容 — N 行」（`docs/04` §S-023 セクション 3。日時を必ず添える）。 */
  readonly careersTitle: string;
  readonly careers: readonly ProposalFrozenCareerRow[];
  readonly careersEmpty: string | null;
};

export type ProposalDetailSendAttemptRow = {
  readonly attemptSeq: number;
  readonly statusLabel: string;
  readonly status: string;
  readonly failureKind: string | null;
  readonly settledAt: string | null;
};

export type ProposalDetailSendAttemptsRows = {
  readonly count: string;
  readonly last: string | null;
  readonly items: readonly ProposalDetailSendAttemptRow[];
};

/** 状態に応じた導線（`docs/04` §S-023 操作と結果 + T-09-09 の割り当て）。 */
export type ProposalDetailAction = {
  readonly key: 'EDITOR' | 'APPROVAL' | 'SUBMIT' | 'SEND_FAILURES' | 'INTERVIEW';
  readonly href: string;
  readonly label: string;
  /** 導線の前に置く説明（却下由来 / 検査で不合格）。無ければ `null`。 */
  readonly lead: string | null;
};

/**
 * ✅ T-12-14 ②: `S-023` セクション 4「ゲート結果の履歴」の 1 実行（docs/05 §6.5「#40b と `S-023` セクション 4 の設計」）。
 * 🔴 層別結果（`gate`）は `S-021` と同じ view model 関数 `approvalGateRows` で組む（履歴用の別実装を書かない）。
 */
export type ProposalGateHistoryItemRows = {
  readonly reviewGateId: string;
  readonly execution: GateExecution;
  /** 見出し。`DONE` = 「実行日時: …」/ HELD = 「上限到達で未実行（保留開始: …）」。 */
  readonly title: string;
  /** 🔴 「現在の内容に対する結果」/「以前の内容に対する結果」の印。 */
  readonly contentNote: string;
  readonly matchesCurrentContent: boolean;
  readonly gate: ApprovalGateRows;
};

export type ProposalGateHistoryRows = {
  /** 降順（新しい実行が先。#40b の並びのまま）。 */
  readonly items: readonly ProposalGateHistoryItemRows[];
  /** 0 件（まだ一度も依頼していない）の文言。1 件以上なら `null`。 */
  readonly empty: string | null;
};

export type ProposalDetailRows = {
  readonly id: string;
  readonly state: ProposalState;
  readonly stateLabel: string;
  readonly tone: ProposalStateTone;
  readonly failureKind: ProposalFailureKind | null;
  /** 🔴 モバイルの固定ヘッダ（状態 + 提案先 + 単価。折りたたみの外。`docs/04` §S-023 デバイス別）。 */
  readonly fixed: { readonly recipient: string; readonly unitPrice: string };
  readonly header: readonly ApprovalHeaderRow[];
  /** 承認者欄。取引先・未承認は `null`。 */
  readonly approver: string | null;
  readonly submittedAt: string | null;
  /** 🔴 ホストだけ（取引先の型に無い）。 */
  readonly sendHold: ApprovalSendHoldRows | null;
  readonly sendAttempts: ProposalDetailSendAttemptsRows | null;
  readonly lastFailureReason: string | null;
  readonly timeline: readonly ProposalTimelineRow[];
  readonly frozen: ProposalDetailFrozenRows;
  readonly gate: ApprovalGateRows;
  readonly actions: readonly ProposalDetailAction[];
  readonly actionsEmpty: string | null;
  readonly canAddNote: boolean;
  readonly audienceNotice: string | null;
};

function none(): string {
  return t('proposals.list.valueNone');
}

/** #37 が `DRAFT_UPDATED:<keys>` に残すキー名 → `S-020` の欄の語（未知のキーはそのまま）。 */
const UPDATE_FIELD_MESSAGE_KEYS = {
  recipientCompanyName: 'proposals.editor.field.recipientCompanyName',
  recipientEmail: 'proposals.editor.field.recipientEmail',
  offeredUnitPrice: 'proposals.editor.field.offeredUnitPrice',
  offeredStartDate: 'proposals.editor.field.offeredStartDate',
  workStyle: 'proposals.editor.field.workStyle',
  subject: 'proposals.editor.field.subject',
  body: 'proposals.editor.field.body',
  skillSheetId: 'proposals.detail.frozen.attachment',
} as const satisfies Record<keyof UpdateProposalBody, MessageKey>;

function updateFieldLabel(field: string): string {
  const keys: Readonly<Record<string, MessageKey | undefined>> = UPDATE_FIELD_MESSAGE_KEYS;
  const key = keys[field];
  return key === undefined ? field : t(key);
}

const ATTEMPT_STATUS_MESSAGE_KEYS: Readonly<Record<string, MessageKey | undefined>> = {
  RESERVED: 'proposals.detail.attemptStatus.RESERVED',
  SUCCEEDED: 'proposals.detail.attemptStatus.SUCCEEDED',
  FAILED: 'proposals.detail.attemptStatus.FAILED',
  UNKNOWN: 'proposals.detail.attemptStatus.UNKNOWN',
};

function attemptStatusLabel(status: string): string {
  const key = ATTEMPT_STATUS_MESSAGE_KEYS[status];
  return key === undefined ? status : t(key);
}

function approverLabel(approval: ProposalApprovalRecordView): string | null {
  switch (approval.kind) {
    case 'NONE':
      return null;
    case 'SYSTEM':
      return `${t('proposals.approval.approver.system')} / ${formatDateTimeJst(approval.approvedAt)}`;
    case 'USER':
      return `${approval.approverName ?? t('proposals.approval.approver.unknownUser')} / ${formatDateTimeJst(approval.approvedAt)}`;
  }
}

function transitionLabel(from: ProposalState | null, to: ProposalState | null): string | null {
  if (to === null) return null;
  const arrow = t('proposals.detail.timeline.transition.arrow');
  return `${from === null ? none() : proposalStateLabel(from)}${arrow}${proposalStateLabel(to)}`;
}

/**
 * 🔴 履歴 1 件の描き分け（`docs/04` §S-023「日時 / 主体 / 出来事 / メモ / 添付」）。
 * - 作成（`null → DRAFT`）/ 却下（`APPROVAL_PENDING → DRAFT`）は遷移の中でも語を分ける（作成者が「なぜ下書きに戻ったか」を読むため）
 * - 🔴 自動承認は主体を「システム（全層 PASS のため）」と表示する（`F-021 AC-5`）
 */
export function proposalTimelineRow(event: ProposalEventView): ProposalTimelineRow {
  const actorKind = event.actor.kind;
  const isApproval = event.entry.kind === 'APPROVAL';
  const actor =
    event.actor.kind === 'SYSTEM'
      ? isApproval
        ? t('proposals.detail.timeline.actor.systemAutoApprove')
        : t('proposals.detail.timeline.actor.system')
      : (event.actor.displayName ?? t('proposals.detail.timeline.actor.unknownUser'));
  const base = {
    id: event.id,
    occurredAt: formatDateTimeJst(event.occurredAt),
    actor,
    actorKind,
    attachment: event.attachmentKey === null ? null : `${t('proposals.detail.timeline.attachmentPrefix')}${event.attachmentKey}`,
  };
  const entry = event.entry;
  switch (entry.kind) {
    case 'TRANSITION': {
      if (event.fromState === null && event.toState === 'DRAFT') {
        return { ...base, kind: 'CREATED', title: t('proposals.detail.timeline.kind.created'), transition: null, detail: entry.note };
      }
      if (event.fromState === 'APPROVAL_PENDING' && event.toState === 'DRAFT') {
        return {
          ...base,
          kind: 'REJECT',
          title: t('proposals.detail.timeline.kind.reject'),
          transition: transitionLabel(event.fromState, event.toState),
          detail: entry.note,
        };
      }
      return {
        ...base,
        kind: 'TRANSITION',
        title: t('proposals.detail.timeline.kind.transition'),
        transition: transitionLabel(event.fromState, event.toState),
        detail: entry.note,
      };
    }
    case 'APPROVAL':
      return {
        ...base,
        kind: 'APPROVAL',
        title: t('proposals.detail.timeline.kind.approval'),
        transition: transitionLabel(event.fromState, event.toState),
        detail: `${t('proposals.detail.timeline.approval.gatePrefix')}${entry.reviewGateId}`,
      };
    case 'RESEND':
      return {
        ...base,
        kind: 'RESEND',
        title: t('proposals.detail.timeline.kind.resend'),
        transition: transitionLabel(event.fromState, event.toState),
        detail: entry.reason === null ? null : `${t('proposals.detail.timeline.resend.reasonPrefix')}${entry.reason}`,
      };
    case 'SEND_FAILURE':
      return {
        ...base,
        kind: 'SEND_FAILURE',
        title: t('proposals.detail.timeline.kind.sendFailure'),
        transition: transitionLabel(event.fromState, event.toState),
        detail: entry.failureKind === null ? null : `${t('proposals.detail.timeline.sendFailure.kindPrefix')}${entry.failureKind}`,
      };
    case 'DRAFT_UPDATED':
      return {
        ...base,
        kind: 'DRAFT_UPDATED',
        title: t('proposals.detail.timeline.kind.draftUpdated'),
        transition: null,
        detail:
          entry.fields.length === 0
            ? null
            : `${t('proposals.detail.timeline.draftUpdated.fieldsPrefix')}${entry.fields.map(updateFieldLabel).join(' / ')}`,
      };
    case 'NOTE':
      return { ...base, kind: 'NOTE', title: t('proposals.detail.timeline.kind.note'), transition: null, detail: entry.note };
    case 'OTHER':
      return {
        ...base,
        kind: 'OTHER',
        title: t('proposals.detail.timeline.kind.other'),
        transition: transitionLabel(event.fromState, event.toState),
        detail: entry.note,
      };
  }
}

/** 🔴 直近の `DRAFT` への戻りが却下（#42）由来か（T-09-03 の申し送り: 内容を変えずに再依頼すると 422 `GATE_ALREADY_COMPLETED`）。 */
export function isRejectedDraft(state: ProposalState, events: readonly ProposalEventView[]): boolean {
  if (state !== 'DRAFT') return false;
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index];
    if (event === undefined || event.kind !== 'STATE' || event.toState !== 'DRAFT') continue;
    return event.fromState === 'APPROVAL_PENDING';
  }
  return false;
}

function actionsFor(
  state: ProposalState,
  proposalId: string,
  audience: 'HOST' | 'PARTNER',
  rejectedDraft: boolean,
): readonly ProposalDetailAction[] {
  switch (state) {
    case 'DRAFT':
      return [
        {
          key: 'EDITOR',
          href: proposalEditHref(proposalId),
          label: t('proposals.detail.action.openEditor'),
          lead: rejectedDraft ? t('proposals.detail.action.rejectedLead') : null,
        },
      ];
    case 'GATE_FAILED':
      return [{ key: 'EDITOR', href: proposalEditHref(proposalId), label: t('proposals.detail.action.openEditor'), lead: t('proposals.detail.action.gateFailedLead') }];
    case 'GATE_RUNNING':
    case 'APPROVAL_PENDING':
    case 'SUBMITTING':
      return [{ key: 'APPROVAL', href: proposalApproveHref(proposalId), label: t('proposals.detail.action.openApproval'), lead: null }];
    case 'APPROVED':
      // 🔴 送信の要求は `S-021` の「送信する」（#43）。ここに送信ボタンを置かない（判断材料を見ずに送れる導線を作らない）。
      return audience === 'HOST'
        ? [{ key: 'SUBMIT', href: proposalApproveHref(proposalId), label: t('proposals.detail.action.openSubmit'), lead: null }]
        : [{ key: 'APPROVAL', href: proposalApproveHref(proposalId), label: t('proposals.detail.action.openApproval'), lead: null }];
    case 'SUBMIT_FAILED':
      // 🔴 再送は `S-022` の確認ステップを経る（#44）。取引先には導線が無い（`S-022` に到達しない）。
      return audience === 'HOST'
        ? [{ key: 'SEND_FAILURES', href: PROPOSAL_SEND_FAILURES_PATH, label: t('proposals.detail.action.openSendFailures'), lead: null }]
        : [];
    case 'SUBMITTED':
    case 'INTERVIEW_SCHEDULED':
    case 'INTERVIEWED':
    case 'RESULT_PENDING':
      // `S-024`（T-09-10）。リンクだけ先に置く。
      return [{ key: 'INTERVIEW', href: proposalInterviewHref(proposalId), label: t('proposals.detail.action.openInterview'), lead: null }];
    case 'WON':
    case 'LOST':
    case 'WITHDRAWN':
      return [];
  }
}

function sendAttemptsRows(attempts: readonly ProposalSendAttemptView[]): ProposalDetailSendAttemptsRows {
  const last = attempts[attempts.length - 1];
  return {
    count: `${formatThousands(attempts.length)}${t('proposals.detail.sendAttempts.countSuffix')}`,
    last:
      last === undefined
        ? null
        : `${t('proposals.detail.sendAttempts.lastPrefix')}${attemptStatusLabel(last.status)}${last.failureKind === null ? '' : `（${last.failureKind}）`}`,
    items: attempts.map((attempt) => ({
      attemptSeq: attempt.attemptSeq,
      statusLabel: attemptStatusLabel(attempt.status),
      status: attempt.status,
      failureKind: attempt.failureKind,
      settledAt: attempt.settledAt === null ? null : formatDateTimeJst(attempt.settledAt),
    })),
  };
}

export function proposalDetailRows(screen: ProposalDetailScreenView, now: Date): ProposalDetailRows {
  const { detail } = screen;
  const rejectedDraft = isRejectedDraft(detail.state, detail.events);
  const actions = actionsFor(detail.state, detail.id, detail.audience, rejectedDraft);
  const careers = detail.snapshot.careers;
  return {
    id: detail.id,
    state: detail.state,
    stateLabel: proposalStateLabel(detail.state),
    tone: proposalStateTone(detail.state),
    failureKind: proposalFailureKindOf(detail.state),
    fixed: {
      recipient: detail.recipient === null ? t('proposals.list.recipient.unset') : detail.recipient.companyName,
      unitPrice: detail.terms.offeredUnitPrice === null ? t('proposals.approval.unitPriceUnset') : formatThousands(detail.terms.offeredUnitPrice),
    },
    header: approvalHeaderRows({ view: detail, createdByName: detail.createdByName }, now),
    approver: detail.audience === 'HOST' ? approverLabel(detail.approval) : null,
    submittedAt: detail.submittedAt === null ? null : formatDateTimeJst(detail.submittedAt),
    sendHold: detail.audience === 'HOST' ? approvalSendHoldRows(detail.sendHold) : null,
    sendAttempts: detail.audience === 'HOST' ? sendAttemptsRows(detail.sendAttempts) : null,
    lastFailureReason: detail.audience === 'HOST' ? detail.lastFailureReason : null,
    // 🔴 T-12-14 ③: 履歴は**新しい順**（docs/04 §10.3「履歴 = 新しい順」/ §S-023 改訂 13「最新行は直近 10 行の先頭であるため
    //    構造的に隠れない」）。#46 の `events` は古い順（`readEvents`）なので、ここで反転する（`S-024` の直近 3 件と同じ向き）。
    timeline: detail.events.map(proposalTimelineRow).reverse(),
    frozen: {
      notice: `${t('proposals.approval.frozenNotice.prefix')}${formatDateTimeJst(detail.snapshot.frozenAt)}${t('proposals.approval.frozenNotice.suffix')}`,
      subject: detail.content.subject ?? t('proposals.detail.frozen.empty'),
      body: detail.content.body ?? t('proposals.detail.frozen.empty'),
      attachment: detail.attachment.skillSheetId === null ? t('proposals.detail.frozen.attachment.none') : t('proposals.detail.frozen.attachment.present'),
      careersTitle: `${formatDateTimeJst(detail.snapshot.frozenAt)}${t('proposals.detail.frozen.careers.middle')}${formatThousands(careers.length)}${t('proposals.detail.frozen.careers.suffix')}`,
      careers: careers.map((career, index) => ({
        key: `career-${String(index)}`,
        period: formatCareerPeriod(career.periodFrom, career.periodTo),
        role: career.role,
        description: career.description,
        technologies: career.technologies === '' ? none() : career.technologies,
      })),
      careersEmpty: careers.length === 0 ? t('proposals.detail.frozen.careers.empty') : null,
    },
    gate: approvalGateRows(screen.gate),
    actions,
    actionsEmpty: actions.length === 0 ? t('proposals.detail.action.none') : null,
    canAddNote: screen.canAddNote,
    audienceNotice: detail.audience === 'PARTNER' ? t('proposals.detail.partnerNotice') : null,
  };
}

function gateHistoryTitle(item: GateResultHistoryItem): string {
  if (item.execution === 'HELD_AI_COST_LIMIT') {
    // 🔴 HELD は未実行であり不合格ではない。保留開始時刻（`heldSince`）を添える（`F-027 AC-5`）。
    const since = item.heldSince === null ? none() : formatDateTimeJst(item.heldSince);
    return `${t('proposals.detail.gateHistory.held.prefix')}${since}${t('proposals.detail.gateHistory.held.suffix')}`;
  }
  return `${t('proposals.detail.gateHistory.executedAt.prefix')}${item.executedAt === null ? none() : formatDateTimeJst(item.executedAt)}`;
}

/**
 * ✅ T-12-14 ②③: `S-023` セクション 4「ゲート結果の履歴」（#40b `readProposalGateResults` の結果）。
 *
 * - 1 実行 = 1 ブロック。見出しは実行日時（HELD は「上限到達で未実行（保留開始: …）」）+ `matchesCurrentContent` の印
 * - 🔴 層別結果は `approvalGateRows`（`S-021` と同じ 1 関数）。`GateResultHistoryItem` は `GateResultView` の部分構造をそのまま持つ
 * - 並びは #40b のまま（降順）。折りたたみ（直近 10 件 + 「すべて表示」）は画面の共通部品（`FoldedList`）が担う
 */
export function proposalGateHistoryRows(history: GateResultHistoryView): ProposalGateHistoryRows {
  const items = history.items.map((item) => ({
    reviewGateId: item.reviewGateId,
    execution: item.execution,
    title: gateHistoryTitle(item),
    contentNote: item.matchesCurrentContent ? t('proposals.detail.gateHistory.matchesCurrent') : t('proposals.detail.gateHistory.previousContent'),
    matchesCurrentContent: item.matchesCurrentContent,
    gate: approvalGateRows(item),
  }));
  return { items, empty: items.length === 0 ? t('proposals.approval.gate.notRequested') : null };
}

/** 🔴 3 区分（`GATE_FAILED` / `SUBMIT_FAILED` / `LOST`）の語が互いに異なることをテストが固定するための出所。 */
export const PROPOSAL_FAILURE_STATE_LABELS = (): Readonly<Record<ProposalFailureKind, string>> =>
  Object.fromEntries(PROPOSAL_FAILURE_STATES.map((state) => [state, proposalStateLabel(state)])) as Readonly<Record<ProposalFailureKind, string>>;

