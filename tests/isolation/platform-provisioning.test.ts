// tests/isolation/platform-provisioning.test.ts
// `A-014` テナントの開設（API-A4 / API-A5。docs/05 §6.9 / §10.7 / `F-001`）。T-03-10。
//
// 🔴 ここで実証するのは 5 つである:
//   ① `F-001 AC-1` テナント作成直後の既定値（自動承認 = 無効 / AI ロール承認モード = すべて
//      都度承認 / 案件の公開範囲 = 誰にも公開されない / 送信ドメイン = 未検証）
//   ② `F-001 AC-3` テナント名・プラン・環境種別・開設者が監査ログに記録される
//   ③ 🔴 **`PLATFORM_SUPPORT` は開設できない**（`CLAUDE.md` §10.1 / `BR-44` /
//      docs/02 章 4.4 の `F-001` は `PP` = `−`）。型でも実行時でも拒否される
//   ④ 冪等（`provisioningRequestId` の `UNIQUE`。docs/05 §10.7）—— 同じ要求で 2 つ目の
//      テナントが生まれない
//   ⑤ API-A5 が API-A4 と分離しており、運営者が発行できるのは**初期 `OWNER` 招待だけ**である
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  configurePlatformReadDb,
  configurePlatformWriteDb,
  PlatformRoleNotAllowedError,
  requirePlatformOwner,
  resolvePlatformCtx,
  type AuthenticatedPlatformCtx,
  type PlatformOwnerCtx,
} from '@ses/db';
import {
  issueTenantOwnerInvitation,
  listRecentProvisionings,
  provisionTenant,
  TenantProvisioningInputError,
  TenantProvisioningRequestConflictError,
} from '@ses/db/platform';
import { createUnextendedClient, type UnextendedClient } from '@ses/db/testing';
import { startIsolationDatabase, type IsolationDatabase } from './support/postgres.js';

const SETUP_TIMEOUT_MS = 600_000;

const OWNER_USER_ID = '01930000-0000-7000-8000-0000000000ba';
const SUPPORT_USER_ID = '01930000-0000-7000-8000-0000000000bb';
const NOW = new Date('2026-09-04T16:00:00.000Z');
const SANDBOX_TRIAL_DAYS = 30;

let database: IsolationDatabase;
let admin: UnextendedClient;
let ownerCtx: PlatformOwnerCtx;
let supportCtx: AuthenticatedPlatformCtx;

let sequence = 0;
function nextRequestId(): string {
  sequence += 1;
  return `t-03-10-provisioning-${sequence}`;
}

beforeAll(async () => {
  database = await startIsolationDatabase();
  admin = createUnextendedClient(database.superuserUrl);
  configurePlatformReadDb({ datasourceUrl: database.platformUrl });
  configurePlatformWriteDb({ datasourceUrl: database.platformWriteUrl });

  const resolved = await resolvePlatformCtx(
    { platformUserId: OWNER_USER_ID, platformRole: 'PLATFORM_OWNER', twoFactor: 'VERIFIED' },
    { deviceKind: 'desktop' },
  );
  requirePlatformOwner(resolved);
  ownerCtx = resolved;

  supportCtx = await resolvePlatformCtx(
    { platformUserId: SUPPORT_USER_ID, platformRole: 'PLATFORM_SUPPORT', twoFactor: 'VERIFIED' },
    { deviceKind: 'desktop' },
  );
}, SETUP_TIMEOUT_MS);

afterAll(async () => {
  await admin?.$disconnect();
  await database?.stop();
}, SETUP_TIMEOUT_MS);

describe('🔴 API-A4: PLATFORM_OWNER のみ（CLAUDE.md §10.1 / BR-44）', () => {
  it('`requirePlatformOwner` が PLATFORM_SUPPORT を拒否する（→ API では 403）', () => {
    expect(() => requirePlatformOwner(supportCtx)).toThrow(PlatformRoleNotAllowedError);
  });

  it('🔴 PLATFORM_SUPPORT の ctx で開設を試みても、テナントは 1 件も作られない', async () => {
    const before = await admin.tenant.count();
    await expect(
      provisionTenant(
        // 🔴 型を破って渡した場合でも実行時に止まることを確かめる（`as` で通らない）。
        supportCtx as PlatformOwnerCtx,
        {
          name: 'PP が作ろうとした会社',
          environment: 'production',
          lifecycleState: 'ACTIVE',
          planId: 'plan-standard',
          provisioningRequestId: nextRequestId(),
          sandboxTrialDays: SANDBOX_TRIAL_DAYS,
        },
        { now: NOW },
      ),
    ).rejects.toThrow(PlatformRoleNotAllowedError);
    expect(await admin.tenant.count()).toBe(before);
  });

  it('🔴 PLATFORM_SUPPORT は初期 OWNER 招待も発行できない', async () => {
    const before = await admin.invitation.count();
    await expect(
      issueTenantOwnerInvitation(
        supportCtx as PlatformOwnerCtx,
        '01930000-0000-7000-8000-0000000000a1',
        { email: 'pp@example.co.jp', tokenHash: 'x'.repeat(64), expiresAt: NOW },
        { now: NOW },
      ),
    ).rejects.toThrow(PlatformRoleNotAllowedError);
    expect(await admin.invitation.count()).toBe(before);
  });
});

