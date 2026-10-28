#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { mkdtempSync, unlinkSync, rmdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { buildTemplate } from '../infra/aws/build.mjs';
import { assertAccount, aws, deployStack, stackOutputs } from './aws/common.mjs';
const root = resolve(import.meta.dirname, '..');
let directory;
function git(args) {
  const r = spawnSync('git', args, { cwd: root, encoding: 'utf8', windowsHide: true });
  if (r.status !== 0) throw new Error('コミット済みのソースを取得できません');
  return r.stdout.trim();
}
try {
  const [environment, action = 'build', revision = 'HEAD', ...rest] = process.argv.slice(2);
  if (!['demo', 'production'].includes(environment) || !['provision', 'build'].includes(action) || rest.length) throw new Error('使い方: node scripts/aws-build.mjs demo|production [provision|build] [commit]');
  assertAccount();
  const prefix = `ses-platform-${environment}`;
  const foundation = stackOutputs(`${prefix}-foundation`);
  if (action === 'provision') {
    deployStack(`${prefix}-build`, buildTemplate(environment), [`Bucket=${foundation.FilesBucket}`, `KeyArn=${foundation.StorageKeyArn}`]);
  } else {
    const commit = git(['rev-parse', `${revision}^{commit}`]);
    if (!/^[a-f0-9]{40}$/.test(commit)) throw new Error('コミット識別子が不正です');
    directory = mkdtempSync(join(tmpdir(), 'ses-aws-build-'));
    const archive = join(directory, 'source.zip');
    const directories = new Set(['apps', 'packages', 'prompts', 'scripts', 'docker', 'seed', 'tests', 'infra']);
    const paths = git(['ls-tree', '--name-only', commit]).split('\n').filter((name) => directories.has(name) || /^Dockerfile|^\.env\.example$|^\.dockerignore$|^\.gitignore$|\.(json|yaml|yml|ts|mjs|js)$/.test(name));
    git(['archive', '--format=zip', '--output', archive, commit, ...paths]);
    const location = `${foundation.FilesBucket}/bootstrap/build/${commit}.zip`;
    aws(['s3', 'cp', archive, `s3://${location}`, '--sse', 'aws:kms', '--sse-kms-key-id', foundation.StorageKeyArn, '--only-show-errors'], { json: false });
    const build = aws(['codebuild', 'start-build', '--project-name', prefix, '--source-location-override', location,
      '--environment-variables-override', `name=IMAGE_TAG,value=${commit},type=PLAINTEXT`]).build;
    console.log(JSON.stringify({ environment, commit, buildId: build.id, check: `aws codebuild batch-get-builds --ids ${build.id}` }, null, 2));
  }
} catch (error) { console.error(error.message); process.exitCode = 1; }
finally {
  if (directory) { try { unlinkSync(join(directory, 'source.zip')); } catch { /* git archive前の失敗 */ } rmdirSync(directory); }
}
