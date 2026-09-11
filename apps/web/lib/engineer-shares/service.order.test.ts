// apps/web/lib/engineer-shares/service.order.test.ts
// `orderedShareCandidates`（`S-015` の一覧の並び）の決定性。T-08-02。
//
// 🔴 なぜ要るか: `listEngineerShares` は **2 本のクエリ**（上限つきのページ + 上限の外に
//    落ちた共有中の拾い直し）の結果をアプリ層でまとめる。まとめ方が配列の連結順に
//    依存すると、**拾い直しが起きたときだけ並びが変わる**（同じデータで画面の並びが揺れる）。
//    規則は DB 側の `ENGINEER_LIST_ORDER_BY`（`updated_at DESC, id DESC`）と同じである。
import { describe, expect, it } from 'vitest';
import { orderedShareCandidates } from './service';

const row = (id: string, updatedAt: string) => ({ id, updatedAt: new Date(updatedAt) });

describe('orderedShareCandidates', () => {
  it('更新日時の降順に並べる', () => {
    const sorted = orderedShareCandidates([
      row('a', '2026-09-01T00:00:00.000Z'),
      row('b', '2026-09-03T00:00:00.000Z'),
      row('c', '2026-09-02T00:00:00.000Z'),
    ]);
    expect(sorted.map((r) => r.id)).toEqual(['b', 'c', 'a']);
  });

  it('🔴 同じ更新日時は `id` の降順でタイブレークする（`ENGINEER_LIST_ORDER_BY` と同じ規則）', () => {
    const sorted = orderedShareCandidates([
      row('a', '2026-09-01T00:00:00.000Z'),
      row('c', '2026-09-01T00:00:00.000Z'),
      row('b', '2026-09-01T00:00:00.000Z'),
    ]);
    expect(sorted.map((r) => r.id)).toEqual(['c', 'b', 'a']);
  });

  it('🔴 入力の順序が違っても結果が同じ（2 本のクエリの連結順に依存しない）', () => {
    const page = [row('p1', '2026-09-05T00:00:00.000Z'), row('p2', '2026-09-04T00:00:00.000Z')];
    const pinned = [row('s1', '2026-09-06T00:00:00.000Z'), row('s2', '2026-09-04T00:00:00.000Z')];

    const forward = orderedShareCandidates([...page, ...pinned]).map((r) => r.id);
    const backward = orderedShareCandidates([...pinned, ...page]).map((r) => r.id);

    expect(forward).toEqual(backward);
    // `p2` と `s2` は更新日時が同じなので `id` の降順（`s2` → `p2`）で決まる。
    expect(forward).toEqual(['s1', 'p1', 's2', 'p2']);
  });

  it('同じ ID が両方のクエリに現れても 1 件に畳む（重複表示を作らない）', () => {
    const duplicated = row('x', '2026-09-05T00:00:00.000Z');
    expect(orderedShareCandidates([duplicated, { ...duplicated }])).toHaveLength(1);
  });

  it('10 回実行しても同じ並びになる（決定性）', () => {
    const rows = [
      row('e', '2026-09-01T00:00:00.000Z'),
      row('d', '2026-09-02T00:00:00.000Z'),
      row('c', '2026-09-02T00:00:00.000Z'),
      row('b', '2026-09-03T00:00:00.000Z'),
      row('a', '2026-09-03T00:00:00.000Z'),
    ];
    const first = orderedShareCandidates(rows).map((r) => r.id);
    for (let i = 0; i < 10; i += 1) {
      expect(orderedShareCandidates(rows).map((r) => r.id)).toEqual(first);
    }
    expect(first).toEqual(['b', 'a', 'd', 'c', 'e']);
  });
});
