// apps/web/lib/home/action-queue.ts
// 🔴 `S-003` / `S-004` の要対応キュー（Phase 1 分）の**組み立て**（docs/04 §S-003 セクション 1 / §S-004 セクション 1・2 /
//    docs/05 §6.3 #9「T-12-15 の実装の決着」/ §10.4 / `F-006 AC-1`〜`AC-3` / `F-024 AC-2` / `BR-23` / `BR-60`）。T-12-15。
//
// ============================================================================
// 🔴 ここが守るもの
// ============================================================================
//   ① 🔴 **4 つの「うまくいかなかった」を混同しない。** キューに載る提案の状態は `SUBMIT_FAILED`（→ `SEND_FAILED`）/
//      `APPROVAL_PENDING` / `GATE_FAILED` と、保留中の `APPROVED`（→ `SEND_HELD`）だけ。`LOST` / `WITHDRAWN` は終端であり載せない。
//      提案依頼は `REQUESTED` だけ（`DECLINED` / `EXPIRED` / `WITHDRAWN_BY_HOST` を「返答待ち」の行に残さない）。
//   ② 🔴 **`SEND_HELD` は `SEND_FAILED` と別の種別・別の語・別の遷移先**（docs/05 §10.4「失敗率の指標に混入させない」）。
//      載せる保留理由は利用者の操作で解消する 2 つ（`DOMAIN_UNVERIFIED` → `S-036` / `GATE_STALE` → #39 の再実行）だけ。
//      🔴 **`PROVIDER_QUOTA` は載せない**（利用者に打つ手が無く自動復帰する。`F-059 AC-7` / `hrefs.ts` の `USAGE_SETTINGS_HREF` の注記）。
//      他の自動復帰する保留（`RATE_LIMIT` / `TENANT_SUSPENDED` / `ESIGN_DISCONNECTED` / `AI_COST_LIMIT`）も同じ理由で載せない
//      （判定は「`PROVIDER_QUOTA` 以外」ではなく**載せる 2 値の列挙**。値が増えたとき黙って載る側に倒れない）。
//   ③ 🔴 **並びは「放置時間 × 取り返しのつかなさ」**（docs/04 §S-003）。ホスト = `SEND_FAILED`（外部に到達したか不明）が最上位、
//      `APPROVAL_PENDING` / `GATE_FAILED` / `SEND_HELD` / `PROPOSAL_REQUEST_PENDING` の順。種別の中は放置が長い順（`since` 昇順）、
//      依頼だけは**期限（`expiresAt`）昇順**。取引先 = 依頼（時間切れが最も痛い。§S-004 セクション 1）→ `GATE_FAILED`（セクション 2）。
//   ④ 🔴 **種別ごとの件数を 1 つの合計に丸めない**（丸めると ① の混同の表示になる）。合計を返す関数を置かない。
//   ⑤ 🔴 **氏名の出所**: 提案の行の「対象」は `engineer_snapshots.display_name`（凍結側。`S-019` の行と同じ `HostProposalListItem` /
//      `PartnerProposalListItem` を入力に取る）。ホストの `PROPOSAL_REQUEST_PENDING` の行は経路 4 の段階であり、「対象」は案件名 +
//      「共有候補（匿名）」の一語（`S-017` と同じ）。**エンジニア名・`engineerId`・所属会社名を 1 つも載せない**（入力の型
//      `HostProposalRequestView` に無い）。
//   ⑥ 🔴 **境界の判断を書かない。** 母集団（どの行が読めるか）は RLS（C5）が決めており、本ファイルは読めた行を写して並べるだけである。
//      取引先に `APPROVAL_PENDING` / `SEND_FAILED` / `SEND_HELD` を出さないのは**工程の判断**（承認・送信はホストの工程）であり、
//      `action-queue-read.ts` が取引先の枝でそれらの状態を**読まない**ことで成立する。
//
// 🔴 I/O を持たない（`@ses/db` に依存しない）。文言は `packages/i18n` が唯一の出所（`CLAUDE.md` §3.5）。
import { t } from '@ses/i18n';
import type { SendHoldReasonKey } from '@ses/domain';
import type { HostProposalRequestView, PartnerProposalRequestView } from '../proposal-requests/views';
import { proposalRequestRespondHref, PROPOSAL_REQUESTS_PATH } from '../proposal-requests/list-rows';
import { proposalApproveHref, proposalEditHref, PROPOSAL_SEND_FAILURES_PATH, proposalsHref } from '../proposals/hrefs';
import type { HostProposalListItem, PartnerProposalListItem } from '../proposals/views';
import type { ActionQueueHomeBlock, ActionQueueKind, ActionQueueRow } from './types';

/** 種別の並び（ホスト。docs/04 §S-003「`送信失敗` を最上位、`承認待ち` を次に」+ SP-12 T-12-15 の種別表）。 */
export const HOST_ACTION_QUEUE_KIND_ORDER = [
  'SEND_FAILED',
  'APPROVAL_PENDING',
  'GATE_FAILED',
  'SEND_HELD',
  'PROPOSAL_REQUEST_PENDING',
] as const satisfies readonly ActionQueueKind[];

