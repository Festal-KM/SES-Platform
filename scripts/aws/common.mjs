import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, unlinkSync, rmdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ACCOUNT_ID, REGION, ENVIRONMENTS } from '../../infra/aws/foundation.mjs';

export { ACCOUNT_ID, REGION };
export const ROOT_DOMAIN = 'bizorch.com';
export const HOSTS = { development: `dev-es.${ROOT_DOMAIN}`, demo: `demo-es.${ROOT_DOMAIN}`, production: `es.${ROOT_DOMAIN}` };
export function assertEnvironment(environment) {
  if (!Object.hasOwn(ENVIRONMENTS, environment)) throw new Error('環境は development / demo / production のいずれかを指定してください');
}
export function aws(args, { json = true, region = REGION, input } = {}) {
  const result = spawnSync('aws', [...args, '--region', region, '--no-cli-pager', ...(json ? ['--output', 'json'] : [])], {
    encoding: 'utf8', windowsHide: true, input,
    env: { ...process.env, AWS_CLI_FILE_ENCODING: 'UTF-8', AWS_CLI_OUTPUT_ENCODING: 'UTF-8' },
  });
  if (result.error || result.status !== 0) {
    const code = /An error occurred \(([^)]+)\)/.exec(result.stderr ?? '')?.[1] ?? `exit=${result.status}`;
    // 秘密値を含み得るCLIの出力・引数・エラーオブジェクトをそのまま表示しない。
    const error = new Error(`AWS ${args.slice(0, 2).join(' ')} に失敗しました（${code}）`);
    error.code = code;
    throw error;
  }
  return json && result.stdout.trim() ? JSON.parse(result.stdout) : result.stdout;
}
export function assertAccount() {
  if (aws(['sts', 'get-caller-identity']).Account !== ACCOUNT_ID) throw new Error('承認されたAWSアカウントと一致しません');
}
export function withJsonFile(value, callback) {
  const directory = mkdtempSync(join(tmpdir(), 'ses-aws-deploy-'));
  const file = join(directory, 'input.json');
  try {
    writeFileSync(file, JSON.stringify(value), { mode: 0o600 });
    return callback(file);
  } finally {
    // 自分で生成した1ファイルと空ディレクトリだけを消す。再帰削除はしない。
    unlinkSync(file);
    rmdirSync(directory);
  }
}
export function stackOutputs(name) {
  const stack = aws(['cloudformation', 'describe-stacks', '--stack-name', name]).Stacks[0];
  if (!['CREATE_COMPLETE', 'UPDATE_COMPLETE'].includes(stack.StackStatus)) throw new Error(`${name} が正常な状態ではありません`);
  return Object.fromEntries((stack.Outputs ?? []).map((output) => [output.OutputKey, output.OutputValue]));
}
export function deployStack(name, template, parameters = []) {
  return withJsonFile(template, (file) => {
    aws(['cloudformation', 'validate-template', '--template-body', `file://${file.replaceAll('\\', '/')}`]);
    const output = aws(['cloudformation', 'deploy', '--stack-name', name, '--template-file', file,
      '--capabilities', 'CAPABILITY_NAMED_IAM', '--no-fail-on-empty-changeset',
      ...(parameters.length ? ['--parameter-overrides', ...parameters] : []),
      '--tags', 'Project=ses-platform', 'ManagedBy=cloudformation'], { json: false });
    console.log(output.trim());
    aws(['cloudformation', 'update-termination-protection', '--stack-name', name, '--enable-termination-protection']);
  });
}

export function ensureSecret(name, createValue) {
  try { return aws(['secretsmanager', 'describe-secret', '--secret-id', name]).ARN; }
  catch (error) {
    if (error.code !== 'ResourceNotFoundException') throw error;
    return withJsonFile({ Name: name, SecretString: JSON.stringify(createValue()), Tags: [{ Key: 'Project', Value: 'ses-platform' }] },
      (file) => aws(['secretsmanager', 'create-secret', '--cli-input-json', `file://${file.replaceAll('\\', '/')}`]).ARN);
  }
}
export function readSecret(name) {
  return JSON.parse(aws(['secretsmanager', 'get-secret-value', '--secret-id', name]).SecretString);
}
export function developmentCommand(commands, timeout = 600) {
  assertAccount();
  const workspace = stackOutputs('ses-platform-development-workspace');
  return withJsonFile({ DocumentName: 'AWS-RunShellScript', InstanceIds: [workspace.InstanceId], Parameters: { commands, executionTimeout: [String(timeout)] }, TimeoutSeconds: 600 },
    (file) => aws(['ssm', 'send-command', '--cli-input-json', `file://${file.replaceAll('\\', '/')}`]).Command.CommandId);
}
