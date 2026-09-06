// tests/isolation/storage-metering.test.ts
// 🔴 SP-05 T-05-04 の完了判定を **DB + RLS 付きで**実証する:
//
//   ① 🔴 **ストレージ上限を超過していたら、署名付き URL を発行しない**（docs/05 §14.2 ③ /
//      docs/03 §4.5）。**発行してから失敗させない** —— 発行すると S3 側には書けてしまい、
//      `UsageCounter`（正）と実体がずれる。検証は「例外」だけでなく
//      **`ObjectStore` が 1 回も呼ばれていないこと**まで見る。
//   ② 🔴 **加算・減算の冪等性**。二重実行しても `UsageCounter` は 1 度しか動かない
//      （`skill_sheets.storage_counted_at` の CAS。migration 20260907000000）。
//   ③ 境界 —— 他テナント・他パートナーの版は計上できず（`NOT_FOUND`）、カウンタも動かない。
//   ④ 🔴 C2（HOST_ONLY）の例外は `STORAGE_BYTES` **だけ**である。パートナー文脈から
//      `AI_COST_USD` / `EMAIL_COUNT` は 1 行も読めない。
//
// 🔴 サービス層（`issueSkillSheetUploadUrl`）を直接呼ぶ。ルート経由にすると
//    `storageRuntime()`（`lib/db/bootstrap.ts`）が起動時 DI を初期化し、テストコンテナではなく
//    環境変数の `DATABASE_URL` へ接続しにいく（`partner-companies.test.ts` と同じ扱い）。
//    🔴 **ガードはハンドラ本体より前に走る**ため、`VIEWER` の拒否は実物のルートで観測できる。
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  accountSkillSheetStorage,
  configureTenantDb,
  disconnectTenantDb,
  readStorageBytesUsed,
  releaseSkillSheetStorage,
  withTenant,
  type AuthenticatedTenantCtx,
  type TenantIdentity,
  type TenantRole,
} from '@ses/db';
import { createUnextendedClient, type UnextendedClient } from '@ses/db/testing';
import { ISOLATION_SEED_IDS, runSeed } from '@ses/db/seed';
import { createObjectStore, type ObjectStore } from '@ses/connectors';
import { startIsolationDatabase, type IsolationDatabase } from './support/postgres.js';

const SETUP_TIMEOUT_MS = 600_000;
/** 🔴 「実行日 = T」を固定する（docs/05 §17.6）。JST では 2026-09-06。 */
const NOW = new Date('2026-09-06T00:00:00.000Z');
const NEXT_MONTH = new Date('2026-10-06T00:00:00.000Z');
/**
 * 🔴 期間キーは**テスト側で literal として持つ**（`usagePeriodKey` を呼ばない）。
 *    実装と同じ関数で期待値を作ると、暦の切り方が壊れても検出できない（`Asia/Tokyo` の月）。
 */
const PERIOD_KEY = '2026-09';
const NEXT_PERIOD_KEY = '2026-10';
const DAY_KEY = '2026-09-06';
const META = { deviceKind: 'api', ipAddress: '203.0.113.30' } as const;

const requireTenantCtxMock = vi.fn<() => Promise<AuthenticatedTenantCtx>>();

vi.mock('../../apps/web/lib/auth/session', () => ({
  requireTenantCtx: () => requireTenantCtxMock(),
  readRequestMeta: async () => META,
}));

const { buildTenantCtx } = await import('../../apps/web/lib/auth/tenant-context');
const { issueSkillSheetUploadUrl } = await import('../../apps/web/lib/skill-sheets/service');
const uploadUrlRoute = await import(
  '../../apps/web/app/api/(main)/engineers/[id]/skill-sheets/upload-url/route'
);

const TENANT_1 = ISOLATION_SEED_IDS.tenants[0];
const TENANT_2 = ISOLATION_SEED_IDS.tenants[1];
const PARTNER_1_1 = TENANT_1.partners[0];
const PARTNER_1_2 = TENANT_1.partners[1];

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
const PARTNER_USER_1_1: TenantIdentity = {
  tenantId: TENANT_1.tenantId,
  partnerCompanyId: PARTNER_1_1.partnerCompanyId,
  userId: PARTNER_1_1.userId,
};

