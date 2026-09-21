// packages/domain/src/health/tenant-health.ts
// 🔴 テナント健全性の「異常度スコア」と、`A-002` の並び順（docs/05 §5.7 / §6.9 API-A2 / docs/02 `F-056 AC-2` /
//    `CLAUDE.md` §10.4-1「異常なテナントを上位に出す」/ docs/01 章 7.3）。T-11-01。
//
// ============================================================================
// 🔴 何を「異常」と呼ぶか（`F-056 AC-2` の 4 つ + 接近 1 つ）
// ============================================================================
// 目的は「その顧客が**使えているか**」を捉え、解約の申し出より前に接触することである（docs/01 章 7.3）。
// 入力は**件数・状態・日時だけ**であり、内容（氏名・本文・単価）を 1 つも取らない（docs/05 §5.7 / `BR-40`）。
//
//   - `INACTIVE`       最終アクティビティ（無ければ開設日時）から `inactiveDays` 以上経過
//   - `SEATS_UNUSED`   有効な席のうち、停滞閾値内にログインした利用者の割合が `seatUtilizationMinPercent` 未満
//                      （docs/01 章 7.3「買った席が使われていないのは社内に定着していない兆候」。席 0 のテナントは対象外）
//   - `NO_PARTNERS`    パートナー数 0 が、開設から `noPartnersGraceDays` 以上続いている
//                      （docs/04 §A-002「粗利では検知できない解約予備軍」。開設直後は猶予する）
//   - `TRIAL_EXPIRED`  `SANDBOX` で `sandboxExpiresAt` を過ぎた（`CLOSING` への遷移待ち。接触の最後の機会）
//   - `TRIAL_EXPIRING` `SANDBOX` で期限が `trialExpiringDays` 以内（`TRIAL_EXPIRED` と排他）
//
// ============================================================================
// 🔴 重みは定数である（事業判断ではなく、運用の並び順）
// ============================================================================
// スコアは**運営者の一覧の並び順を決めるためだけ**に使う。課金・停止・通知の判定には使わない。
// したがって重みは `packages/domain` の定数として持ち、Issue で人間の決定を待たない（`CLAUDE.md` §8.6 の
// 「事業判断」ではない）。閾値（日数・割合）だけは `packages/config` から渡される（ここに書かない）。
// 「解約に近い順」= `TRIAL_EXPIRED`（期限が来ている）> `INACTIVE`（誰も使っていない）> `SEATS_UNUSED`
// （一部しか使っていない）> `NO_PARTNERS`（中核価値に届いていない）> `TRIAL_EXPIRING`（まだ期限内）。
// 重みは**どの 1 つを取っても、それより下位の全部を足したものより大きい**ように取る
// （40 > 20 + 10 + 6 + 3、20 > 10 + 6 + 3、10 > 6 + 3、6 > 3）—— 並びが**辞書式**になり、「期限切れがあれば必ず上」
// 「期限切れが無ければ停滞があるものが上」と運営者に 1 文で説明できる。合計値そのものに意味は無い。
//
// ============================================================================
// 🔴 決定性
// ============================================================================
// `now` は引数で受ける（`Date.now()` を呼ばない）。同じ入力には同じ出力。同点は `createdAt` 昇順（古い
// テナント = 長く放置されている方を先に）→ `id` 昇順で確定する。`CLOSING` は正常な終了であり**最下位の層**、
// `PURGED` は対象外で**さらに下の層**に置く（スコアを持たない。並びの層で分ける）。

import type { TenantLifecycleState } from '../state/tenant.js';

const DAY_MS = 24 * 60 * 60 * 1000;

/** 🔴 並びの優先順 = この配列の順（重みの降順と一致させる）。応答の `signals` もこの順で出す。 */
export const TENANT_HEALTH_SIGNALS = [
  'TRIAL_EXPIRED',
  'INACTIVE',
  'SEATS_UNUSED',
  'NO_PARTNERS',
  'TRIAL_EXPIRING',
] as const;

