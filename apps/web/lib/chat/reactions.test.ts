// ✅ 2026-10-22: リアクションの名前 → 絵文字の表。🔴 絵文字の種類は全部の絵文字に、語の種類には絵文字を持たせない。
import { describe, expect, it } from 'vitest';
import { CHAT_REACTION_EMOJI, chatReactionEmoji } from './reactions';
import { CHAT_REACTION_EMOJI_KINDS, CHAT_REACTION_WORD_KINDS } from './views';

describe('リアクションの絵文字', () => {
  it('絵文字の 12 種はすべて絵文字を持つ', () => {
    expect(Object.keys(CHAT_REACTION_EMOJI).sort()).toEqual([...CHAT_REACTION_EMOJI_KINDS].sort());
    for (const kind of CHAT_REACTION_EMOJI_KINDS) expect(chatReactionEmoji(kind)).not.toBeNull();
  });
  it('語の 4 種は絵文字を持たない（語のまま出す）', () => {
    for (const kind of CHAT_REACTION_WORD_KINDS) expect(chatReactionEmoji(kind)).toBeNull();
  });
});