describe('🔴 F-001 AC-1: 開設直後の既定値が危険側に倒れていない', () => {
  it('自動承認 = 無効 / AI ロール承認モードの行が 0 件 / 公開範囲の行が 0 件 / 送信ドメイン未検証', async () => {
    const created = await provisionTenant(
      ownerCtx,
      {
        name: 'AC-1 検証株式会社',
        environment: 'production',
        lifecycleState: 'ACTIVE',
        planId: 'plan-standard',
        provisioningRequestId: nextRequestId(),
        sendingDomain: 'ac1.example.co.jp',
        sandboxTrialDays: SANDBOX_TRIAL_DAYS,
      },
      { now: NOW },
    );

    const tenant = await admin.tenant.findUniqueOrThrow({ where: { id: created.id } });
    // ①自動承認 = 無効
    expect(tenant.autoApproveEnabled).toBe(false);
    expect(tenant.lifecycleState).toBe('ACTIVE');
    expect(tenant.createdByPlatformUserId).toBe(OWNER_USER_ID);
    // ②AI ロールの承認モードは「レコード無し = 都度承認」（docs/05 §3.10）
    expect(await admin.tenantRoleApprovalMode.count({ where: { tenantId: created.id } })).toBe(0);
    // ③案件の公開範囲 = 誰にも公開されない（行が 1 つも無い）
    expect(await admin.projectVisibility.count({ where: { tenantId: created.id } })).toBe(0);
    // ④送信ドメインは登録されるだけ（未検証）
    const domain = await admin.tenantSendingDomain.findFirstOrThrow({
      where: { tenantId: created.id },
    });
    expect(domain.state).toBe('REGISTERED');
    expect(domain.verifiedAt).toBeNull();
    expect(domain.registeredByPlatformUserId).toBe(OWNER_USER_ID);
    expect(created.sendingDomainRegistered).toBe(true);
  });

  it('送信ドメインは未入力でも開設できる（docs/04 §A-014 5b）', async () => {
    const created = await provisionTenant(
      ownerCtx,
      {
        name: 'ドメイン未入力株式会社',
        environment: 'production',
        lifecycleState: 'ACTIVE',
        planId: 'plan-starter',
        provisioningRequestId: nextRequestId(),
        sandboxTrialDays: SANDBOX_TRIAL_DAYS,
      },
      { now: NOW },
    );
    expect(created.sendingDomainRegistered).toBe(false);
    expect(await admin.tenantSendingDomain.count({ where: { tenantId: created.id } })).toBe(0);
  });

  it('SANDBOX で開設すると 30 日の期限が入る（CLAUDE.md §9-12 / docs/04 §A-014 セクション 3）', async () => {
    const created = await provisionTenant(
      ownerCtx,
      {
        name: '試用株式会社',
        environment: 'sandbox',
        lifecycleState: 'SANDBOX',
        planId: 'plan-trial',
        provisioningRequestId: nextRequestId(),
        sandboxTrialDays: SANDBOX_TRIAL_DAYS,
      },
      { now: NOW },
    );
    const tenant = await admin.tenant.findUniqueOrThrow({ where: { id: created.id } });
    expect(tenant.lifecycleState).toBe('SANDBOX');
    expect(tenant.sandboxExpiresAt?.toISOString()).toBe(
      new Date(NOW.getTime() + SANDBOX_TRIAL_DAYS * 24 * 60 * 60 * 1000).toISOString(),
    );
  });

  it('🔴 環境と初期状態の組み合わせが不正なら開設しない（docs/02 章 5.4）', async () => {
    const before = await admin.tenant.count();
    await expect(
      provisionTenant(
        ownerCtx,
        {
          name: '不整合株式会社',
          environment: 'sandbox',
          lifecycleState: 'ACTIVE',
          planId: 'plan-starter',
          provisioningRequestId: nextRequestId(),
          sandboxTrialDays: SANDBOX_TRIAL_DAYS,
        },
        { now: NOW },
      ),
    ).rejects.toThrow(TenantProvisioningInputError);
    expect(await admin.tenant.count()).toBe(before);
  });
});

