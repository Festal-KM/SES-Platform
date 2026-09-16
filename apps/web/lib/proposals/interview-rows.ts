// apps/web/lib/proposals/interview-rows.ts
// `S-024` 商談結果の記録の表示値と「次に記録できる操作」の組み立て（docs/04 §S-024 / `F-025 AC-1`〜`AC-3` / docs/05 §6.5
// 「#48 の実装の決着」/「`S-024` の実装の決着（T-09-10）」）。T-09-10。
//
// ============================================================================
// 🔴 ここが守るもの
// ============================================================================
//   ① 🔴 **出す操作は遷移表 × #48 の射程 × 立場で決まる。状態の一覧をここに書き写さない。**
//      `proposalMachine.canTransition`（`CLAUDE.md` §4.2）→ `isManualProposalTransition`（#48 が動かせる `MANUAL`）→
//      `canTransitionProposal`（`policy.ts`。#48 の第 3 段と**同じ関数**）の順で絞る。取引先に `SUBMITTED → INTERVIEW_SCHEDULED` /
//      `RESULT_PENDING → WON` / `→ LOST` のボタンが**描かれない**のは、API が 403 を返すのと同じ判定から導かれる（書き写しではない）。
//   ② 🔴 **結果（`WON` / `LOST` / `WITHDRAWN`）を自動で確定する経路を持たない。** 本モジュールは操作の候補を並べるだけで、
//      「期限で見送りにする」「未返答なら辞退扱い」に相当する判定・設定値は存在しない（`F-025 AC-1`。`tests/static/proposal-outcome-human-only.test.ts`）。
//   ③ 判断材料（提案先 / エンジニア / 案件 / 単価 / 開始日 / 現在の状態 / 直近の履歴 3 件）は `S-021` / `S-023` と**同じ関数**
//      （`approvalHeaderRows` / `proposalTimelineRow`）で組む。凍結側だけを描く（`F-019 AC-5`）。
//   ④ 🔴 `WON` は Phase 1 では終端であり `Assignment` を作らない（`F-025 AC-2`。Phase 2 `F-042` で接続）。注記だけを出す。
//
// 🔴 文言は `packages/i18n` が唯一の出所（`CLAUDE.md` §3.5）。本ファイルは日本語の語を書かない。I/O を持たない。
import { t, type MessageKey } from '@ses/i18n';
import { isManualProposalTransition, proposalMachine, type ProposalState } from '@ses/domain';
import { approvalHeaderRows, type ApprovalHeaderRow } from './approval-rows';
import type { ProposalDetailScreenView } from './detail';
import { proposalTimelineRow, type ProposalTimelineRow } from './detail-rows';
import { proposalStateLabel } from './editor-rows';
import { proposalDetailHref } from './hrefs';
import {
  isTerminalInterviewOperation,
  PROPOSAL_INTERVIEW_OPERATION_KINDS,
  type ProposalInterviewOperationKind,
} from './interview-note';
import { proposalStateTone, type ProposalStateTone } from './list-rows';
import type { ProposalTransitionActor, ProposalTransitionSubject } from './policy';
import { canTransitionProposal } from './policy';

export type { ProposalInterviewOperationKind } from './interview-note';

/** 操作 → #48 の `to`。`GATE_FAILED → DRAFT`（修正のための差し戻し）は `S-020` / `S-023` の範囲であり、ここに無い。 */
export const PROPOSAL_INTERVIEW_OPERATION_TARGETS = {
  SCHEDULE: 'INTERVIEW_SCHEDULED',
  INTERVIEWED: 'INTERVIEWED',
  RESULT_PENDING: 'RESULT_PENDING',
  WON: 'WON',
  LOST: 'LOST',
  WITHDRAWN: 'WITHDRAWN',
} as const satisfies Record<ProposalInterviewOperationKind, ProposalState>;

const OPERATION_MESSAGE_KEYS = {
  SCHEDULE: 'proposals.interview.operation.SCHEDULE',
  INTERVIEWED: 'proposals.interview.operation.INTERVIEWED',
  RESULT_PENDING: 'proposals.interview.operation.RESULT_PENDING',
  WON: 'proposals.interview.operation.WON',
  LOST: 'proposals.interview.operation.LOST',
  WITHDRAWN: 'proposals.interview.operation.WITHDRAWN',
} as const satisfies Record<ProposalInterviewOperationKind, MessageKey>;

