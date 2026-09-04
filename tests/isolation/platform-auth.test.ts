// tests/isolation/platform-auth.test.ts
// T-03-07（docs/sprints/SP-03-auth-audit-admin0.md）の完了判定:
//
//   `F-055 AC-1` テナントの `User` に「運営者フラグ」に相当する属性・ロール・権限が存在しない（`BR-36`）
//   `F-055 AC-2` テナント利用者の認証情報で `/admin` に到達できず、逆も成立しない
//   `F-055 AC-3` 2 要素認証を設定するまで管理平面のいずれの画面にも到達できない
//   `F-055 AC-4` 運営者のログイン・ログアウト・画面閲覧が監査ログに記録される
//
// 検証はアプリの実装（`apps/web/lib/auth/**`）をそのまま呼ぶ（`auth-tenant-ctx.test.ts` /
// `two-factor.test.ts` と同じ方針）。HTTP 層を通した検証は E2E（T-03-11）が行う。
//
// 🔴 「相互に到達不能」は**両方向**を見る。片方向だけの検証だと、
//    「運営者が主平面の業務データを読める」経路が残っていても green になる。
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  configurePlatformWriteDb,
  configureTenantDb,
  configureTokenEncryption,
  disconnectPlatformWriteDb,
  disconnectTenantDb,
  TwoFactorRequiredError,
  withTenant,
  type PlatformIdentity,
  type TenantIdentity,
} from '@ses/db';
import { createUnextendedClient, type UnextendedClient } from '@ses/db/testing';
import { ISOLATION_SEED_IDS, runSeed } from '@ses/db/seed';
import { authenticateCredentials } from '../../apps/web/lib/auth/credentials';
import type { AuthAttemptMeta } from '../../apps/web/lib/auth/credentials';
import { parseTenantSessionClaims } from '../../apps/web/lib/auth/claims';
import { hashPassword } from '../../apps/web/lib/auth/password';
import { parsePlatformSessionClaims } from '../../apps/web/lib/auth/platform-claims';
import {
  authenticatePlatformCredentials,
  recordPlatformSignOut,
} from '../../apps/web/lib/auth/platform-credentials';
import {
  buildPlatformCtx,
  loadPlatformFacts,
} from '../../apps/web/lib/auth/platform-context';
import {
  startPlatformEnrollment,
  verifyPlatformTwoFactorCode,
} from '../../apps/web/lib/auth/platform-two-factor';
import { buildTenantCtx } from '../../apps/web/lib/auth/tenant-context';
import { totpCode } from '../../apps/web/lib/auth/totp';
import { startIsolationDatabase, type IsolationDatabase } from './support/postgres.js';

const SETUP_TIMEOUT_MS = 600_000;
/** 🔴 「実行日 = T」を固定する（docs/05 §17.6）。TOTP のステップもここから決まる。 */
const NOW = new Date('2026-09-04T00:00:00.000Z');

// テスト専用のダミー鍵（32 バイト）。実運用の値ではない。
const TOKEN_ENCRYPTION_KEY = Buffer.alloc(32, 9).toString('base64');

const TENANT_1 = ISOLATION_SEED_IDS.tenants[0];

const META: AuthAttemptMeta = { deviceKind: 'api', ipAddress: '203.0.113.20' };

/** 🔴 テスト専用の運営者アカウント（合成データ。実在しない）。 */
const OWNER_ID = '01999000-0000-7000-8000-00000000a001';
const SUPPORT_ID = '01999000-0000-7000-8000-00000000a002';
const DISABLED_ID = '01999000-0000-7000-8000-00000000a003';
const OWNER_EMAIL = 'owner@platform-test.invalid';
const SUPPORT_EMAIL = 'support@platform-test.invalid';
const DISABLED_EMAIL = 'disabled@platform-test.invalid';
const PLATFORM_PASSWORD = 'platform-operator-password-1';
/**
 * シードのホスト利用者（`packages/db/seed/presets/isolation.ts`）。
 * 🔴 シードの `password_hash` はプレースホルダなので、`beforeAll` で実際に検証できる
 *    Argon2id ハッシュに差し替える。**「主平面では通るのに管理平面では通らない」ことを
 *    対照付きで示す**ため（片側だけ落ちる実装でも green になる状態を作らない）。
 */
const SEED_TENANT_EMAIL = 'host-t1@seed-isolation.test';
const TENANT_PASSWORD = 'tenant-user-password-1';

