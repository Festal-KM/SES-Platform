// packages/db/src/platform/queries/gate-stalls.ts
// 🔴 `A-005` 運用監視の項目 12「`GATE_RUNNING` の滞留」の材料
//    （docs/02 `F-059 AC-6` / `F-027 AC-5` / docs/05 §7.6 / §9.10 / §16.5 / `CLAUDE.md` §4.2「失敗と保留を混同しない」）。T-11-05。
//
// 画面（`A-005`）の実装は T-11-04 であり、本ファイルは**読み取り関数と純粋な区別の関数だけ**を置く。
//
// ============================================================================
// 🔴 滞留の理由は 3 区分であり、保留は障害ではない
// ============================================================================
//   - `AI_COST_LIMIT_HELD` … `review_gates(execution='HELD_AI_COST_LIMIT')` の行がある。AI の日次コスト上限で
//     **呼べなかった**保留（`F-027 AC-5`）。復帰は `gate.hold-release` の自動 / #39 の手動。**障害ではない**
//   - `JOB_FAILED` … BullMQ の `gate.run` キューの **failed** に同じ対象のジョブがある（`attempts: 1` で失敗した。
//     `loadGateInput` 系の例外 / DB・Redis の一時障害）。復帰は**利用者の #39 だけ**（docs/05 §9.10。Issue #16）
//   - `RUNNING_OVERDUE` … `GATE_RUNNING` のまま、確定行も保留行も失敗記録も無く、閾値（`GATE_STALL_ALERT_MINUTES`）を
//     超えた。応答不明 = ワーカー停止・Redis 喪失の疑い
//
// 🔴 **`JOB_FAILED` の検知元は BullMQ の failed セット 1 つに決めた**（`review_gates` に「失敗」の行は存在しない ——
//    `execution` は `DONE` / `HELD_AI_COST_LIMIT` の 2 値で、失敗したジョブは行を 1 本も書かない。`SchedulerRun` は
//    スケジュール実行の記録であり `gate.run` の実行単位ではない）。§16.5 項目 3「失敗ジョブ数」と**同じ出所**なので、
//    項目 3 と項目 12 の `JOB_FAILED` が食い違わない。
// 🔴 `packages/db` は Redis / BullMQ に依存しない（`CLAUDE.md` §2.1。`packages/db` と `packages/connectors` は
//    相互に依存しない）。failed セットは呼び出し側（`apps/web` の管理平面ルート）が `packages/connectors` の読み取り
//    専用の照会で取り、**ジョブの payload（`{ tenantId, targetType, targetId }`）と失敗時刻**だけを引数で渡す。
//    現在時刻・閾値も引数で受ける（関数内で `new Date()` / `process.env` を読まない。他の材料と同じ規律）。
//
// 🔴 返すのはテナント ID・対象の種別と ID・理由・時刻・分数だけである（`BR-40`）。`proposals` から読む列は
//    `id` / `tenant_id` / `updated_at`、`review_gates` から読む列は `tenant_id` / `target_type` / `target_id` /
//    `held_since` に限る（`select` で明示。`tests/static/admin-no-content-reach.test.ts` がこのファイルの `select` を
//    許可リストで固定する）。件名・本文・提案先・エンジニア・`findings`（指摘内容）には**フィールドとして到達しない**。
//    加えて `app_platform` にはそれらの列の GRANT が無い（docs/05 §5.5 第 1 層）。`admin.monitoring.view` として
//    `AuditLog` に残る。
//
// 🔴 **運営者の操作は「検知してテナント利用者に再依頼を促す」まで。** BullMQ の retry / `Job.remove()` /
//    `proposals` / `review_gates` への書き込みに相当する経路は管理平面に存在しない
//    （`tests/static/admin-no-gate-retry.test.ts` が固定。`app_platform*` に UPDATE の GRANT も無い）。
import { isGateTargetType, type GateTargetType } from '@ses/domain';
import type { AuthenticatedPlatformCtx } from '../../platform-context.js';
import { withPlatformRead } from '../../platform.js';

/**
 * 滞留の理由（3 区分）。🔴 `AI_COST_LIMIT_HELD` は保留であり、失敗ジョブ数・ゲート FAIL 率・未対応 `SUBMIT_FAILED` の
 * いずれにも加算しない（`F-059 AC-6`）。`JOB_FAILED` / `RUNNING_OVERDUE` が障害である。
 */
export const GATE_STALL_REASONS = ['AI_COST_LIMIT_HELD', 'JOB_FAILED', 'RUNNING_OVERDUE'] as const;

export type GateStallReason = (typeof GATE_STALL_REASONS)[number];

