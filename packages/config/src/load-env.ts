// packages/config/src/load-env.ts
// 🔴 起動時に 1 回だけ呼ぶ、環境変数検証の唯一の入口（docs/05 §13.1 / NFR-ENV-2）。
// apps/web の instrumentation.ts / apps/worker の起動処理からはこの関数だけを呼ぶ。
// リクエストごとに呼ばない（呼ぶたびに process.env を読み直す構造にしない）。
//
// 🔴 `source` は必須引数にし、`packages/config` 自身は `process` に依存しない
// （`node:process` の型解決には `@types/node` の型読み込みが必要で、ルート tsconfig.json の
// `types: []` の下では `packages/config` 単体の `tsc` に含まれない。呼び出し側の `apps/*` で
// `loadAppEnv(process.env)` のように明示的に渡す）。

import { EnvValidationError, type EnvValidationIssue } from './errors.js';
import { envSchema, type AppEnv } from './schema.js';

export type EnvSource = Readonly<Record<string, string | undefined>>;

/**
 * 🔴 `.env` ファイル / CI / docker-compose は「未設定」を空文字（`KEY=`）として渡すことがある
 * （dotenv や `docker-compose.yml` の `environment:` の慣習）。空文字のまま任意項目のスキーマ
 * （`z.string().startsWith(...).optional()` 等）に渡すと「未設定」ではなく「不正な形式」として
 * 検証に落ちる。ここで空文字を一括して `undefined` に正規化し、`.optional()` / `.default()` が
 * 意図どおり働くようにする（値そのものは変えないため、必須項目が空文字なら引き続き
 * 「未設定」として検証に失敗する — これは意図した挙動）。
 */
function emptyStringsToUndefined(source: EnvSource): EnvSource {
  const normalized: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries(source)) {
    normalized[key] = value === '' ? undefined : value;
  }
  return normalized;
}

/**
 * `source`（呼び出し側の `process.env` 等）を検証し、妥当な `AppEnv` を返す。
 * 1 件でも不正な変数があれば `EnvValidationError` を投げてプロセスの起動を止める
 * （NFR-ENV-3 / NFR-ENV-4。「未設定ならモックにフォールバック」という経路を作らない）。
 */
export function loadAppEnv(source: EnvSource): AppEnv {
  const result = envSchema.safeParse(emptyStringsToUndefined(source));
  if (!result.success) {
    const issues: EnvValidationIssue[] = result.error.issues.map((issue) => ({
      variable: issue.path.length > 0 ? issue.path.join('.') : '(root)',
      message: issue.message,
    }));
    throw new EnvValidationError(issues);
  }
  return result.data;
}
