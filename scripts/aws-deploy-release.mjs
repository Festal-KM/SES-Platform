#!/usr/bin/env node
// GitHub EnvironmentごとのOIDCで実行する。アプリの秘密値は取得しない。
import { appendFileSync } from 'node:fs';
import { taskDefinition } from '../infra/aws/tasks.mjs';
import { releaseImage, releaseRecord, releaseServicesReady } from './aws/release.mjs';
import { verifyDemoSignIn } from './aws/smoke-demo.mjs';
import { assertAccount, aws, stackOutputs, withJsonFile, HOSTS } from './aws/common.mjs';
const delay = () => new Promise((done) => setTimeout(done, 10_000));
function report(value) {
  console.log(value);
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${value}\n`);
}
try {
  const [environment, commit, digest, buildId, ...rest] = process.argv.slice(2);
  if (!['demo', 'production'].includes(environment) || rest.length) throw new Error('使い方: node scripts/aws-deploy-release.mjs demo|production commit digest buildId');
  const record = releaseRecord({ commit, digest, buildId });
  assertAccount();
  const prefix = `ses-platform-${environment}`;
  const foundation = stackOutputs(`${prefix}-foundation`);
  const application = stackOutputs(`${prefix}-application`);
  const ingress = stackOutputs(`${prefix}-ingress`);
  const descriptor = JSON.parse(aws(['ssm', 'get-parameter', '--name', `/ses-platform/${environment}/deployment`]).Parameter.Value);
  const image = releaseImage(environment, digest);
  aws(['ecr', 'describe-images', '--repository-name', prefix, '--image-ids', `imageDigest=${digest}`]);
  const networkConfiguration = { awsvpcConfiguration: { subnets: [foundation.PublicSubnetA, foundation.PublicSubnetC], securityGroups: [application.ApplicationSecurityGroup], assignPublicIp: 'ENABLED' } };
  const register = (role) => withJsonFile(taskDefinition({ environment, role, image, ...descriptor }),
    (file) => aws(['ecs', 'register-task-definition', '--cli-input-json', `file://${file.replaceAll('\\', '/')}`])).taskDefinition.taskDefinitionArn;
  const definitions = { migration: register('migration'), web: register('web'), worker: register('worker') };
  async function oneOff(definition, mode) {
    const input = { cluster: prefix, launchType: 'FARGATE', platformVersion: 'LATEST', taskDefinition: definition, networkConfiguration,
      ...(mode ? { overrides: { containerOverrides: [{ name: mode === 'verify' ? 'worker' : 'migration', command: mode === 'verify' ? ['verify'] : ['migrate', '--seed-demo'] }] } } : {}) };
    const response = withJsonFile(input, (file) => aws(['ecs', 'run-task', '--cli-input-json', `file://${file.replaceAll('\\', '/')}`]));
    if (response.failures?.length || response.tasks?.length !== 1) throw new Error('一回限りのタスクを開始できません');
    const arn = response.tasks[0].taskArn;
    const deadline = Date.now() + 30 * 60_000;
    while (Date.now() < deadline) {
      await delay();
      const task = aws(['ecs', 'describe-tasks', '--cluster', prefix, '--tasks', arn]).tasks[0];
      if (task?.lastStatus === 'STOPPED') {
        if (task.containers?.some(container => container.exitCode === 0) && task.containers.every(container => container.exitCode === 0)) return;
        throw new Error(`管理タスクに失敗しました。CloudWatchで管理者が確認してください: ${arn}`);
      }
    }
    throw new Error(`タスクの待機期限を超過しました。再送前に状態を確認してください: ${arn}`);
  }
  await oneOff(definitions.worker, 'verify');
  await oneOff(definitions.migration);
  if (environment === 'demo') {
    const existing = aws(['ecs', 'describe-services', '--cluster', prefix, '--services', `${prefix}-web`, `${prefix}-worker`]).services ?? [];
    if (!existing.some(service => service.status === 'ACTIVE')) {
      const tasks = aws(['ecs', 'list-tasks', '--cluster', prefix, '--desired-status', 'RUNNING']).taskArns;
      if (tasks.length) throw new Error('初回デモ投入前に既存タスクの停止が必要です');
      await oneOff(definitions.migration, 'seed');
    }
  }
  for (const role of ['web', 'worker']) {
    const serviceName = `${prefix}-${role}`;
    const existing = aws(['ecs', 'describe-services', '--cluster', prefix, '--services', serviceName]).services?.find(service => service.status === 'ACTIVE');
    const input = { cluster: prefix, service: serviceName, taskDefinition: definitions[role], desiredCount: role === 'web' && environment === 'production' ? 2 : 1,
      deploymentConfiguration: { maximumPercent: 200, minimumHealthyPercent: 100, deploymentCircuitBreaker: { enable: true, rollback: true } } };
    if (existing) {
      report(`復旧用の直前タスク定義 (${role}): ${existing.taskDefinition}`);
      withJsonFile(input, (file) => aws(['ecs', 'update-service', '--cli-input-json', `file://${file.replaceAll('\\', '/')}`]));
    } else {
      const { service, ...create } = input;
      withJsonFile({ ...create, serviceName: service, launchType: 'FARGATE', platformVersion: 'LATEST', networkConfiguration,
        ...(role === 'web' ? { loadBalancers: [{ targetGroupArn: ingress.TargetGroupArn, containerName: 'web', containerPort: 3000 }], healthCheckGracePeriodSeconds: 180 } : {}),
      }, (file) => aws(['ecs', 'create-service', '--cli-input-json', `file://${file.replaceAll('\\', '/')}`]));
    }
  }
  const deadline = Date.now() + 20 * 60_000;
  let stable = false;
  while (Date.now() < deadline) {
    await delay();
    const services = aws(['ecs', 'describe-services', '--cluster', prefix, '--services', `${prefix}-web`, `${prefix}-worker`]).services;
    if (services.some(service => service.deployments.some(deployment => deployment.rolloutState === 'FAILED'))) throw new Error('ECS配備が失敗しました。旧版への復旧状態を確認してください');
    if (releaseServicesReady(services, definitions)) { stable = true; break; }
  }
  if (!stable) throw new Error('サービスの安定を確認できません。旧版への自動復旧やログを確認してください');
  const response = await fetch(`https://${HOSTS[environment]}/signin`, { redirect: 'manual', signal: globalThis.AbortSignal.timeout(30_000) });
  if (response.status !== 200) throw new Error('公開HTTPSのログイン画面が正常応答しません');
  if (environment === 'demo') await verifyDemoSignIn();
  // 本番昇格に使うのは、デモへの反映・公開HTTPS検査を通過した固定digestだけ。
  withJsonFile({ ...record, verifiedAt: new Date().toISOString() }, (file) => aws(['s3', 'cp', file,
    `s3://${foundation.FilesBucket}/releases/${commit}.json`, '--sse', 'aws:kms', '--sse-kms-key-id', foundation.StorageKeyArn, '--only-show-errors'], { json: false }));
  report(`反映完了: ${environment} / ${commit} / ${digest} / https://${HOSTS[environment]}/signin`);
} catch (error) { console.error(error.message); process.exitCode = 1; }
