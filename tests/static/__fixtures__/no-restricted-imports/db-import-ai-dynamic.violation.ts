// 違反: packages/db が packages/ai を動的 import している（CLAUDE.md §2.1 ③）
// no-restricted-imports の patterns は ImportExpression を検出しないため、
// no-restricted-syntax 側のセレクタで塞げていることを確認する。
export const use = async () => {
  const mod = await import('@ses/ai');
  return mod;
};
