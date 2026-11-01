// apps/web/lib/chat/search-text.test.ts
// ✅ 2026-10-29（F-038 ⑰）: 会話の中の検索の本文の扱い（`lib/chat/search-text.ts`）。
import { describe, expect, it } from 'vitest';
import { buildQuotedBody } from './quote';
import { CHAT_SEARCH_SNIPPET_MAX, chatOwnTextIncludes, chatSearchSnippet } from './search-text';

const QUOTED_ID = '01930000-0000-7000-8000-000000000121';

describe('chatOwnTextIncludes', () => {
  it('本文に含まれれば当たる（大文字小文字を区別しない）', () => {
    expect(chatOwnTextIncludes('Java の経験者を探しています', 'java')).toBe(true);
    expect(chatOwnTextIncludes('Java の経験者を探しています', 'Go')).toBe(false);
  });

  it('🔴 引用の見出しの名前・写した冒頭だけに含まれる語では当たらない', () => {
    const body = buildQuotedBody({ messageId: QUOTED_ID, name: '山田 太郎', snippet: '面談は来週の火曜です' }, '承知しました');
    expect(chatOwnTextIncludes(body, '山田')).toBe(false);
    expect(chatOwnTextIncludes(body, '火曜')).toBe(false);
    expect(chatOwnTextIncludes(body, 'chat-message')).toBe(false);
    expect(chatOwnTextIncludes(body, '承知')).toBe(true);
  });

  it('消えた本文（null）・空の語は当たらない', () => {
    expect(chatOwnTextIncludes(null, '本文')).toBe(false);
    expect(chatOwnTextIncludes('本文', '   ')).toBe(false);
  });
});

describe('chatSearchSnippet', () => {
  it('当たった箇所の前後だけを切り出す（目安 60 文字 + 前後の「…」）', () => {
    const body = `${'あ'.repeat(100)}ターゲット${'い'.repeat(100)}`;
    const snippet = chatSearchSnippet(body, 'ターゲット');
    expect(snippet).toContain('ターゲット');
    expect(snippet.startsWith('…')).toBe(true);
    expect(snippet.endsWith('…')).toBe(true);
    expect([...snippet].length).toBeLessThanOrEqual(CHAT_SEARCH_SNIPPET_MAX + 2);
  });

  it('🔴 引用の行は冒頭に出さない', () => {
    const body = buildQuotedBody({ messageId: QUOTED_ID, name: '山田', snippet: '前の発言' }, '日程を確定しました');
    const snippet = chatSearchSnippet(body, '確定');
    expect(snippet).toBe('日程を確定しました');
    expect(snippet).not.toContain('引用');
    expect(snippet).not.toContain('chat-message:');
  });

  it('改行は空白に畳む', () => {
    expect(chatSearchSnippet('一行目\n二行目', '二行目')).toBe('一行目 二行目');
  });
});
