// apps/web/lib/usage/view.ts
// docs/05 §6.7 #69 `GET /api/usage`（`S-038`。ホストロールのみ）/ #70 `GET /api/usage/blocked-notice`
// （全ロール。パートナーはこちらのみ）。docs/02 `F-027 AC-1` / `AC-2` / `AC-6` / `AC-7` / docs/05 §5.8 `UsageView`。T-10-03。
//
// ============================================================================
// 🔴 応答の型に金額（USD）の項目が存在しない（`F-027 AC-6` / `BR-24` / Issue #12）
// ============================================================================
// 残量・上限は**件数**（4 単位）/ 通数 / バイト数 / 席数で返す。AI の 1 日コスト上限は**遮断器**であり
// メーターを返さない —— `aiDailyStop` は「停止しているか・理由・再開時刻・止まっている機能」だけを持つ
// （docs/04 §S-038「メーターもゲージも置かない」）。唯一の金額は `overageEstimateJpy`（請求見込み。
// 残量の提示ではない）であり、Phase 1 は契約条件（単価）が主平面から読めないため `null`（算出できない。
// 0 円と偽らない）。型テスト（`view.types.test.ts`）と結合テストが「USD の項目が無い」ことを固定する。
//
// 🔴 `gate-inspector` のキーは `aiUnits` に存在しない（`F-027 AC-7`。`AiUnitMetric` は 4 値）。
//    **止まった理由としてだけ**現れる（`stoppedFeatures` の `reviewGate`。docs/03 `ui-design` 申し送り 6）。
//
// 🔴 判定は `packages/domain` の 1 実装（`assessAiUnitLimit` / `assessEmailDailyLimit` / `assessStorageLimit` /
//    `decideEmailRate`）。ワーカー（`usage.limit-check`）と同じ関数・同じ上限値（`usageLimitsRuntime()`）を通る。
//    AI の停止だけは予約と同じ probe（ワーカー）が確定させた `usage_limit_states` を読む（`readAiStopNotice`）。
//
// 🔴 本モジュールは Next.js / Auth.js に依存しない（`@ses/db` / `@ses/domain` のみ）。結合テストが
//    サーバを立てずに同じ経路を実行できるようにするため。
import {
  readAiStopNotice,
  readTenantUsageSnapshot,
  requireHost,
  TENANT_ROLES,
  type AuthenticatedTenantCtx,
} from '@ses/db';
import {
  AI_UNIT_METRICS,
  assessAiUnitLimit,
  assessEmailDailyLimit,
  assessStorageLimit,
  decideAiUnitQuota,
  decideEmailRate,
  type AiUnitMetric,
  type UsageLimitLevel,
} from '@ses/domain';
import type { MessageKey } from '@ses/i18n';
import { usageLimitsRuntime } from '../db/bootstrap';

/**
 * 利用者に見せる 4 単位のキー（docs/05 §5.8 の `AiUnit`）。🔴 `gate-inspector` は無い。
 * `Record<AiUnitMetric, …>` にしているため、単位が増えたら写像の書き忘れがコンパイルで落ちる。
 */
export const AI_UNIT_KEYS = {
  AI_UNIT_SHEET_PARSE: 'sheetParse',
  AI_UNIT_MATCH_RATIONALE: 'matchRationale',
  AI_UNIT_PROPOSAL_DRAFT: 'proposalDraft',
  AI_UNIT_RENEWAL_SUMMARY: 'renewalSummary',
} as const satisfies Readonly<Record<AiUnitMetric, string>>;

export type AiUnitKey = (typeof AI_UNIT_KEYS)[AiUnitMetric];

/**
 * 🔴 AI の 1 日上限に到達したときに止まる機能（docs/05 §5.8「`stoppedFeatures` に `'reviewGate'` を含める」）。
 *    Phase 1 の AI 機能は品質ゲートだけである。Phase 2 で `sheetParse` 等が加わる。
 */
export const AI_STOPPED_FEATURES = ['reviewGate'] as const;

export type AiStoppedFeature = (typeof AI_STOPPED_FEATURES)[number];

export type AiUnitUsageView = {
  readonly used: number;
  readonly quota: number;
  readonly remaining: number;
  readonly overageCount: number;
  readonly level: UsageLimitLevel;
  /** 🔴 超過しても停止しない（従量へ移行）。 */
  readonly onExceed: 'METERED';
};

export type AiDailyStopView =
  | { readonly stopped: false }
  | {
      readonly stopped: true;
      readonly reasonKey: 'quota.aiDaily';
      /** 停止に入った時刻（ISO 8601）。 */
      readonly since: string;
      /** 再開時刻（JST の翌 0 時。ISO 8601）。🔴 ホスト向けの応答にだけ載る（#70 には無い）。 */
      readonly resetAt: string;
      readonly stoppedFeatures: readonly AiStoppedFeature[];
    };

