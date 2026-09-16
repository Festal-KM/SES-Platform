// apps/web/lib/admin-monitoring/view.ts
// 🔴 API-A8 `GET /api/admin/monitoring`（`A-005` 運用監視。`F-059`）の応答型（docs/05 §6.9 API-A8 / §16.5 / docs/04 §A-005）。T-11-04。
//
// ============================================================================
// 🔴 項目ごとに独立した判別可能な合併である
// ============================================================================
// 各項目は `{ kind, ok: true, …材料 } | { kind, ok: false, errorKind }` であり、1 項目の材料が取れなくても他の項目は返る
// （docs/04 §A-005「項目ごとに独立して読み込み、揃うのを待たない」/ 「項目単位のエラー」）。`ok: false` は「取得できませんでした」
// であって「0 件」ではない —— 0 件で埋めると「監視が動いていない」と「異常が無い」を区別できなくなる。
//
// ============================================================================
// 🔴 この型に載るのは件数・状態・エラー種別・日時・不透明な ID だけである（`F-059 AC-3` / `BR-40`）
// ============================================================================
// 提案本文・件名・提案先・エンジニア氏名・スキルシート内容・チャット本文・宛先・DKIM トークン・MAIL FROM ドメイン・
// ジョブの payload（`account.mail` の平文トークン）は**フィールドとして存在しない**（`view.types.test.ts` が型で固定する）。
// `targetId` / `tenantId` は載るが、管理平面に ID から内容を引く API は無い（`tests/static/admin-no-content-reach.test.ts`）。
//
// 🔴 `@ses/db/platform` を import しない（ESLint の ADMIN_PLANE_ZONE 外）。DTO → View の写しは
//    `apps/web/app/api/admin/monitoring/_lib/readers.ts`（管理平面ゾーン）が行い、ここは JSON 化済みの形だけを宣言する。
//    クライアント（`'use client'` の画面）が値 import してよいのは本ファイルと `hrefs.ts` だけである。

/**
 * 監視項目（docs/04 §A-005 の項目表の順。Phase 1 の項目のみ）。
 * 🔴 順序は画面の並びそのもの（`buildMonitoringSnapshot` はこの順で `items` を返す）。
 */
export const MONITORING_KINDS = [
  'SUBMIT_FAILED_UNATTENDED', // 1
  'SUBMITTING_STALL', // 2
  'FAILED_JOBS', // 3
  'SCAN_FAILED', // 4
  'GATE_FAIL_RATE', // 5
  'USAGE_MEASUREMENT', // 6（計測欠測 + ストレージ乖離）
  'PURGE_JOB_FAILED', // 7
  'SENDING_DOMAIN_UNVERIFIED', // 11
  'GATE_STALL', // 12
  'MAIL_PROVIDER_QUOTA', // 13
  'SEND_HOLD', // 14
  'PURGE_NOTICE_PENDING', // 15
  'MAIL_DISPATCH_STUCK', // 16
  'PROVIDER_SPEND', // 17
  'SCHEDULER_HEARTBEAT', // スケジューラ停止（docs/05 §9.9）
] as const;

export type MonitoringKind = (typeof MONITORING_KINDS)[number];

/**
 * 材料を取れなかった理由の種別（内容ではなく種別だけ。`BR-40`）。
 * - `DB_READ_FAILED` … `withPlatformRead` の読み取りが失敗した
 * - `QUEUE_READ_FAILED` … BullMQ（Redis）の failed セットを読めなかった
 * - `PROVIDER_READ_FAILED` … 送信基盤のカウンタ（Redis）を読めなかった（`getQuota()` の失敗は `available: false` であってこれではない）
 */
export const MONITORING_ERROR_KINDS = ['DB_READ_FAILED', 'QUEUE_READ_FAILED', 'PROVIDER_READ_FAILED'] as const;

export type MonitoringErrorKind = (typeof MONITORING_ERROR_KINDS)[number];

