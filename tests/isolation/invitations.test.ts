// tests/isolation/invitations.test.ts
// T-03-03（docs/sprints/SP-03-auth-audit-admin0.md）の完了判定:
//
//   🔴 `F-002 AC-1` パートナー所属のロールは必ず 1 社のパートナー企業に紐づく
//      （紐づかない招待は作れず、DB へ到達しても受諾が成立しない）
//   🔴 `F-002 AC-3` 招待・受諾・パスワード再設定が監査ログに残る（PII とトークンを含まない）
//   🔴 `F-002 AC-4` `PARTNER_ADMIN` は自社配下のみ（他社・ホストの招待は発行も参照もできない）
//   🔴 受諾は `acceptedAt` の CAS で **1 回限り**
//   🔴 パスワード再設定は**アカウントの存在を漏らさない**（未知のメールでも例外にならず、
//      送信も起きない = 応答が常に 204 であることの裏付け）
//
// 検証はアプリの実装（`apps/web/lib/**`）をそのまま呼ぶ（T-03-01 / T-03-02 と同じ方針）。
// HTTP 層を通した検証は E2E（T-03-11）が行う。
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  configureTenantDb,
  disconnectTenantDb,
  withTenant,
  type AuthenticatedTenantCtx,
  type TenantIdentity,
} from '@ses/db';
import { createUnextendedClient, type UnextendedClient } from '@ses/db/testing';
import { ISOLATION_SEED_IDS, runSeed } from '@ses/db/seed';
// 🔴 期限の値は `packages/config` の 1 箇所（`limits.ts`）が出所である。テストが同じ数値を
//    書き直すと「実装とテストが同じ勘違いをする」ため、実装と同じ定数を読む。
//    ルートの devDependencies に `@ses/config` が無いため相対パスで参照する
//    （このファイルが `apps/web/lib/**` を相対で読んでいるのと同じ扱い）。
import {
  INVITATION_TTL_MS,
  PASSWORD_RESET_TTL_MS,
} from '../../packages/config/src/limits.js';
import {
  ForbiddenError,
  InvitationEmailAlreadyMemberError,
  InvitationNotAcceptableError,
  UnprocessableError,
} from '../../apps/web/lib/api/errors';
import type { AuthAttemptMeta } from '../../apps/web/lib/auth/credentials';
import {
  confirmPasswordReset,
  requestPasswordReset,
} from '../../apps/web/lib/auth/password-reset';
import { verifyPassword } from '../../apps/web/lib/auth/password';
import { generateToken, hashToken } from '../../apps/web/lib/auth/tokens';
import { buildTenantCtx } from '../../apps/web/lib/auth/tenant-context';
import {
  configureAccountMailQueue,
  PendingAccountMailQueue,
} from '../../apps/web/lib/jobs/account-mail';
import {
  acceptInvitation,
  issueInvitation as issueInvitationService,
  readInvitationByToken,
  type IssueInvitationInput,
} from '../../apps/web/lib/invitations/service';
import { INVITE_URL_NOT_DISCLOSED } from '../../apps/web/lib/invitations/invite-link';
import type { SendingDomainResolver } from '../../apps/web/lib/settings/sending-domains';
import { startIsolationDatabase, type IsolationDatabase } from './support/postgres.js';

/**
 * 🔴 T-04-05: `issueInvitation` は**送信ドメインの判定を必須引数に取る**
 *    （既定値を置くと、渡し忘れたルートだけが未検証のまま取引先へ送る経路になる）。
 *
 * 本ファイルが見るのは `F-002`（自社メンバーの招待）であり、これは共通ドメインで送るため
 * 検証状態に依存しない（`F-001 AC-5`）。したがって「検証を求めない環境」で固定してよい。
 * 🔴 **取引先宛（`F-007 AC-5`）の保留は `sending-domain-hold.test.ts` が見る。**
 */
const SENDING_DOMAIN_NOT_REQUIRED: SendingDomainResolver = async () => ({ kind: 'NOT_REQUIRED' });

