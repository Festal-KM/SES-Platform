// apps/web/lib/home/action-queue-read.ts
// 🔴 `S-003` / `S-004` の要対応キュー（Phase 1 分）の**読み取り**（docs/05 §6.3 #9「T-12-15 の実装の決着」）。T-12-15。
//
// ============================================================================
// 🔴 母集団は RLS が決める。アプリの `if` で越境の判断を書かない
// ============================================================================
// `proposals` / `proposal_requests` は C5 PARTY（ホストは自テナントの全件、取引先は自社が作成 / 依頼先が自社の行だけ）。
// `where` に `tenantId` / `ownerPartnerCompanyId` / `partnerCompanyId` を書かない（`listProposals` / `listProposalRequests` と同じ）。
// 本ファイルが `where` に書くのは**業務上の絞り込み**（状態 / 保留理由 / 「自分の担当のみ」）だけである。
//
// 🔴 提案の行は `listProposals` と**同じ `select`（`PROPOSAL_LIST_SELECT`）と同じ写像（`projectProposalListItems`）**を通す。
//    ホーム固有の射影を作らない（`S-019` の行と同じ出所 = エンジニア名は凍結側 `engineer_snapshots.display_name`。`engineers` を読まない）。
// 🔴 提案依頼の行は `listProposalRequests` と同じ写像（`toHostProposalRequestView` / `toPartnerProposalRequestView`）を通す。
//    ホストの枝は `engineerId` を **`select` に書かない**（`ProposalRequestRow` の型がこの集合を固定する。`S-017` と同じ）。
//
// 🔴 所属で分かれるのは**工程**（取引先に承認・送信の工程を出さない）と**「担当」の定義**であり、境界ではない:
//    - ホスト … 提案 = `SUBMIT_FAILED` / `APPROVAL_PENDING` / `GATE_FAILED` / 保留中の `APPROVED`（2 理由）。依頼 = 自社が出した `REQUESTED`。
//    - 取引先 … 提案 = `GATE_FAILED` だけ。依頼 = 自社宛の `REQUESTED`。
//    - `scope=mine` … 提案は **`created_by` / 承認者（`approved_by`） / 自動承認（`approved_by_system`）のいずれかが自分**
//      （🔴 T-12-15 指摘 1: 取引先が作った提案をホストが人間承認すれば承認者の `mine` に載り、自動承認は担当が
//      存在しないので誰の `mine` にも載る —— `APPROVAL_PENDING` と同じ「担当不問」の扱い）。
//      🔴 `APPROVAL_PENDING` は担当を問わず載せる —— 誰かが承認すれば進むため
//      （docs/04 §S-003 権限差分「`SALES` は承認待ちに自分が承認者でないものも表示する」）。ホストの依頼は `issued_by = 自分`。
//      🔴 **取引先宛の依頼は `scope` で絞らない** —— 依頼を受けた側に「担当」の列は無く（応答するまで誰の担当でもない）、
//      絞ると期限つきの依頼が既定で見えなくなる（`EXPIRED` で商談機会が消える。`F-018`）。
//
// 🔴 監査ログを書かない（一覧の取得は `BR-27` の対象ではない。`S-017` / `S-019` と同じ線引き）。氏名は凍結側の表示名だけであり、
//    **ホストの枝では** `engineer.view` の対象（台帳の現在値）を読んでいない（取引先の枝は自社の台帳の `engineers.display_name` を
//    読む。自社の情報なので実名でよい。`S-017` と同じ）。
import { withTenant, type AuthenticatedTenantCtx } from '@ses/db';
import { readEngineerRefs, readProjectRefs } from '../proposal-requests/service';
import type { ProposalRequestRow } from '../proposal-requests/views';
import { toHostProposalRequestView, toPartnerProposalRequestView } from '../proposal-requests/views';
import { projectProposalListItems, PROPOSAL_LIST_SELECT, type TenantDb } from '../proposals/list';
import {
  ACTION_QUEUE_SEND_HOLD_REASONS,
  buildActionQueueBlock,
  sortActionQueueRows,
  toHostRequestActionRow,
  toPartnerRequestActionRow,
  toProposalActionRow,
  type ActionQueueAudience,
} from './action-queue';
import type { HomeScope } from './schemas';
import type { ActionQueueHomeBlock, ActionQueueRow } from './types';

