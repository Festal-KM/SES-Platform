// packages/config/src/seed-guard.ts
// 🔴 合成データの投入とリセットを実行してよい環境の唯一の判定元（F-053 AC-6 / BR-63 / BR-37 /
//    CLAUDE.md §10.5 / §11.1 / docs/05 §13.6 / docs/03 §4.19）。
//
// 🔴 「packages/config の検証と API のミドルウェアの二重で拒否する」（docs/05 §13.6）。
//    その 1 枚目がここである。CLI（packages/db/seed）と管理平面 API（SP-10 の API-A16）は
//    **同じこの関数**を呼ぶ。判定を 2 か所に書かない（片方だけ緩む経路を作らない）。
//
// 🔴 リセットは対象テナントの全業務データの削除にあたるため、環境ガードは「実装上の注意」では
//    なく**実行前の判定**として持つ（F-053 AC-6）。

import { APP_ENV_KINDS, type AppEnvKind } from './app-env.js';

/**
 * 合成データの投入・リセットを許可する環境。
 * 🔴 `production` / `sandbox` / `staging` は含めない。
 *    - `production`: 顧客の実データ
 *    - `sandbox`: 見込み客が**自分の実データ**を入れる場（合成データを投入しない。F-053 AC-4）
 *    - `staging`: リリース前検証。実在の宛先を持ちうる
 */
export const SEEDABLE_APP_ENVS = ['development', 'demo'] as const satisfies readonly AppEnvKind[];

export type SeedableAppEnv = (typeof SEEDABLE_APP_ENVS)[number];

/** 合成データの投入・リセットが許されない環境で実行されようとしたことを示す。 */
export class SeedNotAllowedError extends Error {
  constructor(readonly appEnv: string | undefined) {
    super(
      `合成データの投入・リセットは APP_ENV が ${SEEDABLE_APP_ENVS.join(' / ')} のときだけ実行できます` +
        `（受け取った APP_ENV: ${appEnv === undefined || appEnv === '' ? '(未設定)' : appEnv}）。` +
        'F-053 AC-6 / CLAUDE.md §11.1。',
    );
    this.name = 'SeedNotAllowedError';
  }
}

export function isSeedableAppEnv(value: string | undefined): value is SeedableAppEnv {
  return (SEEDABLE_APP_ENVS as readonly string[]).includes(value ?? '');
}

/**
 * 🔴 fail-closed。未設定・未知の値・許可外の環境はすべて拒否する
 *    （「未設定なら development とみなす」等のフォールバックを作らない。CLAUDE.md §11.1）。
 */
export function assertSeedableAppEnv(value: string | undefined): asserts value is SeedableAppEnv {
  if (!(APP_ENV_KINDS as readonly string[]).includes(value ?? '') || !isSeedableAppEnv(value)) {
    throw new SeedNotAllowedError(value);
  }
}
