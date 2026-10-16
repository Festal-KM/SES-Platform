// apps/web/lib/chat/read-state.test.ts
// `S-031` の既読位置の比較（`lib/chat/read-state.ts` の純粋な部分）。
import { describe, expect, it } from 'vitest';
import { isAfterPosition } from './read-state';

const at = (iso: string, id: string) => ({ sentAt: new Date(iso), id });

describe('isAfterPosition（既読位置より後ろか）', () => {
  it('まだ 1 件も読んでいなければ、すべて後ろ', () => {
    expect(isAfterPosition(at('2026-10-16T00:00:00.000Z', 'a'), null)).toBe(true);
  });

  it('時刻で比べ、同じ時刻は ID で比べる（会話の並び (sent_at, id) と同じ）', () => {
    const read = at('2026-10-16T01:00:00.000Z', 'm');
    expect(isAfterPosition(at('2026-10-16T02:00:00.000Z', 'a'), read)).toBe(true);
    expect(isAfterPosition(at('2026-10-16T00:00:00.000Z', 'z'), read)).toBe(false);
    expect(isAfterPosition(at('2026-10-16T01:00:00.000Z', 'n'), read)).toBe(true);
    expect(isAfterPosition(at('2026-10-16T01:00:00.000Z', 'l'), read)).toBe(false);
  });

  it('🔴 同じ位置は後ろではない（既読を巻き戻さない判定に使う）', () => {
    const read = at('2026-10-16T01:00:00.000Z', 'm');
    expect(isAfterPosition(read, read)).toBe(false);
  });
});
