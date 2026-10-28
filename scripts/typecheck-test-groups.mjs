#!/usr/bin/env node
// Prisma型と全テストの一括比較はTS2859の上限に達する。対象を減らさず実行を分ける。
import { writeFileSync, unlinkSync } from 'node:fs';
import { resolve, join, relative } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
const root = resolve(import.meta.dirname, '..');
const [target, ...rest] = process.argv.slice(2);
if (rest.length || !['root', 'web'].includes(target)) throw new Error('検査対象はrootまたはwebを指定してください');
const require = createRequire(import.meta.url);
const ts = require('typescript');
const directory = target === 'web' ? join(root, 'apps/web') : root;
const base = target === 'web' ? 'tsconfig.json' : 'tsconfig.tests.json';
const parsed = ts.getParsedCommandLineOfConfigFile(join(directory, base), {}, {
  ...ts.sys, onUnRecoverableConfigFileDiagnostic: diagnostic => { throw new Error(ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n')); },
});
if (!parsed || parsed.errors.length) throw new Error('型検査の設定を読み取れません');
let candidates = parsed.fileNames;
if (target === 'web') {
  const config = { extends: './tsconfig.json', include: ['**/*.test.ts', '**/*.test.tsx', 'next-env.d.ts', 'lib/auth/next-auth.d.ts'], exclude: ['node_modules', '.next'] };
  candidates = ts.parseJsonConfigFileContent(config, ts.sys, directory).fileNames;
}
const declarations = candidates.filter(file => file.endsWith('.d.ts'));
const files = candidates.filter(file => !file.endsWith('.d.ts')).sort();
if (!files.length) throw new Error('検査対象を検出できません。型検査を中止します');
const configuration = join(directory, `.typecheck-test-groups-${randomUUID()}.json`);
const tsc = require.resolve('typescript/bin/tsc');
try {
  for (let offset = 0; offset < files.length; offset += 60) {
    const group = files.slice(offset, offset + 60);
    writeFileSync(configuration, JSON.stringify({ extends: `./${base}`, compilerOptions: { incremental: false },
      files: [...declarations, ...group].map(file => relative(directory, file).replaceAll('\\', '/')), include: [], exclude: [] }));
    console.log(`テストの型検査 (${target}): ${offset + 1}〜${offset + group.length} / ${files.length}`);
    const result = spawnSync(process.execPath, [tsc, '--noEmit', '-p', configuration], { cwd: root, stdio: 'inherit', windowsHide: true });
    if (result.error || result.status !== 0) { process.exitCode = result.status || 1; break; }
  }
} finally { unlinkSync(configuration); }