/** 1 GiB。上限・使用量の見通しを良くするための単位。 */
const GIB = 1024n * 1024n * 1024n;
const LIMIT_BYTES = 10n * GIB;
const SHEET_BYTES = 3_000_000;

const UPLOAD_BODY = {
  fileName: '山田 太郎 スキルシート.xlsx',
  contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  byteSize: 1_500_000,
} as const;

let database: IsolationDatabase;
/** 🔴 前提づくりと事実確認だけに使う特権接続。検証のクエリには使わない。 */
let admin: UnextendedClient;
let store: ObjectStore;

type ErrorBody = { readonly error: { readonly code: string } };

async function setRole(identity: TenantIdentity, role: TenantRole): Promise<void> {
  await admin.membership.updateMany({
    where: { tenantId: identity.tenantId, userId: identity.userId },
    data: { role },
  });
}

async function ctxOf(identity: TenantIdentity, role: TenantRole): Promise<AuthenticatedTenantCtx> {
  await setRole(identity, role);
  const ctx = await buildTenantCtx({ ...identity, twoFactorVerified: true }, { deviceKind: 'api' });
  if (ctx === null) throw new Error('ctx を作れませんでした（前提の破綻）。');
  return ctx;
}

function deps(overrides: Partial<Parameters<typeof issueSkillSheetUploadUrl>[3]> = {}) {
  return {
    objectStore: store,
    uploadMaxBytes: 20 * 1024 * 1024,
    storageLimitBytes: LIMIT_BYTES,
    now: () => NOW,
    ...overrides,
  };
}

/** テナントの現在使用量（`UsageCounter(MONTH,'STORAGE_BYTES')`）を直接置く。 */
async function seedUsage(tenantId: string, value: bigint, periodKey = PERIOD_KEY): Promise<void> {
  await admin.usageCounter.create({
    data: {
      tenantId,
      periodKind: 'MONTH',
      periodKey,
      metric: 'STORAGE_BYTES',
      value: value.toString(),
      observedAt: NOW,
    },
  });
}

async function readUsageRows(tenantId: string) {
  return admin.usageCounter.findMany({
    where: { tenantId, metric: 'STORAGE_BYTES' },
    orderBy: { periodKey: 'asc' },
    select: { periodKey: true, value: true },
  });
}

/** スキルシートの版を 1 件作る（#19 が作るのと同じ行。計上は未実施 = `storage_counted_at IS NULL`）。 */
async function createSkillSheet(options: {
  readonly tenantId: string;
  readonly engineerId: string;
  readonly ownerPartnerCompanyId: string | null;
  readonly uploadedBy: string;
  readonly byteSize?: number;
}): Promise<string> {
  const row = await admin.skillSheet.create({
    data: {
      tenantId: options.tenantId,
      ownerPartnerCompanyId: options.ownerPartnerCompanyId,
      engineerId: options.engineerId,
      version: 1,
      objectKey: `t/${options.tenantId}/skill-sheets/${options.engineerId}/1/${crypto.randomUUID()}.xlsx`,
      contentType: 'application/pdf',
      byteSize: BigInt(options.byteSize ?? SHEET_BYTES),
      scanStatus: 'SCANNING',
      uploadedBy: options.uploadedBy,
      uploadedAt: NOW,
    },
    select: { id: true },
  });
  return row.id;
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
  // 🔴 E2E / demo と**同一のモック実装**を使う（docs/05 §13.2 / §17.5。テスト専用のモックを書かない）。
  store = createObjectStore('mock');
}, SETUP_TIMEOUT_MS);

afterAll(async () => {
  await disconnectTenantDb();
  await admin?.$disconnect();
  await database?.stop();
});

afterEach(async () => {
  requireTenantCtxMock.mockReset();
  await setRole(HOST_1, 'SALES');
  await setRole(PARTNER_USER_1_1, 'PARTNER_SALES');
  await admin.skillSheet.deleteMany({});
  await admin.usageCounter.deleteMany({ where: { metric: 'STORAGE_BYTES' } });
});

