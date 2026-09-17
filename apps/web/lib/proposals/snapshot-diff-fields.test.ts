// apps/web/lib/proposals/snapshot-diff-fields.test.ts
// #46b の応答の純粋な組み立て（docs/05 §6.5「#46b の境界と記録の確定」/ `F-019 AC-2`）。T-12-16。
//
// 🔴 ここで固定するもの:
//   ① `fields` は 7 キーを常に全部、固定の順で返す（変更が無くても落とさない）
//   ② `frozen` と `current` は別のキーで、`changed` は応答の形に**無い**
//   ③ 現在値のスキルは凍結の形（`{ skillId, name, years, level }`。`skillId` 昇順）に写す
//   ④ 等値判定（`snapshotFieldEquals` / `careersEqual`）は画面側の道具であり、値の差だけを見る（順序も含む）
import { describe, expect, it } from 'vitest';
import type { CareerRowView } from '../engineers/careers';
import type { EngineerSkillView } from '../engineers/service';
import {
  buildSnapshotDiffFields,
  careersEqual,
  PROPOSAL_SNAPSHOT_DIFF_VIEW_KEYS,
  SNAPSHOT_DIFF_FIELD_KEYS,
  snapshotFieldEquals,
  toFrozenSkillShape,
  type SnapshotComparable,
} from './snapshot-diff-fields';
import type { FrozenCareerView } from './views';

const SKILL_A = '01930000-0000-7000-8000-0000000000a1';
const SKILL_B = '01930000-0000-7000-8000-0000000000b1';

function comparable(overrides: Partial<SnapshotComparable> = {}): SnapshotComparable {
  return {
    displayName: '架空 太郎',
    skills: [{ skillId: SKILL_A, name: 'Java', years: 6, level: 4 }],
    unitPriceMin: 650000,
    unitPriceMax: 750000,
    availableFrom: '2026-10-01',
    prefecture: '13',
    remoteMode: 'PARTIAL_REMOTE',
    ...overrides,
  };
}

function frozenCareer(overrides: Partial<FrozenCareerView> = {}): FrozenCareerView {
  return { periodFrom: '2024-04', periodTo: null, role: 'PL', description: '基幹刷新', technologies: 'Java', ...overrides };
}

function currentCareer(id: string, overrides: Partial<CareerRowView> = {}): CareerRowView {
  return {
    id,
    periodFrom: '2024-04',
    periodTo: null,
    role: 'PL',
    description: '基幹刷新',
    technologies: 'Java',
    source: 'MANUAL',
    skillSheetExtractionId: null,
    ...overrides,
  };
}

describe('① buildSnapshotDiffFields: 7 キーを常に全部、固定の順で', () => {
  it('変更が無くても 7 キーが同じ順で返り、各 frozen = current', () => {
    const fields = buildSnapshotDiffFields(comparable(), comparable());
    expect(fields.map((field) => field.key)).toEqual([...SNAPSHOT_DIFF_FIELD_KEYS]);
    expect(SNAPSHOT_DIFF_FIELD_KEYS).toEqual(['displayName', 'skills', 'unitPriceMin', 'unitPriceMax', 'availableFrom', 'prefecture', 'remoteMode']);
    for (const field of fields) expect(snapshotFieldEquals(field)).toBe(true);
  });

  it('② 各要素のキーは key / frozen / current だけ（changed は無い）', () => {
    const fields = buildSnapshotDiffFields(comparable(), comparable({ displayName: '架空 次郎' }));
    for (const field of fields) expect(Object.keys(field).sort()).toEqual(['current', 'frozen', 'key']);
    expect(PROPOSAL_SNAPSHOT_DIFF_VIEW_KEYS).toEqual(['frozenAt', 'fields', 'careers']);
  });

  it('7 項目すべてを変えると 7 件とも frozen ≠ current、1 項目だけ変えると 1 件だけ', () => {
    const all = buildSnapshotDiffFields(
      comparable(),
      comparable({
        displayName: '架空 次郎',
        skills: [{ skillId: SKILL_A, name: 'Java', years: 7, level: 4 }],
        unitPriceMin: 700000,
        unitPriceMax: null,
        availableFrom: null,
        prefecture: '27',
        remoteMode: 'FULL_REMOTE',
      }),
    );
    expect(all.map(snapshotFieldEquals)).toEqual([false, false, false, false, false, false, false]);

    const one = buildSnapshotDiffFields(comparable(), comparable({ unitPriceMax: 800000 }));
    expect(one.map((field) => [field.key, snapshotFieldEquals(field)])).toEqual([
      ['displayName', true],
      ['skills', true],
      ['unitPriceMin', true],
      ['unitPriceMax', false],
      ['availableFrom', true],
      ['prefecture', true],
      ['remoteMode', true],
    ]);
  });
});

