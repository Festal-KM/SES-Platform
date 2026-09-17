// packages/db/src/platform/queries/monitoring.ts
// 🔴 `A-005` 運用監視（API-A8 `GET /api/admin/monitoring`）の材料のうち、**本タスク（T-11-04）で新設した集計**
//    （docs/02 `F-059 AC-1`〜`AC-4` / `AC-7` / docs/04 §A-005 / docs/05 §6.9 API-A8 / §9.9 / §16.5 /
//     `CLAUDE.md` §4.2「失敗と保留を混同しない」/ §10.5）。
//
// ============================================================================
// 🔴 項目ごとに独立した読み取りである（1 項目の失敗が他を巻き込まない）
// ============================================================================
// 1 つの `withPlatformRead`（= 1 トランザクション）に複数の項目を載せると、Postgres は 1 つのクエリの失敗で
// トランザクション全体を中断するため、他の項目も取れなくなる。**項目ごとに `withPlatformRead` を 1 回**にし、
// 呼び出し側（API-A8）が項目単位で `{ ok: false }` に落とす。監査行（`admin.monitoring.view`）も項目ごとに 1 行
// 増える —— `summary.item` に項目名を載せ、どの材料を読んだかを区別できるようにする。
//
// ============================================================================
// 🔴 読むのは件数・状態・時刻だけである（`BR-40`）
// ============================================================================
// 内容を持つ表（`proposals` / `contracts` / `review_gates` / `skill_sheets`）には **`groupBy` / `count` / `aggregate`
// だけ**で触れる（`tests/static/admin-no-content-reach.test.ts` ①。行を読む `find*` は `gate-stalls.ts` 1 本の例外）。
// `tenants` / `email_dispatches` / `tenant_purge_runs` / `scheduler_runs` は状態と時刻の列だけを `select` する。
// 加えて `app_platform` には件名・本文・宛先・単価の列 GRANT が無い（docs/05 §5.5 第 1 層）。
//
// 🔴 `packages/db` は `process.env` / `new Date()` を読まない。閾値と現在時刻は引数で受ける（他の材料と同じ規律）。
// 🔴 保留（`send_hold_reason_key` / `HELD_*`）は**どの障害指標にも足さない**（`F-059 AC-7`）。項目 1 は `state='SUBMIT_FAILED'`
//    だけ、項目 5 は `execution='DONE'` だけを数える。
import {
  isSendHoldReasonKey,
  QUARANTINED_SCAN_STATUSES,
  SEND_HOLD_REASON_KEYS,
  TENANT_CLOSING_NOTICE_TEMPLATE_KEY,
  type QuarantinedScanStatus,
  type SendHoldReasonKey,
} from '@ses/domain';
import type { AuthenticatedPlatformCtx } from '../../platform-context.js';
import { withPlatformRead, type PlatformOp } from '../../platform.js';
import type { EmailDispatchStatus, TenantPurgeCause } from '../../schema-value-sets.js';
import { uuidV7TimeOf } from '../../uuid.js';

const MILLISECONDS_PER_MINUTE = 60_000;
const MILLISECONDS_PER_HOUR = 3_600_000;
const MILLISECONDS_PER_DAY = 86_400_000;

/** 1 回の読み取りで返す行の上限（`listGateStalls` と同じ）。 */
const ROWS_LIMIT = 500;

/**
 * 🔴 削除予告のテンプレート（docs/05 §9.7 `tenant.closing-notify`）。✅ T-10-12: 単一出所は `@ses/domain`
 *    （`retention/closing-notice.ts`。起票する側と同じ値）。ここは `@ses/db/platform` の公開面を保つための re-export。
 */
export { TENANT_CLOSING_NOTICE_TEMPLATE_KEY };

export type MonitoringRequestMeta = {
  readonly ipAddress?: string | null;
  /** 🔴 現在時刻は引数で受ける（滞留分数・日数を決定的に検証できるようにする）。 */
  readonly now: Date;
};

function assertPositiveInt(name: string, value: number): void {
  if (!Number.isInteger(value) || value <= 0) {
    throw new RangeError(`${name} は正の整数である必要があります（受け取った値: ${value}）。`);
  }
}

function wholeMinutesBetween(from: Date, now: Date): number {
  return Math.max(0, Math.floor((now.getTime() - from.getTime()) / MILLISECONDS_PER_MINUTE));
}

function wholeDaysBetween(from: Date, now: Date): number {
  return Math.max(0, Math.floor((now.getTime() - from.getTime()) / MILLISECONDS_PER_DAY));
}

