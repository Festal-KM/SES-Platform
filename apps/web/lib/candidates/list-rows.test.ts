// apps/web/lib/candidates/list-rows.test.ts
// T-08-05: `S-016` の表示値の組み立て。
//
// 🔴 中心は「匿名候補の行に、実名・所属会社名・社内 ID・稼働状況のフィールドが**存在しない**こと」
//    （`F-017 AC-1`。`undefined` ではなくキーが無い）と、URL の組み立てである。
import { describe, expect, it } from 'vitest';
import type { AnonymousCandidateView } from '../anonymize/candidate-view';
import { projectCandidateDefaults } from './defaults';
import type { OwnCandidateView } from './list';
import {
  activeCandidateFilters,
  anonymousCandidateRow,
  candidateListRows,
  candidatePopulationLabel,
  hasCandidateFilters,
  ownCandidateRow,
  projectCandidatesHref,
  projectCandidatesPath,
} from './list-rows';
import type { ProjectCandidateListQuery } from './schemas';

const PROJECT = '01930000-0000-7000-8000-0000000000f1';
const ENGINEER = '01930000-0000-7000-8000-0000000000e1';
const SKILL_JAVA = '01930000-0000-7000-8000-0000000000a1';
const SKILL_AWS = '01930000-0000-7000-8000-0000000000a2';
const REF = 'yM2RkvynFUQclwUcbLMLXw';

const own: OwnCandidateView = {
  id: ENGINEER,
  displayName: '架空 太郎',
  ownership: 'HOST',
  primarySkills: [
    { skillId: SKILL_JAVA, name: 'Java' },
    { skillId: SKILL_AWS, name: 'AWS' },
  ],
  moreSkillCount: 2,
  unitPriceMin: 600000,
  unitPriceMax: 750000,
  availability: 'WORKING',
  availableFrom: '2026-11-01',
  prefecture: '13',
  remoteMode: 'PARTIAL_REMOTE',
  updatedOn: '2026-09-05',
  yearsMax: 7,
};

const anonymous: AnonymousCandidateView = {
  candidateRef: REF,
  skills: Array.from({ length: 8 }, (_, i) => ({ name: `Skill${i}` })),
  yearsBand: 'Y5_10',
  priceBand: { kind: 'RANGE', fromManYen: 60, toManYen: 70 },
  availabilityBand: 'NEXT_MONTH',
  prefecture: '13',
  remoteMode: 'PARTIAL_REMOTE',
  updatedOn: '2026-09-08',
};

const BASE_QUERY: ProjectCandidateListQuery = {
  limit: 50,
  cursor: undefined,
  skills: undefined,
  skillMode: 'AND',
  yearsMin: undefined,
  priceMin: undefined,
  priceMax: undefined,
  availableBy: undefined,
  prefecture: undefined,
  remote: undefined,
  availability: undefined,
  q: undefined,
  onlyInTime: false,
  onlyCommutable: false,
};

describe('🔴 匿名候補の行に開示 5 項目以外のフィールドが無い（F-017 AC-1）', () => {
  it('キー集合は kind / key / candidateRef / 表示 6 項目 + allSkills / moreSkills / skillCount だけ', () => {
    const row = anonymousCandidateRow(anonymous);
    expect(Object.keys(row).sort()).toEqual(
      [
        'kind',
        'key',
        'candidateRef',
        'skills',
        'moreSkills',
        // T-11-12: 開示済みのスキルの総数（= allSkills.length）。6 項目目ではなく 1 項目内の件数。
        'skillCount',
        'allSkills',
        'years',
        'unitPrice',
        'availableFrom',
        'location',
        'updatedOn',
      ].sort(),
    );
    for (const forbidden of ['displayName', 'availabilityStatus', 'id', 'ownership', 'engineerId']) {
      expect(row).not.toHaveProperty(forbidden);
    }
  });

  it('値はすべて丸め後の文言であり、生値（7 年 / 65 万円 / 具体日付）を含まない', () => {
    const row = anonymousCandidateRow(anonymous);
    expect(row.years).toBe('5〜10 年');
    expect(row.unitPrice).toBe('60〜70 万円');
    expect(row.availableFrom).toBe('翌月');
    expect(row.location).toBe('東京都・一部リモート可');
    expect(row.skills).toEqual(['Skill0', 'Skill1', 'Skill2']);
    expect(row.moreSkills).toBe('+5');
    expect(row.allSkills).toHaveLength(8);
    // 🔴 skillCount は allSkills と同じ値であり、上限 8（U-06）を超えない。
    expect(row.skillCount).toBe(8);
    expect(JSON.stringify(row)).not.toMatch(/\d{4}-\d{2}-\d{2}T/);
  });

  it('candidateListRows は candidateRef の有無で自社 / 匿名を判別する', () => {
    const rows = candidateListRows([own, anonymous]);
    expect(rows.map((row) => row.kind)).toEqual(['OWN', 'ANONYMOUS']);
  });
});

