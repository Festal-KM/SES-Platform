// packages/domain/src/index.ts
// 主平面 / ワーカーから使ってよいものだけを export する（docs/05 §2.1）。
export * from './state/index.js';
// 🔴 利用量の集計キー（docs/05 §3.8 / §9.8）。packages/db と packages/ai の**両方**が
//    同じ規則で `UsageCounter.periodKey` を作る必要があるため domain に置く（T-03-10）。
export {
  USAGE_PERIOD_TIME_ZONE,
  usagePeriodKey,
  type UsagePeriodKind,
} from './usage/period-key.js';
