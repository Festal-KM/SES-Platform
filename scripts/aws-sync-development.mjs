#!/usr/bin/env node
// ローカルはソースを梱包・転送するだけ。依存インストール、ビルド、アプリ実行はAWSで行う。
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, copyFileSync, mkdirSync, lstatSync, rmSync } from 'node:fs';
import { resolve, dirname, basename, join, extname, sep } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID, createHash } from 'node:crypto';
import { assertAccount, aws, stackOutputs, withJsonFile } from './aws/common.mjs';
import { isExcludedSource } from './aws/source-files.mjs';

const root = resolve(import.meta.dirname, '..');
let temporary;
function run(command, args) {
  const result = spawnSync(command, args, { cwd: root, encoding: 'utf8', windowsHide: true });
  if (result.error || result.status !== 0) throw new Error(`${command}の実行に失敗しました`);
  return result.stdout;
}
try {
  const args = process.argv.slice(2);
  if (args.some((arg) => arg !== '--initialize')) throw new Error('使い方: node scripts/aws-sync-development.mjs [--initialize]');
  assertAccount();
  run(process.execPath, ['scripts/aws-development.mjs', 'start']);
  const foundation = stackOutputs('ses-platform-development-foundation');
  const workspace = stackOutputs('ses-platform-development-workspace');
  const files = [...new Set(run('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard']).split('\0').filter(Boolean))];
  const rootFiles = new Set(['docker-compose.yml', 'package.json', 'pnpm-lock.yaml', 'pnpm-workspace.yaml', 'tsconfig.json', 'tsconfig.tests.json', 'tsconfig.e2e.json', '.env.example', '.dockerignore', '.gitignore', 'Dockerfile', 'Dockerfile.aws', 'eslint.config.mjs', 'playwright.config.ts', 'vitest.config.ts', 'vitest.isolation.config.ts', 'vitest.smoke.config.ts', 'vitest.perf.config.ts']);
  temporary = mkdtempSync(join(tmpdir(), 'ses-dev-sync-'));
  const staging = join(temporary, 'source'); mkdirSync(staging);
  const manifest = {};
  for (const file of files) {
    if (!(/^(apps|packages|scripts|docker|prompts|seed|tests|infra\/aws)\//.test(file) || rootFiles.has(file))) continue;
    if (isExcludedSource(file)) continue;
    const source = resolve(root, file);
    let stat; try { stat = lstatSync(source); } catch { continue; }
    if (!stat.isFile() || stat.isSymbolicLink()) continue;
    const target = resolve(staging, file);
    if (!target.startsWith(`${staging}${sep}`)) throw new Error('転送先が作業用ディレクトリ外です');
    mkdirSync(dirname(target), { recursive: true });
    if (['.sh', '.mjs', '.ts', '.tsx', '.json', '.yml', '.yaml', '.sql', '.md'].includes(extname(file))) {
      writeFileSync(target, readFileSync(source, 'utf8').replaceAll('\r\n', '\n'));
    } else copyFileSync(source, target);
    manifest[file] = createHash('sha256').update(readFileSync(target)).digest('hex');
  }
  writeFileSync(join(staging, '.aws-source-manifest.json'), JSON.stringify(manifest));
  const archive = join(temporary, 'source.tar.gz');
  run('tar', ['-czf', archive, '-C', staging, '.']);
  const id = randomUUID();
  const uri = `s3://${foundation.FilesBucket}/bootstrap/development/${id}.tar.gz`;
  aws(['s3', 'cp', archive, uri, '--sse', 'aws:kms', '--sse-kms-key-id', foundation.StorageKeyArn, '--only-show-errors'], { json: false });
  const commands = [
    'set -e', 'mkdir -p /workspaces/ses-platform', 'cd /workspaces/ses-platform',
    'if [ -f .aws-source-manifest.json ]; then cp .aws-source-manifest.json .aws-source-manifest.previous.json; fi',
    `aws s3 cp '${uri}' '/tmp/ses-source-${id}.tar.gz' --region ap-northeast-1 --only-show-errors`,
    `tar -xzf '/tmp/ses-source-${id}.tar.gz' -C /workspaces/ses-platform --no-same-owner`,
    `bash scripts/aws-bootstrap-development.sh ${args.includes('--initialize') ? '--initialize' : ''}`,
  ];
  const response = withJsonFile({ DocumentName: 'AWS-RunShellScript', InstanceIds: [workspace.InstanceId], Parameters: { commands, executionTimeout: ['3600'] }, TimeoutSeconds: 600 },
    (file) => aws(['ssm', 'send-command', '--cli-input-json', `file://${file.replaceAll('\\', '/')}`]));
  console.log(JSON.stringify({ commandId: response.Command.CommandId, instanceId: workspace.InstanceId, sourceFiles: Object.keys(manifest).length,
    check: `aws ssm get-command-invocation --region ap-northeast-1 --command-id ${response.Command.CommandId} --instance-id ${workspace.InstanceId}` }, null, 2));
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
} finally {
  if (temporary) {
    const target = resolve(temporary);
    if (dirname(target) !== resolve(tmpdir()) || !basename(target).startsWith('ses-dev-sync-')) {
      console.error('一時ディレクトリの削除先を確認できないため、削除を中止しました');
      process.exitCode = 1;
    } else {
      try { rmSync(target, { recursive: true, force: true }); }
      catch { console.error('ソース梱包用の一時ディレクトリを削除できませんでした'); process.exitCode = 1; }
    }
  }
}