describe('🔴 F-001 AC-3: 開設が監査ログに記録される', () => {
  it('テナント名・プラン・環境種別・開設者が残る', async () => {
    const requestId = nextRequestId();
    const created = await provisionTenant(
      ownerCtx,
      {
        name: 'AC-3 監査株式会社',
        environment: 'demo',
        lifecycleState: 'ACTIVE',
        planId: 'plan-business',
        provisioningRequestId: requestId,
        sandboxTrialDays: SANDBOX_TRIAL_DAYS,
      },
      { ipAddress: '203.0.113.10', now: NOW },
    );

    const log = await admin.auditLog.findFirstOrThrow({
      where: { action: 'admin.tenant.create', targetId: created.id },
    });
    expect(log.actorKind).toBe('PLATFORM_USER');
    expect(log.actorId).toBe(OWNER_USER_ID);
    expect(log.targetType).toBe('Tenant');
    // 🔴 テナントはこの時点でまだ実在しなかったため `tenant_id` は NULL になる
    //    （docs/05 §5.2 / T-03-09 の補正）。「何を作ったか」は `target_id` と `summary` に残る。
    expect(log.tenantId).toBeNull();

    const summary = log.summary as Record<string, unknown>;
    expect(summary.platformRole).toBe('PLATFORM_OWNER');
    const after = JSON.parse(String(summary.after)) as Record<string, unknown>;
    expect(after).toMatchObject({
      name: 'AC-3 監査株式会社',
      environment: 'demo',
      lifecycleState: 'ACTIVE',
      planId: 'plan-business',
      provisioningRequestId: requestId,
      autoApproveEnabled: false,
    });
  });
});

describe('🔴 冪等（docs/05 §10.7）', () => {
  it('同じ provisioningRequestId の 2 回目は 409 になり、2 つ目のテナントが生まれない', async () => {
    const requestId = nextRequestId();
    const input = {
      name: '冪等株式会社',
      environment: 'production',
      lifecycleState: 'ACTIVE',
      planId: 'plan-standard',
      provisioningRequestId: requestId,
      sandboxTrialDays: SANDBOX_TRIAL_DAYS,
    } as const;

    await provisionTenant(ownerCtx, input, { now: NOW });
    await expect(provisionTenant(ownerCtx, input, { now: NOW })).rejects.toThrow(
      TenantProvisioningRequestConflictError,
    );

    expect(await admin.tenant.count({ where: { provisioningRequestId: requestId } })).toBe(1);
  });
});

describe('🔴 API-A5: 初期 OWNER 招待（API-A4 と分離。docs/05 §10.7）', () => {
  it('`role=OWNER` / `invited_by IS NULL` / 発行者 = 運営者 の招待が 1 行できる', async () => {
    const created = await provisionTenant(
      ownerCtx,
      {
        name: '招待株式会社',
        environment: 'production',
        lifecycleState: 'ACTIVE',
        planId: 'plan-standard',
        provisioningRequestId: nextRequestId(),
        sandboxTrialDays: SANDBOX_TRIAL_DAYS,
      },
      { now: NOW },
    );

    const expiresAt = new Date(NOW.getTime() + 7 * 24 * 60 * 60 * 1000);
    const result = await issueTenantOwnerInvitation(
      ownerCtx,
      created.id,
      { email: 'owner@invite.example.co.jp', tokenHash: 'a'.repeat(64), expiresAt },
      { now: NOW },
    );
    expect(result).not.toBeNull();

    const invitation = await admin.invitation.findUniqueOrThrow({
      where: { id: result?.invitationId ?? '' },
    });
    expect(invitation.tenantId).toBe(created.id);
    expect(invitation.role).toBe('OWNER');
    expect(invitation.partnerCompanyId).toBeNull();
    expect(invitation.invitedBy).toBeNull();
    expect(invitation.invitedByPlatformUserId).toBe(OWNER_USER_ID);
    expect(invitation.acceptedAt).toBeNull();

    const log = await admin.auditLog.findFirstOrThrow({
      where: { action: 'admin.tenant.owner_invitation', targetId: invitation.id },
    });
    expect(log.tenantId).toBe(created.id);
    expect(log.actorId).toBe(OWNER_USER_ID);
    // 🔴 メールアドレス（PII）とトークンを summary に載せない（docs/05 §16.2 / CLAUDE.md §3.4）。
    const serialized = JSON.stringify(log.summary);
    expect(serialized).not.toContain('owner@invite.example.co.jp');
    expect(serialized).not.toContain('a'.repeat(64));
  });

  it('存在しないテナントへの招待は null（→ 404）で、招待は作られない', async () => {
    const before = await admin.invitation.count();
    const result = await issueTenantOwnerInvitation(
      ownerCtx,
      '01930000-0000-7000-8000-000000000fff',
      { email: 'nobody@example.co.jp', tokenHash: 'b'.repeat(64), expiresAt: NOW },
      { now: NOW },
    );
    expect(result).toBeNull();
    expect(await admin.invitation.count()).toBe(before);
  });
});