describe('🔴 ①上限超過なら署名付き URL を発行しない（docs/05 §14.2 / docs/03 §4.5）', () => {
  it('上限内なら発行される（対照。空振りしていないこと）', async () => {
    const ctx = await ctxOf(HOST_1, 'SALES');
    const before = store.callCount();

    const ticket = await issueSkillSheetUploadUrl(
      ctx,
      TENANT_1.hostEngineerId,
      UPLOAD_BODY,
      deps(),
    );

    expect(ticket.objectKey.startsWith(`t/${TENANT_1.tenantId}/skill-sheets/`)).toBe(true);
    expect(ticket.uploadUrl.length).toBeGreaterThan(0);
    expect(ticket.expiresIn).toBeGreaterThan(0);
    // 🔴 署名に焼き込んだサイズが、クライアントが付けるヘッダとして返る。
    expect(ticket.requiredHeaders['content-length']).toBe(String(UPLOAD_BODY.byteSize));
    expect(store.callCount()).toBe(before + 1);
  });

  it('🔴 使用量 + 申告サイズが上限を超えると発行されず、ObjectStore を 1 回も呼ばない', async () => {
    await seedUsage(TENANT_1.tenantId, LIMIT_BYTES - BigInt(UPLOAD_BODY.byteSize) + 1n);
    const ctx = await ctxOf(HOST_1, 'SALES');
    const before = store.callCount();

    await expect(
      issueSkillSheetUploadUrl(ctx, TENANT_1.hostEngineerId, UPLOAD_BODY, deps()),
    ).rejects.toMatchObject({ code: 'STORAGE_LIMIT_EXCEEDED', httpStatus: 429 });

    expect(store.callCount()).toBe(before);
  });

  it('🔴 上限判定はパートナー文脈でも効く（自社エンジニアのアップロードも同じ上限を消費する）', async () => {
    await seedUsage(TENANT_1.tenantId, LIMIT_BYTES);
    const ctx = await ctxOf(PARTNER_USER_1_1, 'PARTNER_SALES');
    const before = store.callCount();

    await expect(
      issueSkillSheetUploadUrl(ctx, PARTNER_1_1.engineerId, UPLOAD_BODY, deps()),
    ).rejects.toMatchObject({ code: 'STORAGE_LIMIT_EXCEEDED' });

    expect(store.callCount()).toBe(before);
  });

  it('🔴 `UPLOAD_MAX_BYTES` を超える申告は 413（署名を出さない）', async () => {
    const ctx = await ctxOf(HOST_1, 'SALES');
    const before = store.callCount();

    await expect(
      issueSkillSheetUploadUrl(
        ctx,
        TENANT_1.hostEngineerId,
        { ...UPLOAD_BODY, byteSize: 21 * 1024 * 1024 },
        deps(),
      ),
    ).rejects.toMatchObject({ code: 'UPLOAD_TOO_LARGE', httpStatus: 413 });

    expect(store.callCount()).toBe(before);
  });

  it('🔴 発行しても `UsageCounter` は 1 バイトも動かない（加算は確定時。docs/05 §14.2）', async () => {
    const ctx = await ctxOf(HOST_1, 'SALES');
    await issueSkillSheetUploadUrl(ctx, TENANT_1.hostEngineerId, UPLOAD_BODY, deps());
    expect(await readUsageRows(TENANT_1.tenantId)).toEqual([]);
  });

  it('🔴 境界外のエンジニアには署名を出さない（他パートナーの ID は 404）', async () => {
    const ctx = await ctxOf(PARTNER_USER_1_1, 'PARTNER_SALES');
    const before = store.callCount();

    await expect(
      issueSkillSheetUploadUrl(ctx, PARTNER_1_2.engineerId, UPLOAD_BODY, deps()),
    ).rejects.toMatchObject({ code: 'NOT_FOUND', httpStatus: 404 });
    await expect(
      issueSkillSheetUploadUrl(ctx, TENANT_2.hostEngineerId, UPLOAD_BODY, deps()),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });

    expect(store.callCount()).toBe(before);
  });

  it('🔴 `VIEWER` は API を直接呼んでも拒否される（`BR-31` / `F-004 AC-6`）', async () => {
    const ctx = await ctxOf(HOST_1, 'VIEWER');
    const before = store.callCount();
    requireTenantCtxMock.mockResolvedValue(ctx);

    const response = await uploadUrlRoute.POST(
      new Request('https://app.test/api/engineers/x/skill-sheets/upload-url', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(UPLOAD_BODY),
      }),
      { params: Promise.resolve({ id: TENANT_1.hostEngineerId }) },
    );

    expect(response.status).toBe(403);
    // 🔴 コードが `FORBIDDEN` なのは、ガードの実行順（docs/05 §6.2）で `requireRole` が
    //    `requireNotViewer` より**先**に走るためである（`VIEWER` は `#18` の許可ロールに無い）。
    //    どちらでも 403 であり、`VIEWER` に「昇格すれば実行できる」と読める応答は返らない。
    expect(((await response.json()) as ErrorBody).error.code).toBe('FORBIDDEN');
    expect(store.callCount()).toBe(before);
  });
});