/** ISO 8601 の日時（JSON 化済み）。 */
type Iso = string;

// --- 項目 1 / 2 ------------------------------------------------------------

export type TenantCountView = { readonly tenantId: string; readonly count: number; readonly oldestSince: Iso | null };

export type SubmitFailedUnattendedPayload = { readonly rows: readonly TenantCountView[]; readonly total: number };

export type SubmittingStallPayload = {
  readonly rows: readonly (TenantCountView & { readonly longestStalledMinutes: number })[];
  readonly total: number;
  readonly stallThresholdMinutes: number;
};

// --- 項目 3 ----------------------------------------------------------------

export type FailedJobsPayload = {
  /** 定義済みの全キュー（0 件を含む = 「照合した」事実）。 */
  readonly byQueue: readonly { readonly queueName: string; readonly count: number; readonly lastFailedAt: Iso | null }[];
  readonly total: number;
};

// --- 項目 4 ----------------------------------------------------------------

export type ScanFailedPayload = {
  readonly rows: readonly {
    readonly tenantId: string;
    readonly countsByStatus: Readonly<Record<'INFECTED' | 'UNSCANNABLE' | 'FAILED', number>>;
    readonly count: number;
    readonly oldestSince: Iso | null;
  }[];
  readonly total: number;
  readonly scanningStalled: { readonly count: number; readonly oldestUploadedAt: Iso | null };
  readonly scanStallThresholdMinutes: number;
};

// --- 項目 5 ----------------------------------------------------------------

export type GateFailRateWindowView = { readonly done: number; readonly failed: number; readonly rate: number | null };

export type GateFailRatePayload = {
  readonly rows: readonly { readonly tenantId: string; readonly recent: GateFailRateWindowView; readonly baseline: GateFailRateWindowView }[];
  readonly recent: GateFailRateWindowView;
  readonly baseline: GateFailRateWindowView;
  readonly windowHours: number;
  readonly baselineDays: number;
};

// --- 項目 6 ----------------------------------------------------------------

export const USAGE_MEASUREMENT_FINDING_KINDS = ['GAP_MISSING', 'GAP_MISMATCH', 'STORAGE_DIVERGENCE'] as const;

export type UsageMeasurementFindingKind = (typeof USAGE_MEASUREMENT_FINDING_KINDS)[number];

export type UsageMeasurementPayload = {
  readonly countsByKind: Readonly<Record<UsageMeasurementFindingKind, number>>;
  readonly items: readonly {
    readonly tenantId: string;
    readonly kind: UsageMeasurementFindingKind;
    readonly metric: string;
    readonly periodKind: 'DAY' | 'MONTH';
    readonly periodKey: string;
    readonly detectedAt: Iso;
    readonly lastSeenAt: Iso;
  }[];
};

// --- 項目 7 ----------------------------------------------------------------

export type PurgeJobFailedPayload = {
  readonly rows: readonly { readonly tenantId: string; readonly cause: string; readonly failedCount: number; readonly lastFailedAt: Iso | null }[];
  readonly total: number;
};

// --- 項目 11 ---------------------------------------------------------------

export const SENDING_DOMAIN_STATUSES = ['NOT_REGISTERED', 'REGISTERED', 'PENDING', 'FAILED', 'REVOKED'] as const;

export type SendingDomainStatusView = (typeof SENDING_DOMAIN_STATUSES)[number];

export type SendingDomainUnverifiedPayload = {
  readonly items: readonly {
    readonly tenantId: string;
    readonly tenantName: string;
    readonly lifecycleState: 'SANDBOX' | 'ACTIVE';
    readonly domain: string | null;
    readonly status: SendingDomainStatusView;
    readonly startedAt: Iso;
    readonly lastCheckedAt: Iso | null;
    readonly daysSinceStarted: number;
    readonly revokedAt: Iso | null;
    readonly daysSinceRevoked: number | null;
    readonly expectedRecords: number;
  }[];
  readonly countsByStatus: Readonly<Record<SendingDomainStatusView, number>>;
  readonly total: number;
};

