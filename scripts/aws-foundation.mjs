#!/usr/bin/env node
// AWS CLI を使い、接続先を照合してから環境ごとの基盤だけを扱う。秘密値は扱わない。
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ACCOUNT_ID, REGION, ENVIRONMENTS, foundationTemplate } from '../infra/aws/foundation.mjs';

const [action, environment, ...rest] = process.argv.slice(2);
if (!['render', 'validate', 'deploy', 'status'].includes(action) || !Object.hasOwn(ENVIRONMENTS, environment) || rest.length) {
  console.error('使い方: node scripts/aws-foundation.mjs render|validate|deploy|status development|demo|production');
  process.exit(1);
}
function aws(args, json = false) {
  const result = spawnSync('aws', [...args, '--region', REGION, '--no-cli-pager', ...(json ? ['--output', 'json'] : [])], { encoding: 'utf8', windowsHide: true });
  if (result.error || result.status !== 0) {
    // CLI の認証エラーに秘密値を付け足さない。
    process.stderr.write(result.stderr || 'AWS CLI を実行できませんでした\n');
    process.exit(1);
  }
  return json ? JSON.parse(result.stdout) : result.stdout;
}
if (action === 'render') {
  console.log(JSON.stringify(foundationTemplate(environment), null, 2));
  process.exit(0);
}
const identity = aws(['sts', 'get-caller-identity'], true);
if (identity.Account !== ACCOUNT_ID) {
  console.error('承認されたAWSアカウントと一致しないため、処理を中止しました');
  process.exit(1);
}
const stack = `ses-platform-${environment}-foundation`;
if (action === 'status') {
  console.log(JSON.stringify(aws(['cloudformation', 'describe-stacks', '--stack-name', stack, '--query', 'Stacks[0].{Status:StackStatus,Outputs:Outputs}'], true), null, 2));
  process.exit(0);
}
const directory = mkdtempSync(join(tmpdir(), 'ses-aws-foundation-'));
try {
  const template = join(directory, 'template.json');
  writeFileSync(template, JSON.stringify(foundationTemplate(environment)), 'utf8');
  const uri = `file://${template.replaceAll('\\', '/')}`;
  console.log(aws(['cloudformation', 'validate-template', '--template-body', uri]));
  if (action === 'deploy') {
    console.log(aws(['cloudformation', 'deploy', '--template-file', template, '--stack-name', stack,
      '--capabilities', 'CAPABILITY_NAMED_IAM', '--no-fail-on-empty-changeset',
      '--tags', 'Project=ses-platform', `Environment=${environment}`, 'ManagedBy=cloudformation']));
    console.log(aws(['cloudformation', 'update-termination-protection', '--stack-name', stack, '--enable-termination-protection']));
  }
} finally {
  // 自分で作った一時ディレクトリだけを削除する。
  rmSync(directory, { recursive: true, force: true });
}