/** docs/05 §5.8 `UsageView`。🔴 金額の項目は `overageEstimateJpy`（請求見込み）だけ。 */
export type UsageView = {
  readonly asOf: string;
  /** 接近の閾値（%）。表示側が「80% に達しています」を組み立てるために使う。 */
  readonly warnPercent: number;
  readonly aiUnits: Readonly<Record<AiUnitKey, AiUnitUsageView>>;
  readonly aiDailyStop: AiDailyStopView;
  /** 🔴 唯一の金額（円。請求見込み）。契約条件が読めない Phase 1 は `null`（算出できない。0 と偽らない）。 */
  readonly overageEstimateJpy: string | null;
  readonly storage: {
    readonly usedBytes: string;
    readonly limitBytes: string;
    readonly level: UsageLimitLevel;
    /** 🔴 超過でアップロードが止まる（従量へ移行しない）。 */
    readonly onExceed: 'STOP_UPLOAD';
  };
  readonly email: {
    readonly usedToday: number;
    readonly dailyLimit: number;
    readonly usedLastMinute: number;
    readonly minuteLimit: number;
    readonly level: UsageLimitLevel;
    /** 🔴 分次超過は待機（`DEFER`）、日次超過は停止（`BLOCK`）。`decideEmailRate` の区別をそのまま返す。 */
    readonly state: 'ALLOW' | 'DEFER' | 'BLOCK';
    readonly onExceed: 'STOP_DAILY_DEFER_MINUTE';
  };
  readonly seats: {
    readonly used: number;
    /** プランが読めない Phase 1 は `null`（席数上限による招待の制限は未実装）。 */
    readonly limit: number | null;
  };
};

/**
 * 🔴 #70 の応答（docs/05 §6.7 #70 `{ blocked, reasonKey }`）。**全ロール**向け。
 *    残量・上限値・リセット時刻・停止に入った時刻を**型として持たない**（`F-027 AC-1`。パートナーには
 *    停止の事実と理由だけ）。
 */
export type BlockedNoticeView =
  | { readonly blocked: false; readonly reasonKey: null }
  | { readonly blocked: true; readonly reasonKey: 'quota.aiDaily' };

/** 🔴 #70 は**全ロール**（`TENANT_ROLES` そのもの）。`PARTNER_VIEWER`（T-16-12）が増えても自動的に含まれる。 */
export const BLOCKED_NOTICE_ROLES = TENANT_ROLES;

// 🔴 `reasonKey` が i18n のキーとして実在することを型で固定する（文言の置き場所は `packages/i18n` だけ）。
const REASON_KEY_AI_DAILY: MessageKey = 'quota.aiDaily';
void REASON_KEY_AI_DAILY;

/**
 * `GET /api/usage`（#69）。🔴 ホストロールのみ（`requireHost`。ルートの `requireRole` と二重）。
 */
export async function readUsageView(ctx: AuthenticatedTenantCtx, now: Date): Promise<UsageView> {
  requireHost(ctx);
  const limits = usageLimitsRuntime();
  const [snapshot, aiStop] = await Promise.all([readTenantUsageSnapshot(ctx, now), readAiStopNotice(ctx, now)]);

  const aiUnits = {} as Record<AiUnitKey, AiUnitUsageView>;
  for (const metric of AI_UNIT_METRICS) {
    const used = snapshot.aiUnits[metric];
    const quota = limits.aiUnitQuotas[metric];
    const decision = decideAiUnitQuota({ metric, monthCount: used, quota });
    const { level } = assessAiUnitLimit({ metric, used, quota, warnPercent: limits.warnPercent });
    aiUnits[AI_UNIT_KEYS[metric]] = {
      used,
      quota,
      remaining: decision.kind === 'ALLOW' ? decision.remaining : 0,
      overageCount: decision.kind === 'ALLOW_OVERAGE' ? decision.overageCount : 0,
      level,
      onExceed: 'METERED',
    };
  }

  const emailDecision = decideEmailRate({
    dailyLimit: limits.emailDailyLimit,
    dailySent: snapshot.emailToday,
    minuteLimit: limits.emailMinuteLimit,
    minuteSent: snapshot.emailLastMinute,
    // 🔴 表示用。`retryAfterSec` は使わないため最古の時刻は要らない（判定は日次 → 分次の順で変わらない）。
    minuteWindowOldestAt: null,
    now,
  });

  return {
    asOf: now.toISOString(),
    warnPercent: limits.warnPercent,
    aiUnits,
    aiDailyStop: aiStop.stopped
      ? {
          stopped: true,
          reasonKey: 'quota.aiDaily',
          since: aiStop.since.toISOString(),
          resetAt: aiStop.resetAt.toISOString(),
          stoppedFeatures: AI_STOPPED_FEATURES,
        }
      : { stopped: false },
    overageEstimateJpy: null,
    storage: {
      usedBytes: snapshot.storageBytes.toString(),
      limitBytes: limits.storageLimitBytes.toString(),
      level: assessStorageLimit({
        usedBytes: snapshot.storageBytes,
        limitBytes: limits.storageLimitBytes,
        warnPercent: limits.warnPercent,
      }).level,
      onExceed: 'STOP_UPLOAD',
    },
    email: {
      usedToday: snapshot.emailToday,
      dailyLimit: limits.emailDailyLimit,
      usedLastMinute: snapshot.emailLastMinute,
      minuteLimit: limits.emailMinuteLimit,
      level: assessEmailDailyLimit({
        usedToday: snapshot.emailToday,
        dailyLimit: limits.emailDailyLimit,
        warnPercent: limits.warnPercent,
      }).level,
      state: emailDecision.kind,
      onExceed: 'STOP_DAILY_DEFER_MINUTE',
    },
    seats: { used: snapshot.seatsUsed, limit: null },
  };
}

/**
 * `GET /api/usage/blocked-notice`（#70）。全ロール。
 * 🔴 パートナー文脈では RLS が「AI が停止中」の行しか通さない（`readAiStopNotice`）。返すのは事実と理由だけ。
 */
export async function readBlockedNotice(ctx: AuthenticatedTenantCtx, now: Date): Promise<BlockedNoticeView> {
  const notice = await readAiStopNotice(ctx, now);
  return notice.stopped ? { blocked: true, reasonKey: 'quota.aiDaily' } : { blocked: false, reasonKey: null };
}
