// tests/isolation/admin-sending-domains.test.ts
// `A-005` 項目 11「送信ドメインが未検証・失効のテナント」の材料 = `listUnverifiedSendingDomains`
// （`@ses/db/platform`。docs/02 `F-059 AC-5` / `F-001 AC-4` / `BR-71` / docs/05 §8.3 / §16.5）。T-11-06。
//
// 🔴 ここで実証するのは `F-059 AC-5` である（`admin-audit-logs.test.ts` / `usage-limits.test.ts` の作法。**実 DB（RLS 付き）**）:
//   ① 未検証のテナントが載り、**検証開始からの経過日数**が `now` の注入で決定的に出る（最も長く止まっているものが先頭）
//   ② 検証済みの行を 1 本でも持つテナントは載らない（別の未検証行があっても）
//   ③ 🔴 失効（`domain.recheck` と同じ書き込み = `expireSendingDomain` が `VERIFIED` から降格）が **`REVOKED`** として載り、
//      一度も検証されていない `FAILED` と区別され、失効してからの日数を別に持つ
//   ④ `CLOSING` / `SUSPENDED` は載らない。`SANDBOX` は載り、`lifecycleState` で試用中と読める
//   ⑤ `PLATFORM_SUPPORT` でも読める（書き込みは監査記録以外に 1 行も無い）
//   ⑥ 読み取りが `AuditLog(admin.monitoring.view)` に横断（`tenant_id IS NULL`）で記録される
//   ⑦ 🔴 応答に DNS レコードの値・失敗理由・業務データが無い（キー集合の固定 + 既知の値が 1 バイトも現れない。`BR-40`）
//   ⑧ 素の `app_platform` 接続で `tenant_sending_domains` の SELECT 可能列が許可リストと一致し（`roles.test.ts` ④ の作法）、
//      書き込み権限が 0 件。`app_platform_write` は `revoked_at` を持つ行を INSERT できない。CHECK が検証済み + 失効時刻を拒む
//
// 🔴 実 SES / 実 DNS に接続しない（DB の行を直接置く。検証・失効の書き込みは `@ses/db` の実関数を通す）。
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  configurePlatformReadDb,
  configureTenantDb,
  disconnectPlatformReadDb,
  disconnectTenantDb,
  expireSendingDomain,
  markSendingDomainVerified,
  resolvePlatformCtx,
  systemTenantCtx,
  type AuthenticatedPlatformCtx,
} from '@ses/db';
import { listUnverifiedSendingDomains, UNVERIFIED_SENDING_DOMAIN_STATUSES } from '@ses/db/platform';
import {
  createUnextendedClient,
  hasColumnPrivilege,
  hasTablePrivilege,
  readTableColumns,
  type UnextendedClient,
} from '@ses/db/testing';
import { TENANT_A, TENANT_B } from './support/fixtures.js';
import { PLATFORM_READ_COLUMN_ALLOWLIST } from './support/platform-grants.js';
import { startIsolationDatabase, type IsolationDatabase } from './support/postgres.js';

const SETUP_TIMEOUT_MS = 600_000;
const DAY = 86_400_000;

/** 🔴 現在時刻は注入する（経過日数を決定的にする）。 */
const NOW = new Date('2026-09-16T09:00:00.000Z');
const daysAgo = (days: number, hours = 0) => new Date(NOW.getTime() - days * DAY - hours * 3_600_000);

const OWNER_USER_ID = '01930000-0000-7000-8000-0000000000ca';
const SUPPORT_USER_ID = '01930000-0000-7000-8000-0000000000cb';

/** 追加するテナント（fixtures の A / B はどちらも `ACTIVE` で送信ドメインの行を持たない）。 */
const TENANT_REVOKED = '01930000-0000-7000-8000-0000000011a1';
const TENANT_SANDBOX = '01930000-0000-7000-8000-0000000011a2';
const TENANT_VERIFIED = '01930000-0000-7000-8000-0000000011a3';
const TENANT_CLOSING = '01930000-0000-7000-8000-0000000011a4';
const TENANT_SUSPENDED = '01930000-0000-7000-8000-0000000011a5';

