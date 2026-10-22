// ✅ 2026-10-22: 発言の書式（`markdown.ts`）。🔴 HTML を通さない・リンクは http / https だけ・書式ボタンの振る舞い。
import { describe, expect, it } from 'vitest';
import { applyChatFormat, insertChatMention, parseChatInline, parseChatMarkdown } from './markdown';

describe('1 行の書式', () => {
  it('太字・斜体・コード・リンク・裸の URL', () => {
    expect(parseChatInline('a **太字** b')).toEqual([
      { kind: 'text', value: 'a ' },
      { kind: 'bold', children: [{ kind: 'text', value: '太字' }] },
      { kind: 'text', value: ' b' },
    ]);
    expect(parseChatInline('*斜体*')).toEqual([{ kind: 'italic', children: [{ kind: 'text', value: '斜体' }] }]);
    expect(parseChatInline('`x < y`')).toEqual([{ kind: 'code', value: 'x < y' }]);
    expect(parseChatInline('[資料](https://example.com/a)')).toEqual([{ kind: 'link', href: 'https://example.com/a', label: '資料' }]);
    expect(parseChatInline('見て https://example.com')).toEqual([
      { kind: 'text', value: '見て ' },
      { kind: 'link', href: 'https://example.com', label: 'https://example.com' },
    ]);
  });

  it('🔴 http / https 以外はリンクにしない（javascript: など）', () => {
    const nodes = parseChatInline('[押して](javascript:alert(1))');
    expect(nodes.some((node) => node.kind === 'link')).toBe(false);
  });

  it('🔴 HTML は文字のまま（要素として解釈しない）', () => {
    expect(parseChatInline('<script>alert(1)</script>')).toEqual([{ kind: 'text', value: '<script>alert(1)</script>' }]);
  });

  it('単語の途中の _ は斜体にしない（snake_case を壊さない）', () => {
    expect(parseChatInline('user_id と account_id')).toEqual([{ kind: 'text', value: 'user_id と account_id' }]);
  });

  it('@名前 は部屋の人の名前と一致するときだけ（長い名前を先に当てる）', () => {
    expect(parseChatInline('@見本 太郎 さん', ['見本', '見本 太郎'])).toEqual([
      { kind: 'mention', name: '見本 太郎' },
      { kind: 'text', value: ' さん' },
    ]);
    expect(parseChatInline('@知らない人')).toEqual([{ kind: 'text', value: '@知らない人' }]);
  });
});

describe('塊', () => {
  it('段落・箇条書き・番号・引用・コードの塊を分ける', () => {
    const blocks = parseChatMarkdown('はじめに\n\n- 一つ目\n- 二つ目\n\n1. A\n2. B\n> 引用\n```\ncode **そのまま**\n```');
    expect(blocks.map((block) => block.kind)).toEqual(['paragraph', 'list', 'list', 'quote', 'code']);
    expect(blocks[1]).toMatchObject({ kind: 'list', ordered: false });
    expect(blocks[2]).toMatchObject({ kind: 'list', ordered: true });
    expect(blocks[4]).toEqual({ kind: 'code', value: 'code **そのまま**' });
  });

  it('段落の中の改行は行として残す', () => {
    const [block] = parseChatMarkdown('1 行目\n2 行目');
    expect(block).toMatchObject({ kind: 'paragraph' });
    expect(block?.kind === 'paragraph' ? block.lines.length : 0).toBe(2);
  });
});

describe('書式ボタン', () => {
  it('選んだ文字を太字で挟み、選択を中身に残す', () => {
    expect(applyChatFormat('abc', 1, 2, 'bold')).toEqual({ text: 'a**b**c', selectionStart: 3, selectionEnd: 4 });
  });
  it('何も選んでいなければ記号の間にカーソルを置く', () => {
    expect(applyChatFormat('', 0, 0, 'code')).toEqual({ text: '``', selectionStart: 1, selectionEnd: 1 });
  });
  it('リンクは URL の部分を選んだ状態にする', () => {
    const edit = applyChatFormat('資料', 0, 2, 'link');
    expect(edit.text).toBe('[資料](https://)');
    expect(edit.text.slice(edit.selectionStart, edit.selectionEnd)).toBe('https://');
  });
  it('箇条書き・番号・引用は選んだ行の頭に付ける', () => {
    expect(applyChatFormat('a\nb', 0, 3, 'bullet').text).toBe('- a\n- b');
    expect(applyChatFormat('a\nb', 0, 3, 'ordered').text).toBe('1. a\n2. b');
    expect(applyChatFormat('x\na', 2, 2, 'quote').text).toBe('x\n> a');
  });
  it('@名前 はカーソルの位置に空白で区切って入れる', () => {
    expect(insertChatMention('よろしく', 4, 4, '見本 太郎')).toEqual({ text: 'よろしく @見本 太郎 ', selectionStart: 12, selectionEnd: 12 });
  });
});
