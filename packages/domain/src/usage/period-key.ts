// packages/domain/src/usage/period-key.ts
// `UsageCounter.periodKey`（docs/05 §3.8 / §9.8 / §14.2）の唯一の出所。
//
// 🔴 なぜ `packages/domain` に置くか（CLAUDE.md §2.1）:
//    この値は席数（`packages/db` の日次スナップショット）・AI コスト（`packages/ai` の
//    `reserveAiCost`）・メール通数・ストレージのすべてが同じ規則で作る必要がある。
//    `packages/ai` は `@ses/db` に依存できないため、`packages/db` に置くと 2 実装になる。
//    純粋関数（I/O・現在時刻の取得を持たない）なので domain の制約にも反しない。
//
// 🔴 暦は `Asia/Tokyo` 固定である（docs/05 §9.1「タイムゾーン: `Asia/Tokyo` 固定。
//    `SCHEDULER_TIMEZONE` は `z.literal('Asia/Tokyo')`。組織別に持たない」）。
//    テナントの `timezone` 列で切り替えない —— 切り替えると、同じ 1 日が
//    テナントごとに別の範囲を指し、`A-004` / `A-011` の横断集計が突き合わせられなくなる。

/** docs/05 §3.8 `UsageCounter.periodKind`。 */
export type UsagePeriodKind = 'DAY' | 'MONTH';

/**
 * 🔴 集計の暦。`Intl` の `timeZone` に渡す唯一の値。
 *    `packages/config` の `SCHEDULER_TIMEZONE`（`z.literal('Asia/Tokyo')`）と同じ値であり、
 *    どちらかが変わるときは両方を同時に変える（片方だけ変えると日境界がずれる）。
 */
export const USAGE_PERIOD_TIME_ZONE = 'Asia/Tokyo';

/**
 * `Asia/Tokyo` の暦での年・月・日を取り出す。
 * 🔴 `toISOString()`（UTC）で切らない。JST の 00:00〜08:59 が前日に落ちる。
 */
function tokyoParts(at: Date): { year: string; month: string; day: string } {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: USAGE_PERIOD_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  const parts = formatter.formatToParts(at);
  const pick = (type: Intl.DateTimeFormatPartTypes): string =>
    parts.find((part) => part.type === type)?.value ?? '';
  return { year: pick('year'), month: pick('month'), day: pick('day') };
}

/**
 * `UsageCounter.periodKey` を作る（`DAY` = `YYYY-MM-DD` / `MONTH` = `YYYY-MM`）。
 *
 * 🔴 現在時刻を関数の中で取得しない（引数で受ける）。ジョブの再実行と結合テストが
 *    同じ入力で同じキーを得られることが、冪等性（同日 2 回で 1 行）の前提になる。
 */
export function usagePeriodKey(kind: UsagePeriodKind, at: Date): string {
  if (Number.isNaN(at.getTime())) {
    throw new RangeError('usagePeriodKey: 不正な日時が渡されました。');
  }
  const { year, month, day } = tokyoParts(at);
  return kind === 'DAY' ? `${year}-${month}-${day}` : `${year}-${month}`;
}
