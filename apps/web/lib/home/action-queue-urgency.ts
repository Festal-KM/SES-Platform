// apps/web/lib/home/action-queue-urgency.ts
// 🔴 要対応キューの行に色を付けるかどうかの判定（`docs/04` §S-003 改訂 16「要対応キューでの
//    semantic color の使い方」）。T-22-09。
//
// ============================================================================
// 🔴 なぜ独立したファイルなのか
// ============================================================================
// ①`'use client'` の部品（`action-queue-section.tsx`）が値として import するため、
//   **`@ses/i18n` にも `@ses/db` にも依存しない純粋関数**でなければならない
//   （`./action-queue.ts` は `t()` を使うので、そちらに置くとクライアントへ i18n が流れる）。
// ②判定を画面に書くと、**閾値が画面ごとに変わる**（50 行のうち何行が色付きになるかが変わる）。
//
// 🔴 **色を使うのは 2 条件だけ**である（`docs/04` §S-003）:
//   ① `期限` が過去（期限超過）
//   ② 経過時間が閾値超
// 🔴 **赤は使わない**（色は `--color-warning-*`）。🔴 **行の背景を塗らない**
//   （期限セルの文字色と行頭 2px の縦バーだけ）。**50 行のうち大半が色付きになると色が意味を失う。**

/**
 * 🔴 「放置が長い」と見なす閾値（3 日）。
 *
 * ⚠️ **`docs/04` は閾値の値を定めていない**（「経過時間が閾値超の行だけ」とのみ書かれている）。
 *    3 日にした理由: `docs/01` 章 2.3 の「SES の営業は時間勝負であり、承認・面談日程・延長確認の
 *    遅れが直接失注になる」に対し、**3 営業日を待たずに面談枠はほぼ埋まる**。一方これより短くすると
 *    （例えば 1 日）**週明けのキューがほぼ全部色付きになり、色が意味を失う**（§S-003 の 🔴）。
 * 🔴 **画面ごとに別の値を持たせない**（本定数が唯一の出所）。
 */
export const ACTION_QUEUE_STALE_AFTER_MS = 3 * 86_400_000;

/** 判定に使う行の形（`ActionQueueRow` の部分集合。型を絞って「他の列で色を決めない」ことを示す）。 */
export type ActionQueueUrgencyInput = {
  readonly since: string;
  readonly deadline: string | null;
};

/**
 * 🔴 その行に色を付けるか（`期限超過` **または** `経過時間が閾値超`）。
 *
 * 🔴 **種別・状態・ロールで色を決めない**（それらは種別バッジと状態バッジが示す）。
 * ⚠️ 解析できない時刻は「色を付けない」に倒す（表示だけの判定であり、判断には使わない）。
 */
export function isActionQueueRowUrgent(row: ActionQueueUrgencyInput, nowMs: number): boolean {
  if (!Number.isFinite(nowMs)) return false;
  if (row.deadline !== null) {
    const deadline = Date.parse(row.deadline);
    if (!Number.isNaN(deadline) && deadline < nowMs) return true;
  }
  const since = Date.parse(row.since);
  if (Number.isNaN(since)) return false;
  return nowMs - since > ACTION_QUEUE_STALE_AFTER_MS;
}