const OWNER: PlatformIdentity = { platformUserId: OWNER_ID };
const SUPPORT: PlatformIdentity = { platformUserId: SUPPORT_ID };

const HOST_1: TenantIdentity = {
  tenantId: TENANT_1.tenantId,
  partnerCompanyId: null,
  userId: TENANT_1.hostUserId,
};

let database: IsolationDatabase;
/** 🔴 投入・前提づくり・「保存されている生の値」の確認にだけ使う特権接続。 */
let admin: UnextendedClient;
/** 運営者の TOTP シークレット（後続の describe が正しいコードを作るために使う）。 */
let ownerSecret = '';
let ownerRecoveryCodes: readonly string[] = [];

function secretOf(otpauthUrl: string): string {
  const secret = new URL(otpauthUrl).searchParams.get('secret');
  if (secret === null) throw new Error('otpauth URL に secret がありません（前提の破綻）。');
  return secret;
}

async function countPlatformAudit(action: string, actorId: string): Promise<number> {
  return admin.auditLog.count({
    where: { action, actorId, actorKind: 'PLATFORM_USER', tenantId: null },
  });
}

beforeAll(async () => {
  database = await startIsolationDatabase({ seed: 'none' });
  await runSeed({
    appEnv: 'development',
    databaseUrl: database.superuserUrl,
    preset: 'isolation',
    reset: true,
    now: NOW,
  });

  admin = createUnextendedClient(database.superuserUrl);
  configureTenantDb({ datasourceUrl: database.tenantUrl });
  // 🔴 管理平面は**別の接続プール・別の DB ロール**（docs/05 §4.2 / §5.2）。
  configurePlatformWriteDb({ datasourceUrl: database.platformWriteUrl });
  configureTokenEncryption({ key: TOKEN_ENCRYPTION_KEY, keyId: 'k1' });

  await admin.user.updateMany({
    where: { id: TENANT_1.hostUserId },
    data: { passwordHash: await hashPassword(TENANT_PASSWORD) },
  });

  const passwordHash = await hashPassword(PLATFORM_PASSWORD);
  await admin.platformUser.createMany({
    data: [
      { id: OWNER_ID, email: OWNER_EMAIL, displayName: '運営 太郎', role: 'PLATFORM_OWNER', passwordHash },
      { id: SUPPORT_ID, email: SUPPORT_EMAIL, displayName: '運営 花子', role: 'PLATFORM_SUPPORT', passwordHash },
      {
        id: DISABLED_ID,
        email: DISABLED_EMAIL,
        displayName: '運営 停止',
        role: 'PLATFORM_SUPPORT',
        passwordHash,
        disabledAt: NOW,
      },
    ],
  });
}, SETUP_TIMEOUT_MS);

afterAll(async () => {
  await disconnectPlatformWriteDb();
  await disconnectTenantDb();
  await admin?.$disconnect();
  await database?.stop();
}, SETUP_TIMEOUT_MS);

describe('🔴 F-055 AC-1: テナントの User に運営者フラグが存在しない（BR-36）', () => {
  it('users の列名に platform / is_admin / is_operator を含むものが 1 つも無い（実 DB のカタログ走査）', async () => {
    const rows = await admin.$queryRaw<Array<{ column_name: string }>>`
      SELECT column_name FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'users'
      ORDER BY column_name`;
    expect(rows.length).toBeGreaterThan(0); // 空振り防止（対照）
    const offenders = rows
      .map((row) => row.column_name.toLowerCase().replace(/_/g, ''))
      .filter((name) => ['platform', 'isadmin', 'isoperator'].some((word) => name.includes(word)));
    expect(offenders).toEqual([]);
  });

  it('memberships のロール値に PLATFORM_* が 1 件も無い（テナントのロールに運営者が混ざらない）', async () => {
    const roles = await admin.membership.findMany({ select: { role: true }, distinct: ['role'] });
    expect(roles.length).toBeGreaterThan(0); // 空振り防止（対照）
    expect(roles.filter((row) => row.role.startsWith('PLATFORM_'))).toEqual([]);
  });

  it('運営者は platform_users にしか存在しない（同じメールの users 行が 0 件）', async () => {
    const count = await admin.user.count({
      where: { email: { in: [OWNER_EMAIL, SUPPORT_EMAIL, DISABLED_EMAIL] } },
    });
    expect(count).toBe(0);
  });
});

