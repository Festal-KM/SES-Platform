// apps/web/lib/engineers/list-rows.test.ts
// `S-005`（一覧）の表示値（docs/04 §S-005）。T-05-09。
//
// 🔴 ここで固定するのは「上位 3 件の選び方が決定的であること」（`F-009 AC-1`）と
//    「母集団の文言がホストと取引先で分かれること」（docs/04 §3.2 項目 2）である。
//    どちらも DB を要らない純粋関数であり、画面（`app/**`）に置くとテストできない。
import { describe, expect, it } from 'vitest';
import { PAGE_SIZE_DEFAULT } from '@ses/config';
import { t } from '@ses/i18n';
import {
  activeEngineerFilters,
  engineerListHref,
  engineerListRow,
  engineerPopulationLabel,
  formatLocation,
  hasEngineerListFilters,
  pickPrimarySkills,
  PRIMARY_SKILL_LIMIT,
} from './list-rows';
import type { OwnEngineerView } from './list';
import { ENGINEER_SKILL_MODE_DEFAULT, type EngineerListQuery } from './schemas';

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

// ============================================================================
// 検索条件の URL と解除の導線（docs/04 §S-005 / §10.1 `S-005`）。T-06-04。
// ============================================================================

const SKILL_JAVA = '01930000-0000-7000-8000-0000000000a1';
const SKILL_AWS = '01930000-0000-7000-8000-0000000000a2';
const CURSOR = '01930000-0000-7000-8000-0000000000e9';

function listQuery(overrides: Partial<EngineerListQuery> = {}): EngineerListQuery {
  return {
    limit: PAGE_SIZE_DEFAULT,
    skillMode: ENGINEER_SKILL_MODE_DEFAULT,
    onlyInTime: false,
    onlyCommutable: false,
    ...overrides,
  };
}

describe('engineerListHref（🔴 ページングで条件が落ちない。docs/04 §S-005）', () => {
  it('条件が無ければ素のパスになる（既定値で URL を汚さない）', () => {
    expect(engineerListHref(listQuery(), null)).toBe('/engineers');
  });

  it('🔴 既定値（`limit` / `skillMode` / オフのチェックボックス）を載せない', () => {
    const href = engineerListHref(listQuery({ q: 'Java' }), null);
    expect(href).not.toContain('limit=');
    expect(href).not.toContain('skillMode=');
    expect(href).not.toContain('onlyInTime=');
  });

  it('🔴 チェックボックスはオンのときだけ載る（URL からオンだと分かる）', () => {
    expect(engineerListHref(listQuery({ onlyInTime: true }), null)).toBe('/engineers?onlyInTime=1');
  });

  it('複数スキルは同じキーを繰り返す（`searchParamsToObject` が配列にする形）', () => {
    expect(engineerListHref(listQuery({ skills: [SKILL_JAVA, SKILL_AWS] }), null)).toBe(
      `/engineers?skills=${SKILL_JAVA}&skills=${SKILL_AWS}`,
    );
  });

  it('🔴 カーソルを足しても条件が落ちない', () => {
    const href = engineerListHref(listQuery({ q: 'Java', prefecture: '13' }), CURSOR);
    expect(href).toContain('q=Java');
    expect(href).toContain('prefecture=13');
    expect(href).toContain(`cursor=${CURSOR}`);
  });

  it('同じ条件からは必ず同じ URL になる（並びが固定である）', () => {
    const query = listQuery({ q: 'Java', prefecture: '13', availability: 'STANDBY' });
    expect(engineerListHref(query, null)).toBe(engineerListHref(query, null));
  });
});

