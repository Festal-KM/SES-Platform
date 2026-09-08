// packages/domain/src/quota/ai-cost.test.ts
// 🔴 1 日の AI コスト上限の判定（`F-027 AC-1` / `AC-5` / docs/05 §7.6）。T-07-04。
//
// 実際の枠の確保（原子性・並行実行）は `tests/isolation/ai-cost-guard.test.ts` が実 DB で見る。
// ここで固定するのは**式と境界**である。
import { describe, expect, it } from 'vitest';
import { decideAiDailyCost } from './ai-cost.js';

function decide(overrides: Partial<Parameters<typeof decideAiDailyCost>[0]> = {}) {
  return decideAiDailyCost({
    limitUsd: '1.500000',
    usedUsd: '0',
    reservedUsd: '0',
    requestedUsd: '0.031500',
    ...overrides,
  });
}

describe('🔴 判定式は used + reserved + requested <= limit', () => {
  it('余裕があれば ALLOW（残り枠は予約前の値）', () => {
    expect(decide({ usedUsd: '0.500000', reservedUsd: '0.100000' })).toEqual({
      kind: 'ALLOW',
      headroomUsd: '0.900000',
    });
  });

  it('🔴 予約中（未補正）の分を必ず含める —— 含めないと並行呼び出しが全部通る', () => {
    // used だけ見れば余裕があるが、予約済みを足すと超える。
    expect(
      decide({ usedUsd: '1.000000', reservedUsd: '0.480000', requestedUsd: '0.031500' }),
    ).toEqual({
      kind: 'BLOCK',
      reason: 'AI_DAILY_COST',
      headroomUsd: '0.020000',
      limitUsd: '1.500000',
    });
  });

  it('上限ちょうどは許す（`decideStorageUpload` と同じ規約）', () => {
    const decision = decide({ usedUsd: '1.468500', requestedUsd: '0.031500' });
    expect(decision.kind).toBe('ALLOW');
    expect(decision.headroomUsd).toBe('0.031500');
  });

  it('🔴 1 micro-USD 超えたら止まる（境界値）', () => {
    expect(decide({ usedUsd: '1.468501', requestedUsd: '0.031500' }).kind).toBe('BLOCK');
  });

  it('🔴 1 回の見積りが上限そのものを超えるなら、消費 0 でも止まる', () => {
    // 「1 回で枠を使い切る要求」を通さない（通すと上限が上限でなくなる）。
    expect(decide({ usedUsd: '0', reservedUsd: '0', requestedUsd: '2.000000' }).kind).toBe('BLOCK');
  });
});

describe('🔴 停止したときに返すもの（F-027 AC-1 / AC-6）', () => {
  it('停止の理由を返す（再開時刻は暦を要するため packages/db が付ける）', () => {
    const decision = decide({ usedUsd: '1.500000' });
    expect(decision.kind).toBe('BLOCK');
    if (decision.kind !== 'BLOCK') throw new Error('unreachable');
    expect(decision.reason).toBe('AI_DAILY_COST');
    // 🔴 `Date` を作らない（domain の純粋性検査。docs/05 §17.2 #14）。
    expect(decision).not.toHaveProperty('resetAt');
  });

  it('🔴 使いすぎていても残り枠は負にならない（0 で止める）', () => {
    const decision = decide({ usedUsd: '2.000000' });
    expect(decision.headroomUsd).toBe('0.000000');
  });

  it('残り枠の意味は両分岐で同じ（予約前の残額）', () => {
    const allow = decide({ usedUsd: '1.000000', requestedUsd: '0.031500' });
    const block = decide({ usedUsd: '1.000000', requestedUsd: '0.600000' });
    expect(allow.headroomUsd).toBe('0.500000');
    expect(block.headroomUsd).toBe('0.500000');
  });
});

describe('入力の門番', () => {
  it('🔴 上限が 0 以下なら例外（「上限なし」を静かに作らない）', () => {
    expect(() => decide({ limitUsd: '0' })).toThrow(RangeError);
    expect(() => decide({ limitUsd: '-1' })).toThrow(RangeError);
  });

  it('負の消費・負の要求は例外にする', () => {
    expect(() => decide({ usedUsd: '-0.1' })).toThrow(RangeError);
    expect(() => decide({ reservedUsd: '-0.1' })).toThrow(RangeError);
    expect(() => decide({ requestedUsd: '-0.1' })).toThrow(RangeError);
  });

  it('十進数として不正な文字列は例外にする', () => {
    expect(() => decide({ usedUsd: 'NaN' })).toThrow(RangeError);
  });
});