describe('A-014「直近の開設」（docs/04 §A-014）', () => {
  it('🔴 招待先のメールアドレスを 1 件も返さない（BR-40 / CLAUDE.md §10.5）', async () => {
    const created = await provisionTenant(
      ownerCtx,
      {
        name: '直近一覧株式会社',
        environment: 'production',
        lifecycleState: 'ACTIVE',
        planId: 'plan-standard',
        provisioningRequestId: nextRequestId(),
        sandboxTrialDays: SANDBOX_TRIAL_DAYS,
      },
      { now: NOW },
    );
    await issueTenantOwnerInvitation(
      ownerCtx,
      created.id,
      {
        email: 'secret-owner@example.co.jp',
        tokenHash: 'c'.repeat(64),
        expiresAt: new Date(NOW.getTime() + 60_000),
      },
      { now: NOW },
    );

    const items = await listRecentProvisionings(ownerCtx, { limit: 50 }, { now: NOW });
    const serialized = JSON.stringify(items);
    expect(serialized).not.toContain('secret-owner@example.co.jp');
    expect(serialized).not.toContain('c'.repeat(64));

    const row = items.find((item) => item.id === created.id);
    expect(row?.invitationState).toBe('PENDING');
    expect(row?.sendingDomainState).toBeNull();
  });

  it('招待を発行していないテナントは NOT_ISSUED として現れる（取りこぼしが見える）', async () => {
    const created = await provisionTenant(
      ownerCtx,
      {
        name: '招待忘れ株式会社',
        environment: 'production',
        lifecycleState: 'ACTIVE',
        planId: 'plan-standard',
        provisioningRequestId: nextRequestId(),
        sendingDomain: 'wasure.example.co.jp',
        sandboxTrialDays: SANDBOX_TRIAL_DAYS,
      },
      { now: NOW },
    );
    const items = await listRecentProvisionings(ownerCtx, { limit: 50 }, { now: NOW });
    const row = items.find((item) => item.id === created.id);
    expect(row?.invitationState).toBe('NOT_ISSUED');
    expect(row?.sendingDomainState).toBe('REGISTERED');
  });

  it('期限を過ぎた招待は EXPIRED として現れる', async () => {
    const created = await provisionTenant(
      ownerCtx,
      {
        name: '期限切れ株式会社',
        environment: 'production',
        lifecycleState: 'ACTIVE',
        planId: 'plan-standard',
        provisioningRequestId: nextRequestId(),
        sandboxTrialDays: SANDBOX_TRIAL_DAYS,
      },
      { now: NOW },
    );
    await issueTenantOwnerInvitation(
      ownerCtx,
      created.id,
      {
        email: 'expired@example.co.jp',
        tokenHash: 'd'.repeat(64),
        expiresAt: new Date(NOW.getTime() - 1),
      },
      { now: NOW },
    );
    const items = await listRecentProvisionings(ownerCtx, { limit: 50 }, { now: NOW });
    expect(items.find((item) => item.id === created.id)?.invitationState).toBe('EXPIRED');
  });

  it('🔴 閲覧そのものが AuditLog に記録される（F-055 AC-4 / BR-41）', async () => {
    const before = await admin.auditLog.count({
      where: { action: 'admin.tenant.list', actorId: OWNER_USER_ID },
    });
    await listRecentProvisionings(ownerCtx, { limit: 5 }, { now: NOW });
    const after = await admin.auditLog.count({
      where: { action: 'admin.tenant.list', actorId: OWNER_USER_ID },
    });
    expect(after).toBe(before + 1);
  });

  it('PLATFORM_SUPPORT も一覧は読める（閲覧は PO / PP の両方）', async () => {
    const items = await listRecentProvisionings(supportCtx, { limit: 5 }, { now: NOW });
    expect(items.length).toBeGreaterThan(0);
  });
});