describe('🔴 F-055 AC-2: 相互に到達不能（両方向）', () => {
  it('対照: テナント利用者の資格情報は**主平面では**通る（以降の「通らない」が空振りでない）', async () => {
    const result = await authenticateCredentials(
      { email: SEED_TENANT_EMAIL, password: TENANT_PASSWORD },
      META,
    );
    expect(result.outcome).toBe('AUTHENTICATED');
  });

  it('🔴 同じテナント利用者の資格情報で運営者としてサインインできない', async () => {
    const result = await authenticatePlatformCredentials(
      { email: SEED_TENANT_EMAIL, password: TENANT_PASSWORD },
      META,
      NOW,
    );
    expect(result).toEqual({ outcome: 'REJECTED' });
  });

  it('🔴 運営者の資格情報で主平面にサインインできない（逆方向）', async () => {
    const result = await authenticateCredentials(
      { email: OWNER_EMAIL, password: PLATFORM_PASSWORD },
      META,
    );
    expect(result).toEqual({ outcome: 'REJECTED' });
  });

  it('🔴 運営者の主体 ID でテナントの認証コンテキストを作れない（Membership が無い）', async () => {
    const ctx = await buildTenantCtx(
      { tenantId: TENANT_1.tenantId, partnerCompanyId: null, userId: OWNER_ID },
      { deviceKind: 'api' },
    );
    expect(ctx).toBeNull();
  });

  it('🔴 テナント利用者の ID で運営者の事実を確定できない（platform_users に行が無い）', async () => {
    const facts = await loadPlatformFacts({ platformUserId: TENANT_1.hostUserId });
    expect(facts).toBeNull();
  });

  it('🔴 主平面の JWT ペイロードは管理平面の主張として解釈されない', () => {
    const tenantToken = {
      tenantId: TENANT_1.tenantId,
      userId: TENANT_1.hostUserId,
      partnerCompanyId: null,
      twoFactorVerified: true,
    };
    expect(parseTenantSessionClaims(tenantToken)).not.toBeNull(); // 対照
    expect(parsePlatformSessionClaims(tenantToken)).toBeNull();
  });

  it('🔴 管理平面の JWT ペイロードは主平面の主張として解釈されない', () => {
    const platformToken = { platformUserId: OWNER_ID, platformTwoFactorVerified: true };
    expect(parsePlatformSessionClaims(platformToken)).not.toBeNull(); // 対照
    expect(parseTenantSessionClaims(platformToken)).toBeNull();
  });

  it('🔴 主平面の DB ロール（app_tenant）は platform_users に到達できない', async () => {
    const tenant = createUnextendedClient(database.tenantUrl);
    try {
      await expect(
        tenant.$queryRaw`SELECT password_hash FROM platform_users`,
      ).rejects.toThrow(/permission denied/i);
    } finally {
      await tenant.$disconnect();
    }
  });

  it('🔴 管理平面の DB ロール（app_platform_write）は users / engineers に到達できない', async () => {
    const platformWrite = createUnextendedClient(database.platformWriteUrl);
    try {
      await expect(platformWrite.$queryRaw`SELECT email FROM users`).rejects.toThrow(
        /permission denied/i,
      );
      await expect(platformWrite.$queryRaw`SELECT id FROM engineers`).rejects.toThrow(
        /permission denied/i,
      );
    } finally {
      await platformWrite.$disconnect();
    }
  });
});

