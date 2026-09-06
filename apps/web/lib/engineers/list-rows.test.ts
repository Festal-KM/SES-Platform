// apps/web/lib/engineers/list-rows.test.ts
// `S-005`（一覧）の表示値（docs/04 §S-005）。T-05-09。
//
// 🔴 ここで固定するのは「上位 3 件の選び方が決定的であること」（`F-009 AC-1`）と
//    「母集団の文言がホストと取引先で分かれること」（docs/04 §3.2 項目 2）である。
//    どちらも DB を要らない純粋関数であり、画面（`app/**`）に置くとテストできない。
import { describe, expect, it } from 'vitest';
import { t } from '@ses/i18n';
import {
  engineerListRow,
  engineerPopulationLabel,
  formatLocation,
  pickPrimarySkills,
  PRIMARY_SKILL_LIMIT,
} from './list-rows';
import type { OwnEngineerView } from './list';

const PARTNER_ID = '01930000-0000-7000-8000-0000000000c1';

function skill(skillId: string, yearsOfExperience: number) {
  return { skillId, yearsOfExperience };
}

function view(overrides: Partial<OwnEngineerView> = {}): OwnEngineerView {
  return {
    id: '01930000-0000-7000-8000-0000000000e1',
    displayName: '架空 太郎',
    ownership: 'HOST',
    primarySkills: [{ skillId: 's1', name: 'Java' }],
    moreSkillCount: 0,
    unitPriceMin: 600000,
    unitPriceMax: 750000,
    availability: 'WORKING',
    availableFrom: '2026-11-01',
    prefecture: '13',
    remoteMode: 'PARTIAL_REMOTE',
    updatedOn: '2026-09-05',
    ...overrides,
  };
}

describe('pickPrimarySkills（🔴 決定的な選び方。F-009 AC-1）', () => {
  it('経験年数の降順で上位 3 件を選ぶ', () => {
    const picked = pickPrimarySkills([
      skill('c', 3),
      skill('a', 10),
      skill('d', 1),
      skill('b', 8),
    ]);
    expect(picked.shown.map((entry) => entry.skillId)).toEqual(['a', 'b', 'c']);
    expect(picked.more).toBe(1);
  });

  it('🔴 経験年数が同じなら skillId の昇順（docs/02 `F-017` 処理②と同じ規則）', () => {
    const picked = pickPrimarySkills([skill('z', 5), skill('a', 5), skill('m', 5)]);
    expect(picked.shown.map((entry) => entry.skillId)).toEqual(['a', 'm', 'z']);
  });

  it('🔴 入力の順序が変わっても結果が変わらない（実行のたびに同じ並び）', () => {
    const skills = [skill('b', 5), skill('a', 5), skill('c', 9), skill('d', 1)];
    const first = pickPrimarySkills(skills).shown.map((entry) => entry.skillId);
    const second = pickPrimarySkills([...skills].reverse()).shown.map((entry) => entry.skillId);
    expect(first).toEqual(second);
    expect(first).toEqual(['c', 'a', 'b']);
  });

  it('🔴 入力の配列を破壊しない', () => {
    const skills = [skill('b', 1), skill('a', 9)];
    pickPrimarySkills(skills);
    expect(skills.map((entry) => entry.skillId)).toEqual(['b', 'a']);
  });

  it('3 件以下なら超過は 0', () => {
    expect(pickPrimarySkills([skill('a', 1), skill('b', 2)]).more).toBe(0);
    expect(pickPrimarySkills([]).shown).toEqual([]);
  });

  it('既定の上限は 3（docs/04 §S-005「上位 3 のみ表示」）', () => {
    expect(PRIMARY_SKILL_LIMIT).toBe(3);
    expect(pickPrimarySkills([skill('a', 1), skill('b', 2), skill('c', 3), skill('d', 4)]).shown)
      .toHaveLength(3);
  });
});

describe('formatLocation（勤務地・リモートを 1 列に畳む）', () => {
  it('両方あれば「都道府県・リモート可否」', () => {
    expect(formatLocation('13', 'FULL_REMOTE')).toBe(
      `${t('prefecture.13')}・${t('engineers.remoteMode.FULL_REMOTE')}`,
    );
  });

  it('🔴 片方しか無くても `—` に畳まない（片側でも営業判断に使える）', () => {
    expect(formatLocation('13', null)).toBe(t('prefecture.13'));
    expect(formatLocation(null, 'ONSITE_ONLY')).toBe(t('engineers.remoteMode.ONSITE_ONLY'));
  });

  it('どちらも無ければ `—`', () => {
    expect(formatLocation(null, null)).toBe(t('engineers.detail.valueNone'));
  });
});

describe('engineerListRow（1 行分の表示値）', () => {
  it('スキル名・単価・稼働状況・更新日を文字列にする', () => {
    const row = engineerListRow(
      view({
        primarySkills: [
          { skillId: 's1', name: 'Java' },
          { skillId: 's2', name: 'AWS' },
        ],
        moreSkillCount: 2,
      }),
    );
    expect(row.skills).toEqual(['Java', 'AWS']);
    expect(row.moreSkills).toBe('+2');
    expect(row.unitPrice).toContain('600,000');
    expect(row.availability).toBe(t('engineers.availability.WORKING'));
    expect(row.updatedOn).toBe('2026-09-05');
  });

  it('🔴 超過が 0 件なら `+0` を描かない', () => {
    expect(engineerListRow(view({ moreSkillCount: 0 })).moreSkills).toBeNull();
  });

  it('稼働可能時期が未設定なら `—`', () => {
    expect(engineerListRow(view({ availableFrom: null })).availableFrom).toBe(
      t('engineers.detail.valueNone'),
    );
  });

  it('所属区分は行の値をラベルにする（自社 / 取引先）', () => {
    expect(engineerListRow(view({ ownership: 'HOST' })).ownership).toBe(
      t('engineers.ownership.host'),
    );
    expect(engineerListRow(view({ ownership: 'PARTNER' })).ownership).toBe(
      t('engineers.ownership.partner'),
    );
  });

  it('🔴 連絡先・生年月日に相当するキーを持たない（画面が出さない PII を型に持たない）', () => {
    expect(Object.keys(engineerListRow(view())).sort()).toEqual([
      'availability',
      'availableFrom',
      'displayName',
      'id',
      'location',
      'moreSkills',
      'ownership',
      'skills',
      'unitPrice',
      'updatedOn',
    ]);
  });
});

describe('engineerPopulationLabel（🔴 母集団の明示。docs/04 §3.2 項目 2）', () => {
  it('ホストは「自社台帳 N 件」', () => {
    expect(engineerPopulationLabel(null, 1240)).toBe(
      `${t('engineers.list.population.host')} 1,240 ${t('engineers.list.population.unit')}`,
    );
  });

  it('🔴 取引先は「御社が登録した人材 N 件」（他社の件数を示唆しない）', () => {
    const label = engineerPopulationLabel(PARTNER_ID, 128);
    expect(label).toBe(
      `${t('engineers.list.population.partner')} 128 ${t('engineers.list.population.unit')}`,
    );
    expect(label).not.toContain(PARTNER_ID);
  });

  it('0 件でも壊れない', () => {
    expect(engineerPopulationLabel(null, 0)).toContain('0');
  });
});
