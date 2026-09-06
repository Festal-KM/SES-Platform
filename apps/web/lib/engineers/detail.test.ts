// apps/web/lib/engineers/detail.test.ts
// `S-006`（エンジニア詳細）の表示値の組み立て（docs/04 §S-006）。T-05-02。
//
// 🔴 ここで固定するのは「判断材料を落とさないこと」である（`CLAUDE.md` §13.3 /
//    `docs/01` §1.2-2）: 片側だけの単価レンジを `—` に畳まない、未設定と 0 を混同しない、
//    値集合の外の値で画面を落とさない。
// 🔴 **`BR-52` / `F-008 AC-1`**: 基本情報の行に連絡先・本籍・家族構成・健康情報・信条にあたる
//    項目が 1 つも現れないことも、ここで固定する（型に無いだけでなく、出力にも無い）。
import { describe, expect, it } from 'vitest';
import { t } from '@ses/i18n';
import {
  engineerBasicRows,
  engineerDetailSkillRows,
  engineerHeadlineRows,
  formatUnitPriceRange,
  formatYears,
} from './detail';
import type { EngineerDetailView } from './service';

const NONE = t('engineers.detail.valueNone');

function view(overrides: Partial<EngineerDetailView> = {}): EngineerDetailView {
  return {
    id: '01930000-0000-7000-8000-0000000000e1',
    displayName: '架空 太郎',
    ownership: 'HOST',
    availability: 'WORKING',
    availableFrom: '2026-10-01',
    unitPriceMin: 650000,
    unitPriceMax: 750000,
    prefecture: '13',
    remoteMode: 'PARTIAL_REMOTE',
    preferenceNote: '長期案件を希望',
    skills: [],
    ...overrides,
  };
}

// 🔴 `formatThousands` そのものの検証は `lib/format/number.test.ts` へ移した（T-06-02。
//    案件詳細も同じ書式を使うようになったため）。ここに残すのは**人材の語彙で束ねた結果**である。
describe('formatUnitPriceRange（🔴 片側だけの登録を畳まない。語は engineers.* から引く）', () => {
  it('両端がある', () => {
    expect(formatUnitPriceRange(650000, 750000)).toBe(`650,000〜750,000 ${t('engineers.unitPrice.unit')}`);
  });

  it('下限だけ', () => {
    expect(formatUnitPriceRange(600000, null)).toBe(
      `600,000 ${t('engineers.detail.unitPrice.orMore')}`,
    );
  });

  it('上限だけ', () => {
    expect(formatUnitPriceRange(null, 700000)).toBe(
      `700,000 ${t('engineers.detail.unitPrice.orLess')}`,
    );
  });

  it('未設定は `—`', () => {
    expect(formatUnitPriceRange(null, null)).toBe(NONE);
  });

  it('🔴 0 を未設定として畳まない（無償の合意も情報である）', () => {
    expect(formatUnitPriceRange(0, 0)).toBe(`0〜0 ${t('engineers.unitPrice.unit')}`);
  });
});

describe('engineerHeadlineRows（🔴 折りたたみの外に出す 3 値。CLAUDE.md §13.3）', () => {
  it('稼働状況・稼働可能時期・単価レンジの順で 3 行', () => {
    const rows = engineerHeadlineRows(view());
    expect(rows.map((row) => row.key)).toEqual(['availability', 'availableFrom', 'unitPrice']);
    expect(rows[0]?.value).toBe(t('engineers.availability.WORKING'));
    expect(rows[1]?.value).toBe('2026-10-01');
  });

  it('稼働可能時期が未設定なら `—`（空欄にしない）', () => {
    expect(engineerHeadlineRows(view({ availableFrom: null }))[1]?.value).toBe(NONE);
  });
});

describe('engineerBasicRows', () => {
  it('所属区分は引数（ctx 由来）の表示をそのまま使う', () => {
    const rows = engineerBasicRows(view({ ownership: 'HOST' }), t('engineers.ownership.partner'));
    expect(rows[0]?.key).toBe('ownership');
    expect(rows[0]?.value).toBe(t('engineers.ownership.partner'));
  });

  it('勤務地・リモート・希望条件が出る', () => {
    const rows = engineerBasicRows(view(), t('engineers.ownership.host'));
    const byKey = new Map(rows.map((row) => [row.key, row.value]));
    expect(byKey.get('prefecture')).toBe(t('prefecture.13'));
    expect(byKey.get('remoteMode')).toBe(t('engineers.remoteMode.PARTIAL_REMOTE'));
    expect(byKey.get('preferenceNote')).toBe('長期案件を希望');
  });

  it('未設定の項目は `—`（空文字の希望条件も含む）', () => {
    const rows = engineerBasicRows(
      view({ prefecture: null, remoteMode: null, preferenceNote: '' }),
      t('engineers.ownership.host'),
    );
    const byKey = new Map(rows.map((row) => [row.key, row.value]));
    expect(byKey.get('prefecture')).toBe(NONE);
    expect(byKey.get('remoteMode')).toBe(NONE);
    expect(byKey.get('preferenceNote')).toBe(NONE);
  });

  it('🔴 BR-52: 連絡先・本籍・家族構成・健康情報・信条にあたる行が 1 つも無い', () => {
    const rows = engineerBasicRows(view(), t('engineers.ownership.host'));
    expect(rows.map((row) => row.key)).toEqual([
      'ownership',
      'availability',
      'availableFrom',
      'unitPrice',
      'prefecture',
      'remoteMode',
      'preferenceNote',
    ]);
  });
});

describe('engineerDetailSkillRows', () => {
  it('スキル別の経験年数とレベルを出す', () => {
    const rows = engineerDetailSkillRows([
      { skillId: 's1', name: 'Java', yearsOfExperience: 8, level: 4 },
      { skillId: 's2', name: 'AWS', yearsOfExperience: 2.5, level: null },
    ]);

    expect(rows[0]).toEqual({
      skillId: 's1',
      name: 'Java',
      years: formatYears(8),
      level: t('engineers.skills.level.4'),
    });
    // レベル未設定は「未設定」（`—` とは書き分ける。登録されていないことが分かる語にする）。
    expect(rows[1]?.years).toBe(`2.5 ${t('engineers.detail.years.unit')}`);
    expect(rows[1]?.level).toBe(t('engineers.skills.level.unset'));
  });

  it('🔴 値集合の外のレベル（DB 直更新など）で落ちない', () => {
    const rows = engineerDetailSkillRows([
      { skillId: 's3', name: 'Go', yearsOfExperience: 1, level: 9 },
    ]);
    expect(rows[0]?.level).toBe(NONE);
  });

  it('スキルが無ければ空配列（呼び出し側が空状態を出す）', () => {
    expect(engineerDetailSkillRows([])).toEqual([]);
  });
});
