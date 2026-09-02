// 違反: @prisma/client の動的 import も禁止対象である（CLAUDE.md §3.1 / docs/05 §4.3）
export const load = async () => {
  const mod = await import('@prisma/client');
  return mod;
};
