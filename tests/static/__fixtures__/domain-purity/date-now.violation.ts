// 違反: Date.now() を直接参照している。
export function timestamp(): number {
  return Date.now();
}