describe('🔴 ②加算・減算の冪等性（migration 20260907000000 の CAS）', () => {
  it('同じ版を 2 回計上してもカウンタは 1 度しか増えない', async () => {
    const ctx = await ctxOf(HOST_1, 'SALES');
    const sheetId = await createSkillSheet({
      tenantId: TENANT_1.tenantId,
      engineerId: TENANT_1.hostEngineerId,
      ownerPartnerCompanyId: null,
      uploadedBy: TENANT_1.hostUserId,
    });

    const first = await accountSkillSheetStorage(ctx, { skillSheetId: sheetId, observedAt: NOW });
    const second = await accountSkillSheetStorage(ctx, { skillSheetId: sheetId, observedAt: NOW });

    expect(first).toEqual({
      kind: 'APPLIED',
      deltaBytes: BigInt(SHEET_BYTES),
      usedBytes: BigInt(SHEET_BYTES),
    });
    expect(second).toEqual({ kind: 'ALREADY_SETTLED' });
    expect(await readStorageBytesUsed(ctx, NOW)).toBe(BigInt(SHEET_BYTES));
    expect(await readUsageRows(TENANT_1.tenantId)).toHaveLength(1);
  });

  it('同じ版を 2 回解放してもカウンタは 1 度しか減らない', async () => {
    const ctx = await ctxOf(HOST_1, 'SALES');
    const sheetId = await createSkillSheet({
      tenantId: TENANT_1.tenantId,
      engineerId: TENANT_1.hostEngineerId,
      ownerPartnerCompanyId: null,
      uploadedBy: TENANT_1.hostUserId,
    });
    await accountSkillSheetStorage(ctx, { skillSheetId: sheetId, observedAt: NOW });

    const first = await releaseSkillSheetStorage(ctx, { skillSheetId: sheetId, observedAt: NOW });
    const second = await releaseSkillSheetStorage(ctx, { skillSheetId: sheetId, observedAt: NOW });

    expect(first).toEqual({ kind: 'APPLIED', deltaBytes: -BigInt(SHEET_BYTES), usedBytes: 0n });
    expect(second).toEqual({ kind: 'ALREADY_SETTLED' });
    expect(await readStorageBytesUsed(ctx, NOW)).toBe(0n);
  });

  it('🔴 計上していない版を解放しても減らない（S3 の削除に失敗した版で枠が空かない）', async () => {
    const ctx = await ctxOf(HOST_1, 'SALES');
    await seedUsage(TENANT_1.tenantId, 5n * GIB);
    const sheetId = await createSkillSheet({
      tenantId: TENANT_1.tenantId,
      engineerId: TENANT_1.hostEngineerId,
      ownerPartnerCompanyId: null,
      uploadedBy: TENANT_1.hostUserId,
    });

    expect(await releaseSkillSheetStorage(ctx, { skillSheetId: sheetId, observedAt: NOW })).toEqual({
      kind: 'ALREADY_SETTLED',
    });
    expect(await readStorageBytesUsed(ctx, NOW)).toBe(5n * GIB);
  });

  it('計上 → 解放 → 再計上で元に戻る（`storage_counted_at` が状態の唯一の出所）', async () => {
    const ctx = await ctxOf(HOST_1, 'SALES');
    const sheetId = await createSkillSheet({
      tenantId: TENANT_1.tenantId,
      engineerId: TENANT_1.hostEngineerId,
      ownerPartnerCompanyId: null,
      uploadedBy: TENANT_1.hostUserId,
    });

    await accountSkillSheetStorage(ctx, { skillSheetId: sheetId, observedAt: NOW });
    await releaseSkillSheetStorage(ctx, { skillSheetId: sheetId, observedAt: NOW });
    await accountSkillSheetStorage(ctx, { skillSheetId: sheetId, observedAt: NOW });

    expect(await readStorageBytesUsed(ctx, NOW)).toBe(BigInt(SHEET_BYTES));
  });

  it('🔴 パートナー文脈でも自社の版を計上できる（C2 の例外が STORAGE_BYTES に効いている）', async () => {
    const ctx = await ctxOf(PARTNER_USER_1_1, 'PARTNER_SALES');
    const sheetId = await createSkillSheet({
      tenantId: TENANT_1.tenantId,
      engineerId: PARTNER_1_1.engineerId,
      ownerPartnerCompanyId: PARTNER_1_1.partnerCompanyId,
      uploadedBy: PARTNER_1_1.userId,
    });

    expect(await accountSkillSheetStorage(ctx, { skillSheetId: sheetId, observedAt: NOW })).toEqual({
      kind: 'APPLIED',
      deltaBytes: BigInt(SHEET_BYTES),
      usedBytes: BigInt(SHEET_BYTES),
    });
  });

  it('🔴 月が変わると直前の月の値を引き継ぐ（累積ゲージ。月初に上限が消えない）', async () => {
    const ctx = await ctxOf(HOST_1, 'SALES');
    await seedUsage(TENANT_1.tenantId, 4n * GIB);
    const sheetId = await createSkillSheet({
      tenantId: TENANT_1.tenantId,
      engineerId: TENANT_1.hostEngineerId,
      ownerPartnerCompanyId: null,
      uploadedBy: TENANT_1.hostUserId,
    });

    const applied = await accountSkillSheetStorage(ctx, {
      skillSheetId: sheetId,
      observedAt: NEXT_MONTH,
    });

    expect(applied).toEqual({
      kind: 'APPLIED',
      deltaBytes: BigInt(SHEET_BYTES),
      usedBytes: 4n * GIB + BigInt(SHEET_BYTES),
    });
    // 🔴 月ごとに行を持ちつつ（月末値の固定に使う）、値は累積である。
    const rows = await readUsageRows(TENANT_1.tenantId);
    expect(rows.map((row) => row.periodKey)).toEqual([PERIOD_KEY, NEXT_PERIOD_KEY]);
    expect(await readStorageBytesUsed(ctx, NEXT_MONTH)).toBe(4n * GIB + BigInt(SHEET_BYTES));
    // 当月に行が無い時期の読み取りでも、直前の値が見える（0 に落ちない）。
    expect(await readStorageBytesUsed(ctx, NOW)).toBe(4n * GIB);
  });
});

