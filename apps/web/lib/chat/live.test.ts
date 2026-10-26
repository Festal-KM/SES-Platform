// apps/web/lib/chat/live.test.ts
// `S-031` の新着の自動表示（`lib/chat/live.ts`）。
import { describe, expect, it } from 'vitest';
import { hasGapBefore, hasOthersMessage, mergeLatestMessages } from './live';
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

describe('withLatestReactions（2026-10-16）', () => {
  it('同じ発言のリアクションだけを取り直した値に揃え、変わらなければ同じ配列', async () => {
    const { withLatestReactions } = await import('./live');
    const current = [A, B];
    const fresh = { ...A, reactions: [{ reaction: 'OK' as const, count: 1, mine: false }] };
    const next = withLatestReactions(current, [fresh, C]);
    expect(next[0]?.reactions).toEqual(fresh.reactions);
    expect(next).toHaveLength(2);
    expect(withLatestReactions(current, [A, B])).toBe(current);
  });

  it('🔴 2026-10-26（Codex のレビュー）: 公開を取り消された案件のカードは、開いたままの画面でも消える（名前も ID も残さない）', async () => {
    const { withLatestReactions } = await import('./live');
    const card = { visible: true, id: 'p1', name: '金融系 Web 基盤', status: 'OPEN' } as unknown as NonNullable<typeof A.attachedProject>;
    const shown = { ...A, attachedProject: card };
    const hidden = { ...A, attachedProject: { visible: false } as NonNullable<typeof A.attachedProject> };
    const next = withLatestReactions([shown], [hidden]);
    expect(next[0]?.attachedProject).toEqual({ visible: false });
    expect(JSON.stringify(next)).not.toContain('金融系 Web 基盤');
    expect(JSON.stringify(next)).not.toContain('"p1"');
  });
});

describe('✅ 2026-10-26（#164 の 5）保存済みの印と送信者の状態も取り直した値に揃える', () => {
  it('別のタブで保存を外した・状態を消したら、開いたままの画面からも消える', async () => {
    const { withLatestReactions } = await import('./live');
    const shown = { ...A, saved: true, senderStatus: '商談中' };
    const fresh = { ...A, saved: false, senderStatus: null };
    const next = withLatestReactions([shown], [fresh]);
    expect(next[0]?.saved).toBe(false);
    expect(next[0]?.senderStatus).toBeNull();
    expect(JSON.stringify(next)).not.toContain('商談中');
  });
});

describe('✅ 2026-10-26（#166 の 4）hasGapBefore: 直近のページが手元とつながっていないか', () => {
  const D = message('d', '2026-10-14T04:00:00.000Z');
  const E = message('e', '2026-10-14T05:00:00.000Z');
  it('満杯で、1 件も重ならず、全部が手元より新しい → 取りこぼしあり', () => {
    expect(hasGapBefore([A, B], [D, E], 2)).toBe(true);
  });
  it('重なりがあればつながっている（取りこぼし無し）', () => {
    expect(hasGapBefore([A, B], [B, C], 2)).toBe(false);
  });
  it('満杯でなければ、全部取れている', () => {
    expect(hasGapBefore([A, B], [D], 2)).toBe(false);
  });
  it('手元が空なら何も足さない（初回の読み込みは直近のページで足りる）', () => {
    expect(hasGapBefore([], [D, E], 2)).toBe(false);
  });
  it('直近のページが手元より古い（並べ替え中の一時的な順序）なら取りこぼし扱いしない', () => {
    expect(hasGapBefore([D, E], [A, C], 2)).toBe(false);
  });
});
