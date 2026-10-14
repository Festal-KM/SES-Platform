// apps/web/lib/chat/live.test.ts
// `S-031` の新着の自動表示（`lib/chat/live.ts`）。
import { describe, expect, it } from 'vitest';
import { hasOthersMessage, mergeLatestMessages } from './live';
import type { ChatMessageView } from './views';

function message(id: string, sentAt: string, mine = false): ChatMessageView {
  return { id, sentAt, senderName: '佐藤', senderCompanyName: '株式会社サンプル', own: mine, mine, body: '本文' };
}

const A = message('a', '2026-10-14T01:00:00.000Z');
const B = message('b', '2026-10-14T02:00:00.000Z', true);
const C = message('c', '2026-10-14T03:00:00.000Z');

describe('mergeLatestMessages', () => {
  it('手元に無い行だけを足し、古い順に並べる', () => {
    const merged = mergeLatestMessages([A, B], [B, C]);
    expect(merged.items.map((item) => item.id)).toEqual(['a', 'b', 'c']);
    expect(merged.added.map((item) => item.id)).toEqual(['c']);
  });

  it('🔴 手元の行（過去を読み込んだ分）を消さない', () => {
    const older = message('o', '2026-10-13T00:00:00.000Z');
    const merged = mergeLatestMessages([older, A, B], [A, B, C]);
    expect(merged.items.map((item) => item.id)).toEqual(['o', 'a', 'b', 'c']);
  });

  it('何も足さなければ同じ配列を返す（再描画を起こさない）', () => {
    const current = [A, B];
    expect(mergeLatestMessages(current, [A, B]).items).toBe(current);
  });

  it('同じ時刻は ID で並べる', () => {
    const x = message('x', '2026-10-14T03:00:00.000Z');
    expect(mergeLatestMessages([C], [x]).items.map((item) => item.id)).toEqual(['c', 'x']);
  });
});

describe('hasOthersMessage', () => {
  it('相手の発言が 1 件でもあれば真（自分の発言だけなら偽）', () => {
    expect(hasOthersMessage([B])).toBe(false);
    expect(hasOthersMessage([B, C])).toBe(true);
    expect(hasOthersMessage([])).toBe(false);
  });
});
