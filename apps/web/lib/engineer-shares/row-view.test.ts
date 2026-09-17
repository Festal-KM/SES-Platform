// apps/web/lib/engineer-shares/row-view.test.ts
// `S-015` の行の組み立て（`row-view.ts`）。T-11-11。
//
// 🔴 ここで固定するのは 3 点:
//   ① 行の値は `EngineerShareCandidateView` にあるものだけから作られ、丸める前の値が現れない（`docs/04` §5-2）
//   ② 一覧の「稼働可能時期」はプレビューと同じ丸めた区分である
//   ③ `PUT` の応答で描き直すとき、氏名・件数は引き継ぎ、共有状態 / 共有開始日 / プレビューは**応答**から作る
//      （手元の現在時刻や「押した値」から組み立てない）
import { describe, expect, it } from 'vitest';
import type { RoundedAnonymousAttributes } from '@ses/domain';
import { anonymizedLabelCatalog } from '../anonymize/labels';
import { engineerShareRow, engineerShareRows, redrawEngineerShareRow, type EngineerShareRowLabels } from './row-view';
import type { EngineerShareCandidateView, EngineerShareUpdateView } from './service';

const LABELS: EngineerShareRowLabels = {
  catalog: anonymizedLabelCatalog(),
  valueNone: '—',
  countUnit: '件',
};

const ROUNDED: RoundedAnonymousAttributes = {
  skills: [{ name: 'Java' }, { name: 'AWS' }],
  yearsBand: 'Y5_10',
  priceBand: { kind: 'RANGE', fromManYen: 60, toManYen: 70 },
  availabilityBand: 'NEXT_MONTH',
  prefecture: '13',
  remoteMode: 'PARTIAL_REMOTE',
  updatedOn: '2026-09-08',
};

const VIEW: EngineerShareCandidateView = {
  engineerId: '01930000-0000-7000-8000-0000000000a1',
  displayName: '合成 太郎',
  shared: false,
  sharedOn: null,
  proposalRequestCount: 2,
  previewedFields: ROUNDED,
};

describe('engineerShareRow', () => {
  it('文言化済みの行を作る（共有していなければ共有開始日は `—`。件数は 0 でも空欄に畳まない）', () => {
    const row = engineerShareRow(VIEW, LABELS);
    expect(row).toEqual({
      engineerId: VIEW.engineerId,
      displayName: '合成 太郎',
      shared: false,
      sharedOn: '—',
      proposalRequestCount: '2 件',
      availability: '翌月',
      preview: {
        skills: ['Java', 'AWS'],
        yearsBand: '5〜10 年',
        priceBand: '60〜70 万円',
        availabilityBand: '翌月',
        location: '東京都・一部リモート可',
        updatedOn: '2026-09-08',
      },
    });
    expect(engineerShareRow({ ...VIEW, proposalRequestCount: 0 }, LABELS).proposalRequestCount).toBe('0 件');
  });

  it('② 一覧の「稼働可能時期」はプレビューと同じ丸めた区分である', () => {
    const row = engineerShareRow(VIEW, LABELS);
    expect(row.availability).toBe(row.preview.availabilityBand);
  });

  it('① 丸める前の値（`7 年` / `65 万円` / `渋谷区` / 具体的な稼働開始日）が現れない', () => {
    const json = JSON.stringify(engineerShareRows([VIEW], LABELS));
    for (const forbidden of ['7 年', '65 万円', '650,000', '渋谷区', '2026-10-05']) {
      expect(json).not.toContain(forbidden);
    }
  });
});

describe('redrawEngineerShareRow（`PUT` の応答で当該行だけを描き直す）', () => {
  const before = engineerShareRow(VIEW, LABELS);
  const updated: EngineerShareUpdateView = {
    engineerId: VIEW.engineerId,
    shared: true,
    sharedOn: '2026-09-17',
    previewedFields: { ...ROUNDED, availabilityBand: 'IMMEDIATE' },
  };

  it('③ 共有状態 / 共有開始日 / 稼働可能時期 / プレビューは応答から、氏名 / 件数は既存の行から', () => {
    const after = redrawEngineerShareRow(before, updated, LABELS);
    expect(after.shared).toBe(true);
    expect(after.sharedOn).toBe('2026-09-17');
    expect(after.availability).toBe('即日');
    expect(after.preview.availabilityBand).toBe('即日');
    expect(after.displayName).toBe(before.displayName);
    expect(after.proposalRequestCount).toBe(before.proposalRequestCount);
  });

  it('解除の応答（`sharedOn: null`）は共有開始日を `—` に戻す', () => {
    const shared = redrawEngineerShareRow(before, updated, LABELS);
    const revoked = redrawEngineerShareRow(
      shared,
      { ...updated, shared: false, sharedOn: null },
      LABELS,
    );
    expect(revoked.shared).toBe(false);
    expect(revoked.sharedOn).toBe('—');
  });

  it('🔴 別の行（engineerId が違う）には触れない', () => {
    const other = engineerShareRow({ ...VIEW, engineerId: '01930000-0000-7000-8000-0000000000a2' }, LABELS);
    expect(redrawEngineerShareRow(other, updated, LABELS)).toBe(other);
  });
});