export type GateStallRow = {
  readonly tenantId: string;
  readonly targetType: GateTargetType;
  /** 対象の ID（`proposals.id` / `projects.id` …）。🔴 管理平面に ID から内容を引く API は無い（`admin-no-content-reach`）。 */
  readonly targetId: string;
  readonly reason: GateStallReason;
  /**
   * その理由で止まり始めた時刻。
   * - `AI_COST_LIMIT_HELD` … `review_gates.held_since`（最初に保留した時刻。再保留で更新されない。`holdReviewGate`）
   * - `JOB_FAILED` … ジョブの失敗時刻（BullMQ の `finishedOn`。呼び出し側が渡す）
   * - `RUNNING_OVERDUE` … `proposals.updated_at`（`GATE_RUNNING` に入った時刻。#39 の再実行では動かない）
   */
  readonly since: Date;
  /** `now - since` を分単位で切り捨てた値（0 以上）。 */
  readonly stalledMinutes: number;
};

export type GateStalls = {
  /** 滞留中の対象（`since` の昇順 = 最も長く止まっているものが先頭。同値は `tenantId` / `targetType` / `targetId` 昇順）。 */
  readonly rows: readonly GateStallRow[];
  /** 理由ごとの件数（`rows` の上限に切られる前の全件）。🔴 保留と失敗は**別キー**である。 */
  readonly countsByReason: Readonly<Record<GateStallReason, number>>;
  /** 母集団の全件数（`rows.length` は `ROWS_LIMIT` で切られうる）。 */
  readonly total: number;
  /** `RUNNING_OVERDUE` の判定に使った閾値（分）。画面が「N 分超過」と添えるための写し。 */
  readonly stallThresholdMinutes: number;
};

/**
 * BullMQ の `gate.run` キューの failed セットにあるジョブ 1 件（呼び出し側が `packages/connectors` の読み取りで取る）。
 * 🔴 `targetType` は `GateRunJob.targetType` をそのまま渡す（未知の値は enqueue 側が弾いている。ここで見つかったら
 *    Redis の中身が壊れているので黙って捨てず落とす）。
 */
export type FailedGateRunJob = {
  readonly tenantId: string;
  readonly targetType: string;
  readonly targetId: string;
  /** 失敗が確定した時刻（BullMQ `Job.finishedOn`。無ければ `Job.timestamp` = enqueue 時刻）。 */
  readonly failedAt: Date;
};

export type GateStallsMeta = {
  readonly ipAddress?: string | null;
  /** 🔴 現在時刻は引数で受ける（滞留分数を決定的に検証できるようにする。関数内で `new Date()` を呼ばない）。 */
  readonly now: Date;
  /** `GATE_STALL_ALERT_MINUTES`（`packages/config`。正の整数。既定 30）。 */
  readonly stallThresholdMinutes: number;
  /** `gate.run` の failed セット（読み取り専用の照会の結果）。空配列 = 失敗記録が無い。 */
  readonly failedJobs: readonly FailedGateRunJob[];
};

/** `proposals(state='GATE_RUNNING')` の 1 行分（読む列はこの 3 つだけ）。 */
export type GateRunningProposal = {
  readonly tenantId: string;
  readonly id: string;
  readonly updatedAt: Date;
};

/** `review_gates(execution='HELD_AI_COST_LIMIT')` の 1 行分（読む列はこの 4 つだけ。`findings` は読まない）。 */
export type HeldReviewGateRow = {
  readonly tenantId: string;
  readonly targetType: string;
  readonly targetId: string;
  readonly heldSince: Date;
};

export type GateStallCandidates = {
  readonly gateRunningProposals: readonly GateRunningProposal[];
  readonly heldGates: readonly HeldReviewGateRow[];
  readonly failedJobs: readonly FailedGateRunJob[];
};

type GateTarget = {
  readonly tenantId: string;
  readonly targetType: GateTargetType;
  readonly targetId: string;
};

const MILLISECONDS_PER_MINUTE = 60_000;

/** 1 回の読み取りで返す上限（`listUnverifiedSendingDomains` と同じ。`A-005` は「上位を出す」画面）。 */
const ROWS_LIMIT = 500;

const PROPOSAL: GateTargetType = 'PROPOSAL';

function wholeMinutesBetween(from: Date, now: Date): number {
  return Math.max(0, Math.floor((now.getTime() - from.getTime()) / MILLISECONDS_PER_MINUTE));
}

function targetKey(tenantId: string, targetType: string, targetId: string): string {
  return `${tenantId}/${targetType}/${targetId}`;
}

function requireGateTargetType(value: string, source: string): GateTargetType {
  if (!isGateTargetType(value)) {
    // 🔴 `review_gates.target_type` は CHECK、BullMQ の payload は enqueue 側の型が保証している。来たら不変条件違反。
    throw new Error(`${source} の targetType に未知の値があります（${value}）。GATE_TARGET_TYPES との突合を確認してください。`);
  }
  return value;
}