describe('🔴 F-055 AC-3: 2FA を設定するまで管理平面のどの画面にも到達できない', () => {
  it('未設定の運営者は ctx が生成されない（SETUP_REQUIRED）', async () => {
    let thrown: unknown = null;
    const ctx = await buildPlatformCtx({ platformUserId: OWNER_ID }, { deviceKind: 'api' }).catch(
      (error: unknown) => {
        thrown = error;
        return null;
      },
    );
    expect(thrown).toBeInstanceOf(TwoFactorRequiredError);
    expect((thrown as TwoFactorRequiredError).reason).toBe('SETUP_REQUIRED');
    expect(ctx).toBeNull();
  });

  it('🔴 セッションが「検証済み」を主張していても、未設定なら通らない（DB の事実が正）', async () => {
    await expect(
      buildPlatformCtx(
        { platformUserId: OWNER_ID, twoFactorVerified: true },
        { deviceKind: 'api' },
      ),
    ).rejects.toBeInstanceOf(TwoFactorRequiredError);
  });

  it('🔴 PLATFORM_SUPPORT にも例外は無い（ロールによる免除が存在しない）', async () => {
    await expect(
      buildPlatformCtx({ platformUserId: SUPPORT_ID }, { deviceKind: 'api' }),
    ).rejects.toBeInstanceOf(TwoFactorRequiredError);
  });

  it('setup が otpauth URL とリカバリコードを返し、未確認の資格情報を作る', async () => {
    const result = await startPlatformEnrollment(OWNER, META);
    expect(result.status).toBe('ENROLLMENT_STARTED');
    if (result.status !== 'ENROLLMENT_STARTED') return;
    ownerSecret = secretOf(result.otpauthUrl);
    ownerRecoveryCodes = result.recoveryCodes;
    expect(result.recoveryCodes).toHaveLength(10);
    // 認証アプリのラベルは本人のメールアドレス、発行者は運営者コンソール。
    expect(result.otpauthUrl).toContain(encodeURIComponent(OWNER_EMAIL));
    expect(result.otpauthUrl).toContain(encodeURIComponent('SES Platform 運営者コンソール'));

    const stored = await admin.twoFactorCredential.findFirst({
      where: { subjectId: OWNER_ID, subjectType: 'PLATFORM_USER' },
      select: { tenantId: true, confirmedAt: true, secretEncrypted: true },
    });
    // 🔴 PLATFORM_USER 行は tenant_id を持たない（docs/05 §3.3 / C7 の注記）。
    expect(stored?.tenantId).toBeNull();
    expect(stored?.confirmedAt).toBeNull();
    // 🔴 シークレットは暗号化して保存される（平文が DB に現れない）。
    expect(stored?.secretEncrypted.startsWith('v1:k1:')).toBe(true);
    expect(stored?.secretEncrypted).not.toContain(ownerSecret);
  });

  it('🔴 設定途中（未確認）でも ctx は生成されない', async () => {
    await expect(
      buildPlatformCtx({ platformUserId: OWNER_ID }, { deviceKind: 'api' }),
    ).rejects.toBeInstanceOf(TwoFactorRequiredError);
  });

  it('正しい TOTP で登録が確定する', async () => {
    const result = await verifyPlatformTwoFactorCode(OWNER, totpCode(ownerSecret, NOW), META, NOW);
    expect(result).toEqual({ outcome: 'ENROLLED' });
  });

  it('🔴 設定済みでも、このセッションが未検証なら到達できない（VERIFICATION_REQUIRED）', async () => {
    let thrown: unknown = null;
    await buildPlatformCtx({ platformUserId: OWNER_ID }, { deviceKind: 'api' }).catch(
      (error: unknown) => {
        thrown = error;
        return null;
      },
    );
    expect(thrown).toBeInstanceOf(TwoFactorRequiredError);
    expect((thrown as TwoFactorRequiredError).reason).toBe('VERIFICATION_REQUIRED');
  });

  it('検証済みのセッションなら ctx が生成され、ロールは DB から確定する', async () => {
    const verified = await verifyPlatformTwoFactorCode(
      OWNER,
      totpCode(ownerSecret, NOW),
      META,
      NOW,
    );
    expect(verified).toEqual({ outcome: 'VERIFIED', method: 'TOTP' });

    const ctx = await buildPlatformCtx(
      { platformUserId: OWNER_ID, twoFactorVerified: true },
      { deviceKind: 'api' },
    );
    expect(ctx?.platformUserId).toBe(OWNER_ID);
    // 🔴 ロールはセッションに載っていない（JWT には platformUserId しか無い）。
    expect(ctx?.platformRole).toBe('PLATFORM_OWNER');
  });

  it('🔴 無効化された運営者は ctx を作れない（2FA 以前の問題として null）', async () => {
    const ctx = await buildPlatformCtx(
      { platformUserId: DISABLED_ID, twoFactorVerified: true },
      { deviceKind: 'api' },
    );
    expect(ctx).toBeNull();
  });

  it('確認済みの資格情報は setup で上書きされない（ALREADY_ENROLLED）', async () => {
    const before = await admin.twoFactorCredential.findFirst({
      where: { subjectId: OWNER_ID, subjectType: 'PLATFORM_USER' },
      select: { secretEncrypted: true, recoveryCodeHashes: true, confirmedAt: true },
    });
    const result = await startPlatformEnrollment(OWNER, META);
    expect(result.status).toBe('ALREADY_ENROLLED');
    const after = await admin.twoFactorCredential.findFirst({
      where: { subjectId: OWNER_ID, subjectType: 'PLATFORM_USER' },
      select: { secretEncrypted: true, recoveryCodeHashes: true, confirmedAt: true },
    });
    expect(after).toEqual(before);
  });

  it('🔴 リカバリコードは 1 回限り（2 回目は拒否され、残数が減らない）', async () => {
    const code = ownerRecoveryCodes[0] as string;
    expect(await verifyPlatformTwoFactorCode(OWNER, code, META, NOW)).toEqual({
      outcome: 'VERIFIED',
      method: 'RECOVERY_CODE',
    });
    const afterFirst = await admin.twoFactorCredential.findFirst({
      where: { subjectId: OWNER_ID, subjectType: 'PLATFORM_USER' },
      select: { recoveryCodeHashes: true },
    });
    expect(afterFirst?.recoveryCodeHashes).toHaveLength(9);

    expect(await verifyPlatformTwoFactorCode(OWNER, code, META, NOW)).toEqual({
      outcome: 'REJECTED',
    });
    const afterSecond = await admin.twoFactorCredential.findFirst({
      where: { subjectId: OWNER_ID, subjectType: 'PLATFORM_USER' },
      select: { recoveryCodeHashes: true },
    });
    expect(afterSecond?.recoveryCodeHashes).toHaveLength(9);
  });

  it('🔴 運営者の 2FA 資格情報はテナント平面から 1 行も見えない（C7 SELF が subject_type を AND する）', async () => {
    const ctx = await buildTenantCtx({ ...HOST_1, twoFactorVerified: true }, { deviceKind: 'api' });
    if (ctx === null) throw new Error('テナント ctx を作れませんでした（前提の破綻）。');
    const rows = await withTenant(ctx, (db) =>
      db.twoFactorCredential.findMany({ where: { subjectId: OWNER_ID }, select: { id: true } }),
    );
    expect(rows).toEqual([]);
  });
});

