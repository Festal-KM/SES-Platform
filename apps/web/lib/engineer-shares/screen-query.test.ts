// apps/web/lib/engineer-shares/screen-query.test.ts
// `S-015` の画面側 URL パラメータ（`screen-query.ts`）。T-11-11。
//
// 🔴 ここで固定するのは 5 点:
//   ① 既定フィルタは `共有中`（`U-15`）で、その既定は `ENGINEER_SHARE_DEFAULT_FILTER` の 1 か所
//   ② 画面の `all` は API へ渡すとき**省略**に写る（API の語彙 `true` / `false` / 省略 を守る）
//   ③ URL の組み立て（条件を保つ / 既定値は載せない / `cursor` を持たない）
//   ④ 効いている条件の列挙と「その条件だけを外した URL」（共有状態も条件の 1 つ）
//   ⑤ 空状態 4 通りの判定（台帳 0 件が最優先）
import { describe, expect, it } from 'vitest';
import {
  activeEngineerShareFilters,
  ENGINEER_SHARE_DEFAULT_FILTER,
  ENGINEER_SHARE_PATH,
  engineerShareApiSearch,
  engineerShareEmptyState,
  engineerShareScreenHref,
  engineerShareScreenQuerySchema,
  hasEngineerShareSearchTerms,
  toEngineerShareListQuery,
} from './screen-query';

describe('① 既定フィルタ = 共有中（`U-15`）', () => {
  it('`shared` が無い URL は `true`（共有中）と読む', () => {
    expect(ENGINEER_SHARE_DEFAULT_FILTER).toBe('true');
    expect(engineerShareScreenQuerySchema.parse({})).toEqual({ shared: 'true' });
    expect(engineerShareScreenQuerySchema.parse({ shared: '' })).toEqual({ shared: 'true' });
  });

  it('`all` を明示できる（API の省略と区別するための画面側の語）', () => {
    expect(engineerShareScreenQuerySchema.parse({ shared: 'all' }).shared).toBe('all');
    expect(engineerShareScreenQuerySchema.safeParse({ shared: '1' }).success).toBe(false);
  });

  it('画面のキーは `q` / `availableBy` / `shared` の 3 つ（`cursor` を持たない）', () => {
    expect(Object.keys(engineerShareScreenQuerySchema.shape).sort()).toEqual(['availableBy', 'q', 'shared']);
  });
});

describe('② 画面の条件 → API の query', () => {
  it('`all` は `shared` の省略に写り、`limit` は既定 50', () => {
    expect(toEngineerShareListQuery({ shared: 'all' })).toEqual({ limit: 50 });
    expect(toEngineerShareListQuery({ shared: 'true' })).toEqual({ shared: 'true', limit: 50 });
    expect(toEngineerShareListQuery({ shared: 'false', q: '合成', availableBy: '2026-10-31' })).toEqual({
      shared: 'false',
      q: '合成',
      availableBy: '2026-10-31',
      limit: 50,
    });
  });

  it('「次の 50 件」の query 文字列も同じ写し方（`all` は載せない。`cursor` は含まない）', () => {
    expect(engineerShareApiSearch({ shared: 'all' })).toBe('');
    expect(engineerShareApiSearch({ shared: 'true' })).toBe('shared=true');
    expect(engineerShareApiSearch({ shared: 'false', q: '合成' })).toBe(
      `q=${encodeURIComponent('合成')}&shared=false`,
    );
    expect(engineerShareApiSearch({ shared: 'true', availableBy: '2026-10-31' })).not.toContain('cursor');
  });
});

describe('③ 画面自身への URL', () => {
  it('既定値のフィルタは載せず、条件は保つ', () => {
    expect(engineerShareScreenHref({ shared: 'true' })).toBe(ENGINEER_SHARE_PATH);
    expect(engineerShareScreenHref({ shared: 'false' })).toBe('/engineer-shares?shared=false');
    expect(engineerShareScreenHref({ shared: 'all', q: '合成' })).toBe(
      `/engineer-shares?q=${encodeURIComponent('合成')}&shared=all`,
    );
  });

  it('組み立てた URL を読み戻すと同じ条件になる（往復）', () => {
    const screen = { shared: 'false' as const, q: '合成 太郎', availableBy: '2026-10-31' };
    const href = engineerShareScreenHref(screen);
    const params = Object.fromEntries(new URL(`https://app.test${href}`).searchParams.entries());
    expect(engineerShareScreenQuerySchema.parse(params)).toEqual(screen);
  });
});

describe('④ 効いている条件（1 つずつ外せる導線）', () => {
  it('条件なし・既定フィルタでも「共有状態: 共有中」は条件として列挙される（外す = すべて）', () => {
    const filters = activeEngineerShareFilters({ shared: 'true' });
    expect(filters.map((f) => f.key)).toEqual(['shared']);
    expect(filters[0]?.href).toBe('/engineer-shares?shared=all');
  });

  it('`all` のときは共有状態を条件として数えない', () => {
    expect(activeEngineerShareFilters({ shared: 'all' })).toEqual([]);
    expect(hasEngineerShareSearchTerms({ shared: 'all' })).toBe(false);
  });

  it('氏名 / 稼働可能時期はそれだけを外した URL を持つ', () => {
    const filters = activeEngineerShareFilters({ shared: 'false', q: '合成', availableBy: '2026-10-31' });
    expect(filters.map((f) => f.key)).toEqual(['q', 'availableBy', 'shared']);
    expect(filters[0]?.href).toBe('/engineer-shares?availableBy=2026-10-31&shared=false');
    expect(filters[1]?.href).toBe(`/engineer-shares?q=${encodeURIComponent('合成')}&shared=false`);
    expect(filters[2]?.href).toBe(`/engineer-shares?q=${encodeURIComponent('合成')}&availableBy=2026-10-31&shared=all`);
    expect(hasEngineerShareSearchTerms({ shared: 'false', q: '合成' })).toBe(true);
  });
});

describe('⑤ 空状態 4 通り（`docs/04` §S-015）', () => {
  it('台帳 0 件は条件の値に関わらず `LEDGER`', () => {
    expect(engineerShareEmptyState({ shared: 'true' }, false, 0)).toBe('LEDGER');
    expect(engineerShareEmptyState({ shared: 'false', q: '合成' }, false, 0)).toBe('LEDGER');
  });

  it('行があれば `null`', () => {
    expect(engineerShareEmptyState({ shared: 'true' }, true, 1)).toBeNull();
  });

  it('`共有中`・条件なし・0 件 → `SHARED_NONE` / `共有していない`・条件なし・0 件 → `ALL_SHARED`', () => {
    expect(engineerShareEmptyState({ shared: 'true' }, true, 0)).toBe('SHARED_NONE');
    expect(engineerShareEmptyState({ shared: 'false' }, true, 0)).toBe('ALL_SHARED');
  });

  it('氏名 / 稼働可能時期の条件あり・0 件 → `FILTERED`（フィルタの値に関わらず）', () => {
    expect(engineerShareEmptyState({ shared: 'true', q: '合成' }, true, 0)).toBe('FILTERED');
    expect(engineerShareEmptyState({ shared: 'false', availableBy: '2026-10-31' }, true, 0)).toBe('FILTERED');
    expect(engineerShareEmptyState({ shared: 'all', q: '合成' }, true, 0)).toBe('FILTERED');
  });
});
