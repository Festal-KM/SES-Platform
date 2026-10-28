#!/usr/bin/env node
import { randomBytes } from 'node:crypto';
import { applicationTemplate } from '../infra/aws/application.mjs';
import { assertAccount, assertEnvironment, aws, deployStack, ensureSecret, stackOutputs } from './aws/common.mjs';

try {
  const [environment, ...rest] = process.argv.slice(2);
  assertEnvironment(environment);
  if (environment === 'development' || rest.length) throw new Error('使い方: node scripts/aws-provision-application.mjs demo|production');
  assertAccount();
  const prefix = `ses-platform-${environment}`;
  const foundation = stackOutputs(`${prefix}-foundation`);
  const token = ensureSecret(`/${prefix}/cache-token`, () => ({ token: randomBytes(32).toString('hex') }));
  // 既存DBの意図しないバージョン更新を避ける。
  const existing = aws(['cloudformation', 'list-stacks', '--stack-status-filter', 'CREATE_COMPLETE', 'UPDATE_COMPLETE']).StackSummaries.find((stack) => stack.StackName === `${prefix}-application`);
  let version;
  if (existing) {
    version = aws(['cloudformation', 'describe-stacks', '--stack-name', existing.StackName]).Stacks[0].Parameters.find((parameter) => parameter.ParameterKey === 'DatabaseVersion').ParameterValue;
  } else {
    const versions = aws(['rds', 'describe-db-engine-versions', '--engine', 'postgres']).DBEngineVersions
      .filter((entry) => entry.EngineVersion.startsWith('17.') && entry.Status === 'available').map((entry) => entry.EngineVersion);
    versions.sort((a, b) => b.localeCompare(a, undefined, { numeric: true }));
    version = versions[0];
    if (!version) throw new Error('PostgreSQL 17の利用可能なバージョンを確認できません');
  }
  deployStack(`${prefix}-application`, applicationTemplate(environment), [
    `VpcId=${foundation.VpcId}`, `PublicSubnets=${foundation.PublicSubnetA},${foundation.PublicSubnetC}`,
    `PrivateSubnets=${foundation.PrivateSubnetA},${foundation.PrivateSubnetC}`, `StorageKeyArn=${foundation.StorageKeyArn}`,
    `DatabaseVersion=${version}`, `CacheTokenSecretArn=${token}`,
  ]);
  console.log(JSON.stringify({ environment, ...stackOutputs(`${prefix}-application`) }, null, 2));
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