describe('③ toFrozenSkillShape: 台帳のスキルを凍結の形に写す', () => {
  it('years = yearsOfExperience、skillId 昇順、level は null を保つ', () => {
    const ledger: readonly EngineerSkillView[] = [
      { skillId: SKILL_B, name: 'AWS', yearsOfExperience: 2.5, level: null },
      { skillId: SKILL_A, name: 'Java', yearsOfExperience: 6, level: 4 },
    ];
    expect(toFrozenSkillShape(ledger)).toEqual([
      { skillId: SKILL_A, name: 'Java', years: 6, level: 4 },
      { skillId: SKILL_B, name: 'AWS', years: 2.5, level: null },
    ]);
    // 入力を並べ替えない（純粋）。
    expect(ledger[0]?.skillId).toBe(SKILL_B);
  });

  it('0 件は []', () => {
    expect(toFrozenSkillShape([])).toEqual([]);
  });
});

describe('④ 等値判定は値の差だけを見る', () => {
  it('skills: 件数・skillId・name・years・level のどれが違っても不一致。順序も含む', () => {
    const base = comparable({ skills: [{ skillId: SKILL_A, name: 'Java', years: 6, level: 4 }, { skillId: SKILL_B, name: 'AWS', years: 2, level: null }] });
    const same = buildSnapshotDiffFields(base, comparable({ skills: [...base.skills] }))[1];
    expect(same !== undefined && snapshotFieldEquals(same)).toBe(true);
    const cases: readonly SnapshotComparable['skills'][] = [
      [{ skillId: SKILL_A, name: 'Java', years: 6, level: 4 }],
      [{ skillId: SKILL_A, name: 'Java', years: 6, level: 5 }, { skillId: SKILL_B, name: 'AWS', years: 2, level: null }],
      [{ skillId: SKILL_A, name: 'Java', years: 6.5, level: 4 }, { skillId: SKILL_B, name: 'AWS', years: 2, level: null }],
      [{ skillId: SKILL_B, name: 'AWS', years: 2, level: null }, { skillId: SKILL_A, name: 'Java', years: 6, level: 4 }],
    ];
    for (const skills of cases) {
      const field = buildSnapshotDiffFields(base, comparable({ skills }))[1];
      expect(field !== undefined && snapshotFieldEquals(field)).toBe(false);
    }
  });

  it('スカラ: null と値、0 と null を区別する', () => {
    const a = buildSnapshotDiffFields(comparable({ unitPriceMin: null }), comparable({ unitPriceMin: 0 }))[2];
    expect(a !== undefined && snapshotFieldEquals(a)).toBe(false);
    const b = buildSnapshotDiffFields(comparable({ availableFrom: null }), comparable({ availableFrom: null }))[4];
    expect(b !== undefined && snapshotFieldEquals(b)).toBe(true);
  });

  it('careersEqual: 行数と 5 項目（順序込み）。現在値の id / source は比較に使わない', () => {
    const frozen = [frozenCareer(), frozenCareer({ periodFrom: '2021-01', periodTo: '2024-03', role: 'SE', description: '受託', technologies: 'Java' })];
    const current = [currentCareer('c1'), currentCareer('c2', { periodFrom: '2021-01', periodTo: '2024-03', role: 'SE', description: '受託', technologies: 'Java', source: 'EXTRACTED' })];
    expect(careersEqual(frozen, current)).toBe(true);
    expect(careersEqual(frozen, [current[0]!])).toBe(false); // 1 行削除
    expect(careersEqual(frozen, [...current, currentCareer('c3', { periodFrom: '2019-01', periodTo: '2020-12' })])).toBe(false); // 1 行追加
    expect(careersEqual(frozen, [current[0]!, currentCareer('c2', { periodFrom: '2021-01', periodTo: '2024-03', role: 'SE', description: '受託（改）', technologies: 'Java' })])).toBe(false); // 1 行編集
    expect(careersEqual(frozen, [current[1]!, current[0]!])).toBe(false); // 順序
    expect(careersEqual([], [])).toBe(true);
  });
});
