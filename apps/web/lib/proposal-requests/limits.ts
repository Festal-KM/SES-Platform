// apps/web/lib/proposal-requests/limits.ts
// 提案依頼の入力上限（docs/05 §6.5「#31 の実装の決着」）。T-08-06。
//
// 🔴 **import を 1 つも持たない純粋モジュール**である。`'use client'` の画面（`candidate-screen.tsx` の
//    `maxLength` / 期限の初期値）と API の境界検証（`schemas.ts`）が**同じ値**を読むための置き場所であり、
//    `schemas.ts` 側（`node:crypto` を持つ `anonymize/reference.ts` に辿れる）をクライアントから読めない
//    ために分けてある。値を 2 か所に書かない。
//
// 🔴 いずれも設計値ではなく境界検証の既定である（業務上の推奨値とは別物）。

/** 依頼メッセージの上限（文字）。長文は面談や提案本文の場であり、依頼文の役割ではない。 */
export const PROPOSAL_REQUEST_MESSAGE_MAX_LENGTH = 1000;

/**
 * 返答期限の上限（現在からの日数）。期限切れジョブ（`proposal-request.expire`。T-08-07）が
 * 「いつまでも `REQUESTED` のまま残る依頼」を作らないための上限。
 */
export const PROPOSAL_REQUEST_EXPIRY_MAX_DAYS = 30;

/** 画面の期限の初期値（現在からの日数）。 */
export const PROPOSAL_REQUEST_EXPIRY_DEFAULT_DAYS = 7;
