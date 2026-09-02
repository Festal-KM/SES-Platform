// 違反: @anthropic-ai/sdk を packages/ai/src/client.ts 以外で動的 import している（CLAUDE.md §3.2 ④）
export const load = async () => {
  const mod = await import('@anthropic-ai/sdk');
  return mod;
};
