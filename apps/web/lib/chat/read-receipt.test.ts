// apps/web/lib/chat/read-receipt.test.ts
import { describe, expect, it } from 'vitest';
import { readReceiptMessageId } from './read-receipt';
import type { ChatMessageView } from './views';

function message(id: string, mine: boolean, extra: Partial<ChatMessageView> = {}): ChatMessageView {
  return {
    id,
    sentAt: `2026-10-19T00:00:0${id.slice(-1)}.000Z`,
    senderName: mine ? '自分' : '相手',
    senderCompanyName: '合成ホスト株式会社',
    own: mine,
    mine,
    body: `発言 ${id}`,
    ...extra,
  };
}

const ITEMS = [message('m1', true), message('m2', false), message('m3', true), message('m4', true), message('m5', false)];

describe('readReceiptMessageId', () => {
  it('相手がまだ読んでいなければ出さない', () => {
    expect(readReceiptMessageId(ITEMS, null)).toBeNull();
  });

  it('相手の既読位置が自分の発言なら、その発言に出す', () => {
    expect(readReceiptMessageId(ITEMS, 'm4')).toBe('m4');
    expect(readReceiptMessageId(ITEMS, 'm3')).toBe('m3');
  });

  it('相手の既読位置が相手の発言なら、それ以前で最後の自分の発言に出す', () => {
    expect(readReceiptMessageId(ITEMS, 'm5')).toBe('m4');
    expect(readReceiptMessageId(ITEMS, 'm2')).toBe('m1');
  });

  it('既読位置より後ろの自分の発言には出さない（1 か所だけ）', () => {
    expect(readReceiptMessageId(ITEMS, 'm1')).toBe('m1');
  });

  it('既読位置が手元の一覧に無ければ出さない', () => {
    expect(readReceiptMessageId(ITEMS, 'older')).toBeNull();
  });

  it('既読位置以前に自分の発言が無ければ出さない', () => {
    expect(readReceiptMessageId([message('m2', false), message('m3', true)], 'm2')).toBeNull();
  });

  it('削除した自分の発言は飛ばす', () => {
    const items = [message('m1', true), message('m3', true, { deleted: true, body: null })];
    expect(readReceiptMessageId(items, 'm3')).toBe('m1');
  });
});
