// tests/isolation/two-factor.test.ts
// T-03-02（docs/sprints/SP-03-auth-audit-admin0.md）の完了判定:
//
//   🔴 `F-003 AC-2`「`OWNER` / `ADMIN` は 2 要素認証を未設定のまま業務データを取得できない。
//      それ以外のロールは任意設定でき、未設定でも利用できる」を **DB 付きで**実証する。
//      未設定の `OWNER` は API を直叩きしても（＝ `buildTenantCtx` → `withTenant` の
//      経路をそのまま呼んでも）**業務データを 1 件も取得できない**。
//   🔴 リカバリコードは 1 回限り（使用済みの再利用が拒否される）。
//   🔴 2FA の資格情報は本人にしか見えない（RLS の C7 SELF）。
//   🔴 シークレットは暗号化されて保存され、平文が DB にも監査ログにも現れない（CLAUDE.md §3.4）。
//
// 検証はアプリの実装（`apps/web/lib/auth/**`）をそのまま呼ぶ（T-03-01 の `auth-tenant-ctx.test.ts`
// と同じ方針）。HTTP 層を通した検証は E2E（T-03-11）が行う。
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  configureTenantDb,
  configureTokenEncryption,
  disconnectTenantDb,
  TwoFactorRequiredError,
  withTenant,
  type AuthenticatedTenantCtx,
  type TenantIdentity,
} from '@ses/db';
import { createUnextendedClient, type UnextendedClient } from '@ses/db/testing';
import { ISOLATION_SEED_IDS, runSeed } from '@ses/db/seed';
import type { AuthAttemptMeta } from '../../apps/web/lib/auth/credentials';
import { normalizeRecoveryCode } from '../../apps/web/lib/auth/recovery-codes';
import { totpCode } from '../../apps/web/lib/auth/totp';
import { buildTenantCtx } from '../../apps/web/lib/auth/tenant-context';
import { startEnrollment, verifyTwoFactorCode } from '../../apps/web/lib/auth/two-factor';
import { TWO_FACTOR_THROTTLE_POLICY } from '../../apps/web/lib/auth/two-factor-throttle';
import { startIsolationDatabase, type IsolationDatabase } from './support/postgres.js';

const SETUP_TIMEOUT_MS = 600_000;
/** 🔴 「実行日 = T」を固定する（docs/05 §17.6）。TOTP のステップもここから決まる。 */
const NOW = new Date('2026-09-03T00:00:00.000Z');

// テスト専用のダミー鍵（32 バイト）。実運用の値ではない。
const TOKEN_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString('base64');

const TENANT_1 = ISOLATION_SEED_IDS.tenants[0];
const TENANT_2 = ISOLATION_SEED_IDS.tenants[1];
const PARTNER_1_1 = TENANT_1.partners[0];

const META: AuthAttemptMeta = { deviceKind: 'api', ipAddress: '203.0.113.10' };

const HOST_1: TenantIdentity = {
  tenantId: TENANT_1.tenantId,
  partnerCompanyId: null,
  userId: TENANT_1.hostUserId,
};
const PARTNER_USER: TenantIdentity = {
  tenantId: TENANT_1.tenantId,
  partnerCompanyId: PARTNER_1_1.partnerCompanyId,
  userId: PARTNER_1_1.userId,
};

/** 登録で得た TOTP シークレット（後続の describe が正しいコードを作るために使う）。 */
let hostSecret = '';
let partnerSecret = '';
/** 発行された平文のリカバリコード（この 1 回だけ返るもの）。 */
let partnerRecoveryCodes: readonly string[] = [];

let database: IsolationDatabase;
/** 🔴 投入・前提づくり・「保存されている生の値」の確認にだけ使う特権接続。 */
let admin: UnextendedClient;

/** 認証済み ctx を作る（2FA 検証済みのセッションを想定）。 */
async function ctxOf(
  identity: TenantIdentity,
  twoFactorVerified: boolean,
): Promise<AuthenticatedTenantCtx> {
  const ctx = await buildTenantCtx({ ...identity, twoFactorVerified }, { deviceKind: 'api' });
  if (ctx === null) throw new Error('ctx を作れませんでした（前提の破綻）。');
  return ctx;
}

/**
 * 🔴 API ハンドラと**同じ経路**（ctx を作る → `withTenant` で読む）でエンジニアを引く。
 *    2FA が未充足なら ctx の生成で例外になり、`withTenant` には到達しない。
 */