describe('自社候補の行', () => {
  it('経験年数は集約値（最大）をそのまま「7 年」、稼働状況は右パネル用に持つ', () => {
    const row = ownCandidateRow(own);
    expect(row.kind).toBe('OWN');
    expect(row.displayName).toBe('架空 太郎');
    expect(row.years).toBe('7 年');
    expect(row.moreSkills).toBe('+2');
    // T-11-12: 総数 = 一覧に出す件数 + 超過件数。
    expect(row.skillCount).toBe(4);
    expect(row.availabilityStatus).toBe('稼働中');
    expect(row.key).toBe(ENGINEER);
    expect(ownCandidateRow({ ...own, yearsMax: null }).years).toBe('—');
  });
});

describe('母集団の明示', () => {
  it('ホストは混在した総件数だけ（共有候補の件数を別に出す語が無い）、取引先は自社の語', () => {
    expect(candidatePopulationLabel(null, 1234)).toBe('候補 1,234 件（自社台帳と共有候補）');
    expect(candidatePopulationLabel('01930000-0000-7000-8000-0000000000c1', 3)).toBe(
      '御社が登録した人材 3 件',
    );
  });
});

describe('URL の組み立て', () => {
  it('素の URL は要件の初期値、条件付きの URL は必ずクエリ文字列を持つ', () => {
    expect(projectCandidatesPath(PROJECT)).toBe(`/projects/${PROJECT}/candidates`);
    // 🔴 明示的に空の条件でも「案件の要件を初期値にする」と読まれないよう、既定値のキーを 1 つ残す。
    expect(projectCandidatesHref(PROJECT, BASE_QUERY, null)).toBe(
      `/projects/${PROJECT}/candidates?skillMode=AND`,
    );
    expect(projectCandidatesHref(PROJECT, BASE_QUERY, `0:2026-09-08:${REF}`)).toBe(
      `/projects/${PROJECT}/candidates?cursor=0%3A2026-09-08%3A${REF}`,
    );
    expect(
      projectCandidatesHref(
        PROJECT,
        { ...BASE_QUERY, skills: [SKILL_JAVA], prefecture: '13', onlyInTime: true },
        null,
      ),
    ).toBe(`/projects/${PROJECT}/candidates?skills=${SKILL_JAVA}&prefecture=13&onlyInTime=1`);
  });

  it('効いている条件を 1 つずつ外す導線は案件の URL を指し、カーソルを捨てる', () => {
    const query: ProjectCandidateListQuery = {
      ...BASE_QUERY,
      skills: [SKILL_JAVA],
      prefecture: '13',
      cursor: `0:2026-09-08:${REF}`,
    };
    const filters = activeCandidateFilters(PROJECT, query, new Map([[SKILL_JAVA, 'Java']]));
    expect(filters.map((filter) => filter.key)).toEqual([`skill-${SKILL_JAVA}`, 'prefecture']);
    expect(filters[0]?.label).toBe('スキル: Java');
    expect(filters[0]?.href).toBe(`/projects/${PROJECT}/candidates?prefecture=13`);
    expect(filters[1]?.href).toBe(`/projects/${PROJECT}/candidates?skills=${SKILL_JAVA}`);
    expect(hasCandidateFilters(query)).toBe(true);
    expect(hasCandidateFilters(BASE_QUERY)).toBe(false);
  });
});

describe('projectCandidateDefaults（案件の要件を初期値にする）', () => {
  it('必須要件のスキル・開始日・勤務地・リモート可否・単価レンジだけを引き継ぐ', () => {
    const defaults = projectCandidateDefaults(
      {
        id: PROJECT,
        name: '案件',
        status: 'OPEN',
        headcount: 1,
        startDate: '2026-11-01',
        unitPriceMin: 600000,
        unitPriceMax: 800000,
        prefecture: '13',
        remoteMode: 'PARTIAL_REMOTE',
        publicSummary: null,
        requirements: [
          { kind: 'MUST', skillId: SKILL_JAVA, skillName: 'Java', freeText: null, requiredYears: 5 },
          { kind: 'MUST', skillId: SKILL_JAVA, skillName: 'Java', freeText: null, requiredYears: 3 },
          { kind: 'MUST', skillId: null, skillName: null, freeText: '金融の経験', requiredYears: null },
          { kind: 'NICE', skillId: SKILL_AWS, skillName: 'AWS', freeText: null, requiredYears: null },
        ],
      },
      50,
    );
    expect(defaults).toEqual({
      ...BASE_QUERY,
      skills: [SKILL_JAVA],
      priceMin: 600000,
      priceMax: 800000,
      availableBy: '2026-11-01',
      prefecture: '13',
      remote: 'PARTIAL_REMOTE',
    });
  });

  it('要件・条件が無い案件では条件が空（チェックボックスは既定オフのまま）', () => {
    const defaults = projectCandidateDefaults(
      {
        id: PROJECT,
        name: '案件',
        status: 'OPEN',
        headcount: 1,
        startDate: null,
        unitPriceMin: null,
        unitPriceMax: null,
        prefecture: null,
        remoteMode: null,
        publicSummary: null,
        requirements: [],
      },
      50,
    );
    expect(defaults).toEqual(BASE_QUERY);
  });
});