function compareByOldest<T extends { readonly oldestSince: Date | null; readonly tenantId: string }>(a: T, b: T): number {
  const ta = a.oldestSince?.getTime() ?? Number.MAX_SAFE_INTEGER;
  const tb = b.oldestSince?.getTime() ?? Number.MAX_SAFE_INTEGER;
  if (ta !== tb) return ta - tb;
  return a.tenantId < b.tenantId ? -1 : a.tenantId > b.tenantId ? 1 : 0;
}

/** `withPlatformRead` の共通部分（横断・`admin.monitoring.view`・項目名）。 */
function monitoringOp(ctx: AuthenticatedPlatformCtx, item: string, ipAddress: string | null | undefined): PlatformOp {
  return {
    ctx,
    action: 'admin.monitoring.view',
    targetTenantId: null,
    ipAddress: ipAddress ?? null,
    summary: { item },
  };
}

// ---------------------------------------------------------------------------
// 項目 1: 未対応の SUBMIT_FAILED（F-059 AC-2 / BR-23）
// ---------------------------------------------------------------------------

export type TenantCountRow = {
  readonly tenantId: string;
  readonly count: number;
  /** その状態に入った最も古い時刻（`updated_at` の MIN）。 */
  readonly oldestSince: Date | null;
};

export type UnattendedSubmitFailures = {
  readonly rows: readonly TenantCountRow[];
  readonly total: number;
};

/**
 * 🔴 `proposals.state='SUBMIT_FAILED'` **だけ**をテナント別に数える。`LOST` / `GATE_FAILED` / `DECLINED`（提案依頼）を
 *    混ぜない（`F-059 AC-2`）。`SUBMIT_FAILED` からの復帰は人間の再送だけなので、残っている行はすべて「未対応」である。
 */
export async function readUnattendedSubmitFailures(
  ctx: AuthenticatedPlatformCtx,
  meta: MonitoringRequestMeta,
): Promise<UnattendedSubmitFailures> {
  return withPlatformRead(monitoringOp(ctx, 'SUBMIT_FAILED_UNATTENDED', meta.ipAddress), async (db) => {
    const groups = await db.proposal.groupBy({
      by: ['tenantId'],
      where: { state: 'SUBMIT_FAILED' },
      _count: { _all: true },
      _min: { updatedAt: true },
    });
    const rows: TenantCountRow[] = groups
      .map((group) => ({ tenantId: group.tenantId, count: group._count._all, oldestSince: group._min.updatedAt }))
      .sort(compareByOldest);
    return { rows: rows.slice(0, ROWS_LIMIT), total: rows.reduce((sum, row) => sum + row.count, 0) };
  });
}

// ---------------------------------------------------------------------------
// 項目 2: SUBMITTING の滞留（F-059 AC-1）
// ---------------------------------------------------------------------------

export type SubmittingStallRow = TenantCountRow & {
  /** 最も長く止まっているものの分数（`now - oldestSince`）。 */
  readonly longestStalledMinutes: number;
};

export type SubmittingStalls = {
  readonly rows: readonly SubmittingStallRow[];
  readonly total: number;
  readonly stallThresholdMinutes: number;
};

/**
 * 🔴 `SUBMITTING` は片道であり（`CLAUDE.md` §4.2）、閾値（`SUBMITTING_STALL_ALERT_MINUTES`）を超えて確定していない
 *    提案は必ず検知対象になる（`F-059 AC-1`）。起点は `updated_at`（CAS で `SUBMITTING` に入った時刻）。
 */
export async function readSubmittingStalls(
  ctx: AuthenticatedPlatformCtx,
  meta: MonitoringRequestMeta & { readonly stallThresholdMinutes: number },
): Promise<SubmittingStalls> {
  assertPositiveInt('stallThresholdMinutes', meta.stallThresholdMinutes);
  const cutoff = new Date(meta.now.getTime() - meta.stallThresholdMinutes * MILLISECONDS_PER_MINUTE);
  return withPlatformRead(monitoringOp(ctx, 'SUBMITTING_STALL', meta.ipAddress), async (db) => {
    const groups = await db.proposal.groupBy({
      by: ['tenantId'],
      where: { state: 'SUBMITTING', updatedAt: { lte: cutoff } },
      _count: { _all: true },
      _min: { updatedAt: true },
    });
    const rows: SubmittingStallRow[] = groups
      .map((group) => ({
        tenantId: group.tenantId,
        count: group._count._all,
        oldestSince: group._min.updatedAt,
        longestStalledMinutes: group._min.updatedAt === null ? 0 : wholeMinutesBetween(group._min.updatedAt, meta.now),
      }))
      .sort(compareByOldest);
    return {
      rows: rows.slice(0, ROWS_LIMIT),
      total: rows.reduce((sum, row) => sum + row.count, 0),
      stallThresholdMinutes: meta.stallThresholdMinutes,
    };
  });
}

// ---------------------------------------------------------------------------
// 項目 4: ウイルススキャン失敗 / SCANNING 滞留（docs/05 §16.5）
// ---------------------------------------------------------------------------

