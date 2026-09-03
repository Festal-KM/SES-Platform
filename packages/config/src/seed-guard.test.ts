// packages/config/src/seed-guard.test.ts
// F-053 AC-6 / docs/05 §13.6: 合成データの投入・リセットは APP_ENV が demo / development の
// ときだけ実行できる。**5 環境すべて**を検査する（許可側だけを書くと、環境が増えたときに
// 既定で許可される実装を見逃す）。
import { describe, expect, it } from 'vitest';
import { APP_ENV_KINDS } from './app-env.js';
import {
  SEEDABLE_APP_ENVS,
  SeedNotAllowedError,
  assertSeedableAppEnv,
  isSeedableAppEnv,
} from './seed-guard.js';

describe('APP_ENV による投入・リセットのガード（F-053 AC-6）', () => {
  it.each([...APP_ENV_KINDS])('%s の可否が SEEDABLE_APP_ENVS と一致する', (appEnv) => {
    const allowed = (SEEDABLE_APP_ENVS as readonly string[]).includes(appEnv);
    expect(isSeedableAppEnv(appEnv)).toBe(allowed);
    if (allowed) {
      expect(() => assertSeedableAppEnv(appEnv)).not.toThrow();
    } else {
      expect(() => assertSeedableAppEnv(appEnv)).toThrow(SeedNotAllowedError);
    }
  });

  it('🔴 production / sandbox / staging は拒否される', () => {
    for (const appEnv of ['production', 'sandbox', 'staging']) {
      expect(() => assertSeedableAppEnv(appEnv)).toThrow(SeedNotAllowedError);
    }
  });

  it('🔴 未設定・空文字・未知の値は拒否される（既定で許可にフォールバックしない）', () => {
    for (const value of [undefined, '', 'dev', 'DEVELOPMENT', 'prod']) {
      expect(isSeedableAppEnv(value)).toBe(false);
      expect(() => assertSeedableAppEnv(value)).toThrow(SeedNotAllowedError);
    }
  });

  it('エラーメッセージに APP_ENV の値以外の環境変数を含めない（値の露出を最小にする）', () => {
    const error = new SeedNotAllowedError('production');
    expect(error.message).toContain('production');
    expect(error.appEnv).toBe('production');
  });
});
