// 対照（違反）: オブジェクトリテラルのキーに単価（USD）と cost がある。`tenant-usage-no-money.test.ts` ① が検出する。
export const tampered = {
  unitPriceUsd: 12,
  total_cost: '1.5',
  remaining: 3,
};