export type ScanFailureRow = {
  readonly tenantId: string;
  /** 隔離状態ごとの件数（`INFECTED` / `UNSCANNABLE` / `FAILED`。`@ses/domain` の `QUARANTINED_SCAN_STATUSES`）。 */
  readonly countsByStatus: Readonly<Record<QuarantinedScanStatus, number>>;
  readonly count: number;
  /** 最も古い確定時刻（`scan_updated_at` の MIN）。 */
  readonly oldestSince: Date | null;
};

export type ScanFailures = {
  readonly rows: readonly ScanFailureRow[];
  readonly total: number;
  /** `SCANNING` のまま閾値（`SCAN_STALL_ALERT_MINUTES`）を超えた版。`scan.poll` が拾う前提だが、拾えていなければここに出る。 */
  readonly scanningStalled: { readonly count: number; readonly oldestUploadedAt: Date | null };
  readonly scanStallThresholdMinutes: number;
};

/**
 * 🔴 `skill_sheets.scan_status` の隔離状態（`isQuarantinedScanStatus` から導いた集合。`CLEAN` / `SCANNING` を含まない）を
 *    テナント × 状態で数える。削除済み（`purged_at`）の版は対処のしようがないので数えない。
 *    `file_scan_results` は「受け取った結果」の記録であり、対処の単位は版（`skill_sheets`）である。
 */
export async function readScanFailures(
  ctx: AuthenticatedPlatformCtx,
  meta: MonitoringRequestMeta & { readonly scanStallThresholdMinutes: number },
): Promise<ScanFailures> {
  assertPositiveInt('scanStallThresholdMinutes', meta.scanStallThresholdMinutes);
  const stallCutoff = new Date(meta.now.getTime() - meta.scanStallThresholdMinutes * MILLISECONDS_PER_MINUTE);
  return withPlatformRead(monitoringOp(ctx, 'SCAN_FAILED', meta.ipAddress), async (db) => {
    const groups = await db.skillSheet.groupBy({
      by: ['tenantId', 'scanStatus'],
      where: { scanStatus: { in: [...QUARANTINED_SCAN_STATUSES] }, purgedAt: null },
      _count: { _all: true },
      _min: { scanUpdatedAt: true },
    });
    const byTenant = new Map<string, { counts: Record<QuarantinedScanStatus, number>; oldest: Date | null }>();
    for (const group of groups) {
      const status = group.scanStatus as QuarantinedScanStatus;
      const entry = byTenant.get(group.tenantId) ?? {
        counts: Object.fromEntries(QUARANTINED_SCAN_STATUSES.map((s) => [s, 0])) as Record<QuarantinedScanStatus, number>,
        oldest: null,
      };
      entry.counts[status] += group._count._all;
      const oldest = group._min.scanUpdatedAt;
      if (oldest !== null && (entry.oldest === null || oldest.getTime() < entry.oldest.getTime())) entry.oldest = oldest;
      byTenant.set(group.tenantId, entry);
    }
    const rows: ScanFailureRow[] = [...byTenant.entries()]
      .map(([tenantId, entry]) => ({
        tenantId,
        countsByStatus: entry.counts,
        count: Object.values(entry.counts).reduce((sum, n) => sum + n, 0),
        oldestSince: entry.oldest,
      }))
      .sort(compareByOldest);
    const stalled = await db.skillSheet.aggregate({
      where: { scanStatus: 'SCANNING', purgedAt: null, uploadedAt: { lte: stallCutoff } },
      _count: { _all: true },
      _min: { uploadedAt: true },
    });
    return {
      rows: rows.slice(0, ROWS_LIMIT),
      total: rows.reduce((sum, row) => sum + row.count, 0),
      scanningStalled: { count: stalled._count._all, oldestUploadedAt: stalled._min.uploadedAt },
      scanStallThresholdMinutes: meta.scanStallThresholdMinutes,
    };
  });
}

// ---------------------------------------------------------------------------
// 項目 5: ゲート FAIL 率（docs/05 §16.5。分母・分子とも execution='DONE' のみ）
// ---------------------------------------------------------------------------

export type GateFailRateWindow = {
  /** 確定した実行（`execution='DONE'`）の件数。🔴 `HELD_AI_COST_LIMIT` は数えない。 */
  readonly done: number;
  /** そのうち 3 層のどれかが `FAIL` の件数。 */
  readonly failed: number;
  /** `failed / done`。`done = 0` なら `null`（率が定義できない。0 と区別する）。 */
  readonly rate: number | null;
};

export type GateFailRateRow = {
  readonly tenantId: string;
  readonly recent: GateFailRateWindow;
  readonly baseline: GateFailRateWindow;
};