const DOMAIN_B_OLD = '01930000-0000-7000-8000-0000000011d1';
const DOMAIN_B_NEW = '01930000-0000-7000-8000-0000000011d2';
const DOMAIN_REVOKED = '01930000-0000-7000-8000-0000000011d3';
const DOMAIN_SANDBOX = '01930000-0000-7000-8000-0000000011d4';
const DOMAIN_VERIFIED = '01930000-0000-7000-8000-0000000011d5';
const DOMAIN_VERIFIED_EXTRA = '01930000-0000-7000-8000-0000000011d6';
const DOMAIN_CLOSING = '01930000-0000-7000-8000-0000000011d7';
const DOMAIN_SUSPENDED = '01930000-0000-7000-8000-0000000011d8';

/** 🔴 応答に 1 バイトも現れてはならない値（DNS レコードの元・SES の識別子・失敗理由）。 */
const DKIM_TOKENS = ['dkimtok-alpha-7f3a', 'dkimtok-bravo-9c1e', 'dkimtok-charlie-2b8d'] as const;
const FORBIDDEN_STRINGS = [
  ...DKIM_TOKENS,
  'mail.revoked.example.jp',
  'arn:aws:ses:ap-northeast-1:100000000001:identity/',
  't-01930000-0000-7000-8000-0000000011a1',
  'DKIM_NOT_VERIFIED',
  'MAIL_FROM_NOT_VERIFIED',
] as const;

const META = { ipAddress: '203.0.113.30', now: NOW } as const;

/** 🔴 DTO のキー集合（固定）。増やすときは docs/05 §16.5 項目 11 と T-11-04 の画面を同時に見直す。 */
const ITEM_KEYS = [
  'daysSinceRevoked',
  'daysSinceStarted',
  'domain',
  'expectedRecords',
  'lastCheckedAt',
  'lifecycleState',
  'revokedAt',
  'startedAt',
  'status',
  'tenantId',
  'tenantName',
] as const;

let database: IsolationDatabase;
/** 🔴 仕込みと事後確認だけに使う特権接続。検証のクエリには使わない。 */
let superuser: UnextendedClient;
let ownerCtx: AuthenticatedPlatformCtx;
let supportCtx: AuthenticatedPlatformCtx;

async function insertTenant(input: {
  readonly id: string;
  readonly name: string;
  readonly environment: 'production' | 'sandbox';
  readonly lifecycleState: 'SANDBOX' | 'ACTIVE' | 'SUSPENDED' | 'CLOSING';
  readonly createdAt: Date;
}): Promise<void> {
  await superuser.$executeRaw`
    INSERT INTO tenants (id, name, environment, lifecycle_state, lifecycle_changed_at, provisioning_request_id, created_at)
    VALUES (${input.id}::uuid, ${input.name}, ${input.environment}, ${input.lifecycleState}, ${input.createdAt},
            ${`t-11-06-${input.id}`}, ${input.createdAt})`;
}

async function insertDomain(input: {
  readonly id: string;
  readonly tenantId: string;
  readonly domain: string;
  readonly state: 'REGISTERED' | 'PENDING' | 'VERIFIED';
  readonly createdAt: Date;
  readonly provisioned: boolean;
  readonly verifiedAt?: Date;
}): Promise<void> {
  const tokens = input.provisioned ? JSON.stringify([...DKIM_TOKENS]) : null;
  const mailFrom = input.provisioned ? `mail.${input.domain}` : null;
  const arn = input.provisioned
    ? `arn:aws:ses:ap-northeast-1:100000000001:identity/${input.domain}`
    : null;
  const sesTenant = input.provisioned ? `t-${input.tenantId}` : null;
  await superuser.$executeRaw`
    INSERT INTO tenant_sending_domains
      (id, tenant_id, domain, state, ses_identity_arn, ses_tenant_name, dkim_tokens, mail_from_domain,
       verified_at, last_checked_at, created_at)
    VALUES (${input.id}::uuid, ${input.tenantId}::uuid, ${input.domain}, ${input.state}, ${arn}, ${sesTenant},
            ${tokens}::jsonb, ${mailFrom}, ${input.verifiedAt ?? null}, ${input.provisioned ? input.createdAt : null},
            ${input.createdAt})`;
}

async function readDomainColumns(id: string) {
  const rows = await superuser.$queryRaw<
    Array<{ state: string; verified_at: Date | null; revoked_at: Date | null; last_checked_at: Date | null }>
  >`SELECT state, verified_at, revoked_at, last_checked_at FROM tenant_sending_domains WHERE id = ${id}::uuid`;
  return rows[0];
}

