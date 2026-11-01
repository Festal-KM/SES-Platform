import { test } from 'node:test';
import assert from 'node:assert/strict';
import { releaseDeliveryTemplate } from './release-delivery.mjs';
import { foundationTemplate } from './foundation.mjs';
import { taskDefinition } from './tasks.mjs';
import { releaseImage, releaseRecord, releaseServicesReady } from '../../scripts/aws/release.mjs';
const digest = `sha256:${'a'.repeat(64)}`;
const descriptor = { environment: 'demo', image: releaseImage('demo', digest), runtimeSecretArn: 'arn:aws:secretsmanager:ap-northeast-1:117425831827:secret:/ses-platform-demo/runtime-abc', runtimeKeys: ['APP_ENV', 'DATABASE_URL'] };
test('アプリの実行ロールから配備証跡とビルド元へアクセスできない', () => {
  for (const environment of ['demo', 'production']) {
    const statements = foundationTemplate(environment).Resources.TaskRole.Properties.Policies[0].PolicyDocument.Statement;
    const deny = statements.find(item => item.Effect === 'Deny' && item.Action === 's3:*' && item.Resource);
    assert.deepEqual(deny.Resource, [{ 'Fn::Sub': '${Files.Arn}/releases/*' }, { 'Fn::Sub': '${Files.Arn}/bootstrap/*' }]);
  }
});
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
  const web = taskDefinition({ ...descriptor, runtimeKeys: [...descriptor.runtimeKeys, 'NODE_ENV'], role: 'web' });
  assert.ok(!web.containerDefinitions[0].secrets.some(item => item.name === 'NODE_ENV'));
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
test('workerを含めてECSの配備完了を確認し、旧版や起動途中を成功にしない', () => {
  const definitions = { web: 'web:2', worker: 'worker:2' };
  const services = ['web', 'worker'].map(role => ({ serviceName: `ses-platform-demo-${role}`, taskDefinition: definitions[role],
    deployments: [{ rolloutState: 'COMPLETED' }], runningCount: 1, desiredCount: 1, pendingCount: 0 }));
  assert.equal(releaseServicesReady(services, definitions), true);
  for (const invalid of [
    { deployments: [{ rolloutState: 'IN_PROGRESS' }] }, { taskDefinition: 'worker:1' }, { runningCount: 0 }, { pendingCount: 1 },
  ]) assert.equal(releaseServicesReady([services[0], { ...services[1], ...invalid }], definitions), false);
});