export type GateFailRates = {
  readonly rows: readonly GateFailRateRow[];
  readonly recent: GateFailRateWindow;
  readonly baseline: GateFailRateWindow;
  readonly windowHours: number;
  readonly baselineDays: number;
};

export type GateFailRateGroup = {
  readonly tenantId: string;
  readonly done: number;
  readonly failed: number;
};

function rateOf(done: number, failed: number): GateFailRateWindow {
  return { done, failed, rate: done === 0 ? null : failed / done };
}

/**
 * 🔴 集計行 → 率（純粋関数）。`recent`（直近の窓）と `baseline`（その前の基準期間）を同じテナント集合で並べる。
 *    「前週比」（docs/04 §A-005 項目 5）の判断は率の差であり、ここでは数だけを揃える（閾値の判定は画面側）。
 */
export function summarizeGateFailRates(input: {
  readonly recent: readonly GateFailRateGroup[];
  readonly baseline: readonly GateFailRateGroup[];
  readonly windowHours: number;
  readonly baselineDays: number;
}): GateFailRates {
  const tenants = new Map<string, { recent: GateFailRateGroup | undefined; baseline: GateFailRateGroup | undefined }>();
  for (const group of input.recent) tenants.set(group.tenantId, { recent: group, baseline: undefined });
  for (const group of input.baseline) {
    const entry = tenants.get(group.tenantId);
    tenants.set(group.tenantId, { recent: entry?.recent, baseline: group });
  }
  const rows: GateFailRateRow[] = [...tenants.entries()]
    .map(([tenantId, entry]) => ({
      tenantId,
      recent: rateOf(entry.recent?.done ?? 0, entry.recent?.failed ?? 0),
      baseline: rateOf(entry.baseline?.done ?? 0, entry.baseline?.failed ?? 0),
    }))
    // 率の高いものが先頭（同率は件数の多い順 → テナント ID）。
    .sort((a, b) => {
      const ra = a.recent.rate ?? -1;
      const rb = b.recent.rate ?? -1;
      if (ra !== rb) return rb - ra;
      if (a.recent.done !== b.recent.done) return b.recent.done - a.recent.done;
      return a.tenantId < b.tenantId ? -1 : a.tenantId > b.tenantId ? 1 : 0;
    });
  const sum = (groups: readonly GateFailRateGroup[]): GateFailRateWindow =>
    rateOf(
      groups.reduce((total, group) => total + group.done, 0),
      groups.reduce((total, group) => total + group.failed, 0),
    );
  return {
    rows: rows.slice(0, ROWS_LIMIT),
    recent: sum(input.recent),
    baseline: sum(input.baseline),
    windowHours: input.windowHours,
    baselineDays: input.baselineDays,
  };
}

/**
 * 🔴 直近 `windowHours` 時間と、その前 `baselineDays` 日の `review_gates(execution='DONE')` をテナント別に数え、
 *    3 層のどれかが `FAIL` の割合を返す。**`HELD_AI_COST_LIMIT` は分母にも分子にも入れない**（`F-059 AC-6` / docs/05 §16.5）。
 */
export async function readGateFailRates(
  ctx: AuthenticatedPlatformCtx,
  meta: MonitoringRequestMeta & { readonly windowHours: number; readonly baselineDays: number },
): Promise<GateFailRates> {
  assertPositiveInt('windowHours', meta.windowHours);
  assertPositiveInt('baselineDays', meta.baselineDays);
  const recentFrom = new Date(meta.now.getTime() - meta.windowHours * MILLISECONDS_PER_HOUR);
  const baselineFrom = new Date(recentFrom.getTime() - meta.baselineDays * MILLISECONDS_PER_DAY);
  return withPlatformRead(monitoringOp(ctx, 'GATE_FAIL_RATE', meta.ipAddress), async (db) => {
    const countWindow = async (from: Date, to: Date): Promise<GateFailRateGroup[]> => {
      const base = { execution: 'DONE', executedAt: { gte: from, lt: to } } as const;
      const done = await db.reviewGate.groupBy({ by: ['tenantId'], where: base, _count: { _all: true } });
      const failed = await db.reviewGate.groupBy({
        by: ['tenantId'],
        where: {
          ...base,
          OR: [{ piiVerdict: 'FAIL' }, { commerceVerdict: 'FAIL' }, { consistencyVerdict: 'FAIL' }],
        },
        _count: { _all: true },
      });
      const failedByTenant = new Map(failed.map((group) => [group.tenantId, group._count._all]));
      return done.map((group) => ({
        tenantId: group.tenantId,
        done: group._count._all,
        failed: failedByTenant.get(group.tenantId) ?? 0,
      }));
    };
    const [recent, baseline] = await Promise.all([
      countWindow(recentFrom, meta.now),
      countWindow(baselineFrom, recentFrom),
    ]);
    return summarizeGateFailRates({ recent, baseline, windowHours: meta.windowHours, baselineDays: meta.baselineDays });
  });
}