// --- 項目 12 ---------------------------------------------------------------

export const GATE_STALL_REASONS_VIEW = ['AI_COST_LIMIT_HELD', 'JOB_FAILED', 'RUNNING_OVERDUE'] as const;

export type GateStallReasonView = (typeof GATE_STALL_REASONS_VIEW)[number];

export type GateStallRowView = {
  readonly tenantId: string;
  readonly targetType: string;
  readonly targetId: string;
  readonly reason: GateStallReasonView;
  readonly since: Iso;
  readonly stalledMinutes: number;
};

export type GateStallPayload = {
  readonly stallThresholdMinutes: number;
  readonly countsByReason: Readonly<Record<GateStallReasonView, number>>;
  readonly rows: readonly GateStallRowView[];
  readonly total: number;
  /**
   * 🔴 BullMQ の failed セットを照合できたか。`false` のとき `JOB_FAILED` / `RUNNING_OVERDUE` は判定不能であり、
   *    `rows` には保留（`AI_COST_LIMIT_HELD`）だけが載る（閾値超過を応答不明に畳まない。docs/sprints/SP-11 T-11-05 ②）。
   */
  readonly failedJobsAvailable: boolean;
  /** `failedJobsAvailable=false` のとき、理由を判定できなかった閾値超過の件数（画面が「N 件は判定できません」と添える）。 */
  readonly unclassifiedOverdue: number;
};

// --- 項目 13 ---------------------------------------------------------------

export type MailProviderReadingView =
  | { readonly available: true; readonly max24h: number; readonly sentLast24h: number; readonly consumptionRate: number; readonly observedAt: Iso }
  | { readonly available: false; readonly localSentLast24h: number; readonly lastObservedAt: Iso | null };

/** 🔴 `tenantId` を持たない（環境全体）。docs/05 §6.9 API-A8 の型そのまま。 */
export type MailProviderQuotaPayload = {
  readonly scope: 'ENVIRONMENT';
  readonly providerReading: MailProviderReadingView;
  /** 実効上限（`min(max24h, MAIL_PROVIDER_DAILY_QUOTA)`）。`available: false` のときは `MAIL_PROVIDER_DAILY_QUOTA` そのもの（参考値）。 */
  readonly envLimit: number;
  readonly warnRatio: number;
  readonly reachedAt: Iso | null;
  readonly nearingSince: Iso | null;
  readonly heldCount: number;
};

// --- 項目 14 ---------------------------------------------------------------

export const SEND_HOLD_REASONS_VIEW = [
  'RATE_LIMIT',
  'DOMAIN_UNVERIFIED',
  'ESIGN_DISCONNECTED',
  'TENANT_SUSPENDED',
  'GATE_STALE',
  'AI_COST_LIMIT',
  'PROVIDER_QUOTA',
] as const;

export type SendHoldReasonView = (typeof SEND_HOLD_REASONS_VIEW)[number];

export type SendHoldByReasonView =
  | { readonly scope: 'TENANT'; readonly rows: readonly { readonly tenantId: string; readonly proposals: number; readonly contracts: number; readonly oldestSince: Iso | null }[] }
  | { readonly scope: 'ENVIRONMENT'; readonly proposals: number; readonly contracts: number; readonly oldestSince: Iso | null };

export type SendHoldPayload = {
  readonly byReason: Readonly<Record<SendHoldReasonView, SendHoldByReasonView>>;
  readonly total: number;
};

// --- 項目 15 ---------------------------------------------------------------

export type PurgeNoticePendingPayload = {
  readonly rows: readonly { readonly tenantId: string; readonly cause: 'NOTICE_PENDING' | 'NOTICE_UNDELIVERED'; readonly overdueDays: number }[];
  readonly total: number;
  readonly graceDays: number;
};

