// tests/e2e/harness/endpoint.ts
// E2E で起動するアプリの待ち受け先。
//
// 🔴 `playwright.config.ts` の `use.baseURL` は **globalSetup より前**に評価されるため、
//    ポートを動的に決められない（決めると baseURL を渡せない）。固定値にし、衝突する環境では
//    `SES_E2E_PORT` で上書きする。
// 🔴 本ファイルは重い依存を持たない（`playwright.config.ts` と `harness/**` の両方から読む）。
import process from 'node:process';

export const E2E_PORT = Number(process.env.SES_E2E_PORT ?? 3123);

/**
 * 🔴 ホストは `127.0.0.1` に固定する。
 *   ①外部に開かない
 *   ②`localhost` の名前解決が `::1` に倒れる環境での接続失敗を避ける
 *   ③Chromium は `127.0.0.1` を「信頼できるオリジン」として扱うため、`__Host-` / `Secure`
 *     属性つきのセッション Cookie（`apps/web/lib/auth/cookie-names.ts`）が http でも保存される
 */
export const E2E_HOST = '127.0.0.1';

export const E2E_BASE_URL = `http://${E2E_HOST}:${E2E_PORT}`;