/** 操作ごとに描く入力欄。 */
export type ProposalInterviewOperationInputs = {
  readonly scheduledAt: boolean;
  readonly interviewedOn: boolean;
  /** 要点（`memo`）か理由（`reason`）か。欄は 1 つで、語だけが違う。 */
  readonly memo: 'MEMO' | 'REASON';
};

const OPERATION_INPUTS = {
  SCHEDULE: { scheduledAt: true, interviewedOn: false, memo: 'MEMO' },
  INTERVIEWED: { scheduledAt: false, interviewedOn: true, memo: 'MEMO' },
  RESULT_PENDING: { scheduledAt: false, interviewedOn: false, memo: 'MEMO' },
  WON: { scheduledAt: false, interviewedOn: false, memo: 'REASON' },
  LOST: { scheduledAt: false, interviewedOn: false, memo: 'REASON' },
  WITHDRAWN: { scheduledAt: false, interviewedOn: false, memo: 'REASON' },
} as const satisfies Record<ProposalInterviewOperationKind, ProposalInterviewOperationInputs>;

export type ProposalInterviewOperation = {
  readonly kind: ProposalInterviewOperationKind;
  readonly to: ProposalState;
  readonly label: string;
  /** 🔴 終端（戻れない）。画面は確認ステップを置く。 */
  readonly terminal: boolean;
  /** 進行（primary）か、それ以外（辞退 / 見送り = secondary）か。 */
  readonly emphasis: 'PRIMARY' | 'SECONDARY';
  readonly inputs: ProposalInterviewOperationInputs;
  /** 確認ステップの説明（終端だけ。`null` = 確認なし）。 */
  readonly confirmLead: string | null;
};

const CONFIRM_LEAD_KEYS: Readonly<Partial<Record<ProposalInterviewOperationKind, MessageKey>>> = {
  WON: 'proposals.interview.confirm.lead.WON',
  LOST: 'proposals.interview.confirm.lead.LOST',
  WITHDRAWN: 'proposals.interview.confirm.lead.WITHDRAWN',
};

/**
 * 🔴 いまの状態で、この立場が記録できる操作（docs/04 §S-024「現在の状態に応じて次に記録できる遷移だけ」）。
 *    順序は `PROPOSAL_INTERVIEW_OPERATION_KINDS`（進行 → 結果 → 辞退）。
 */
export function proposalInterviewOperations(
  actor: ProposalTransitionActor,
  subject: ProposalTransitionSubject,
  state: ProposalState,
): readonly ProposalInterviewOperation[] {
  const operations: ProposalInterviewOperation[] = [];
  for (const kind of PROPOSAL_INTERVIEW_OPERATION_KINDS) {
    const to = PROPOSAL_INTERVIEW_OPERATION_TARGETS[kind];
    if (!proposalMachine.canTransition(state, to)) continue;
    if (!isManualProposalTransition(state, to)) continue;
    if (!canTransitionProposal(actor, subject, { from: state, to })) continue;
    const terminal = isTerminalInterviewOperation(kind);
    const confirmKey = CONFIRM_LEAD_KEYS[kind];
    operations.push({
      kind,
      to,
      label: t(OPERATION_MESSAGE_KEYS[kind]),
      terminal,
      emphasis: kind === 'WITHDRAWN' || kind === 'LOST' ? 'SECONDARY' : 'PRIMARY',
      inputs: OPERATION_INPUTS[kind],
      confirmLead: confirmKey === undefined ? null : t(confirmKey),
    });
  }
  return operations;
}

/** 画面の段階（状態から決まる。立場は関係しない）。 */
export type ProposalInterviewPhase =
  /** 商談中（`SUBMITTED` 〜 `RESULT_PENDING`）。誰かが記録できる。 */
  | 'RECORDABLE'
  /** 終端（`WON` / `LOST` / `WITHDRAWN`）。 */
  | 'CLOSED'
  /** まだ送信されていない（`DRAFT` 〜 `SUBMIT_FAILED`）。 */
  | 'NOT_YET_SUBMITTED';