/**
 * 🔴 1 回の読み取りで拾う行数の上限。docs/05 §6.1 の一覧上限（200）と同じ値。
 *    キューは「今日、自分が動かないと止まるもの」であり、これを超えて溜まった状態は一覧（`S-019` / `S-017`）で扱う。
 *    DB 側の並び（提案 = 放置が長い順 / 依頼 = 期限が近い順）で切るので、切れるのは**後回しにできる側**である。
 * 🔴 T-12-15 指摘 2: ホストの提案は**種別バケットごとに**この上限を適用する（`hostProposalWheres` の 3 バケット。
 *    合計上限は最大 3 × 200）。1 クエリに束ねると、優先度の高い `SUBMIT_FAILED` が溜まった `GATE_FAILED` に
 *    埋もれて切れる（DB 側の並びが `updated_at` 昇順 = 放置の長い行を残すため）。取引先の提案（`GATE_FAILED` だけ）
 *    と依頼は、種別が単一 / 1 クエリのままなので変わらず 200 件。
 */
export const ACTION_QUEUE_ROW_LIMIT = 200;

export type ActionQueueReadOptions = {
  readonly scope: HomeScope;
  /** 前回応答の `changedSince`。`null` なら全行を返す。 */
  readonly changedSince: Date | null;
};

/** 🔴 取引先がキューに載せる提案の状態（`GATE_FAILED` だけ。承認・送信はホストの工程）。 */
const PARTNER_PROPOSAL_STATES = ['GATE_FAILED'] as const;

/** 🔴 両方の view が読む列だけ（`listProposalRequests` の `PROPOSAL_REQUEST_ROW_SELECT` と同じ集合）。 */
const REQUEST_ROW_SELECT = {
  id: true,
  projectId: true,
  state: true,
  message: true,
  expiresAt: true,
  createdAt: true,
  respondedAt: true,
} as const;

/**
 * 業務上の絞り込みの形（Prisma の `WhereInput` から導出せず、使う形だけを構造的に書く。`list.ts` の `ProposalListWhere` と同じ判断）。
 * 🔴 T-12-15 指摘 1: `approvedBy` / `approvedBySystem` は `mine` の担当条件が読む（`schema.prisma` の `Proposal` の実カラム）。
 */
type ProposalQueueWhere = {
  OR?: ProposalQueueWhere[];
  AND?: ProposalQueueWhere[];
  state?: string | { in: string[] };
  sendHoldReasonKey?: { in: string[] };
  createdBy?: string;
  approvedBy?: string;
  approvedBySystem?: boolean;
};

/**
 * 🔴 T-12-15 指摘 1: `mine` の担当条件（ホスト）。`createdBy` / `approvedBy` のいずれかが自分、または
 *    `approvedBySystem`（自動承認 = 担当が存在しないので誰の `mine` にも載る。`APPROVAL_PENDING` と同じ
 *    「担当不問」の扱い）。`includeApprovalPendingException` はバケットに `APPROVAL_PENDING` を含む場合だけ true にし、
 *    その状態自体を担当条件の対象外にする（誰かが承認すれば進むため。docs/04 §S-003 権限差分）。
 */
function hostMineFilter(ctx: AuthenticatedTenantCtx, includeApprovalPendingException: boolean): ProposalQueueWhere {
  const or: ProposalQueueWhere[] = includeApprovalPendingException ? [{ state: { in: ['APPROVAL_PENDING'] } }] : [];
  or.push({ createdBy: ctx.userId }, { approvedBy: ctx.userId }, { approvedBySystem: true });
  return { OR: or };
}

/**
 * 🔴 T-12-15 指摘 2: ホストが読む提案の絞り込みを**種別バケットごとに 3 つ**返す（`ACTION_QUEUE_ROW_LIMIT` を
 *    バケット単位で効かせるため。呼び出し側がバケットごとに 1 クエリ実行する）。
 *    ① `SUBMIT_FAILED` 単独 ② `APPROVAL_PENDING` / `GATE_FAILED` ③ 保留中 `APPROVED`
 *    （`sendHoldReasonKey` が `ACTION_QUEUE_SEND_HOLD_REASONS` のいずれか）。
 */
function hostProposalWheres(ctx: AuthenticatedTenantCtx, scope: HomeScope): readonly ProposalQueueWhere[] {
  const buckets: readonly (readonly [ProposalQueueWhere, boolean])[] = [
    [{ state: 'SUBMIT_FAILED' }, false],
    [{ state: { in: ['APPROVAL_PENDING', 'GATE_FAILED'] } }, true],
    [{ state: 'APPROVED', sendHoldReasonKey: { in: [...ACTION_QUEUE_SEND_HOLD_REASONS] } }, false],
  ];
  if (scope === 'all') return buckets.map(([kind]) => kind);
  return buckets.map(([kind, hasApprovalPendingException]) => ({
    AND: [kind, hostMineFilter(ctx, hasApprovalPendingException)],
  }));
}

function partnerProposalWhere(ctx: AuthenticatedTenantCtx, scope: HomeScope): ProposalQueueWhere {
  const kinds: ProposalQueueWhere = { state: { in: [...PARTNER_PROPOSAL_STATES] } };
  return scope === 'all' ? kinds : { ...kinds, createdBy: ctx.userId };
}

