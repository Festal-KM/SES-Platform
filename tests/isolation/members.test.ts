// tests/isolation/members.test.ts
// 🔴 SP-04 T-04-09 の完了判定を **DB + RLS 付きで**実証する（`F-002 AC-3` / `AC-4`）:
//
//   AC-4 `PARTNER_ADMIN` は自社（自パートナー企業）配下のアカウントのみ招待・変更でき、
//        **他社および自社（ホスト）のアカウントは一覧にも現れない**
//        （🔴 母集団を絞るのは `memberships` の RLS（C5）であり、アプリ側の `where` ではない）
//   AC-3 ロールの変更・無効化が、実施者・対象・**変更前後のロール**・日時とともに監査ログに残る
//
// 🔴 検証は `withApiRoute` が組み立てた**実物の Route Handler** に `Request` を渡して行う
//    （`partner-companies.test.ts` と同じ方針）。差し替えるのは `requireTenantCtx` の 1 点だけで、
//    その戻り値も `buildTenantCtx` が実 DB から確定した ctx である。
//
// 🔴 「無効化が効いている」ことは、**`buildTenantCtx` が ctx を作れなくなる**ことで確かめる
//    （画面の導線が消えることではない。`F-004 AC-9`「API を直接呼んでも拒否される」と同じ考え方）。
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  configureTenantDb,
  disconnectTenantDb,
  type AuthenticatedTenantCtx,
  type TenantIdentity,
  type TenantRole,
} from '@ses/db';
import { createUnextendedClient, type UnextendedClient } from '@ses/db/testing';
import { ISOLATION_SEED_IDS, runSeed } from '@ses/db/seed';
import { startIsolationDatabase, type IsolationDatabase } from './support/postgres.js';

const SETUP_TIMEOUT_MS = 600_000;
/** 🔴 「実行日 = T」を固定する（docs/05 §17.6）。 */
const NOW = new Date('2026-09-03T00:00:00.000Z');
const META = { deviceKind: 'api', ipAddress: '203.0.113.10' } as const;

const requireTenantCtxMock = vi.fn<() => Promise<AuthenticatedTenantCtx>>();

vi.mock('../../apps/web/lib/auth/session', () => ({
  requireTenantCtx: () => requireTenantCtxMock(),
  readRequestMeta: async () => META,
}));

const { buildTenantCtx } = await import('../../apps/web/lib/auth/tenant-context');
const { configureAccountMailQueue, PendingAccountMailQueue } = await import(
  '../../apps/web/lib/jobs/account-mail'
);
const { issueInvitation } = await import('../../apps/web/lib/invitations/service');
const { INVITE_URL_NOT_DISCLOSED } = await import('../../apps/web/lib/invitations/invite-link');
const { evaluateSendingDomain } = await import('../../apps/web/lib/settings/sending-domains');
const membersRoute = await import('../../apps/web/app/api/(main)/members/route');
const memberRoleRoute = await import('../../apps/web/app/api/(main)/members/[id]/role/route');
const memberRevokeRoute = await import('../../apps/web/app/api/(main)/members/[id]/revoke/route');

/** `sandbox` / `demo` / `development` 相当（`docs/03` §3.2.7 規律 4・5）。 */
const NOT_REQUIRED_RUNTIME = { region: 'ap-northeast-1', verificationRequired: false } as const;
/** `production` / `staging` 相当（同 規律 1・3）。 */
const REQUIRED_RUNTIME = { region: 'ap-northeast-1', verificationRequired: true } as const;

const TENANT_1 = ISOLATION_SEED_IDS.tenants[0];
const TENANT_2 = ISOLATION_SEED_IDS.tenants[1];
const PARTNER_1_1 = TENANT_1.partners[0];
const PARTNER_1_2 = TENANT_1.partners[1];

const HOST_1: TenantIdentity = {
  tenantId: TENANT_1.tenantId,
  partnerCompanyId: null,
  userId: TENANT_1.hostUserId,
};
const HOST_1_OWNER: TenantIdentity = {
  tenantId: TENANT_1.tenantId,
  partnerCompanyId: null,
  userId: TENANT_1.hostOwnerUserId,
};
const PARTNER_USER_1: TenantIdentity = {
  tenantId: TENANT_1.tenantId,
  partnerCompanyId: PARTNER_1_1.partnerCompanyId,
  userId: PARTNER_1_1.userId,
};

