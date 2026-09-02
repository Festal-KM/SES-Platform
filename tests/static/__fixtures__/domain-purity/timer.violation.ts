// 違反: タイマー（setTimeout 等）は I/O であり純粋関数の外に置く。
export function scheduleTick(fn: () => void): void {
  setTimeout(fn, 0);
}
