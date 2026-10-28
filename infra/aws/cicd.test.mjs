import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { cicdTemplate, DEVELOPMENT_DOCUMENT, DEVELOPMENT_INSTANCE, OIDC_SUBJECT } from './cicd.mjs';
test('配備手順は実行開始時のコミットに固定し、待機中に進んだmainを実行しない', () => {
  for (const workflow of ['aws-deploy-development.yml', 'aws-release.yml']) {
    const source = readFileSync(new URL(`../../.github/workflows/${workflow}`, import.meta.url), 'utf8');
    assert.match(source, /ref:\s*\$\{\{\s*github\.sha\s*\}\}\s*\n\s*path:\s*delivery/);
    assert.match(source, /ref:\s*\$\{\{\s*needs\.verify\.outputs\.commit\s*\}\}\s*\n\s*path:\s*source/);
  }
});
test('一時認証は不変リポジトリIDと開発environmentに限定する', () => {
  const role = cicdTemplate().Resources.DevelopmentRole.Properties;
  const trust = role.AssumeRolePolicyDocument.Statement[0];
  assert.equal(trust.Condition.StringEquals['token.actions.githubusercontent.com:sub'], `${OIDC_SUBJECT}:environment:development`);
  assert.equal(trust.Condition.StringEquals['token.actions.githubusercontent.com:aud'], 'sts.amazonaws.com');
  assert.equal(trust.Condition.StringLike, undefined);
});
test('汎用シェルや他環境へ配備する権限を渡さない', () => {
  const statements = cicdTemplate().Resources.DevelopmentRole.Properties.Policies[0].PolicyDocument.Statement;
  const send = statements.find(item => item.Action === 'ssm:SendCommand');
  assert.deepEqual(send.Resource, [
    `arn:aws:ssm:ap-northeast-1:117425831827:document/${DEVELOPMENT_DOCUMENT}`,
    `arn:aws:ec2:ap-northeast-1:117425831827:instance/${DEVELOPMENT_INSTANCE}`,
  ]);
  const all = JSON.stringify(statements);
  assert.ok(!all.includes('AWS-RunShellScript'));
  assert.ok(!all.includes('ses-platform-production'));
  assert.ok(!all.includes('ec2:StartInstances'));
  assert.ok(statements.some(item => item.Effect === 'Deny' && item.Action.includes('secretsmanager:*')));
});
test('配備はアーカイブのハッシュ照合と排他制御を通し、成功時だけSHAを保存する', () => {
  const document = cicdTemplate().Resources.Document.Properties.Content;
  assert.equal(document.parameters.Commit.allowedPattern, '^[a-f0-9]{40}$');
  assert.equal(document.parameters.Commit.interpolationType, 'ENV_VAR');
  const shell = document.mainSteps[0].inputs.runCommand.join('\n');
  assert.ok(shell.indexOf('sha256sum -c') < shell.indexOf('tar -xzf'));
  assert.ok(shell.indexOf('flock -n') < shell.indexOf('tar -xzf'));
  assert.ok(shell.indexOf('aws-bootstrap-development.sh') < shell.indexOf('.aws-deployed-commit'));
  assert.ok(!shell.includes('wsl') && !shell.includes('--reset'));
});