async function readEngineerIds(
  identity: TenantIdentity,
  twoFactorVerified: boolean,
): Promise<readonly string[]> {
  const ctx = await ctxOf(identity, twoFactorVerified);
  const rows = await withTenant(ctx, (db) =>
    db.engineer.findMany({ select: { id: true }, orderBy: { id: 'asc' } }),
  );
  return rows.map((row) => row.id);
}

async function setHostRole(role: string): Promise<void> {
  await admin.membership.updateMany({
    where: { id: TENANT_1.hostMembershipId },
    data: { role },
  });
}

async function readStoredCredential(userId: string): Promise<{
  secretEncrypted: string;
  recoveryCodeHashes: string[];
  confirmedAt: Date | null;
} | null> {
  const row = await admin.twoFactorCredential.findFirst({
    where: { subjectId: userId, subjectType: 'USER' },
    select: { secretEncrypted: true, recoveryCodeHashes: true, confirmedAt: true },
  });
  return row;
}

function secretOf(otpauthUrl: string): string {
  const secret = new URL(otpauthUrl).searchParams.get('secret');
  if (secret === null) throw new Error('otpauth URL に secret がありません（前提の破綻）。');
  return secret;
}

async function countAudit(action: string, actorId: string): Promise<number> {
  const ctx = await ctxOf(HOST_1, true);
  return withTenant(ctx, (db) => db.auditLog.count({ where: { action, actorId } }));
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
  // 🔴 本番では `packages/config` が検証した鍵を起動時に注入する（apps/web/lib/db/bootstrap.ts）。
  configureTokenEncryption({ key: TOKEN_ENCRYPTION_KEY, keyId: 'k1' });
}, SETUP_TIMEOUT_MS);

afterAll(async () => {
  await disconnectTenantDb();
  await admin?.$disconnect();
  await database?.stop();
});

describe('🔴 F-003 AC-2: 2FA 未設定の OWNER / ADMIN は業務データを 1 件も取得できない', () => {
  it.each(['OWNER', 'ADMIN'])(
    '%s は ctx が生成されず、withTenant に到達しない（API 直叩きでも 0 件）',
    async (role) => {
      await setHostRole(role);
      try {
        let thrown: unknown = null;
        const rows = await readEngineerIds(HOST_1, false).catch((error: unknown) => {
          thrown = error;
          return null;
        });
        expect(thrown).toBeInstanceOf(TwoFactorRequiredError);
        expect((thrown as TwoFactorRequiredError).reason).toBe('SETUP_REQUIRED');
        // 🔴 「空の配列が返る」ではなく「1 行も取得できていない」。
        expect(rows).toBeNull();
      } finally {
        await setHostRole('SALES');
      }
    },
  );

  it('🔴 セッションが「検証済み」を主張していても、未設定なら通らない（DB の事実が正）', async () => {
    await setHostRole('OWNER');
    try {
      await expect(readEngineerIds(HOST_1, true)).rejects.toBeInstanceOf(TwoFactorRequiredError);
    } finally {
      await setHostRole('SALES');
    }
  });

  it('対照: SALES は 2FA 未設定でも業務データを取得できる（任意設定のロール）', async () => {
    const ids = await readEngineerIds(HOST_1, false);
    expect(ids).toContain(TENANT_1.hostEngineerId);
  });

  it('対照: パートナーの PARTNER_SALES も 2FA 未設定で利用できる（自社分のみ）', async () => {
    const ids = await readEngineerIds(PARTNER_USER, false);
    expect(ids).toEqual([PARTNER_1_1.engineerId]);
  });
});

