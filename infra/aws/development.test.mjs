import test from 'node:test';
import assert from 'node:assert/strict';
import { developmentTemplate } from './development.mjs';

test('開発VMはSSH非公開・IMDSv2必須・ディスク保持・削除保護', () => {
  const r = developmentTemplate().Resources;
  assert.deepEqual(r.WorkspaceNetwork.Properties.SecurityGroupIngress, []);
  assert.equal(r.Workspace.Properties.MetadataOptions.HttpTokens, 'required');
  assert.equal(r.Workspace.Properties.DisableApiTermination, true);
  assert.equal(r.Workspace.DeletionPolicy, 'Retain');
  const disk = r.Workspace.Properties.BlockDeviceMappings[0].Ebs;
  assert.equal(disk.Encrypted, true);
  assert.equal(disk.DeleteOnTermination, false);
});

test('自動停止は開発の1台に限定し、本番や他プロジェクトを停止できない', () => {
  const r = developmentTemplate().Resources;
  const stop = r.StopRole.Properties.Policies[0].PolicyDocument.Statement.find((s) => s.Action === 'ec2:StopInstances');
  assert.deepEqual(stop.Resource, { 'Fn::Sub': 'arn:${AWS::Partition}:ec2:${AWS::Region}:${AWS::AccountId}:instance/${Workspace}' });
  assert.equal(stop.Condition.StringEquals['ec2:ResourceTag/Environment'], 'development');
  assert.equal(stop.Condition.StringEquals['ec2:ResourceTag/Project'], 'ses-platform');
  assert.deepEqual(r.AutoStop.Properties.Environment.Variables.INSTANCE_ID, { Ref: 'Workspace' });
  assert.equal(r.StopSchedule.Properties.ScheduleExpression, 'rate(15 minutes)');
});

test('作業用ロールに本番送信・秘密値取得・ロール変更の権限を与えない', () => {
  const statements = developmentTemplate().Resources.WorkspaceRole.Properties.Policies[0].PolicyDocument.Statement;
  const deny = statements.find((s) => s.Effect === 'Deny' && Array.isArray(s.Action));
  for (const action of ['secretsmanager:*', 'ssm:GetParameter', 'sts:AssumeRole', 'iam:*', 'ses:*', 'sns:Publish']) assert.ok(deny.Action.includes(action));
  const getObject = statements.find((s) => s.Action === 's3:GetObject');
  assert.ok(JSON.stringify(getObject.Resource).includes('/bootstrap/*'));
  assert.ok(statements.some((s) => s.Effect === 'Deny' && s.Action === 's3:*' && s.NotResource));
  assert.ok(statements.some((s) => s.Effect === 'Deny' && s.Action === 'kms:*' && s.NotResource));
});