async function issueInvitation(
  ctx: AuthenticatedTenantCtx,
  input: IssueInvitationInput,
  meta: AuthAttemptMeta,
  now: Date,
): Promise<{ readonly id: string; readonly deliveryState: string }> {
  // 🔴 T-04-08: 本ファイルは `sandbox` を扱わない（`F-007 AC-4` の検証は
  //    `sandbox-invite-link.test.ts`）。開示しない runtime を明示的に渡す。
  return issueInvitationService(
    ctx,
    input,
    meta,
    SENDING_DOMAIN_NOT_REQUIRED,
    () => INVITE_URL_NOT_DISCLOSED,
    now,
  );
}

const SETUP_TIMEOUT_MS = 600_000;
/** 🔴 「実行日 = T」を固定する（docs/05 §17.6）。 */
const NOW = new Date('2026-09-03T00:00:00.000Z');

const TENANT_1 = ISOLATION_SEED_IDS.tenants[0];
const TENANT_2 = ISOLATION_SEED_IDS.tenants[1];
const PARTNER_1_1 = TENANT_1.partners[0];
const PARTNER_1_2 = TENANT_1.partners[1];

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

const HOST_EMAIL_1 = 'host-t1@seed-isolation.test';
const VALID_PASSWORD = 'correct horse battery staple';

let database: IsolationDatabase;
/** 🔴 投入・前提づくり・「保存されている生の値」の確認にだけ使う特権接続。 */
let admin: UnextendedClient;
/** `account.mail` の enqueue を数えるキュー（docs/05 §13.2 の callCount と同じ用途）。 */
let mail: PendingAccountMailQueue;

async function ctxOf(
  identity: TenantIdentity,
  role: string,
): Promise<AuthenticatedTenantCtx> {
  await setRole(identity, role);
  const ctx = await buildTenantCtx(
    // 🔴 `OWNER` / `ADMIN` は 2FA が必須（`BR-30`）。設定済み + このセッションで検証済みにする。
    { ...identity, twoFactorVerified: true },
    { deviceKind: 'api' },
  );
  if (ctx === null) throw new Error('ctx を作れませんでした（前提の破綻）。');
  return ctx;
}

async function setRole(identity: TenantIdentity, role: string): Promise<void> {
  await admin.membership.updateMany({
    where: { tenantId: identity.tenantId, userId: identity.userId },
    data: { role },
  });
}

/** 2FA を「設定済み」にする（`OWNER` / `ADMIN` で ctx を作るための前提）。 */
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

async function countAudit(action: string): Promise<number> {
  return admin.auditLog.count({ where: { action } });
}

async function readAuditSummaries(action: string): Promise<string[]> {
  const rows = await admin.auditLog.findMany({ where: { action }, select: { summary: true } });
  return rows.map((row) => JSON.stringify(row.summary));
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
  await enrollTwoFactor(PARTNER_1_1.userId, TENANT_1.tenantId);
}, SETUP_TIMEOUT_MS);

afterAll(async () => {
  await disconnectTenantDb();
  await admin?.$disconnect();
  await database?.stop();
});

beforeEach(() => {
  mail = new PendingAccountMailQueue();
  configureAccountMailQueue(mail);
});

