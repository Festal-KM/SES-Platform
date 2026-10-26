#!/usr/bin/env node
// 作成済みロールをIAMポリシーシミュレーターで検査。ファイル・秘密値は読み出さない。
import { spawnSync } from 'node:child_process';
import { ACCOUNT_ID, REGION, ENVIRONMENTS } from '../infra/aws/foundation.mjs';

function aws(args) {
  const result = spawnSync('aws', [...args, '--region', REGION, '--output', 'json', '--no-cli-pager'], { encoding: 'utf8', windowsHide: true });
  if (result.error || result.status !== 0) throw new Error(result.stderr || 'AWS CLI の実行に失敗しました');
  return JSON.parse(result.stdout);
}
try {
  if (process.argv.length !== 2) throw new Error('引数は不要です');
  if (aws(['sts', 'get-caller-identity']).Account !== ACCOUNT_ID) throw new Error('承認済みAWSアカウントと異なります');
  let count = 0;
  for (const environment of Object.keys(ENVIRONMENTS)) {
    const prefix = `ses-platform-${environment}`;
    const other = environment === 'production' ? 'demo' : 'production';
    const otherPrefix = `ses-platform-${other}`;
    const bucket = (name) => `arn:aws:s3:::${name}-files-${ACCOUNT_ID}-${REGION}/isolation-probe`;
    const secret = (name) => `arn:aws:secretsmanager:${REGION}:${ACCOUNT_ID}:secret:/${name}/runtime-abcdef`;
    const cases = [
      ['task', 's3:PutObject', bucket(prefix), 'allowed'],
      ['task', 's3:GetObject', bucket(otherPrefix), 'explicitDeny'],
      ['task', 'kms:Decrypt', `arn:aws:kms:${REGION}:${ACCOUNT_ID}:key/00000000-0000-0000-0000-000000000000`, 'explicitDeny'],
      ['task', 'secretsmanager:GetSecretValue', secret(prefix), 'explicitDeny'],
      ['task', 'sts:AssumeRole', `arn:aws:iam::${ACCOUNT_ID}:role/${otherPrefix}-task`, 'explicitDeny'],
      ['execution', 'secretsmanager:GetSecretValue', secret(prefix), 'allowed'],
      ['execution', 'secretsmanager:GetSecretValue', secret(otherPrefix), 'explicitDeny'],
      ...(environment === 'production' ? [] : [['task', 'ses:SendEmail', `arn:aws:ses:${REGION}:${ACCOUNT_ID}:identity/example.invalid`, 'explicitDeny']]),
    ];
    for (const [role, action, resource, expected] of cases) {
      const response = aws(['iam', 'simulate-principal-policy', '--policy-source-arn', `arn:aws:iam::${ACCOUNT_ID}:role/${prefix}-${role}`,
        '--action-names', action, '--resource-arns', resource]);
      const evaluations = response.EvaluationResults;
      if (evaluations.length !== 1 || evaluations[0].EvalDecision !== expected) {
        throw new Error(`${environment}/${role}: ${action} が期待する ${expected} ではありません`);
      }
      console.log(`OK ${environment}/${role}: ${action} = ${expected}`);
      count++;
    }
  }
  console.log(`${count} 件のIAM検査が通過しました（実データ・秘密値へのアクセスなし）`);
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
