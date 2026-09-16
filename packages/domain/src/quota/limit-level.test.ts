// packages/domain/src/quota/limit-level.test.ts
// docs/02 `F-027 AC-4`（80% で通知）/ 処理⑤（到達・停止・解除の記録）。T-10-03。
import { describe, expect, it } from 'vitest';
import { decideLimitLevel, decideLimitTransition, USAGE_LIMIT_LEVELS } from './limit-level.js';

describe('decideLimitLevel（接近 / 到達の水準）', () => {
  it('80% 未満は BELOW', () => {
    expect(decideLimitLevel({ used: 79n, limit: 100n, warnPercent: 80 })).toBe('BELOW');
  });

  it('🔴 80% ちょうどで NEARING（「達した時点」で通知する）', () => {
    expect(decideLimitLevel({ used: 80n, limit: 100n, warnPercent: 80 })).toBe('NEARING');
  });

  it('端数を浮動小数点で丸めない（整数演算。144/180 = 80% ちょうど）', () => {
    expect(decideLimitLevel({ used: 144n, limit: 180n, warnPercent: 80 })).toBe('NEARING');
    expect(decideLimitLevel({ used: 143n, limit: 180n, warnPercent: 80 })).toBe('BELOW');
  });

  it('🔴 使い切ったら REACHED（超えたかどうかではなく、使い切った時点）', () => {
    expect(decideLimitLevel({ used: 100n, limit: 100n, warnPercent: 80 })).toBe('REACHED');
    expect(decideLimitLevel({ used: 250n, limit: 100n, warnPercent: 80 })).toBe('REACHED');
  });

  it('閾値は引数で受ける（80 を決め打ちしない）', () => {
    expect(decideLimitLevel({ used: 50n, limit: 100n, warnPercent: 50 })).toBe('NEARING');
    expect(decideLimitLevel({ used: 50n, limit: 100n, warnPercent: 51 })).toBe('BELOW');
  });

  it('Number の安全整数を超える値でも判定できる（バイト数）', () => {
    const huge = 9_007_199_254_740_993n;
    expect(decideLimitLevel({ used: huge - 1n, limit: huge, warnPercent: 80 })).toBe('NEARING');
    expect(decideLimitLevel({ used: huge, limit: huge, warnPercent: 80 })).toBe('REACHED');
  });

  it('不正な入力は例外にする', () => {
    expect(() => decideLimitLevel({ used: 0n, limit: 0n, warnPercent: 80 })).toThrow(RangeError);
    expect(() => decideLimitLevel({ used: -1n, limit: 10n, warnPercent: 80 })).toThrow(RangeError);
    expect(() => decideLimitLevel({ used: 0n, limit: 10n, warnPercent: 0 })).toThrow(RangeError);
    expect(() => decideLimitLevel({ used: 0n, limit: 10n, warnPercent: 100 })).toThrow(RangeError);
  });

  it('値集合は 3 値（CHECK 制約と同じ文字列）', () => {
    expect([...USAGE_LIMIT_LEVELS]).toEqual(['BELOW', 'NEARING', 'REACHED']);
  });
});

describe('decideLimitTransition（遷移。通知と監査の契機）', () => {
  it('変化が無ければ UNCHANGED（何度評価しても通知・記録が増えない）', () => {
    expect(decideLimitTransition('REACHED', 'REACHED')).toBe('UNCHANGED');
    expect(decideLimitTransition('BELOW', 'BELOW')).toBe('UNCHANGED');
  });

  it('上がったら RAISED（接近 / 到達の通知）', () => {
    expect(decideLimitTransition('BELOW', 'NEARING')).toBe('RAISED');
    expect(decideLimitTransition('NEARING', 'REACHED')).toBe('RAISED');
    expect(decideLimitTransition('BELOW', 'REACHED')).toBe('RAISED');
  });

  it('🔴 到達が解けたら RELEASED（「解除」の監査ログ）', () => {
    expect(decideLimitTransition('REACHED', 'BELOW')).toBe('RELEASED');
    expect(decideLimitTransition('REACHED', 'NEARING')).toBe('RELEASED');
  });

  it('接近が解けただけなら LOWERED（到達していないので「解除」ではない）', () => {
    expect(decideLimitTransition('NEARING', 'BELOW')).toBe('LOWERED');
  });

  it('🔴 初回評価（previous = null）は BELOW からの遷移とみなす（既に到達しているテナントでも通知される）', () => {
    expect(decideLimitTransition(null, 'REACHED')).toBe('RAISED');
    expect(decideLimitTransition(null, 'BELOW')).toBe('UNCHANGED');
  });
});
