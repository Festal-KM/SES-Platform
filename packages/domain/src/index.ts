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
// 🔴 宛先分類（docs/05 §8.2 / docs/02 章 7.6 NFR-ENV-1）。`packages/db`（分類する側）と
//    `packages/connectors`（`EmailSender.send` の必須引数として受け取る側）の**両方**が
//    同じ union を知る必要があり、両者の共有点は domain しか無い（T-04-02）。
export * from './recipient/index.js';
