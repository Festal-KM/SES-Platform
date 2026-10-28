#!/usr/bin/env node
// 大きなPrisma型と全描画テストを一度に比較するとTS2859の比較数上限に達する。
// 対象を減らさず、独立したTypeScript実行へ分ける。どの組の失敗もCIを失敗させる。
import { readdirSync, writeFileSync, unlinkSync } from 'node:fs';
import { resolve, join, relative } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
const root = resolve(import.meta.dirname, '..');
const web = join(root, 'apps/web');
const files = [];
function walk(directory) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (['node_modules', '.next', 'dist'].includes(entry.name)) continue;
    const path = join(directory, entry.name);
    if (entry.isDirectory()) walk(path);
    else if (/\.test\.tsx?$/.test(entry.name)) files.push(relative(web, path).replaceAll('\\', '/'));
  }
}
walk(web);
files.sort();
if (!files.length) throw new Error('Webテストを検出できません。検査を中止します');
const tsc = createRequire(import.meta.url).resolve('typescript/bin/tsc');
const configuration = join(web, `.typecheck-web-tests-${randomUUID()}.json`);
try {
  for (let offset = 0; offset < files.length; offset += 60) {
    const group = files.slice(offset, offset + 60);
    writeFileSync(configuration, JSON.stringify({ extends: './tsconfig.json', compilerOptions: { incremental: false },
      include: ['next-env.d.ts', 'lib/auth/next-auth.d.ts', ...group], exclude: ['node_modules', '.next'] }));
    console.log(`Webテストの型検査: ${offset + 1}〜${offset + group.length} / ${files.length}`);
    const result = spawnSync(process.execPath, [tsc, '--noEmit', '-p', configuration], { cwd: root, stdio: 'inherit', windowsHide: true });
    if (result.error || result.status !== 0) { process.exitCode = result.status || 1; break; }
  }
} finally { unlinkSync(configuration); }
