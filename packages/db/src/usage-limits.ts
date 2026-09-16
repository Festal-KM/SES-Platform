// packages/db/src/usage-limits.ts
// 🔴 上限到達の判定材料の読み取りと、`usage_limit_states`（テナント × 計測の「いまの水準」）を書く
//    **唯一の経路**（docs/02 `F-027` 処理①〜⑤ / 章 7.5 / docs/05 §5.8 / §7.6 / §16.1 /
//    migration 20260920000000）。T-10-03。
//
// ============================================================================
// 🔴 このファイルが答えるのは 4 つである
// ============================================================================
//   ① `readTenantUsageSnapshot` … 件数 4 単位 / メール / ストレージ / 席数の**現在値**（金額を含まない）
//   ② `probeAiDailyCostLevel` ……… AI の 1 日コスト上限に対して **停止しているか**（予約と同じ判定式）と
//                                   接近判定用の micro-USD。🔴 金額はこの関数の外へ出ない
//   ③ `syncUsageLimitStates` …… 評価結果を表に書き、**水準が変わったときだけ** `AuditLog`（到達 / 解除）を
//                                   書いて、通知の契機（`toNotify`）を返す（メールの予約は呼び出し側 = ジョブ）
//   ④ `listUsageLimitStates` / `readAiStopNotice` … 主平面（#69 / #70）の読み取り。RLS が母集団を決める
//
// ============================================================================
// 🔴 金額（USD）を `apps/**` へ持ち出さない
// ============================================================================
// `readAiDailyCost` / `probeAiCostHeadroom` は本ファイルの中からだけ呼ぶ。②の戻り値は
// `stopped`（真偽）と micro-USD の `bigint` であり、ジョブはそれを `assessUsageLimits`（domain）に
// 渡すだけで金額を表示にも通知にも載せない（`F-027 AC-6` / `tests/static/auth-db-callers.test.ts` の
// `readAiDailyCost: []` を維持する）。
import { Prisma } from '@prisma/client';
import {
  AI_UNIT_METRICS,
  decideLimitTransition,
  parseUsdMicros,
  shouldNotifyTenant,
  USAGE_LIMIT_METRICS,
  usagePeriodKey,
  type AiUnitMetric,
  type UsageLimitAssessment,
  type UsageLimitEffect,
  type UsageLimitLevel,
  type UsageLimitMetric,
  type UsagePeriodKind,
} from '@ses/domain';
import { probeAiCostHeadroom, readAiDailyCost, type AiCostReserveInput } from './ai-cost-guard.js';
import { writeAuditLog } from './audit.js';
import type { AuthenticatedTenantCtx, HostTenantCtx, SystemTenantCtx } from './context.js';
import { readStorageBytesUsed } from './storage-usage.js';
import { usagePeriodResetAt } from './usage-period.js';
import { uuidV7 } from './uuid.js';
import { runInTenantTransaction, type TenantTransactionClient } from './with-tenant.js';

/** 分次ウィンドウ（docs/05 §8.7「分 = スライディング 60 秒」）。表示用の近似に使う。 */
const MINUTE_WINDOW_MS = 60_000;

/**
 * 🔴 到達 / 解除の監査ログの `action`（docs/05 §16.1。`F-027` 処理⑤「上限到達・停止・解除を監査ログに記録」）。
 *    接近（80%）は `usage.limit_nearing`。いずれも `actorKind='SYSTEM'`、`summary` は計測名・水準・期間・効果だけ
 *    （金額・件数の生値・PII を載せない。docs/05 §16.2）。
 */
export const USAGE_LIMIT_AUDIT_ACTIONS = {
  NEARING: 'usage.limit_nearing',
  REACHED: 'usage.limit_reached',
  RELEASED: 'usage.limit_released',
} as const;

/** 各計測のカウンタの期間（docs/05 §8.7）。ストレージは累積だが MONTH 行に持つ（§14.3）。 */
const METRIC_PERIOD_KIND: Readonly<Record<UsageLimitMetric, UsagePeriodKind>> = {
  AI_COST_USD: 'DAY',
  AI_UNIT_SHEET_PARSE: 'MONTH',
  AI_UNIT_MATCH_RATIONALE: 'MONTH',
  AI_UNIT_PROPOSAL_DRAFT: 'MONTH',
  AI_UNIT_RENEWAL_SUMMARY: 'MONTH',
  EMAIL_COUNT: 'DAY',
  STORAGE_BYTES: 'MONTH',
};

export function usageLimitPeriodKind(metric: UsageLimitMetric): UsagePeriodKind {
  return METRIC_PERIOD_KIND[metric];
}

