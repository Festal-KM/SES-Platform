// apps/web/lib/proposal-requests/expiry.ts
// 返答期限（`expiresAt`）の扱い（`S-016` の依頼フォーム / #31 の検証値。`docs/04` §S-016
// 「案件・メッセージ・期限を入力」/ docs/05 §6.5「#31 の実装の決着」）。T-08-06。
//
// 🔴 画面は**日付（`YYYY-MM-DD`。JST）**を入力し、API へは**その日の終わり（JST 23:59:59）**を ISO 8601 で送る。
//    期限を「日」で考えるのが業務の単位であり、時刻を選ばせても精度は上がらない。
// 🔴 **外部 import を持たない純粋モジュール**である（読むのは同じく import 無しの `./limits` だけ）。
//    `'use client'` の画面（`candidate-screen.tsx`）が `expiresAtIsoFromJstDate` を使うため、`schemas.ts`
//    （→ `node:crypto` を持つ `anonymize/reference.ts`）や `@ses/i18n` / `@ses/db` へ辿れてはならない。
import { PROPOSAL_REQUEST_EXPIRY_DEFAULT_DAYS, PROPOSAL_REQUEST_EXPIRY_MAX_DAYS } from './limits';

export { PROPOSAL_REQUEST_EXPIRY_DEFAULT_DAYS, PROPOSAL_REQUEST_EXPIRY_MAX_DAYS } from './limits';

const DAY_MS = 86_400_000;
const JST_DAY_PATTERN = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;

/**
 * JST の暦日（`YYYY-MM-DD`）→ その日の終わり（`23:59:59+09:00`）の ISO 8601（UTC）。
 * @throws RangeError 形が `YYYY-MM-DD` でない（🔴 値を message に載せない）。
 */
export function expiresAtIsoFromJstDate(day: string): string {
  if (!JST_DAY_PATTERN.test(day)) throw new RangeError('返答期限の日付の形が不正です（YYYY-MM-DD）。');
  const date = new Date(`${day}T23:59:59+09:00`);
  if (Number.isNaN(date.getTime())) throw new RangeError('返答期限の日付が不正です。');
  return date.toISOString();
}

/**
 * 期限の初期値・上限（JST 暦日）。`toJstIsoDay` を注入する（`lib/format/datetime.ts` の 1 実装を使い、
 * UTC 切り出しの複製を作らない。docs/05 §4.6.3 の申し送りと同じ理由）。
 *
 * 🔴 上限は `PROPOSAL_REQUEST_EXPIRY_MAX_DAYS - 1` 日後にする —— その日の終わり（23:59:59 JST）を送るため、
 *    `MAX_DAYS` 日後の日付を選ぶと API の「30 日以内」（時刻まで比較）を超えうる。
 */
export function proposalRequestExpiryBounds(
  now: Date,
  toJstIsoDay: (value: Date) => string,
): { readonly defaultDay: string; readonly minDay: string; readonly maxDay: string } {
  return {
    defaultDay: toJstIsoDay(new Date(now.getTime() + PROPOSAL_REQUEST_EXPIRY_DEFAULT_DAYS * DAY_MS)),
    minDay: toJstIsoDay(now),
    maxDay: toJstIsoDay(new Date(now.getTime() + (PROPOSAL_REQUEST_EXPIRY_MAX_DAYS - 1) * DAY_MS)),
  };
}