function compareRows(a: GateStallRow, b: GateStallRow): number {
  if (a.since.getTime() !== b.since.getTime()) return a.since.getTime() - b.since.getTime();
  if (a.tenantId !== b.tenantId) return a.tenantId < b.tenantId ? -1 : 1;
  if (a.targetType !== b.targetType) return a.targetType < b.targetType ? -1 : 1;
  return a.targetId < b.targetId ? -1 : a.targetId > b.targetId ? 1 : 0;
}

/**
 * 🔴 候補 → 3 区分（純粋関数。I/O なし）。
 *
 * 優先順位（同じ対象に複数の事実があるとき）:
 *   1. **failed セットにある → `JOB_FAILED`**。保留行が残っていても失敗が優先する —— `gate.hold-release` が積み直した
 *      実行が失敗すると「保留行 + 同 `jobId` の failed 記録」の形になり、同 ID の `add` は静かに捨てられるため
 *      自動復帰は起きない（`apps/web/lib/proposals/gate.ts` ②）。それは保留ではなく、利用者の #39 でしか解けない障害である
 *   2. **保留行がある → `AI_COST_LIMIT_HELD`**（閾値を掛けない。保留は事実であり、上限の解除まで動かない）
 *   3. **どちらも無く閾値を超えた → `RUNNING_OVERDUE`**。閾値未満は載せない（実行中の正常な待ちを障害に見せない）
 *
 * 母集団:
 *   - `PROPOSAL` … `proposals(state='GATE_RUNNING')` を起点にする。提案は `GATE_RUNNING` を離れるとき必ず保留行を CAS で
 *     確定させ（`completeReviewGate`）、#39 は failed 記録を消してから積む（§9.10 ②）ので、`GATE_RUNNING` でない提案に
 *     残った保留行・失敗記録は**削除・パージの残骸**である。載せない（対象が無いものを「滞留」と呼ばない）
 *   - `PROPOSAL` 以外（`PROJECT_PUBLISH` など） … 状態機械を持たず、対象の表（`project_publish_requests`）は `app_platform` に
 *     GRANT されていない。保留行と失敗記録を**そのまま**載せる（対象の生存を確認できないため。docs/05 §16.5 項目 12）。
 *     `RUNNING_OVERDUE` は判定できない（起点となる「実行中」の行が無い）
 */
export function classifyGateStalls(
  input: GateStallCandidates,
  options: { readonly now: Date; readonly stallThresholdMinutes: number },
): GateStalls {
  if (!Number.isInteger(options.stallThresholdMinutes) || options.stallThresholdMinutes <= 0) {
    throw new RangeError(
      `stallThresholdMinutes は正の整数である必要があります（受け取った値: ${options.stallThresholdMinutes}）。`,
    );
  }
  const thresholdMs = options.stallThresholdMinutes * MILLISECONDS_PER_MINUTE;

  // 同じ対象に複数の失敗記録（内容のハッシュ違い）があれば、最も新しい失敗時刻を採る。
  const failedByKey = new Map<string, GateTarget & { readonly failedAt: Date }>();
  for (const job of input.failedJobs) {
    const targetType = requireGateTargetType(job.targetType, 'failedJobs');
    const key = targetKey(job.tenantId, targetType, job.targetId);
    const existing = failedByKey.get(key);
    if (existing === undefined || job.failedAt.getTime() > existing.failedAt.getTime()) {
      failedByKey.set(key, { tenantId: job.tenantId, targetType, targetId: job.targetId, failedAt: job.failedAt });
    }
  }
  // 保留行は対象ごとに 1 行（部分 UNIQUE）。念のため古い方を採る（`held_since` は最初の保留時刻）。
  const heldByKey = new Map<string, GateTarget & { readonly heldSince: Date }>();
  for (const gate of input.heldGates) {
    const targetType = requireGateTargetType(gate.targetType, 'heldGates');
    const key = targetKey(gate.tenantId, targetType, gate.targetId);
    const existing = heldByKey.get(key);
    if (existing === undefined || gate.heldSince.getTime() < existing.heldSince.getTime()) {
      heldByKey.set(key, { tenantId: gate.tenantId, targetType, targetId: gate.targetId, heldSince: gate.heldSince });
    }
  }

  const consumed = new Set<string>();
  const rows: GateStallRow[] = [];
  const push = (row: Omit<GateStallRow, 'stalledMinutes'>): void => {
    rows.push({ ...row, stalledMinutes: wholeMinutesBetween(row.since, options.now) });
  };

  for (const proposal of input.gateRunningProposals) {
    const key = targetKey(proposal.tenantId, PROPOSAL, proposal.id);
    consumed.add(key);
    const base = { tenantId: proposal.tenantId, targetType: PROPOSAL, targetId: proposal.id } as const;
    const failed = failedByKey.get(key);
    if (failed !== undefined) {
      push({ ...base, reason: 'JOB_FAILED', since: failed.failedAt });
      continue;
    }
    const held = heldByKey.get(key);
    if (held !== undefined) {
      push({ ...base, reason: 'AI_COST_LIMIT_HELD', since: held.heldSince });
      continue;
    }
    if (options.now.getTime() - proposal.updatedAt.getTime() >= thresholdMs) {
      push({ ...base, reason: 'RUNNING_OVERDUE', since: proposal.updatedAt });
    }
  }

  for (const [key, held] of heldByKey) {
    if (consumed.has(key) || held.targetType === PROPOSAL) continue;
    consumed.add(key);
    const base = { tenantId: held.tenantId, targetType: held.targetType, targetId: held.targetId } as const;
    const failed = failedByKey.get(key);
    if (failed !== undefined) {
      push({ ...base, reason: 'JOB_FAILED', since: failed.failedAt });
    } else {
      push({ ...base, reason: 'AI_COST_LIMIT_HELD', since: held.heldSince });
    }
  }

  for (const [key, failed] of failedByKey) {
    if (consumed.has(key) || failed.targetType === PROPOSAL) continue;
    consumed.add(key);
    push({
      tenantId: failed.tenantId,
      targetType: failed.targetType,
      targetId: failed.targetId,
      reason: 'JOB_FAILED',
      since: failed.failedAt,
    });
  }

  rows.sort(compareRows);
  const countsByReason: Record<GateStallReason, number> = {
    AI_COST_LIMIT_HELD: 0,
    JOB_FAILED: 0,
    RUNNING_OVERDUE: 0,
  };
  for (const row of rows) countsByReason[row.reason] += 1;
  return {
    rows: rows.slice(0, ROWS_LIMIT),
    countsByReason,
    total: rows.length,
    stallThresholdMinutes: options.stallThresholdMinutes,
  };
}

