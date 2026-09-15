// packages/domain/src/usage/pricing-ruleset.ts
// 🔴 AI 以外の原価単価・為替・基準ユニットの**版付きの表**（docs/05 §5.9 / §8.8 / docs/03 §7.2.2 / §7.5-3）。T-10-02。
//
// ============================================================================
// 🔴 なぜ `packages/config/src/pricing.ts` ではなくここか（docs/05 §8.8 の読み替え）
// ============================================================================
// docs/05 §8.8 は「`packages/config/src/pricing.ts` に `PRICING_RULESET_VERSION = 'v1'` を持つ」と
// 書いた。しかし単価 × 数量 → USD の計算は I/O を持たない決定的な計算であり、置き場所の判断は
// AI の単価表（`ai/pricing.ts`。docs/05 §7.9 ④の読み替え）とまったく同じである:
//   1. 計算する側（`monthly-cost.ts`）は domain にしか置けない（DB を立てずに検証する）
//   2. `packages/config` は `@ses/domain` に依存していない。型だけのために依存を足すと
//      ワークスペースの依存グラフが 1 本増える（`CLAUDE.md` §2.1「新規依存は宣言のみ」）
//   3. 「金額を持つのは 1 箇所」（§7.9 ④）—— AI の単価表と同じパッケージに揃える
// 🔴 **版（`version`）が `TenantMonthlyCost.pricingRulesetVersion` に残る**ことが本質であり、
//    ファイルの置き場所ではない。単価を変えるときは **新しい版を足す**（v1 を書き換えない）。
//    過去月の行は当時の版で確定しており、遡って再計算しない（docs/05 §8.8）。

export type PricingRuleset = {
  /** `TenantMonthlyCost.pricingRulesetVersion` に記録する版。 */
  readonly version: string;
  /** Amazon SES Essentials の送信単価（USD / 1,000 通。docs/03 §7.2.2）。 */
  readonly emailEssentialsUsdPerThousand: string;
  /** SES Tenants の月額（USD / 月 / テナント。docs/03 §7.2.2）。 */
  readonly emailTenantsUsdPerTenantMonth: string;
  /** SES Tenants の通数課金（USD / 1,000 通）。 */
  readonly emailTenantsUsdPerThousand: string;
  /** S3 Standard（USD / GiB・月）。⚠️ docs/03 §7.2.2「未確認・仮置き」（`U-9`）。 */
  readonly storageUsdPerGibMonth: string;
  /** 電子署名（USD / リクエスト）。🔴 BYO のため 0（docs/05 §5.9 / Issue #11）。 */
  readonly esignUsdPerRequest: string;
  /** 原価（USD）を粗利計算で円換算する為替（docs/05 §5.9 `FX_JPY_PER_USD`。TBD-4）。 */
  readonly fxJpyPerUsd: string;
  /** 基準ユニット（30 席）の月間 AI 原価（docs/03 §7.2.1 / docs/05 §5.9「既定 12.82」）。 */
  readonly aiBaselineCostUsd: string;
};

export const PRICING_RULESET_VERSION = 'v1';

/**
 * 🔴 v1（2026-09-16）。値の出典は docs/03 §7.2.2 / §7.5-3。
 *
 * - 為替 150 円/USD は docs/03 §7.2.3 の換算（$12.96 ≒ ¥1,944）と同じ値。**月次で確定させる**（TBD-4）
 *   運用が決まるまでの暫定であり、変えるときは版を上げる。
 */
export const PRICING_RULESET_V1: PricingRuleset = {
  version: PRICING_RULESET_VERSION,
  emailEssentialsUsdPerThousand: '0.16',
  emailTenantsUsdPerTenantMonth: '0.005',
  emailTenantsUsdPerThousand: '0.005',
  storageUsdPerGibMonth: '0.025',
  esignUsdPerRequest: '0',
  fxJpyPerUsd: '150',
  aiBaselineCostUsd: '12.82',
};
