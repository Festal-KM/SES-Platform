import { ACCOUNT_ID, REGION } from './foundation.mjs';

export function taskDefinition({ environment, role, image, runtimeSecretArn, runtimeKeys, masterSecretArn, rolesSecretArn }) {
  if (!['demo', 'production'].includes(environment) || !['web', 'worker', 'migration'].includes(role)) throw new Error('環境または実行ロールが不正です');
  const prefix = `ses-platform-${environment}`;
  for (const secret of [runtimeSecretArn, ...(role === 'migration' ? [rolesSecretArn] : [])]) {
    if (!secret?.startsWith(`arn:aws:secretsmanager:${REGION}:${ACCOUNT_ID}:secret:/${prefix}/`)) throw new Error('他環境の秘密値を参照できません');
  }
  if (!new RegExp(`^${ACCOUNT_ID}\\.dkr\\.ecr\\.${REGION}\\.amazonaws\\.com/${prefix}@sha256:[a-f0-9]{64}$`).test(image)) throw new Error('現在の環境専用の固定イメージを指定してください');
  if (runtimeKeys.some((key) => !/^[A-Z][A-Z0-9_]*$/.test(key) || /PASSWORD|MIGRATION|SUPERUSER|SEED_DATABASE|^DB_ADMIN_/.test(key))) throw new Error('通常のアプリに管理用の変数を渡せません');
  const migration = role === 'migration';
  // NODE_ENVは固定の通常変数で渡す。ECSはsecretsとの同名定義を拒否する。
  const secrets = runtimeKeys.filter(key => key !== 'NODE_ENV').map((key) => ({ name: key, valueFrom: `${runtimeSecretArn}:${key}::` }));
  if (migration) {
    for (const key of ['APP_MIGRATOR_PASSWORD', 'APP_TENANT_PASSWORD', 'APP_PLATFORM_PASSWORD', 'APP_PLATFORM_WRITE_PASSWORD']) secrets.push({ name: key, valueFrom: `${rolesSecretArn}:${key}::` });
    secrets.push({ name: 'DB_ADMIN_USERNAME', valueFrom: `${masterSecretArn}:username::` }, { name: 'DB_ADMIN_PASSWORD', valueFrom: `${masterSecretArn}:password::` });
  }
  return {
    family: `${prefix}-${role}`, networkMode: 'awsvpc', requiresCompatibilities: ['FARGATE'],
    cpu: migration || environment === 'production' ? '1024' : '512', memory: migration || environment === 'production' ? '2048' : '1024',
    executionRoleArn: `arn:aws:iam::${ACCOUNT_ID}:role/${prefix}-${migration ? 'migration-execution' : 'execution'}`,
    ...(!migration ? { taskRoleArn: `arn:aws:iam::${ACCOUNT_ID}:role/${prefix}-task` } : {}),
    containerDefinitions: [{ name: role, image, essential: true, command: [migration ? 'migrate' : role],
      ...(role === 'web' ? { portMappings: [{ containerPort: 3000, protocol: 'tcp' }] } : {}),
      secrets, environment: [{ name: 'NODE_ENV', value: 'production' }], stopTimeout: 120,
      logConfiguration: { logDriver: 'awslogs', options: { 'awslogs-group': `/ses-platform/${environment}`, 'awslogs-region': REGION, 'awslogs-stream-prefix': role } },
    }],
    tags: [{ key: 'Project', value: 'ses-platform' }, { key: 'Environment', value: environment }],
  };
}