// ---------------------------------------------------------------------------
// 項目 7: 削除ジョブの失敗（F-064 / docs/04 申し送り 15。完了の事実は返さない）
// ---------------------------------------------------------------------------

export type PurgeJobFailureRow = {
  readonly tenantId: string;
  readonly cause: TenantPurgeCause;
  readonly failedCount: number;
  readonly lastFailedAt: Date | null;
};

export type PurgeJobFailures = {
  readonly rows: readonly PurgeJobFailureRow[];
  readonly total: number;
};

export type PurgeRunGroup = {
  readonly tenantId: string;
  readonly cause: string;
  readonly count: number;
  readonly latestAt: Date | null;
};

/**
 * 🔴 失敗 → その後に同じ（テナント × 原因）で完了した実行があれば「対応済み」として落とす（純粋関数）。
 *    返すのは失敗の事実だけで、完了の事実は返さない（`docs/04` 申し送り 15 = API-A12 だけが完了を返す）。
 */
export function summarizePurgeJobFailures(input: {
  readonly failed: readonly PurgeRunGroup[];
  readonly completed: readonly PurgeRunGroup[];
}): PurgeJobFailures {
  const completedAt = new Map(input.completed.map((group) => [`${group.tenantId}/${group.cause}`, group.latestAt]));
  const rows: PurgeJobFailureRow[] = [];
  for (const group of input.failed) {
    const resolvedAt = completedAt.get(`${group.tenantId}/${group.cause}`) ?? null;
    if (resolvedAt !== null && group.latestAt !== null && resolvedAt.getTime() >= group.latestAt.getTime()) continue;
    rows.push({
      tenantId: group.tenantId,
      cause: group.cause as TenantPurgeCause,
      failedCount: group.count,
      lastFailedAt: group.latestAt,
    });
  }
  rows.sort((a, b) => {
    const ta = a.lastFailedAt?.getTime() ?? 0;
    const tb = b.lastFailedAt?.getTime() ?? 0;
    if (ta !== tb) return ta - tb;
    return a.tenantId < b.tenantId ? -1 : a.tenantId > b.tenantId ? 1 : 0;
  });
  return { rows: rows.slice(0, ROWS_LIMIT), total: rows.reduce((sum, row) => sum + row.failedCount, 0) };
}

export async function readPurgeJobFailures(
  ctx: AuthenticatedPlatformCtx,
  meta: MonitoringRequestMeta,
): Promise<PurgeJobFailures> {
  return withPlatformRead(monitoringOp(ctx, 'PURGE_JOB_FAILED', meta.ipAddress), async (db) => {
    const failed = await db.tenantPurgeRun.groupBy({
      by: ['tenantId', 'cause'],
      where: { status: 'FAILED' },
      _count: { _all: true },
      _max: { startedAt: true },
    });
    const completed = await db.tenantPurgeRun.groupBy({
      by: ['tenantId', 'cause'],
      where: { status: 'COMPLETED' },
      _max: { completedAt: true },
    });
    return summarizePurgeJobFailures({
      failed: failed.map((group) => ({
        tenantId: group.tenantId,
        cause: group.cause,
        count: group._count._all,
        latestAt: group._max.startedAt,
      })),
      completed: completed.map((group) => ({
        tenantId: group.tenantId,
        cause: group.cause,
        count: 0,
        latestAt: group._max.completedAt,
      })),
    });
  });
}

// ---------------------------------------------------------------------------
// 項目 13（DB 側）: HELD_PROVIDER_QUOTA の件数と最古（F-059 AC-7。§8.3-Q）
// ---------------------------------------------------------------------------

export type MailProviderHeld = {
  /** `email_dispatches(status='HELD_PROVIDER_QUOTA')` の件数。🔴 失敗ではない（送信を 1 回も試みていない）。 */
  readonly heldCount: number;
  /** 最初に保留した時刻（`held_at` の MIN）= 枠に到達した時刻。 */
  readonly oldestHeldAt: Date | null;
};

export async function readMailProviderHeld(
  ctx: AuthenticatedPlatformCtx,
  meta: MonitoringRequestMeta,
): Promise<MailProviderHeld> {
  return withPlatformRead(monitoringOp(ctx, 'MAIL_PROVIDER_QUOTA', meta.ipAddress), async (db) => {
    const held = await db.emailDispatch.aggregate({
      where: { status: 'HELD_PROVIDER_QUOTA' },
      _count: { _all: true },
      _min: { heldAt: true },
    });
    return { heldCount: held._count._all, oldestHeldAt: held._min.heldAt };
  });
}