describe('🔴 ③境界（他テナント・他パートナーの版は計上できない）', () => {
  it('他テナントの版は `NOT_FOUND` であり、どちらのカウンタも動かない', async () => {
    const hostCtx1 = await ctxOf(HOST_1, 'SALES');
    const hostCtx2 = await ctxOf(HOST_2, 'SALES');
    const sheetId = await createSkillSheet({
      tenantId: TENANT_2.tenantId,
      engineerId: TENANT_2.hostEngineerId,
      ownerPartnerCompanyId: null,
      uploadedBy: TENANT_2.hostUserId,
    });

    expect(await accountSkillSheetStorage(hostCtx1, { skillSheetId: sheetId, observedAt: NOW })).toEqual(
      { kind: 'NOT_FOUND' },
    );
    expect(await readUsageRows(TENANT_1.tenantId)).toEqual([]);
    expect(await readUsageRows(TENANT_2.tenantId)).toEqual([]);
    // 対照: 本来の所有テナントからは計上できる（境界が「何も計上できない」になっていない）。
    expect(await accountSkillSheetStorage(hostCtx2, { skillSheetId: sheetId, observedAt: NOW })).toEqual(
      { kind: 'APPLIED', deltaBytes: BigInt(SHEET_BYTES), usedBytes: BigInt(SHEET_BYTES) },
    );
  });

  it('他パートナーの版は `NOT_FOUND`（同一テナント内の第二境界）', async () => {
    const ctx = await ctxOf(PARTNER_USER_1_1, 'PARTNER_SALES');
    const sheetId = await createSkillSheet({
      tenantId: TENANT_1.tenantId,
      engineerId: PARTNER_1_2.engineerId,
      ownerPartnerCompanyId: PARTNER_1_2.partnerCompanyId,
      uploadedBy: PARTNER_1_2.userId,
    });

    expect(await accountSkillSheetStorage(ctx, { skillSheetId: sheetId, observedAt: NOW })).toEqual({
      kind: 'NOT_FOUND',
    });
    expect(await readUsageRows(TENANT_1.tenantId)).toEqual([]);
  });

  it('他テナントの使用量は読めない（`readStorageBytesUsed` は自テナントだけ）', async () => {
    await seedUsage(TENANT_2.tenantId, 7n * GIB);
    const ctx = await ctxOf(HOST_1, 'SALES');
    expect(await readStorageBytesUsed(ctx, NOW)).toBe(0n);
  });
});