beforeAll(async () => {
  database = await startIsolationDatabase();
  superuser = createUnextendedClient(database.superuserUrl);
  configurePlatformReadDb({ datasourceUrl: database.platformUrl });
  // 🔴 検証・失効の書き込みは主平面のジョブ経路（`systemTenantCtx` + RLS）で行う（`domain.verify` / `domain.recheck` と同じ関数）。
  configureTenantDb({ datasourceUrl: database.tenantUrl });
  ownerCtx = await resolvePlatformCtx(
    { platformUserId: OWNER_USER_ID, platformRole: 'PLATFORM_OWNER', twoFactor: 'VERIFIED' },
    { deviceKind: 'desktop' },
  );
  supportCtx = await resolvePlatformCtx(
    { platformUserId: SUPPORT_USER_ID, platformRole: 'PLATFORM_SUPPORT', twoFactor: 'VERIFIED' },
    { deviceKind: 'desktop' },
  );

  // --- ① 行が無いテナント（開設時に未入力。起点はテナントの開設日時） ---
  await superuser.$executeRaw`UPDATE tenants SET created_at = ${daysAgo(40)} WHERE id = ${TENANT_A}::uuid`;

  // --- ① 2 本登録（古い FAILED〔一度も検証されていない〕+ 新しい PENDING）。起点は最初の登録、状態は最新の行 ---
  await superuser.$executeRaw`UPDATE tenants SET created_at = ${daysAgo(13)} WHERE id = ${TENANT_B}::uuid`;
  await insertDomain({
    id: DOMAIN_B_OLD,
    tenantId: TENANT_B,
    domain: 'old.tenant-b.example.jp',
    state: 'PENDING',
    createdAt: daysAgo(12),
    provisioned: true,
  });
  // `domain.verify` の不成立（`PENDING` → `FAILED`）。🔴 `revoked_at` は立たない。
  await expireSendingDomain(systemTenantCtx(TENANT_B, { queue: 'domain.verify', jobId: 'job-b-old' }), {
    id: DOMAIN_B_OLD,
    failureReason: 'DKIM_NOT_VERIFIED',
    checkedAt: daysAgo(11),
  });
  await insertDomain({
    id: DOMAIN_B_NEW,
    tenantId: TENANT_B,
    domain: 'tenant-b.example.jp',
    state: 'PENDING',
    createdAt: daysAgo(3),
    provisioned: true,
  });

  // --- ③ 失効: 検証済み → `domain.recheck` で降格 ---
  await insertTenant({
    id: TENANT_REVOKED,
    name: 'Tenant Revoked',
    environment: 'production',
    lifecycleState: 'ACTIVE',
    createdAt: daysAgo(31),
  });
  await insertDomain({
    id: DOMAIN_REVOKED,
    tenantId: TENANT_REVOKED,
    domain: 'revoked.example.jp',
    state: 'PENDING',
    createdAt: daysAgo(30),
    provisioned: true,
  });
  const jobRevoked = systemTenantCtx(TENANT_REVOKED, { queue: 'domain.recheck', jobId: 'job-revoked' });
  await markSendingDomainVerified(jobRevoked, {
    id: DOMAIN_REVOKED,
    verifiedAt: daysAgo(20),
    dkimTokens: [...DKIM_TOKENS],
    mailFromDomain: 'mail.revoked.example.jp',
  });
  await expireSendingDomain(jobRevoked, {
    id: DOMAIN_REVOKED,
    failureReason: 'MAIL_FROM_NOT_VERIFIED',
    checkedAt: daysAgo(5),
  });

  // --- ④ SANDBOX（載る）: 一度も検証されていない FAILED ---
  await insertTenant({
    id: TENANT_SANDBOX,
    name: 'Tenant Sandbox',
    environment: 'sandbox',
    lifecycleState: 'SANDBOX',
    createdAt: daysAgo(8),
  });
  await insertDomain({
    id: DOMAIN_SANDBOX,
    tenantId: TENANT_SANDBOX,
    domain: 'sandbox.example.jp',
    state: 'PENDING',
    createdAt: daysAgo(7),
    provisioned: true,
  });
  await expireSendingDomain(systemTenantCtx(TENANT_SANDBOX, { queue: 'domain.verify', jobId: 'job-sandbox' }), {
    id: DOMAIN_SANDBOX,
    failureReason: 'DKIM_NOT_VERIFIED',
    checkedAt: daysAgo(6),
  });

  // --- ② 検証済み（載らない。別に未検証の行があっても） ---
  await insertTenant({
    id: TENANT_VERIFIED,
    name: 'Tenant Verified',
    environment: 'production',
    lifecycleState: 'ACTIVE',
    createdAt: daysAgo(60),
  });
  await insertDomain({
    id: DOMAIN_VERIFIED,
    tenantId: TENANT_VERIFIED,
    domain: 'verified.example.jp',
    state: 'VERIFIED',
    createdAt: daysAgo(59),
    provisioned: true,
    verifiedAt: daysAgo(58),
  });
  await insertDomain({
    id: DOMAIN_VERIFIED_EXTRA,
    tenantId: TENANT_VERIFIED,
    domain: 'extra.verified.example.jp',
    state: 'REGISTERED',
    createdAt: daysAgo(2),
    provisioned: false,
  });

  // --- ④ CLOSING / SUSPENDED（載らない） ---
  await insertTenant({
    id: TENANT_CLOSING,
    name: 'Tenant Closing',
    environment: 'production',
    lifecycleState: 'CLOSING',
    createdAt: daysAgo(90),
  });
  await insertDomain({
    id: DOMAIN_CLOSING,
    tenantId: TENANT_CLOSING,
    domain: 'closing.example.jp',
    state: 'PENDING',
    createdAt: daysAgo(89),
    provisioned: true,
  });
  await insertTenant({
    id: TENANT_SUSPENDED,
    name: 'Tenant Suspended',
    environment: 'production',
    lifecycleState: 'SUSPENDED',
    createdAt: daysAgo(50),
  });
  await insertDomain({
    id: DOMAIN_SUSPENDED,
    tenantId: TENANT_SUSPENDED,
    domain: 'suspended.example.jp',
    state: 'REGISTERED',
    createdAt: daysAgo(49),
    provisioned: false,
  });
}, SETUP_TIMEOUT_MS);