export type TenantHealthSignal = (typeof TENANT_HEALTH_SIGNALS)[number];

/** 🔴 定数（上記の理由）。上位 1 つ > 下位の合計、を満たす。 */
export const TENANT_HEALTH_SIGNAL_WEIGHTS: Readonly<Record<TenantHealthSignal, number>> = {
  TRIAL_EXPIRED: 40,
  INACTIVE: 20,
  SEATS_UNUSED: 10,
  NO_PARTNERS: 6,
  TRIAL_EXPIRING: 3,
};

/**
 * 閾値。出所は `packages/config`（`TENANT_HEALTH_*`）であり、呼び出し側が渡す。
 * `DEFAULT_TENANT_HEALTH_THRESHOLDS` は `packages/config` の既定値と同じ数字を**テストの材料として**持つ
 * （本番の経路は必ず設定値を渡す。`apps/web/lib/db/bootstrap.ts` の `tenantHealthRuntime()`）。
 */
export type TenantHealthThresholds = {
  /** 最終アクティビティの停滞と判断する日数（既定 14）。席の利用判定の窓にも使う。 */
  readonly inactiveDays: number;
  /** パートナー数 0 を異常と数え始めるまでの、開設からの日数（既定 7）。 */
  readonly noPartnersGraceDays: number;
  /** 席の利用率（%）。これ未満で `SEATS_UNUSED`（既定 30。docs/04 §A-002「利用率 30% 未満」）。 */
  readonly seatUtilizationMinPercent: number;
  /** トライアル期限の接近と判断する残日数（既定 7。docs/04 §A-002「期限が 7 日以内」）。 */
  readonly trialExpiringDays: number;
};

export const DEFAULT_TENANT_HEALTH_THRESHOLDS: TenantHealthThresholds = {
  inactiveDays: 14,
  noPartnersGraceDays: 7,
  seatUtilizationMinPercent: 30,
  trialExpiringDays: 7,
};

export type TenantHealthInput = {
  readonly lifecycleState: TenantLifecycleState;
  readonly createdAt: Date;
  /** 最終アクティビティ（テナント利用者の最終ログイン。docs/05 §6.9 API-A2）。記録が無ければ `null`。 */
  readonly lastActivityAt: Date | null;
  /** 有効な席（`memberships.revoked_at IS NULL`）。 */
  readonly seatCount: number;
  /** そのうち `inactiveDays` 以内にログインした利用者の数。`seatCount` 以下。 */
  readonly activeMemberCount: number;
  readonly partnerCompanyCount: number;
  readonly sandboxExpiresAt: Date | null;
  /** 🔴 現在時刻は注入する（決定性）。 */
  readonly now: Date;
};

export type TenantHealth = {
  readonly score: number;
  readonly signals: readonly TenantHealthSignal[];
};

const NO_HEALTH: TenantHealth = { score: 0, signals: [] };

function assertPositiveInteger(name: string, value: number): void {
  if (!Number.isInteger(value) || value < 1) {
    throw new RangeError(`${name} は 1 以上の整数である必要があります（受け取った値: ${value}）。`);
  }
}

export function assertTenantHealthThresholds(thresholds: TenantHealthThresholds): void {
  assertPositiveInteger('inactiveDays', thresholds.inactiveDays);
  assertPositiveInteger('noPartnersGraceDays', thresholds.noPartnersGraceDays);
  assertPositiveInteger('trialExpiringDays', thresholds.trialExpiringDays);
  if (
    !Number.isInteger(thresholds.seatUtilizationMinPercent) ||
    thresholds.seatUtilizationMinPercent < 1 ||
    thresholds.seatUtilizationMinPercent > 100
  ) {
    throw new RangeError(
      `seatUtilizationMinPercent は 1〜100 の整数である必要があります（受け取った値: ${thresholds.seatUtilizationMinPercent}）。`,
    );
  }
}

function assertCount(name: string, value: number): void {
  if (!Number.isInteger(value) || value < 0) {
    throw new RangeError(`${name} は 0 以上の整数である必要があります（受け取った値: ${value}）。`);
  }
}

