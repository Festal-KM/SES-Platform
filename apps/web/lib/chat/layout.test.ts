// apps/web/lib/chat/layout.test.ts
import { describe, expect, it } from 'vitest';
import { conversationLayoutFor, conversationTitleFor, isSendKey } from './layout';

describe('conversationLayoutFor', () => {
  it('案件スレッドは話題型（全員左寄せ）', () => {
    expect(conversationLayoutFor('PROJECT')).toBe('topic');
  });

  it('企業スレッドは会話型（自分は右）', () => {
    expect(conversationLayoutFor('COMPANY')).toBe('chat');
  });
});

describe('conversationTitleFor', () => {
  const project = { id: '01930000-0000-7000-8000-000000000001', name: '金融系 Web API 改修' };

  it('案件スレッドは「案件名 / 相手の会社名」', () => {
    expect(conversationTitleFor({ kind: 'PROJECT', project, counterpartyName: '架空パートナー A' })).toEqual({
      title: '金融系 Web API 改修',
      subtitle: '架空パートナー A',
    });
  });

  it('案件が読めない案件スレッドは、相手の会社名だけ', () => {
    expect(conversationTitleFor({ kind: 'PROJECT', project: null, counterpartyName: '架空パートナー A' })).toEqual({
      title: '架空パートナー A',
      subtitle: null,
    });
  });

  it('企業スレッドは相手の会社名だけ', () => {
    expect(conversationTitleFor({ kind: 'COMPANY', project: null, counterpartyName: '架空パートナー A' })).toEqual({
      title: '架空パートナー A',
      subtitle: null,
    });
  });

  it('名前が読めなければ null（画面が既定の見出しに戻す）', () => {
    expect(conversationTitleFor({ kind: 'COMPANY', project: null, counterpartyName: null })).toEqual({
      title: null,
      subtitle: null,
    });
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