afterAll(async () => {
  await disconnectTenantDb();
  await disconnectPlatformReadDb();
  await superuser?.$disconnect();
  await database?.stop();
}, SETUP_TIMEOUT_MS);

describe('F-059 AC-5 ①: 未検証のテナントが載り、検証開始からの経過日数が分かる', () => {
  it('🔴 母集団は 4 テナント。最も長く止まっているものが先頭（daysSinceStarted の降順）', async () => {
    const result = await listUnverifiedSendingDomains(ownerCtx, META);
    expect(result.total).toBe(4);
    expect(result.items.map((item) => [item.tenantId, item.status, item.daysSinceStarted])).toEqual([
      [TENANT_A, 'NOT_REGISTERED', 40],
      [TENANT_REVOKED, 'REVOKED', 30],
      [TENANT_B, 'PENDING', 12],
      [TENANT_SANDBOX, 'FAILED', 7],
    ]);
    expect(result.countsByStatus).toEqual({
      NOT_REGISTERED: 1,
      REGISTERED: 0,
      PENDING: 1,
      FAILED: 1,
      REVOKED: 1,
    });
  });

  it('行が無いテナント（開設時に未入力）は NOT_REGISTERED で載り、起点はテナントの開設日時。DNS レコードは 0 本', async () => {
    const { items } = await listUnverifiedSendingDomains(ownerCtx, META);
    const item = items.find((row) => row.tenantId === TENANT_A);
    expect(item).toEqual({
      tenantId: TENANT_A,
      tenantName: 'Tenant A',
      lifecycleState: 'ACTIVE',
      domain: null,
      status: 'NOT_REGISTERED',
      startedAt: daysAgo(40),
      lastCheckedAt: null,
      daysSinceStarted: 40,
      revokedAt: null,
      daysSinceRevoked: null,
      expectedRecords: 0,
    });
  });

  it('🔴 2 本登録したテナントは 1 行に畳まれ、起点は最初の登録（再登録で短く見えない）・状態は最新の行', async () => {
    const { items } = await listUnverifiedSendingDomains(ownerCtx, META);
    const item = items.find((row) => row.tenantId === TENANT_B);
    expect(item).toEqual({
      tenantId: TENANT_B,
      tenantName: 'Tenant B',
      lifecycleState: 'ACTIVE',
      domain: 'tenant-b.example.jp',
      status: 'PENDING',
      startedAt: daysAgo(12),
      lastCheckedAt: daysAgo(3),
      daysSinceStarted: 12,
      revokedAt: null,
      daysSinceRevoked: null,
      // DKIM CNAME 3 本 + MAIL FROM の MX / TXT 2 本。値は返さない（⑦）。
      expectedRecords: 5,
    });
  });

  it('経過日数は 24 時間単位の切り捨て（now を 1 時間進めても日数は変わらず、翌日に達すると 1 増える）', async () => {
    const plusOneHour = await listUnverifiedSendingDomains(ownerCtx, {
      ...META,
      now: new Date(NOW.getTime() + 3_600_000),
    });
    expect(plusOneHour.items.find((row) => row.tenantId === TENANT_A)?.daysSinceStarted).toBe(40);
    const plusOneDay = await listUnverifiedSendingDomains(ownerCtx, { ...META, now: new Date(NOW.getTime() + DAY) });
    expect(plusOneDay.items.find((row) => row.tenantId === TENANT_A)?.daysSinceStarted).toBe(41);
  });
});

