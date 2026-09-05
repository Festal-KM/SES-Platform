// tests/isolation/partner-companies.test.ts
// 🔴 SP-04 T-04-07 の完了判定を **DB + RLS 付きで**実証する（`F-007 AC-1`〜`AC-3` / `AC-5`）:
//
//   AC-1 パートナー企業の一覧・詳細を参照できるのはホスト所属ロールのみで、
//        `PARTNER_ADMIN` / `PARTNER_SALES` には**自社 1 社以外が一覧にも件数にも現れない**
//        （🔴 母集団を絞るのは RLS の C5 であり、アプリ側の `where` ではない。`F-004 AC-1`）
//   AC-2 パートナーを停止すると配下アカウントは実行系を実行できなくなり、**既存データは消えない**
//   AC-3 登録・招待・停止・再開が `AuditLog` に残る
//   AC-5 `production` 相当（送信ドメイン未検証）で**招待は作成され、送達だけが保留される**
//
// 🔴 検証は `withApiRoute` が組み立てた**実物の Route Handler** に `Request` を渡して行う
//    （`api-boundary.test.ts` と同じ方針）。差し替えるのは `requireTenantCtx` の 1 点だけで、
//    その戻り値も `buildTenantCtx` が実 DB から確定した ctx である。
//
// 🔴 招待の発行（#14）のうち**取引先宛**は `issueInvitation` を直接呼ぶ。ルート経由にすると
//    `sendingDomainRuntime()`（`lib/db/bootstrap.ts`）が起動時 DI を初期化してしまい、
//    テストコンテナではなく環境変数の `DATABASE_URL` へ接続しにいく。判定関数（`evaluateSendingDomain`）は
//    ルートと同じものを渡すので、検証している経路は同じである（`sending-domain-hold.test.ts` と同じ扱い）。
//    🔴 逆に**ガード（`requireExecutable`）はハンドラ本体より前に走る**ため、停止中パートナーの
//    拒否は実物のルートでそのまま観測できる（bootstrap に到達しない）。
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
const { requireExecutable } = await import('../../apps/web/lib/api/guards');
const { withApiRoute } = await import('../../apps/web/lib/api/withApiRoute');
const { configureAccountMailQueue, PendingAccountMailQueue } = await import(
  '../../apps/web/lib/jobs/account-mail'
);
const { issueInvitation } = await import('../../apps/web/lib/invitations/service');
// 🔴 T-04-08: 本ファイルは `production` 相当だけを見る（`sandbox` の招待リンクは
//    `sandbox-invite-link.test.ts`）。開示しない runtime を明示的に渡す。
const { INVITE_URL_NOT_DISCLOSED } = await import('../../apps/web/lib/invitations/invite-link');
const { evaluateSendingDomain } = await import('../../apps/web/lib/settings/sending-domains');
const partnerCompaniesRoute = await import(
  '../../apps/web/app/api/(main)/partner-companies/route'
);
const suspendRoute = await import(
  '../../apps/web/app/api/(main)/partner-companies/[id]/suspend/route'
);
const resumeRoute = await import(
  '../../apps/web/app/api/(main)/partner-companies/[id]/resume/route'
);
const invitationsRoute = await import('../../apps/web/app/api/(main)/invitations/route');

/** `production` / `staging` 相当（`docs/03` §3.2.7 規律 1・3）。 */
const REQUIRED_RUNTIME = { region: 'ap-northeast-1', verificationRequired: true } as const;
/** `sandbox` / `demo` / `development` 相当（同 規律 4・5）。 */
const NOT_REQUIRED_RUNTIME = { region: 'ap-northeast-1', verificationRequired: false } as const;

const TENANT_1 = ISOLATION_SEED_IDS.tenants[0];
const TENANT_2 = ISOLATION_SEED_IDS.tenants[1];
const PARTNER_1_1 = TENANT_1.partners[0];
const PARTNER_1_2 = TENANT_1.partners[1];
const PARTNER_2_1 = TENANT_2.partners[0];

const HOST_1: TenantIdentity = {
  tenantId: TENANT_1.tenantId,
  partnerCompanyId: null,
  userId: TENANT_1.hostUserId,
};
const HOST_2: TenantIdentity = {
  tenantId: TENANT_2.tenantId,
  partnerCompanyId: null,
  userId: TENANT_2.hostUserId,
};
const PARTNER_USER_1: TenantIdentity = {
  tenantId: TENANT_1.tenantId,
  partnerCompanyId: PARTNER_1_1.partnerCompanyId,
  userId: PARTNER_1_1.userId,
};

