// apps/web/lib/home/summary-view.test.ts
// 🔴 **KPI カード 4 枚**の「描かない判定」「語の写像」「差分の文字列」（`docs/04` §4.1 / §7.2 改訂 23 /
//    docs/05 §6.11.1）。T-22-09 → ✅ 2026-10-02（`SummaryStrip` → `KpiCardRow`）。
//
// 固定するもの:
//   ① 🔴 **描かないのはサーバの `initialEmpty`（= 案件も人材も 0 件）だけ**。**件数が全部 0 でも
//      描く**（平常日は 4 指標すべてが 0 になりうる —— ここを「全部 0 なら初回空」にすると、
//      案件と人材が揃っているのに「まだ登録されていません」と出る）
//   ② 🔴 語の写像は `kind` の全値を覆う（無名の指標が出ない）。取引先の語は**肯定形**で他社を示唆しない
//   ③ 🔴 差分は**件数の差**だけ（率 / % / 達成率を作れない）。`null` は欄ごと描かない（`±0` と別物）
//   ④ 🔴 値は 3 桁区切りの件数（`999+` のような丸めをしない）
//   ⑤ 🔴 アイコンは閉じた写像から来る（比喩アイコンを書けない = 型エラー）
import { describe, expect, it } from 'vitest';
import { catalog, DEFAULT_LOCALE } from '@ses/i18n';
import {
  formatKpiDelta,
  HOST_SUMMARY_METRIC_ICONS,
  HOST_SUMMARY_METRIC_MESSAGE_KEYS,
  isHomeInitialEmpty,
  kpiCardId,
  kpiCardItems,
  PARTNER_SUMMARY_METRIC_ICONS,
  PARTNER_SUMMARY_METRIC_MESSAGE_KEYS,
  type KpiCardMessages,
} from './summary-view';
import type { HostSummaryMetricKind, SummaryHomeBlock, SummaryMetricDelta } from './types';

const MESSAGES: KpiCardMessages = {
  labels: {
    ACTION_QUEUE: 'L_ACTION_QUEUE',
    AWAITING_REPLY: 'L_AWAITING_REPLY',
    INTERVIEWS: 'L_INTERVIEWS',
    PROPOSALS_THIS_WEEK: 'L_PROPOSALS_THIS_WEEK',
  },
  unit: '件',
  delta: {
    increase: '↑ +',
    decrease: '↓ −',
    unchanged: '±0',
    basis: { PREVIOUS_DAY: '（昨日比）', PREVIOUS_WEEK: '（先週比）' },
  },
};

const HOST_KINDS: readonly HostSummaryMetricKind[] = [
  'ACTION_QUEUE',
  'AWAITING_REPLY',
  'INTERVIEWS',
  'PROPOSALS_THIS_WEEK',
];

function hostBlock(
  counts: readonly number[],
  options: { readonly initialEmpty?: boolean; readonly delta?: SummaryMetricDelta | null } = {},
): SummaryHomeBlock {
  return {
    kind: 'SUMMARY',
    audience: 'HOST',
    initialEmpty: options.initialEmpty ?? false,
    items: HOST_KINDS.map((kind, index) => ({
      kind,
      count: counts[index] ?? 0,
      href: null,
      delta: kind === 'PROPOSALS_THIS_WEEK' ? (options.delta ?? null) : null,
    })),
  };
}

describe('🔴 ① 描かない判定は `initialEmpty` だけ（件数が全部 0 でも描く）', () => {
  it('🔴 4 指標が全部 0 でも描く（平常日は対応が要るものが 0 件になる）', () => {
    expect(isHomeInitialEmpty(hostBlock([0, 0, 0, 0]))).toBe(false);
    expect(kpiCardItems(hostBlock([0, 0, 0, 0]), MESSAGES)).toHaveLength(4);
  });

  it('サーバが初回空（案件も人材も 0 件）と言ったときだけ描かない', () => {
    expect(isHomeInitialEmpty(hostBlock([0, 0, 0, 0], { initialEmpty: true }))).toBe(true);
  });

  it('🔴 個々の 0 で項目を間引かない（並びが日によって変わらない）', () => {
    const items = kpiCardItems(hostBlock([0, 3, 0, 0]), MESSAGES);
    expect(items.map((item) => item.value)).toEqual(['0', '3', '0', '0']);
    expect(items.map((item) => item.id)).toEqual([
      'action-queue',
      'awaiting-reply',
      'interviews',
      'proposals-this-week',
    ]);
  });
});

