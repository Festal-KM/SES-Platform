// 対照: 純粋関数のみ。現在時刻は `now: Date` を引数で受け取る（docs/05 §2.2）。
// `Date` を型注釈として参照することは違反にならない（new Date() / Date.xxx() の呼び出し形のみが対象）。
export function isPast(now: Date, deadline: Date): boolean {
  return now.getTime() > deadline.getTime();
}

export function clampScore(score: number): number {
  return Math.max(0, Math.min(100, score));
}
