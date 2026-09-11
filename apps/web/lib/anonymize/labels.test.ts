// apps/web/lib/anonymize/labels.test.ts
// 匿名候補の区分 → 表示文字列の写像（`lib/anonymize/labels.ts`）。T-08-02。
//
// 🔴 ここで固定するのは 3 つである:
//   ① **すべての区分に空でない表示名がある**（写像の漏れは「コードがそのまま画面に出る」）。
//   ② 🔴 **丸める前の値に相当する文字列が出力に現れない**（`F-017 AC-3`。
//      `7 年` / `65 万円` / `渋谷区` / 具体的な稼働開始日）。
//   ③ 🔴 **表示できる項目が 5 項目 + 更新日から増えていない**（`BR-54` / `CLAUDE.md` §8.6）。
import { describe, expect, it } from 'vitest';
import {
  ANONYMIZED_AVAILABILITY_BANDS,
  ANONYMIZED_REMOTE_MODES,
  ANONYMIZED_YEARS_BANDS,
  type RoundedAnonymousAttributes,
} from '@ses/domain';
import {
  ANONYMIZED_AVAILABILITY_BAND_MESSAGE_KEYS,
  ANONYMIZED_REMOTE_MODE_MESSAGE_KEYS,
  ANONYMIZED_YEARS_BAND_MESSAGE_KEYS,
  anonymizedAttributeRows,
  formatAnonymizedLocation,
  formatAnonymizedPriceBand,
} from './labels';
import { t } from '@ses/i18n';

/** `F-017 AC-3` の例（経験年数 7 年 / 単価 65 万円 / 東京都渋谷区）を丸めた後の値。 */
const ROUNDED: RoundedAnonymousAttributes = {
  skills: [{ name: 'Java' }, { name: 'AWS' }],
  yearsBand: 'Y5_10',
  priceBand: { kind: 'RANGE', fromManYen: 60, toManYen: 70 },
  availabilityBand: 'NEXT_MONTH',
  prefecture: '13',
  remoteMode: 'PARTIAL_REMOTE',
  updatedOn: '2026-09-08',
};

describe('区分 → 文言の写像に漏れが無い', () => {
  it('経験年数 5 段階すべてに空でない表示名がある', () => {
    for (const band of ANONYMIZED_YEARS_BANDS) {
      expect(t(ANONYMIZED_YEARS_BAND_MESSAGE_KEYS[band]).length).toBeGreaterThan(0);
    }
  });

  it('稼働可能時期 5 段階すべてに空でない表示名がある', () => {
    for (const band of ANONYMIZED_AVAILABILITY_BANDS) {
      expect(t(ANONYMIZED_AVAILABILITY_BAND_MESSAGE_KEYS[band]).length).toBeGreaterThan(0);
    }
  });

  it('リモート可否 3 値すべてに空でない表示名がある', () => {
    for (const mode of ANONYMIZED_REMOTE_MODES) {
      expect(t(ANONYMIZED_REMOTE_MODE_MESSAGE_KEYS[mode]).length).toBeGreaterThan(0);
    }
  });
});

describe('単価レンジ（万円）', () => {
  it('レンジは「60〜70 万円」（🔴 円の生値を出さない）', () => {
    expect(formatAnonymizedPriceBand({ kind: 'RANGE', fromManYen: 60, toManYen: 70 })).toBe(
      '60〜70 万円',
    );
  });

  it('打ち止めは「100 万円以上」', () => {
    expect(formatAnonymizedPriceBand({ kind: 'OPEN', fromManYen: 100 })).toBe('100 万円以上');
  });

  it('未設定は「—」（空欄にしない）', () => {
    expect(formatAnonymizedPriceBand(null)).toBe('—');
  });
});

describe('勤務地', () => {
  it('都道府県とリモート可否を「・」で畳む（🔴 市区町村を持たない）', () => {
    expect(formatAnonymizedLocation('13', 'PARTIAL_REMOTE')).toBe('東京都・一部リモート可');
  });

  it('片方だけでも「—」に畳まない', () => {
    expect(formatAnonymizedLocation('13', null)).toBe('東京都');
    expect(formatAnonymizedLocation(null, 'FULL_REMOTE')).toBe('フルリモート可');
  });

  it('両方未設定なら「—」', () => {
    expect(formatAnonymizedLocation(null, null)).toBe('—');
  });
});

describe('🔴 丸める前の値が表示に現れない（`F-017 AC-3`）', () => {
  const rows = anonymizedAttributeRows(ROUNDED);
  const rendered = [
    ...rows.skills,
    rows.yearsBand,
    rows.priceBand,
    rows.availabilityBand,
    rows.location,
    rows.updatedOn,
  ].join('|');

  it.each([
    ['経験年数の実数', '7 年'],
    ['単価の実額', '65 万円'],
    ['単価の円表記', '650,000'],
    ['市区町村', '渋谷区'],
    ['稼働開始日（日付）', '2026-09-16'],
  ])('%s（%s）が出力に現れない', (_label, forbidden) => {
    expect(rendered).not.toContain(forbidden);
  });

  it('代わりに丸めた区分が出る', () => {
    expect(rows.yearsBand).toBe('5〜10 年');
    expect(rows.priceBand).toBe('60〜70 万円');
    expect(rows.availabilityBand).toBe('翌月');
    expect(rows.location).toBe('東京都・一部リモート可');
  });
});

describe('🔴 表示できる項目が 5 項目 + 更新日から増えていない（`BR-54`）', () => {
  it('キーの集合が固定されている（増えたらここが落ちる）', () => {
    expect(Object.keys(anonymizedAttributeRows(ROUNDED)).sort()).toEqual([
      'availabilityBand',
      'location',
      'priceBand',
      'skills',
      'updatedOn',
      'yearsBand',
    ]);
  });

  it('スキルが 0 件でも例外にせず空配列を返す（画面側が「—」に畳む）', () => {
    expect(
      anonymizedAttributeRows({
        ...ROUNDED,
        skills: [],
        yearsBand: null,
        priceBand: null,
        availabilityBand: null,
        prefecture: null,
        remoteMode: null,
      }),
    ).toEqual({
      skills: [],
      yearsBand: '—',
      priceBand: '—',
      availabilityBand: '—',
      location: '—',
      updatedOn: '2026-09-08',
    });
  });
});
