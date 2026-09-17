// 対照（違反）: `usage.*` / `quota.*` の文言に金額の語と、請求見込み以外の「円」がある。`tenant-usage-no-money.test.ts` ③ が検出する。
export const ja = {
  'usage.remaining': '残り $9 分',
  'quota.aiDaily': '上限 5 ドルに達しました',
  'usage.aiUnit.cost': 'cost per unit',
  'usage.remaining.yen': '残り 1,200 円分',
  'usage.billing.estimate': '12,400 円',
} as const;