/**
 * 🔴 取引先に載る種別（docs/04 §S-004 セクション 1 = 自社宛の依頼 / セクション 2 = 自社提案のゲート差し戻し）。
 *    `APPROVAL_PENDING` / `SEND_FAILED` / `SEND_HELD` は**無い**（承認・送信はホストの工程。取引先は `S-019` の自社提案の状態で足りる）。
 */
export const PARTNER_ACTION_QUEUE_KIND_ORDER = [
  'PROPOSAL_REQUEST_PENDING',
  'GATE_FAILED',
] as const satisfies readonly ActionQueueKind[];

/**
 * 🔴 `SEND_HELD` として載せる保留理由（ファイル冒頭 ②）。**列挙**で持つ（`AUTO_RELEASABLE_SEND_HOLD_REASON_KEYS` と同じ向き）。
 *    `PROVIDER_QUOTA` を含まないことは `action-queue.test.ts` と結合テストの両方が固定する。
 */
export const ACTION_QUEUE_SEND_HOLD_REASONS = ['DOMAIN_UNVERIFIED', 'GATE_STALE'] as const satisfies readonly SendHoldReasonKey[];

export function isActionQueueSendHoldReason(key: SendHoldReasonKey): boolean {
  return (ACTION_QUEUE_SEND_HOLD_REASONS as readonly SendHoldReasonKey[]).includes(key);
}

export type ActionQueueAudience = 'HOST' | 'PARTNER';

function kindRank(audience: ActionQueueAudience): ReadonlyMap<ActionQueueKind, number> {
  const order: readonly ActionQueueKind[] =
    audience === 'HOST' ? HOST_ACTION_QUEUE_KIND_ORDER : PARTNER_ACTION_QUEUE_KIND_ORDER;
  return new Map(order.map((kind, index) => [kind, index]));
}

function subjectOf(projectName: string, candidate: string): string {
  return `${projectName}${t('home.actionQueue.subject.separator')}${candidate}`;
}

/**
 * 提案（`S-019` の行）→ キューの行。載らない状態（`DRAFT` / `SUBMITTED` / `LOST` / 保留していない `APPROVED` 等）は `null`。
 * 🔴 `SEND_HELD` の判定材料 `sendHold` は**ホストの行にしか無い**（`PartnerProposalListItem` は型として持たない）ので、
 *    取引先の行から `SEND_HELD` が生まれる経路は存在しない。
 */
export function toProposalActionRow(item: HostProposalListItem | PartnerProposalListItem): ActionQueueRow | null {
  const kind = proposalActionKindOf(item);
  if (kind === null) return null;
  return {
    kind,
    targetId: item.id,
    subjectLabel: subjectOf(
      item.project === null ? t('proposals.list.project.notShared') : item.project.name,
      item.engineerDisplayName ?? t('proposals.list.engineer.unknown'),
    ),
    counterpartyLabel: item.recipient === null ? null : item.recipient.companyName,
    since: item.updatedAt,
    deadline: null,
    rowVersion: Date.parse(item.updatedAt),
    href: proposalActionHref(kind, item.id),
  };
}

/** 提案から生まれる種別（`PROPOSAL_REQUEST_PENDING` は `proposal_requests` の行からしか生まれない）。 */
type ProposalActionKind = Exclude<ActionQueueKind, 'PROPOSAL_REQUEST_PENDING'>;

function proposalActionKindOf(item: HostProposalListItem | PartnerProposalListItem): ProposalActionKind | null {
  switch (item.state) {
    case 'SUBMIT_FAILED':
      return 'SEND_FAILED';
    case 'APPROVAL_PENDING':
      return 'APPROVAL_PENDING';
    case 'GATE_FAILED':
      return 'GATE_FAILED';
    case 'APPROVED':
      return item.audience === 'HOST' && item.sendHold !== null && isActionQueueSendHoldReason(item.sendHold.reasonKey)
        ? 'SEND_HELD'
        : null;
    default:
      return null;
  }
}

/** 種別ごとの遷移先（docs/04 §S-003 操作表）。`PROPOSAL_REQUEST_PENDING` は所属で違うので `requestActionHref` が持つ。 */
function proposalActionHref(kind: ProposalActionKind, proposalId: string): string {
  switch (kind) {
    case 'SEND_FAILED':
      return PROPOSAL_SEND_FAILURES_PATH;
    case 'APPROVAL_PENDING':
      return proposalApproveHref(proposalId);
    case 'GATE_FAILED':
      return proposalEditHref(proposalId);
    case 'SEND_HELD':
      // 🔴 `S-019`（`APPROVED` フィルタ + 保留の注記）。`S-022`（送信失敗）へは送らない —— 保留は失敗ではない。
      return proposalsHref({ state: ['APPROVED'] }, null);
  }
}