describe('🔴 設定 → 確認 → 検証（docs/05 §6.3 #3 → #2）', () => {
  it('setup が otpauth URL とリカバリコードを返し、未確認の資格情報を作る', async () => {
    const result = await startEnrollment(HOST_1, META);
    expect(result.status).toBe('ENROLLMENT_STARTED');
    if (result.status !== 'ENROLLMENT_STARTED') return;

    hostSecret = secretOf(result.otpauthUrl);
    expect(result.recoveryCodes).toHaveLength(10);
    // ラベルは本人のメールアドレス（認証アプリでの識別のため）。
    expect(result.otpauthUrl).toContain(encodeURIComponent('host-t1@seed-isolation.test'));

    const stored = await readStoredCredential(TENANT_1.hostUserId);
    expect(stored?.confirmedAt).toBeNull();
    expect(stored?.recoveryCodeHashes).toHaveLength(10);
  });

  it('🔴 シークレットは暗号化して保存され、平文が DB に現れない（CLAUDE.md §3.4）', async () => {
    const stored = await readStoredCredential(TENANT_1.hostUserId);
    expect(stored?.secretEncrypted.startsWith('v1:k1:')).toBe(true);
    expect(stored?.secretEncrypted).not.toContain(hostSecret);
  });

  it('🔴 リカバリコードはハッシュだけが保存される（平文を持たない）', async () => {
    const stored = await readStoredCredential(TENANT_1.hostUserId);
    for (const hash of stored?.recoveryCodeHashes ?? []) {
      expect(hash.startsWith('$argon2id$')).toBe(true);
    }
  });

  it('誤ったコードでは確認が成立しない（未確認のまま）', async () => {
    const result = await verifyTwoFactorCode(HOST_1, '000000', META, NOW);
    expect(result).toEqual({ outcome: 'REJECTED' });
    const stored = await readStoredCredential(TENANT_1.hostUserId);
    expect(stored?.confirmedAt).toBeNull();
  });

  it('正しい TOTP で登録が確定する（confirmedAt が入る）', async () => {
    const result = await verifyTwoFactorCode(HOST_1, totpCode(hostSecret, NOW), META, NOW);
    expect(result).toEqual({ outcome: 'ENROLLED' });
    const stored = await readStoredCredential(TENANT_1.hostUserId);
    expect(stored?.confirmedAt).not.toBeNull();
  });

  it('🔴 設定済みでも、このセッションが未検証なら業務データに到達できない', async () => {
    let thrown: unknown = null;
    const rows = await readEngineerIds(HOST_1, false).catch((error: unknown) => {
      thrown = error;
      return null;
    });
    expect(thrown).toBeInstanceOf(TwoFactorRequiredError);
    expect((thrown as TwoFactorRequiredError).reason).toBe('VERIFICATION_REQUIRED');
    expect(rows).toBeNull();
  });

  it('検証済みのセッションなら業務データに到達できる', async () => {
    const ids = await readEngineerIds(HOST_1, true);
    expect(ids).toContain(TENANT_1.hostEngineerId);
  });

  it('🔴 OWNER に戻しても、設定済み + 検証済みなら通る（AC-2 の裏返し）', async () => {
    await setHostRole('OWNER');
    try {
      const ids = await readEngineerIds(HOST_1, true);
      expect(ids).toContain(TENANT_1.hostEngineerId);
    } finally {
      await setHostRole('SALES');
    }
  });

  it('確認済みの資格情報は setup で上書きされない（ALREADY_ENROLLED）', async () => {
    const before = await readStoredCredential(TENANT_1.hostUserId);
    const result = await startEnrollment(HOST_1, META);
    expect(result.status).toBe('ALREADY_ENROLLED');
    const after = await readStoredCredential(TENANT_1.hostUserId);
    // 🔴 シークレットもリカバリコードも変わっていない（＝ 認証器を差し替えられない）。
    expect(after?.secretEncrypted).toBe(before?.secretEncrypted);
    expect(after?.recoveryCodeHashes).toEqual(before?.recoveryCodeHashes);
    expect(after?.confirmedAt).toEqual(before?.confirmedAt);
  });

  it('確認済みの資格情報に対して TOTP の検証が成立する', async () => {
    const result = await verifyTwoFactorCode(HOST_1, totpCode(hostSecret, NOW), META, NOW);
    expect(result).toEqual({ outcome: 'VERIFIED', method: 'TOTP' });
  });
});

