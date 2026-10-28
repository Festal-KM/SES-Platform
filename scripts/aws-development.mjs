#!/usr/bin/env node
// このスクリプトは開発VMだけを操作する。本番・デモを引数で指定する経路は設けない。
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ACCOUNT_ID, REGION } from '../infra/aws/foundation.mjs';
import { developmentTemplate } from '../infra/aws/development.mjs';

function aws(args) {
  const result = spawnSync('aws', [...args, '--region', REGION, '--output', 'json', '--no-cli-pager'], { encoding: 'utf8', windowsHide: true });
  if (result.error || result.status !== 0) throw new Error(result.stderr || 'AWS CLI の実行に失敗しました');
  return result.stdout.trim() ? JSON.parse(result.stdout) : undefined;
}
const stackName = 'ses-platform-development-workspace';
const deadline = () => String(Math.floor(Date.now() / 1000) + 8 * 60 * 60);
try {
  const [action, ...rest] = process.argv.slice(2);
  if (!['render', 'init', 'start', 'stop', 'status'].includes(action) || rest.length) throw new Error('使い方: node scripts/aws-development.mjs render|init|start|stop|status（開発専用）');
  if (action === 'render') {
    console.log(JSON.stringify(developmentTemplate(), null, 2));
  } else {
    if (aws(['sts', 'get-caller-identity']).Account !== ACCOUNT_ID) throw new Error('承認されたAWSアカウントと異なります');
    if (action === 'init') {
      const foundation = aws(['cloudformation', 'describe-stacks', '--stack-name', 'ses-platform-development-foundation']).Stacks[0];
      if (!['CREATE_COMPLETE', 'UPDATE_COMPLETE'].includes(foundation.StackStatus)) throw new Error('開発基盤が正常な状態ではありません');
      const outputs = Object.fromEntries(foundation.Outputs.map((output) => [output.OutputKey, output.OutputValue]));
      const existing = aws(['cloudformation', 'list-stacks', '--stack-status-filter', 'CREATE_COMPLETE', 'UPDATE_COMPLETE']).StackSummaries.find((summary) => summary.StackName === stackName);
      let imageId;
      if (existing) {
        const current = aws(['cloudformation', 'describe-stacks', '--stack-name', stackName]).Stacks[0];
        const currentTags = Object.fromEntries(current.Tags.map((tag) => [tag.Key, tag.Value]));
        if (currentTags.Project !== 'ses-platform' || currentTags.Environment !== 'development') throw new Error('開発スタックの所有タグが一致しません');
        const instanceId = current.Outputs.find((output) => output.OutputKey === 'InstanceId')?.OutputValue;
        const instance = aws(['ec2', 'describe-instances', '--instance-ids', instanceId]).Reservations[0].Instances[0];
        if (instance.SubnetId !== outputs.PublicSubnetA) throw new Error('ネットワークの変更は既存VMの移行手順を決めてから行ってください');
        // 最新AMIの自動解決で作業ディスク付きVMを置換しない。
        imageId = instance.ImageId;
      } else {
        imageId = aws(['ssm', 'get-parameter', '--name', '/aws/service/ami-amazon-linux-latest/al2023-ami-kernel-default-x86_64']).Parameter.Value;
      }
      const directory = mkdtempSync(join(tmpdir(), 'ses-aws-development-'));
      try {
        const file = join(directory, 'template.json');
        writeFileSync(file, JSON.stringify(developmentTemplate()));
        const result = spawnSync('aws', ['cloudformation', 'deploy', '--region', REGION, '--no-cli-pager', '--template-file', file,
          '--stack-name', stackName, '--capabilities', 'CAPABILITY_NAMED_IAM', '--no-fail-on-empty-changeset',
          '--parameter-overrides', `VpcId=${outputs.VpcId}`, `SubnetId=${outputs.PublicSubnetA}`, `StopAfter=${deadline()}`, `StorageKeyArn=${outputs.StorageKeyArn}`, `ImageId=${imageId}`,
          '--tags', 'Project=ses-platform', 'Environment=development'], { encoding: 'utf8', windowsHide: true });
        if (result.error || result.status !== 0) throw new Error(result.stderr || result.stdout || '開発VMを作成できませんでした');
        console.log(result.stdout);
        aws(['cloudformation', 'update-termination-protection', '--stack-name', stackName, '--enable-termination-protection']);
      } finally { rmSync(directory, { recursive: true, force: true }); }
    } else {
      const stack = aws(['cloudformation', 'describe-stacks', '--stack-name', stackName]).Stacks[0];
      const instanceId = stack.Outputs.find((output) => output.OutputKey === 'InstanceId')?.OutputValue;
      if (!/^i-[a-f0-9]+$/.test(instanceId ?? '')) throw new Error('開発VMの識別子を確認できませんでした');
      const instance = aws(['ec2', 'describe-instances', '--instance-ids', instanceId]).Reservations[0].Instances[0];
      const tags = Object.fromEntries(instance.Tags.map((tag) => [tag.Key, tag.Value]));
      if (tags.Project !== 'ses-platform' || tags.Environment !== 'development') throw new Error('開発VMのタグが一致しません');
      if (action === 'start') {
        if (!['stopped', 'running'].includes(instance.State.Name)) throw new Error('起動・停止処理が完了してから再実行してください');
        aws(['ec2', 'create-tags', '--resources', instanceId, '--tags', `Key=StopAfter,Value=${deadline()}`]);
        if (instance.State.Name === 'stopped') aws(['ec2', 'start-instances', '--instance-ids', instanceId]);
        console.log('開発VMを起動します。8時間後以降の最初の定期検査で自動停止します。');
      } else if (action === 'stop') {
        if (instance.State.Name === 'running') aws(['ec2', 'stop-instances', '--instance-ids', instanceId]);
        else if (!['stopped', 'stopping'].includes(instance.State.Name)) throw new Error('起動処理が完了してから停止してください');
        console.log('開発VMの停止を要求しました。ディスクとデータは保持します。');
      } else {
        console.log(JSON.stringify({ instanceId, state: instance.State.Name, stopAfter: tags.StopAfter, connect: `aws ssm start-session --region ${REGION} --target ${instanceId}` }, null, 2));
      }
    }
  }
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