describe('🔴 ② 語の写像は kind の全値を覆う（無名の指標が出ない）', () => {
  it('ホスト / 取引先の写像のキーが 4 つずつあり、すべて実在する文言キーである', () => {
    const ja = catalog(DEFAULT_LOCALE);
    for (const map of [HOST_SUMMARY_METRIC_MESSAGE_KEYS, PARTNER_SUMMARY_METRIC_MESSAGE_KEYS]) {
      expect(Object.keys(map)).toHaveLength(4);
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

  it('🔴 指標の語に金額・率の単位が無い（§7.2 の禁止）', () => {
    const ja = catalog(DEFAULT_LOCALE);
    for (const key of [
      ...Object.values(HOST_SUMMARY_METRIC_MESSAGE_KEYS),
      ...Object.values(PARTNER_SUMMARY_METRIC_MESSAGE_KEYS),
    ]) {
      for (const marker of ['円', '$', '%', '率']) {
        expect(ja[key], `${key}: ${marker}`).not.toContain(marker);
      }
    }
  });

  it('ラベルは写像から引かれ、応答の `kind` の順序が保たれる', () => {
    const items = kpiCardItems(hostBlock([1, 2, 3, 4]), MESSAGES);
    expect(items.map((item) => item.label)).toEqual([
      'L_ACTION_QUEUE',
      'L_AWAITING_REPLY',
      'L_INTERVIEWS',
      'L_PROPOSALS_THIS_WEEK',
    ]);
  });
});

describe('🔴 ③ 差分は件数の差だけ（率・% を作れない）', () => {
  it('増加は上向きの記号 + 符号 + 基準', () => {
    expect(formatKpiDelta({ basis: 'PREVIOUS_WEEK', count: 2 }, MESSAGES.delta)).toBe('↑ +2（先週比）');
  });

  it('減少は下向きの記号（🔴 絶対値を出す。`−-3` にならない）', () => {
    expect(formatKpiDelta({ basis: 'PREVIOUS_DAY', count: -3 }, MESSAGES.delta)).toBe('↓ −3（昨日比）');
  });

  it('🔴 変化なしは `±0`（「比較できない」と区別する）', () => {
    expect(formatKpiDelta({ basis: 'PREVIOUS_WEEK', count: 0 }, MESSAGES.delta)).toBe('±0（先週比）');
  });

  it('🔴 `null` は欄ごと描かない（`±0` と別物。比較対象のデータが無い）', () => {
    expect(formatKpiDelta(null, MESSAGES.delta)).toBeNull();
    const items = kpiCardItems(hostBlock([1, 2, 3, 4]), MESSAGES);
    // 在庫の 3 指標には差分が無く、`今週の提案` だけが持つ（`./summary.ts` の 🔴）。
    expect(items.map((item) => item.delta)).toEqual([null, null, null, null]);
  });

  it('差分の文字列に率・% ・金額が入らない', () => {
    const items = kpiCardItems(hostBlock([1, 2, 3, 4], { delta: { basis: 'PREVIOUS_WEEK', count: 5 } }), MESSAGES);
    const text = items.map((item) => item.delta ?? '').join(' ');
    for (const marker of ['%', '％', '円', '倍']) expect(text, marker).not.toContain(marker);
    expect(items[3]?.delta).toBe('↑ +5（先週比）');
  });

  it('🔴 4 桁以上の差分も 3 桁区切りになる（読み違えない）', () => {
    expect(formatKpiDelta({ basis: 'PREVIOUS_WEEK', count: -1234 }, MESSAGES.delta)).toBe('↓ −1,234（先週比）');
  });
});

describe('🔴 ④ 値は 3 桁区切りの件数だけ', () => {
  it('4 桁以上は 3 桁区切りになる（`docs/04` §10.3「大きい数値」）', () => {
    expect(kpiCardItems(hostBlock([12345, 0, 0, 0]), MESSAGES)[0]?.value).toBe('12,345');
  });

  it('🔴 `999+` のような丸めをしない（1 万件規模で判断できなくなる）', () => {
    expect(kpiCardItems(hostBlock([10000, 0, 0, 0]), MESSAGES)[0]?.value).toBe('10,000');
  });

  it('単位は語から来る（🔴 金額の単位を作らない）', () => {
    expect(kpiCardItems(hostBlock([1, 0, 0, 0]), MESSAGES).every((item) => item.unit === '件')).toBe(true);
  });
});

describe('🔴 ⑤ アイコンは閉じた写像から来る（比喩アイコンを書けない）', () => {
  it('ホスト / 取引先の 4 指標すべてにアイコンが割り当たっている', () => {
    expect(Object.keys(HOST_SUMMARY_METRIC_ICONS)).toHaveLength(4);
    expect(Object.keys(PARTNER_SUMMARY_METRIC_ICONS)).toHaveLength(4);
  });

  it('🔴 比喩アイコン（稲妻 / 電球 / きらめき）が 1 つも無い（§7.5）', () => {
    const used = [
      ...Object.values(HOST_SUMMARY_METRIC_ICONS),
      ...Object.values(PARTNER_SUMMARY_METRIC_ICONS),
    ];
    for (const forbidden of ['zap', 'lightbulb', 'sparkles', 'rocket', 'brain']) {
      expect(used, forbidden).not.toContain(forbidden);
    }
  });

  it('`kind` → testid の接尾辞は機械変換である（写像を 2 つ持たない）', () => {
    expect(kpiCardId('PROPOSALS_THIS_WEEK')).toBe('proposals-this-week');
    expect(kpiCardId('INTERVIEWS')).toBe('interviews');
  });
});