/**
 * 🔴 ホストが読む提案依頼（`HostProposalRequestView`）→ キューの行。`REQUESTED` 以外は `null`。
 *    「対象」は案件名 + 「共有候補（匿名）」の一語。入力の型に `engineerId` / 依頼先が無いので、行にも現れない。
 *    遷移先は `S-017`（一覧。ホストは `S-018` に到達しない）。
 */
export function toHostRequestActionRow(item: HostProposalRequestView): ActionQueueRow | null {
  if (item.state !== 'REQUESTED') return null;
  return {
    kind: 'PROPOSAL_REQUEST_PENDING',
    targetId: item.id,
    subjectLabel: subjectOf(
      item.project === null ? t('proposalRequests.project.notShared') : item.project.name,
      t('proposalRequests.candidate.anonymous'),
    ),
    // 🔴 依頼先の社名を出さない（開示は応諾で `Proposal` ができた時点。経路 2）。
    counterpartyLabel: null,
    since: item.createdAt,
    deadline: item.expiresAt,
    rowVersion: Date.parse(item.createdAt),
    href: PROPOSAL_REQUESTS_PATH,
  };
}

/**
 * 取引先が読む自社宛の提案依頼（`PartnerProposalRequestView`）→ キューの行。`REQUESTED` 以外は `null`。
 * 「対象」は案件名（自社に公開されていなければその旨）+ 自社の台帳の表示名（自社の情報なので実名でよい。`S-017` と同じ）。
 * 遷移先は `S-018`（応諾・辞退）。
 */
export function toPartnerRequestActionRow(item: PartnerProposalRequestView): ActionQueueRow | null {
  if (item.state !== 'REQUESTED') return null;
  return {
    kind: 'PROPOSAL_REQUEST_PENDING',
    targetId: item.id,
    subjectLabel: subjectOf(
      item.project === null ? t('proposalRequests.project.notShared') : item.project.name,
      item.engineer?.displayName ?? t('anonymousCandidate.valueNone'),
    ),
    counterpartyLabel: null,
    since: item.createdAt,
    deadline: item.expiresAt,
    rowVersion: Date.parse(item.createdAt),
    href: proposalRequestRespondHref(item.id),
  };
}

/**
 * 🔴 並び（ファイル冒頭 ③）。種別の順位 → 種別の中は「依頼 = 期限昇順 / それ以外 = `since` 昇順（放置が長い順）」→ `targetId`。
 *    決定的で説明可能な順序にする（同じ入力で並びが変わらない）。
 */
export function sortActionQueueRows(rows: readonly ActionQueueRow[], audience: ActionQueueAudience): readonly ActionQueueRow[] {
  const rank = kindRank(audience);
  return [...rows].sort((a, b) => {
    const byKind = (rank.get(a.kind) ?? Number.MAX_SAFE_INTEGER) - (rank.get(b.kind) ?? Number.MAX_SAFE_INTEGER);
    if (byKind !== 0) return byKind;
    const aKey = a.kind === 'PROPOSAL_REQUEST_PENDING' ? (a.deadline ?? a.since) : a.since;
    const bKey = b.kind === 'PROPOSAL_REQUEST_PENDING' ? (b.deadline ?? b.since) : b.since;
    const byTime = Date.parse(aKey) - Date.parse(bKey);
    if (byTime !== 0) return byTime;
    return a.targetId < b.targetId ? -1 : a.targetId > b.targetId ? 1 : 0;
  });
}

/**
 * 🔴 応答の `changedSince` に持たせる安全マージン（T-12-15 指摘 4）。`updated_at` は `@updatedAt` でコミット前に
 *    採番されるため、採番とコミットの間に読み取り時刻（`readAt`）を取った読み手は、次回差分
 *    （`rowVersion >= changedSince`）でその行を拾えない。窓はトランザクション時間分なので、応答の
 *    `changedSince` を `readAt` そのものではなく `readAt - margin` にして安全側に丸める
 *    （`>=` の重複は `targetId` 上書きで無害。`apps/web/lib/home/service.ts` の `getHomeView` が使う。docs/05 §6.3 #9）。
 */
export const CHANGED_SINCE_SAFETY_MARGIN_MS = 5_000;

/**
 * ブロックの組み立て。`changedSince` を渡すと `items` は `rowVersion >= changedSince` の行だけになる（`targetIds` は常に全件）。
 * 🔴 比較は `>=`（同一ミリ秒に更新された行の取りこぼしより、重複して返すことを選ぶ。行は `targetId` で上書きされる）。
 */
export function buildActionQueueBlock(
  sortedRows: readonly ActionQueueRow[],
  changedSince: Date | null,
): ActionQueueHomeBlock {
  const threshold = changedSince === null ? null : changedSince.getTime();
  return {
    kind: 'ACTION_QUEUE',
    targetIds: sortedRows.map((row) => row.targetId),
    items: threshold === null ? sortedRows : sortedRows.filter((row) => row.rowVersion >= threshold),
  };
}
