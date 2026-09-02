// 違反: Math.random() は非決定的であり、マッチングスコアの決定性（BR-14）を壊す。
export function jitter(): number {
  return Math.random();
}