describe('F-059 AC-5 ②: 検証済みの行を持つテナントは載らない', () => {
  it('VERIFIED の行を 1 本でも持てば、別に REGISTERED の行があっても母集団に入らない', async () => {
    const { items } = await listUnverifiedSendingDomains(ownerCtx, META);
    expect(items.map((row) => row.tenantId)).not.toContain(TENANT_VERIFIED);
    // 対照: その REGISTERED 行は実在する（除外が「行が無いから」ではない）。
    const extra = await readDomainColumns(DOMAIN_VERIFIED_EXTRA);
    expect(extra?.state).toBe('REGISTERED');
  });

  it('🔴 失効すると同じテナントが翌回から載る（domain.recheck の効果 = A-005 項目 11 に現れる）', async () => {
    // 🔴 このケースだけは行を書き換えるため、他の describe に影響しないよう最後に元へ戻す。
    const job = systemTenantCtx(TENANT_VERIFIED, { queue: 'domain.recheck', jobId: 'job-verified-recheck' });
    await expireSendingDomain(job, { id: DOMAIN_VERIFIED, failureReason: 'DKIM_NOT_VERIFIED', checkedAt: NOW });
    try {
      const { items } = await listUnverifiedSendingDomains(ownerCtx, META);
      const item = items.find((row) => row.tenantId === TENANT_VERIFIED);
      // 最新の行は REGISTERED（extra = 再設定中）なので status は REGISTERED。
      // 🔴 失効した行が最新でなくても `revokedAt` は全行の最大で出る —— 「以前は送れていた」事実を落とさない
      //    （T-11-04 は「REGISTERED + 失効 0 日前」を「失効後、再設定中」と読む。申し送り）。
      expect(item?.status).toBe('REGISTERED');
      expect(item?.domain).toBe('extra.verified.example.jp');
      expect(item?.daysSinceStarted).toBe(59);
      expect(item?.revokedAt).toEqual(NOW);
      expect(item?.daysSinceRevoked).toBe(0);
    } finally {
      await markSendingDomainVerified(job, {
        id: DOMAIN_VERIFIED,
        verifiedAt: daysAgo(58),
        dkimTokens: [...DKIM_TOKENS],
        mailFromDomain: 'mail.verified.example.jp',
      });
    }
    const restored = await listUnverifiedSendingDomains(ownerCtx, META);
    expect(restored.items.map((row) => row.tenantId)).not.toContain(TENANT_VERIFIED);
  });
});

