// apps/web/lib/chat/reactions.ts
// ✅ 2026-10-22（紺野「リアクションのスタンプとかもちゃんと入れて」）: リアクションの名前 → 画面に出す絵文字。
// 🔴 DB には英字の名前だけを入れる（絵文字は端末・書き出しで崩れることがある）。絵文字はこの表で画面だけが持つ。
// 🔴 UI_GUIDELINES §1「絵文字を使わない」の例外は**チャットのリアクションだけ**。ほかの画面でこの表を使わない。
import type { CHAT_REACTION_EMOJI_KINDS, ChatReactionKind } from './views';

export const CHAT_REACTION_EMOJI: Readonly<Record<(typeof CHAT_REACTION_EMOJI_KINDS)[number], string>> = {
  THUMBS_UP: '👍',
  PRAY: '🙏',
  TADA: '🎉',
  SMILE: '😊',
  JOY: '😂',
  EYES: '👀',
  BOW: '🙇',
  SWEAT: '💦',
  CHECK: '✅',
  HEART: '❤️',
  FIRE: '🔥',
  CLAP: '👏',
};

/** 絵文字のリアクションか（語のリアクションは文字で出す）。 */
export function chatReactionEmoji(kind: ChatReactionKind): string | null {
  return Object.hasOwn(CHAT_REACTION_EMOJI, kind) ? CHAT_REACTION_EMOJI[kind as keyof typeof CHAT_REACTION_EMOJI] : null;
}
