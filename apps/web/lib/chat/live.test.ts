// apps/web/lib/chat/live.test.ts
// `S-031` の新着の自動表示（`lib/chat/live.ts`）。
import { describe, expect, it } from 'vitest';
import { applyLatestMessages, gapAnchor, hasGapBefore, hasOthersMessage, mergeLatestMessages, mustReplaceWithLatest, readGapAfter, withLatestReactions } from './live';
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

describe('✅ 2026-10-26（#166 の 4・レビュー）readGapAfter: 最新まで読み切れたかを返す', () => {
  const chunk = (ids: readonly string[], hasMoreAfter: boolean) => ({
    items: ids.map((id, index) => message(id, `2026-10-14T0${String(index + 4)}:00:00.000Z`)),
    hasMoreAfter,
  });
  it('続きが無くなるまで読めたら complete', async () => {
    const pages = [chunk(['d', 'e'], true), chunk(['f'], false)];
    const result = await readGapAfter('c', async () => pages.shift() ?? null, 10);
    expect(result?.complete).toBe(true);
    expect(result?.items.map((item) => item.id)).toEqual(['d', 'e', 'f']);
  });
  it('🔴 上限で止まったら complete ではない（呼び出し側は直近のページを足さない）', async () => {
    let calls = 0;
    const result = await readGapAfter('c', async () => {
      calls += 1;
      return chunk([`x${String(calls)}`], true);
    }, 3);
    expect(calls).toBe(3);
    expect(result?.complete).toBe(false);
    expect(result?.items).toHaveLength(3);
  });
  it('1 回でも読めなければ null（今回は何も足さない）', async () => {
    const pages = [chunk(['d'], true), null];
    expect(await readGapAfter('c', async () => pages.shift() ?? null, 10)).toBeNull();
  });
  it('続きは、前の回の最後の発言から読む', async () => {
    const seen: string[] = [];
    const pages = [chunk(['d', 'e'], true), chunk(['f'], false)];
    await readGapAfter('c', async (after) => {
      seen.push(after);
      return pages.shift() ?? null;
    }, 10);
    expect(seen).toEqual(['c', 'e']);
  });
});

// ✅ 2026-10-27（Codex レビュー 2 回目）: 検査が CLEAN になった添付の発言は、公開した時点の位置へ移る。
describe('位置（sentAt）が動いた行', () => {
  const MOVED_A = { ...A, sentAt: '2026-10-14T04:00:00.000Z' };

  it('withLatestReactions は手元の行の sentAt を揃え、(sentAt, id) で並べ直す（行は落とさない）', () => {
    const next = withLatestReactions([A, B, C], [MOVED_A, B, C]);
    expect(next.map((item) => item.id)).toEqual(['b', 'c', 'a']);
    expect(next.find((item) => item.id === 'a')?.sentAt).toBe(MOVED_A.sentAt);
    expect(next.at(-1)?.id).toBe('a');
  });

  it('mergeLatestMessages も手元の行の位置を揃えて並べ直す（新着が無くても）', () => {
    const merged = mergeLatestMessages([A, B, C], [MOVED_A, B, C]);
    expect(merged.items.map((item) => item.id)).toEqual(['b', 'c', 'a']);
    expect(merged.added).toEqual([]);
    const withNew = mergeLatestMessages([A, B], [MOVED_A, B, C]);
    expect(withNew.items.map((item) => item.id)).toEqual(['b', 'c', 'a']);
    expect(withNew.added.map((item) => item.id)).toEqual(['c']);
  });

  it('位置が変わらなければ同じ配列を返す（再描画を起こさない）', () => {
    const current = [A, B];
    expect(withLatestReactions(current, [A, B])).toBe(current);
    expect(mergeLatestMessages(current, [A, B]).items).toBe(current);
  });
});