describe('hasEngineerListFilters（初回空と絞込 0 件を分ける。docs/04 §10.1 `S-005`）', () => {
  it('条件が無ければ偽', () => {
    expect(hasEngineerListFilters(listQuery())).toBe(false);
  });

  it('🔴 ページングと表示件数は絞り込みではない（2 ページ目が 0 件でも初回空ではない）', () => {
    expect(hasEngineerListFilters(listQuery({ cursor: CURSOR, limit: 10 }))).toBe(false);
  });

  it('🔴 チェックボックスも「効いている条件」である', () => {
    expect(hasEngineerListFilters(listQuery({ onlyCommutable: true }))).toBe(true);
  });

  it('スキルの組み合わせだけでは絞り込みにならない（単独では母集団を変えない）', () => {
    expect(hasEngineerListFilters(listQuery({ skillMode: 'OR' }))).toBe(false);
  });

  it.each([
    ['skills', { skills: [SKILL_JAVA] }],
    ['yearsMin', { yearsMin: 5 }],
    ['priceMin', { priceMin: 1 }],
    ['priceMax', { priceMax: 1 }],
    ['availableBy', { availableBy: '2026-11-01' }],
    ['prefecture', { prefecture: '13' as const }],
    ['remote', { remote: 'FULL_REMOTE' as const }],
    ['availability', { availability: 'STANDBY' as const }],
    ['q', { q: '架空' }],
    ['onlyInTime', { onlyInTime: true }],
    ['onlyCommutable', { onlyCommutable: true }],
  ])(
    '🔴 %s が効いていれば、絞込 0 件の判定と解除の導線が**必ず両方**成立する（行き止まりを作らない）',
    (_label, overrides) => {
      const query = listQuery(overrides);
      expect(hasEngineerListFilters(query)).toBe(true);
      expect(activeEngineerFilters(query, new Map()).length).toBeGreaterThan(0);
    },
  );
});

describe('activeEngineerFilters（🔴 効いている条件を 1 つずつ外せる。docs/04 §10.1 `S-005`）', () => {
  const names = new Map([
    [SKILL_JAVA, 'Java'],
    [SKILL_AWS, 'AWS'],
  ]);

  it('条件が無ければ空である', () => {
    expect(activeEngineerFilters(listQuery(), names)).toEqual([]);
  });

  it('🔴 スキルは 1 件ずつ外せる（「スキル: Java を外す」）', () => {
    const filters = activeEngineerFilters(listQuery({ skills: [SKILL_JAVA, SKILL_AWS] }), names);

    expect(filters.map((filter) => filter.label)).toEqual([
      `${t('engineers.list.search.skills')}: Java`,
      `${t('engineers.list.search.skills')}: AWS`,
    ]);
    // Java を外すリンクには AWS だけが残る。
    expect(filters[0]?.href).toBe(`/engineers?skills=${SKILL_AWS}`);
  });

  it('外すリンクは他の条件を保ち、カーソルだけ先頭に戻す', () => {
    const filters = activeEngineerFilters(
      listQuery({ q: 'Java', prefecture: '13', cursor: CURSOR }),
      names,
    );
    const prefecture = filters.find((filter) => filter.key === 'prefecture');

    expect(prefecture?.href).toContain('q=Java');
    expect(prefecture?.href).not.toContain('prefecture=');
    expect(prefecture?.href).not.toContain('cursor=');
  });

  it('🔴 チェックボックスも外せる（オンのまま 0 件で行き止まりにしない）', () => {
    const filters = activeEngineerFilters(
      listQuery({ availableBy: '2026-11-01', onlyInTime: true }),
      names,
    );
    const checkbox = filters.find((filter) => filter.key === 'onlyInTime');

    expect(checkbox?.label).toBe(t('engineers.list.search.onlyInTime'));
    expect(checkbox?.href).not.toContain('onlyInTime');
    expect(checkbox?.href).toContain('availableBy=2026-11-01');
  });

  it('辞書に無いスキル ID でも条件が消えない（外せない条件を残さない）', () => {
    const filters = activeEngineerFilters(listQuery({ skills: [SKILL_JAVA] }), new Map());
    expect(filters[0]?.label).toContain(SKILL_JAVA);
  });

  it('すべての条件が列挙される（外せない条件が残らない）', () => {
    const filters = activeEngineerFilters(
      listQuery({
        skills: [SKILL_JAVA],
        yearsMin: 5,
        priceMin: 600_000,
        priceMax: 800_000,
        availableBy: '2026-11-01',
        prefecture: '13',
        remote: 'FULL_REMOTE',
        availability: 'STANDBY',
        q: '架空',
        onlyInTime: true,
        onlyCommutable: true,
      }),
      names,
    );

    expect(filters.map((filter) => filter.key)).toEqual([
      `skill-${SKILL_JAVA}`,
      'yearsMin',
      'priceMin',
      'priceMax',
      'availableBy',
      'prefecture',
      'remote',
      'availability',
      'q',
      'onlyInTime',
      'onlyCommutable',
    ]);
  });
});
