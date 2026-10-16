// apps/web/lib/chat/message-text.test.ts
// `S-031` の本文の見せ方と入力欄の補助（`lib/chat/message-text.ts`）。
import { describe, expect, it } from 'vitest';
import {
  chatDraftKey,
  collapsedMessageText,
  isAwayFromLatest,
  isLongMessage,
  remainingChars,
  splitMessageText,
} from './message-text';

describe('splitMessageText（URL をリンクにする）', () => {
  it('http / https の URL を切り出す', () => {
    expect(splitMessageText('資料は https://example.com/a?b=1 です')).toEqual([
      { kind: 'text', value: '資料は ' },
      { kind: 'url', value: 'https://example.com/a?b=1' },
      { kind: 'text', value: ' です' },
    ]);
  });

  it('末尾の句読点・閉じ括弧・全角の区切りはリンクに含めない', () => {
    expect(splitMessageText('見てください（https://example.com/x）。')).toEqual([
      { kind: 'text', value: '見てください（' },
      { kind: 'url', value: 'https://example.com/x' },
      { kind: 'text', value: '）。' },
    ]);
    expect(splitMessageText('see http://example.com.')[1]).toEqual({ kind: 'url', value: 'http://example.com' });
  });

  it('🔴 javascript: などは文字のまま（リンクにしない）', () => {
    expect(splitMessageText('javascript:alert(1)')).toEqual([{ kind: 'text', value: 'javascript:alert(1)' }]);
    expect(splitMessageText('data:text/html,x')).toEqual([{ kind: 'text', value: 'data:text/html,x' }]);
  });

  it('URL が無ければ 1 片、複数あればすべて切り出す。改行は文字のまま残す', () => {
    expect(splitMessageText('よろしくお願いします')).toEqual([{ kind: 'text', value: 'よろしくお願いします' }]);
    const segments = splitMessageText('A https://a.example\nB https://b.example');
    expect(segments.filter((segment) => segment.kind === 'url').map((segment) => segment.value)).toEqual([
      'https://a.example',
      'https://b.example',
    ]);
    expect(segments.map((segment) => segment.value).join('')).toBe('A https://a.example\nB https://b.example');
  });

  it('スキームだけの語はリンクにしない', () => {
    expect(splitMessageText('https://')).toEqual([{ kind: 'text', value: 'https://' }]);
  });
});

describe('長い本文を畳む', () => {
  it('600 文字・12 行を超えたら畳む', () => {
    expect(isLongMessage('あ'.repeat(600))).toBe(false);
    expect(isLongMessage('あ'.repeat(601))).toBe(true);
    expect(isLongMessage(Array.from({ length: 13 }, () => 'x').join('\n'))).toBe(true);
  });

  it('畳んだ先頭は 8 行・400 文字まで + 「…」', () => {
    const lines = Array.from({ length: 20 }, (_, index) => `行${String(index + 1)}`).join('\n');
    expect(collapsedMessageText(lines).split('\n')).toHaveLength(8);
    expect(collapsedMessageText(lines).endsWith('…')).toBe(true);
    expect(collapsedMessageText('い'.repeat(1000))).toBe(`${'い'.repeat(400)}…`);
  });
});

describe('入力欄の補助', () => {
  it('残り 200 文字を切ったら残りを返す（それまでは出さない）', () => {
    expect(remainingChars('a'.repeat(3700), 4000)).toBeNull();
    expect(remainingChars('a'.repeat(3800), 4000)).toBe(200);
    expect(remainingChars('a'.repeat(4000), 4000)).toBe(0);
  });

  it('下書きの鍵はスレッドごと', () => {
    expect(chatDraftKey('t1')).not.toBe(chatDraftKey('t2'));
  });

  it('一番下から 240px より上にいたら「最新へ」を出す', () => {
    expect(isAwayFromLatest({ scrollTop: 0, scrollHeight: 2000, clientHeight: 600 })).toBe(true);
    expect(isAwayFromLatest({ scrollTop: 1300, scrollHeight: 2000, clientHeight: 600 })).toBe(false);
  });
});