// ---------------------------------------------------------------------------
// ① 現在値のスナップショット（金額を含まない）
// ---------------------------------------------------------------------------

export type TenantUsageSnapshot = {
  readonly dayKey: string;
  readonly monthKey: string;
  /** `UsageCounter(MONTH,'AI_UNIT_*')` の当月値（件数。無ければ 0）。 */
  readonly aiUnits: Readonly<Record<AiUnitMetric, number>>;
  /** `UsageCounter(DAY,'EMAIL_COUNT')` の当日値。 */
  readonly emailToday: number;
  /**
   * 直近 60 秒に **送信が確定した運用メール**（`email_dispatches.sent_at`）の数。
   * 🔴 分次ウィンドウの正はワーカーの `MinuteWindowCounter`（揮発。docs/05 §8.7）であり主平面から
   *    観測できないため、永続化された事実からの**表示用の近似**である（判定には使わない）。
   */
  readonly emailLastMinute: number;
  /** `UsageCounter(STORAGE_BYTES)` の現在値（`readStorageBytesUsed` と同じ 1 実装）。 */
  readonly storageBytes: bigint;
  /** `UsageCounter(DAY,'SEAT_COUNT')` の最新のスナップショット（`usage.seat-snapshot`。無ければ 0）。 */
  readonly seatsUsed: number;
};

type ValueRow = { readonly metric: string; readonly value: string };
type CountRow = { readonly count: bigint | number | string };

function toCount(value: string | bigint | number | undefined): number {
  if (value === undefined) return 0;
  const parsed = typeof value === 'string' ? Number(value) : Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new RangeError(`UsageCounter の件数が不正です（${String(value)}）。`);
  }
  return Math.trunc(parsed);
}

/**
 * 🔴 主平面（`S-038` #69）とワーカー（`usage.limit-check`）が**同じ 1 実装**で読む現在値。
 *
 * `HostTenantCtx` を要求する: 件数・メール・席数の行は C2 HOST_ONLY であり、パートナー文脈では
 * 0 行になる（読めたように見えて 0 が返る、を型で防ぐ）。
 */
export async function readTenantUsageSnapshot(ctx: HostTenantCtx, now: Date): Promise<TenantUsageSnapshot> {
  const dayKey = usagePeriodKey('DAY', now);
  const monthKey = usagePeriodKey('MONTH', now);
  const storageBytes = await readStorageBytesUsed(ctx, now);

  return runInTenantTransaction(
    { tenantId: ctx.tenantId, partnerCompanyId: null, actorUserId: ctx.userId },
    async (tx): Promise<TenantUsageSnapshot> => {
      const unitRows = await tx.$queryRaw<ValueRow[]>(Prisma.sql`
        SELECT metric, trunc(value)::text AS value
          FROM usage_counters
         WHERE tenant_id = ${ctx.tenantId}::uuid
           AND period_kind = 'MONTH'
           AND period_key = ${monthKey}
           AND metric IN (${Prisma.join([...AI_UNIT_METRICS])})`);
      const aiUnits = {} as Record<AiUnitMetric, number>;
      for (const metric of AI_UNIT_METRICS) {
        aiUnits[metric] = toCount(unitRows.find((row) => row.metric === metric)?.value);
      }

      const emailRows = await tx.$queryRaw<ValueRow[]>(Prisma.sql`
        SELECT metric, trunc(value)::text AS value
          FROM usage_counters
         WHERE tenant_id = ${ctx.tenantId}::uuid
           AND period_kind = 'DAY'
           AND period_key = ${dayKey}
           AND metric = 'EMAIL_COUNT'`);
      const emailToday = toCount(emailRows[0]?.value);

      const minuteRows = await tx.$queryRaw<CountRow[]>(Prisma.sql`
        SELECT count(*) AS count
          FROM email_dispatches
         WHERE tenant_id = ${ctx.tenantId}::uuid
           AND sent_at > ${new Date(now.getTime() - MINUTE_WINDOW_MS)}::timestamptz`);
      // 🔴 上限 `sent_at <= now` を置かない: DB と host の時計差（Docker VM で 0.15〜1.15 s を実測）で直近の
      //    行が弾かれ、表示用近似が実態より小さく出る（レビュー指摘）。この値は判定に使わず表示だけなので、
      //    未来の `sent_at` を除外する必要も無い。
      const emailLastMinute = toCount(minuteRows[0]?.count);

      const seatRows = await tx.$queryRaw<ValueRow[]>(Prisma.sql`
        SELECT metric, trunc(value)::text AS value
          FROM usage_counters
         WHERE tenant_id = ${ctx.tenantId}::uuid
           AND period_kind = 'DAY'
           AND metric = 'SEAT_COUNT'
           AND period_key <= ${dayKey}
         ORDER BY period_key DESC
         LIMIT 1`);
      const seatsUsed = toCount(seatRows[0]?.value);

      return { dayKey, monthKey, aiUnits, emailToday, emailLastMinute, storageBytes, seatsUsed };
    },
  );
}

