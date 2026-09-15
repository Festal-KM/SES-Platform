// apps/web/lib/candidates/list.test.ts
// T-08-05: 自社候補と匿名候補のマージ順序の決定性（`docs/sprints/SP-08` T-08-05 完了の判定
// 「マージ順序の決定性テスト（10 回実行で一致）」/ docs/05 §4.6「自社候補との混在の並びとページング」）。
//
// 🔴 ここで固定するのは**純粋な部分**（比較子・ページの切り出し・判別）である。DB を伴う経路
//    （2 本のクエリ・監査・`MatchCandidate` の置き換え）は `tests/isolation/project-candidates.test.ts`。
import { describe, expect, it } from 'vitest';
import {
  compareCandidateSortKeys,
  isAnonymousCandidateView,
  sliceCandidatePage,
  type CandidateListItem,
} from './list';
import { decodeCandidateCursor, encodeCandidateCursor, type CandidateSortKey } from './schemas';

/**
 * 22 文字の base64url を決定的に作る（HMAC の代わり。形だけを揃える）。
 * 🔴 seed が違えば必ず別の値になる（36 進表現を `A` で埋める。すべて base64url の文字）。
 */
function ref(seed: number): string {
  return seed.toString(36).padStart(22, 'A');
}

type Entry = { readonly key: CandidateSortKey; readonly label: string };

function entry(bucket: 0 | 1, updatedOn: string, seed: number, label: string): Entry {
  return { key: { bucket, updatedOn, sortRef: ref(seed) }, label };
}

/** 決定的な疑似乱数でシャッフルする（入力の並びに依存しないことの対照に使う）。 */
function shuffled<T>(items: readonly T[], seed: number): T[] {
  const out = [...items];
  let state = seed;
  for (let i = out.length - 1; i > 0; i -= 1) {
    state = (state * 1103515245 + 12345) % 4294967296;
    const j = state % (i + 1);
    const a = out[i] as T;
    out[i] = out[j] as T;
    out[j] = a;
  }
  return out;
}

const ENTRIES: readonly Entry[] = [
  entry(0, '2026-09-10', 1, 'own-a'),
  entry(0, '2026-09-10', 2, 'anon-b'),
  entry(0, '2026-09-10', 3, 'own-c'),
  entry(0, '2026-09-08', 4, 'anon-d'),
  entry(0, '2026-09-08', 5, 'own-e'),
  entry(1, '2026-09-12', 6, 'own-f'),
  entry(1, '2026-09-12', 7, 'anon-g'),
  entry(1, '2026-09-01', 8, 'anon-h'),
];

describe('compareCandidateSortKeys（バケット → updatedOn 降順 → sortRef 昇順）', () => {
  it('バケットが先、次に更新日の新しい順、同日は参照子の昇順', () => {
    const a: CandidateSortKey = { bucket: 0, updatedOn: '2026-09-01', sortRef: ref(1) };
    const b: CandidateSortKey = { bucket: 1, updatedOn: '2026-09-30', sortRef: ref(2) };
    expect(compareCandidateSortKeys(a, b)).toBeLessThan(0);
    const c: CandidateSortKey = { bucket: 0, updatedOn: '2026-09-10', sortRef: ref(3) };
    expect(compareCandidateSortKeys(c, a)).toBeLessThan(0);
    const [low, high] = [ref(3), ref(9)].sort() as [string, string];
    expect(compareCandidateSortKeys({ ...c, sortRef: low }, { ...c, sortRef: high })).toBeLessThan(0);
    expect(compareCandidateSortKeys({ ...c, sortRef: high }, { ...c, sortRef: low })).toBeGreaterThan(0);
    expect(compareCandidateSortKeys(c, c)).toBe(0);
  });
});

