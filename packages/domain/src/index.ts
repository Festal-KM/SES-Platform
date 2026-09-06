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
// 🔴 T-04-03: テナント単位のメール送信上限（docs/05 §8.7 / `F-027 AC-2`）。
//    日次超過 = 停止 / 分次超過 = 待機 の区別を、判定する側（ジョブ）と表示する側（SP-10）が
//    同じ 1 つの関数から得る。
export * from './quota/index.js';
// 🔴 T-05-01: ① 集める の値集合（都道府県コード）。台帳の入力（`S-007`）・検索（`F-009`）・
//    案件（`F-013`）・匿名候補（`F-017`）が同じ表を指す必要があるため domain に置く。
export * from './ledger/index.js';
// 🔴 T-05-04: オブジェクトキーの規約（docs/05 §14.1）。キーを組み立てる側（`apps/web`）と
//    署名する側（`packages/connectors`）が**同じ 1 つの規約**を見る必要があるため domain に置く。
export * from './storage/index.js';
// 🔴 T-05-05: スキャン状態の値集合と遷移規則（docs/05 §3.4 / §8.5 / §9.6）。
//    正規化する側（`packages/connectors`）と CHECK を持つ側（`packages/db`）は相互に
//    依存できない（`CLAUDE.md` §2.1）ため、値集合の単一出所を domain に置く。
export * from './scan/index.js';
