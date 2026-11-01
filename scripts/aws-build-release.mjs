#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { mkdtempSync, unlinkSync, rmdirSync, appendFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { assertAccount, aws, withJsonFile, ACCOUNT_ID, REGION } from './aws/common.mjs';
const root = process.env.DEPLOY_SOURCE_DIRECTORY ? resolve(process.env.DEPLOY_SOURCE_DIRECTORY) : resolve(import.meta.dirname, '..');
let directory;
try {
  const [commit, ...rest] = process.argv.slice(2);
  if (rest.length || !/^[a-f0-9]{40}$/.test(commit ?? '')) throw new Error('完全なコミットSHAを指定してください');
  assertAccount();
  directory = mkdtempSync(join(tmpdir(), 'ses-release-build-'));
  const archive = join(directory, 'source.zip');
  const git = spawnSync('git', ['archive', '--format=zip', '--output', archive, commit], { cwd: root, encoding: 'utf8', windowsHide: true });
  if (git.status !== 0) throw new Error('コミットの取得に失敗しました');
  const bucket = `ses-platform-demo-files-${ACCOUNT_ID}-${REGION}`;
  const location = `${bucket}/bootstrap/build/${commit}.zip`;
  aws(['s3', 'cp', archive, `s3://${location}`, '--sse', 'aws:kms', '--sse-kms-key-id', 'alias/ses-platform-demo-storage', '--only-show-errors'], { json: false });
  const build = withJsonFile({ projectName: 'ses-platform-demo', sourceLocationOverride: location,
    environmentVariablesOverride: [{ name: 'IMAGE_TAG', value: commit, type: 'PLAINTEXT' }] },
  (file) => aws(['codebuild', 'start-build', '--cli-input-json', `file://${file.replaceAll('\\', '/')}`])).build;
  console.log(`AWSでイメージをビルド中: ${build.id}`);
  const deadline = Date.now() + 50 * 60_000;
  let complete = false;
  while (Date.now() < deadline) {
    await new Promise(done => setTimeout(done, 10_000));
    const state = aws(['codebuild', 'batch-get-builds', '--ids', build.id]).builds[0];
    if (state.buildStatus === 'SUCCEEDED') { complete = true; break; }
    if (['FAILED', 'FAULT', 'STOPPED', 'TIMED_OUT'].includes(state.buildStatus)) throw new Error(`CodeBuildに失敗しました: ${build.id}`);
  }
  if (!complete) throw new Error(`CodeBuildの状態を確認してください: ${build.id}`);
  const digest = aws(['ecr', 'describe-images', '--repository-name', 'ses-platform-demo', '--image-ids', `imageTag=${commit}`]).imageDetails[0].imageDigest;
  if (!/^sha256:[a-f0-9]{64}$/.test(digest)) throw new Error('固定digestを確認できません');
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `digest=${digest}\nbuild_id=${build.id}\n`);
  console.log(`ビルド完了: ${commit} / ${digest}`);
} catch (error) { console.error(error.message); process.exitCode = 1; }
finally { if (directory) { try { unlinkSync(join(directory, 'source.zip')); } catch { /* archive前の失敗 */ } rmdirSync(directory); } }