/** 🔴 状態の列挙を書かずに段階を決める（遷移表と操作 → `to` の対応から導く）。 */
export function proposalInterviewPhase(state: ProposalState): ProposalInterviewPhase {
  if (proposalMachine.isTerminal(state)) return 'CLOSED';
  const recordable = PROPOSAL_INTERVIEW_OPERATION_KINDS.some((kind) =>
    proposalMachine.canTransition(state, PROPOSAL_INTERVIEW_OPERATION_TARGETS[kind]),
  );
  return recordable ? 'RECORDABLE' : 'NOT_YET_SUBMITTED';
}

/** 判断材料として出す欄（`approvalHeaderRows` の部分集合。`owner` は取引先作成のときだけ存在する）。 */
export const INTERVIEW_HEADER_FIELDS = ['recipient', 'engineer', 'owner', 'project', 'unit-price', 'start-date'] as const;

/** 直近の履歴として出す件数（docs/04 §S-024 セクション 1 に添える判断材料。全件は `S-023`）。 */
export const INTERVIEW_RECENT_EVENT_COUNT = 3;

export type ProposalInterviewRows = {
  readonly id: string;
  readonly state: ProposalState;
  readonly stateLabel: string;
  readonly tone: ProposalStateTone;
  readonly audience: 'HOST' | 'PARTNER';
  readonly phase: ProposalInterviewPhase;
  readonly header: readonly ApprovalHeaderRow[];
  /** 新しい順。最大 `INTERVIEW_RECENT_EVENT_COUNT` 件。 */
  readonly recent: readonly ProposalTimelineRow[];
  readonly operations: readonly ProposalInterviewOperation[];
  /** 終端の注記（`CLOSED` のとき）。 */
  readonly closedNotice: string | null;
  /** 🔴 `WON` だけ: 稼働の登録は Phase 2（`F-042`）。`Assignment` は作らない。 */
  readonly assignmentNote: string | null;
  /** 未送信の注記（`NOT_YET_SUBMITTED` のとき）。 */
  readonly notRecordableNotice: string | null;
  readonly audienceNotice: string | null;
  readonly detailHref: string;
};

const CLOSED_NOTICE_KEYS: Readonly<Partial<Record<ProposalState, MessageKey>>> = {
  WON: 'proposals.interview.closed.WON',
  LOST: 'proposals.interview.closed.LOST',
  WITHDRAWN: 'proposals.interview.closed.WITHDRAWN',
};

export function proposalInterviewRows(
  screen: ProposalDetailScreenView,
  actor: ProposalTransitionActor,
  subject: ProposalTransitionSubject,
  now: Date,
): ProposalInterviewRows {
  const { detail } = screen;
  const phase = proposalInterviewPhase(detail.state);
  const header = approvalHeaderRows({ view: detail, createdByName: detail.createdByName }, now).filter((row) =>
    (INTERVIEW_HEADER_FIELDS as readonly string[]).includes(row.field),
  );
  const recent = detail.events.slice(-INTERVIEW_RECENT_EVENT_COUNT).reverse().map(proposalTimelineRow);
  const closedKey = CLOSED_NOTICE_KEYS[detail.state];
  return {
    id: detail.id,
    state: detail.state,
    stateLabel: proposalStateLabel(detail.state),
    tone: proposalStateTone(detail.state),
    audience: detail.audience,
    phase,
    header,
    recent,
    operations: phase === 'RECORDABLE' ? proposalInterviewOperations(actor, subject, detail.state) : [],
    closedNotice: phase === 'CLOSED' && closedKey !== undefined ? t(closedKey) : null,
    assignmentNote: detail.state === 'WON' ? t('proposals.interview.closed.WON.assignmentNote') : null,
    notRecordableNotice: phase === 'NOT_YET_SUBMITTED' ? t('proposals.interview.notRecordable') : null,
    audienceNotice: detail.audience === 'PARTNER' ? t('proposals.interview.partnerNotice') : null,
    detailHref: proposalDetailHref(detail.id),
  };
}