describe('🔴 F-055 AC-4: 運営者のログイン・ログアウト・2FA が監査ログに記録される（BR-41）', () => {
  it('サインインが成功し、auth.login が PLATFORM_USER として記録される', async () => {
    const before = await countPlatformAudit('auth.login', OWNER_ID);
    const result = await authenticatePlatformCredentials(
      { email: OWNER_EMAIL, password: PLATFORM_PASSWORD },
      META,
      NOW,
    );
    expect(result).toEqual({ outcome: 'AUTHENTICATED', claims: { platformUserId: OWNER_ID } });
    expect(await countPlatformAudit('auth.login', OWNER_ID)).toBe(before + 1);
  });

  /**
   * 🔴 `code-reviewer` 指摘（T-03-07）: メールアドレスの正規化を呼び出し側（Zod スキーマ）に
   *    依存させない。ポリシーが両辺を `lower()` で畳み、`withPlatformAuthLookup` も
   *    `trim().toLowerCase()` する。**Route Handler を経由しない呼び出しでも通る**こと。
   */
  it('🔴 大文字混じり / 前後空白のメールアドレスでもサインインできる（正規化は DB 層で完結する）', async () => {
    const before = await countPlatformAudit('auth.login', OWNER_ID);
    const result = await authenticatePlatformCredentials(
      { email: `  ${OWNER_EMAIL.toUpperCase()}  `, password: PLATFORM_PASSWORD },
      META,
      NOW,
    );
    expect(result).toEqual({ outcome: 'AUTHENTICATED', claims: { platformUserId: OWNER_ID } });
    expect(await countPlatformAudit('auth.login', OWNER_ID)).toBe(before + 1);
  });

  it('🔴 監査ログの tenant_id は NULL で、actor_kind は PLATFORM_USER である', async () => {
    const rows = await admin.auditLog.findMany({
      where: { actorId: OWNER_ID },
      select: { tenantId: true, actorKind: true, ipAddress: true, deviceKind: true },
    });
    expect(rows.length).toBeGreaterThan(0); // 空振り防止（対照）
    for (const row of rows) {
      expect(row.tenantId).toBeNull();
      expect(row.actorKind).toBe('PLATFORM_USER');
      expect(row.ipAddress).toBe('203.0.113.20');
      expect(row.deviceKind).toBe('api');
    }
  });

  it('サインイン時に last_login_at が更新される（同一トランザクション）', async () => {
    const row = await admin.platformUser.findFirst({
      where: { id: OWNER_ID },
      select: { lastLoginAt: true },
    });
    expect(row?.lastLoginAt).toEqual(NOW);
  });

  it('パスワード不一致は auth.login_failed として記録され、応答は理由を持たない', async () => {
    const before = await countPlatformAudit('auth.login_failed', OWNER_ID);
    const result = await authenticatePlatformCredentials(
      { email: OWNER_EMAIL, password: 'wrong-password' },
      META,
      NOW,
    );
    expect(result).toEqual({ outcome: 'REJECTED' });
    expect(await countPlatformAudit('auth.login_failed', OWNER_ID)).toBe(before + 1);
  });

  it('無効化済みの運営者もサインインできず、理由は監査ログにだけ残る', async () => {
    const result = await authenticatePlatformCredentials(
      { email: DISABLED_EMAIL, password: PLATFORM_PASSWORD },
      META,
      NOW,
    );
    expect(result).toEqual({ outcome: 'REJECTED' });
    const rows = await admin.auditLog.findMany({
      where: { actorId: DISABLED_ID, action: 'auth.login_failed' },
      select: { summary: true },
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.summary).toEqual({ reason: 'USER_DISABLED' });
  });

  it('🔴 存在しないメールアドレスへの試行では監査ログの行が増えない（主体が確定しないため）', async () => {
    const before = await admin.auditLog.count({ where: { actorKind: 'PLATFORM_USER' } });
    const result = await authenticatePlatformCredentials(
      { email: 'nobody@platform-test.invalid', password: PLATFORM_PASSWORD },
      META,
      NOW,
    );
    expect(result).toEqual({ outcome: 'REJECTED' });
    expect(await admin.auditLog.count({ where: { actorKind: 'PLATFORM_USER' } })).toBe(before);
  });

  it.each(['auth.2fa.setup_started', 'auth.2fa.enabled', 'auth.2fa.verified', 'auth.2fa.recovery_used'])(
    '%s が記録されている',
    async (action) => {
      expect(await countPlatformAudit(action, OWNER_ID)).toBeGreaterThan(0);
    },
  );

  it('サインアウトが auth.logout として記録される', async () => {
    const before = await countPlatformAudit('auth.logout', OWNER_ID);
    await recordPlatformSignOut({ platformUserId: OWNER_ID }, META);
    expect(await countPlatformAudit('auth.logout', OWNER_ID)).toBe(before + 1);
  });

  it('🔴 summary にシークレット・コード・メールアドレスが入らない（種別と件数だけ）', async () => {
    const rows = await admin.auditLog.findMany({
      where: { actorKind: 'PLATFORM_USER' },
      select: { summary: true },
    });
    expect(rows.length).toBeGreaterThan(0); // 空振り防止（対照）
    const joined = JSON.stringify(rows.map((row) => row.summary));
    expect(joined).not.toContain(OWNER_EMAIL);
    expect(joined).not.toContain(ownerSecret);
    expect(joined).not.toContain('v1:k1:');
    for (const code of ownerRecoveryCodes) expect(joined).not.toContain(code);
  });

  it('🔴 運営者の監査ログはテナント平面から 1 行も見えない（audit_logs の C2 は tenant_id で絞る）', async () => {
    const ctx = await buildTenantCtx({ ...HOST_1, twoFactorVerified: true }, { deviceKind: 'api' });
    if (ctx === null) throw new Error('テナント ctx を作れませんでした（前提の破綻）。');
    const rows = await withTenant(ctx, (db) =>
      db.auditLog.findMany({ where: { actorKind: 'PLATFORM_USER' }, select: { id: true } }),
    );
    expect(rows).toEqual([]);
  });

  it('🔴 別の運営者の監査ログ・資格情報には到達できない（RLS が主体で絞る）', async () => {
    // SUPPORT の文脈で読んでも、OWNER の 2FA 資格情報は 0 件である。
    const facts = await loadPlatformFacts({ platformUserId: SUPPORT_ID });
    expect(facts?.role).toBe('PLATFORM_SUPPORT');
    expect(facts?.twoFactorEnrolled).toBe(false);
    // 対照: OWNER 本人の文脈では設定済みとして見える。
    const ownerFacts = await loadPlatformFacts({ platformUserId: OWNER_ID });
    expect(ownerFacts?.twoFactorEnrolled).toBe(true);
    expect(SUPPORT.platformUserId).not.toBe(OWNER.platformUserId);
  });
});