// ---------------------------------------------------------------------------
// ② AI の 1 日コスト上限に対する水準の材料（金額はここに閉じる）
// ---------------------------------------------------------------------------

export type AiDailyCostLevelProbe = {
  /** 🔴 予約と同じ判定式で「1 回ぶんの見積りが通らない」＝ 停止中（`gate.hold-release` が復帰させない状態）。 */
  readonly stopped: boolean;
  /** `used + reserved`（micro-USD）。接近（80%）の判定にだけ使う。 */
  readonly consumedMicros: bigint;
  readonly limitMicros: bigint;
  readonly periodKey: string;
  /** JST の翌 0 時（停止表示に出す唯一の時刻。`F-027 AC-6`）。 */
  readonly resetAt: Date;
};

/**
 * 🔴 `usage.limit-check` が AI の停止を判定するための材料を読む。
 *
 * `probeAiCostHeadroom`（書き込まない空撃ち）と `readAiDailyCost` を**このファイルの中で**組み合わせ、
 * 金額を `apps/worker` に返さない。見積り（`gate-inspector` 1 回ぶんの下限）と上限はジョブが
 * `gate.hold-release` と同じ出所から渡す（`AiCostReserveInput` をそのまま受ける）。
 */
export async function probeAiDailyCostLevel(
  ctx: HostTenantCtx,
  input: AiCostReserveInput,
): Promise<AiDailyCostLevelProbe> {
  const headroom = await probeAiCostHeadroom(ctx, input);
  const current = await readAiDailyCost(ctx, input.now);
  return {
    stopped: headroom.kind === 'BLOCK',
    consumedMicros: parseUsdMicros(current.usedUsd) + parseUsdMicros(current.reservedUsd),
    limitMicros: parseUsdMicros(input.limitUsd),
    periodKey: current.periodKey,
    resetAt: current.resetAt,
  };
}

// ---------------------------------------------------------------------------
// ③ 水準の同期（表 + 監査ログ）
// ---------------------------------------------------------------------------

/** `usage_limit_states` の 1 行。🔴 金額の列は無い。 */
export type UsageLimitStateRow = {
  readonly metric: UsageLimitMetric;
  readonly level: UsageLimitLevel;
  readonly levelSince: Date;
  readonly periodKind: UsagePeriodKind;
  readonly periodKey: string;
  readonly notifiedLevel: UsageLimitLevel | null;
  readonly notifiedOn: string | null;
  readonly evaluatedAt: Date;
};

/** 通知の契機（呼び出し側 = ジョブが `EmailDispatch` を予約する）。 */
export type UsageLimitNotice = {
  readonly metric: UsageLimitMetric;
  readonly level: Exclude<UsageLimitLevel, 'BELOW'>;
  readonly effect: UsageLimitEffect;
  /** 通知した暦日（`dedupeKey` の一部。同じ日・同じ水準で 2 通目を作らない）。 */
  readonly dayKey: string;
};

export type UsageLimitSyncOutcome = {
  /** 今回の実行で水準が変わった計測の数。 */
  readonly changed: number;
  /** 🔴 テナント管理者への通知の契機（`shouldNotifyTenant` を満たし、その日その水準で未通知のもの）。 */
  readonly toNotify: readonly UsageLimitNotice[];
  /** 書いた監査ログの件数（到達 / 接近 / 解除）。 */
  readonly audited: number;
};

type StateRow = {
  readonly metric: string;
  readonly level: string;
  readonly level_since: Date;
  readonly period_kind: string;
  readonly period_key: string;
  readonly notified_level: string | null;
  readonly notified_on: string | null;
  readonly evaluated_at: Date;
};

function isUsageLimitMetric(value: string): value is UsageLimitMetric {
  return (USAGE_LIMIT_METRICS as readonly string[]).includes(value);
}

function isUsageLimitLevel(value: string): value is UsageLimitLevel {
  return value === 'BELOW' || value === 'NEARING' || value === 'REACHED';
}

