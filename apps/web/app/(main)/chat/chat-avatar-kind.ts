// apps/web/app/(main)/chat/chat-avatar-kind.ts
// 種類ごとのアバターの形と色（一覧・お気に入り・左の列・連絡先で共通）。
// ✅ 2026-10-30: `chat-thread-list.tsx` から移した（クライアントの部品〔連絡先の人の選び方〕からも使うため。
//    あちらは `@ses/i18n` を読むサーバの部品なので、クライアントから import しない）。
import type { ChatThreadKind } from '../../../lib/chat/views';

/**
 * 🔴 種類ごとのアバターの形と色。お気に入り・左の列も同じ。
 * ✅ 2026-10-20（紺野「色もなんか一緒」）: 塗りつぶしにした。人 = 青の丸 / グループ = 緑の丸 / 取引先の会社 = 墨色の角丸 /
 *    案件 = 橙の角丸に「#」。使う色は既存のトークンだけ。
 * ✅ 2026-10-29（紺野「色分けしてあったほうがよかった」）: #167（5b9c539）で無彩色にしたのを元に戻した。
 */
export const AVATAR_KIND_CLASSES: Readonly<Record<ChatThreadKind, string>> = {
  DM: 'bg-brand text-brand-fg',
  GROUP: 'bg-success text-bg',
  COMPANY: 'rounded-md bg-fg text-bg',
  PROJECT: 'rounded-md bg-warning text-bg',
};