describe('F-059 AC-5 ③: 失効（VERIFIED → FAILED）は REVOKED として載り、一度も検証されていない FAILED と区別される', () => {
  it('🔴 REVOKED: 失効してからの日数を別に持つ（起点 30 日 / 失効 5 日）', async () => {
    const { items } = await listUnverifiedSendingDomains(ownerCtx, META);
    const item = items.find((row) => row.tenantId === TENANT_REVOKED);
    expect(item).toEqual({
      tenantId: TENANT_REVOKED,
      tenantName: 'Tenant Revoked',
      lifecycleState: 'ACTIVE',
      domain: 'revoked.example.jp',
      status: 'REVOKED',
      startedAt: daysAgo(30),
      lastCheckedAt: daysAgo(5),
      daysSinceStarted: 30,
      revokedAt: daysAgo(5),
      daysSinceRevoked: 5,
      expectedRecords: 5,
    });
  });

  it('🔴 対照: 一度も検証されていない FAILED は revokedAt が null（daysSinceRevoked も null）', async () => {
    const { items } = await listUnverifiedSendingDomains(ownerCtx, META);
    const item = items.find((row) => row.tenantId === TENANT_SANDBOX);
    expect(item?.status).toBe('FAILED');
    expect(item?.revokedAt).toBeNull();
    expect(item?.daysSinceRevoked).toBeNull();
    expect(item?.lastCheckedAt).toEqual(daysAgo(6));
  });

  it('DB の列: expireSendingDomain は VERIFIED からの降格でだけ revoked_at を立て、PENDING からの不成立では立てない', async () => {
    expect(await readDomainColumns(DOMAIN_REVOKED)).toEqual({
      state: 'FAILED',
      verified_at: null,
      revoked_at: daysAgo(5),
      last_checked_at: daysAgo(5),
    });
    expect(await readDomainColumns(DOMAIN_B_OLD)).toEqual({
      state: 'FAILED',
      verified_at: null,
      revoked_at: null,
      last_checked_at: daysAgo(11),
    });
  });

  it('再検証（markSendingDomainVerified）で revoked_at は NULL に戻り、母集団から消える。再失効で時刻が更新される', async () => {
    const job = systemTenantCtx(TENANT_REVOKED, { queue: 'domain.recheck', jobId: 'job-revoked-again' });
    await markSendingDomainVerified(job, {
      id: DOMAIN_REVOKED,
      verifiedAt: daysAgo(4),
      dkimTokens: [...DKIM_TOKENS],
      mailFromDomain: 'mail.revoked.example.jp',
    });
    try {
      expect((await readDomainColumns(DOMAIN_REVOKED))?.revoked_at).toBeNull();
      const verified = await listUnverifiedSendingDomains(ownerCtx, META);
      expect(verified.items.map((row) => row.tenantId)).not.toContain(TENANT_REVOKED);
      expect(verified.total).toBe(3);
    } finally {
      await expireSendingDomain(job, { id: DOMAIN_REVOKED, failureReason: 'MAIL_FROM_NOT_VERIFIED', checkedAt: daysAgo(5) });
    }
    expect((await readDomainColumns(DOMAIN_REVOKED))?.revoked_at).toEqual(daysAgo(5));
  });
});

describe('F-059 AC-5 ④: 契約状態による母集団', () => {
  it('🔴 CLOSING / SUSPENDED は載らない（送れない状態であることが正常。SUSPENDED は解除で ACTIVE に戻れば載る）', async () => {
    const { items } = await listUnverifiedSendingDomains(ownerCtx, META);
    const ids = items.map((row) => row.tenantId);
    expect(ids).not.toContain(TENANT_CLOSING);
    expect(ids).not.toContain(TENANT_SUSPENDED);
  });

  it('SANDBOX は載り、lifecycleState で「試用中」と読める（本契約移行のチェックリストに検証がある。docs/05 §5.4）', async () => {
    const { items } = await listUnverifiedSendingDomains(ownerCtx, META);
    const item = items.find((row) => row.tenantId === TENANT_SANDBOX);
    expect(item?.lifecycleState).toBe('SANDBOX');
    expect(item?.status).toBe('FAILED');
    expect(item?.daysSinceStarted).toBe(7);
  });

  it('SUSPENDED → ACTIVE に戻ると同じテナントが載る', async () => {
    await superuser.$executeRaw`UPDATE tenants SET lifecycle_state = 'ACTIVE' WHERE id = ${TENANT_SUSPENDED}::uuid`;
    try {
      const { items } = await listUnverifiedSendingDomains(ownerCtx, META);
      const item = items.find((row) => row.tenantId === TENANT_SUSPENDED);
      expect(item?.status).toBe('REGISTERED');
      expect(item?.daysSinceStarted).toBe(49);
      // provision 前（REGISTERED）は DKIM が無く、提示しているのは MAIL FROM の 2 本だけ。
      expect(item?.expectedRecords).toBe(2);
    } finally {
      await superuser.$executeRaw`UPDATE tenants SET lifecycle_state = 'SUSPENDED' WHERE id = ${TENANT_SUSPENDED}::uuid`;
    }
  });
});