function toStateRow(row: StateRow): UsageLimitStateRow {
  if (!isUsageLimitMetric(row.metric) || !isUsageLimitLevel(row.level)) {
    // 値集合の外の値が保存されている ＝ CHECK の前提が壊れている。握り潰さない。
    throw new Error(`usage_limit_states に未知の値があります（metric=${row.metric}, level=${row.level}）。`);
  }
  if (row.period_kind !== 'DAY' && row.period_kind !== 'MONTH') {
    throw new Error(`usage_limit_states に未知の period_kind があります（${row.period_kind}）。`);
  }
  const notifiedLevel = row.notified_level;
  if (notifiedLevel !== null && !isUsageLimitLevel(notifiedLevel)) {
    throw new Error(`usage_limit_states に未知の notified_level があります（${notifiedLevel}）。`);
  }
  return {
    metric: row.metric,
    level: row.level,
    levelSince: row.level_since,
    periodKind: row.period_kind,
    periodKey: row.period_key,
    notifiedLevel,
    notifiedOn: row.notified_on,
    evaluatedAt: row.evaluated_at,
  };
}

async function selectStates(tx: TenantTransactionClient, tenantId: string): Promise<UsageLimitStateRow[]> {
  const rows = await tx.$queryRaw<StateRow[]>(Prisma.sql`
    SELECT metric, level, level_since, period_kind, period_key, notified_level, notified_on, evaluated_at
      FROM usage_limit_states
     WHERE tenant_id = ${tenantId}::uuid
     ORDER BY metric ASC`);
  return rows.map(toStateRow);
}

export type UsageLimitSyncInput = {
  readonly now: Date;
  /** `assessUsageLimits`（domain）の結果。 */
  readonly assessment: UsageLimitAssessment;
  /** 評価に使ったカウンタの期間キー（`readTenantUsageSnapshot` / `probeAiDailyCostLevel` の値）。 */
  readonly periodKeys: { readonly dayKey: string; readonly monthKey: string };
};

/**
 * 🔴 評価結果を `usage_limit_states` に反映し、**水準が変わった計測だけ**に監査ログを書く（`F-027` 処理⑤）。
 *
 * 1 トランザクションで行う（表の更新と記録が食い違わない）。監査は `actorKind='SYSTEM'`、
 * `summary` は `{ metric, from, to, periodKey, effect, job }` だけ（docs/05 §16.1 / §16.2）。
 *
 * 🔴 「1 日 1 回」: 上がった遷移（接近 / 到達）は `notified_on` がその日でなければ記録・通知する。
 *    同じ日に同じ水準へ戻っても（ストレージの削除 → 再アップロード）2 回目は出さない。
 *    解除（`REACHED → それ未満`）は水準が変わるたびに記録する（到達が 2 回起きたなら解除も 2 回である）。
 *
 * 🔴 `SystemTenantCtx` を要求する: 書き手はジョブだけである（`apps/web` はこの関数を呼べない）。
 */
export async function syncUsageLimitStates(
  ctx: SystemTenantCtx,
  input: UsageLimitSyncInput,
): Promise<UsageLimitSyncOutcome> {
  const today = usagePeriodKey('DAY', input.now);
  return runInTenantTransaction(
    { tenantId: ctx.tenantId, partnerCompanyId: null, actorUserId: ctx.userId },
    async (tx): Promise<UsageLimitSyncOutcome> => {
      const existing = new Map((await selectStates(tx, ctx.tenantId)).map((row) => [row.metric, row]));
      const toNotify: UsageLimitNotice[] = [];
      let changed = 0;
      let audited = 0;

      for (const metric of USAGE_LIMIT_METRICS) {
        const { level, effect } = input.assessment[metric];
        const periodKind = METRIC_PERIOD_KIND[metric];
        const periodKey = periodKind === 'DAY' ? input.periodKeys.dayKey : input.periodKeys.monthKey;
        const previous = existing.get(metric) ?? null;
        const transition = decideLimitTransition(previous?.level ?? null, level);

        let notifiedLevel = previous?.notifiedLevel ?? null;
        let notifiedOn = previous?.notifiedOn ?? null;
        let auditAction: string | null = null;

        if (transition === 'RAISED' && level !== 'BELOW') {
          const alreadyToday = notifiedLevel === level && notifiedOn === today;
          if (!alreadyToday) {
            auditAction = level === 'REACHED' ? USAGE_LIMIT_AUDIT_ACTIONS.REACHED : USAGE_LIMIT_AUDIT_ACTIONS.NEARING;
            notifiedLevel = level;
            notifiedOn = today;
            if (shouldNotifyTenant(metric, level)) toNotify.push({ metric, level, effect, dayKey: today });
          }
        } else if (transition === 'RELEASED') {
          auditAction = USAGE_LIMIT_AUDIT_ACTIONS.RELEASED;
        }

        const levelSince = transition === 'UNCHANGED' && previous !== null ? previous.levelSince : input.now;
        const id = uuidV7(input.now);
        const written = await tx.$executeRaw(Prisma.sql`
          INSERT INTO usage_limit_states
            (id, tenant_id, metric, level, level_since, period_kind, period_key,
             notified_level, notified_on, evaluated_at)
          VALUES
            (${id}::uuid, ${ctx.tenantId}::uuid, ${metric}, ${level}, ${levelSince}::timestamptz,
             ${periodKind}, ${periodKey}, ${notifiedLevel}, ${notifiedOn}, ${input.now}::timestamptz)
          ON CONFLICT (tenant_id, metric) DO UPDATE
            SET level = EXCLUDED.level,
                level_since = EXCLUDED.level_since,
                period_kind = EXCLUDED.period_kind,
                period_key = EXCLUDED.period_key,
                notified_level = EXCLUDED.notified_level,
                notified_on = EXCLUDED.notified_on,
                evaluated_at = EXCLUDED.evaluated_at`);
        if (written !== 1) {
          // 🔴 RLS で 0 行になった（ジョブ文脈でなければここへ来る）。**黙って続けない**。
          throw new Error(`usage_limit_states を書き込めませんでした（metric=${metric}）。`);
        }
        if (transition !== 'UNCHANGED') changed += 1;

        if (auditAction !== null) {
          await writeAuditLog(tx, {
            action: auditAction,
            actorKind: 'SYSTEM',
            actorId: null,
            targetType: 'Tenant',
            targetId: ctx.tenantId,
            summary: {
              metric,
              from: previous?.level ?? 'BELOW',
              to: level,
              periodKind,
              periodKey,
              effect,
              job: ctx.job.queue,
            },
            deviceKind: ctx.deviceKind,
          });
          audited += 1;
        }
      }

      return { changed, toNotify, audited };
    },
  );
}

