// tests/static/chat-browser-fetch.test.ts
// ✅ 2026-10-27（デモで「ファイルを送れませんでした」）: ブラウザの `fetch` をオブジェクトに入れて渡さない。
// `{ fetch }` → `deps.fetch(...)` と呼ぶと `this` が `window` でなくなり、ブラウザでは `Illegal invocation` で
// 要求を送る前に落ちる（Node では落ちないので単体テストでは見つからない）。画面は `browserFetch` を渡す。
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOTS = ['apps/web/app', 'apps/web/lib'];

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return name === 'node_modules' ? [] : walk(path);
    return /\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name) ? [path] : [];
  });
}

describe('🔴 ブラウザの fetch をオブジェクトの短縮記法で渡さない', () => {
  it('`{ fetch }` / `fetch,` だけの受け渡しが 1 か所も無い', () => {
    const offenders = ROOTS.flatMap(walk).filter((file) => /\{\s*fetch\s*\}/.test(readFileSync(file, 'utf8')));
    expect(offenders).toEqual([]);
  });

  it('対照: browserFetch が添付の画面で使われている（検査の空振りではない）', () => {
    const files = ROOTS.flatMap(walk).filter((file) => readFileSync(file, 'utf8').includes('fetch: browserFetch'));
    expect(files.length).toBeGreaterThan(0);
  });
});
