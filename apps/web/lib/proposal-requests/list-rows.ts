// apps/web/lib/proposal-requests/list-rows.ts
// `S-017` 提案依頼の一覧の表示値の組み立て（docs/04 §S-017）。T-08-06。
//
// 🔴 画面（`app/(main)/proposal-requests/**`）ではなくここに置く理由は `lib/candidates/list-rows.ts` と同じ:
//    `app/**` はユニットテストの対象外であり、「ホストの行に依頼先の社名・`engineer_id`・辞退理由が
//    **型として無い**こと」「状態バッジが 5 値で別々であること」「URL の組み立て」を固定できる場所が要る。
//    **I/O を持たない。**
// 🔴 文言は `packages/i18n` が唯一の出所（`CLAUDE.md` §3.5）。本ファイルは日本語の語を書かない。
// 🔴 ホストと取引先で**同じ行の型**（`ProposalRequestRowView`）に畳む —— 画面は 1 つで、違うのは
//    候補列の値（ホスト = 「共有候補（匿名）」の一語 / 取引先 = 自社の実名）と取り下げの可否だけである。
//    畳んでも `declineReason` が現れないのは、入力の型（`views.ts`）に無いからである。
import { t, type MessageKey } from '@ses/i18n';
import type { ProposalRequestState } from '@ses/domain';
import { formatDateTimeJst } from '../format/datetime';
import type { RemainingLabels } from './remaining';
import type { ProposalRequestListQuery } from './schemas';
import type { HostProposalRequestView, PartnerProposalRequestView } from './views';

/** `S-017` の入口。 */
export const PROPOSAL_REQUESTS_PATH = '/proposal-requests';

/**
 * 状態 → 文言キー（`Record` にして割り当て漏れをコンパイラに強制させる。`labels.ts` の規律）。
 * 🔴 `DECLINED` / `EXPIRED` / `WITHDRAWN_BY_HOST` は**別の語**（`F-018 AC-5` / `BR-60`。「失効」に畳まない）。
 */
export const PROPOSAL_REQUEST_STATE_MESSAGE_KEYS = {
  REQUESTED: 'proposalRequests.state.REQUESTED',
  ACCEPTED: 'proposalRequests.state.ACCEPTED',
  DECLINED: 'proposalRequests.state.DECLINED',
  WITHDRAWN_BY_HOST: 'proposalRequests.state.WITHDRAWN_BY_HOST',
  EXPIRED: 'proposalRequests.state.EXPIRED',
} as const satisfies Record<ProposalRequestState, MessageKey>;

/**
 * 残り時間の文言（画面が `formatRemaining` に渡す）。
 * 🔴 残り時間そのものはここで計算しない —— 画面がサーバ時刻で初回を描き、以後は端末時刻で毎分再計算する
 *    （同じ 1 関数 `formatRemaining`。ここでも計算すると 2 経路になる）。
 */
export function remainingLabels(): RemainingLabels {
  return {
    prefix: t('proposalRequests.remaining.prefix'),
    days: t('proposalRequests.remaining.days'),
    hours: t('proposalRequests.remaining.hours'),
    minutes: t('proposalRequests.remaining.minutes'),
    lessThanMinute: t('proposalRequests.remaining.lessThanMinute'),
    expired: t('proposalRequests.remaining.expired'),
  };
}

/**
 * 1 行分の表示値（すべて文言化済み。画面は組み立てをせず、そのまま描く）。
 * 🔴 `partnerCompanyName` / `engineerId` / `declineReason` / `respondedBy` のフィールドが**存在しない**。
 */
export type ProposalRequestRowView = {
  readonly id: string;
  /** 案件詳細（`S-011`）への導線。案件名を出せないときは `null`。 */
  readonly projectId: string | null;
  readonly projectName: string;
  /** ホスト = 「共有候補（匿名）」の一語。取引先 = 自社の台帳の表示名。 */
  readonly candidate: string;
  readonly state: ProposalRequestState;
  readonly stateLabel: string;
  readonly createdAt: string;
  /** ISO 8601。残り時間（`formatRemaining`）の入力。 */
  readonly expiresAtIso: string;
  readonly expiresAt: string;
  /** 最終更新（`respondedAt ?? createdAt`）。 */
  readonly updatedAt: string;
  readonly message: string;
  /** 🔴 取り下げ導線を描くか（ホスト × `REQUESTED`）。テナント状態・ロールの判定は画面側の `denialMessage` / `canAct`。 */
  readonly canWithdraw: boolean;
  /**
   * 🔴 T-08-07: `S-018`（応諾・辞退）への導線。**取引先の行だけ**が持ち、ホストの行は `null`
   *    （ホストは `S-018` に到達しない。`docs/04` §S-018 権限差分）。
   */
  readonly respondHref: string | null;
};

