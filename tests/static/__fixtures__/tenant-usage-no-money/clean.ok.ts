// 対照（適合）: 件数だけの応答型 + 業務データの単価（例外 (a)）+ 請求見込み（円）。`tenant-usage-no-money.test.ts` ① で 0 件になる。
export type CleanView = {
  readonly remaining: number;
  readonly quota: number;
  readonly overageEstimateJpy: string | null;
  readonly unitPrice: number | null;
};
