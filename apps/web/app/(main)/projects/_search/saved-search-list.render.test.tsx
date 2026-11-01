import { describe, expect, it } from 'vitest';
import { EMPTY_PROJECT_SEARCH_DRAFT, type ProjectSearchChip } from './filters';
import { visibleSavedSearches } from './saved-search-list';
import type { SavedSearch } from './saved-searches';

const item = (id: string, name: string, updatedAt: string, lastUsedAt?: string): SavedSearch => ({
  id, name, updatedAt, ...(lastUsedAt === undefined ? {} : { lastUsedAt }),
  filters: { ...EMPTY_PROJECT_SEARCH_DRAFT, q: id },
});
const chipsOf = (saved: SavedSearch): readonly ProjectSearchChip[] => [
  { key: 'skill', label: saved.id === 'a' ? 'Python' : 'Java' },
  { key: 'mode', label: 'フルリモート可' },
  { key: 'extra', label: '東京都' },
];
const items = [item('a', '分析案件', '2026-10-01'), item('b', '基幹システム', '2026-10-02')];

describe('保存条件の検索と並べ替え', () => {
  it('保存名と条件全文を横断してAND検索する（省略するバッジも対象）', () => {
    expect(visibleSavedSearches(items, '分析 python 東京都', 'RECENT', chipsOf).map((row) => row.id)).toEqual(['a']);
    expect(visibleSavedSearches(items, '分析 Java', 'RECENT', chipsOf)).toEqual([]);
  });
  it('最近の適用時刻を使い、古い形式の条件は更新日時で並べる', () => {
    const used = { ...items[0]!, lastUsedAt: '2026-10-03' };
    expect(visibleSavedSearches([used, items[1]!], '', 'RECENT', chipsOf).map((row) => row.id)).toEqual(['a', 'b']);
    expect(visibleSavedSearches([used, items[1]!], '', 'UPDATED', chipsOf).map((row) => row.id)).toEqual(['b', 'a']);
  });
  it('名前順が日時から独立しており、元の保存順を変更しない', () => {
    const data = [item('z', 'Zebra', '2026-10-03'), item('a', 'Alpha', '2026-10-01')];
    expect(visibleSavedSearches(data, '', 'NAME', chipsOf).map((row) => row.name)).toEqual(['Alpha', 'Zebra']);
    expect(data.map((row) => row.id)).toEqual(['z', 'a']);
  });
});