// ---------------------------------------------------------------------------
// 項目 14: 送信保留（理由別内訳。docs/05 §10.4 の 7 値。F-059 AC-7）
// ---------------------------------------------------------------------------

export type SendHoldTenantRow = {
  readonly tenantId: string;
  readonly proposals: number;
  readonly contracts: number;
  readonly oldestSince: Date | null;
};

export type SendHoldByReason =
  | { readonly scope: 'TENANT'; readonly rows: readonly SendHoldTenantRow[] }
  | {
      readonly scope: 'ENVIRONMENT';
      readonly proposals: number;
      readonly contracts: number;
      readonly oldestSince: Date | null;
    };

export type SendHolds = {
  readonly byReason: Readonly<Record<SendHoldReasonKey, SendHoldByReason>>;
  readonly total: number;
};

export type SendHoldGroup = {
  readonly reasonKey: string;
  readonly tenantId: string;
  readonly count: number;
  readonly oldestSince: Date | null;
};

/** 🔴 `PROVIDER_QUOTA` だけが環境全体の 1 行に畳まれ、他の 6 値はテナント行を持つ（純粋関数）。 */
export function summarizeSendHolds(input: {
  readonly proposals: readonly SendHoldGroup[];
  readonly contracts: readonly SendHoldGroup[];
}): SendHolds {
  type Acc = { proposals: number; contracts: number; oldestSince: Date | null };
  const perReason = new Map<SendHoldReasonKey, Map<string, Acc>>();
  const add = (group: SendHoldGroup, field: 'proposals' | 'contracts'): void => {
    if (!isSendHoldReasonKey(group.reasonKey)) {
      // 🔴 CHECK（docs/05 §10.4 の 7 値）が保証している。来たら `SEND_HOLD_REASON_KEYS` と CHECK がずれているので落とす。
      throw new Error(`send_hold_reason_key に未知の値があります（${group.reasonKey}）。SEND_HOLD_REASON_KEYS と CHECK 制約の突合を確認してください。`);
    }
    const tenants = perReason.get(group.reasonKey) ?? new Map<string, Acc>();
    const acc = tenants.get(group.tenantId) ?? { proposals: 0, contracts: 0, oldestSince: null };
    acc[field] += group.count;
    if (group.oldestSince !== null && (acc.oldestSince === null || group.oldestSince.getTime() < acc.oldestSince.getTime())) {
      acc.oldestSince = group.oldestSince;
    }
    tenants.set(group.tenantId, acc);
    perReason.set(group.reasonKey, tenants);
  };
  for (const group of input.proposals) add(group, 'proposals');
  for (const group of input.contracts) add(group, 'contracts');

  const byReason = {} as Record<SendHoldReasonKey, SendHoldByReason>;
  let total = 0;
  for (const reason of SEND_HOLD_REASON_KEYS) {
    const tenants = perReason.get(reason) ?? new Map<string, Acc>();
    if (reason === 'PROVIDER_QUOTA') {
      // 🔴 環境全体の制約。`tenantId` を落として 1 行に畳む（環境枠で止まったテナントに `S-038` を案内しない）。
      let proposals = 0;
      let contracts = 0;
      let oldestSince: Date | null = null;
      for (const acc of tenants.values()) {
        proposals += acc.proposals;
        contracts += acc.contracts;
        if (acc.oldestSince !== null && (oldestSince === null || acc.oldestSince.getTime() < oldestSince.getTime())) {
          oldestSince = acc.oldestSince;
        }
      }
      total += proposals + contracts;
      byReason[reason] = { scope: 'ENVIRONMENT', proposals, contracts, oldestSince };
      continue;
    }
    const rows: SendHoldTenantRow[] = [...tenants.entries()]
      .map(([tenantId, acc]) => ({ tenantId, proposals: acc.proposals, contracts: acc.contracts, oldestSince: acc.oldestSince }))
      .sort(compareByOldest);
    total += rows.reduce((sum, row) => sum + row.proposals + row.contracts, 0);
    byReason[reason] = { scope: 'TENANT', rows: rows.slice(0, ROWS_LIMIT) };
  }
  return { byReason, total };
}

/**
 * 🔴 `proposals` / `contracts` の `send_hold_reason_key IS NOT NULL` を **`GROUP BY send_hold_reason_key, tenant_id`**
 *    で数える（docs/05 §16.5「送信保留（理由別内訳）」）。保留は失敗ではなく、項目 1 / 3 / 5 に足さない。
 */