describe('🔴 F-002: 招待の発行（docs/05 §6.4 #14）', () => {
  it('ホストの ADMIN が自社メンバーを招待できる（招待行は 1 件・トークンはハッシュのみ）', async () => {
    const ctx = await ctxOf(HOST_1, 'ADMIN');
    const result = await issueInvitation(
      ctx,
      { email: 'invitee-sales@seed-isolation.test', role: 'SALES' },
      META,
      NOW,
    );

    expect(result.deliveryState).toBe('MOCKED');

    const row = await admin.invitation.findFirst({ where: { id: result.id } });
    expect(row?.tenantId).toBe(TENANT_1.tenantId);
    expect(row?.role).toBe('SALES');
    expect(row?.partnerCompanyId).toBeNull();
    expect(row?.invitedBy).toBe(TENANT_1.hostUserId);
    expect(row?.expiresAt.getTime()).toBe(NOW.getTime() + INVITATION_TTL_MS);

    // 🔴 `account.mail` が 1 件だけ積まれ、平文トークンは payload にしか無い（docs/05 §9.4）。
    expect(mail.callCount()).toBe(1);
    const job = mail.jobsOf('INVITATION')[0];
    expect(job?.targetId).toBe(result.id);
    expect(job?.tenantId).toBe(TENANT_1.tenantId);
    // 🔴 T-04-02: 宛先分類は `resolveRecipientClass` が招待行から機械的に導く（docs/05 §8.2）。
    //    ホスト所属の招待なので分類 1。呼び出し側は分類を渡していない。
    expect(job?.recipientClass).toBe('HOST_MEMBER');
    expect(row?.tokenHash).toBe(hashToken(job?.token ?? ''));
    // 🔴 DB に平文が残っていない。
    expect(row?.tokenHash).not.toBe(job?.token);
  });

  it('🔴 AC-3: 発行が監査ログに残り、summary にメールアドレスもトークンも入らない', async () => {
    const ctx = await ctxOf(HOST_1, 'OWNER');
    const before = await countAudit('invitation.create');
    await issueInvitation(
      ctx,
      { email: 'invitee-audit@seed-isolation.test', role: 'VIEWER' },
      META,
      NOW,
    );
    expect(await countAudit('invitation.create')).toBe(before + 1);

    const summaries = await readAuditSummaries('invitation.create');
    for (const summary of summaries) {
      expect(summary).not.toContain('@');
      expect(summary).not.toContain('seed-isolation.test');
    }
  });

  it.each(['SALES', 'VIEWER'])('🔴 %s は招待を発行できない（403）', async (role) => {
    const ctx = await ctxOf(HOST_1, role);
    await expect(
      issueInvitation(ctx, { email: 'x@seed-isolation.test', role: 'SALES' }, META, NOW),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it('🔴 AC-1: パートナーロール宛に取引先企業を指定しないと発行できない（422）', async () => {
    const ctx = await ctxOf(HOST_1, 'ADMIN');
    await expect(
      issueInvitation(
        ctx,
        { email: 'partner-invitee@seed-isolation.test', role: 'PARTNER_SALES' },
        META,
        NOW,
      ),
    ).rejects.toBeInstanceOf(UnprocessableError);

    // 🔴 拒否されたのだから、招待行もメールも 1 件も作られていない。
    const row = await admin.invitation.findFirst({
      where: { email: 'partner-invitee@seed-isolation.test' },
    });
    expect(row).toBeNull();
    expect(mail.callCount()).toBe(0);
  });

  it('🔴 T-04-05: パートナーロール宛は取引先企業を指定すれば発行できる（分類 2 になる）', async () => {
    const ctx = await ctxOf(HOST_1, 'ADMIN');
    const result = await issueInvitation(
      ctx,
      {
        email: 'partner-admin-invitee@seed-isolation.test',
        role: 'PARTNER_ADMIN',
        targetPartnerCompanyId: PARTNER_1_1.partnerCompanyId,
      },
      META,
      NOW,
    );

    const row = await admin.invitation.findFirst({ where: { id: result.id } });
    expect(row?.partnerCompanyId).toBe(PARTNER_1_1.partnerCompanyId);
    // 🔴 宛先分類は招待行から機械的に導かれる（docs/05 §8.2）。取引先の担当者なので分類 2。
    expect(mail.jobsOf('INVITATION')[0]?.recipientClass).toBe('PARTNER_MEMBER');
  });

  it('🔴 AC-4: PARTNER_ADMIN は他社の取引先企業を指定できない（403）', async () => {
    const ctx = await ctxOf(PARTNER_USER, 'PARTNER_ADMIN');
    await expect(
      issueInvitation(
        ctx,
        {
          email: 'other-partner@seed-isolation.test',
          role: 'PARTNER_SALES',
          targetPartnerCompanyId: PARTNER_1_2.partnerCompanyId,
        },
        META,
        NOW,
      ),
    ).rejects.toBeInstanceOf(ForbiddenError);
    expect(mail.callCount()).toBe(0);
  });

  it('🔴 AC-4: PARTNER_ADMIN はホストロールを招待できない（403）', async () => {
    const ctx = await ctxOf(PARTNER_USER, 'PARTNER_ADMIN');
    for (const role of ['OWNER', 'ADMIN', 'SALES', 'VIEWER'] as const) {
      await expect(
        issueInvitation(ctx, { email: 'x@seed-isolation.test', role }, META, NOW),
      ).rejects.toBeInstanceOf(ForbiddenError);
    }
    expect(mail.callCount()).toBe(0);
  });

  it('🔴 再発行すると旧トークンが失効する（有効なリンクを 2 本作らない）', async () => {
    const ctx = await ctxOf(HOST_1, 'ADMIN');
    const email = 'invitee-reissue@seed-isolation.test';
    await issueInvitation(ctx, { email, role: 'SALES' }, META, NOW);
    const first = mail.jobsOf('INVITATION')[0]?.token as string;

    await issueInvitation(ctx, { email, role: 'SALES' }, META, NOW);
    const second = mail.jobsOf('INVITATION')[1]?.token as string;
    expect(second).not.toBe(first);

    expect(await readInvitationByToken(first, NOW)).toMatchObject({ status: 'REVOKED' });
    expect(await readInvitationByToken(second, NOW)).toMatchObject({ status: 'VALID' });

    // 🔴 失効したリンクでは受諾できない。
    await expect(
      acceptInvitation(first, { displayName: '架空 太郎', password: VALID_PASSWORD }, META, NOW),
    ).rejects.toBeInstanceOf(InvitationNotAcceptableError);
  });
});

// 🔴 code-reviewer 指摘: `users` の `@@unique([tenantId, email])` により、すでに在籍している
//    メールアドレスへの招待は**受諾できない**。これを 500 にせず、
//    ①発行時に 422 で止め ②それでも到達した受諾を 409 に写像する、の 2 層で塞ぐ。
describe('🔴 すでに在籍しているメールアドレスへの招待（一意制約 → 4xx）', () => {
  it('発行は 422 で止まる（届いても必ず失敗する招待を作らない）', async () => {
    const ctx = await ctxOf(HOST_1, 'ADMIN');
    const before = await admin.invitation.count();

    await expect(
      issueInvitation(ctx, { email: HOST_EMAIL_1, role: 'SALES' }, META, NOW),
    ).rejects.toBeInstanceOf(InvitationEmailAlreadyMemberError);

    // 🔴 招待行もメールも 1 件も作られていない（トランザクションごと巻き戻る）。
    expect(await admin.invitation.count()).toBe(before);
    expect(mail.callCount()).toBe(0);
  });

  it('🔴 発行のガードを迂回して置かれた招待でも、受諾は 409 になり 500 にならない', async () => {
    // ホストからは C8 DIRECTORY により他パートナー所属の利用者が見えないため、
    // 発行時のガードをすり抜ける招待は現実に作られうる。ここではその状態を直接作る。
    const token = generateToken();
    await admin.invitation.create({
      data: {
        tenantId: TENANT_1.tenantId,
        email: HOST_EMAIL_1,
        role: 'SALES',
        tokenHash: hashToken(token),
        expiresAt: new Date(NOW.getTime() + INVITATION_TTL_MS),
        invitedBy: TENANT_1.hostUserId,
      },
    });

    const before = await admin.user.count();
    await expect(
      acceptInvitation(token, { displayName: '重複メール', password: VALID_PASSWORD }, META, NOW),
    ).rejects.toBeInstanceOf(InvitationNotAcceptableError);

    expect(await admin.user.count()).toBe(before);
    expect(await admin.user.count({ where: { displayName: '重複メール' } })).toBe(0);
    // 🔴 招待は受諾済みにならない（次に権限が直れば使える状態のまま）。
    const row = await admin.invitation.findFirst({ where: { tokenHash: hashToken(token) } });
    expect(row?.acceptedAt).toBeNull();
  });

  it('🔴 並行受諾は片方だけが成立する（CAS でも UNIQUE でも同じ 409）', async () => {
    const ctx = await ctxOf(HOST_1, 'ADMIN');
    await issueInvitation(
      ctx,
      { email: 'invitee-concurrent@seed-isolation.test', role: 'SALES' },
      META,
      NOW,
    );
    const token = mail.jobsOf('INVITATION')[0]?.token as string;
    const before = await admin.user.count();

    const results = await Promise.allSettled([
      acceptInvitation(token, { displayName: '同時受諾 A', password: VALID_PASSWORD }, META, NOW),
      acceptInvitation(token, { displayName: '同時受諾 B', password: VALID_PASSWORD }, META, NOW),
    ]);

    const fulfilled = results.filter((result) => result.status === 'fulfilled');
    const rejected = results.filter((result) => result.status === 'rejected');
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    // 🔴 負けた側は 500 ではなく 409（受諾できない）である。
    for (const result of rejected) {
      expect((result as PromiseRejectedResult).reason).toBeInstanceOf(InvitationNotAcceptableError);
    }

    // 🔴 利用者は 1 人しか増えない（二重登録が起きない）。
    expect(await admin.user.count()).toBe(before + 1);
    const created = await admin.user.count({
      where: { displayName: { in: ['同時受諾 A', '同時受諾 B'] } },
    });
    expect(created).toBe(1);
    expect(
      await admin.membership.count({
        where: { tenantId: TENANT_1.tenantId, user: { email: 'invitee-concurrent@seed-isolation.test' } },
      }),
    ).toBe(1);
  });
});

describe('🔴 F-002 AC-4: PARTNER_ADMIN からは自社宛の招待しか見えない', () => {
  it('他社宛・ホスト宛の招待が 1 件も現れない（RLS の C5）', async () => {
    // ホスト宛（partner_company_id IS NULL）と、他社（PARTNER_1_2）宛の招待を置く。
    await admin.invitation.createMany({
      data: [
        {
          tenantId: TENANT_1.tenantId,
          email: 'visibility-host@seed-isolation.test',
          role: 'SALES',
          partnerCompanyId: null,
          tokenHash: hashToken('visibility-host'),
          expiresAt: new Date(NOW.getTime() + INVITATION_TTL_MS),
          invitedBy: TENANT_1.hostUserId,
        },
        {
          tenantId: TENANT_1.tenantId,
          email: 'visibility-p2@seed-isolation.test',
          role: 'PARTNER_SALES',
          partnerCompanyId: PARTNER_1_2.partnerCompanyId,
          tokenHash: hashToken('visibility-p2'),
          expiresAt: new Date(NOW.getTime() + INVITATION_TTL_MS),
          invitedBy: TENANT_1.hostUserId,
        },
        {
          tenantId: TENANT_1.tenantId,
          email: 'visibility-p1@seed-isolation.test',
          role: 'PARTNER_SALES',
          partnerCompanyId: PARTNER_1_1.partnerCompanyId,
          tokenHash: hashToken('visibility-p1'),
          expiresAt: new Date(NOW.getTime() + INVITATION_TTL_MS),
          invitedBy: TENANT_1.hostUserId,
        },
      ],
    });

    const partnerCtx = await ctxOf(PARTNER_USER, 'PARTNER_ADMIN');
    const visible = await withTenant(partnerCtx, (db) =>
      db.invitation.findMany({ select: { email: true, partnerCompanyId: true } }),
    );
    expect(visible.length).toBeGreaterThan(0);
    for (const row of visible) {
      expect(row.partnerCompanyId).toBe(PARTNER_1_1.partnerCompanyId);
    }
    expect(visible.map((row) => row.email)).not.toContain('visibility-p2@seed-isolation.test');
    expect(visible.map((row) => row.email)).not.toContain('visibility-host@seed-isolation.test');

    // 対照: ホストからは同じテナントの招待がすべて見える（C5 の正の経路）。
    const hostCtx = await ctxOf(HOST_1, 'ADMIN');
    const all = await withTenant(hostCtx, (db) => db.invitation.count());
    expect(all).toBeGreaterThan(visible.length);
  });

  it('🔴 他テナントの招待はトークンを持っていても引けない（テナント越境が無い）', async () => {
    const foreign = await admin.invitation.create({
      data: {
        tenantId: TENANT_2.tenantId,
        email: 'foreign@seed-isolation.test',
        role: 'SALES',
        tokenHash: hashToken('foreign-token'),
        expiresAt: new Date(NOW.getTime() + INVITATION_TTL_MS),
        invitedBy: TENANT_2.hostUserId,
      },
      select: { id: true },
    });

    // 🔴 トークンを知っていれば「その招待だけ」は引ける（それが招待リンクの意味である）。
    //    ただし返るのは**その 1 行**であり、テナント 2 の他のデータには到達しない。
    const view = await readInvitationByToken('foreign-token', NOW);
    expect(view?.status).toBe('VALID');

    const hostCtx = await ctxOf(HOST_1, 'ADMIN');
    const leaked = await withTenant(hostCtx, (db) =>
      db.invitation.findMany({ where: { id: foreign.id }, select: { id: true } }),
    );
    expect(leaked).toEqual([]);
  });
});

describe('🔴 F-002: 招待の参照（docs/05 §6.3 #6 / S-002）', () => {
  it('有効な招待は組織名・ロール・メール・期限を返す', async () => {
    const ctx = await ctxOf(HOST_1, 'ADMIN');
    await issueInvitation(
      ctx,
      { email: 'invitee-view@seed-isolation.test', role: 'SALES' },
      META,
      NOW,
    );
    const token = mail.jobsOf('INVITATION')[0]?.token as string;

    const tenant = await admin.tenant.findFirst({
      where: { id: TENANT_1.tenantId },
      select: { name: true },
    });
    const view = await readInvitationByToken(token, NOW);
    expect(view).toEqual({
      status: 'VALID',
      tenantName: tenant?.name,
      partnerCompanyName: null,
      role: 'SALES',
      email: 'invitee-view@seed-isolation.test',
      expiresAt: new Date(NOW.getTime() + INVITATION_TTL_MS).toISOString(),
    });
  });

  it('存在しないトークンは null（404 に写像される）', async () => {
    expect(await readInvitationByToken(generateToken(), NOW)).toBeNull();
  });

  it('🔴 期限切れは組織名だけを返す（ロール・メールアドレスを出さない）', async () => {
    const token = generateToken();
    await admin.invitation.create({
      data: {
        tenantId: TENANT_1.tenantId,
        email: 'invitee-expired@seed-isolation.test',
        role: 'SALES',
        tokenHash: hashToken(token),
        expiresAt: new Date(NOW.getTime() - 1000),
        invitedBy: TENANT_1.hostUserId,
      },
    });

    const view = await readInvitationByToken(token, NOW);
    expect(view?.status).toBe('EXPIRED');
    expect(Object.keys(view ?? {}).sort()).toEqual(['status', 'tenantName']);
  });
});

describe('🔴 F-002: 招待の受諾（docs/05 §6.3 #7）', () => {
  it('受諾で利用者と所属が招待行のとおりに作られる', async () => {
    const ctx = await ctxOf(HOST_1, 'ADMIN');
    await issueInvitation(
      ctx,
      { email: 'invitee-accept@seed-isolation.test', role: 'VIEWER' },
      META,
      NOW,
    );
    const token = mail.jobsOf('INVITATION')[0]?.token as string;

    const accepted = await acceptInvitation(
      token,
      { displayName: '架空 太郎', password: VALID_PASSWORD },
      META,
      NOW,
    );
    expect(accepted.email).toBe('invitee-accept@seed-isolation.test');

    const user = await admin.user.findFirst({ where: { id: accepted.userId } });
    expect(user?.tenantId).toBe(TENANT_1.tenantId);
    expect(user?.ownerPartnerCompanyId).toBeNull();
    // 🔴 パスワードはハッシュだけが保存される（平文が DB に無い）。
    expect(user?.passwordHash).not.toContain(VALID_PASSWORD);
    expect(await verifyPassword(VALID_PASSWORD, user?.passwordHash ?? '')).toBe(true);

    const memberships = await admin.membership.findMany({ where: { userId: accepted.userId } });
    expect(memberships).toHaveLength(1);
    expect(memberships[0]?.role).toBe('VIEWER');
    expect(memberships[0]?.partnerCompanyId).toBeNull();
  });

  it('🔴 受諾は 1 回限り（acceptedAt の CAS）。2 回目は利用者を増やさない', async () => {
    const ctx = await ctxOf(HOST_1, 'ADMIN');
    await issueInvitation(
      ctx,
      { email: 'invitee-once@seed-isolation.test', role: 'SALES' },
      META,
      NOW,
    );
    const token = mail.jobsOf('INVITATION')[0]?.token as string;

    await acceptInvitation(
      token,
      { displayName: '架空 花子', password: VALID_PASSWORD },
      META,
      NOW,
    );
    const afterFirst = await admin.user.count();

    await expect(
      acceptInvitation(token, { displayName: '二重受諾', password: VALID_PASSWORD }, META, NOW),
    ).rejects.toBeInstanceOf(InvitationNotAcceptableError);

    expect(await admin.user.count()).toBe(afterFirst);
    expect(await admin.user.count({ where: { displayName: '二重受諾' } })).toBe(0);
  });

  it('🔴 期限切れのトークンでは受諾できない', async () => {
    const token = generateToken();
    await admin.invitation.create({
      data: {
        tenantId: TENANT_1.tenantId,
        email: 'invitee-expired-accept@seed-isolation.test',
        role: 'SALES',
        tokenHash: hashToken(token),
        expiresAt: new Date(NOW.getTime() - 1000),
        invitedBy: TENANT_1.hostUserId,
      },
    });
    await expect(
      acceptInvitation(token, { displayName: '期限切れ受諾', password: VALID_PASSWORD }, META, NOW),
    ).rejects.toBeInstanceOf(InvitationNotAcceptableError);
    expect(await admin.user.count({ where: { displayName: '期限切れ受諾' } })).toBe(0);
  });

  it('🔴 AC-3: 受諾が監査ログに残る（summary に PII とトークンが無い）', async () => {
    const ctx = await ctxOf(HOST_1, 'ADMIN');
    await issueInvitation(
      ctx,
      { email: 'invitee-audit2@seed-isolation.test', role: 'SALES' },
      META,
      NOW,
    );
    const token = mail.jobsOf('INVITATION')[0]?.token as string;
    const before = await countAudit('invitation.accept');

    const accepted = await acceptInvitation(
      token,
      { displayName: '見本 三郎', password: VALID_PASSWORD },
      META,
      NOW,
    );
    expect(await countAudit('invitation.accept')).toBe(before + 1);

    const row = await admin.auditLog.findFirst({
      where: { action: 'invitation.accept', actorId: accepted.userId },
      select: { tenantId: true, actorKind: true, summary: true, ipAddress: true },
    });
    expect(row?.tenantId).toBe(TENANT_1.tenantId);
    expect(row?.actorKind).toBe('USER');
    expect(row?.ipAddress).toBe('203.0.113.10');
    const summary = JSON.stringify(row?.summary);
    expect(summary).not.toContain(token);
    expect(summary).not.toContain('@');
  });

  it('🔴 AC-1（DB 側の裏取り）: パートナーロール × 取引先企業なしの招待は受諾できない', async () => {
    // アプリ層（policy.ts）を迂回して不正な招待行を直接置いても、`memberships` の CHECK 制約が
    // 受諾を成立させない（利用者も作られない = トランザクションごと巻き戻る）。
    const token = generateToken();
    await admin.invitation.create({
      data: {
        tenantId: TENANT_1.tenantId,
        email: 'invalid-partner@seed-isolation.test',
        role: 'PARTNER_SALES',
        partnerCompanyId: null,
        tokenHash: hashToken(token),
        expiresAt: new Date(NOW.getTime() + INVITATION_TTL_MS),
        invitedBy: TENANT_1.hostUserId,
      },
    });

    const before = await admin.user.count();
    await expect(
      acceptInvitation(token, { displayName: '不正な受諾', password: VALID_PASSWORD }, META, NOW),
    ).rejects.toThrow();
    expect(await admin.user.count()).toBe(before);
    expect(await admin.user.count({ where: { displayName: '不正な受諾' } })).toBe(0);
  });
});

describe('🔴 F-003: パスワード再設定（docs/05 §6.3 #5 / #5b）', () => {
  it('🔴 未知のメールアドレスでも例外にならず、メールも積まれない（存在を漏らさない）', async () => {
    await expect(
      requestPasswordReset('nobody@seed-isolation.test', META, NOW),
    ).resolves.toBeUndefined();
    expect(mail.callCount()).toBe(0);
  });

  it('既知のメールアドレスではトークンのハッシュだけが保存され、平文は payload にしか無い', async () => {
    await requestPasswordReset(HOST_EMAIL_1, META, NOW);
    expect(mail.callCount()).toBe(1);

    const job = mail.jobsOf('PASSWORD_RESET')[0];
    expect(job?.targetId).toBe(TENANT_1.hostUserId);
    // 🔴 T-04-02: 宛先分類は `Membership` から機械的に導かれる（docs/05 §8.2）。
    expect(job?.recipientClass).toBe('HOST_MEMBER');
    const user = await admin.user.findFirst({ where: { id: TENANT_1.hostUserId } });
    expect(user?.passwordResetTokenHash).toBe(hashToken(job?.token ?? ''));
    expect(user?.passwordResetTokenHash).not.toBe(job?.token);
    expect(user?.passwordResetExpiresAt?.getTime()).toBe(NOW.getTime() + PASSWORD_RESET_TTL_MS);
  });

  it('🔴 T-04-02: パートナー所属の利用者は分類 2 として導かれる（実送信側に落ちない）', async () => {
    // 🔴 判定順（②パートナー所属 → ③テナント所属）が実 DB + RLS の下でも保たれること。
    //    ここが逆転すると `sandbox` から実在の取引先企業の担当者へメールが飛ぶ
    //    （docs/02 章 7.6 NFR-ENV-1 / Issue #10）。
    await requestPasswordReset('partner-t1-p1@seed-isolation.test', META, NOW);
    expect(mail.callCount()).toBe(1);
    expect(mail.jobsOf('PASSWORD_RESET')[0]?.recipientClass).toBe('PARTNER_MEMBER');
  });

  it('🔴 AC-3: 申し込みが監査ログに残る（summary は空。PII を持たない）', async () => {
    const before = await countAudit('auth.password_reset_requested');
    await requestPasswordReset(HOST_EMAIL_1, META, NOW);
    expect(await countAudit('auth.password_reset_requested')).toBe(before + 1);
    for (const summary of await readAuditSummaries('auth.password_reset_requested')) {
      expect(summary).toBe('{}');
    }
  });

  it('確定でパスワードが変わり、トークンは 1 回限りで消える', async () => {
    await requestPasswordReset(HOST_EMAIL_1, META, NOW);
    const token = mail.jobsOf('PASSWORD_RESET')[0]?.token as string;

    const result = await confirmPasswordReset(token, 'brand new passphrase', META, NOW);
    expect(result?.userId).toBe(TENANT_1.hostUserId);

    const user = await admin.user.findFirst({ where: { id: TENANT_1.hostUserId } });
    expect(await verifyPassword('brand new passphrase', user?.passwordHash ?? '')).toBe(true);
    expect(user?.passwordResetTokenHash).toBeNull();
    expect(user?.passwordResetExpiresAt).toBeNull();

    // 🔴 2 回目は通らない（使用済み）。
    expect(await confirmPasswordReset(token, 'another passphrase', META, NOW)).toBeNull();
    expect(await countAudit('auth.password_reset_completed')).toBe(1);
  });

  it('🔴 期限切れのトークンでは確定できない', async () => {
    await requestPasswordReset(HOST_EMAIL_1, META, NOW);
    const token = mail.jobsOf('PASSWORD_RESET')[0]?.token as string;
    const afterExpiry = new Date(NOW.getTime() + PASSWORD_RESET_TTL_MS + 1000);

    expect(await confirmPasswordReset(token, 'too late passphrase', META, afterExpiry)).toBeNull();
    const user = await admin.user.findFirst({ where: { id: TENANT_1.hostUserId } });
    expect(await verifyPassword('too late passphrase', user?.passwordHash ?? '')).toBe(false);
  });

  it('🔴 存在しないトークンでは確定できない（他人のパスワードに到達しない）', async () => {
    expect(
      await confirmPasswordReset(generateToken(), 'irrelevant passphrase', META, NOW),
    ).toBeNull();
  });
});