describe('F-059 AC-5 ⑤ / ⑥: PLATFORM_SUPPORT でも読め、読み取りが admin.monitoring.view に横断で記録される', () => {
  it('PLATFORM_SUPPORT の応答は PLATFORM_OWNER と同一', async () => {
    const [owner, support] = await Promise.all([
      listUnverifiedSendingDomains(ownerCtx, META),
      listUnverifiedSendingDomains(supportCtx, META),
    ]);
    expect(support).toEqual(owner);
  });

  it('🔴 監査ログ: actor = 運営者、tenant_id IS NULL（横断）、platformRole が summary に載る。書き込みは監査行以外に無い', async () => {
    const before = await superuser.$queryRaw<Array<{ count: bigint }>>`
      SELECT count(*) AS count FROM audit_logs WHERE action = 'admin.monitoring.view'`;
    const domainRowsBefore = await superuser.$queryRaw<Array<{ count: bigint }>>`
      SELECT count(*) AS count FROM tenant_sending_domains`;

    await listUnverifiedSendingDomains(supportCtx, META);

    const rows = await superuser.$queryRaw<
      Array<{ tenant_id: string | null; actor_kind: string; actor_id: string; ip_address: string | null; summary: Record<string, unknown> }>
    >`
      SELECT tenant_id, actor_kind, actor_id, ip_address, summary
        FROM audit_logs WHERE action = 'admin.monitoring.view' ORDER BY created_at DESC, id DESC LIMIT 1`;
    const after = await superuser.$queryRaw<Array<{ count: bigint }>>`
      SELECT count(*) AS count FROM audit_logs WHERE action = 'admin.monitoring.view'`;
    expect(Number(after[0]?.count) - Number(before[0]?.count)).toBe(1);
    expect(rows[0]).toEqual({
      tenant_id: null,
      actor_kind: 'PLATFORM_USER',
      actor_id: SUPPORT_USER_ID,
      ip_address: '203.0.113.30',
      summary: { platformRole: 'PLATFORM_SUPPORT' },
    });
    const domainRowsAfter = await superuser.$queryRaw<Array<{ count: bigint }>>`
      SELECT count(*) AS count FROM tenant_sending_domains`;
    expect(domainRowsAfter[0]?.count).toBe(domainRowsBefore[0]?.count);
  });
});

describe('F-059 AC-5 ⑦ / BR-40: 応答は検証状態と日時だけ（DNS レコードの値・失敗理由・業務データが無い）', () => {
  it('🔴 各行のキー集合が固定で、status は宣言した値集合の中', async () => {
    const result = await listUnverifiedSendingDomains(ownerCtx, META);
    expect(Object.keys(result).sort()).toEqual(['countsByStatus', 'items', 'total']);
    expect(Object.keys(result.countsByStatus).sort()).toEqual([...UNVERIFIED_SENDING_DOMAIN_STATUSES].sort());
    expect(result.items.length).toBeGreaterThan(0);
    for (const item of result.items) {
      expect(Object.keys(item).sort()).toEqual([...ITEM_KEYS]);
      expect(UNVERIFIED_SENDING_DOMAIN_STATUSES).toContain(item.status);
      expect(['SANDBOX', 'ACTIVE']).toContain(item.lifecycleState);
    }
  });

  it('🔴 DKIM トークン・MAIL FROM ドメイン・SES の ARN / テナント名・失敗理由が JSON に 1 バイトも現れない', async () => {
    const result = await listUnverifiedSendingDomains(ownerCtx, META);
    const json = JSON.stringify(result);
    for (const forbidden of FORBIDDEN_STRINGS) {
      expect(json, `応答に「${forbidden}」が含まれている`).not.toContain(forbidden);
    }
    // 対照: 検査対象の値は DB の行に実在する（検査が空振りでない）。
    const stored = await superuser.$queryRaw<Array<{ dkim_tokens: unknown; mail_from_domain: string | null; last_failure_reason: string | null }>>`
      SELECT dkim_tokens, mail_from_domain, last_failure_reason FROM tenant_sending_domains WHERE id = ${DOMAIN_REVOKED}::uuid`;
    expect(stored[0]?.dkim_tokens).toEqual([...DKIM_TOKENS]);
    expect(stored[0]?.mail_from_domain).toBe('mail.revoked.example.jp');
    expect(stored[0]?.last_failure_reason).toBe('MAIL_FROM_NOT_VERIFIED');
  });
});