/** 🔴 テストが作る「同じ取引先の 2 人目」（seed は各社 1 名しか置かない）。 */
const EXTRA_PARTNER_USER_ID = '01930000-0000-7000-8000-0000000f0001';
const EXTRA_PARTNER_MEMBERSHIP_ID = '01930000-0000-7000-8000-0000000f0002';
const EXTRA_HOST_USER_ID = '01930000-0000-7000-8000-0000000f0003';
const EXTRA_HOST_MEMBERSHIP_ID = '01930000-0000-7000-8000-0000000f0004';
/** 実在しない ID（境界外の ID と応答が一致することの比較対象。docs/05 §4.8）。 */
const NONEXISTENT_ID = '01930000-0000-7000-8000-00000000ffff';

const EXTRA_PARTNER_EMAIL = 'extra-partner@t0409.example';
const EXTRA_HOST_EMAIL = 'extra-host@t0409.example';

type MemberItem = {
  readonly id: string;
  readonly userId: string;
  readonly email: string;
  readonly role: string;
  readonly partnerCompanyId: string | null;
  readonly status: string;
};
type MemberListBody = { readonly items: readonly MemberItem[]; readonly total: number };
type ErrorBody = { readonly error: { readonly code: string; readonly messageKey: string } };

let database: IsolationDatabase;
/** 🔴 前提づくりと事実確認だけに使う特権接続。検証のクエリには使わない。 */
let admin: UnextendedClient;
let mail: InstanceType<typeof PendingAccountMailQueue>;

async function setRole(identity: TenantIdentity, role: TenantRole): Promise<void> {
  await admin.membership.updateMany({
    where: { tenantId: identity.tenantId, userId: identity.userId },
    data: { role },
  });
}

async function enrollTwoFactor(userId: string, tenantId: string): Promise<void> {
  const existing = await admin.twoFactorCredential.findFirst({
    where: { subjectId: userId, subjectType: 'USER' },
    select: { id: true },
  });
  if (existing !== null) return;
  await admin.twoFactorCredential.create({
    data: {
      subjectType: 'USER',
      subjectId: userId,
      tenantId,
      secretEncrypted: 'test:not-a-real-secret',
      recoveryCodeHashes: [],
      confirmedAt: NOW,
    },
  });
}

async function ctxOf(identity: TenantIdentity, role: TenantRole): Promise<AuthenticatedTenantCtx> {
  await setRole(identity, role);
  const ctx = await buildTenantCtx({ ...identity, twoFactorVerified: true }, { deviceKind: 'api' });
  if (ctx === null) throw new Error('ctx を作れませんでした（前提の破綻）。');
  return ctx;
}

async function listMembers(ctx: AuthenticatedTenantCtx): Promise<Response> {
  requireTenantCtxMock.mockResolvedValue(ctx);
  return membersRoute.GET(new Request('https://app.test/api/members'));
}

async function changeRole(
  ctx: AuthenticatedTenantCtx,
  membershipId: string,
  role: TenantRole,
): Promise<Response> {
  requireTenantCtxMock.mockResolvedValue(ctx);
  return memberRoleRoute.PUT(
    new Request(`https://app.test/api/members/${membershipId}/role`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ role }),
    }),
    { params: Promise.resolve({ id: membershipId }) },
  );
}

async function revoke(ctx: AuthenticatedTenantCtx, membershipId: string): Promise<Response> {
  requireTenantCtxMock.mockResolvedValue(ctx);
  return memberRevokeRoute.POST(
    new Request(`https://app.test/api/members/${membershipId}/revoke`, { method: 'POST' }),
    { params: Promise.resolve({ id: membershipId }) },
  );
}

async function auditRows(action: string) {
  return admin.auditLog.findMany({
    where: { action },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
  });
}