/** `S-018` の URL（`/proposal-requests/{id}`）。組み立てはここ 1 箇所。 */
export function proposalRequestRespondHref(id: string): string {
  return `${PROPOSAL_REQUESTS_PATH}/${id}`;
}

function stateLabel(state: ProposalRequestState): string {
  return t(PROPOSAL_REQUEST_STATE_MESSAGE_KEYS[state]);
}

/** ホスト視点の行。🔴 候補列は「共有候補（匿名）」の一語（`docs/04` §S-017）。 */
export function hostProposalRequestRows(
  items: readonly HostProposalRequestView[],
): readonly ProposalRequestRowView[] {
  return items.map((item) => ({
    id: item.id,
    projectId: item.project?.id ?? null,
    projectName: item.project?.name ?? t('proposalRequests.project.notShared'),
    candidate: t('proposalRequests.candidate.anonymous'),
    state: item.state,
    stateLabel: stateLabel(item.state),
    createdAt: formatDateTimeJst(item.createdAt),
    expiresAtIso: item.expiresAt,
    expiresAt: formatDateTimeJst(item.expiresAt),
    updatedAt: formatDateTimeJst(item.respondedAt ?? item.createdAt),
    message: item.message,
    canWithdraw: item.state === 'REQUESTED',
    respondHref: null,
  }));
}

/** 取引先視点の行。候補列は自社の台帳の表示名（自社の情報なので実名でよい。`docs/04` §S-017）。 */
export function partnerProposalRequestRows(
  items: readonly PartnerProposalRequestView[],
): readonly ProposalRequestRowView[] {
  return items.map((item) => ({
    id: item.id,
    projectId: item.project?.id ?? null,
    // 🔴 自社に公開されていない案件は名前を出せない（`projects` の C4）。依頼の存在自体は隠さない。
    projectName: item.project?.name ?? t('proposalRequests.project.notShared'),
    candidate: item.engineer?.displayName ?? t('anonymousCandidate.valueNone'),
    state: item.state,
    stateLabel: stateLabel(item.state),
    createdAt: formatDateTimeJst(item.createdAt),
    expiresAtIso: item.expiresAt,
    expiresAt: formatDateTimeJst(item.expiresAt),
    updatedAt: formatDateTimeJst(item.respondedAt ?? item.createdAt),
    message: item.message,
    // 🔴 取り下げはホストの操作（`F-018` 関連ロール）。取引先の行には導線が無い。
    canWithdraw: false,
    // 🔴 取引先の行は `S-018` へ進める（状態を問わず開ける。応諾・辞退の可否は `S-018` 側が状態で決める）。
    respondHref: proposalRequestRespondHref(item.id),
  }));
}

/** 状態フィルタの選択肢（`S-017` セクション 1。先頭は「すべて」）。 */
export function proposalRequestStateOptions(): readonly { readonly value: string; readonly label: string }[] {
  return [
    { value: '', label: t('proposalRequests.filter.all') },
    ...(Object.keys(PROPOSAL_REQUEST_STATE_MESSAGE_KEYS) as ProposalRequestState[]).map((state) => ({
      value: state,
      label: stateLabel(state),
    })),
  ];
}

/** `S-017` の URL（状態フィルタとカーソル）。🔴 `limit` は URL に載せない（既定値のまま）。 */
export function proposalRequestsHref(
  query: Pick<ProposalRequestListQuery, 'state'>,
  cursor: string | null,
): string {
  const params = new URLSearchParams();
  if (query.state !== undefined) params.set('state', query.state);
  if (cursor !== null) params.set('cursor', cursor);
  const search = params.toString();
  return search === '' ? PROPOSAL_REQUESTS_PATH : `${PROPOSAL_REQUESTS_PATH}?${search}`;
}