describe('🔴 リカバリコードは 1 回限り（完了条件）', () => {
  it('パートナー所属の利用者も 2FA を設定できる', async () => {
    const result = await startEnrollment(PARTNER_USER, META);
    expect(result.status).toBe('ENROLLMENT_STARTED');
    if (result.status !== 'ENROLLMENT_STARTED') return;
    partnerRecoveryCodes = result.recoveryCodes;
    partnerSecret = secretOf(result.otpauthUrl);
    const confirmed = await verifyTwoFactorCode(PARTNER_USER, totpCode(partnerSecret, NOW), META, NOW);
    expect(confirmed).toEqual({ outcome: 'ENROLLED' });
  });

  it('リカバリコードで検証できる（残数が 1 つ減る）', async () => {
    const result = await verifyTwoFactorCode(PARTNER_USER, partnerRecoveryCodes[0] as string, META, NOW);
    expect(result).toEqual({ outcome: 'VERIFIED', method: 'RECOVERY_CODE' });
    const stored = await readStoredCredential(PARTNER_1_1.userId);
    expect(stored?.recoveryCodeHashes).toHaveLength(9);
  });

  it('🔴 同じリカバリコードは 2 回目に拒否される（使い捨て）', async () => {
    const result = await verifyTwoFactorCode(PARTNER_USER, partnerRecoveryCodes[0] as string, META, NOW);
    expect(result).toEqual({ outcome: 'REJECTED' });
    const stored = await readStoredCredential(PARTNER_1_1.userId);
    // 拒否されただけで、残りが減っていない。
    expect(stored?.recoveryCodeHashes).toHaveLength(9);
  });

  it('別のリカバリコードは使える（消費されるのは 1 件ずつ）', async () => {
    const result = await verifyTwoFactorCode(PARTNER_USER, partnerRecoveryCodes[1] as string, META, NOW);
    expect(result).toEqual({ outcome: 'VERIFIED', method: 'RECOVERY_CODE' });
    const stored = await readStoredCredential(PARTNER_1_1.userId);
    expect(stored?.recoveryCodeHashes).toHaveLength(8);
  });

  it('🔴 保存されたハッシュに平文のリカバリコードが現れない', async () => {
    const stored = await readStoredCredential(PARTNER_1_1.userId);
    const joined = (stored?.recoveryCodeHashes ?? []).join('|');
    for (const code of partnerRecoveryCodes) {
      expect(joined).not.toContain(normalizeRecoveryCode(code));
    }
  });

  it('未設定の利用者の検証は NOT_ENROLLED（設定が先である）', async () => {
    const other: TenantIdentity = {
      tenantId: TENANT_2.tenantId,
      partnerCompanyId: null,
      userId: TENANT_2.hostUserId,
    };
    const result = await verifyTwoFactorCode(other, '123456', META, NOW);
    expect(result).toEqual({ outcome: 'NOT_ENROLLED' });
  });
});

describe('🔴 2FA の資格情報は本人にしか見えない（RLS の C7 SELF）', () => {
  it('自分の行は 1 件だけ見える（同じテナントに他人の行があっても増えない）', async () => {
    const ctx = await ctxOf(HOST_1, true);
    const count = await withTenant(ctx, (db) => db.twoFactorCredential.count());
    expect(count).toBe(1);
  });

  it('🔴 他人（同一テナント・パートナー所属）の行は ID を指定しても 0 件', async () => {
    const ctx = await ctxOf(HOST_1, true);
    const found = await withTenant(ctx, (db) =>
      db.twoFactorCredential.findFirst({
        where: { subjectId: PARTNER_1_1.userId },
        select: { id: true },
      }),
    );
    expect(found).toBeNull();
  });

  it('🔴 他テナントの利用者からは 1 件も見えない', async () => {
    const ctx = await ctxOf(
      { tenantId: TENANT_2.tenantId, partnerCompanyId: null, userId: TENANT_2.hostUserId },
      false,
    );
    const count = await withTenant(ctx, (db) => db.twoFactorCredential.count());
    expect(count).toBe(0);
  });
});

describe('🔴 2FA の設定・確認・失敗が監査ログに残る（CLAUDE.md §3.5 / F-003 AC-3）', () => {
  it.each([
    'auth.2fa.setup_started',
    'auth.2fa.enabled',
    'auth.2fa.verified',
    'auth.2fa.failed',
  ])('%s が記録されている', async (action) => {
    expect(await countAudit(action, TENANT_1.hostUserId)).toBeGreaterThan(0);
  });

  it('パートナーのリカバリコード使用も記録される（ホストから見える。C1 INSERT / C2 SELECT）', async () => {
    expect(await countAudit('auth.2fa.recovery_used', PARTNER_1_1.userId)).toBe(2);
  });

  it('🔴 summary にシークレット・コードが入らない（件数と種別だけ）', async () => {
    const ctx = await ctxOf(HOST_1, true);
    const rows = await withTenant(ctx, (db) =>
      db.auditLog.findMany({
        where: { actorId: TENANT_1.hostUserId, action: { startsWith: 'auth.2fa.' } },
        select: { action: true, summary: true, deviceKind: true, ipAddress: true },
      }),
    );
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      const summary = row.summary as Record<string, unknown>;
      expect(Object.keys(summary).every((key) => [
            'reason',
            'method',
            'recoveryCodeCount',
            'remainingRecoveryCodes',
            'failures',
            'retryAfterSeconds',
          ].includes(key))).toBe(true);
      expect(JSON.stringify(summary)).not.toContain('v1:k1:');
      expect(row.deviceKind).toBe('api');
      expect(row.ipAddress).toBe('203.0.113.10');
    }
  });
});

