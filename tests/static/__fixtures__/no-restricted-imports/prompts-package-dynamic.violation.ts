// 違反 fixture: 製品プロンプトの動的 import（no-restricted-imports は ImportExpression を
// 検出しないため、no-restricted-syntax 側のセレクタで塞げていることを確認する）。
export const use = async () => {
  const mod = await import('@ses/prompts');
  return mod;
};
