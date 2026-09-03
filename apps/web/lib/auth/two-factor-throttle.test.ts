// apps/web/lib/auth/two-factor-throttle.test.ts
// 🔴 6 桁 TOTP の総当たりを止めるのはこの判定だけである（docs/04 §S-001 / `code-reviewer` 指摘）。
//    窓の境界・解除までの残り時間・古い失敗の扱いを固定する。
import { describe, expect, it } from 'vitest';
import {
  evaluateTwoFactorThrottle,
  TWO_FACTOR_THROTTLE_POLICY,
  twoFactorThrottleWindowStart,
} from './two-factor-throttle';

const NOW = new Date('2026-09-03T12:00:00.000Z');
const MINUTE = 60_000;

/** `NOW` から `minutesAgo` 分前の時刻。 */
function ago(minutesAgo: number): Date {
  return new Date(NOW.getTime() - minutesAgo * MINUTE);
}

function failures(...minutesAgo: readonly number[]): readonly Date[] {
  return minutesAgo.map(ago);
}

describe('暫定ポリシー（⚠️ Issue で恒久値に置き換える）', () => {
  it('15 分窓 / 5 回である', () => {
    expect(TWO_FACTOR_THROTTLE_POLICY).toEqual({ windowMinutes: 15, maxFailures: 5 });
  });

  it('窓の開始時刻は now - 15 分', () => {
    expect(twoFactorThrottleWindowStart(NOW).toISOString()).toBe('2026-09-03T11:45:00.000Z');
  });
});

describe('evaluateTwoFactorThrottle', () => {
  it('失敗が無ければロックしない', () => {
    expect(evaluateTwoFactorThrottle([], NOW)).toEqual({
      locked: false,
      failures: 0,
      retryAfterSeconds: 0,
    });
  });

  it('閾値未満（4 回）ではロックしない', () => {
    const state = evaluateTwoFactorThrottle(failures(1, 2, 3, 4), NOW);
    expect(state.locked).toBe(false);
    expect(state.failures).toBe(4);
    expect(state.retryAfterSeconds).toBe(0);
  });

  it('🔴 閾値（5 回）に達したらロックする', () => {
    const state = evaluateTwoFactorThrottle(failures(1, 2, 3, 4, 5), NOW);
    expect(state.locked).toBe(true);
    expect(state.failures).toBe(5);
  });

  it('🔴 解除までの残り時間は「窓内で最も古い失敗 + 15 分」までである', () => {
    // 最も古い失敗が 10 分前 → 解除は 5 分後。
    const state = evaluateTwoFactorThrottle(failures(10, 4, 3, 2, 1), NOW);
    expect(state.locked).toBe(true);
    expect(state.retryAfterSeconds).toBe(5 * 60);
  });

  it('🔴 窓外（15 分より前）の失敗は数えない ＝ 古い失敗で永久にロックされない', () => {
    const state = evaluateTwoFactorThrottle(failures(60, 40, 20, 16, 1), NOW);
    expect(state.locked).toBe(false);
    expect(state.failures).toBe(1);
  });

  it('窓の境界: ちょうど 15 分前の失敗は窓に入り、15 分 1 秒前は入らない', () => {
    const onEdge = new Date(NOW.getTime() - 15 * MINUTE);
    const outside = new Date(NOW.getTime() - 15 * MINUTE - 1000);
    expect(evaluateTwoFactorThrottle([onEdge], NOW).failures).toBe(1);
    expect(evaluateTwoFactorThrottle([outside], NOW).failures).toBe(0);
  });

  it('窓から 1 件外れた瞬間にロックが解ける（スライディングウィンドウ）', () => {
    const timestamps = failures(15, 5, 4, 3, 2);
    expect(evaluateTwoFactorThrottle(timestamps, NOW).locked).toBe(true);
    // 1 秒後には最古の失敗が窓の外に出るため、残り 4 件でロックが解ける。
    const oneSecondLater = new Date(NOW.getTime() + 1000);
    expect(evaluateTwoFactorThrottle(timestamps, oneSecondLater).locked).toBe(false);
  });

  it('🔴 ロック中の残り時間は必ず 1 秒以上（0 を返して即再試行させない）', () => {
    // 解除時刻ちょうど（境界）でもロックが成立する側では 1 秒を返す。
    const timestamps = failures(15, 15, 15, 15, 15);
    const state = evaluateTwoFactorThrottle(timestamps, NOW);
    expect(state.locked).toBe(true);
    expect(state.retryAfterSeconds).toBeGreaterThanOrEqual(1);
    expect(state.retryAfterSeconds).toBeLessThanOrEqual(TWO_FACTOR_THROTTLE_POLICY.windowMinutes * 60);
  });

  it('🔴 未来日時の失敗行（時計のずれ）でも、残り時間は窓 1 つ分を超えない', () => {
    const future = new Date(NOW.getTime() + 60 * MINUTE);
    const state = evaluateTwoFactorThrottle([future, future, future, future, future], NOW);
    expect(state.locked).toBe(true);
    expect(state.retryAfterSeconds).toBe(TWO_FACTOR_THROTTLE_POLICY.windowMinutes * 60);
  });

  it('入力の順序に依存しない（DB の並び順に結論を委ねない）', () => {
    const ascending = failures(1, 2, 3, 4, 10);
    const shuffled = failures(3, 10, 1, 4, 2);
    expect(evaluateTwoFactorThrottle(shuffled, NOW)).toEqual(
      evaluateTwoFactorThrottle(ascending, NOW),
    );
  });

  it('ポリシーを差し替えられる（設定値へ外出しできる形になっている）', () => {
    const state = evaluateTwoFactorThrottle(failures(1, 2), NOW, {
      windowMinutes: 5,
      maxFailures: 2,
    });
    expect(state.locked).toBe(true);
    expect(state.retryAfterSeconds).toBe(3 * 60);
  });
});
