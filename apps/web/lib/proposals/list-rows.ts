// apps/web/lib/proposals/list-rows.ts
// `S-019` 提案一覧の表示値の組み立て（docs/04 §S-019 / `F-024 AC-2` / docs/05 §10.4）。T-09-09。
//
// 🔴 画面（`app/(main)/proposals/(list)/**`）ではなくここに置く理由は `send-failure-rows.ts` と同じ: `app/**` はユニットテストの
//    対象外であり、「4 つの『うまくいかなかった』が別のチップ・別の語である」「保留は `SUBMIT_FAILED` と別の印である」「提案依頼の
//    5 状態は別のブロックである」を固定できる場所が要る。**I/O を持たない。**
// 🔴 文言は `packages/i18n` が唯一の出所（`CLAUDE.md` §3.5）。本ファイルは日本語の語を書かない。
// 🔴 ホストと取引先で**同じ行の型**（`ProposalListRowView`）に畳む —— 画面は 1 つで、違うのは作成会社の列（ホストだけ）と
//    保留の注記（ホストだけ）である。畳んでも `sendHold` / `owner` が取引先の行に現れないのは、入力の型（`views.ts`）に無いからである。
import { t, type MessageKey } from '@ses/i18n';
import { proposalIndicatorOf, type ProposalIndicator, type ProposalRequestState, type ProposalState } from '@ses/domain';
import { PROPOSAL_REQUEST_STATE_MESSAGE_KEYS } from '../proposal-requests/list-rows';
import { formatDateTimeJst } from '../format/datetime';
import { formatThousands } from '../format/number';
import { approvalSendHoldRows, formatElapsed } from './approval-rows';
import { proposalStateLabel } from './editor-rows';
import { PROPOSAL_SEND_FAILURES_PATH, proposalDetailHref } from './hrefs';
import type { ProposalListQuery } from './schemas';
import type { HostProposalListItem, PartnerProposalListItem, ProposalCountByState, ProposalRequestCountByState } from './views';

/** `S-017`（提案依頼の一覧）の入口。提案依頼のチップはこちらへ送る（`S-019` の表には出さない）。 */
const PROPOSAL_REQUESTS_PATH = '/proposal-requests';

/** 🔴 「送信中のまま 30 分経過」の注記の閾値（`docs/04` §S-019 非同期処理の表現）。表示だけであり判定には使わない。 */
export const SUBMITTING_STUCK_MINUTES = 30;

/**
 * 🔴 「うまくいかなかった」の区分（`F-024 AC-2` / `BR-23`）。`Proposal` 側の 3 つ。**提案依頼の `DECLINED` はここに無い**
 *    （別エンティティ。`ProposalRequestState`）。一覧の行は `data-failure-kind` にこの値を載せ、E2E / render テストが別区分であることを掴む。
 */
export type ProposalFailureKind = 'GATE_FAILED' | 'SUBMIT_FAILED' | 'LOST';

export const PROPOSAL_FAILURE_STATES = ['GATE_FAILED', 'SUBMIT_FAILED', 'LOST'] as const satisfies readonly ProposalFailureKind[];

/** 状態バッジの色味（画面が `BadgeVariant` に写す。語ではなく区分を渡す）。 */
export type ProposalStateTone = 'neutral' | 'progress' | 'success' | 'warning' | 'danger';

const STATE_TONES = {
  DRAFT: 'neutral',
  GATE_RUNNING: 'progress',
  GATE_FAILED: 'danger',
  APPROVAL_PENDING: 'warning',
  APPROVED: 'success',
  SUBMITTING: 'progress',
  SUBMITTED: 'success',
  SUBMIT_FAILED: 'danger',
  INTERVIEW_SCHEDULED: 'progress',
  INTERVIEWED: 'progress',
  RESULT_PENDING: 'warning',
  WON: 'success',
  LOST: 'neutral',
  WITHDRAWN: 'neutral',
} as const satisfies Record<ProposalState, ProposalStateTone>;

/** 状態バッジの色味（`S-019` / `S-023` が同じ表を見る）。 */
export function proposalStateTone(state: ProposalState): ProposalStateTone {
  return STATE_TONES[state];
}

/** 進行中として描く状態（点線枠 + 経過時間。`docs/04` §S-019）。 */
const IN_PROGRESS_STATES: ReadonlySet<ProposalState> = new Set<ProposalState>(['GATE_RUNNING', 'SUBMITTING']);

