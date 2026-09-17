// apps/web/lib/candidates/skill-fit.test.ts
// `fitSkillBadges`（`S-016` スキル列の 1 行固定。T-11-12）。docs/04 §S-016 列幅配分の 3 点を固定する:
//   ①上位 3 + `+N` を上限とする ②幅が足りなければ件数を減らす ③下限は 1 件 + `+N`（N は隠した分を含む）。
import { describe, expect, it } from 'vitest';
import { fitSkillBadges } from './skill-fit';

const badgeWidths = [75, 36, 46]; // TypeScript / Go / AWS の実測に近い値
const gap = 4;
const moreWidth = 27;

describe('fitSkillBadges（S-016 スキル列の件数）', () => {
  it('①幅が十分なら上位 3 件を全部描き、+N は総数 − 3', () => {
    expect(fitSkillBadges({ available: 400, badgeWidths, moreWidth, gap, total: 8 })).toEqual({ shown: 3, more: 5 });
    // 総数 3 なら +N は無い。
    expect(fitSkillBadges({ available: 400, badgeWidths, moreWidth, gap, total: 3 })).toEqual({ shown: 3, more: 0 });
  });

  it('②幅が足りなければ件数を減らし、+N は隠した分を含む', () => {
    // 3 件 + gap 2 + +N + gap = 75+4+36+4+46+4+27 = 196。195 では 3 件目が入らない → 2 件 + +6。
    expect(fitSkillBadges({ available: 195, badgeWidths, moreWidth, gap, total: 8 })).toEqual({ shown: 2, more: 6 });
    // 2 件 + +N = 75+4+36+4+27 = 146。145 では 2 件目が入らない → 1 件 + +7。
    expect(fitSkillBadges({ available: 145, badgeWidths, moreWidth, gap, total: 8 })).toEqual({ shown: 1, more: 7 });
  });

  it('②′ 総数 = 3 でも 3 件目が入らなければ 2 件 + +1（+N の幅を見込んで判定する）', () => {
    // 3 件（+N 無し）= 75+4+36+4+46 = 165 → 165 なら 3 件。
    expect(fitSkillBadges({ available: 165, badgeWidths, moreWidth, gap, total: 3 })).toEqual({ shown: 3, more: 0 });
    // 164 では 3 件目が入らない → 2 件 + +1（この 2 件 + +1 = 146 は収まる）。
    expect(fitSkillBadges({ available: 164, badgeWidths, moreWidth, gap, total: 3 })).toEqual({ shown: 2, more: 1 });
  });

  it('③下限は 1 件 + +N（幅がそれ未満でも 1 件は描く）', () => {
    expect(fitSkillBadges({ available: 10, badgeWidths, moreWidth, gap, total: 8 })).toEqual({ shown: 1, more: 7 });
    expect(fitSkillBadges({ available: 0, badgeWidths: [75], moreWidth, gap, total: 1 })).toEqual({ shown: 1, more: 0 });
  });

  it('バッジが無い行は 0 件（`—` を描く側の責務）', () => {
    expect(fitSkillBadges({ available: 400, badgeWidths: [], moreWidth, gap, total: 0 })).toEqual({ shown: 0, more: 0 });
  });

  it('決定的である（同じ入力で同じ出力）', () => {
    const input = { available: 195, badgeWidths, moreWidth, gap, total: 8 };
    expect(fitSkillBadges(input)).toEqual(fitSkillBadges(input));
  });
});
