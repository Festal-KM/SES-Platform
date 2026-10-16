// apps/web/lib/chat/unread-marker.test.ts
// `S-031` の「ここから未読」の線（`lib/chat/unread-marker.ts`）。
import { describe, expect, it } from 'vitest';
import { withDaySeparators } from './day-separators';
import { unreadMarkerId, withUnreadMarker } from './unread-marker';
import type { ChatMessageView } from './views';

function message(id: string, minute: number, mine = false): ChatMessageView {
  return {
    id,
    sentAt: new Date(Date.UTC(2026, 9, 16, 0, minute)).toISOString(),
    senderName: '佐藤',
    senderCompanyName: '株式会社サンプル',
    own: mine,
    mine,
    body: '本文',
  };
}

const A = message('a', 0);
const B = message('b', 10, true);
const C = message('c', 20);
const D = message('d', 30);

describe('unreadMarkerId', () => {
  it('既読位置の後ろの、自分以外の最初の発言', () => {
    expect(unreadMarkerId([A, B, C, D], 'a')).toBe('c');
    expect(unreadMarkerId([A, B, C, D], 'c')).toBe('d');
  });

  it('最後まで読んでいれば線を引かない', () => {
    expect(unreadMarkerId([A, B, C, D], 'd')).toBeNull();
  });

  it('自分の発言は未読にならない', () => {
    expect(unreadMarkerId([A, B], 'a')).toBeNull();
  });

  it('まだ読んでいない・既読位置が手元より古いときは、手元の最初の自分以外の発言から', () => {
    expect(unreadMarkerId([B, C, D], null)).toBe('c');
    expect(unreadMarkerId([B, C, D], 'older')).toBe('c');
  });
});

describe('withUnreadMarker', () => {
  it('対象の発言の直前にだけ差し込む', () => {
    const entries = withUnreadMarker(withDaySeparators([A, C, D]), 'c');
    const kinds = entries.map((entry) => (entry.kind === 'message' ? entry.message.id : entry.kind));
    expect(kinds).toEqual(['day', 'a', 'unread', 'c', 'd']);
    expect(withUnreadMarker(withDaySeparators([A]), null)).toHaveLength(2);
  });
});
