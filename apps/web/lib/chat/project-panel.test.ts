// apps/web/lib/chat/project-panel.test.ts
// ✅ 2026-10-29: 案件カードから開く欄の中身（`lib/chat/project-panel.ts`）。
import { describe, expect, it } from 'vitest';
import { chatProjectPanelItems, pickChatProjectPanelDetail, type ChatProjectPanelLabels } from './project-panel';

const LABELS: ChatProjectPanelLabels = {
  statuses: { OPEN: '募集中', CLOSED: '終了' },
  remoteModes: { PARTIAL_REMOTE: '一部リモート' },
  prefectures: { '13': '東京都' },
  none: '—',
  yearsOrMore: '年以上',
  must: '必須',
  nice: '尚可',
  status: '状態',
  start: '開始',
  location: '勤務地',
  headcount: '募集人数',
  headcountUnit: '名',
  summary: '案件の概要',
};

const HOST_VIEW = {
  audience: 'HOST',
  id: '01930000-0000-7000-8000-0000000000f1',
  name: '架空の基幹刷新案件',
  status: 'OPEN',
  headcount: 2,
  startDate: '2026-11-01',
  unitPriceMin: 700000,
  unitPriceMax: 800000,
  prefecture: '13',
  remoteMode: 'PARTIAL_REMOTE',
  publicSummary: '公開用の概要',
  requirements: [
    { kind: 'MUST', skillId: null, skillName: 'TypeScript', freeText: null, requiredYears: 3 },
    { kind: 'NICE', skillId: null, skillName: null, freeText: '金融の経験', requiredYears: null },
  ],
  endClientName: '架空エンド株式会社',
  internalUnitPrice: 900000,
  visibilities: [{ partnerCompanyId: 'x', partnerCompanyName: '架空パートナー B', publishedOn: '2026-10-01' }],
};

describe('pickChatProjectPanelDetail', () => {
  it('🔴 エンド企業名・自社単価・公開先・単価レンジを拾わない（ホストの応答でも）', () => {
    const detail = pickChatProjectPanelDetail(HOST_VIEW);
    const text = JSON.stringify(detail);
    for (const forbidden of ['架空エンド株式会社', '900000', '700000', '800000', '架空パートナー B']) expect(text).not.toContain(forbidden);
    expect(Object.keys(detail ?? {}).sort()).toEqual(
      ['headcount', 'must', 'name', 'nice', 'prefecture', 'publicSummary', 'remoteMode', 'startDate', 'status'].sort(),
    );
  });

  it('形が違う応答は null（欄を開かない）', () => {
    expect(pickChatProjectPanelDetail(null)).toBeNull();
    expect(pickChatProjectPanelDetail({ error: { code: 'NOT_FOUND' } })).toBeNull();
  });
});

describe('chatProjectPanelItems', () => {
  it('状態・開始・勤務地・募集人数・必須・尚可・概要を並べる', () => {
    const detail = pickChatProjectPanelDetail(HOST_VIEW);
    if (detail === null) throw new Error('detail');
    expect(chatProjectPanelItems(detail, LABELS)).toEqual([
      { label: '状態', value: '募集中' },
      { label: '開始', value: '2026-11-01' },
      { label: '勤務地', value: '東京都・一部リモート' },
      { label: '募集人数', value: '2名' },
      { label: '必須', value: 'TypeScript 3 年以上' },
      { label: '尚可', value: '金融の経験' },
      { label: '案件の概要', value: '公開用の概要' },
    ]);
  });

  it('値が無ければ —', () => {
    const detail = pickChatProjectPanelDetail({ name: '案件', requirements: [] });
    if (detail === null) throw new Error('detail');
    expect(chatProjectPanelItems(detail, LABELS).every((item) => item.value === '—')).toBe(true);
  });
});
