import { test } from 'node:test';
import assert from 'node:assert/strict';
import { releaseDeliveryTemplate } from './release-delivery.mjs';
import { taskDefinition } from './tasks.mjs';
import { releaseImage, releaseRecord } from '../../scripts/aws/release.mjs';
const digest = `sha256:${'a'.repeat(64)}`;
const descriptor = { environment: 'demo', image: releaseImage('demo', digest), runtimeSecretArn: 'arn:aws:secretsmanager:ap-northeast-1:117425831827:secret:/ses-platform-demo/runtime-abc', runtimeKeys: ['APP_ENV', 'DATABASE_URL'] };
test('デモと本番の配備ロールは別environmentを完全一致で照合する', () => {
  for (const [name, environment] of [['DemoRole', 'demo'], ['ProductionRole', 'production']]) {
    const role = releaseDeliveryTemplate().Resources[name].Properties;
    assert.equal(role.AssumeRolePolicyDocument.Statement[0].Condition.StringEquals['token.actions.githubusercontent.com:sub'], `repo:Festal-KM@203054382/SES-Platform@1352164903:environment:${environment}`);
    const statements = role.Policies[0].PolicyDocument.Statement;
    assert.ok(statements.some(item => item.Effect === 'Deny' && item.Action.includes('secretsmanager:GetSecretValue')));
    const pass = statements.find(item => item.Action === 'iam:PassRole');
    assert.ok(pass.Resource.every(arn => arn.includes(`ses-platform-${environment}-`)));
  }
});
test('通常のアプリは管理用パスワードを受け取らず、migrationだけ別実行ロールを使う', () => {
  const web = taskDefinition({ ...descriptor, role: 'web' });
  assert.ok(!JSON.stringify(web).includes('DB_ADMIN_PASSWORD'));
  assert.ok(web.taskRoleArn.endsWith('ses-platform-demo-task'));
  const migration = taskDefinition({ ...descriptor, role: 'migration', rolesSecretArn: descriptor.runtimeSecretArn.replace('runtime-', 'roles-'), masterSecretArn: 'arn:aws:secretsmanager:ap-northeast-1:117425831827:secret:rds!db-fixture' });
  assert.equal(migration.taskRoleArn, undefined);
  assert.ok(migration.executionRoleArn.endsWith('migration-execution'));
  assert.ok(migration.containerDefinitions[0].secrets.some(item => item.name === 'DB_ADMIN_PASSWORD'));
});
test('不正なdigest・他環境のイメージと秘密値・アプリへの管理接続は拒否する', () => {
  assert.throws(() => taskDefinition({ ...descriptor, role: 'web', image: releaseImage('production', digest) }));
  assert.throws(() => taskDefinition({ ...descriptor, role: 'web', image: `${descriptor.image};echo x` }));
  assert.throws(() => taskDefinition({ ...descriptor, role: 'web', runtimeSecretArn: descriptor.runtimeSecretArn.replace('demo/', 'production/') }));
  assert.throws(() => taskDefinition({ ...descriptor, role: 'web', runtimeKeys: ['DB_ADMIN_PASSWORD'] }));
  assert.throws(() => releaseRecord({ commit: 'main', digest, buildId: 'ses-platform-demo:fixture' }));
  assert.equal(releaseRecord({ commit: 'a'.repeat(40), digest, buildId: 'ses-platform-demo:fixture' }).digest, digest);
});
