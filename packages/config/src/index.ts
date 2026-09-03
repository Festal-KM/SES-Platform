// packages/config/src/index.ts — @ses/config の公開 API（ルート）。
//
// 🔴 テスト用フィクスチャ（`buildValidEnv` 等。ダミー秘密鍵入りの「妥当な production env」を
// 組み立てられる）はここから export しない。実行時コードが誤って import できてしまうと、
// 本番相当の値をアプリコードが組み立てられる経路になる。`@ses/config/testing` サブパス
// （package.json の `exports` で隔離。`./testing/fixtures.js` を指す）からのみ取得する。

export { APP_ENV_KINDS, type AppEnvKind } from './app-env.js';
export { envSchema, type AppEnv } from './schema.js';
// 🔴 合成データの投入・リセットの環境ガード（F-053 AC-6）。CLI（packages/db/seed）と
//    管理平面 API（SP-10 の API-A16）が同じ判定を使うため、ここから export する。
export {
  SEEDABLE_APP_ENVS,
  SeedNotAllowedError,
  assertSeedableAppEnv,
  isSeedableAppEnv,
  type SeedableAppEnv,
} from './seed-guard.js';
export { loadAppEnv, type EnvSource } from './load-env.js';
export { EnvValidationError, ProductionMockConnectorError, type EnvValidationIssue } from './errors.js';
export {
  resolveConnectorSelection,
  assertNoMockInProduction,
  type ConnectorCategory,
  type ConnectorImplementationKind,
  type ConnectorSelection,
} from './connector-selection.js';