export async function readSendHolds(ctx: AuthenticatedPlatformCtx, meta: MonitoringRequestMeta): Promise<SendHolds> {
  return withPlatformRead(monitoringOp(ctx, 'SEND_HOLD', meta.ipAddress), async (db) => {
    const proposals = await db.proposal.groupBy({
      by: ['sendHoldReasonKey', 'tenantId'],
      where: { sendHoldReasonKey: { not: null } },
      _count: { _all: true },
      _min: { sendHoldSince: true },
    });
    const contracts = await db.contract.groupBy({
      by: ['sendHoldReasonKey', 'tenantId'],
      where: { sendHoldReasonKey: { not: null } },
      _count: { _all: true },
      _min: { sendHoldSince: true },
    });
    const toGroup = (group: {
      readonly sendHoldReasonKey: string | null;
      readonly tenantId: string;
      readonly _count: { readonly _all: number };
      readonly _min: { readonly sendHoldSince: Date | null };
    }): SendHoldGroup => ({
      reasonKey: group.sendHoldReasonKey ?? '',
      tenantId: group.tenantId,
      count: group._count._all,
      oldestSince: group._min.sendHoldSince,
    });
    return summarizeSendHolds({ proposals: proposals.map(toGroup), contracts: contracts.map(toGroup) });
  });
}

// ---------------------------------------------------------------------------
// 項目 15: 削除予告の未配送（F-064 AC-10。項目 7 と別行）
// ---------------------------------------------------------------------------

export type PurgeNoticeCause = 'NOTICE_PENDING' | 'NOTICE_UNDELIVERED';

export type PurgeNoticePendingRow = {
  readonly tenantId: string;
  readonly cause: PurgeNoticeCause;
  /** 削除予定日（`closing_entered_at + graceDays`）を過ぎた日数。 */
  readonly overdueDays: number;
};

export type PurgeNoticePending = {
  readonly rows: readonly PurgeNoticePendingRow[];
  readonly total: number;
  readonly graceDays: number;
};

/**
 * 🔴 予告行の状態の集合 → 原因（純粋関数。docs/05 §16.5 項目 15）。
 *   - `SENT` / `MOCKED` が 1 件でもあれば配送済み（載せない）→ `null`
 *   - `QUEUED` / `HELD_*` があるか、行が 1 件も無い → `NOTICE_PENDING`（まだ届いていないだけ。異常ではない）
 *   - それ以外（`FAILED` / `SUPPRESSED` だけ）→ `NOTICE_UNDELIVERED`（バウンス等。翌日の再起票を待つ）
 */
export function classifyPurgeNotice(statuses: readonly string[]): PurgeNoticeCause | null {
  const set = new Set(statuses as readonly EmailDispatchStatus[]);
  if (set.has('SENT') || set.has('MOCKED')) return null;
  if (set.size === 0 || set.has('QUEUED') || set.has('HELD_PROVIDER_QUOTA') || set.has('HELD_DOMAIN_UNVERIFIED')) {
    return 'NOTICE_PENDING';
  }
  return 'NOTICE_UNDELIVERED';
}

/**
 * 🔴 `tenants(lifecycle_state='CLOSING')` かつ `closing_entered_at + graceDays <= now` のうち、削除予告
 *    （`email_dispatches.template_key='TENANT_CLOSING_NOTICE'`）が `SENT` / `MOCKED` でないものを返す。
 *    T-10-12（`tenant.closing-notify`）が未実装の間は予告行が 0 件 = 全件 `NOTICE_PENDING` になる（実装されればそのまま正しくなる）。
 *    🔴 項目 7（`TenantPurgeRun.status='FAILED'`）とは別行。失敗ジョブ数に足さない。
 */
export async function readPurgeNoticePending(
  ctx: AuthenticatedPlatformCtx,
  meta: MonitoringRequestMeta & { readonly graceDays: number },
): Promise<PurgeNoticePending> {
  assertPositiveInt('graceDays', meta.graceDays);
  const graceMs = meta.graceDays * MILLISECONDS_PER_DAY;
  const enteredBefore = new Date(meta.now.getTime() - graceMs);
  return withPlatformRead(monitoringOp(ctx, 'PURGE_NOTICE_PENDING', meta.ipAddress), async (db) => {
    const tenants = await db.tenant.findMany({
      where: { lifecycleState: 'CLOSING', closingEnteredAt: { lte: enteredBefore } },
      orderBy: [{ closingEnteredAt: 'asc' }, { id: 'asc' }],
      select: { id: true, closingEnteredAt: true },
    });
    if (tenants.length === 0) return { rows: [], total: 0, graceDays: meta.graceDays };
    const groups = await db.emailDispatch.groupBy({
      by: ['tenantId', 'status'],
      where: { templateKey: TENANT_CLOSING_NOTICE_TEMPLATE_KEY, tenantId: { in: tenants.map((tenant) => tenant.id) } },
      _count: { _all: true },
    });
    const statusesByTenant = new Map<string, string[]>();
    for (const group of groups) {
      if (group.tenantId === null) continue;
      statusesByTenant.set(group.tenantId, [...(statusesByTenant.get(group.tenantId) ?? []), group.status]);
    }
    const rows: PurgeNoticePendingRow[] = [];
    for (const tenant of tenants) {
      const cause = classifyPurgeNotice(statusesByTenant.get(tenant.id) ?? []);
      if (cause === null || tenant.closingEnteredAt === null) continue;
      rows.push({
        tenantId: tenant.id,
        cause,
        overdueDays: wholeDaysBetween(new Date(tenant.closingEnteredAt.getTime() + graceMs), meta.now),
      });
    }
    return { rows: rows.slice(0, ROWS_LIMIT), total: rows.length, graceDays: meta.graceDays };
  });
}

