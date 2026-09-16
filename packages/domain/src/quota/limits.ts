// packages/domain/src/quota/limits.ts
// 🔴 上限の **3 種の区別**（docs/02 `F-027` 処理①〜⑤ / 章 7.5「組織ごとの上限と超過時の挙動」/
//    docs/03 §7.6.3-4 / docs/04 §S-038「単位と挙動が違うものを同じ見た目にしない」）。T-10-03。
//
// ============================================================================
// 🔴 同じ「到達」でも、起きることが 3 通りある。同じ判定・同じ表示に畳まない
// ============================================================================
//   ① AI の 1 日コスト上限（`AI_COST_USD`。日単位）…… **停止する**（`gate-inspector` も止まる = HELD）
//   ② AI の月次件数クォータ（`AI_UNIT_*`。月単位）…… **停止せず従量課金へ移行する**
//   ③ ストレージ（`STORAGE_BYTES`。累積）…………………… **アップロードが止まる**（従量へ移行しない）
//   （メールの日次上限 `EMAIL_COUNT` は停止、分次は待機。`decideEmailRate` が区別する）
// 判定式そのものは既存の 1 実装（`decideAiDailyCost` / `decideAiUnitQuota` / `decideEmailRate` /
// `decideStorageUpload`）が持ち、本ファイルは「**いま何が起きているか**」を水準（`UsageLimitLevel`）と
// 効果（`UsageLimitEffect`）の対で並べる。表示（`S-038` / `#70`）・通知（80% / 到達）・監査
// （到達 / 解除）はすべてこの 1 つの評価結果から派生する。
//
// 🔴 金額（USD）の生値をここに入れない。`AI_COST_USD` の材料は「停止しているか」（予約と同じ
//    判定式の probe の結果）と、接近判定用の micro-USD（`bigint`）だけである。
//    評価結果（`UsageLimitAssessment`）にも金額は載らない —— `S-038` / `#70` はここから
//    組み立てるため、**金額が応答に混入する経路が構造的に無い**（`F-027 AC-6` / `BR-24`）。
import { AI_UNIT_METRICS, type AiUnitMetric } from '../ai/units.js';
import { decideAiUnitQuota } from './ai-unit.js';
import { decideLimitLevel, type UsageLimitLevel } from './limit-level.js';

/**
 * 🔴 上限を持つ計測（`usage_limit_states.metric` の CHECK 値集合。migration 20260920000000）。
 *    値は `UsageCounter.metric`（docs/05 §3.8）の部分集合であり、同じ文字列である
 *    （`SEAT_COUNT` / `ESIGN_REQUESTS` は上限の判定対象ではない）。
 */
export const USAGE_LIMIT_METRICS = [
  'AI_COST_USD',
  ...AI_UNIT_METRICS,
  'EMAIL_COUNT',
  'STORAGE_BYTES',
] as const;

export type UsageLimitMetric = (typeof USAGE_LIMIT_METRICS)[number];

/**
 * 🔴 到達したときに起きること（3 種の区別の本体）。
 *
 * - `STOP_AI` …………… AI 機能の停止（`gate-inspector` を含む）。翌 0 時（JST）に解ける
 * - `METERED` ………… 停止しない。超過分が従量課金になる
 * - `STOP_EMAIL_DAILY` … その日はメールを送れない（分次の待機とは別）
 * - `STOP_UPLOAD` …… アップロードが止まる。削除するか上限を上げるまで解けない
 */
export type UsageLimitEffect = 'STOP_AI' | 'METERED' | 'STOP_EMAIL_DAILY' | 'STOP_UPLOAD';

/** 🔴 `Record<UsageLimitMetric, …>`: 計測を足したら効果の宣言漏れがコンパイルで落ちる。 */
export const USAGE_LIMIT_EFFECT: Readonly<Record<UsageLimitMetric, UsageLimitEffect>> = {
  AI_COST_USD: 'STOP_AI',
  AI_UNIT_SHEET_PARSE: 'METERED',
  AI_UNIT_MATCH_RATIONALE: 'METERED',
  AI_UNIT_PROPOSAL_DRAFT: 'METERED',
  AI_UNIT_RENEWAL_SUMMARY: 'METERED',
  EMAIL_COUNT: 'STOP_EMAIL_DAILY',
  STORAGE_BYTES: 'STOP_UPLOAD',
};

/**
 * 🔴 テナント管理者へ通知する水準（`F-027 AC-4` / 処理④）。
 *
 * `AI_COST_USD` は **到達（停止）だけ**を通知し、接近（80%）は通知しない —— 利用者には
 * この上限のメーターを見せない（docs/04 §S-038「遮断器。メーターもゲージも置かない」）ため、
 * 「何の 80% か」を利用者が確かめる手段が無い。接近は運営者の監視（`F-057`）にだけ現れる
 * （`usage_limit_states` の行は `app_platform` から読める）。
 * それ以外（件数 4 単位 / メール / ストレージ）は接近・到達の両方を通知する。
 */
export const TENANT_NOTICE_LEVELS: Readonly<Record<UsageLimitMetric, readonly UsageLimitLevel[]>> = {
  AI_COST_USD: ['REACHED'],
  AI_UNIT_SHEET_PARSE: ['NEARING', 'REACHED'],
  AI_UNIT_MATCH_RATIONALE: ['NEARING', 'REACHED'],
  AI_UNIT_PROPOSAL_DRAFT: ['NEARING', 'REACHED'],
  AI_UNIT_RENEWAL_SUMMARY: ['NEARING', 'REACHED'],
  EMAIL_COUNT: ['NEARING', 'REACHED'],
  STORAGE_BYTES: ['NEARING', 'REACHED'],
};

