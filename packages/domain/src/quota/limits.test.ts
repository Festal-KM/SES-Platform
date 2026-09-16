// packages/domain/src/quota/limits.test.ts
// 🔴 3 種の区別（docs/02 `F-027` 処理①〜⑤ / 章 7.5 / docs/03 §7.6.3-4 / docs/04 §S-038）。T-10-03。
import { describe, expect, it } from 'vitest';
import { AI_UNIT_METRICS } from '../ai/units.js';
import {
  assessUsageLimits,
  shouldNotifyTenant,
  TENANT_NOTICE_LEVELS,
  USAGE_LIMIT_EFFECT,
  USAGE_LIMIT_METRICS,
  type UsageLimitAssessmentInput,
} from './limits.js';

const GB = 1024n * 1024n * 1024n;

function input(overrides: Partial<UsageLimitAssessmentInput> = {}): UsageLimitAssessmentInput {
  return {
    warnPercent: 80,
    aiDailyCost: { stopped: false, consumedMicros: 1_000_000n, limitMicros: 5_000_000n },
    aiUnits: {
      AI_UNIT_SHEET_PARSE: { used: 10, quota: 180 },
      AI_UNIT_MATCH_RATIONALE: { used: 100, quota: 6_200 },
      AI_UNIT_PROPOSAL_DRAFT: { used: 10, quota: 180 },
      AI_UNIT_RENEWAL_SUMMARY: { used: 1, quota: 20 },
    },
    email: { usedToday: 10, dailyLimit: 500 },
    storage: { usedBytes: 1n * GB, limitBytes: 50n * GB },
    ...overrides,
  };
}

