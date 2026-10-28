#!/usr/bin/env node
// Actionsのクリーンなcheckoutだけを転送。PCとActionsではアプリをビルドしない。
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, copyFileSync, lstatSync, rmSync, appendFileSync } from 'node:fs';
import { resolve, join, dirname, basename } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { DEVELOPMENT_BUCKET, DEVELOPMENT_INSTANCE, DEVELOPMENT_DOCUMENT } from '../infra/aws/cicd.mjs';
import { includeCiSource } from './aws/ci-source.mjs';
import { assertAccount, aws, withJsonFile } from './aws/common.mjs';
const root = resolve(import.meta.dirname, '..');
const run = (cmd, args) => {
  const result = spawnSync(cmd, args, { cwd: root, encoding: 'utf8', windowsHide: true });
  if (result.status !== 0) throw new Error(`${cmd}に失敗しました`);
  return result.stdout;
};
const report = (message) => {
  console.log(message);
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${message}\n`);
};
let temporary;
try {
  const [commit, ...rest] = process.argv.slice(2);
  if (rest.length || !/^[a-f0-9]{40}$/.test(commit ?? '')) throw new Error('完全なコミットSHAを指定してください');
  if (run('git', ['rev-parse', 'HEAD']).trim() !== commit || run('git', ['status', '--porcelain']).trim()) throw new Error('指定コミットの変更のないcheckoutだけを配備できます');
  if (spawnSync('git', ['merge-base', '--is-ancestor', commit, 'origin/main'], { cwd: root, windowsHide: true }).status !== 0) throw new Error('mainに統合されていないコミットは配備できません');
  assertAccount();
  const instance = aws(['ec2', 'describe-instances', '--instance-ids', DEVELOPMENT_INSTANCE]).Reservations[0].Instances[0];
  if (instance.State.Name !== 'running') {
    report(`開発環境は${instance.State.Name}のため反映を省略しました。起動後、手動で同じワークフローを再実行してください。コミット: ${commit}`);
  } else {
    temporary = mkdtempSync(join(tmpdir(), 'ses-ci-source-'));
    const staging = join(temporary, 'source'); mkdirSync(staging);
    const manifest = {};
    for (const file of run('git', ['ls-files', '-z']).split('\0').filter(includeCiSource)) {
      const source = resolve(root, file);
      const stat = lstatSync(source);
      if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('通常のファイル以外は転送できません');
      const target = join(staging, file); mkdirSync(dirname(target), { recursive: true });
      copyFileSync(source, target);
      manifest[file] = createHash('sha256').update(readFileSync(target)).digest('hex');
    }
    writeFileSync(join(staging, '.aws-source-manifest.json'), JSON.stringify(manifest));
    const archive = join(temporary, 'source.tar.gz'); run('tar', ['-czf', archive, '-C', staging, '.']);
    const digest = createHash('sha256').update(readFileSync(archive)).digest('hex');
    aws(['s3', 'cp', archive, `s3://${DEVELOPMENT_BUCKET}/bootstrap/ci/${commit}/${digest}.tar.gz`, '--sse', 'aws:kms', '--sse-kms-key-id', 'alias/ses-platform-development-storage', '--only-show-errors'], { json: false });
    const command = withJsonFile({ DocumentName: DEVELOPMENT_DOCUMENT, InstanceIds: [DEVELOPMENT_INSTANCE], Parameters: { Commit: [commit], ArchiveDigest: [digest] }, TimeoutSeconds: 600 },
      (file) => aws(['ssm', 'send-command', '--cli-input-json', `file://${file.replaceAll('\\', '/')}`])).Command.CommandId;
    report(`開発環境へ反映中。コミット: ${commit} / SSM: ${command}`);
    const deadline = Date.now() + 65 * 60_000;
    let successful = false;
    while (Date.now() < deadline) {
      await new Promise((done) => setTimeout(done, 10_000));
      let result;
      try { result = aws(['ssm', 'get-command-invocation', '--command-id', command, '--instance-id', DEVELOPMENT_INSTANCE]); }
      catch (error) { if (error.code === 'InvocationDoesNotExist') continue; throw error; }
      if (result.Status === 'Success') { successful = true; break; }
      if (['Failed', 'Cancelled', 'TimedOut', 'Cancelling'].includes(result.Status)) throw new Error(`AWSでの配備に失敗しました。SSMコマンド ${command} のログを管理者が確認してください（秘密値を公開しない）`);
    }
    if (!successful) throw new Error('配備結果の待機期限を超過しました。再送する前にSSMの実行状態を確認してください');
    const response = await fetch('https://dev-es.bizorch.com/signin', { signal: AbortSignal.timeout(30_000), redirect: 'manual' });
    if (response.status !== 200) throw new Error('公開HTTPSのログイン画面が正常応答しません');
    report(`反映完了: ${commit} / https://dev-es.bizorch.com/signin （HTTP 200）`);
  }
} catch (error) { console.error(error.message); process.exitCode = 1; }
finally {
  if (temporary && dirname(temporary) === resolve(tmpdir()) && basename(temporary).startsWith('ses-ci-source-')) rmSync(temporary, { recursive: true, force: true });
}