// ✅ 2026-10-27（Codex レビュー 3 回目）: 動いた行があるときの取りこぼし。
describe('🔴 位置が動いた行があっても取りこぼさない', () => {
  // 手元 [A(添付・検査中), B]。その後 C, D が届き、A が CLEAN になって最後尾へ移った。直近のページ（2 件）は [D, A']。
  const LOCAL_A = message('a', '2026-10-27T01:00:00.000Z', true);
  const LOCAL_B = message('b', '2026-10-27T02:00:00.000Z');
  const NEW_C = message('c', '2026-10-27T03:00:00.000Z');
  const NEW_D = message('d', '2026-10-27T04:00:00.000Z');
  const MOVED = { ...LOCAL_A, sentAt: '2026-10-27T05:00:00.000Z' };

  it('直近のページに手元の行（動いたもの）が含まれていても、つながっていないと判定し、起点は動いていない手元の最後（B）', () => {
    expect(hasGapBefore([LOCAL_A, LOCAL_B], [NEW_D, MOVED], 2)).toBe(true);
    expect(gapAnchor([LOCAL_A, LOCAL_B], [NEW_D, MOVED])).toBe('b');
  });

  it('B から読み足した行と直近のページを当てると、C を落とさず (sentAt, id) の順に並ぶ', async () => {
    const gap = await readGapAfter(
      'b',
      async (after) => {
        expect(after).toBe('b');
        return { items: [NEW_C, NEW_D, MOVED], hasMoreAfter: false };
      },
      10,
    );
    expect(gap?.complete).toBe(true);
    const latest = [...(gap?.items ?? []), NEW_D, MOVED];
    const applied = applyLatestMessages([LOCAL_A, LOCAL_B], latest);
    expect(applied.items.map((item) => item.id)).toEqual(['b', 'c', 'd', 'a']);
    expect(applied.added.map((item) => item.id)).toEqual(['c', 'd']);
  });

  it('動いた行が無く重なっていれば、従来どおりつながっている', () => {
    expect(hasGapBefore([LOCAL_A, LOCAL_B], [LOCAL_B, NEW_C], 2)).toBe(false);
  });

  it('🔴 読み足しを待つ間に「以前のメッセージ」が読み込まれても、当てる時点の手元に当てるので古い行を落とさない', () => {
    const older = message('o', '2026-10-26T00:00:00.000Z');
    // 読み足しを始めた時点の手元は [A, B]。当てる時点の手元は [O, A, B]（過去を読み込んだ）。
    const atApply = [older, LOCAL_A, LOCAL_B];
    const applied = applyLatestMessages(atApply, [NEW_C, NEW_D, MOVED]);
    expect(applied.items.map((item) => item.id)).toEqual(['o', 'b', 'c', 'd', 'a']);
  });
});

// ✅ 2026-10-27（Codex レビュー 4 回目）: 手元の行がすべて位置を動かしたとき。
describe('🔴 手元の行がすべて動いたら、足し合わせずに置き換える', () => {
  const ONLY_A = message('a', '2026-10-27T01:00:00.000Z', true);
  const MOVED_A = { ...ONLY_A, sentAt: '2026-10-27T09:00:00.000Z' };
  const page = [message('x', '2026-10-27T08:00:00.000Z'), MOVED_A];

  it('手元が検査中の添付 1 件だけで、それが多くの新着の後に CLEAN になった → つながりも起点も無いので置き換える', () => {
    expect(hasGapBefore([ONLY_A], page, 2)).toBe(false);
    expect(gapAnchor([ONLY_A], page)).toBeUndefined();
    expect(mustReplaceWithLatest([ONLY_A], page, 2)).toBe(true);
  });

  it('直近のページが満杯でなければ（会話の全部が入っている）置き換えない', () => {
    expect(mustReplaceWithLatest([ONLY_A], [MOVED_A], 2)).toBe(false);
  });

  it('位置が動いていない手元の行が 1 つでもあれば置き換えない（読み足しで埋める）', () => {
    const local = [ONLY_A, message('b', '2026-10-27T02:00:00.000Z')];
    expect(mustReplaceWithLatest(local, page, 2)).toBe(false);
    expect(gapAnchor(local, page)).toBe('b');
  });

  it('手元が空なら置き換えの対象ではない（ふつうに足す）', () => {
    expect(mustReplaceWithLatest([], page, 2)).toBe(false);
  });
});