/** 🔴 前提づくり: 同じ取引先の 2 人目と、ホストの 3 人目（対象にできる相手を用意する）。 */
async function createExtraAccounts(): Promise<void> {
  await admin.user.createMany({
    data: [
      {
        id: EXTRA_PARTNER_USER_ID,
        tenantId: TENANT_1.tenantId,
        ownerPartnerCompanyId: PARTNER_1_1.partnerCompanyId,
        email: EXTRA_PARTNER_EMAIL,
        displayName: '架空 二郎',
        passwordHash: 'test:not-a-real-hash',
      },
      {
        id: EXTRA_HOST_USER_ID,
        tenantId: TENANT_1.tenantId,
        ownerPartnerCompanyId: null,
        email: EXTRA_HOST_EMAIL,
        displayName: '仮名 三郎',
        passwordHash: 'test:not-a-real-hash',
      },
    ],
  });
  await admin.membership.createMany({
    data: [
      {
        id: EXTRA_PARTNER_MEMBERSHIP_ID,
        tenantId: TENANT_1.tenantId,
        userId: EXTRA_PARTNER_USER_ID,
        role: 'PARTNER_SALES',
        partnerCompanyId: PARTNER_1_1.partnerCompanyId,
        joinedAt: NOW,
      },
      {
        id: EXTRA_HOST_MEMBERSHIP_ID,
        tenantId: TENANT_1.tenantId,
        userId: EXTRA_HOST_USER_ID,
        role: 'SALES',
        partnerCompanyId: null,
        joinedAt: NOW,
      },
    ],
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

  // 🔴 `OWNER` / `ADMIN` は 2FA 必須（`BR-30` / `F-003 AC-2`）。未設定だと `resolveTenantCtx` が
  //    ctx を作らないため、それらのロールを使うテストの前提として登録しておく。
  await enrollTwoFactor(TENANT_1.hostUserId, TENANT_1.tenantId);
  await enrollTwoFactor(TENANT_1.hostOwnerUserId, TENANT_1.tenantId);
  await enrollTwoFactor(TENANT_2.hostUserId, TENANT_2.tenantId);
  await createExtraAccounts();
}, SETUP_TIMEOUT_MS);

afterAll(async () => {
  await disconnectTenantDb();
  await admin?.$disconnect();
  await database?.stop();
});

beforeEach(() => {
  requireTenantCtxMock.mockReset();
  mail = new PendingAccountMailQueue();
  configureAccountMailQueue(mail);
});

afterEach(async () => {
  // 🔴 テスト間で前提を持ち越さない（ロール・無効化・追加した行を戻す）。
  await setRole(HOST_1, 'SALES');
  await setRole(HOST_1_OWNER, 'OWNER');
  await setRole(PARTNER_USER_1, 'PARTNER_SALES');
  // 🔴 **`hostOwner` の無効化も戻す**（iteration 3）。並行 revoke のテストは
  //    「どちらが勝つか」が非決定的であり、`hostOwner` 側が勝つと `Membership.revokedAt` と
  //    `User.disabledAt` が立ったまま次のテストへ持ち越される。`setRole` はロールしか戻さないため、
  //    ここを落とすと**後続の `OWNER` 前提のテストが実行順・タイミング依存で落ちる**。
  await admin.membership.updateMany({
    where: {
      id: {
        in: [
          EXTRA_PARTNER_MEMBERSHIP_ID,
          EXTRA_HOST_MEMBERSHIP_ID,
          TENANT_1.hostOwnerMembershipId,
        ],
      },
    },
    data: { revokedAt: null },
  });
  await admin.membership.updateMany({
    where: { id: EXTRA_PARTNER_MEMBERSHIP_ID },
    data: { role: 'PARTNER_SALES' },
  });
  await admin.membership.updateMany({
    where: { id: EXTRA_HOST_MEMBERSHIP_ID },
    data: { role: 'SALES' },
  });
  await admin.user.updateMany({
    where: {
      id: { in: [EXTRA_PARTNER_USER_ID, EXTRA_HOST_USER_ID, TENANT_1.hostOwnerUserId] },
    },
    data: { disabledAt: null },
  });
  await admin.invitation.deleteMany({ where: { email: { contains: '@t0409invite.example' } } });
  await admin.auditLog.deleteMany({
    where: { action: { in: ['membership.role_change', 'membership.revoke', 'invitation.create'] } },
  });
});

describe('🔴 F-002 AC-4: 一覧の母集団は RLS（C5）が決める', () => {
  it('ホストにはテナント内の全所属が出る（自社社員 + 各取引先の配下。対照）', async () => {
    const response = await listMembers(await ctxOf(HOST_1, 'ADMIN'));
    const body = (await response.json()) as MemberListBody;

    expect(response.status).toBe(200);
    // seed: ホスト 2 名 + 各取引先 1 名（2 社）+ 本テストが足した 2 名 = 6。
    expect(body.total).toBe(6);
    expect(body.items.filter((item) => item.partnerCompanyId === null)).toHaveLength(3);
    expect(
      body.items.filter((item) => item.partnerCompanyId === PARTNER_1_2.partnerCompanyId),
    ).toHaveLength(1);
  });

  it('🔴 PARTNER_ADMIN には自社配下だけが出る（他社もホストも 1 行も現れない）', async () => {
    const hostUser = await admin.user.findFirst({
      where: { id: TENANT_1.hostOwnerUserId },
      select: { email: true, displayName: true },
    });
    const otherPartnerUser = await admin.user.findFirst({
      where: { id: PARTNER_1_2.userId },
      select: { email: true, displayName: true },
    });

    const response = await listMembers(await ctxOf(PARTNER_USER_1, 'PARTNER_ADMIN'));
    const raw = await response.text();
    const body = JSON.parse(raw) as MemberListBody;

    expect(response.status).toBe(200);
    // 🔴 「件数にも現れない」。自社の 2 名（seed 1 + 追加 1）だけが数えられている。
    expect(body.total).toBe(2);
    expect(body.items.every((item) => item.partnerCompanyId === PARTNER_1_1.partnerCompanyId)).toBe(
      true,
    );
    // 🔴 応答の生文字列に、ホスト社員と他社の識別子・氏名・メールが 1 度も現れない。
    for (const forbidden of [
      TENANT_1.hostOwnerUserId,
      TENANT_1.hostUserId,
      PARTNER_1_2.userId,
      PARTNER_1_2.partnerCompanyId,
      hostUser?.email ?? '__missing__',
      hostUser?.displayName ?? '__missing__',
      otherPartnerUser?.email ?? '__missing__',
      EXTRA_HOST_EMAIL,
    ]) {
      expect(raw).not.toContain(forbidden);
    }
  });

  it('🔴 他テナントの所属は 1 行も現れない（テナント越境が無い）', async () => {
    const response = await listMembers(
      await ctxOf(
        { tenantId: TENANT_2.tenantId, partnerCompanyId: null, userId: TENANT_2.hostUserId },
        'ADMIN',
      ),
    );
    const raw = await response.text();

    expect(raw).not.toContain(TENANT_1.hostUserId);
    expect(raw).not.toContain(PARTNER_1_1.userId);
    expect(raw).not.toContain(EXTRA_PARTNER_EMAIL);
  });

  it.each(['SALES', 'VIEWER'] as const)(
    '🔴 ホストの %s は一覧を取得できない（403。氏名とメールを見せる理由が無い）',
    async (role) => {
      const response = await listMembers(await ctxOf(HOST_1, role));
      expect(response.status).toBe(403);
    },
  );

  it('🔴 PARTNER_SALES は一覧を取得できない（403）', async () => {
    const response = await listMembers(await ctxOf(PARTNER_USER_1, 'PARTNER_SALES'));
    expect(response.status).toBe(403);
  });
});

describe('🔴 F-002 AC-4: ロール変更の射程', () => {
  it('PARTNER_ADMIN は自社配下のロールを変更できる', async () => {
    const response = await changeRole(
      await ctxOf(PARTNER_USER_1, 'PARTNER_ADMIN'),
      EXTRA_PARTNER_MEMBERSHIP_ID,
      'PARTNER_ADMIN',
    );

    expect(response.status).toBe(204);
    const row = await admin.membership.findFirst({ where: { id: EXTRA_PARTNER_MEMBERSHIP_ID } });
    expect(row?.role).toBe('PARTNER_ADMIN');
    // 🔴 所属は動かない（第二境界の破壊を伴う変更を作らない）。
    expect(row?.partnerCompanyId).toBe(PARTNER_1_1.partnerCompanyId);
  });

  it('🔴 PARTNER_ADMIN はホストの所属を変更できない（404。一覧にも出ない ＝ 存在しない）', async () => {
    const ctx = await ctxOf(PARTNER_USER_1, 'PARTNER_ADMIN');

    const crossScope = await changeRole(ctx, EXTRA_HOST_MEMBERSHIP_ID, 'PARTNER_SALES');
    const missing = await changeRole(ctx, NONEXISTENT_ID, 'PARTNER_SALES');

    expect(crossScope.status).toBe(404);
    expect(await crossScope.json()).toEqual(await missing.json());
    expect(
      (await admin.membership.findFirst({ where: { id: EXTRA_HOST_MEMBERSHIP_ID } }))?.role,
    ).toBe('SALES');
  });

  it('🔴 PARTNER_ADMIN は他社の所属を変更できない（404）', async () => {
    const response = await changeRole(
      await ctxOf(PARTNER_USER_1, 'PARTNER_ADMIN'),
      PARTNER_1_2.membershipId,
      'PARTNER_ADMIN',
    );

    expect(response.status).toBe(404);
    expect(
      (await admin.membership.findFirst({ where: { id: PARTNER_1_2.membershipId } }))?.role,
    ).toBe('PARTNER_SALES');
  });

  it('🔴 他テナントの所属を変更できない（404）', async () => {
    const response = await changeRole(
      await ctxOf(PARTNER_USER_1, 'PARTNER_ADMIN'),
      TENANT_2.partners[0].membershipId,
      'PARTNER_ADMIN',
    );
    expect(response.status).toBe(404);
  });

  it('🔴 ホストの ADMIN は取引先配下のロールを変更できない（403。行は見えるが書けない）', async () => {
    const response = await changeRole(
      await ctxOf(HOST_1, 'ADMIN'),
      EXTRA_PARTNER_MEMBERSHIP_ID,
      'PARTNER_ADMIN',
    );

    expect(response.status).toBe(403);
    expect(((await response.json()) as ErrorBody).error.code).toBe('MEMBER_OUT_OF_SCOPE');
    expect(
      (await admin.membership.findFirst({ where: { id: EXTRA_PARTNER_MEMBERSHIP_ID } }))?.role,
    ).toBe('PARTNER_SALES');
  });

  it('🔴 パートナー配下にホストロールを付与できない（422）', async () => {
    const response = await changeRole(
      await ctxOf(PARTNER_USER_1, 'PARTNER_ADMIN'),
      EXTRA_PARTNER_MEMBERSHIP_ID,
      'ADMIN',
    );

    expect(response.status).toBe(422);
    expect(((await response.json()) as ErrorBody).error.code).toBe('MEMBER_ROLE_NOT_ASSIGNABLE');
    expect(
      (await admin.membership.findFirst({ where: { id: EXTRA_PARTNER_MEMBERSHIP_ID } }))?.role,
    ).toBe('PARTNER_SALES');
  });

  it('🔴 自分自身のロールは変更できない（422）', async () => {
    const response = await changeRole(
      await ctxOf(PARTNER_USER_1, 'PARTNER_ADMIN'),
      PARTNER_1_1.membershipId,
      'PARTNER_SALES',
    );

    expect(response.status).toBe(422);
    expect(((await response.json()) as ErrorBody).error.code).toBe('MEMBER_SELF_MANAGEMENT');
  });

  it('🔴 最後の OWNER は降格できない（422。テナントが管理不能にならない）', async () => {
    const response = await changeRole(
      await ctxOf(HOST_1, 'ADMIN'),
      TENANT_1.hostOwnerMembershipId,
      'ADMIN',
    );

    expect(response.status).toBe(422);
    expect(((await response.json()) as ErrorBody).error.code).toBe('MEMBER_LAST_OWNER');
    expect(
      (await admin.membership.findFirst({ where: { id: TENANT_1.hostOwnerMembershipId } }))?.role,
    ).toBe('OWNER');
  });

  it.each(['SALES', 'VIEWER', 'PARTNER_SALES'] as const)(
    '🔴 %s はロールを変更できない（403）',
    async (role) => {
      const identity = role === 'PARTNER_SALES' ? PARTNER_USER_1 : HOST_1;
      const target =
        role === 'PARTNER_SALES' ? EXTRA_PARTNER_MEMBERSHIP_ID : EXTRA_HOST_MEMBERSHIP_ID;
      const response = await changeRole(await ctxOf(identity, role), target, 'ADMIN');
      expect(response.status).toBe(403);
    },
  );
});

describe('🔴 F-002 AC-3: ロール変更・無効化が監査ログに残る', () => {
  it('変更前後のロール・実施者・対象・日時が `membership.role_change` に残る', async () => {
    await changeRole(
      await ctxOf(PARTNER_USER_1, 'PARTNER_ADMIN'),
      EXTRA_PARTNER_MEMBERSHIP_ID,
      'PARTNER_ADMIN',
    );

    const rows = await auditRows('membership.role_change');
    expect(rows).toHaveLength(1);
    expect(rows[0]?.tenantId).toBe(TENANT_1.tenantId);
    expect(rows[0]?.actorKind).toBe('USER');
    expect(rows[0]?.actorId).toBe(PARTNER_1_1.userId);
    expect(rows[0]?.targetType).toBe('Membership');
    expect(rows[0]?.targetId).toBe(EXTRA_PARTNER_MEMBERSHIP_ID);
    expect(rows[0]?.summary).toMatchObject({
      targetUserId: EXTRA_PARTNER_USER_ID,
      beforeRole: 'PARTNER_SALES',
      afterRole: 'PARTNER_ADMIN',
      partnerScoped: true,
    });
    expect(rows[0]?.createdAt).toBeInstanceOf(Date);
    // 🔴 氏名・メールアドレス（PII）を載せない（docs/05 §16.2）。
    expect(JSON.stringify(rows[0]?.summary)).not.toContain('@');
  });

  it('無効化が `membership.revoke` に残る', async () => {
    await revoke(await ctxOf(PARTNER_USER_1, 'PARTNER_ADMIN'), EXTRA_PARTNER_MEMBERSHIP_ID);

    const rows = await auditRows('membership.revoke');
    expect(rows).toHaveLength(1);
    expect(rows[0]?.targetId).toBe(EXTRA_PARTNER_MEMBERSHIP_ID);
    expect(rows[0]?.summary).toMatchObject({
      targetUserId: EXTRA_PARTNER_USER_ID,
      beforeRole: 'PARTNER_SALES',
    });
  });

  it('🔴 action は `S-041` の「権限変更」カテゴリのものである（記録されるのに検索で出ない状態にしない）', async () => {
    const { auditLogCategoryWhere } = await import('../../apps/web/lib/audit-logs/categories');
    const where = auditLogCategoryWhere('PERMISSION_CHANGE');
    expect(where).toEqual({ action: { in: ['membership.role_change', 'membership.revoke'] } });
  });

  it('🔴 拒否された操作は監査ログを残さない（記録が「試み」で汚れない）', async () => {
    await changeRole(await ctxOf(HOST_1, 'ADMIN'), EXTRA_PARTNER_MEMBERSHIP_ID, 'PARTNER_ADMIN');
    await revoke(await ctxOf(HOST_1, 'ADMIN'), EXTRA_PARTNER_MEMBERSHIP_ID);

    expect(await auditRows('membership.role_change')).toEqual([]);
    expect(await auditRows('membership.revoke')).toEqual([]);
  });

  it('🔴 同じロールへの変更は何も起こさず、監査ログも残さない（冪等）', async () => {
    const response = await changeRole(
      await ctxOf(PARTNER_USER_1, 'PARTNER_ADMIN'),
      EXTRA_PARTNER_MEMBERSHIP_ID,
      'PARTNER_SALES',
    );

    expect(response.status).toBe(204);
    expect(await auditRows('membership.role_change')).toEqual([]);
  });
});

describe('🔴 F-002 AC-4: 無効化はアカウントを止め、データを消さない', () => {
  it('Membership.revokedAt と User.disabledAt の両方が立ち、行は 1 件も消えない', async () => {
    const before = {
      engineers: await admin.engineer.count({
        where: { ownerPartnerCompanyId: PARTNER_1_1.partnerCompanyId },
      }),
      proposals: await admin.proposal.count({
        where: { ownerPartnerCompanyId: PARTNER_1_1.partnerCompanyId },
      }),
      users: await admin.user.count({ where: { tenantId: TENANT_1.tenantId } }),
    };

    const response = await revoke(
      await ctxOf(PARTNER_USER_1, 'PARTNER_ADMIN'),
      EXTRA_PARTNER_MEMBERSHIP_ID,
    );
    expect(response.status).toBe(204);

    expect(
      (await admin.membership.findFirst({ where: { id: EXTRA_PARTNER_MEMBERSHIP_ID } }))?.revokedAt,
    ).not.toBeNull();
    // 🔴 サインインの経路も塞ぐ（`revokedAt` だけでは資格情報照合が通り続ける）。
    expect(
      (await admin.user.findFirst({ where: { id: EXTRA_PARTNER_USER_ID } }))?.disabledAt,
    ).not.toBeNull();

    expect(
      await admin.engineer.count({ where: { ownerPartnerCompanyId: PARTNER_1_1.partnerCompanyId } }),
    ).toBe(before.engineers);
    expect(
      await admin.proposal.count({ where: { ownerPartnerCompanyId: PARTNER_1_1.partnerCompanyId } }),
    ).toBe(before.proposals);
    expect(await admin.user.count({ where: { tenantId: TENANT_1.tenantId } })).toBe(before.users);
  });

  it('🔴 無効化された利用者は認証コンテキストを作れなくなる（既存セッションが素通りしない）', async () => {
    const identity: TenantIdentity = {
      tenantId: TENANT_1.tenantId,
      partnerCompanyId: PARTNER_1_1.partnerCompanyId,
      userId: EXTRA_PARTNER_USER_ID,
    };
    // 対照: 無効化前は ctx を作れる。
    expect(
      await buildTenantCtx({ ...identity, twoFactorVerified: true }, { deviceKind: 'api' }),
    ).not.toBeNull();

    await revoke(await ctxOf(PARTNER_USER_1, 'PARTNER_ADMIN'), EXTRA_PARTNER_MEMBERSHIP_ID);

    expect(
      await buildTenantCtx({ ...identity, twoFactorVerified: true }, { deviceKind: 'api' }),
    ).toBeNull();
  });

  it('🔴 冪等である（2 回無効化しても revoked_at が動かず、監査ログも 1 件のまま）', async () => {
    const ctx = await ctxOf(PARTNER_USER_1, 'PARTNER_ADMIN');
    await revoke(ctx, EXTRA_PARTNER_MEMBERSHIP_ID);
    const first = (await admin.membership.findFirst({ where: { id: EXTRA_PARTNER_MEMBERSHIP_ID } }))
      ?.revokedAt;

    const again = await revoke(ctx, EXTRA_PARTNER_MEMBERSHIP_ID);

    expect(again.status).toBe(204);
    expect(
      (await admin.membership.findFirst({ where: { id: EXTRA_PARTNER_MEMBERSHIP_ID } }))?.revokedAt,
    ).toEqual(first);
    expect(await auditRows('membership.revoke')).toHaveLength(1);
  });

  it('🔴 無効化済みの所属はロールを変更できない（409）', async () => {
    const ctx = await ctxOf(PARTNER_USER_1, 'PARTNER_ADMIN');
    await revoke(ctx, EXTRA_PARTNER_MEMBERSHIP_ID);

    const response = await changeRole(ctx, EXTRA_PARTNER_MEMBERSHIP_ID, 'PARTNER_ADMIN');

    expect(response.status).toBe(409);
    expect(((await response.json()) as ErrorBody).error.code).toBe('MEMBER_REVOKED');
  });

  it('🔴 最後の OWNER は無効化できない（422）', async () => {
    const response = await revoke(await ctxOf(HOST_1, 'ADMIN'), TENANT_1.hostOwnerMembershipId);

    expect(response.status).toBe(422);
    expect(((await response.json()) as ErrorBody).error.code).toBe('MEMBER_LAST_OWNER');
    expect(
      (await admin.membership.findFirst({ where: { id: TENANT_1.hostOwnerMembershipId } }))
        ?.revokedAt,
    ).toBeNull();
    expect((await admin.user.findFirst({ where: { id: TENANT_1.hostOwnerUserId } }))?.disabledAt).toBeNull();
  });

  it('🔴 無効化された行は一覧に「無効」として残る（消えない）', async () => {
    const ctx = await ctxOf(PARTNER_USER_1, 'PARTNER_ADMIN');
    await revoke(ctx, EXTRA_PARTNER_MEMBERSHIP_ID);

    const body = (await (await listMembers(ctx)).json()) as MemberListBody;
    const revoked = body.items.find((item) => item.id === EXTRA_PARTNER_MEMBERSHIP_ID);
    expect(revoked?.status).toBe('REVOKED');
  });
});

describe('🔴 並行実行でも OWNER が 0 人にならない（iteration 2 / 指摘 1）', () => {
  /**
   * 🔴 `COUNT` → 判定 → `UPDATE` は `Read Committed` では守れない（write skew）。
   *    `OWNER` が 2 人のときに 2 つの要求を**同時に**投げ、次の 2 つを同時に確かめる:
   *      ①最終的に有効な `OWNER` が 1 人以上残っている（**不変条件**。これが本体）
   *      ②片方だけが成功し、もう片方は 422（`LAST_OWNER`。直列化された）か
   *        409（`CONCURRENT_UPDATE`。SSI が落とした）である
   *    ②の「どちらの拒否になるか」はタイミング依存なので固定しない。**①は常に成立する。**
   */
  async function activeOwnerCount(): Promise<number> {
    return admin.membership.count({
      where: { tenantId: TENANT_1.tenantId, role: 'OWNER', revokedAt: null },
    });
  }

  beforeEach(async () => {
    // 前提: 有効な `OWNER` を 2 人にする（1 人ずつなら順に降格できてしまう）。
    await admin.membership.updateMany({
      where: { id: EXTRA_HOST_MEMBERSHIP_ID },
      data: { role: 'OWNER' },
    });
  });

  it('🔴 2 人の OWNER を同時に降格しても、片方は必ず拒否される', async () => {
    const ctx = await ctxOf(HOST_1, 'ADMIN');
    expect(await activeOwnerCount()).toBe(2);

    const [first, second] = await Promise.all([
      changeRole(ctx, TENANT_1.hostOwnerMembershipId, 'ADMIN'),
      changeRole(ctx, EXTRA_HOST_MEMBERSHIP_ID, 'ADMIN'),
    ]);

    // 🔴 不変条件（テナントが管理不能にならない）。
    expect(await activeOwnerCount()).toBeGreaterThanOrEqual(1);

    const statuses = [first.status, second.status].sort();
    expect(statuses.filter((status) => status === 204)).toHaveLength(1);
    const rejected = statuses.find((status) => status !== 204);
    expect([409, 422]).toContain(rejected);
  });

  it('🔴 2 人の OWNER を同時に無効化しても、片方は必ず拒否される', async () => {
    const ctx = await ctxOf(HOST_1, 'ADMIN');
    expect(await activeOwnerCount()).toBe(2);

    const [first, second] = await Promise.all([
      revoke(ctx, TENANT_1.hostOwnerMembershipId),
      revoke(ctx, EXTRA_HOST_MEMBERSHIP_ID),
    ]);

    expect(await activeOwnerCount()).toBeGreaterThanOrEqual(1);
    const statuses = [first.status, second.status].sort();
    expect(statuses.filter((status) => status === 204)).toHaveLength(1);
    expect([409, 422]).toContain(statuses.find((status) => status !== 204));
  });

  it('🔴 拒否された側は監査ログを残さない（成功した 1 件だけが記録される）', async () => {
    const ctx = await ctxOf(HOST_1, 'ADMIN');
    // 🔴 前提の持ち越しをここで落とす（iteration 3）。直前の並行 revoke でどちらが勝つかは
    //    非決定的であり、`afterEach` の復元が欠けると `OWNER` が 1 人のまま入ってくる。
    //    その場合 2 本目の要求は「並行の敗者」ではなく `LAST_OWNER` で拒否され、
    //    **本テストは通ってしまう**（検証したい性質を見ていない）。原因の行で落とす。
    expect(await activeOwnerCount()).toBe(2);

    await Promise.all([
      changeRole(ctx, TENANT_1.hostOwnerMembershipId, 'ADMIN'),
      changeRole(ctx, EXTRA_HOST_MEMBERSHIP_ID, 'ADMIN'),
    ]);

    expect(await auditRows('membership.role_change')).toHaveLength(1);
  });
});

describe('🔴 F-002 AC-4: PARTNER_ADMIN の招待は常に自社になる（#14 の経路）', () => {
  it('自社の PARTNER_SALES を招ける（宛先分類 2 として積まれる）', async () => {
    const result = await issueInvitation(
      await ctxOf(PARTNER_USER_1, 'PARTNER_ADMIN'),
      { email: 'new-sales@t0409invite.example', role: 'PARTNER_SALES' },
      META,
      (ctx) => evaluateSendingDomain(ctx, NOT_REQUIRED_RUNTIME),
      () => INVITE_URL_NOT_DISCLOSED,
      NOW,
    );

    const row = await admin.invitation.findFirst({ where: { id: result.id } });
    expect(row?.partnerCompanyId).toBe(PARTNER_1_1.partnerCompanyId);
    expect(row?.role).toBe('PARTNER_SALES');
    expect(mail.jobsOf('INVITATION')[0]?.recipientClass).toBe('PARTNER_MEMBER');
  });

  it('🔴 パートナー所属宛（分類 2）は未検証ドメインで保留される（T-04-05 の既存挙動を変えない）', async () => {
    const result = await issueInvitation(
      await ctxOf(PARTNER_USER_1, 'PARTNER_ADMIN'),
      { email: 'held-sales@t0409invite.example', role: 'PARTNER_SALES' },
      META,
      (ctx) => evaluateSendingDomain(ctx, REQUIRED_RUNTIME),
      () => INVITE_URL_NOT_DISCLOSED,
      NOW,
    );

    // 🔴 招待そのものは作られる（`F-007 AC-5`）。送達だけが保留される。
    expect(result.deliveryState).toBe('HELD_DOMAIN_UNVERIFIED');
    expect(await admin.invitation.count({ where: { id: result.id } })).toBe(1);
  });

  it('🔴 PARTNER_ADMIN はホストロールを招けない（403）', async () => {
    await expect(
      issueInvitation(
        await ctxOf(PARTNER_USER_1, 'PARTNER_ADMIN'),
        { email: 'host-role@t0409invite.example', role: 'SALES' },
        META,
        (ctx) => evaluateSendingDomain(ctx, NOT_REQUIRED_RUNTIME),
        () => INVITE_URL_NOT_DISCLOSED,
        NOW,
      ),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(mail.callCount()).toBe(0);
  });
});
