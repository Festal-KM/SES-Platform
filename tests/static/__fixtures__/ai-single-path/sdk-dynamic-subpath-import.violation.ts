// 違反: @anthropic-ai/sdk のサブパスを動的 import している（CLAUDE.md §3.2 ④）
export const load = async () => {
  const mod = await import('@anthropic-ai/sdk/core');
  return mod;
};