/** 実在しない ID（境界外の ID と応答が一致することの比較対象。docs/05 §4.8）。 */
const NONEXISTENT_ID = '01930000-0000-7000-8000-00000000ffff';

type PartnerCompanyItem = {
  readonly id: string;
  readonly name: string;
  readonly status: string;
  readonly accountCount: number;
  readonly proposalCount: number;
};
type PartnerCompanyListBody = {
  readonly items: readonly PartnerCompanyItem[];
  readonly total: number;
};
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

/** 🔴 ロール・テナント状態・**取引先の停止状態**をすべて DB から確定した ctx を作る。 */
async function ctxOf(identity: TenantIdentity, role: TenantRole): Promise<AuthenticatedTenantCtx> {
  await setRole(identity, role);
  const ctx = await buildTenantCtx({ ...identity, twoFactorVerified: true }, { deviceKind: 'api' });
  if (ctx === null) throw new Error('ctx を作れませんでした（前提の破綻）。');
  return ctx;
}

async function listPartnerCompanies(ctx: AuthenticatedTenantCtx, query = ''): Promise<Response> {
  requireTenantCtxMock.mockResolvedValue(ctx);
  return partnerCompaniesRoute.GET(new Request(`https://app.test/api/partner-companies${query}`));
}

async function createPartnerCompany(ctx: AuthenticatedTenantCtx, body: unknown): Promise<Response> {
  requireTenantCtxMock.mockResolvedValue(ctx);
  return partnerCompaniesRoute.POST(
    new Request('https://app.test/api/partner-companies', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
  );
}

async function changeSuspension(
  ctx: AuthenticatedTenantCtx,
  id: string,
  operation: 'suspend' | 'resume',
  body: unknown = {},
): Promise<Response> {
  requireTenantCtxMock.mockResolvedValue(ctx);
  const route = operation === 'suspend' ? suspendRoute : resumeRoute;
  return route.POST(
    new Request(`https://app.test/api/partner-companies/${id}/${operation}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ id }) },
  );
}

async function callInvitationsRoute(ctx: AuthenticatedTenantCtx, body: unknown): Promise<Response> {
  requireTenantCtxMock.mockResolvedValue(ctx);
  return invitationsRoute.POST(
    new Request('https://app.test/api/invitations', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
  );
}

/** 取引先宛の招待（判定関数はルートと同じ `evaluateSendingDomain`。本ファイル冒頭の 🔴 参照）。 */
async function invitePartner(
  ctx: AuthenticatedTenantCtx,
  input: { readonly email: string; readonly targetPartnerCompanyId: string },
  runtime: typeof REQUIRED_RUNTIME | typeof NOT_REQUIRED_RUNTIME = NOT_REQUIRED_RUNTIME,
) {
  return issueInvitation(
    ctx,
    { email: input.email, role: 'PARTNER_ADMIN', targetPartnerCompanyId: input.targetPartnerCompanyId },
    META,
    (invitationCtx) => evaluateSendingDomain(invitationCtx, runtime),
    () => INVITE_URL_NOT_DISCLOSED,
    NOW,
  );
}

async function auditRows(action: string) {
  // 🔴 `createdAt` は同一トランザクション内だと同値になりうるため `id`（uuid v7 = 時系列）で整列する。
  return admin.auditLog.findMany({ where: { action }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] });
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

  await enrollTwoFactor(TENANT_1.hostUserId, TENANT_1.tenantId);
  await enrollTwoFactor(TENANT_2.hostUserId, TENANT_2.tenantId);
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
  // 🔴 テスト間で前提を持ち越さない（ロール・停止状態・追加した行を戻す）。
  await setRole(HOST_1, 'SALES');
  await setRole(HOST_2, 'SALES');
  await setRole(PARTNER_USER_1, 'PARTNER_SALES');
  await admin.partnerCompany.updateMany({ data: { suspendedAt: null } });
  await admin.invitation.deleteMany({ where: { email: { contains: '@t0407.example' } } });
  await admin.partnerCompany.deleteMany({ where: { name: { startsWith: '架空' } } });
  await admin.auditLog.deleteMany({
    where: { action: { in: ['partner_company.create', 'partner_company.update', 'invitation.create'] } },
  });
});

describe('🔴 F-007 AC-1 / F-004 AC-1: 母集団は RLS が決める（アプリ側に絞り込みを書かない）', () => {
  it('ホストにはテナント内の取引先 2 社が見える（対照）', async () => {
    const response = await listPartnerCompanies(await ctxOf(HOST_1, 'ADMIN'));
    const body = (await response.json()) as PartnerCompanyListBody;

    expect(response.status).toBe(200);
    expect(body.total).toBe(2);
    expect(body.items.map((item) => item.id).sort()).toEqual(
      [PARTNER_1_1.partnerCompanyId, PARTNER_1_2.partnerCompanyId].sort(),
    );
  });

  it.each(['PARTNER_ADMIN', 'PARTNER_SALES'] as const)(
    '🔴 %s には自社 1 社しか現れない（items も total も 1。他社の ID / 企業名が応答に無い）',
    async (role) => {
      const other = await admin.partnerCompany.findFirst({
        where: { id: PARTNER_1_2.partnerCompanyId },
        select: { name: true },
      });

      const response = await listPartnerCompanies(await ctxOf(PARTNER_USER_1, role));
      const raw = await response.text();
      const body = JSON.parse(raw) as PartnerCompanyListBody;

      expect(response.status).toBe(200);
      // 🔴 「件数にも現れない」（`F-007 AC-1`）。1 件と数えられているのは自社だけである。
      expect(body.total).toBe(1);
      expect(body.items).toHaveLength(1);
      expect(body.items[0]?.id).toBe(PARTNER_1_1.partnerCompanyId);
      // 🔴 応答の生文字列に他社の識別子も企業名も 1 度も現れない。
      expect(raw).not.toContain(PARTNER_1_2.partnerCompanyId);
      expect(raw).not.toContain(other?.name ?? '__missing__');
    },
  );

  it('🔴 他テナントの取引先は 1 件も現れない（テナント越境が無い）', async () => {
    const response = await listPartnerCompanies(await ctxOf(HOST_2, 'ADMIN'));
    const raw = await response.text();
    const body = JSON.parse(raw) as PartnerCompanyListBody;

    expect(body.items.map((item) => item.id).sort()).toEqual(
      [PARTNER_2_1.partnerCompanyId, TENANT_2.partners[1].partnerCompanyId].sort(),
    );
    expect(raw).not.toContain(PARTNER_1_1.partnerCompanyId);
    expect(raw).not.toContain(PARTNER_1_2.partnerCompanyId);
  });

  it('🔴 業務上の絞り込み（?q= / ?status=）は境界を広げない', async () => {
    const partnerCtx = await ctxOf(PARTNER_USER_1, 'PARTNER_ADMIN');
    const other = await admin.partnerCompany.findFirst({
      where: { id: PARTNER_1_2.partnerCompanyId },
      select: { name: true },
    });

    // 他社の名前で検索しても、母集団に他社が入らない以上 0 件になる。
    const byName = await listPartnerCompanies(
      partnerCtx,
      `?q=${encodeURIComponent(other?.name ?? 'x')}`,
    );
    expect(((await byName.json()) as PartnerCompanyListBody).total).toBe(0);

    // 状態で絞っても母集団は自社 1 行のまま。
    const active = await listPartnerCompanies(partnerCtx, '?status=ACTIVE');
    expect(((await active.json()) as PartnerCompanyListBody).total).toBe(1);
  });

  it('件数（アカウント数・提案数）は自社の値だけが集計される', async () => {
    const response = await listPartnerCompanies(await ctxOf(PARTNER_USER_1, 'PARTNER_ADMIN'));
    const body = (await response.json()) as PartnerCompanyListBody;

    // seed は各パートナーに利用者 1 名と提案 2 件（`WON` / `GATE_FAILED`）を置いている。
    expect(body.items[0]?.accountCount).toBe(1);
    expect(body.items[0]?.proposalCount).toBeGreaterThan(0);
  });
});

describe('🔴 F-007: 取引先企業の登録（#12）の認可', () => {
  it('ADMIN は登録でき、行はホストのテナントに属する', async () => {
    const response = await createPartnerCompany(await ctxOf(HOST_1, 'ADMIN'), {
      name: '架空テック株式会社',
      contactName: '架空 太郎',
      contactEmail: 'Contact@T0407.example',
    });
    expect(response.status).toBe(201);

    const { id } = (await response.json()) as { readonly id: string };
    const row = await admin.partnerCompany.findFirst({ where: { id } });
    expect(row?.tenantId).toBe(TENANT_1.tenantId);
    expect(row?.suspendedAt).toBeNull();
    expect(row?.contactEmail).toBe('contact@t0407.example');
  });

  it.each(['SALES', 'VIEWER'] as const)('🔴 %s は登録できない（403）', async (role) => {
    const before = await admin.partnerCompany.count();
    const response = await createPartnerCompany(await ctxOf(HOST_1, role), { name: '架空だめ会社' });

    expect(response.status).toBe(403);
    expect(await admin.partnerCompany.count()).toBe(before);
  });

  it('🔴 PARTNER_ADMIN は取引先を登録できない（403。C2 の書込はホストのみ）', async () => {
    const before = await admin.partnerCompany.count();
    const response = await createPartnerCompany(await ctxOf(PARTNER_USER_1, 'PARTNER_ADMIN'), {
      name: '架空パートナー登録',
    });

    expect(response.status).toBe(403);
    expect(await admin.partnerCompany.count()).toBe(before);
  });
});

describe('🔴 F-007 AC-2: 停止（#13）— 実行系だけを止め、データは消さない', () => {
  async function suspendPartner1(): Promise<Response> {
    return changeSuspension(
      await ctxOf(HOST_1, 'ADMIN'),
      PARTNER_1_1.partnerCompanyId,
      'suspend',
      { reason: '契約終了のため' },
    );
  }

  it('停止すると suspended_at が立ち、配下の行は 1 件も消えない', async () => {
    const before = {
      users: await admin.user.count({ where: { ownerPartnerCompanyId: PARTNER_1_1.partnerCompanyId } }),
      engineers: await admin.engineer.count({
        where: { ownerPartnerCompanyId: PARTNER_1_1.partnerCompanyId },
      }),
      proposals: await admin.proposal.count({
        where: { ownerPartnerCompanyId: PARTNER_1_1.partnerCompanyId },
      }),
      messages: await admin.message.count({
        where: { senderPartnerCompanyId: PARTNER_1_1.partnerCompanyId },
      }),
    };

    const response = await suspendPartner1();
    expect(response.status).toBe(204);

    const row = await admin.partnerCompany.findFirst({ where: { id: PARTNER_1_1.partnerCompanyId } });
    expect(row?.suspendedAt).not.toBeNull();

    // 🔴 `F-007 AC-2`「既存データは削除されない」。
    expect(await admin.user.count({ where: { ownerPartnerCompanyId: PARTNER_1_1.partnerCompanyId } })).toBe(
      before.users,
    );
    expect(
      await admin.engineer.count({ where: { ownerPartnerCompanyId: PARTNER_1_1.partnerCompanyId } }),
    ).toBe(before.engineers);
    expect(
      await admin.proposal.count({ where: { ownerPartnerCompanyId: PARTNER_1_1.partnerCompanyId } }),
    ).toBe(before.proposals);
    expect(
      await admin.message.count({ where: { senderPartnerCompanyId: PARTNER_1_1.partnerCompanyId } }),
    ).toBe(before.messages);
  });

  it('🔴 停止中の配下アカウントは実行系（招待の発行）を実行できない（409）', async () => {
    await suspendPartner1();

    // 🔴 停止は**次のリクエストから**効く（ctx は毎回 DB から確定する）。
    const partnerCtx = await ctxOf(PARTNER_USER_1, 'PARTNER_ADMIN');
    const response = await callInvitationsRoute(partnerCtx, {
      email: 'suspended-invite@t0407.example',
      role: 'PARTNER_SALES',
    });

    expect(response.status).toBe(409);
    expect(((await response.json()) as ErrorBody).error.code).toBe('PARTNER_COMPANY_SUSPENDED');
    // 🔴 招待行もメールも 1 件も作られていない（ガードはハンドラ本体より前に走る）。
    expect(await admin.invitation.count({ where: { email: 'suspended-invite@t0407.example' } })).toBe(0);
    expect(mail.callCount()).toBe(0);
  });

  it('🔴 停止中でも閲覧はできる（`F-007 AC-2` は実行系だけを止める）', async () => {
    await suspendPartner1();

    const response = await listPartnerCompanies(await ctxOf(PARTNER_USER_1, 'PARTNER_ADMIN'));
    const body = (await response.json()) as PartnerCompanyListBody;

    expect(response.status).toBe(200);
    expect(body.items[0]?.status).toBe('SUSPENDED');
  });

  it('🔴 停止中の取引先には新しいアカウントを招けない（ホストからでも 409）', async () => {
    await suspendPartner1();

    const hostCtx = await ctxOf(HOST_1, 'ADMIN');
    await expect(
      invitePartner(hostCtx, {
        email: 'suspended-host-invite@t0407.example',
        targetPartnerCompanyId: PARTNER_1_1.partnerCompanyId,
      }),
    ).rejects.toMatchObject({ code: 'PARTNER_COMPANY_SUSPENDED' });
    expect(mail.callCount()).toBe(0);
  });

  it('🔴 他社（同一テナントの別の取引先）は停止の影響を受けない', async () => {
    await suspendPartner1();

    const response = await listPartnerCompanies(await ctxOf(HOST_1, 'ADMIN'));
    const body = (await response.json()) as PartnerCompanyListBody;
    const other = body.items.find((item) => item.id === PARTNER_1_2.partnerCompanyId);
    expect(other?.status).toBe('ACTIVE');
  });

  it('再開すると配下アカウントの実行系が戻る', async () => {
    await suspendPartner1();
    const resumed = await changeSuspension(
      await ctxOf(HOST_1, 'ADMIN'),
      PARTNER_1_1.partnerCompanyId,
      'resume',
    );
    expect(resumed.status).toBe(204);
    expect(
      (await admin.partnerCompany.findFirst({ where: { id: PARTNER_1_1.partnerCompanyId } }))?.suspendedAt,
    ).toBeNull();

    const partnerCtx = await ctxOf(PARTNER_USER_1, 'PARTNER_ADMIN');
    const invitation = await issueInvitation(
      partnerCtx,
      { email: 'resumed-invite@t0407.example', role: 'PARTNER_SALES' },
      META,
      (ctx) => evaluateSendingDomain(ctx, NOT_REQUIRED_RUNTIME),
      () => INVITE_URL_NOT_DISCLOSED,
      NOW,
    );
    expect(invitation.id).toBeTruthy();
  });

  it('🔴 冪等である（2 回停止しても suspended_at が動かない）', async () => {
    await suspendPartner1();
    const first = (await admin.partnerCompany.findFirst({ where: { id: PARTNER_1_1.partnerCompanyId } }))
      ?.suspendedAt;

    const again = await suspendPartner1();
    expect(again.status).toBe(204);
    expect(
      (await admin.partnerCompany.findFirst({ where: { id: PARTNER_1_1.partnerCompanyId } }))?.suspendedAt,
    ).toEqual(first);
  });

  it('🔴 パートナーは自社を停止・再開できない（403）', async () => {
    const partnerCtx = await ctxOf(PARTNER_USER_1, 'PARTNER_ADMIN');
    for (const operation of ['suspend', 'resume'] as const) {
      const response = await changeSuspension(partnerCtx, PARTNER_1_1.partnerCompanyId, operation);
      expect(response.status).toBe(403);
    }
    expect(
      (await admin.partnerCompany.findFirst({ where: { id: PARTNER_1_1.partnerCompanyId } }))?.suspendedAt,
    ).toBeNull();
  });

  it('🔴 他テナントの取引先は停止できない（404。実在しない ID と応答が一致する）', async () => {
    const hostCtx = await ctxOf(HOST_2, 'ADMIN');

    const crossTenant = await changeSuspension(hostCtx, PARTNER_1_1.partnerCompanyId, 'suspend');
    const missing = await changeSuspension(hostCtx, NONEXISTENT_ID, 'suspend');

    expect(crossTenant.status).toBe(404);
    expect(await crossTenant.json()).toEqual(await missing.json());
    expect(
      (await admin.partnerCompany.findFirst({ where: { id: PARTNER_1_1.partnerCompanyId } }))?.suspendedAt,
    ).toBeNull();
  });
});

describe('🔴 F-007 AC-3: 登録・招待・停止・再開が監査ログに残る', () => {
  it('登録が `partner_company.create` として残る（企業名が summary にある）', async () => {
    await createPartnerCompany(await ctxOf(HOST_1, 'ADMIN'), { name: '架空監査テック' });

    const rows = await auditRows('partner_company.create');
    expect(rows).toHaveLength(1);
    expect(rows[0]?.tenantId).toBe(TENANT_1.tenantId);
    expect(rows[0]?.actorKind).toBe('USER');
    expect(rows[0]?.actorId).toBe(TENANT_1.hostUserId);
    expect(rows[0]?.targetType).toBe('PartnerCompany');
    expect(JSON.stringify(rows[0]?.summary)).toContain('架空監査テック');
  });

  it('🔴 停止と再開が `partner_company.update` として残り、summary で区別できる', async () => {
    const hostCtx = await ctxOf(HOST_1, 'ADMIN');
    await changeSuspension(hostCtx, PARTNER_1_1.partnerCompanyId, 'suspend', { reason: '契約終了のため' });
    await changeSuspension(hostCtx, PARTNER_1_1.partnerCompanyId, 'resume');

    const rows = await auditRows('partner_company.update');
    expect(rows).toHaveLength(2);
    expect(rows.map((row) => (row.summary as { operation?: string }).operation)).toEqual([
      'SUSPEND',
      'RESUME',
    ]);
    expect(rows.every((row) => row.targetId === PARTNER_1_1.partnerCompanyId)).toBe(true);
    expect(JSON.stringify(rows[0]?.summary)).toContain('契約終了のため');
  });

  it('🔴 action は `*.update` である（`S-041` の操作種別フィルタから漏れない）', async () => {
    await changeSuspension(await ctxOf(HOST_1, 'ADMIN'), PARTNER_1_1.partnerCompanyId, 'suspend');

    const rows = await auditRows('partner_company.update');
    expect(rows[0]?.action.endsWith('.update')).toBe(true);
  });

  it('招待が `invitation.create` として残り、宛先の取引先が summary から分かる', async () => {
    const hostCtx = await ctxOf(HOST_1, 'ADMIN');
    await invitePartner(hostCtx, {
      email: 'audit-invite@t0407.example',
      targetPartnerCompanyId: PARTNER_1_1.partnerCompanyId,
    });

    const rows = await auditRows('invitation.create');
    expect(rows).toHaveLength(1);
    const summary = JSON.stringify(rows[0]?.summary);
    expect(summary).toContain(PARTNER_1_1.partnerCompanyId);
    // 🔴 メールアドレス（PII）とトークンは載せない（docs/05 §16.2）。
    expect(summary).not.toContain('@');
  });

  it('🔴 拒否された操作は監査ログを残さない（記録が「試み」で汚れない）', async () => {
    await createPartnerCompany(await ctxOf(HOST_1, 'VIEWER'), { name: '架空拒否テック' });
    expect(await auditRows('partner_company.create')).toEqual([]);
  });
});

describe('🔴 F-007 AC-5: 未検証でも招待は作られ、送達だけが保留される（#14 の取引先分）', () => {
  it('`production` 相当（未検証）で deliveryState が HELD_DOMAIN_UNVERIFIED になり、招待行は残る', async () => {
    const hostCtx = await ctxOf(HOST_1, 'ADMIN');

    const result = await invitePartner(
      hostCtx,
      { email: 'held@t0407.example', targetPartnerCompanyId: PARTNER_1_1.partnerCompanyId },
      REQUIRED_RUNTIME,
    );

    expect(result.deliveryState).toBe('HELD_DOMAIN_UNVERIFIED');
    const row = await admin.invitation.findFirst({ where: { id: result.id } });
    expect(row?.partnerCompanyId).toBe(PARTNER_1_1.partnerCompanyId);
    expect(row?.role).toBe('PARTNER_ADMIN');
    expect(row?.acceptedAt).toBeNull();
  });

  it('🔴 自社メンバー宛（分類 1）は同じ状況でも保留されない（F-001 AC-5）', async () => {
    const hostCtx = await ctxOf(HOST_1, 'ADMIN');

    const result = await issueInvitation(
      hostCtx,
      { email: 'host-member@t0407.example', role: 'SALES' },
      META,
      (ctx) => evaluateSendingDomain(ctx, REQUIRED_RUNTIME),
      () => INVITE_URL_NOT_DISCLOSED,
      NOW,
    );

    expect(result.deliveryState).not.toBe('HELD_DOMAIN_UNVERIFIED');
  });
});

describe('🔴 T-04-07: 招待先の選択（targetPartnerCompanyId）は母集団に照合される', () => {
  it('🔴 他テナントの取引先企業を指定しても書き込めない（404。招待行が残らない）', async () => {
    const hostCtx = await ctxOf(HOST_1, 'ADMIN');

    await expect(
      invitePartner(hostCtx, {
        email: 'cross-tenant@t0407.example',
        targetPartnerCompanyId: PARTNER_2_1.partnerCompanyId,
      }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });

    expect(await admin.invitation.count({ where: { email: 'cross-tenant@t0407.example' } })).toBe(0);
    expect(mail.callCount()).toBe(0);
  });

  it('🔴 存在しない取引先企業の ID でも同じ応答になる（見えない ＝ 存在しない）', async () => {
    const hostCtx = await ctxOf(HOST_1, 'ADMIN');

    await expect(
      invitePartner(hostCtx, {
        email: 'missing-partner@t0407.example',
        targetPartnerCompanyId: NONEXISTENT_ID,
      }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('🔴 PARTNER_ADMIN が他社を指定しても自社にならず 403 になる（実行者のスコープは ctx が決める）', async () => {
    const partnerCtx = await ctxOf(PARTNER_USER_1, 'PARTNER_ADMIN');

    await expect(
      issueInvitation(
        partnerCtx,
        {
          email: 'other-partner@t0407.example',
          role: 'PARTNER_SALES',
          targetPartnerCompanyId: PARTNER_1_2.partnerCompanyId,
        },
        META,
        (ctx) => evaluateSendingDomain(ctx, NOT_REQUIRED_RUNTIME),
        () => INVITE_URL_NOT_DISCLOSED,
        NOW,
      ),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(await admin.invitation.count({ where: { email: 'other-partner@t0407.example' } })).toBe(0);
  });

  it('自社の取引先を指定した招待は作成され、宛先分類 2 として積まれる', async () => {
    const hostCtx = await ctxOf(HOST_1, 'ADMIN');

    const result = await invitePartner(hostCtx, {
      email: 'ok-partner@t0407.example',
      targetPartnerCompanyId: PARTNER_1_2.partnerCompanyId,
    });

    const row = await admin.invitation.findFirst({ where: { id: result.id } });
    expect(row?.partnerCompanyId).toBe(PARTNER_1_2.partnerCompanyId);
    expect(mail.jobsOf('INVITATION')[0]?.recipientClass).toBe('PARTNER_MEMBER');
  });
});

/**
 * 🔴 `requireExecutable` が実物の `withApiRoute` の経路で効いていることを、
 *    ルート実装から独立に固定する（`api-boundary.test.ts` の `getEngineerRoute` と同じ技法）。
 *    「すべての実行系ルートがこのガードを宣言していること」は
 *    `tests/static/execute-guard.test.ts` が別途 AST で走査する。2 つで 1 対である。
 */
describe('🔴 停止の強制は共通ガードに 1 本化されている（掛け忘れたルートを作らない）', () => {
  const executableRoute = withApiRoute(
    { label: 'POST /api/__test__/executable', guards: [requireExecutable()] },
    async () => new Response(null, { status: 204 }),
  );

  async function callExecutable(ctx: AuthenticatedTenantCtx): Promise<Response> {
    requireTenantCtxMock.mockResolvedValue(ctx);
    return executableRoute(new Request('https://app.test/api/__test__/executable', { method: 'POST' }));
  }

  it('停止していない取引先の配下アカウントは通る（対照）', async () => {
    expect((await callExecutable(await ctxOf(PARTNER_USER_1, 'PARTNER_SALES'))).status).toBe(204);
  });

  it('🔴 停止中の取引先の配下アカウントは 409 になる', async () => {
    await changeSuspension(await ctxOf(HOST_1, 'ADMIN'), PARTNER_1_1.partnerCompanyId, 'suspend');

    const response = await callExecutable(await ctxOf(PARTNER_USER_1, 'PARTNER_SALES'));

    expect(response.status).toBe(409);
    expect(((await response.json()) as ErrorBody).error.code).toBe('PARTNER_COMPANY_SUSPENDED');
  });

  it('🔴 ホストは同じ状況でも通る（停止の単位は取引先企業である）', async () => {
    await changeSuspension(await ctxOf(HOST_1, 'ADMIN'), PARTNER_1_1.partnerCompanyId, 'suspend');
    expect((await callExecutable(await ctxOf(HOST_1, 'ADMIN'))).status).toBe(204);
  });
});
