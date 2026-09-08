// packages/db/src/usage-period.ts
// 🔴 集計期間が切り替わる時刻（`F-027` の `resetAt`）。T-07-04。
//
// ============================================================================
// 🔴 なぜ `packages/domain` の `usagePeriodKey` と別の場所にあるのか
// ============================================================================
// 暦の定義（`Asia/Tokyo` 固定。docs/05 §9.1）は `packages/domain/src/usage/period-key.ts` が
// 唯一の出所である。しかし**「その期間の終わり」を `Date` として返す**ことは domain では
// できない —— `tests/static/domain-purity.test.ts`（docs/05 §17.2 #14）が `new Date(...)` と
// `Date.*()` を**例外なく**禁じているためである（引数から決定的に組み立てる場合も同じ）。
// その規律は「マッチングスコアの決定性」を守るためのものであり、緩めるべきではない。
//
// 🔴 したがって「暦（キー）は domain / 境界の時刻はここ」という分け方にし、**両者が同じ暦を
//    指していること**を `usage-period.test.ts` が突き合わせる（境界の 1 ms 前は同じキー、
//    境界そのものは次のキー）。定義が 2 つに割れて静かにずれることは、この対照で防ぐ。
import { usagePeriodKey, type UsagePeriodKind } from '@ses/domain';

/**
 * 🔴 `Asia/Tokyo` の UTC オフセット（時）。**夏時間を持たない**ため固定値でよい
 *    （日本の夏時間は 1951 年で終わっている）。
 */
const TOKYO_UTC_OFFSET_HOURS = 9;

/** `Asia/Tokyo` の暦での年・月・日（`usagePeriodKey` が返すキーをそのまま分解する）。 */
function tokyoDateParts(at: Date): { year: number; month: number; day: number } {
  // 🔴 自前で暦を計算しない。**domain のキーを分解する**ことで、暦の出所を 1 つに保つ。
  const [year = '', month = '', day = ''] = usagePeriodKey('DAY', at).split('-');
  return { year: Number(year), month: Number(month), day: Number(day) };
}

/**
 * 🔴 その期間が切り替わる時刻（＝ 次の期間の開始）。
 *
 * 1 日の AI コスト上限に到達したとき、利用者に見せてよいのは**金額ではなく
 * 「いつ再開するか」**である（`F-027 AC-6` / docs/05 §7.6）。呼び出し側が `+1 日` を
 * 自前で組み立てない —— UTC で足すと JST の日境界と 9 時間ずれる。
 *
 * 🔴 現在時刻を関数の中で取得しない（引数で受ける。`usagePeriodKey` と同じ規律）。
 */
export function usagePeriodResetAt(kind: UsagePeriodKind, at: Date): Date {
  const { year, month, day } = tokyoDateParts(at);
  // JST の 00:00 は UTC の前日 15:00。`Date.UTC` は範囲外の値（翌日・翌月・負の時）を正規化する。
  return kind === 'DAY'
    ? new Date(Date.UTC(year, month - 1, day + 1, -TOKYO_UTC_OFFSET_HOURS))
    : new Date(Date.UTC(year, month, 1, -TOKYO_UTC_OFFSET_HOURS));
}