/**
 * 🔴 `GATE_RUNNING` の滞留をテナント横断で読み、理由を 3 区分して返す（`targetTenantId: null`）。`F-059 AC-6`。
 *
 * 読む行は `proposals(state='GATE_RUNNING')` と `review_gates(execution='HELD_AI_COST_LIMIT')` の 2 種で、列は
 * 状態・時刻・ID に限る（上記 🔴）。failed セットは `meta.failedJobs` で受け取る。
 */
export async function listGateStalls(ctx: AuthenticatedPlatformCtx, meta: GateStallsMeta): Promise<GateStalls> {
  // 🔴 `withPlatformRead` の前に検査する（不正な閾値で監査行だけ残る状態にしない。`readProviderMonthlySpend` と同じ）。
  if (!Number.isInteger(meta.stallThresholdMinutes) || meta.stallThresholdMinutes <= 0) {
    throw new RangeError(
      `stallThresholdMinutes は正の整数である必要があります（受け取った値: ${meta.stallThresholdMinutes}）。`,
    );
  }
  return withPlatformRead(
    { ctx, action: 'admin.monitoring.view', targetTenantId: null, ipAddress: meta.ipAddress ?? null },
    async (db) => {
      // 🔴 `select` は状態・時刻・ID だけ。件名・本文・提案先・単価・`findings` を読まない（`BR-40`）。
      const gateRunningProposals: readonly GateRunningProposal[] = await db.proposal.findMany({
        where: { state: 'GATE_RUNNING' },
        orderBy: [{ updatedAt: 'asc' }, { id: 'asc' }],
        select: { tenantId: true, id: true, updatedAt: true },
      });
      const heldRows = await db.reviewGate.findMany({
        where: { execution: 'HELD_AI_COST_LIMIT' },
        orderBy: [{ heldSince: 'asc' }, { id: 'asc' }],
        select: { tenantId: true, targetType: true, targetId: true, heldSince: true },
      });
      const heldGates: HeldReviewGateRow[] = [];
      for (const row of heldRows) {
        // 🔴 CHECK（docs/05 §3.6）により HELD の行は `held_since` が非 NULL。`null` なら不変条件が壊れているので落とす。
        if (row.heldSince === null) {
          throw new Error(
            `review_gates(${row.targetType}:${row.targetId}) が execution='HELD_AI_COST_LIMIT' なのに held_since が NULL です（docs/05 §3.6 の CHECK が壊れています）。`,
          );
        }
        heldGates.push({
          tenantId: row.tenantId,
          targetType: row.targetType,
          targetId: row.targetId,
          heldSince: row.heldSince,
        });
      }
      return classifyGateStalls(
        { gateRunningProposals, heldGates, failedJobs: meta.failedJobs },
        { now: meta.now, stallThresholdMinutes: meta.stallThresholdMinutes },
      );
    },
  );
}