describe('🔴 ④C2 の例外は STORAGE_BYTES だけ（他の metric はパートナーに見えない）', () => {
  it('パートナー文脈から AI コスト・メール通数・席数のカウンタは 1 行も読めない', async () => {
    await admin.usageCounter.createMany({
      data: [
        {
          tenantId: TENANT_1.tenantId,
          periodKind: 'DAY',
          periodKey: DAY_KEY,
          metric: 'AI_COST_USD',
          value: '12.5',
          observedAt: NOW,
        },
        {
          tenantId: TENANT_1.tenantId,
          periodKind: 'DAY',
          periodKey: DAY_KEY,
          metric: 'EMAIL_COUNT',
          value: '42',
          observedAt: NOW,
        },
      ],
    });
    await seedUsage(TENANT_1.tenantId, 2n * GIB);

    const partnerCtx = await ctxOf(PARTNER_USER_1_1, 'PARTNER_SALES');
    const visible = await withTenant(partnerCtx, async (db) =>
      db.usageCounter.findMany({ select: { metric: true } }),
    );

    expect(visible.map((row) => row.metric)).toEqual(['STORAGE_BYTES']);

    await admin.usageCounter.deleteMany({ where: { metric: { in: ['AI_COST_USD', 'EMAIL_COUNT'] } } });
  });

  it('ホスト文脈では従来どおり全 metric が見える（C2 を壊していない）', async () => {
    await seedUsage(TENANT_1.tenantId, 2n * GIB);
    await admin.usageCounter.create({
      data: {
        tenantId: TENANT_1.tenantId,
        periodKind: 'DAY',
        periodKey: DAY_KEY,
        metric: 'SEAT_COUNT',
        value: '30',
        observedAt: NOW,
      },
    });

    const hostCtx = await ctxOf(HOST_1, 'SALES');
    const visible = await withTenant(hostCtx, async (db) =>
      db.usageCounter.findMany({ select: { metric: true }, orderBy: { metric: 'asc' } }),
    );

    expect(visible.map((row) => row.metric)).toEqual(['SEAT_COUNT', 'STORAGE_BYTES']);

    await admin.usageCounter.deleteMany({ where: { metric: 'SEAT_COUNT' } });
  });
});