describe('🔴 検証試行のスロットル（docs/04 §S-001。総当たりを許さない）', () => {
  // 🔴 この describe だけ実時刻を使う。失敗の時刻を打つのは **DB の now()** であり、
  //    固定した NOW（他の describe が TOTP の決定性のために使う値）と混ぜると
  //    「窓」の意味が壊れるため（本番ではどちらも実時刻で一致する）。
  const at = (): Date => new Date();

  /** 失敗を `count` 回積む。🔴 いずれも実装の経路（`verifyTwoFactorCode`）を通す。 */
  async function pushFailures(identity: TenantIdentity, count: number): Promise<void> {
    for (let index = 0; index < count; index += 1) {
      const result = await verifyTwoFactorCode(identity, '000000', META, at());
      expect(result).toEqual({ outcome: 'REJECTED' });
    }
  }

  /** 監査ログの失敗行を窓の外へずらす（superuser でのテスト前提づくり）。 */
  async function backdateFailures(actorId: string, minutesAgo: number): Promise<void> {
    await admin.auditLog.updateMany({
      where: { action: 'auth.2fa.failed', actorId },
      data: { createdAt: new Date(Date.now() - minutesAgo * 60_000) },
    });
  }

  it('🔴 5 回失敗した後は、**正しい TOTP でも**検証せずに拒否する', async () => {
    // 直前までの失敗を窓の外へ出し、この試験の母集団を 5 件に確定させる。
    await backdateFailures(TENANT_1.hostUserId, 60);
    await pushFailures(HOST_1, TWO_FACTOR_THROTTLE_POLICY.maxFailures);

    const now = at();
    const result = await verifyTwoFactorCode(HOST_1, totpCode(hostSecret, now), META, now);
    expect(result.outcome).toBe('THROTTLED');
    if (result.outcome !== 'THROTTLED') return;
    expect(result.retryAfterSeconds).toBeGreaterThan(0);
    expect(result.retryAfterSeconds).toBeLessThanOrEqual(
      TWO_FACTOR_THROTTLE_POLICY.windowMinutes * 60,
    );
  });

  it('拒否は auth.2fa.throttled として記録される（失敗そのものとは別の action）', async () => {
    expect(await countAudit('auth.2fa.throttled', TENANT_1.hostUserId)).toBeGreaterThan(0);
  });

  it('🔴 ロック中の拒否は窓を延ばさない（自己増殖するロックを作らない）', async () => {
    const before = await countAudit('auth.2fa.failed', TENANT_1.hostUserId);
    await verifyTwoFactorCode(HOST_1, '000000', META, at());
    expect(await countAudit('auth.2fa.failed', TENANT_1.hostUserId)).toBe(before);
  });

  it('🔴 窓外（15 分より前）の失敗は数えない — 古い失敗で締め出されない', async () => {
    await backdateFailures(TENANT_1.hostUserId, 20);
    const now = at();
    const result = await verifyTwoFactorCode(HOST_1, totpCode(hostSecret, now), META, now);
    expect(result).toEqual({ outcome: 'VERIFIED', method: 'TOTP' });
  });

  it('🔴 パートナー所属の利用者にも同じように効く（audit_logs が C2 でも数えられている）', async () => {
    // 🔴 ここが回帰の要点: パートナー文脈で監査ログを数えると常に 0 件になり、
    //    スロットルが「静かに存在しない」状態になりうる（CLAUDE.md §1.2 の主利用者）。
    await backdateFailures(PARTNER_1_1.userId, 60);
    await pushFailures(PARTNER_USER, TWO_FACTOR_THROTTLE_POLICY.maxFailures);

    const now = at();
    const result = await verifyTwoFactorCode(PARTNER_USER, totpCode(partnerSecret, now), META, now);
    expect(result.outcome).toBe('THROTTLED');
    expect(await countAudit('auth.2fa.throttled', PARTNER_1_1.userId)).toBeGreaterThan(0);
  });

  it('🔴 スロットル中はリカバリコードの照合も行われない（残数が減らない）', async () => {
    const before = await readStoredCredential(PARTNER_1_1.userId);
    const result = await verifyTwoFactorCode(
      PARTNER_USER,
      partnerRecoveryCodes[2] as string,
      META,
      at(),
    );
    expect(result.outcome).toBe('THROTTLED');
    const after = await readStoredCredential(PARTNER_1_1.userId);
    expect(after?.recoveryCodeHashes).toEqual(before?.recoveryCodeHashes);
  });
});
