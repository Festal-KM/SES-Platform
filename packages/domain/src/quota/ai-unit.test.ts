// packages/domain/src/quota/ai-unit.test.ts
// docs/05 §5.8（`ALLOW_OVERAGE`）/ §7.6「月次クォータ（件数）」/ docs/03 §7.6.3-4。T-10-03。
import { describe, expect, it } from 'vitest';
import { decideAiUnitQuota, type AiUnitQuotaDecision } from './ai-unit.js';

describe('decideAiUnitQuota（月次の件数クォータ。停止しない）', () => {
  it('クォータの範囲内なら ALLOW（残りは件数）', () => {
    expect(decideAiUnitQuota({ metric: 'AI_UNIT_SHEET_PARSE', monthCount: 118, quota: 180 })).toEqual({
      kind: 'ALLOW',
      metric: 'AI_UNIT_SHEET_PARSE',
      remaining: 62,
    });
  });

  it('🔴 使い切ったら ALLOW_OVERAGE（従量へ移行。超過件数 0 から始まる）', () => {
    expect(decideAiUnitQuota({ metric: 'AI_UNIT_PROPOSAL_DRAFT', monthCount: 180, quota: 180 })).toEqual({
      kind: 'ALLOW_OVERAGE',
      metric: 'AI_UNIT_PROPOSAL_DRAFT',
      overageCount: 0,
    });
  });

  it('超過が進めば overageCount がその分だけ増える', () => {
    expect(decideAiUnitQuota({ metric: 'AI_UNIT_MATCH_RATIONALE', monthCount: 6_212, quota: 6_200 })).toEqual({
      kind: 'ALLOW_OVERAGE',
      metric: 'AI_UNIT_MATCH_RATIONALE',
      overageCount: 12,
    });
  });

  it('🔴 戻り値の型に BLOCK / DEFER が存在しない（クォータ切れで AI 機能が止まる実装を書けない）', () => {
    const kinds: ReadonlySet<AiUnitQuotaDecision['kind']> = new Set(['ALLOW', 'ALLOW_OVERAGE']);
    // 型テスト: 'BLOCK' は `AiUnitQuotaDecision['kind']` に代入できない。
    // @ts-expect-error — BLOCK はこの判定に存在しない
    const forbidden: AiUnitQuotaDecision['kind'] = 'BLOCK';
    expect(kinds.has(forbidden)).toBe(false);
  });

  it('不正な入力は例外にする（黙って ALLOW にしない）', () => {
    expect(() => decideAiUnitQuota({ metric: 'AI_UNIT_RENEWAL_SUMMARY', monthCount: 1, quota: 0 })).toThrow(RangeError);
    expect(() => decideAiUnitQuota({ metric: 'AI_UNIT_RENEWAL_SUMMARY', monthCount: -1, quota: 20 })).toThrow(RangeError);
    expect(() => decideAiUnitQuota({ metric: 'AI_UNIT_RENEWAL_SUMMARY', monthCount: 1.5, quota: 20 })).toThrow(RangeError);
  });
});