/**
 * 🔴 異常度スコア（純粋関数）。`PURGED` / `CLOSING` はシグナルを持たない（層で並べる。`tenantListComparator`）。
 *
 * - `INACTIVE`: 基準時刻 = `lastActivityAt ?? createdAt`。`now − 基準 >= inactiveDays 日` で成立
 *   （一度もログインが無いテナントは、開設から数える）。
 * - `SEATS_UNUSED`: `seatCount > 0` かつ `activeMemberCount × 100 < seatCount × seatUtilizationMinPercent`
 *   （整数演算。浮動小数点の比率を作らない —— `decideLimitLevel` と同じ理由）。
 * - `NO_PARTNERS`: `partnerCompanyCount === 0` かつ `now − createdAt >= noPartnersGraceDays 日`。
 * - `TRIAL_EXPIRED` / `TRIAL_EXPIRING`: `SANDBOX` のみ。期限が無い（`null`）なら判定しない。
 */
export function scoreTenantHealth(
  input: TenantHealthInput,
  thresholds: TenantHealthThresholds,
): TenantHealth {
  assertTenantHealthThresholds(thresholds);
  assertCount('seatCount', input.seatCount);
  assertCount('activeMemberCount', input.activeMemberCount);
  assertCount('partnerCompanyCount', input.partnerCompanyCount);
  if (input.activeMemberCount > input.seatCount) {
    throw new RangeError(
      `activeMemberCount（${input.activeMemberCount}）が seatCount（${input.seatCount}）を超えています。`,
    );
  }

  if (input.lifecycleState === 'PURGED' || input.lifecycleState === 'CLOSING') return NO_HEALTH;

  const nowMs = input.now.getTime();
  const flags = new Set<TenantHealthSignal>();

  const activityBasis = input.lastActivityAt ?? input.createdAt;
  if (nowMs - activityBasis.getTime() >= thresholds.inactiveDays * DAY_MS) flags.add('INACTIVE');

  if (
    input.seatCount > 0 &&
    input.activeMemberCount * 100 < input.seatCount * thresholds.seatUtilizationMinPercent
  ) {
    flags.add('SEATS_UNUSED');
  }

  if (
    input.partnerCompanyCount === 0 &&
    nowMs - input.createdAt.getTime() >= thresholds.noPartnersGraceDays * DAY_MS
  ) {
    flags.add('NO_PARTNERS');
  }

  if (input.lifecycleState === 'SANDBOX' && input.sandboxExpiresAt !== null) {
    const remainingMs = input.sandboxExpiresAt.getTime() - nowMs;
    if (remainingMs <= 0) flags.add('TRIAL_EXPIRED');
    else if (remainingMs <= thresholds.trialExpiringDays * DAY_MS) flags.add('TRIAL_EXPIRING');
  }

  // 🔴 出力順は TENANT_HEALTH_SIGNALS の順に固定する（Set の挿入順に依存しない）。
  const signals = TENANT_HEALTH_SIGNALS.filter((signal) => flags.has(signal));
  const score = signals.reduce((sum, signal) => sum + TENANT_HEALTH_SIGNAL_WEIGHTS[signal], 0);
  return { score, signals };
}

// ---------------------------------------------------------------------------
// 要約（`A-002` セクション 1「異常の要約」/ API-A2 の `summary`。T-12-18 ③）
// ---------------------------------------------------------------------------

/** 種別ごとのテナント数。🔴 5 キーを必ず全部持つ（0 件も `0`。型が `Record` なので欠けられない）。 */
export type TenantHealthSummary = Readonly<Record<TenantHealthSignal, number>>;

/**
 * 🔴 種別ごとに「そのシグナルを持つテナントの数」を数える（純粋関数。docs/05 §6.9 API-A2「応答の形」）。
 *    1 テナントが 2 種別を持てば両方に数える。`CLOSING` / `PURGED` は `signals: []` なのでどこにも数えない。
 *    母集団は呼び出し側が渡す（絞り込み・カーソルを**外した**同じ算出結果 = #45 の `byState` と同型）。
 *    件数だけであり、テナントの内容には立ち入らない（`BR-40`）。
 */
