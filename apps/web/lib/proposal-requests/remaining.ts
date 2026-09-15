// apps/web/lib/proposal-requests/remaining.ts
// 返答期限までの残り時間の表示（`docs/04` §S-017「期限までの残り」「クライアント側で毎分更新」）。T-08-06。
//
// 🔴 純粋関数であり、**現在時刻を読まない・`@ses/i18n` にも `@ses/db` にも依存しない**。
//    `'use client'` の画面（`proposal-request-screen.tsx`）が毎分の再計算に**同じ関数**を使うため、
//    文言は `RemainingLabels` として外から受け取る（`packages/i18n` の値はサーバ側で引いて props で渡す。
//    `CLAUDE.md` §3.5 / `client-db-boundary.test.ts` の規律）。
// 🔴 「残り 2 日」のような粗い粒度で出す。秒は出さない（毎分の更新で十分であり、秒を出すと
//    サーバ描画と hydration 後の値が必ず食い違う）。

export type RemainingLabels = {
  /** 「残り 」（接頭）。 */
  readonly prefix: string;
  readonly days: string;
  readonly hours: string;
  readonly minutes: string;
  readonly lessThanMinute: string;
  readonly expired: string;
};

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

/**
 * `expiresAt`（ISO 8601）までの残りを 1 つの文字列にする。
 *
 * - 1 日以上 … 「残り N 日」（端数の時間は切り捨て。日数だけで判断できる）
 * - 1 時間以上 … 「残り N 時間」
 * - 1 分以上 … 「残り N 分」
 * - 1 分未満 … 「残り 1 分未満」
 * - 期限を過ぎた … `labels.expired`（状態が `EXPIRED` に確定するのはジョブなので、それまでの表示）
 *
 * @param nowMs 現在時刻（epoch ms）。呼び出し側が渡す（サーバはリクエスト時刻、クライアントは端末時刻）。
 */
export function formatRemaining(expiresAtIso: string, nowMs: number, labels: RemainingLabels): string {
  const expiresAt = Date.parse(expiresAtIso);
  if (Number.isNaN(expiresAt)) return expiresAtIso;
  const diff = expiresAt - nowMs;
  if (diff <= 0) return labels.expired;
  if (diff >= DAY_MS) return `${labels.prefix}${Math.floor(diff / DAY_MS)}${labels.days}`;
  if (diff >= HOUR_MS) return `${labels.prefix}${Math.floor(diff / HOUR_MS)}${labels.hours}`;
  if (diff >= MINUTE_MS) return `${labels.prefix}${Math.floor(diff / MINUTE_MS)}${labels.minutes}`;
  return `${labels.prefix}${labels.lessThanMinute}`;
}
