// apps/web/lib/format/elapsed.ts
// 経過時間の表示（分 / 時間 / 日の 3 段）。T-12-15。
//
// 🔴 **T-09-03 が `lib/proposals/approval-rows.ts` に置いた `formatElapsed` の本体をここへ移した。**
//    `S-003` / `S-004` の要対応キューは `'use client'` の部品が 60 秒ごとに経過時間を描き直すため、
//    `@ses/i18n` の `t()` を呼ばない純粋な形が要る（`lib/proposal-requests/remaining.ts` の `formatRemaining` と同じ規律）。
//    `formatElapsed`（`t()` で文言を解決して呼ぶ薄い皮）は残し、**丸めの規則は 1 実装**にする —— 2 本になると
//    `S-019` の「経過時間」とホームの「経過時間」が同じ時刻で別の値を出す。
// 🔴 純粋関数。現在時刻を読まない・`@ses/i18n` / `@ses/db` に依存しない（`client-db-boundary.test.ts`）。
import { formatThousands } from './number';

/** 経過時間の表示に要る語（呼び出し側が `t()` で解決して渡す）。 */
export type ElapsedLabels = {
  /** 1 分未満（例: 「1 分未満」）。 */
  readonly justNow: string;
  /** 分の接尾辞（例: 「 分」）。 */
  readonly minutesSuffix: string;
  /** 時間の接尾辞（例: 「 時間」）。 */
  readonly hoursSuffix: string;
  /** 日の接尾辞（例: 「 日」）。 */
  readonly daysSuffix: string;
  /** 解析できない値（例: 「—」）。 */
  readonly none: string;
};

/**
 * `fromIso` から `nowMs` までの経過を 1 つの文字列にする。
 *
 * - 1 分未満 … `labels.justNow`
 * - 60 分未満 … 「N 分」
 * - 24 時間未満 … 「N 時間」
 * - それ以上 … 「N 日」
 * 🔴 未来（時計のずれ）は 0 に丸める。解析できない値は `labels.none`。表示だけであり判定には使わない。
 *
 * @param nowMs 現在時刻（epoch ms）。呼び出し側が渡す（サーバはリクエスト時刻、クライアントは直近の応答時刻）。
 */
export function formatElapsedWith(fromIso: string, nowMs: number, labels: ElapsedLabels): string {
  const from = Date.parse(fromIso);
  if (Number.isNaN(from)) return labels.none;
  const minutes = Math.max(0, Math.floor((nowMs - from) / 60_000));
  if (minutes < 1) return labels.justNow;
  if (minutes < 60) return `${formatThousands(minutes)}${labels.minutesSuffix}`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${formatThousands(hours)}${labels.hoursSuffix}`;
  return `${formatThousands(Math.floor(hours / 24))}${labels.daysSuffix}`;
}