/**
 * 要対応キューのブロックを読む（`GET /api/home` / `S-003` / `S-004` の共通経路）。1 トランザクション（`withTenant`）で
 * 提案 → 提案依頼 → 参照の解決を行い、並べて（`sortActionQueueRows`）差分を切る（`buildActionQueueBlock`）。
 */
export async function readActionQueueBlock(
  ctx: AuthenticatedTenantCtx,
  options: ActionQueueReadOptions,
): Promise<ActionQueueHomeBlock> {
  const audience: ActionQueueAudience = ctx.partnerCompanyId === null ? 'HOST' : 'PARTNER';
  return withTenant(ctx, async (db) => {
    // 🔴 放置が長い順（`updated_at` 昇順）。`id` は uuid(7) なので同時刻のタイブレークも時系列。
    const orderBy = [{ updatedAt: 'asc' as const }, { id: 'asc' as const }];
    // 🔴 T-12-15 指摘 2: ホストはバケットごとに 1 クエリ（`hostProposalWheres`。`ACTION_QUEUE_ROW_LIMIT` をバケット単位で効かせる）。
    const proposalRows =
      audience === 'HOST'
        ? (
            await Promise.all(
              hostProposalWheres(ctx, options.scope).map((where) =>
                db.proposal.findMany({ where, select: PROPOSAL_LIST_SELECT, orderBy, take: ACTION_QUEUE_ROW_LIMIT }),
              ),
            )
          ).flat()
        : await db.proposal.findMany({
            where: partnerProposalWhere(ctx, options.scope),
            select: PROPOSAL_LIST_SELECT,
            orderBy,
            take: ACTION_QUEUE_ROW_LIMIT,
          });
    const projected = await projectProposalListItems(ctx, db, proposalRows);
    const proposalActionRows = projected.items
      .map((item) => toProposalActionRow(item))
      .filter((row): row is ActionQueueRow => row !== null);

    const requestActionRows = await readRequestActionRows(ctx, db, audience, options.scope);
    const sorted = sortActionQueueRows([...proposalActionRows, ...requestActionRows], audience);
    return buildActionQueueBlock(sorted, options.changedSince);
  });
}

async function readRequestActionRows(
  ctx: AuthenticatedTenantCtx,
  db: Pick<TenantDb, 'proposalRequest' | 'project' | 'engineer'>,
  audience: ActionQueueAudience,
  scope: HomeScope,
): Promise<readonly ActionQueueRow[]> {
  // 🔴 期限が近い順（`expires_at` 昇順）。`REQUESTED` だけ（`DECLINED` / `EXPIRED` / `WITHDRAWN_BY_HOST` は載せない）。
  const orderBy = [{ expiresAt: 'asc' as const }, { id: 'asc' as const }];

  if (audience === 'HOST') {
    const rows: readonly ProposalRequestRow[] = await db.proposalRequest.findMany({
      where: { state: 'REQUESTED', ...(scope === 'mine' ? { issuedBy: ctx.userId } : {}) },
      select: REQUEST_ROW_SELECT,
      orderBy,
      take: ACTION_QUEUE_ROW_LIMIT,
    });
    // 🔴 T-12-15 指摘 5: `proposal-requests/service.ts` の `readProjectRefs` と同じ実装だったため、それを再利用する。
    const projects = await readProjectRefs(db, rows.map((row) => row.projectId));
    return rows
      .map((row) => toHostRequestActionRow(toHostProposalRequestView(row, projects.get(row.projectId) ?? null)))
      .filter((row): row is ActionQueueRow => row !== null);
  }

  // 🔴 取引先宛の依頼は `scope` で絞らない（ファイル冒頭）。`engineerId` は取引先の枝だけが読む（自社の台帳の実名を出すため）。
  const rows = await db.proposalRequest.findMany({
    where: { state: 'REQUESTED' },
    select: { ...REQUEST_ROW_SELECT, engineerId: true },
    orderBy,
    take: ACTION_QUEUE_ROW_LIMIT,
  });
  // 🔴 T-12-15 指摘 5: 同上（`readEngineerRefs`）。`engineers` は C3 OWNER_SCOPED なので、取引先には自社の台帳だけが見える
  //    （依頼先 = 自社なので必ず自社所有の行である）。
  const [projects, engineers] = await Promise.all([
    readProjectRefs(db, rows.map((row) => row.projectId)),
    readEngineerRefs(db, rows.map((row) => row.engineerId)),
  ]);
  return rows
    .map((row) =>
      toPartnerRequestActionRow(
        toPartnerProposalRequestView(row, projects.get(row.projectId) ?? null, engineers.get(row.engineerId) ?? null),
      ),
    )
    .filter((row): row is ActionQueueRow => row !== null);
}
