// packages/domain/src/ledger/careers.test.ts
// T-09-12: `diffCareerRows`（行ごとの監査ログの材料。docs/05 §6.4 #16 / `F-008 AC-5`）と
// `frozenCareersToInspectionText`（ゲートの `field='snapshot'`）を固定する。
import { describe, expect, it } from 'vitest';
import {
  CAREER_INSPECTION_ROW_SEPARATOR,
  diffCareerRows,
  frozenCareersToInspectionText,
  toFrozenCareer,
  type StoredCareerRow,
} from './careers.js';
import { compareYearMonth, isYearMonth, parseYearMonth } from './year-month.js';

const ROW_A: StoredCareerRow = {
  id: 'a',
  periodFrom: '2023-04',
  periodTo: null,
  role: 'PL',
  description: '基幹刷新',
  technologies: 'Java',
};
const ROW_B: StoredCareerRow = {
  id: 'b',
  periodFrom: '2021-01',
  periodTo: '2023-03',
  role: 'SE',
  description: '受発注システム',
  technologies: 'TypeScript',
};

describe('parseYearMonth（YYYY-MM の唯一の判定）', () => {
  it.each(['2026-01', '2026-12', '0001-01'])('%s は妥当', (value) => {
    expect(isYearMonth(value)).toBe(true);
  });

  it.each(['', '2026-00', '2026-13', '2026-1', '2026/01', '2026-01-01', '26-01', ' 2026-01'])(
    '%s は不正（空文字も不正 = 継続中は null で表す）',
    (value) => {
      expect(parseYearMonth(value)).toBeNull();
    },
  );

  it('年と月に分解できる', () => {
    expect(parseYearMonth('2024-07')).toEqual({ year: 2024, month: 7 });
  });

  it('比較は辞書順 = 時系列順', () => {
    expect(compareYearMonth('2023-12', '2024-01')).toBeLessThan(0);
    expect(compareYearMonth('2024-01', '2024-01')).toBe(0);
    expect(() => compareYearMonth('2024-1', '2024-01')).toThrow(RangeError);
  });
});

describe('diffCareerRows（🔴 行ごとの create / update / delete。同じ値の再送信は update にならない）', () => {
  it('3 行追加 + 1 行削除 → created 3 / deleted 1 / updated 0（監査は 4 件になる）', () => {
    const diff = diffCareerRows(
      [ROW_A, ROW_B],
      [
        ROW_A,
        { periodFrom: '2020-01', periodTo: '2020-12', role: 'PG', description: 'x', technologies: 'Go' },
        { periodFrom: '2019-01', periodTo: '2019-12', role: 'PG', description: 'y', technologies: 'Go' },
        { periodFrom: '2018-01', periodTo: '2018-12', role: 'PG', description: 'z', technologies: 'Go' },
      ],
    );
    expect(diff.created).toHaveLength(3);
    expect(diff.updated).toEqual([]);
    expect(diff.deleted.map((row) => row.id)).toEqual(['b']);
    expect(diff.unmatched).toEqual([]);
  });

  it('値が変わった行だけが updated に入り、変わった項目名が残る（本文は changedFields に含めない）', () => {
    const diff = diffCareerRows(
      [ROW_A, ROW_B],
      [ROW_A, { ...ROW_B, periodTo: null, technologies: 'TypeScript / React' }],
    );
    expect(diff.created).toEqual([]);
    expect(diff.deleted).toEqual([]);
    expect(diff.updated).toHaveLength(1);
    expect(diff.updated[0]?.id).toBe('b');
    expect(diff.updated[0]?.changedFields).toEqual(['periodTo', 'technologies']);
  });

  it('同じ値の再送信では何も変わらない（監査が増えない）', () => {
    const diff = diffCareerRows([ROW_A, ROW_B], [ROW_B, ROW_A]);
    expect(diff).toEqual({ created: [], updated: [], deleted: [], unmatched: [] });
  });

  it('全行を送らない（[]）は全削除である（undefined と [] の区別は呼び出し側）', () => {
    const diff = diffCareerRows([ROW_A, ROW_B], []);
    expect(diff.deleted.map((row) => row.id).sort()).toEqual(['a', 'b']);
  });

  it('🔴 保存済みに無い id は unmatched（呼び出し側が 404 にする。黙って追加に倒さない）', () => {
    const diff = diffCareerRows([ROW_A], [{ ...ROW_B, id: 'zzz' }]);
    expect(diff.unmatched.map((row) => row.id)).toEqual(['zzz']);
    expect(diff.created).toEqual([]);
    expect(diff.deleted.map((row) => row.id)).toEqual(['a']);
  });

  it('🔴 同じ id が 2 回送られたら RangeError（後勝ちで畳まない）', () => {
    expect(() => diffCareerRows([ROW_A], [ROW_A, { ...ROW_A, role: 'PM' }])).toThrow(RangeError);
  });

  it('入力を変更しない（純粋関数）', () => {
    const before = [ROW_A];
    const after = [{ ...ROW_A, role: 'PM' }];
    const snapshotBefore = JSON.stringify(before);
    const snapshotAfter = JSON.stringify(after);
    diffCareerRows(before, after);
    expect(JSON.stringify(before)).toBe(snapshotBefore);
    expect(JSON.stringify(after)).toBe(snapshotAfter);
  });
});

describe('toFrozenCareer / frozenCareersToInspectionText', () => {
  it('🔴 凍結行は 5 項目だけ（id を持たない）', () => {
    const frozen = toFrozenCareer(ROW_A);
    expect(Object.keys(frozen).sort()).toEqual(
      ['description', 'periodFrom', 'periodTo', 'role', 'technologies'].sort(),
    );
    expect('id' in frozen).toBe(false);
  });

  it('検査用の連結は自由入力の 3 項目を行区切りで並べ、0 行は空文字', () => {
    expect(frozenCareersToInspectionText([])).toBe('');
    const text = frozenCareersToInspectionText([toFrozenCareer(ROW_A), toFrozenCareer(ROW_B)]);
    expect(text).toBe(
      `PL\n基幹刷新\nJava${CAREER_INSPECTION_ROW_SEPARATOR}SE\n受発注システム\nTypeScript`,
    );
    // 期間は検査に載せない（形式が CHECK で固定されていて語が潜り込めない）。
    expect(text).not.toContain('2023-04');
  });
});
