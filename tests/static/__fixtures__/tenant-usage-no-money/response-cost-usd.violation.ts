// 対照（違反）: 主平面の応答型に金額（USD）のプロパティがある。`tenant-usage-no-money.test.ts` ① が検出する。
export type TamperedUsageView = {
  readonly aiUnits: { readonly used: number };
  readonly costUsd: string;
  readonly AI_COST_USD: number;
};
