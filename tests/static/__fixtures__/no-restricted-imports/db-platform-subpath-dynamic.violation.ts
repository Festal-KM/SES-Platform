// 違反: 主平面のコードが @ses/db/platform を動的 import している（T-03-08）。
// no-restricted-imports の patterns は ImportExpression を検出しないため、
// no-restricted-syntax 側のセレクタで塞げていることを確認する。
export const use = async () => {
  const mod = await import('@ses/db/platform');
  return mod;
};
