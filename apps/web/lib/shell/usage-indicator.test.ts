// apps/web/lib/shell/usage-indicator.test.ts
// ヘッダの上限インジケータの選び方（docs/04 §3.1 / `F-027 AC-6` / `BR-24`）。
//
// 🔴 固定するのは 4 つ:
//    ① **80% 未満（全単位 `BELOW`）では何も出さない**（平常時の常時警告を作らない）
//    ② **停止中は残量ではなく「停止中」**（`STOPPED` は残量の項目を持たない）
//    ③ 接近が複数あるとき **到達（`REACHED`）を優先し、選び方が決定的**である
//    ④ **金額を 1 つも作らない**（件数 / 通数 / GB だけ）
import { describe, expect, it } from 'vitest';
import type { UsageView } from '../usage/view';
import { selectShellUsageIndicator } from './usage-indicator';

function viewOf(overrides: Partial<UsageView> = {}): UsageView {
  const unit = { used: 0, quota: 100, remaining: 100, overageCount: 0, level: 'BELOW', onExceed: 'METERED' } as const;
  return {
    asOf: '2026-09-25T00:00:00.000Z',
    warnPercent: 80,
    aiUnits: {
      sheetParse: unit,
      matchRationale: unit,
      proposalDraft: unit,
      renewalSummary: unit,
    },
    aiDailyStop: { stopped: false },
    overageEstimateJpy: null,
    storage: {
      usedBytes: '0',
      limitBytes: (10n * 1024n * 1024n * 1024n).toString(),
      level: 'BELOW',
      onExceed: 'STOP_UPLOAD',
    },
    email: {
      usedToday: 0,
      dailyLimit: 500,
      usedLastMinute: 0,
      minuteLimit: 30,
      level: 'BELOW',
      state: 'ALLOW',
      onExceed: 'STOP_DAILY_DEFER_MINUTE',
    },
    seats: { used: 3, limit: null },
    ...overrides,
  };
}

describe('🔴 ① 80% 未満では出さない', () => {
  it('全単位が BELOW で停止もしていなければ NONE', () => {
    expect(selectShellUsageIndicator(viewOf())).toEqual({ kind: 'NONE' });
  });
});

describe('🔴 ② 停止中は残量ではなく「停止中」', () => {
  it('AI の 1 日の上限に達していれば STOPPED（残量の項目を持たない）', () => {
    const indicator = selectShellUsageIndicator(
      viewOf({
        aiDailyStop: {
          stopped: true,
          reasonKey: 'quota.aiDaily',
          since: '2026-09-25T01:00:00.000Z',
          resetAt: '2026-09-25T15:00:00.000Z',
          stoppedFeatures: ['reviewGate'],
        },
      }),
    );
    expect(indicator).toEqual({ kind: 'STOPPED' });
  });

  it('🔴 停止が接近より優先される（止まっているのに残量を出さない）', () => {
    const view = viewOf({
      aiDailyStop: {
        stopped: true,
        reasonKey: 'quota.aiDaily',
        since: '2026-09-25T01:00:00.000Z',
        resetAt: '2026-09-25T15:00:00.000Z',
        stoppedFeatures: ['reviewGate'],
      },
      email: { ...viewOf().email, usedToday: 480, level: 'NEARING' },
    });
    expect(selectShellUsageIndicator(view).kind).toBe('STOPPED');
  });
});

describe('🔴 ③ 接近の選び方は決定的（到達 > 接近、AI → メール → ストレージ）', () => {
  it('AI の単位が到達していればその単位を件数で出す', () => {
    const base = viewOf();
    const indicator = selectShellUsageIndicator(
      viewOf({
        aiUnits: {
          ...base.aiUnits,
          proposalDraft: { ...base.aiUnits.proposalDraft, used: 100, remaining: 0, level: 'REACHED' },
        },
      }),
    );
    expect(indicator).toEqual({
      kind: 'NEARING',
      metric: {
        labelKey: 'usage.aiUnit.proposalDraft',
        remaining: '0',
        unitKey: 'usage.unit.count',
        level: 'REACHED',
      },
    });
  });

  it('接近（NEARING）より到達（REACHED）を先に出す', () => {
    const base = viewOf();
    const indicator = selectShellUsageIndicator(
      viewOf({
        aiUnits: {
          ...base.aiUnits,
          sheetParse: { ...base.aiUnits.sheetParse, used: 85, remaining: 15, level: 'NEARING' },
          renewalSummary: { ...base.aiUnits.renewalSummary, used: 100, remaining: 0, level: 'REACHED' },
        },
      }),
    );
    expect(indicator).toMatchObject({
      kind: 'NEARING',
      metric: { labelKey: 'usage.aiUnit.renewalSummary', level: 'REACHED' },
    });
  });

  it('メールは残り通数（1 日の上限 − 本日の送信数）で出す', () => {
    const indicator = selectShellUsageIndicator(
      viewOf({ email: { ...viewOf().email, usedToday: 1400, dailyLimit: 1500, level: 'NEARING' } }),
    );
    expect(indicator).toEqual({
      kind: 'NEARING',
      metric: {
        labelKey: 'usage.section.email',
        remaining: '100',
        unitKey: 'usage.unit.messages',
        level: 'NEARING',
      },
    });
  });

  it('ストレージは残り GB で出す（上限を超えていても負の残量にしない）', () => {
    const limit = 10n * 1024n * 1024n * 1024n;
    const indicator = selectShellUsageIndicator(
      viewOf({
        storage: {
          usedBytes: (limit + 1n).toString(),
          limitBytes: limit.toString(),
          level: 'REACHED',
          onExceed: 'STOP_UPLOAD',
        },
      }),
    );
    expect(indicator).toEqual({
      kind: 'NEARING',
      metric: {
        labelKey: 'usage.section.storage',
        remaining: '0.0',
        unitKey: 'usage.unit.gb',
        level: 'REACHED',
      },
    });
  });
});

describe('🔴 ④ 金額を 1 つも作らない', () => {
  it('請求見込み（円）が入っていてもインジケータには現れない', () => {
    const base = viewOf();
    const indicator = selectShellUsageIndicator(
      viewOf({
        overageEstimateJpy: '12000',
        aiUnits: {
          ...base.aiUnits,
          sheetParse: { ...base.aiUnits.sheetParse, used: 90, remaining: 10, level: 'NEARING' },
        },
      }),
    );
    expect(JSON.stringify(indicator)).not.toContain('12000');
    expect(JSON.stringify(indicator).toLowerCase()).not.toContain('jpy');
  });
});
