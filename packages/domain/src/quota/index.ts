// packages/domain/src/quota/index.ts
// 上限判定の純粋関数（docs/05 §8.7 / §8.3-Q）。
// 🔴 `decideProviderQuota`（送信基盤全体の 24h 枠。docs/05 §8.3-Q）は T-04-04 が
//    `provider.ts` として同じディレクトリに置いた。**2 実装にしない** ——
//    `send.*`（`Proposal` / `Contract`）側の `PROVIDER_QUOTA` 保留（SP-09 T-09-06）も
//    ここを再利用する（SP-04 完了判定 8-③）。
// 🔴 T-07-04: テナントの 1 日の AI コスト上限（docs/05 §7.6 / `F-027`）。**遮断器**であり、
//    メール（待機あり）ともストレージ（時間で解けない）とも挙動が違うため別の関数にする。
export {
  decideAiDailyCost,
  type AiDailyCostDecision,
  type AiDailyCostInput,
} from './ai-cost.js';
export {
  decideEmailRate,
  EMAIL_MINUTE_WINDOW_MS,
  type EmailRateDecision,
  type EmailRateInput,
} from './email-rate.js';
export {
  decideProviderQuota,
  isProviderQuotaWarning,
  providerQuotaUsage,
  type ProviderQuotaDecision,
  type ProviderQuotaInput,
  type ProviderQuotaObservation,
  type ProviderQuotaUsage,
} from './provider.js';
// 🔴 T-05-04: ストレージ上限（docs/05 §8.7 / §14.2 / docs/03 §4.5）。**メールと同じ形に畳まない**
//    （超過が時間で解消しないため、`DEFER` を持たない）。
export {
  decideStorageUpload,
  type StorageQuotaDecision,
  type StorageQuotaInput,
} from './storage.js';
// 🔴 T-10-03: 上限到達の判定と 3 種の区別（docs/02 `F-027` / 章 7.5 / docs/03 §7.6.3-4）。
//    - `decideAiUnitQuota` … 月次の件数クォータ。**`BLOCK` を持たない**（超過は従量へ移行）
//    - `decideLimitLevel` / `decideLimitTransition` … 接近（80%）・到達・解除の水準と遷移
//    - `assessUsageLimits` … 3 種をまとめて評価する唯一の形（表示・通知・監査の共通の出所）
export {
  decideAiUnitQuota,
  type AiUnitQuotaDecision,
  type AiUnitQuotaInput,
} from './ai-unit.js';
export {
  decideLimitLevel,
  decideLimitTransition,
  USAGE_LIMIT_LEVELS,
  type LimitLevelInput,
  type LimitLevelTransition,
  type UsageLimitLevel,
} from './limit-level.js';
export {
  assessAiDailyCostLimit,
  assessAiUnitLimit,
  assessEmailDailyLimit,
  assessStorageLimit,
  assessUsageLimits,
  shouldNotifyTenant,
  TENANT_NOTICE_LEVELS,
  USAGE_LIMIT_EFFECT,
  USAGE_LIMIT_METRICS,
  type UsageLimitAssessment,
  type UsageLimitAssessmentInput,
  type UsageLimitEffect,
  type UsageLimitMetric,
  type UsageLimitState,
} from './limits.js';
// 🔴 T-11-02: テナント個別のクォータ上書き（docs/02 `F-057` / docs/05 §6.9 API-A6）。
//    - `resolveQuotaLimit` … 既定値と上書き行から「効いている上限」を解く（ワーカー・主平面・運営者で 1 実装）
//    - `decideQuotaChange` … 🔴 引き下げは翌日以降 + 通知が必須（即時反映のみの操作は型として返らない）
//    - `classifyConsumptionBand` … `A-004` の抽出（消化率が常に低い / 上限に張り付く）
export {
  classifyConsumptionBand,
  CONSUMPTION_BANDS,
  consumptionPercent,
  decideQuotaChange,
  isQuotaOverrideMetric,
  QUOTA_CHANGE_REJECTIONS,
  QUOTA_LOW_CONSUMPTION_PERCENT,
  QUOTA_OVERRIDE_METRICS,
  QuotaChangeRejectedError,
  resolveQuotaLimit,
  selectEffectiveQuotaOverride,
  selectPendingQuotaOverride,
  type ConsumptionBand,
  type QuotaChangeDecision,
  type QuotaChangeInput,
  type QuotaChangeKind,
  type QuotaChangeRejection,
  type QuotaOverrideMetric,
  type QuotaOverrideRow,
} from './override.js';