// ---------------------------------------------------------------------------
// ④ 主平面の読み取り（RLS が母集団を決める）
// ---------------------------------------------------------------------------

/**
 * 自テナントの水準（ホストロール向け。`S-038` #69）。
 * 🔴 パートナー文脈で呼ぶと RLS により「AI が停止中」の行しか返らない（`readAiStopNotice` を使うこと）。
 */
export async function listUsageLimitStates(ctx: HostTenantCtx): Promise<readonly UsageLimitStateRow[]> {
  return runInTenantTransaction(
    { tenantId: ctx.tenantId, partnerCompanyId: ctx.partnerCompanyId, actorUserId: ctx.userId },
    (tx) => selectStates(tx, ctx.tenantId),
  );
}

export type AiStopNotice =
  | { readonly stopped: false }
  | { readonly stopped: true; readonly since: Date; readonly resetAt: Date };

/**
 * 🔴 「AI が停止しているか」（`#70` / `F-027 AC-1`）。**全ロール**で呼べる。
 *
 * パートナー文脈では RLS（migration 20260920000000）が `metric='AI_COST_USD' AND level='REACHED'` の行だけを
 * 通す ＝ 停止していないときは 0 行であり、接近や他の上限の存在は読めない（`BR-04` の第二境界）。
 * 🔴 `resetAt` はホスト向けの表示（#69）だけが使う。#70 の応答には載せない（`F-027 AC-1`
 *    「リセット時刻はパートナーに表示しない」）—— 載せないのは API 層の型で担保する。
 */
export async function readAiStopNotice(ctx: AuthenticatedTenantCtx, now: Date): Promise<AiStopNotice> {
  return runInTenantTransaction(
    { tenantId: ctx.tenantId, partnerCompanyId: ctx.partnerCompanyId, actorUserId: ctx.userId },
    async (tx): Promise<AiStopNotice> => {
      const rows = await tx.$queryRaw<StateRow[]>(Prisma.sql`
        SELECT metric, level, level_since, period_kind, period_key, notified_level, notified_on, evaluated_at
          FROM usage_limit_states
         WHERE tenant_id = ${ctx.tenantId}::uuid
           AND metric = 'AI_COST_USD'
           AND level = 'REACHED'`);
      const row = rows[0];
      if (row === undefined) return { stopped: false };
      const state = toStateRow(row);
      // 🔴 日が変わればカウンタは新しい行になり停止は解けている。ジョブの次回評価（最大 10 分）を
      //    待たずに「解けた」と示す（期間キーが今日でなければ停止中と表示しない）。
      if (state.periodKey !== usagePeriodKey('DAY', now)) return { stopped: false };
      return { stopped: true, since: state.levelSince, resetAt: usagePeriodResetAt('DAY', now) };
    },
  );
}
