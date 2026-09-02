// tests/static/config-env-example.test.ts
// code-reviewer 指摘 4（T-01-03 再修正）: `.env.example` を `cp .env.example .env` しただけでは
// `packages/config` の起動時検証に落ちる状態を放置しない。リポジトリ直下の `.env.example` を
// 実際にパースし、`APP_ENV=development` で `loadAppEnv` が通ることを固定する。
//
// 🔴 `packages/config` は `node:fs` 等の Node 型解決を持たない（`tsconfig.json` の `types: []` の下、
// `@types/node` を自パッケージの依存として持たないため）。ファイル読み込みを伴う本テストは、
// `@types/node` を解決できる root の `tsconfig.tests.json` 配下（`tests/static/**`。
// `no-restricted-imports.test.ts` / `package-zone-coverage.test.ts` と同じパターン）に置く。
// `@ses/config` はどの workspace package からも依存されておらず pnpm がリンクしないため、
// 新規依存を追加せず相対パスで `packages/config/src` を直接 import する（🔴 新規依存追加禁止の制約）。
//
// 🔴 `dotenv` 等の新規依存は追加しない（本タスクの制約）。`.env.example` は
// `KEY=VALUE` 形式のみを使う単純なファイルのため、最小限の手書きパーサで十分。

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { loadAppEnv } from '../../packages/config/src/load-env.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..', '..');

/** `KEY=VALUE` 形式の最小限のパーサ。コメント行（`#`）と空行を無視する。 */
function parseDotEnv(content: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line.length === 0 || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    const value = line.slice(eq + 1).trim();
    result[key] = value;
  }
  return result;
}

describe('.env.example を cp しただけで development の起動時検証が通る', () => {
  it('.env.example をパースして loadAppEnv(APP_ENV=development) が例外を投げない', () => {
    const content = readFileSync(path.join(repoRoot, '.env.example'), 'utf8');
    const parsed = parseDotEnv(content);
    expect(parsed.APP_ENV).toBe('development');
    // 🔴 ここで落ちる場合、`.env.example` のプレースホルダ（空文字の任意項目など）が
    // 起動時検証を壊している。emptyStringsToUndefined（packages/config/src/load-env.ts）が
    // 効いているかを疑う。
    expect(() => loadAppEnv(parsed)).not.toThrow();
  });

  it('ANTHROPIC_API_KEY は空文字のままプレースホルダとして残っている（development では任意項目）', () => {
    const content = readFileSync(path.join(repoRoot, '.env.example'), 'utf8');
    const parsed = parseDotEnv(content);
    expect(parsed.ANTHROPIC_API_KEY).toBe('');
  });
});
