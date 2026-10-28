// 既存のデモデータを消さず、権限確認用の合成アカウントだけを追加する。
import { PrismaClient } from '@prisma/client';
import { assertSeedableAppEnv, createRoleAccountAccess } from '@ses/config';
import { DEMO_SEED_IDS, DEMO_SEED_PASSWORD_HASH } from './presets/demo.js';
import { resolveSeedDatabaseUrl } from './args.js';

async function main(): Promise<void> {
  assertSeedableAppEnv(process.env.APP_ENV);
  const APP_ENV = process.env.APP_ENV === 'demo' ? 'demo' : 'development';
  const access = createRoleAccountAccess({ APP_ENV, AWS_ISOLATION_MODE: 'resource' });
  const db = new PrismaClient({ datasources: { db: { url: resolveSeedDatabaseUrl(process.env) } } });
  try {
    for (const account of access.accounts) {
      const displayName = `サンプル ${account.role} ${account.tenantNumber}-${account.accountNumber}`;
      if (account.realm === 'platform') {
        await db.platformUser.upsert({ where: { id: account.id }, update: {}, create: { id: account.id, email: account.email, displayName, role: account.role, passwordHash: DEMO_SEED_PASSWORD_HASH } });
        continue;
      }
      const tenant = DEMO_SEED_IDS.tenants[account.tenantNumber - 1];
      if (!tenant) throw new Error('合成テナントが不正です');
      const partner = account.role.startsWith('PARTNER_') ? tenant.partners[account.accountNumber - 1]?.partnerCompanyId : null;
      if (account.role.startsWith('PARTNER_') && !partner) throw new Error('合成取引先が不正です');
      await db.$transaction(async (tx) => {
        await tx.user.upsert({ where: { id: account.id }, update: {}, create: { id: account.id, tenantId: tenant.tenantId,
          ownerPartnerCompanyId: partner ?? null, email: account.email, displayName, passwordHash: DEMO_SEED_PASSWORD_HASH } });
        await tx.membership.upsert({ where: { tenantId_userId: { tenantId: tenant.tenantId, userId: account.id } }, update: {},
          create: { tenantId: tenant.tenantId, userId: account.id, role: account.role, partnerCompanyId: partner ?? null, joinedAt: new Date() } });
      });
    }
    console.log(`合成アカウント${access.accounts.length}件を確認しました。既存のパスワード・2FA・権限変更は保持します。`);
  } finally { await db.$disconnect(); }
}
main().catch(() => { console.error('合成アカウントを作成できませんでした。環境と投入用DB接続を確認してください。'); process.exitCode = 1; });
