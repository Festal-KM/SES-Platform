// tests/static/chat-room-share-scope.test.ts
// ✅ 2026-10-27（`CLAUDE.md` §3.3 改訂。#182）: 🔴 ゲートを求めない共有の分類 `CHAT_ROOM` は、チャットの添付だけが使う。
//    `issueDownloadUrl` はスキルシート・契約書・返却データにも使う唯一の発行経路であり、ほかの実体が `CHAT_ROOM` を名乗ると
//    §3.3 のゲート（`EXTERNAL`）を迂回できてしまう。使ってよい場所をファイル単位で固定する。
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { collectSourceFiles, repoRoot, toRepoRelative } from './support/ui-classes.js';

const ALLOWED = new Set([
  // 型の宣言と、ゲートを求めない分岐。
  'apps/web/lib/storage/download.ts',
  // 唯一の利用者（チャットの添付の共有 URL。#51q）。
  'apps/web/lib/chat/attachments.ts',
]);

describe('🔴 共有の分類 CHAT_ROOM（ゲートなし）はチャットの添付だけが使う', () => {
  const files = [
    ...collectSourceFiles(path.join(repoRoot, 'apps'), ['.ts', '.tsx']),
    ...collectSourceFiles(path.join(repoRoot, 'packages'), ['.ts', '.tsx']),
  ].filter((file) => !file.includes('.test.') && !file.includes('/dist/') && !file.includes('node_modules'));

  it('対照: 許可した 2 ファイルには現れる（検査が空振りしていない）', () => {
    for (const rel of ALLOWED) {
      expect(readFileSync(path.join(repoRoot, rel), 'utf8')).toContain("'CHAT_ROOM'");
    }
  });

  it("'CHAT_ROOM' を書いてよいのは許可した 2 ファイルだけ", () => {
    const offenders = files
      .map((file) => toRepoRelative(file))
      .filter((rel) => !ALLOWED.has(rel))
      .filter((rel) => readFileSync(path.join(repoRoot, rel), 'utf8').includes("'CHAT_ROOM'"));
    expect(offenders).toEqual([]);
  });
});