describe('assessUsageLimits（3 種の区別）', () => {
  it('平常時はすべて BELOW で、効果の表だけが種類ごとに違う', () => {
    const result = assessUsageLimits(input());
    for (const metric of USAGE_LIMIT_METRICS) {
      expect(result[metric].level).toBe('BELOW');
      expect(result[metric].effect).toBe(USAGE_LIMIT_EFFECT[metric]);
    }
  });

  it('🔴 効果の表: AI コストは停止 / 件数は従量 / メールは日次停止 / ストレージはアップロード停止', () => {
    expect(USAGE_LIMIT_EFFECT.AI_COST_USD).toBe('STOP_AI');
    for (const metric of AI_UNIT_METRICS) expect(USAGE_LIMIT_EFFECT[metric]).toBe('METERED');
    expect(USAGE_LIMIT_EFFECT.EMAIL_COUNT).toBe('STOP_EMAIL_DAILY');
    expect(USAGE_LIMIT_EFFECT.STORAGE_BYTES).toBe('STOP_UPLOAD');
    // 🔴 3 種の効果が互いに異なる（同じ表示に畳めない）。
    expect(new Set([USAGE_LIMIT_EFFECT.AI_COST_USD, USAGE_LIMIT_EFFECT.AI_UNIT_SHEET_PARSE, USAGE_LIMIT_EFFECT.STORAGE_BYTES]).size).toBe(3);
  });

  it('🔴 ① AI コスト: 停止の定義は probe（stopped）であり、比率からは REACHED を導かない', () => {
    // 比率は 100% 以上だが stopped=false（probe が ALLOW と言った）→ NEARING に留める
    const ratioOnly = assessUsageLimits(
      input({ aiDailyCost: { stopped: false, consumedMicros: 5_000_000n, limitMicros: 5_000_000n } }),
    );
    expect(ratioOnly.AI_COST_USD.level).toBe('NEARING');

    // 比率は 50% だが見積り 1 回ぶんが通らない（stopped=true）→ REACHED（停止）
    const stopped = assessUsageLimits(
      input({ aiDailyCost: { stopped: true, consumedMicros: 2_500_000n, limitMicros: 5_000_000n } }),
    );
    expect(stopped.AI_COST_USD).toEqual({ level: 'REACHED', effect: 'STOP_AI' });
  });

  it('① AI コスト: 予約中（reserved）を含む消費が 80% で NEARING', () => {
    const result = assessUsageLimits(
      input({ aiDailyCost: { stopped: false, consumedMicros: 4_000_000n, limitMicros: 5_000_000n } }),
    );
    expect(result.AI_COST_USD.level).toBe('NEARING');
  });

  it('🔴 ② AI 件数: 使い切ると REACHED だが効果は METERED（停止しない）', () => {
    const result = assessUsageLimits(
      input({
        aiUnits: {
          AI_UNIT_SHEET_PARSE: { used: 180, quota: 180 },
          AI_UNIT_MATCH_RATIONALE: { used: 4_960, quota: 6_200 }, // 80%
          AI_UNIT_PROPOSAL_DRAFT: { used: 143, quota: 180 }, // 79.4%
          AI_UNIT_RENEWAL_SUMMARY: { used: 25, quota: 20 }, // 超過中
        },
      }),
    );
    expect(result.AI_UNIT_SHEET_PARSE).toEqual({ level: 'REACHED', effect: 'METERED' });
    expect(result.AI_UNIT_MATCH_RATIONALE).toEqual({ level: 'NEARING', effect: 'METERED' });
    expect(result.AI_UNIT_PROPOSAL_DRAFT).toEqual({ level: 'BELOW', effect: 'METERED' });
    expect(result.AI_UNIT_RENEWAL_SUMMARY).toEqual({ level: 'REACHED', effect: 'METERED' });
    // 🔴 件数が到達しても AI コスト（停止）には影響しない（独立に評価する）。
    expect(result.AI_COST_USD.level).toBe('BELOW');
  });

  it('🔴 ③ ストレージ: 上限で REACHED、効果は STOP_UPLOAD（従量へ移行しない）', () => {
    const result = assessUsageLimits(input({ storage: { usedBytes: 50n * GB, limitBytes: 50n * GB } }));
    expect(result.STORAGE_BYTES).toEqual({ level: 'REACHED', effect: 'STOP_UPLOAD' });
    const nearing = assessUsageLimits(input({ storage: { usedBytes: 40n * GB, limitBytes: 50n * GB } }));
    expect(nearing.STORAGE_BYTES.level).toBe('NEARING');
  });

  it('メール（日次）: 500 通で REACHED、400 通で NEARING（`decideEmailRate` の BLOCK と同じ境界）', () => {
    expect(assessUsageLimits(input({ email: { usedToday: 500, dailyLimit: 500 } })).EMAIL_COUNT).toEqual({
      level: 'REACHED',
      effect: 'STOP_EMAIL_DAILY',
    });
    expect(assessUsageLimits(input({ email: { usedToday: 400, dailyLimit: 500 } })).EMAIL_COUNT.level).toBe('NEARING');
    expect(assessUsageLimits(input({ email: { usedToday: 399, dailyLimit: 500 } })).EMAIL_COUNT.level).toBe('BELOW');
  });

  it('🔴 評価結果に金額（USD）の項目が無い（S-038 / #70 はここから組み立てる）', () => {
    const result = assessUsageLimits(input());
    // 🔴 `AI_COST_USD` は計測名（キー）としてだけ現れる。値のキー名にも値にも金額が無い。
    for (const metric of USAGE_LIMIT_METRICS) {
      expect(Object.keys(result[metric]).sort()).toEqual(['effect', 'level']);
      expect(JSON.stringify(Object.values(result[metric]))).not.toMatch(/usd|cost|price|micros|\d/i);
    }
  });

  it('計測の集合は 7（AI コスト + 件数 4 + メール + ストレージ。席数と電子署名は対象外）', () => {
    expect([...USAGE_LIMIT_METRICS]).toEqual([
      'AI_COST_USD',
      'AI_UNIT_SHEET_PARSE',
      'AI_UNIT_MATCH_RATIONALE',
      'AI_UNIT_PROPOSAL_DRAFT',
      'AI_UNIT_RENEWAL_SUMMARY',
      'EMAIL_COUNT',
      'STORAGE_BYTES',
    ]);
  });
});

describe('shouldNotifyTenant（テナント管理者への通知の水準。F-027 AC-4）', () => {
  it('🔴 AI コストは到達（停止）だけ。接近（80%）は通知しない（利用者にメーターを見せない上限）', () => {
    expect(shouldNotifyTenant('AI_COST_USD', 'NEARING')).toBe(false);
    expect(shouldNotifyTenant('AI_COST_USD', 'REACHED')).toBe(true);
    expect(TENANT_NOTICE_LEVELS.AI_COST_USD).toEqual(['REACHED']);
  });

  it('件数 4 単位 / メール / ストレージは接近と到達の両方を通知する', () => {
    for (const metric of [...AI_UNIT_METRICS, 'EMAIL_COUNT', 'STORAGE_BYTES'] as const) {
      expect(shouldNotifyTenant(metric, 'NEARING')).toBe(true);
      expect(shouldNotifyTenant(metric, 'REACHED')).toBe(true);
      expect(shouldNotifyTenant(metric, 'BELOW')).toBe(false);
    }
  });
});