export function countTenantHealthSignals(
  items: readonly { readonly health: Pick<TenantHealth, 'signals'> }[],
): TenantHealthSummary {
  const counts: Record<TenantHealthSignal, number> = {
    TRIAL_EXPIRED: 0,
    INACTIVE: 0,
    SEATS_UNUSED: 0,
    NO_PARTNERS: 0,
    TRIAL_EXPIRING: 0,
  };
  for (const item of items) {
    for (const signal of new Set(item.health.signals)) counts[signal] += 1;
  }
  return counts;
}

// ---------------------------------------------------------------------------
// 並び順（`A-002` / API-A2 の `sort`）
// ---------------------------------------------------------------------------

/**
 * 🔴 API-A2 の `sort` の値集合。`health`（既定。異常度の高い順）/ `name` / `createdAt`（SP-03 の既定 = 新しい順）。
 *    境界検証（`apps/web/lib/admin-tenants/schemas.ts`）とクエリ（`packages/db`）が同じ 1 つを見る。
 */
export const TENANT_LIST_SORT_KEYS = ['health', 'name', 'createdAt'] as const;

export type TenantListSortKey = (typeof TENANT_LIST_SORT_KEYS)[number];

export const DEFAULT_TENANT_LIST_SORT: TenantListSortKey = 'health';

/** 並びの材料。内容を持たない（ID・名前・状態・日時・スコアだけ）。 */
export type TenantListSortable = {
  readonly id: string;
  readonly name: string;
  readonly lifecycleState: TenantLifecycleState;
  readonly createdAt: Date;
  readonly health: TenantHealth;
};

/** 🔴 層: 0 = スコアの対象 / 1 = `CLOSING`（正常な終了。最下位）/ 2 = `PURGED`（対象外。さらに下）。 */
function lifecycleTier(state: TenantLifecycleState): 0 | 1 | 2 {
  if (state === 'PURGED') return 2;
  if (state === 'CLOSING') return 1;
  return 0;
}

function compareStrings(a: string, b: string): number {
  // 🔴 ロケール非依存（コードユニット順）。実行環境の ICU に並びを依存させない。
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

function compareById(a: TenantListSortable, b: TenantListSortable): number {
  return compareStrings(a.id, b.id);
}

/**
 * 🔴 `health`: 層（対象 → `CLOSING` → `PURGED`）→ スコア降順 → `createdAt` 昇順（古い方が先）→ `id` 昇順。
 */
export function compareTenantHealthOrder(a: TenantListSortable, b: TenantListSortable): number {
  const tier = lifecycleTier(a.lifecycleState) - lifecycleTier(b.lifecycleState);
  if (tier !== 0) return tier;
  if (a.health.score !== b.health.score) return b.health.score - a.health.score;
  const created = a.createdAt.getTime() - b.createdAt.getTime();
  if (created !== 0) return created;
  return compareById(a, b);
}

/** `name`: 名前昇順 → `id` 昇順。 */
export function compareTenantNameOrder(a: TenantListSortable, b: TenantListSortable): number {
  const byName = compareStrings(a.name, b.name);
  return byName !== 0 ? byName : compareById(a, b);
}

/** `createdAt`: 新しい順 → `id` 降順（SP-03 の API-A2 の既定と同じ）。 */
export function compareTenantCreatedAtOrder(a: TenantListSortable, b: TenantListSortable): number {
  const created = b.createdAt.getTime() - a.createdAt.getTime();
  return created !== 0 ? created : -compareById(a, b);
}

export function tenantListComparator(
  sort: TenantListSortKey,
): (a: TenantListSortable, b: TenantListSortable) => number {
  switch (sort) {
    case 'health':
      return compareTenantHealthOrder;
    case 'name':
      return compareTenantNameOrder;
    case 'createdAt':
      return compareTenantCreatedAtOrder;
  }
}
