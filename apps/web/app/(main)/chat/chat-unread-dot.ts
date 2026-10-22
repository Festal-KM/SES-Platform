// apps/web/app/(main)/chat/chat-unread-dot.ts
// ✅ 2026-10-22（紺野「未読はアイコン横に赤丸（数字入り）で強調する感じで」）: 未読の赤丸（アバターの右上に重ねる）。
// 🔴 円（`rounded-full`）はアバターとカウンタだけに使える —— これはカウンタ。
// 白い縁で、アバターの色と混ざらないようにする。一覧の行とお気に入りで同じ形を使う。
export const UNREAD_DOT_CLASSES =
  'absolute -top-1 -right-1 flex h-5 min-w-5 items-center justify-center rounded-full px-1 text-xs font-semibold text-white ring-2 ring-bg';

/** これを超えたら「99+」。 */
export const UNREAD_DOT_MAX = 99;