// --- 項目 16 ---------------------------------------------------------------

export type MailDispatchStuckPayload = {
  readonly count: number;
  readonly oldestSince: Iso | null;
  readonly stallThresholdMinutes: number;
  readonly countIsLowerBound: boolean;
};

// --- 項目 17 ---------------------------------------------------------------

/** 🔴 `tenantId` を持たない（環境全体）。`byRole` は載せない（`A-004` の材料）。docs/05 §6.9 API-A8。 */
export type ProviderSpendPayload = {
  readonly scope: 'ENVIRONMENT';
  readonly periodKey: string;
  readonly spentUsd: string;
  readonly capUsd: string;
  readonly consumptionRate: number;
  readonly level: 'BELOW' | 'NEARING' | 'REACHED';
  readonly tenantCount: number;
};

// --- スケジューラ ------------------------------------------------------------

export type SchedulerHeartbeatPayload = { readonly lastRunAt: Iso | null; readonly staleHours: number; readonly stalled: boolean };

// --- 合併 ------------------------------------------------------------------

export type MonitoringPayloadByKind = {
  readonly SUBMIT_FAILED_UNATTENDED: SubmitFailedUnattendedPayload;
  readonly SUBMITTING_STALL: SubmittingStallPayload;
  readonly FAILED_JOBS: FailedJobsPayload;
  readonly SCAN_FAILED: ScanFailedPayload;
  readonly GATE_FAIL_RATE: GateFailRatePayload;
  readonly USAGE_MEASUREMENT: UsageMeasurementPayload;
  readonly PURGE_JOB_FAILED: PurgeJobFailedPayload;
  readonly SENDING_DOMAIN_UNVERIFIED: SendingDomainUnverifiedPayload;
  readonly GATE_STALL: GateStallPayload;
  readonly MAIL_PROVIDER_QUOTA: MailProviderQuotaPayload;
  readonly SEND_HOLD: SendHoldPayload;
  readonly PURGE_NOTICE_PENDING: PurgeNoticePendingPayload;
  readonly MAIL_DISPATCH_STUCK: MailDispatchStuckPayload;
  readonly PROVIDER_SPEND: ProviderSpendPayload;
  readonly SCHEDULER_HEARTBEAT: SchedulerHeartbeatPayload;
};

export type MonitoringItemOk<K extends MonitoringKind = MonitoringKind> = K extends MonitoringKind
  ? { readonly kind: K; readonly ok: true } & MonitoringPayloadByKind[K]
  : never;

export type MonitoringItemFailed<K extends MonitoringKind = MonitoringKind> = {
  readonly kind: K;
  readonly ok: false;
  readonly errorKind: MonitoringErrorKind;
};

export type MonitoringItemView<K extends MonitoringKind = MonitoringKind> = MonitoringItemOk<K> | MonitoringItemFailed<K>;

/** API-A8 の応答。`items` は `MONITORING_KINDS` の順で常に全項目を含む（取れなかった項目も `ok: false` で載る）。 */
export type MonitoringSnapshotView = {
  readonly observedAt: Iso;
  readonly items: readonly MonitoringItemView[];
};

/**
 * 🔴 項目の重さ（docs/04 §A-005 / `CLAUDE.md` §4.2「失敗と保留を混同しない」）。
 *  - `failure` … 障害の色（項目 1 / 2 / 3 / 4 / 7、項目 12 の `JOB_FAILED` / `RUNNING_OVERDUE`、スケジューラ停止、項目 17 の `REACHED`）
 *  - `hold` … 保留・注意の色（項目 12 の `AI_COST_LIMIT_HELD`、13、14、15、16、項目 17 の `NEARING`、項目 11）
 *  - `ok` … 成立（0 件 / 消費率が上限未満）
 */
export type MonitoringSeverity = 'ok' | 'hold' | 'failure';