export function shouldNotifyTenant(metric: UsageLimitMetric, level: UsageLimitLevel): boolean {
  return TENANT_NOTICE_LEVELS[metric].includes(level);
}

export type UsageLimitAssessmentInput = {
  /** `QUOTA_WARNING_THRESHOLD_PERCENT`（既定 80）。 */
  readonly warnPercent: number;
  /**
   * AI の 1 日コスト上限。
   * - `stopped`: 🔴 **予約と同じ判定式（`probeAiCostHeadroom`）で「1 回ぶんの見積りが通らない」**こと。
   *   これが停止の定義である（`gate.hold-release` が復帰させない状態と一致する）。
   * - `consumedMicros` / `limitMicros`: 接近（80%）の判定に使う micro-USD。`used + reserved` を渡す
   *   （呼び出し中の予約を含めないと、並行呼び出し中に「まだ余裕がある」と見える）。
   */
  readonly aiDailyCost: {
    readonly stopped: boolean;
    readonly consumedMicros: bigint;
    readonly limitMicros: bigint;
  };
  /** 4 単位の当月消費とクォータ。 */
  readonly aiUnits: Readonly<Record<AiUnitMetric, { readonly used: number; readonly quota: number }>>;
  readonly email: { readonly usedToday: number; readonly dailyLimit: number };
  readonly storage: { readonly usedBytes: bigint; readonly limitBytes: bigint };
};

export type UsageLimitState = {
  readonly level: UsageLimitLevel;
  readonly effect: UsageLimitEffect;
};

export type UsageLimitAssessment = Readonly<Record<UsageLimitMetric, UsageLimitState>>;

/**
 * ① AI の 1 日コスト上限: `stopped` なら `REACHED`。そうでなければ接近判定のみ（`REACHED` を比率から
 *    導かない —— 停止の定義は probe の 1 つだけである。比率が 100% 以上なら probe も必ず BLOCK になる）。
 */
export function assessAiDailyCostLimit(input: {
  readonly stopped: boolean;
  readonly consumedMicros: bigint;
  readonly limitMicros: bigint;
  readonly warnPercent: number;
}): UsageLimitState {
  const ratioLevel = decideLimitLevel({
    used: input.consumedMicros,
    limit: input.limitMicros,
    warnPercent: input.warnPercent,
  });
  const level: UsageLimitLevel = input.stopped ? 'REACHED' : ratioLevel === 'BELOW' ? 'BELOW' : 'NEARING';
  return { level, effect: USAGE_LIMIT_EFFECT.AI_COST_USD };
}

/** ② AI の月次件数: `decideAiUnitQuota` が `ALLOW_OVERAGE` なら `REACHED`（従量へ移行した。停止しない）。 */
export function assessAiUnitLimit(input: {
  readonly metric: AiUnitMetric;
  readonly used: number;
  readonly quota: number;
  readonly warnPercent: number;
}): UsageLimitState {
  const decision = decideAiUnitQuota({ metric: input.metric, monthCount: input.used, quota: input.quota });
  const level: UsageLimitLevel =
    decision.kind === 'ALLOW_OVERAGE'
      ? 'REACHED'
      : decideLimitLevel({ used: BigInt(input.used), limit: BigInt(input.quota), warnPercent: input.warnPercent });
  return { level, effect: USAGE_LIMIT_EFFECT[input.metric] };
}

/** メール（日次）: `usedToday >= dailyLimit` で `REACHED`（`decideEmailRate` の BLOCK と同じ境界）。 */
export function assessEmailDailyLimit(input: {
  readonly usedToday: number;
  readonly dailyLimit: number;
  readonly warnPercent: number;
}): UsageLimitState {
  return {
    level: decideLimitLevel({
      used: BigInt(input.usedToday),
      limit: BigInt(input.dailyLimit),
      warnPercent: input.warnPercent,
    }),
    effect: USAGE_LIMIT_EFFECT.EMAIL_COUNT,
  };
}

/** ③ ストレージ: `usedBytes >= limitBytes` で `REACHED`（1 バイトも置けない = `decideStorageUpload` の BLOCK）。 */
export function assessStorageLimit(input: {
  readonly usedBytes: bigint;
  readonly limitBytes: bigint;
  readonly warnPercent: number;
}): UsageLimitState {
  return {
    level: decideLimitLevel({ used: input.usedBytes, limit: input.limitBytes, warnPercent: input.warnPercent }),
    effect: USAGE_LIMIT_EFFECT.STORAGE_BYTES,
  };
}

/**
 * 🔴 3 種の上限をまとめて評価する（純粋関数）。ワーカー（`usage.limit-check`）が使う。
 *    主平面（`S-038` #69）は上の種類別の関数を同じ材料で呼ぶ（判定が 2 実装にならない）。
 */
export function assessUsageLimits(input: UsageLimitAssessmentInput): UsageLimitAssessment {
  const warnPercent = input.warnPercent;

  const unitLevels = {} as Record<AiUnitMetric, UsageLimitState>;
  for (const metric of AI_UNIT_METRICS) {
    const { used, quota } = input.aiUnits[metric];
    unitLevels[metric] = assessAiUnitLimit({ metric, used, quota, warnPercent });
  }

  return {
    AI_COST_USD: assessAiDailyCostLimit({ ...input.aiDailyCost, warnPercent }),
    ...unitLevels,
    EMAIL_COUNT: assessEmailDailyLimit({ ...input.email, warnPercent }),
    STORAGE_BYTES: assessStorageLimit({ ...input.storage, warnPercent }),
  };
}