/**
 * 1 行分の表示値（すべて文言化済み。画面は組み立てをせず、そのまま描く）。
 * 🔴 `sendHold` / `owner` は取引先の行では常に `null`（入力の型に無い）。
 */
export type ProposalListRowView = {
  readonly id: string;
  /** `S-023` への導線。 */
  readonly href: string;
  readonly recipient: string;
  readonly engineer: string;
  readonly project: string;
  readonly projectId: string | null;
  readonly state: ProposalState;
  readonly stateLabel: string;
  readonly tone: ProposalStateTone;
  /** 🔴 3 区分のいずれか / それ以外は `null`。 */
  readonly failureKind: ProposalFailureKind | null;
  readonly unitPrice: string;
  readonly createdBy: string;
  /** 作成会社（ホストだけ。自社 = `proposals.list.owner.host`）。取引先の行は `null`。 */
  readonly owner: string | null;
  readonly updatedAt: string;
  readonly elapsed: string;
  readonly inProgress: boolean;
  /** `SUBMITTING` のまま `SUBMITTING_STUCK_MINUTES` を超えた。 */
  readonly stuckSubmitting: boolean;
  /** 🔴 保留（`APPROVED` + 理由）。`SUBMIT_FAILED` とは別の印。ホストだけ。 */
  readonly hold: { readonly label: string; readonly message: string } | null;
};

function none(): string {
  return t('proposals.list.valueNone');
}

export function proposalFailureKindOf(state: ProposalState): ProposalFailureKind | null {
  return (PROPOSAL_FAILURE_STATES as readonly ProposalState[]).includes(state) ? (state as ProposalFailureKind) : null;
}

function minutesSince(iso: string, now: Date): number {
  const from = new Date(iso).getTime();
  if (Number.isNaN(from)) return 0;
  return Math.max(0, Math.floor((now.getTime() - from) / 60_000));
}

function sharedRow(item: HostProposalListItem | PartnerProposalListItem, now: Date) {
  return {
    id: item.id,
    href: proposalDetailHref(item.id),
    recipient: item.recipient === null ? t('proposals.list.recipient.unset') : item.recipient.companyName,
    engineer: item.engineerDisplayName ?? t('proposals.list.engineer.unknown'),
    project: item.project === null ? t('proposals.list.project.notShared') : item.project.name,
    projectId: item.project === null ? null : item.project.id,
    state: item.state,
    stateLabel: proposalStateLabel(item.state),
    tone: STATE_TONES[item.state],
    failureKind: proposalFailureKindOf(item.state),
    unitPrice: item.offeredUnitPrice === null ? none() : formatThousands(item.offeredUnitPrice),
    createdBy: item.createdByName ?? t('proposals.list.createdBy.unknown'),
    updatedAt: formatDateTimeJst(item.updatedAt),
    elapsed: formatElapsed(item.updatedAt, now),
    inProgress: IN_PROGRESS_STATES.has(item.state),
    stuckSubmitting: item.state === 'SUBMITTING' && minutesSince(item.updatedAt, now) >= SUBMITTING_STUCK_MINUTES,
  };
}

/** ホスト視点の行。作成会社と保留の注記を持つ。 */
export function hostProposalListRows(items: readonly HostProposalListItem[], now: Date): readonly ProposalListRowView[] {
  return items.map((item) => {
    const hold = approvalSendHoldRows(item.sendHold);
    return {
      ...sharedRow(item, now),
      owner: item.owner.kind === 'HOST' ? t('proposals.list.owner.host') : item.owner.partnerCompanyName,
      hold: hold === null ? null : { label: t('proposals.list.hold.badge'), message: hold.message },
    };
  });
}

/** 取引先視点の行。🔴 作成会社・保留は型に無いので常に `null`。 */
export function partnerProposalListRows(items: readonly PartnerProposalListItem[], now: Date): readonly ProposalListRowView[] {
  return items.map((item) => ({ ...sharedRow(item, now), owner: null, hold: null }));
}

// ----------------------------------------------------------------------------
// 状態フィルタ（チップ）
// ----------------------------------------------------------------------------

/** `Proposal` の状態チップ 1 つ。🔴 14 状態が**それぞれ独立**に 1 つのチップになる（畳まない）。 */
export type ProposalStateChip = {
  readonly state: ProposalState;
  readonly label: string;
  readonly count: number;
  readonly checked: boolean;
  /** 指標区分（`GATE_FAILURE` / `DELIVERY_FAILURE` / `CONVERSION` / `IN_PROGRESS`）。`data-indicator` に載せる。 */
  readonly indicator: ProposalIndicator;
  readonly failureKind: ProposalFailureKind | null;
  readonly tone: ProposalStateTone;
};