describe('⑧ 第 1 層（列 GRANT）: app_platform の tenant_sending_domains は許可リストの列だけ・読み取りだけ', () => {
  it('SELECT できる列の集合が許可リストと一致し、revoked_at が含まれる（GRANT 外の列は 0 件）', async () => {
    const columns = await readTableColumns(superuser, 'tenant_sending_domains');
    expect(columns).toContain('revoked_at');
    const selectable: string[] = [];
    for (const column of columns) {
      if (await hasColumnPrivilege(superuser, 'app_platform', 'tenant_sending_domains', column, 'SELECT')) {
        selectable.push(column);
      }
    }
    expect(selectable.sort()).toEqual([...PLATFORM_READ_COLUMN_ALLOWLIST.tenant_sending_domains!].sort());
  });

  it('INSERT / UPDATE / DELETE の権限が 0 件（read-only。CLAUDE.md §10.5）', async () => {
    for (const privilege of ['INSERT', 'UPDATE', 'DELETE'] as const) {
      expect(
        await hasTablePrivilege(superuser, 'app_platform', 'tenant_sending_domains', privilege),
        `app_platform に tenant_sending_domains の ${privilege} がある`,
      ).toBe(false);
    }
    const columns = await readTableColumns(superuser, 'tenant_sending_domains');
    for (const column of columns) {
      for (const privilege of ['INSERT', 'UPDATE'] as const) {
        expect(
          await hasColumnPrivilege(superuser, 'app_platform', 'tenant_sending_domains', column, privilege),
          `app_platform に tenant_sending_domains.${column} の ${privilege} がある`,
        ).toBe(false);
      }
    }
  });

  it('実測: 素の app_platform 接続 + 両 GUC で revoked_at / verified_at / created_at が読める（GRANT が効いている）', async () => {
    const platform = createUnextendedClient(database.platformUrl);
    try {
      const rows = await platform.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT
          set_config('app.platform_user_id', 'platform-read-probe', true),
          set_config('app.target_tenant_id', '', true)`;
        return tx.$queryRaw<Array<{ id: string; revoked_at: Date | null }>>`
          SELECT id, state, verified_at, last_checked_at, revoked_at, created_at FROM tenant_sending_domains
           WHERE id = ${DOMAIN_REVOKED}::uuid`;
      });
      expect(rows).toHaveLength(1);
      expect(rows[0]?.revoked_at).toEqual(daysAgo(5));
    } finally {
      await platform.$disconnect();
    }
  });

  it('🔴 app_platform_write は revoked_at を持つ行を INSERT できない（登録の代行だけ。対照: NULL なら通る）', async () => {
    const writer = createUnextendedClient(database.platformWriteUrl);
    const NEW_ROW = '01930000-0000-7000-8000-0000000011d9';
    try {
      const insert = (revokedAt: Date | null) =>
        writer.$transaction(async (tx) => {
          await tx.$queryRaw`SELECT
            set_config('app.platform_user_id', ${OWNER_USER_ID}, true),
            set_config('app.target_tenant_id', ${TENANT_CLOSING}, true)`;
          return tx.$executeRaw`
            INSERT INTO tenant_sending_domains (id, tenant_id, domain, state, registered_by_platform_user_id, revoked_at, created_at)
            VALUES (${NEW_ROW}::uuid, ${TENANT_CLOSING}::uuid, 'by-operator.example.jp', 'REGISTERED',
                    ${OWNER_USER_ID}::uuid, ${revokedAt}, ${NOW})`;
        });
      await expect(insert(daysAgo(1))).rejects.toThrow(/row-level security/i);
      expect(await insert(null)).toBe(1);
    } finally {
      await writer.$disconnect();
      await superuser.$executeRaw`DELETE FROM tenant_sending_domains WHERE id = ${NEW_ROW}::uuid`;
    }
  });

  it('🔴 CHECK: 検証済み（verified_at あり）の行に revoked_at を残せない', async () => {
    await expect(
      superuser.$executeRaw`
        UPDATE tenant_sending_domains
           SET state = 'VERIFIED', verified_at = ${daysAgo(1)}, revoked_at = ${daysAgo(2)}
         WHERE id = ${DOMAIN_SANDBOX}::uuid`,
    ).rejects.toThrow(/tenant_sending_domains_revoked_check/);
    // 対照: 行は変わっていない。
    expect((await readDomainColumns(DOMAIN_SANDBOX))?.state).toBe('FAILED');
  });
});
