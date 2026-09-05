// packages/domain/src/quota/provider.test.ts
// 🔴 SP-04 T-04-04 の完了判定「`decideProviderQuota` の境界値ユニットテスト」。
//    観点は docs/05 §17.1 の「`provider` が `null` / `min` による丸め / `headroom` の算出」。
import { describe, expect, it } from 'vitest';
import {
  decideProviderQuota,
  isProviderQuotaWarning,
  providerQuotaUsage,
  type ProviderQuotaInput,
} from './provider.js';

const NOW = new Date('2026-09-05T03:00:00.000Z');

function input(overrides: Partial<ProviderQuotaInput> = {}): ProviderQuotaInput {
  return { envLimit: 200, provider: null, localSent24h: 0, now: NOW, ...overrides };
}

describe('境界（consumed + 1 > limit のとき HOLD）', () => {
  it('未消費なら ALLOW（headroom = limit）', () => {
    expect(decideProviderQuota(input({ envLimit: 200 }))).toEqual({ kind: 'ALLOW', headroom: 200 });
  });

  it('🔴 limit - 1 通まで送った状態は ALLOW（headroom = 1）＝ ちょうど上限の 1 通は送れる', () => {
    expect(decideProviderQuota(input({ envLimit: 1, localSent24h: 0 }))).toEqual({
      kind: 'ALLOW',
      headroom: 1,
    });
    expect(decideProviderQuota(input({ envLimit: 200, localSent24h: 199 }))).toEqual({
      kind: 'ALLOW',
      headroom: 1,
    });
  });

  it('🔴 上限ちょうどまで送った状態は HOLD（上限 + 1 通目が外部へ出ない）', () => {
    expect(decideProviderQuota(input({ envLimit: 1, localSent24h: 1 }))).toEqual({ kind: 'HOLD' });
    expect(decideProviderQuota(input({ envLimit: 200, localSent24h: 200 }))).toEqual({ kind: 'HOLD' });
  });

  it('上限を超えて数えられていても HOLD（負の headroom を返さない）', () => {
    expect(decideProviderQuota(input({ envLimit: 200, localSent24h: 500 }))).toEqual({ kind: 'HOLD' });
  });
});

describe('🔴 provider が null（GetAccount の取得失敗）', () => {
  it('手元のカウンタだけで判定を続ける（止めない側に倒さない）', () => {
    expect(decideProviderQuota(input({ envLimit: 10, provider: null, localSent24h: 3 }))).toEqual({
      kind: 'ALLOW',
      headroom: 7,
    });
  });

  it('🔴 null を「枠が無限」と解釈しない（手元のカウンタが上限に達していれば HOLD）', () => {
    expect(decideProviderQuota(input({ envLimit: 10, provider: null, localSent24h: 10 }))).toEqual({
      kind: 'HOLD',
    });
  });
});

describe('🔴 min / max による丸め（docs/05 §8.3-Q ②）', () => {
  it('limit は min(envLimit, provider.max24h) — 設定が SES の枠より大きくても丸まる', () => {
    const decision = decideProviderQuota(
      input({
        envLimit: 50_000,
        provider: { max24h: 200, sentLast24h: 190, observedAt: NOW },
        localSent24h: 0,
      }),
    );
    expect(decision).toEqual({ kind: 'ALLOW', headroom: 10 });
  });

  it('limit は min なので、設定のほうが小さければ設定が効く', () => {
    const decision = decideProviderQuota(
      input({
        envLimit: 5,
        provider: { max24h: 50_000, sentLast24h: 0, observedAt: NOW },
        localSent24h: 4,
      }),
    );
    expect(decision).toEqual({ kind: 'ALLOW', headroom: 1 });
  });

  it('🔴 consumed は max(localSent24h, provider.sentLast24h) — provider が多ければそちらを採る', () => {
    expect(
      decideProviderQuota(
        input({
          envLimit: 200,
          provider: { max24h: 200, sentLast24h: 200, observedAt: NOW },
          localSent24h: 0,
        }),
      ),
    ).toEqual({ kind: 'HOLD' });
  });

  it('🔴 consumed は max なので、手元が多ければ手元を採る（provider は最大 60 秒古い）', () => {
    expect(
      decideProviderQuota(
        input({
          envLimit: 200,
          provider: { max24h: 200, sentLast24h: 10, observedAt: NOW },
          localSent24h: 200,
        }),
      ),
    ).toEqual({ kind: 'HOLD' });
  });
});

describe('providerQuotaUsage（監視が読む実効値。判定と同じ計算を使う）', () => {
  it('limit / consumed / consumptionRate を返す', () => {
    expect(
      providerQuotaUsage(
        input({
          envLimit: 1_000,
          provider: { max24h: 200, sentLast24h: 160, observedAt: NOW },
          localSent24h: 40,
        }),
      ),
    ).toEqual({ limit: 200, consumed: 160, consumptionRate: 0.8 });
  });

  it('🔴 到達（HOLD）と接近（warning）を区別する', () => {
    const usage = providerQuotaUsage(input({ envLimit: 10, localSent24h: 8 }));
    expect(isProviderQuotaWarning(usage, 0.8)).toBe(true);
    // まだ送れる（接近は停止ではない）。
    expect(decideProviderQuota(input({ envLimit: 10, localSent24h: 8 }))).toEqual({
      kind: 'ALLOW',
      headroom: 2,
    });
  });

  it('接近していなければ false', () => {
    expect(isProviderQuotaWarning(providerQuotaUsage(input({ envLimit: 10, localSent24h: 7 })), 0.8)).toBe(
      false,
    );
  });

  it('warnRatio が 0〜1 の外なら RangeError', () => {
    const usage = providerQuotaUsage(input());
    expect(() => isProviderQuotaWarning(usage, 1.5)).toThrow(RangeError);
    expect(() => isProviderQuotaWarning(usage, -0.1)).toThrow(RangeError);
  });
});

describe('不正な入力は黙って通さない', () => {
  it('envLimit が 0 以下 / 非整数なら RangeError', () => {
    expect(() => decideProviderQuota(input({ envLimit: 0 }))).toThrow(RangeError);
    expect(() => decideProviderQuota(input({ envLimit: 1.5 }))).toThrow(RangeError);
  });

  it('localSent24h が負なら RangeError', () => {
    expect(() => decideProviderQuota(input({ localSent24h: -1 }))).toThrow(RangeError);
  });

  it('provider の値が不正なら RangeError', () => {
    expect(() =>
      decideProviderQuota(input({ provider: { max24h: 0, sentLast24h: 0, observedAt: NOW } })),
    ).toThrow(RangeError);
    expect(() =>
      decideProviderQuota(input({ provider: { max24h: 10, sentLast24h: -1, observedAt: NOW } })),
    ).toThrow(RangeError);
  });

  it('🔴 now が不正な Date なら RangeError（黙って通さない）', () => {
    expect(() => decideProviderQuota(input({ now: new Date('bad') }))).toThrow(RangeError);
  });
});