/** 🔴 `docs/04` §S-019 / `CLAUDE.md` §4.2 の順（`PROPOSAL_STATES` の順 = 状態機械の順）。 */
export function proposalStateChips(byState: ProposalCountByState, selected: readonly ProposalState[] | undefined): readonly ProposalStateChip[] {
  const checked = new Set<ProposalState>(selected ?? []);
  return (Object.keys(byState) as ProposalState[]).map((state) => ({
    state,
    label: proposalStateLabel(state),
    count: byState[state],
    checked: checked.has(state),
    indicator: proposalIndicatorOf(state),
    failureKind: proposalFailureKindOf(state),
    tone: STATE_TONES[state],
  }));
}

/** 提案依頼の状態チップ（🔴 別ブロック。`S-017` への導線であり、`S-019` の表は絞り込まない）。 */
export type ProposalRequestStateChip = {
  readonly state: ProposalRequestState;
  readonly label: string;
  readonly count: number;
  readonly href: string;
};

/**
 * 🔴 提案依頼側の語は `proposals.list.requestState.*`（`DECLINED` = 「依頼を辞退」。`Proposal` の `WITHDRAWN` = 「辞退」と別の語）。
 *    `S-017` 自身の語（`proposalRequests.state.*`）とキーが違うのは、この画面で `Proposal` の 14 語と並ぶためである。
 */
const REQUEST_STATE_MESSAGE_KEYS = {
  REQUESTED: 'proposals.list.requestState.REQUESTED',
  ACCEPTED: 'proposals.list.requestState.ACCEPTED',
  DECLINED: 'proposals.list.requestState.DECLINED',
  WITHDRAWN_BY_HOST: 'proposals.list.requestState.WITHDRAWN_BY_HOST',
  EXPIRED: 'proposals.list.requestState.EXPIRED',
} as const satisfies Record<ProposalRequestState, MessageKey>;

export function proposalRequestStateChips(requestsByState: ProposalRequestCountByState): readonly ProposalRequestStateChip[] {
  return (Object.keys(requestsByState) as ProposalRequestState[]).map((state) => ({
    state,
    label: t(REQUEST_STATE_MESSAGE_KEYS[state]),
    count: requestsByState[state],
    href: `${PROPOSAL_REQUESTS_PATH}?${new URLSearchParams({ state }).toString()}`,
  }));
}

/** `S-017` 側の語との対応（同じ状態に別のキーを持つ理由は上記）。テストが「`S-017` と別の語になるのは `DECLINED` だけ」を固定する。 */
export function proposalRequestStateLabelInRequestsScreen(state: ProposalRequestState): string {
  return t(PROPOSAL_REQUEST_STATE_MESSAGE_KEYS[state]);
}

// ----------------------------------------------------------------------------
// ヘッダ / 導線
// ----------------------------------------------------------------------------

export type ProposalListSummaryView = {
  readonly lead: string;
  /** 「該当 N 件」（境界適用後の `total`）。 */
  readonly total: string;
  /** 🔴 `SUBMIT_FAILED` が 1 件以上あるときだけ `S-022` への導線（ホストだけ）。 */
  readonly sendFailuresHref: string | null;
  readonly sendFailuresLabel: string;
};

export function proposalListSummary(
  audience: 'HOST' | 'PARTNER',
  total: number,
  byState: ProposalCountByState,
): ProposalListSummaryView {
  return {
    lead: audience === 'HOST' ? t('proposals.list.lead.host') : t('proposals.list.lead.partner'),
    total: `${t('proposals.list.total.prefix')}${formatThousands(total)}${t('proposals.list.total.suffix')}`,
    sendFailuresHref: audience === 'HOST' && byState.SUBMIT_FAILED > 0 ? PROPOSAL_SEND_FAILURES_PATH : null,
    sendFailuresLabel: t('proposals.list.openSendFailures'),
  };
}

/** 絞り込みが掛かっているか（空状態の文言を「初回空」と「絞り込み 0 件」で分ける。`docs/04` §S-019）。 */
export function isProposalListFiltered(query: ProposalListQuery): boolean {
  return query.state !== undefined || query.projectId !== undefined || query.engineerId !== undefined || query.q !== undefined;
}