describe('🔴 マージ順序の決定性（10 回実行で一致）', () => {
  it('入力の並びをシャッフルして 10 回実行しても、同じ並び・同じカーソルになる', () => {
    const baseline = sliceCandidatePage(ENTRIES, undefined, 5);
    for (let run = 1; run <= 10; run += 1) {
      const page = sliceCandidatePage(shuffled(ENTRIES, run * 7919), undefined, 5);
      expect(page.items.map((e) => e.label)).toEqual(baseline.items.map((e) => e.label));
      expect(page.nextCursor).toBe(baseline.nextCursor);
    }
  });

  it('並びはバケット 0 → 更新日の新しい順 → 同日は参照子の昇順（自社と匿名が同じ比較子で混ざる）', () => {
    const page = sliceCandidatePage(ENTRIES, undefined, 100);
    const labels = page.items.map((e) => e.label);
    // バケット 0 が全部先で、その中は 09-10 → 09-08。バケット 1 は 09-12 → 09-01。
    expect(labels.slice(0, 5).every((l) => ['own-a', 'anon-b', 'own-c', 'anon-d', 'own-e'].includes(l))).toBe(true);
    expect(labels.slice(5)).toEqual(
      [...ENTRIES.filter((e) => e.key.bucket === 1)]
        .sort((a, b) => compareCandidateSortKeys(a.key, b.key))
        .map((e) => e.label),
    );
    // 同日内は参照子の昇順（own / anon の種別で分かれない）。
    const sameDay = page.items.filter((e) => e.key.updatedOn === '2026-09-10' && e.key.bucket === 0);
    expect(sameDay.map((e) => e.key.sortRef)).toEqual([...sameDay.map((e) => e.key.sortRef)].sort());
    expect(page.nextCursor).toBeNull();
  });

  it('🔴 順位・連番のフィールドを持たない（並びは比較子だけが決める）', () => {
    const page = sliceCandidatePage(ENTRIES, undefined, 100);
    for (const item of page.items) {
      expect(Object.keys(item).sort()).toEqual(['key', 'label']);
    }
  });
});

describe('カーソル（並びのキー）', () => {
  it('ページを順に辿ると重複も欠落も無く全件を 1 回ずつ通る', () => {
    const seen: string[] = [];
    let cursor: CandidateSortKey | undefined;
    for (let guard = 0; guard < 10; guard += 1) {
      const page = sliceCandidatePage(ENTRIES, cursor, 3);
      seen.push(...page.items.map((e) => e.label));
      if (page.nextCursor === null) break;
      cursor = decodeCandidateCursor(page.nextCursor);
    }
    expect(seen).toHaveLength(ENTRIES.length);
    expect(new Set(seen).size).toBe(ENTRIES.length);
  });

  it('境目の行が消えても次ページは「そのキーより後ろ」として決まる（0 件のページにならない）', () => {
    const first = sliceCandidatePage(ENTRIES, undefined, 3);
    const boundary = first.items[2] as Entry;
    const withoutBoundary = ENTRIES.filter((e) => e.label !== boundary.label);
    const next = sliceCandidatePage(withoutBoundary, decodeCandidateCursor(first.nextCursor as string), 3);
    const expected = sliceCandidatePage(ENTRIES, decodeCandidateCursor(first.nextCursor as string), 3);
    expect(next.items.map((e) => e.label)).toEqual(expected.items.map((e) => e.label));
  });

  it('全件より後ろを指すカーソルは空のページ（500 にしない）', () => {
    const last: CandidateSortKey = { bucket: 1, updatedOn: '0001-01-01', sortRef: '~'.repeat(22) };
    expect(sliceCandidatePage(ENTRIES, last, 3)).toEqual({ items: [], nextCursor: null });
  });

  it('encode / decode は往復する', () => {
    const key: CandidateSortKey = { bucket: 1, updatedOn: '2026-09-08', sortRef: ref(42) };
    expect(decodeCandidateCursor(encodeCandidateCursor(key))).toEqual(key);
  });
});

describe('isAnonymousCandidateView', () => {
  it('`candidateRef` を持つものだけが匿名候補', () => {
    const anonymous = {
      candidateRef: ref(1),
      skills: [],
      yearsBand: null,
      priceBand: null,
      availabilityBand: null,
      prefecture: null,
      remoteMode: null,
      updatedOn: '2026-09-10',
    } satisfies CandidateListItem;
    const own = {
      id: '01930000-0000-7000-8000-0000000000e1',
      displayName: '架空 太郎',
      ownership: 'HOST',
      primarySkills: [],
      moreSkillCount: 0,
      unitPriceMin: null,
      unitPriceMax: null,
      availability: 'WORKING',
      availableFrom: null,
      prefecture: null,
      remoteMode: null,
      updatedOn: '2026-09-10',
      yearsMax: null,
    } satisfies CandidateListItem;
    expect(isAnonymousCandidateView(anonymous)).toBe(true);
    expect(isAnonymousCandidateView(own)).toBe(false);
  });
});
