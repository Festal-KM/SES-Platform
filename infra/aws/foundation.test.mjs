import test from 'node:test';
import assert from 'node:assert/strict';
import { ENVIRONMENTS, foundationTemplate } from './foundation.mjs';

test('未知の環境・プロトタイプのキーを処理しない', () => {
  for (const name of ['staging', 'prod', '__proto__', 'constructor', undefined]) {
    assert.throws(() => foundationTemplate(name), /未知の環境/);
  }
});

test('3環境はネットワーク・保存先・実行ロールを共有しない', () => {
  const templates = Object.keys(ENVIRONMENTS).map(foundationTemplate);
  for (const select of [
    (t) => t.Resources.Vpc.Properties.CidrBlock,
    (t) => JSON.stringify(t.Resources.Files.Properties.BucketName),
    (t) => t.Resources.TaskRole.Properties.RoleName,
    (t) => t.Resources.ExecutionRole.Properties.RoleName,
  ]) assert.equal(new Set(templates.map(select)).size, 3);
  for (const t of templates) {
    assert.equal(Object.values(t.Resources).some((r) => /Peering|TransitGateway|NATGateway/.test(r.Type)), false);
    const privateSubnets = Object.entries(t.Resources).filter(([name, r]) => r.Type === 'AWS::EC2::Subnet' && name.startsWith('Private'));
    assert.equal(privateSubnets.length, 2);
    for (const [, r] of privateSubnets) assert.equal(r.Properties.MapPublicIpOnLaunch, false);
  }
});

test('停止・スタック削除・置換でファイルと鍵を失わず、公開も許さない', () => {
  for (const environment of Object.keys(ENVIRONMENTS)) {
    const { Resources: r } = foundationTemplate(environment);
    for (const name of ['Files', 'StorageKey', 'Images']) {
      assert.equal(r[name].DeletionPolicy, 'Retain');
      assert.equal(r[name].UpdateReplacePolicy, 'Retain');
    }
    assert.deepEqual(Object.values(r.Files.Properties.PublicAccessBlockConfiguration), [true, true, true, true]);
    assert.equal(r.Files.Properties.VersioningConfiguration.Status, 'Enabled');
    assert.equal(r.Files.Properties.BucketEncryption.ServerSideEncryptionConfiguration[0].ServerSideEncryptionByDefault.SSEAlgorithm, 'aws:kms');
    assert.equal(r.FilesPolicy.Properties.PolicyDocument.Statement[0].Condition.Bool['aws:SecureTransport'], 'false');
  }
});

test('非本番の実送信・他環境の保存先・秘密値へのアクセスを明示的に拒否する', () => {
  for (const environment of Object.keys(ENVIRONMENTS)) {
    const r = foundationTemplate(environment).Resources;
    const statements = r.TaskRole.Properties.Policies.flatMap((p) => p.PolicyDocument.Statement);
    assert.ok(statements.some((s) => s.Effect === 'Deny' && s.Action === 's3:*' && s.NotResource));
    assert.ok(statements.some((s) => s.Effect === 'Deny' && s.Action === 'kms:*' && s.NotResource));
    assert.ok(statements.some((s) => s.Effect === 'Deny' && s.Action.includes('sts:AssumeRole') && s.Action.includes('secretsmanager:*')));
    assert.equal(statements.some((s) => s.Effect === 'Deny' && s.Action.includes('ses:*') && s.Action.includes('sns:Publish')), environment !== 'production');
    const secrets = r.ExecutionRole.Properties.Policies[0].PolicyDocument.Statement.find((s) => s.Effect === 'Allow' && s.Action === 'secretsmanager:GetSecretValue');
    assert.ok(JSON.stringify(secrets.Resource).includes(`/ses-platform-${environment}/*`));
  }
});

test('基盤作成では課金の大きいアプリ・DB・ロードバランサーを起動しない', () => {
  for (const environment of Object.keys(ENVIRONMENTS)) {
    for (const resource of Object.values(foundationTemplate(environment).Resources)) {
      assert.equal(/AWS::(RDS|ElastiCache|ElasticLoadBalancingV2)::|AWS::EC2::Instance|AWS::ECS::Service/.test(resource.Type), false);
    }
  }
});

test('非公開側も環境内S3へ接続でき、ECRのAWS所有レイヤーだけは読み取り可能', () => {
  const r = foundationTemplate('demo').Resources;
  assert.deepEqual(r.PrivateSubnetARoutes.Properties.RouteTableId, { Ref: 'PrivateRoutes' });
  assert.deepEqual(r.S3Endpoint.Properties.RouteTableIds, [{ Ref: 'PrivateRoutes' }]);
  const ecr = r.S3Endpoint.Properties.PolicyDocument.Statement[1];
  assert.equal(ecr.Action, 's3:GetObject');
  assert.ok(JSON.stringify(ecr.Resource).includes('starport-layer-bucket/*'));
  assert.equal(r.InternetRoute.Properties.RouteTableId.Ref, 'PublicRoutes');
});
