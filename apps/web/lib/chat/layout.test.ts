// apps/web/lib/chat/layout.test.ts
import { describe, expect, it } from 'vitest';
import { conversationLayoutFor, isSendKey } from './layout';

describe('conversationLayoutFor', () => {
  it('案件スレッドは話題型（全員左寄せ）', () => {
    expect(conversationLayoutFor('PROJECT')).toBe('topic');
  });

  it('企業スレッドは会話型（自分は右）', () => {
    expect(conversationLayoutFor('COMPANY')).toBe('chat');
  });
});

describe('isSendKey', () => {
  it('Enter だけなら送信', () => {
    expect(isSendKey({ key: 'Enter', shiftKey: false, isComposing: false })).toBe(true);
  });

  it('Shift+Enter は改行（送信しない）', () => {
    expect(isSendKey({ key: 'Enter', shiftKey: true, isComposing: false })).toBe(false);
  });

  it('🔴 日本語入力の変換確定の Enter では送信しない', () => {
    expect(isSendKey({ key: 'Enter', shiftKey: false, isComposing: true })).toBe(false);
  });

  it('🔴 Safari の変換確定（keyCode 229）でも送信しない', () => {
    expect(isSendKey({ key: 'Enter', shiftKey: false, isComposing: false, keyCode: 229 })).toBe(false);
  });

  it('Enter 以外のキーでは送信しない', () => {
    expect(isSendKey({ key: 'a', shiftKey: false, isComposing: false })).toBe(false);
  });
});