// ---------------------------------------------------------------------------
// 項目 16: EmailDispatch の QUEUED 滞留（送信済み未記録の疑い。docs/05 §16.5）
// ---------------------------------------------------------------------------

export type MailDispatchStuck = {
  readonly count: number;
  /** 最も古い滞留の起点（`id` の uuidv7 時刻 = 行を作った時刻）。 */
  readonly oldestSince: Date | null;
  readonly stallThresholdMinutes: number;
  /** 読み取りの上限に当たった（`count` は下限）。 */
  readonly countIsLowerBound: boolean;
};

/** 1 回に読む `QUEUED` 行の上限（`id` 昇順 = 古い順。正常時は数十行に収まる）。 */
const QUEUED_READ_LIMIT = 1_000;

/**
 * 🔴 `email_dispatches(status='QUEUED')` のうち、作成から閾値（`MAIL_DISPATCH_STUCK_ALERT_MINUTES`）を超えた行。
 *    作成時刻の列が無いので `id`（`@default(uuid(7))`）の時刻を読む（docs/05 §16.5「`updated_at`（無ければ `id` の uuidv7 時刻）」。
 *    `uuidV7TimeOf` の注記）。`id` 昇順 = 時刻順なので、上限に当たるのは最も新しい側である。
 */
export async function readMailDispatchStuck(
  ctx: AuthenticatedPlatformCtx,
  meta: MonitoringRequestMeta & { readonly stallThresholdMinutes: number },
): Promise<MailDispatchStuck> {
  assertPositiveInt('stallThresholdMinutes', meta.stallThresholdMinutes);
  const cutoff = meta.now.getTime() - meta.stallThresholdMinutes * MILLISECONDS_PER_MINUTE;
  return withPlatformRead(monitoringOp(ctx, 'MAIL_DISPATCH_STUCK', meta.ipAddress), async (db) => {
    const rows = await db.emailDispatch.findMany({
      where: { status: 'QUEUED' },
      orderBy: { id: 'asc' },
      take: QUEUED_READ_LIMIT,
      select: { id: true },
    });
    let count = 0;
    let oldestSince: Date | null = null;
    for (const row of rows) {
      const createdAt = uuidV7TimeOf(row.id);
      if (createdAt === null) {
        throw new Error(`email_dispatches.id が UUID v7 ではありません（${row.id}）。滞留時刻を判定できません。`);
      }
      if (createdAt.getTime() > cutoff) continue;
      count += 1;
      if (oldestSince === null || createdAt.getTime() < oldestSince.getTime()) oldestSince = createdAt;
    }
    return {
      count,
      oldestSince,
      stallThresholdMinutes: meta.stallThresholdMinutes,
      countIsLowerBound: rows.length === QUEUED_READ_LIMIT && count === rows.length,
    };
  });
}

// ---------------------------------------------------------------------------
// スケジューラ生存監視（docs/05 §9.9。SchedulerRun が staleHours 更新なしなら停止）
// ---------------------------------------------------------------------------

export type SchedulerHeartbeat = {
  /** `scheduler_runs.started_at` の MAX（ジョブ名を問わない）。1 行も無ければ `null`。 */
  readonly lastRunAt: Date | null;
  readonly staleHours: number;
  /** `lastRunAt` が無い / `staleHours` より前 = 停止の疑い。 */
  readonly stalled: boolean;
};

export async function readSchedulerHeartbeat(
  ctx: AuthenticatedPlatformCtx,
  meta: MonitoringRequestMeta & { readonly staleHours: number },
): Promise<SchedulerHeartbeat> {
  assertPositiveInt('staleHours', meta.staleHours);
  return withPlatformRead(monitoringOp(ctx, 'SCHEDULER_HEARTBEAT', meta.ipAddress), async (db) => {
    const latest = await db.schedulerRun.aggregate({ _max: { startedAt: true } });
    const lastRunAt = latest._max.startedAt;
    const stalled =
      lastRunAt === null || meta.now.getTime() - lastRunAt.getTime() >= meta.staleHours * MILLISECONDS_PER_HOUR;
    return { lastRunAt, staleHours: meta.staleHours, stalled };
  });
}
