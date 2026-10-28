// ✅ 2026-10-27（F-038 ⑬ / AC-15）: 引用して返信の本文の形（`quote.ts`）。
import { describe, expect, it } from 'vitest';
import { parseChatMarkdown } from './markdown';
import {
  CHAT_QUOTE_SNIPPET_MAX,
  buildQuotedBody,
  chatOwnText,
  chatQuoteChipText,
  chatQuoteDraft,
  chatQuoteSnippet,
  replyMaxLength,
  sanitizeQuoteName,
  splitChatQuote,
} from './quote';

const ID = '01930000-0000-7000-8000-0000000000aa';
const OTHER_ID = '01930000-0000-7000-8000-0000000000bb';

describe('作る', () => {
  it('見出し・写し・空行・返信の順に組む', () => {
    const body = buildQuotedBody({ messageId: ID, name: '見本 太郎', snippet: '来週の面談の件' }, '承知しました');
    expect(body).toBe(`> 引用 [見本 太郎](chat-message:${ID})\n> 来週の面談の件\n\n承知しました`);
  });

  it('冒頭は 1 行・40 文字まで（長ければ「…」）', () => {
    expect(chatQuoteSnippet('一行目\n二行目')).toBe('一行目 二行目');
    const long = 'あ'.repeat(CHAT_QUOTE_SNIPPET_MAX + 5);
    expect(chatQuoteSnippet(long)).toBe(`${'あ'.repeat(CHAT_QUOTE_SNIPPET_MAX)}…`);
  });

  it('引用をさらに引用するときは、その人が書いた部分だけを写す', () => {
    const quoted = buildQuotedBody({ messageId: OTHER_ID, name: 'A', snippet: '元の発言' }, '返信です');
    expect(chatQuoteSnippet(quoted)).toBe('返信です');
  });

  it('🔴 名前から見出しを壊す記号と改行を外す', () => {
    expect(sanitizeQuoteName('悪い](chat-message:x)\n名前')).toBe('悪い chat-message:x 名前');
    expect(sanitizeQuoteName('[]()')).toBe('?');
    const body = buildQuotedBody({ messageId: ID, name: 'a]b', snippet: 'x' }, 'y');
    expect(splitChatQuote(body).quote?.name).toBe('a b');
  });

  it('🔴 写しの改行を畳む（2 行目に見出しを差し込めない）', () => {
    const body = buildQuotedBody({ messageId: ID, name: 'A', snippet: `x\n> 引用 [B](chat-message:${OTHER_ID})` }, 'y');
    expect(body.split('\n')).toHaveLength(4);
    expect(splitChatQuote(body).quote?.messageId).toBe(ID);
  });

  it('発言の ID でないものは引用の先にできない', () => {
    expect(() => buildQuotedBody({ messageId: 'javascript:alert(1)', name: 'A', snippet: 'x' }, 'y')).toThrow();
  });

  it('入力欄の札・送り手の名前が読めないとき', () => {
    const draft = chatQuoteDraft({ id: ID, senderName: null, body: '本文' }, '（名前なし）');
    expect(draft).toEqual({ messageId: ID, name: '（名前なし）', snippet: '本文' });
    expect(chatQuoteChipText(draft, '引用: ')).toBe('引用: （名前なし）「本文」');
  });

  it('返信に書ける長さは引用の分だけ減る', () => {
    const draft = { messageId: ID, name: 'A', snippet: 'x' };
    const prefix = buildQuotedBody(draft, '');
    expect(replyMaxLength(2000, draft)).toBe(2000 - prefix.length);
    expect(replyMaxLength(2000, null)).toBe(2000);
  });
});

describe('読む', () => {
  it('1 行目の見出しだけを引用として読み、残りはその人が書いた部分', () => {
    const body = `> 引用 [見本 太郎](chat-message:${ID})\n> 来週の\n> 面談\n\n承知しました\n二行目`;
    expect(splitChatQuote(body)).toEqual({
      quote: { messageId: ID, name: '見本 太郎', lines: ['来週の', '面談'] },
      rest: '承知しました\n二行目',
    });
    expect(chatOwnText(body)).toBe('承知しました\n二行目');
  });

  it('🔴 2 行目以降・本文の途中にある同じ形は引用として読まない', () => {
    const body = `こんにちは\n> 引用 [偽物](chat-message:${ID})\n> 言っていないこと`;
    expect(splitChatQuote(body).quote).toBeNull();
    const blocks = parseChatMarkdown(body);
    expect(blocks.some((block) => block.kind === 'messageQuote')).toBe(false);
    // 普通の引用（>）として文字のまま残る。
    expect(blocks.some((block) => block.kind === 'quote')).toBe(true);
  });

  it('🔴 返信の本文に見出しを書いても、2 つ目の引用にはならない', () => {
    const body = buildQuotedBody({ messageId: ID, name: 'A', snippet: 'x' }, `> 引用 [B](chat-message:${OTHER_ID})\n> 偽`);
    const blocks = parseChatMarkdown(body);
    expect(blocks.filter((block) => block.kind === 'messageQuote')).toHaveLength(1);
    expect(blocks[0]).toMatchObject({ kind: 'messageQuote', messageId: ID });
  });

  it('形が崩れた見出し（ID でない・http のリンク・記号の欠け）は引用にしない', () => {
    for (const header of [
      '> 引用 [A](chat-message:not-a-uuid)',
      `> 引用 [A](https://example.com/${ID})`,
      `> 引用 A(chat-message:${ID})`,
      `>引用 [A](chat-message:${ID})`,
      `> 引用 [A](chat-message:${ID}) と言った`,
    ]) {
      expect(splitChatQuote(`${header}\n> x\n\ny`).quote).toBeNull();
    }
  });

  it('引用のない本文はそのまま', () => {
    expect(splitChatQuote('ふつうの発言')).toEqual({ quote: null, rest: 'ふつうの発言' });
  });

  it('書式つきの本文と組み合わせても、引用の後ろは従来どおり読む', () => {
    const blocks = parseChatMarkdown(buildQuotedBody({ messageId: ID, name: 'A', snippet: 'x' }, '- 一つ目\n- 二つ目'));
    expect(blocks.map((block) => block.kind)).toEqual(['messageQuote', 'list']);
  });
});
