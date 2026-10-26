// tests/static/chat-icon-scope.test.ts
// ✅ 2026-10-26（紺野「チャットは拡張して」）: 🔴 **チャット専用のアイコン（`chat-` で始まる名前）は、チャットの画面の外で使わない。**
//
// `docs/04` §7.5 は「ボタン・見出しにアイコンを付けない」。例外を認めたのは**チャット（S-031）だけ**である
// （`packages/ui/src/icons.ts` の 🔴）。ほかの画面で使い始めると、例外が黙って全画面に広がる。
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { ICON_NAMES } from '../../packages/ui/src/icons.js';
import { collectSourceFiles, repoRoot, toRepoRelative } from './support/ui-classes.js';

const CHAT_DIR = 'apps/web/app/(main)/chat/';
const CHAT_ICONS = ICON_NAMES.filter((name) => name.startsWith('chat-'));

describe('🔴 チャット専用のアイコンの使い場所', () => {
  it('対照: チャット専用のアイコンが写像に在る（検査が空振りしていない）', () => {
    expect(CHAT_ICONS.length).toBeGreaterThan(0);
  });

  it('`chat-` のアイコン名は apps/web/app/(main)/chat/ の外に 1 件も現れない', () => {
    const files = collectSourceFiles(path.join(repoRoot, 'apps', 'web'), ['.tsx', '.ts']).filter((file) => !file.includes('.test.'));
    const offenders: string[] = [];
    for (const file of files) {
      const rel = toRepoRelative(file);
      if (rel.startsWith(CHAT_DIR)) continue;
      const text = readFileSync(file, 'utf8');
      for (const name of CHAT_ICONS) {
        if (text.includes(`'${name}'`) || text.includes(`"${name}"`)) offenders.push(`${rel}: ${name}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});
