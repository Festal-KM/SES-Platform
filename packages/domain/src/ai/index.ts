// packages/domain/src/ai/index.ts
// AI 層が共有する値集合（docs/05 §7.1 / §3.8）と、記録側が使う純粋関数（docs/05 §7.11。T-07-03）。
//
// 🔴 T-07-03 で 2 つの表がここに加わった。どちらも「実行する側（`packages/ai`）と記録する側
//    （`packages/db`）の共有点は domain しか無い」という §7.9 ⑤ と同じ理由による:
//      - `pricing.ts` … 単価表と推定コスト（記録と、呼び出し前の予約（T-07-04）が同じ表を見る）
//      - `units.ts`   … 利用者に見せる「1 件」の定義（🔴 単価を一切参照しない。`F-026 AC-6`）
export {
  AI_MODEL_PRICING,
  estimateAiCostUsd,
  resolveAiModelPrice,
  UnknownAiModelPriceError,
  type AiModelPrice,
  type AiTokenCounts,
} from './pricing.js';
export {
  AI_UNIT_METRICS,
  MATCH_EXPLAINER_RATIONALES_FIELD,
  resolveAiUnitCount,
  ROLE_UNIT,
  type AiUnitCount,
  type AiUnitCountKind,
  type AiUnitDefinition,
  type AiUnitMetric,
} from './units.js';
export {
  AI_ROLES,
  AI_USAGE_FAILURE_KINDS,
  AI_USAGE_PURPOSES,
  APPROVAL_MODE_CONFIGURABLE_ROLES,
  isAiRole,
  ROLE_PURPOSE,
  type AiRole,
  type AiUsageFailureKind,
  type AiUsagePurpose,
  type ApprovalModeConfigurableRole,
} from './roles.js';
