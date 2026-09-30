// apps/web/lib/home/summary-view.test.ts
// 🔴 `SummaryStrip` の「描かない判定」と「語の写像」（T-22-09 / docs/05 §6.11.1 / `docs/04` §7.2）。
//
// 固定するもの:
//   ① 🔴 **描かないのは「全 metric が 0」のときだけ**（= 初回空）。**個々の 0 で項目を間引かない**
//   ② 🔴 語の写像は `kind` の全値を覆う（Phase 2 の kind も含む。無名の指標が出ない）
//   ③ 値は 3 桁区切りの件数だけ（率・金額・前月比を作らない）
import { describe, expect, it } from 'vitest';
import { catalog, DEFAULT_LOCALE } from '@ses/i18n';
import {
  HOST_SUMMARY_METRIC_MESSAGE_KEYS,
  isSummaryInitialEmpty,
  PARTNER_SUMMARY_METRIC_MESSAGE_KEYS,
  summaryStripItems,
} from './summary-view';
import type { HostSummaryMetricKind, SummaryHomeBlock } from './types';

function hostBlock(counts: readonly number[]): SummaryHomeBlock {
  const kinds: readonly HostSummaryMetricKind[] = ['PROJECTS', 'ENGINEERS', 'PROPOSALS_IN_FLIGHT'];
  return {
    kind: 'SUMMARY',
    audience: 'HOST',
    items: kinds.map((kind, index) => ({ kind, count: counts[index] ?? 0, href: `/x/${kind}` })),
  };
}

describe('🔴 ① 描かない判定（docs/05 §6.11.1「全 metric の count が 0」）', () => {
  it('全部 0 なら初回空（ストリップを出さず `EmptyState` に倒す）', () => {
    expect(isSummaryInitialEmpty(hostBlock([0, 0, 0]))).toBe(true);
  });

  it('🔴 1 つでも 0 でなければ描く（個々の 0 で項目を間引かない）', () => {
    expect(isSummaryInitialEmpty(hostBlock([0, 1, 0]))).toBe(false);
    expect(summaryStripItems(hostBlock([0, 1, 0]))).toHaveLength(3);
    expect(summaryStripItems(hostBlock([0, 1, 0])).map((item) => item.value)).toEqual(['0', '1', '0']);
  });

  it('指標が 1 つも無い（まだ読んでいない）応答も「描かない」に倒す', () => {
    expect(isSummaryInitialEmpty({ kind: 'SUMMARY', audience: 'HOST', items: [] })).toBe(true);
  });
});

describe('🔴 ② 語の写像は kind の全値を覆う（無名の指標が出ない）', () => {
  it('ホスト / 取引先の写像のキーが 5 つずつあり、すべて実在する文言キーである', () => {
    const ja = catalog(DEFAULT_LOCALE);
    for (const map of [HOST_SUMMARY_METRIC_MESSAGE_KEYS, PARTNER_SUMMARY_METRIC_MESSAGE_KEYS]) {
      expect(Object.keys(map)).toHaveLength(5);
      for (const key of Object.values(map)) {
        expect(ja[key], key).toBeTruthy();
      }
    }
  });

  it('🔴 取引先の語に他社を示唆する表現が無い（`BR-07` / §5-10 の肯定形）', () => {
    const ja = catalog(DEFAULT_LOCALE);
    for (const key of Object.values(PARTNER_SUMMARY_METRIC_MESSAGE_KEYS)) {
      const value = ja[key];
      for (const marker of ['他社', '他の', '順位', '比較', '件中']) {
        expect(value, `${key}: ${marker}`).not.toContain(marker);
      }
    }
  });

  it('ラベルは写像から引かれ、応答の `kind` の順序が保たれる', () => {
    const items = summaryStripItems(hostBlock([1, 2, 3]));
    const ja = catalog(DEFAULT_LOCALE);
    expect(items.map((item) => item.label)).toEqual([
      ja[HOST_SUMMARY_METRIC_MESSAGE_KEYS.PROJECTS],
      ja[HOST_SUMMARY_METRIC_MESSAGE_KEYS.ENGINEERS],
      ja[HOST_SUMMARY_METRIC_MESSAGE_KEYS.PROPOSALS_IN_FLIGHT],
    ]);
  });
});

describe('🔴 ③ 値は 3 桁区切りの件数だけ', () => {
  it('4 桁以上は 3 桁区切りになる（`docs/04` §10.3「大きい数値」）', () => {
    expect(summaryStripItems(hostBlock([12345, 0, 0]))[0]?.value).toBe('12,345');
  });

  it('🔴 `999+` のような丸めをしない（1 万件規模で判断できなくなる）', () => {
    expect(summaryStripItems(hostBlock([10000, 0, 0]))[0]?.value).toBe('10,000');
  });

  it('`href` が `null` の指標はリンクにならない（キーを持たない）', () => {
    const items = summaryStripItems({
      kind: 'SUMMARY',
      audience: 'HOST',
      items: [
        { kind: 'PROJECTS', count: 1, href: null },
        { kind: 'ENGINEERS', count: 2, href: '/engineers' },
        { kind: 'PROPOSALS_IN_FLIGHT', count: 3, href: null },
      ],
    });
    expect(items[0]).toEqual({ label: expect.any(String), value: '1' });
    expect(items[1]?.href).toBe('/engineers');
  });
});
