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

// ============================================================================
// 🔴 **状態バッジの色味（`tone`）はここに無い**（✅ SP-22 段④ で削除。2026-10-03）
// ============================================================================
// 旧実装は `ProposalStateTone`（`neutral` / `progress` / `success` / `warning` / `danger` の 5 値）と
// `STATE_TONES`（`ProposalState` → tone）を持ち、画面がそれを `BadgeVariant` に写していた。
// 🔴 **5 値では `docs/04` §5-1 の 14 状態の塗り / 枠線 / 点線枠を表現できない。** 現に次の 2 つが
//    起きていた（`S-019` / `S-023` / `S-024` / `S-006` の 4 画面で同じ写像が重複していた）:
//
//   - **`GATE_FAILED` が `danger`（赤）** —— §5-1 の 🔴「**赤（塗り）は `SUBMIT_FAILED` /
//     `SEND_FAILED` / `SUSPENDED` の 3 つだけ**」に反する。ゲート差し戻しは外部に何も起きておらず
//     「直せば進む」ものなので橙（`warning`）である（`CLAUDE.md` §4.2「失敗と保留を混同しない」/
//     `BR-23`）。**赤にすると品質管理を強めるほど画面が赤くなる**という逆の動機が生まれる。
//   - **`APPROVED` と `SUBMITTED` が同じ `success`** —— 「送る前」と「届いた後」が同じ見た目になる。
//
// 🔴 色と形状は `@ses/ui` の `StatusBadge`（`STATUS_BADGE_APPEARANCES`）が**状態名から**決め、
//    **画面は色を渡せない**（`docs/04` §5-13「1 箇所でしか色が決まらないことが §7.4 の意味の対応を
//    守る唯一の方法である」）。本ファイルが渡すのは `state`（名前）と `stateLabel`（語）だけである。
// 🔴 **`tone` に相当するものを再び足さない。** 機械検査は
//    `tests/static/proposal-state-color-single-path.test.ts`。

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
 *    `S-017` 自身の語（`proposalRequests.state.*`）とはキーが別だが、値は `@ses/i18n` の `OUTCOME_LABELS.DECLINED` を両方が参照する
 *    （T-10-01。画面ごとに別の語にならない）。キーを分けたままにするのは、この画面で `Proposal` の 14 語と並ぶ文脈を保つため。
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

/**
 * 🔴 **承認キューの既定表示件数**（`docs/04` §7.1 情報密度の表: 一覧は既定 50 行だが
 *    「**承認キュー（`S-019` の承認待ちフィルタ）は 25 行**」）。
 *    根拠は同表の「承認キューは 1 行あたりの情報量が多いため減らす」である。
 */
export const PROPOSAL_APPROVAL_QUEUE_PAGE_SIZE = 25;

/**
 * 🔴 **この一覧が「承認キュー」かどうか**（`docs/04` §7.1 / §S-019）。
 *
 * 🔴 **状態フィルタが `APPROVAL_PENDING` だけのときに限る。** `GATE_FAILED` や `SUBMIT_FAILED` を
 *    併せて選んだ一覧は「うまくいかなかったものを見る一覧」であり、承認キューではない
 *    （`CLAUDE.md` §4.2「失敗と保留を混同しない」を密度の側でも守る）。
 */
export function isProposalApprovalQueue(state: readonly ProposalState[] | undefined): boolean {
  return state !== undefined && state.length === 1 && state[0] === 'APPROVAL_PENDING';
}

/**
 * 🔴 **一覧の表示件数**（`docs/04` §7.1）。承認キューは 25 行、それ以外は既定（50 行）。
 *
 * 🔴 **URL で `?limit=` が明示されていたらそれを優先する** —— 明示した値を画面が黙って
 *    書き換えると、「返ってきた件数が要求と違う」ことの理由が利用者にもログにも残らない
 *    （`lib/api/pagination.ts` の 🔴「黙って丸めない」と同じ規律）。
 * 🔴 **API を変えていない。** `limit` は `proposalListQuerySchema` が元から持つ値であり、
 *    ここは**既定値の選び方**（= 表示密度）だけを決める。
 */
export function proposalListPageSize(params: {
  readonly state: readonly ProposalState[] | undefined;
  /** URL に `?limit=` が書かれていたか（スキーマの既定値と区別するため、生の searchParams で見る）。 */
  readonly limitSpecified: boolean;
  /** スキーマが確定させた値（既定 50 / 明示されていればその値）。 */
  readonly parsedLimit: number;
}): number {
  if (params.limitSpecified) return params.parsedLimit;
  return isProposalApprovalQueue(params.state) ? PROPOSAL_APPROVAL_QUEUE_PAGE_SIZE : params.parsedLimit;
}
