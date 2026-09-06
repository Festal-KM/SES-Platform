// tests/isolation/skill-sheets.test.ts
// 🔴 SP-05 T-05-06 の完了判定を **DB + RLS + CHECK 付きで**実証する（`F-011 AC-1`〜`AC-4`）:
//
//   AC-1 スキャンが `CLEAN` でない版は、共有 URL の発行・提案添付・チャット添付のいずれもできない
//        → ここでは**サーバ側の担保**（最新版になれない = 共有される版になれない）を確かめる。
//          「画面に導線が無い」ことは
//          `apps/web/app/(main)/engineers/[id]/skill-sheets/skill-sheet-screen.render.test.tsx` が
//          DOM の不在として固定する（結合テストでは「押せるボタンの有無」を検証できない）。
//   AC-2 スキャンが完了していない版は操作できない（削除もできない）
//   AC-3 感染を検出した版は隔離され、最新版にできない（ダウンロードの導線は存在しない）
//   AC-4 アップロード・版の切替・削除が `AuditLog` に残る
//
// 併せて T-05-04 の申し送り（#19 が `accountSkillSheetStorage` を呼ぶ）と、
// 申告された `objectKey` の照合（他テナント・他エンジニアのキーで確定できない）を確かめる。
//
// 🔴 実 S3 / 実 MinIO を叩かない。`createObjectStore('mock')`（E2E / `demo` と**同一のモック実装**。
//    docs/05 §13.2 / §17.5）を使う。テスト専用のモックは書かない。
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  configureTenantDb,
  disconnectTenantDb,
  readStorageBytesUsed,
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
const META = { deviceKind: 'api', ipAddress: '203.0.113.31' } as const;

const requireTenantCtxMock = vi.fn<() => Promise<AuthenticatedTenantCtx>>();

vi.mock('../../apps/web/lib/auth/session', () => ({
  requireTenantCtx: () => requireTenantCtxMock(),
  readRequestMeta: async () => META,
}));

const { buildTenantCtx } = await import('../../apps/web/lib/auth/tenant-context');
const {
  confirmSkillSheetUpload,
  deleteSkillSheet,
  issueSkillSheetUploadUrl,
  readSkillSheetVersions,
  setLatestSkillSheet,
} = await import('../../apps/web/lib/skill-sheets/service');
const confirmRoute = await import(
  '../../apps/web/app/api/(main)/engineers/[id]/skill-sheets/route'
);
const deleteRoute = await import('../../apps/web/app/api/(main)/skill-sheets/[id]/route');

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

const UPLOAD_BODY = {
  fileName: '山田 太郎 スキルシート.xlsx',
  contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  byteSize: 1_500_000,
} as const;

const AUDIT_ACTIONS = ['skill_sheet.create', 'skill_sheet.update', 'skill_sheet.delete'];

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

function deps() {
  return { objectStore: store, now: () => NOW };
}

function uploadDeps() {
  return {
    objectStore: store,
    uploadMaxBytes: 20 * 1024 * 1024,
    storageLimitBytes: 10n * 1024n * 1024n * 1024n,
    now: () => NOW,
  };
}

/**
 * 🔴 #18 → S3（モック）→ #19 の**実際の経路**で 1 版を作る。
 *    キーをテスト側で組み立てない —— 組み立てると「#18 が出したキーでしか確定できない」ことを
 *    確かめられなくなる。
 */
async function uploadVersion(
  ctx: AuthenticatedTenantCtx,
  engineerId: string,
  note: string | null = null,
): Promise<{ readonly id: string; readonly version: number; readonly objectKey: string }> {
  const ticket = await issueSkillSheetUploadUrl(ctx, engineerId, UPLOAD_BODY, uploadDeps());
  const confirmed = await confirmSkillSheetUpload(
    ctx,
    engineerId,
    { objectKey: ticket.objectKey, note },
    deps(),
    { ipAddress: META.ipAddress },
  );
  return { id: confirmed.id, version: confirmed.version, objectKey: ticket.objectKey };
}

/** スキャン結果の適用（T-05-05 の `applyFileScanResult` と同じ結果を DB 上で作る）。 */
async function setScanStatus(skillSheetId: string, scanStatus: string): Promise<void> {
  await admin.skillSheet.update({
    where: { id: skillSheetId },
    data: { scanStatus, scanUpdatedAt: NOW },
  });
}

async function skillSheetRow(id: string) {
  const row = await admin.skillSheet.findUnique({ where: { id } });
  if (row === null) throw new Error(`skill_sheets(${id}) が見つかりません（前提の破綻）。`);
  return row;
}

async function auditRows(action: string) {
  return admin.auditLog.findMany({
    where: { action },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
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
  // 🔴 E2E / demo と**同一のモック実装**（docs/05 §13.2 / §17.5）。
  store = createObjectStore('mock');
}, SETUP_TIMEOUT_MS);

afterAll(async () => {
  await disconnectTenantDb();
  await admin?.$disconnect();
  await database?.stop();
});

beforeEach(() => {
  requireTenantCtxMock.mockReset();
});

afterEach(async () => {
  await setRole(HOST_1, 'SALES');
  await setRole(PARTNER_USER_1_1, 'PARTNER_SALES');
  // 🔴 `engineer_snapshots` を先に消す（`skill_sheets` への FK は `ON DELETE RESTRICT`）。
  await admin.engineerSnapshot.deleteMany({});
  await admin.skillSheet.deleteMany({});
  await admin.usageCounter.deleteMany({ where: { metric: 'STORAGE_BYTES' } });
  await admin.auditLog.deleteMany({ where: { action: { in: AUDIT_ACTIONS } } });
  await admin.auditLog.deleteMany({ where: { action: 'engineer.view' } });
});

describe('#19 アップロードの確定（docs/05 §6.4 / §14.2）', () => {
  it('🔴 確定した版は `SCANNING` で生まれ、最新版フラグを持たない（`F-011` 処理③）', async () => {
    const ctx = await ctxOf(HOST_1, 'SALES');

    const created = await uploadVersion(ctx, TENANT_1.hostEngineerId, '2026-09 の更新');

    const row = await skillSheetRow(created.id);
    expect(row.scanStatus).toBe('SCANNING');
    expect(row.isLatest).toBe(false);
    expect(row.version).toBe(1);
    expect(row.note).toBe('2026-09 の更新');
    // 🔴 申告ではなく `head()` の実体を保存する（モックは署名時のサイズで置かれたことにする）。
    expect(row.byteSize).toBe(BigInt(UPLOAD_BODY.byteSize));
    expect(row.contentType).toBe(UPLOAD_BODY.contentType);
    // 🔴 所有パートナーは親（`engineers`）から継承される（ホストの版なので null）。
    expect(row.ownerPartnerCompanyId).toBeNull();
  });

  it('🔴 確定で `UsageCounter(STORAGE_BYTES)` に加算される（T-05-04 の申し送り）', async () => {
    const ctx = await ctxOf(HOST_1, 'SALES');

    const created = await uploadVersion(ctx, TENANT_1.hostEngineerId);

    expect(await readStorageBytesUsed(ctx, NOW)).toBe(BigInt(UPLOAD_BODY.byteSize));
    expect((await skillSheetRow(created.id)).storageCountedAt).not.toBeNull();
  });

  it('🔴 同じ `objectKey` の二重確定で版は増えず、カウンタも 1 度しか動かない', async () => {
    const ctx = await ctxOf(HOST_1, 'SALES');
    const ticket = await issueSkillSheetUploadUrl(
      ctx,
      TENANT_1.hostEngineerId,
      UPLOAD_BODY,
      uploadDeps(),
    );
    const body = { objectKey: ticket.objectKey, note: null };

    const first = await confirmSkillSheetUpload(ctx, TENANT_1.hostEngineerId, body, deps(), {
      ipAddress: META.ipAddress,
    });
    const second = await confirmSkillSheetUpload(ctx, TENANT_1.hostEngineerId, body, deps(), {
      ipAddress: META.ipAddress,
    });

    expect(second).toEqual(first);
    expect(await admin.skillSheet.count({})).toBe(1);
    expect(await readStorageBytesUsed(ctx, NOW)).toBe(BigInt(UPLOAD_BODY.byteSize));
    // 🔴 起きなかった 2 回目のアップロードを記録に残さない。
    expect(await auditRows('skill_sheet.create')).toHaveLength(1);
  });

  it('🔴 実体が置かれていないキーでは版を作らない（409。台帳に開けない版を並べない）', async () => {
    const ctx = await ctxOf(HOST_1, 'SALES');
    // 🔴 「署名は出たが、アップロードが最後まで終わらなかった」を再現する。キーはテスト側で
    //    組み立てず #18 に出させ、実体だけを取り除く（形の正しさと実体の有無を分けて確かめる）。
    const ticket = await issueSkillSheetUploadUrl(
      ctx,
      TENANT_1.hostEngineerId,
      UPLOAD_BODY,
      uploadDeps(),
    );
    await store.delete(ticket.objectKey);
    const objectKey = ticket.objectKey;

    await expect(
      confirmSkillSheetUpload(ctx, TENANT_1.hostEngineerId, { objectKey, note: null }, deps(), {
        ipAddress: META.ipAddress,
      }),
    ).rejects.toMatchObject({ code: 'SKILL_SHEET_OBJECT_MISSING', httpStatus: 409 });

    expect(await admin.skillSheet.count({})).toBe(0);
    expect(await readStorageBytesUsed(ctx, NOW)).toBe(0n);
    expect(await auditRows('skill_sheet.create')).toHaveLength(0);
  });

  it('🔴 他テナントのプレフィックスのキーは確定できない（404。行も作られない）', async () => {
    const ctx = await ctxOf(HOST_1, 'SALES');
    const otherCtx = await ctxOf(HOST_2, 'SALES');
    // 他テナントで実際に署名を出す（＝ モックのストレージには実体がある）。
    const ticket = await issueSkillSheetUploadUrl(
      otherCtx,
      TENANT_2.hostEngineerId,
      UPLOAD_BODY,
      uploadDeps(),
    );

    await expect(
      confirmSkillSheetUpload(
        ctx,
        TENANT_1.hostEngineerId,
        { objectKey: ticket.objectKey, note: null },
        deps(),
        { ipAddress: META.ipAddress },
      ),
    ).rejects.toMatchObject({ code: 'NOT_FOUND', httpStatus: 404 });

    expect(await admin.skillSheet.count({})).toBe(0);
  });

  it('🔴 別のエンジニアのキーを自分のエンジニアの版として確定できない（404）', async () => {
    const ctx = await ctxOf(HOST_1, 'SALES');
    const partnerCtx = await ctxOf(PARTNER_USER_1_1, 'PARTNER_SALES');
    const ticket = await issueSkillSheetUploadUrl(
      partnerCtx,
      PARTNER_1_1.engineerId,
      UPLOAD_BODY,
      uploadDeps(),
    );

    await expect(
      confirmSkillSheetUpload(
        ctx,
        TENANT_1.hostEngineerId,
        { objectKey: ticket.objectKey, note: null },
        deps(),
        { ipAddress: META.ipAddress },
      ),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(await admin.skillSheet.count({})).toBe(0);
  });

  it('🔴 我々が発行していない形のキーは 400（推測で補わない）', async () => {
    const ctx = await ctxOf(HOST_1, 'SALES');

    await expect(
      confirmSkillSheetUpload(
        ctx,
        TENANT_1.hostEngineerId,
        { objectKey: `t/${TENANT_1.tenantId}/contracts/x/1/a.pdf`, note: null },
        deps(),
        { ipAddress: META.ipAddress },
      ),
    ).rejects.toMatchObject({ code: 'VALIDATION', httpStatus: 400 });
  });

  it('🔴 `VIEWER` は API を直接呼んでも拒否される（`BR-31` / `F-004 AC-6`）', async () => {
    const ctx = await ctxOf(HOST_1, 'VIEWER');
    requireTenantCtxMock.mockResolvedValue(ctx);

    const response = await confirmRoute.POST(
      new Request('https://app.test/api/engineers/x/skill-sheets', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ objectKey: 't/x/skill-sheets/y/1/z.pdf' }),
      }),
      { params: Promise.resolve({ id: TENANT_1.hostEngineerId }) },
    );

    expect(response.status).toBe(403);
    expect(((await response.json()) as ErrorBody).error.code).toBe('FORBIDDEN');
    expect(await admin.skillSheet.count({})).toBe(0);
  });

  it('パートナーは自社エンジニアの版を確定でき、所有パートナーが継承される', async () => {
    const ctx = await ctxOf(PARTNER_USER_1_1, 'PARTNER_SALES');

    const created = await uploadVersion(ctx, PARTNER_1_1.engineerId);

    const row = await skillSheetRow(created.id);
    expect(row.ownerPartnerCompanyId).toBe(PARTNER_1_1.partnerCompanyId);
    expect(await readStorageBytesUsed(ctx, NOW)).toBe(BigInt(UPLOAD_BODY.byteSize));
  });
});

describe('🔴 `F-011 AC-1` / `AC-3`: `CLEAN` になった版だけが最新版になれる', () => {
  it('`CLEAN` の版は最新版にできる', async () => {
    const ctx = await ctxOf(HOST_1, 'SALES');
    const created = await uploadVersion(ctx, TENANT_1.hostEngineerId);
    await setScanStatus(created.id, 'CLEAN');

    await setLatestSkillSheet(ctx, created.id, { ipAddress: META.ipAddress });

    expect((await skillSheetRow(created.id)).isLatest).toBe(true);
  });

  it.each(['SCANNING', 'INFECTED', 'UNSCANNABLE', 'FAILED'])(
    '🔴 %s の版は最新版にできない（409。行も動かない）',
    async (scanStatus) => {
      const ctx = await ctxOf(HOST_1, 'SALES');
      const created = await uploadVersion(ctx, TENANT_1.hostEngineerId);
      await setScanStatus(created.id, scanStatus);

      await expect(
        setLatestSkillSheet(ctx, created.id, { ipAddress: META.ipAddress }),
      ).rejects.toMatchObject({ code: 'SKILL_SHEET_NOT_CLEAN', httpStatus: 409 });

      expect((await skillSheetRow(created.id)).isLatest).toBe(false);
      expect(await auditRows('skill_sheet.update')).toHaveLength(0);
    },
  );

  it('🔴 切替は 1 エンジニアにつき 1 件に収束する（前の最新版のフラグが落ちる）', async () => {
    const ctx = await ctxOf(HOST_1, 'SALES');
    const first = await uploadVersion(ctx, TENANT_1.hostEngineerId);
    await setScanStatus(first.id, 'CLEAN');
    await setLatestSkillSheet(ctx, first.id, { ipAddress: META.ipAddress });
    const second = await uploadVersion(ctx, TENANT_1.hostEngineerId);
    await setScanStatus(second.id, 'CLEAN');

    await setLatestSkillSheet(ctx, second.id, { ipAddress: META.ipAddress });

    expect((await skillSheetRow(first.id)).isLatest).toBe(false);
    expect((await skillSheetRow(second.id)).isLatest).toBe(true);
    expect(await admin.skillSheet.count({ where: { isLatest: true } })).toBe(1);
  });

  it('すでに最新版なら何も起こらない（冪等。記録も増えない）', async () => {
    const ctx = await ctxOf(HOST_1, 'SALES');
    const created = await uploadVersion(ctx, TENANT_1.hostEngineerId);
    await setScanStatus(created.id, 'CLEAN');
    await setLatestSkillSheet(ctx, created.id, { ipAddress: META.ipAddress });

    await setLatestSkillSheet(ctx, created.id, { ipAddress: META.ipAddress });

    expect(await auditRows('skill_sheet.update')).toHaveLength(1);
  });

  it('🔴 境界外の版 ID は 404（他テナント・他パートナーの版に触れない）', async () => {
    const hostCtx = await ctxOf(HOST_1, 'SALES');
    const partnerCtx = await ctxOf(PARTNER_USER_1_1, 'PARTNER_SALES');
    const partnerVersion = await uploadVersion(partnerCtx, PARTNER_1_1.engineerId);
    await setScanStatus(partnerVersion.id, 'CLEAN');

    await expect(
      setLatestSkillSheet(hostCtx, partnerVersion.id, { ipAddress: META.ipAddress }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect((await skillSheetRow(partnerVersion.id)).isLatest).toBe(false);
  });
});

describe('版の削除（`F-011 AC-2` / `AC-4`）', () => {
  it('検査が終わった版は削除でき、実体・計上・行がすべて消える', async () => {
    const ctx = await ctxOf(HOST_1, 'SALES');
    const created = await uploadVersion(ctx, TENANT_1.hostEngineerId);
    await setScanStatus(created.id, 'CLEAN');
    expect(await store.head(created.objectKey)).not.toBeNull();

    await deleteSkillSheet(ctx, created.id, deps(), { ipAddress: META.ipAddress });

    expect(await store.head(created.objectKey)).toBeNull();
    expect(await admin.skillSheet.findUnique({ where: { id: created.id } })).toBeNull();
    expect(await readStorageBytesUsed(ctx, NOW)).toBe(0n);
  });

  it('🔴 隔離された版も削除できる（検査は終わっている）', async () => {
    const ctx = await ctxOf(HOST_1, 'SALES');
    const created = await uploadVersion(ctx, TENANT_1.hostEngineerId);
    await setScanStatus(created.id, 'INFECTED');

    await deleteSkillSheet(ctx, created.id, deps(), { ipAddress: META.ipAddress });

    expect(await admin.skillSheet.findUnique({ where: { id: created.id } })).toBeNull();
  });

  it('🔴 検査中の版は削除できない（409。実体も残る）', async () => {
    const ctx = await ctxOf(HOST_1, 'SALES');
    const created = await uploadVersion(ctx, TENANT_1.hostEngineerId);

    await expect(
      deleteSkillSheet(ctx, created.id, deps(), { ipAddress: META.ipAddress }),
    ).rejects.toMatchObject({ code: 'SKILL_SHEET_SCAN_IN_PROGRESS', httpStatus: 409 });

    expect(await store.head(created.objectKey)).not.toBeNull();
    expect(await skillSheetRow(created.id)).not.toBeNull();
    expect(await readStorageBytesUsed(ctx, NOW)).toBe(BigInt(UPLOAD_BODY.byteSize));
  });

  it('🔴 提案に凍結添付された版は削除できず、S3 の実体にも触れない（409。`CLAUDE.md` §7）', async () => {
    const ctx = await ctxOf(HOST_1, 'SALES');
    const created = await uploadVersion(ctx, TENANT_1.hostEngineerId);
    await setScanStatus(created.id, 'CLEAN');
    // 🔴 SP-09 が作る形の行（提案時点の凍結情報）を前提として置く。
    await admin.engineerSnapshot.create({
      data: {
        tenantId: TENANT_1.tenantId,
        proposalId: TENANT_1.hostProposalId,
        displayName: '凍結された表示名',
        skills: [],
        careers: [],
        skillSheetId: created.id,
        frozenAt: NOW,
      },
    });
    const before = store.callCount();

    await expect(
      deleteSkillSheet(ctx, created.id, deps(), { ipAddress: META.ipAddress }),
    ).rejects.toMatchObject({ code: 'SKILL_SHEET_REFERENCED', httpStatus: 409 });

    // 🔴 これが本題である: **FK が③で止める前に①で実体が消えていない**こと。
    expect(store.callCount()).toBe(before);
    expect(await store.head(created.objectKey)).not.toBeNull();
    expect(await skillSheetRow(created.id)).not.toBeNull();
    // 計上も動かない（枠だけ空く状態を作らない）。
    expect(await readStorageBytesUsed(ctx, NOW)).toBe(BigInt(UPLOAD_BODY.byteSize));
    // 凍結情報そのものも残る（越境経路 2 の証跡）。
    expect(await admin.engineerSnapshot.count({ where: { skillSheetId: created.id } })).toBe(1);
  });

  it('🔴 境界外の版は削除できず、実体にも触れない（404）', async () => {
    const hostCtx = await ctxOf(HOST_1, 'SALES');
    const partnerCtx = await ctxOf(PARTNER_USER_1_1, 'PARTNER_SALES');
    const partnerVersion = await uploadVersion(partnerCtx, PARTNER_1_1.engineerId);
    await setScanStatus(partnerVersion.id, 'CLEAN');
    const before = store.callCount();

    await expect(
      deleteSkillSheet(hostCtx, partnerVersion.id, deps(), { ipAddress: META.ipAddress }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });

    // 🔴 見えない版の実体を消しに行かない（`ObjectStore` を 1 回も呼ばない）。
    expect(store.callCount()).toBe(before);
    expect(await store.head(partnerVersion.objectKey)).not.toBeNull();
  });

  it('🔴 `VIEWER` は削除 API を直接呼んでも拒否される', async () => {
    const salesCtx = await ctxOf(HOST_1, 'SALES');
    const created = await uploadVersion(salesCtx, TENANT_1.hostEngineerId);
    await setScanStatus(created.id, 'CLEAN');
    const viewerCtx = await ctxOf(HOST_1, 'VIEWER');
    requireTenantCtxMock.mockResolvedValue(viewerCtx);

    const response = await deleteRoute.DELETE(
      new Request(`https://app.test/api/skill-sheets/${created.id}`, { method: 'DELETE' }),
      { params: Promise.resolve({ id: created.id }) },
    );

    expect(response.status).toBe(403);
    expect(await skillSheetRow(created.id)).not.toBeNull();
  });
});

describe('🔴 `F-011 AC-4`: アップロード・版の切替・削除が監査ログに残る', () => {
  it('3 つの操作がそれぞれ記録される（`*.create` / `*.update` / `*.delete`）', async () => {
    const ctx = await ctxOf(HOST_1, 'SALES');
    const created = await uploadVersion(ctx, TENANT_1.hostEngineerId, '版のメモ');
    await setScanStatus(created.id, 'CLEAN');
    await setLatestSkillSheet(ctx, created.id, { ipAddress: META.ipAddress });
    await deleteSkillSheet(ctx, created.id, deps(), { ipAddress: META.ipAddress });

    const create = await auditRows('skill_sheet.create');
    const update = await auditRows('skill_sheet.update');
    const remove = await auditRows('skill_sheet.delete');

    expect(create).toHaveLength(1);
    expect(update).toHaveLength(1);
    expect(remove).toHaveLength(1);
    expect(create[0]?.targetType).toBe('SkillSheet');
    expect(create[0]?.targetId).toBe(created.id);
    expect(create[0]?.actorId).toBe(TENANT_1.hostUserId);
    expect(create[0]?.tenantId).toBe(TENANT_1.tenantId);
    // 🔴 版の切替は `*.update` + `summary.operation`（独自 action を作らない。docs/05 §16.1）。
    expect(update[0]?.summary).toMatchObject({ operation: 'SET_LATEST' });
  });

  it('🔴 記録に PII（版のメモ・氏名・ファイル名）を載せない（§16.2）', async () => {
    const ctx = await ctxOf(HOST_1, 'SALES');
    const created = await uploadVersion(ctx, TENANT_1.hostEngineerId, '山田さんの最新版');
    await setScanStatus(created.id, 'CLEAN');
    await deleteSkillSheet(ctx, created.id, deps(), { ipAddress: META.ipAddress });

    const serialized = JSON.stringify([
      ...(await auditRows('skill_sheet.create')),
      ...(await auditRows('skill_sheet.delete')),
    ]);
    expect(serialized).not.toContain('山田');
    expect(serialized).not.toContain('スキルシート.xlsx');
    // 🔴 オブジェクトキーも載せない（運営者にも見せない値。docs/05 §5.5）。
    expect(serialized).not.toContain(created.objectKey);
  });

  it('パートナーの操作も記録される（記録の経路がロールで分かれない）', async () => {
    const ctx = await ctxOf(PARTNER_USER_1_1, 'PARTNER_SALES');

    const created = await uploadVersion(ctx, PARTNER_1_1.engineerId);

    const rows = await auditRows('skill_sheet.create');
    expect(rows).toHaveLength(1);
    expect(rows[0]?.actorId).toBe(PARTNER_1_1.userId);
    expect(rows[0]?.targetId).toBe(created.id);
  });
});

describe('`S-008` の読み取り（版一覧）', () => {
  it('自分の版だけが新しい順に並び、閲覧が `engineer.view` として記録される', async () => {
    const ctx = await ctxOf(HOST_1, 'SALES');
    const first = await uploadVersion(ctx, TENANT_1.hostEngineerId);
    const second = await uploadVersion(ctx, TENANT_1.hostEngineerId);

    const view = await readSkillSheetVersions(ctx, TENANT_1.hostEngineerId, {
      ipAddress: META.ipAddress,
    });

    expect(view.versions.map((entry) => entry.id)).toEqual([second.id, first.id]);
    expect(view.versions[0]?.version).toBe(2);
    expect(view.versions[0]?.uploadedByName).not.toBeNull();
    // 🔴 氏名を出す画面なので、閲覧が記録されてから内容が返る（`BR-27` / `F-008 AC-4`）。
    const views = await auditRows('engineer.view');
    expect(views).toHaveLength(1);
    expect(views[0]?.summary).toMatchObject({ via: 'SKILL_SHEETS' });
  });

  it('🔴 ホストは他パートナー所有のエンジニアの版一覧に到達できない（404）', async () => {
    const hostCtx = await ctxOf(HOST_1, 'SALES');
    const partnerCtx = await ctxOf(PARTNER_USER_1_1, 'PARTNER_SALES');
    await uploadVersion(partnerCtx, PARTNER_1_1.engineerId);

    await expect(
      readSkillSheetVersions(hostCtx, PARTNER_1_1.engineerId, { ipAddress: META.ipAddress }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    // 🔴 見ていない閲覧を記録しない。
    expect(await auditRows('engineer.view')).toHaveLength(0);
  });

  it('🔴 パートナーは他社の版を 1 件も見られない（第二境界）', async () => {
    const partner1 = await ctxOf(PARTNER_USER_1_1, 'PARTNER_SALES');
    const partner2Identity: TenantIdentity = {
      tenantId: TENANT_1.tenantId,
      partnerCompanyId: PARTNER_1_2.partnerCompanyId,
      userId: PARTNER_1_2.userId,
    };
    const partner2 = await ctxOf(partner2Identity, 'PARTNER_SALES');
    await uploadVersion(partner2, PARTNER_1_2.engineerId);

    await expect(
      readSkillSheetVersions(partner1, PARTNER_1_2.engineerId, { ipAddress: META.ipAddress }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('`VIEWER` は版一覧を読める（閲覧のみ。`F-012 AC-3`）', async () => {
    const salesCtx = await ctxOf(HOST_1, 'SALES');
    await uploadVersion(salesCtx, TENANT_1.hostEngineerId);
    const viewerCtx = await ctxOf(HOST_1, 'VIEWER');

    const view = await readSkillSheetVersions(viewerCtx, TENANT_1.hostEngineerId, {
      ipAddress: META.ipAddress,
    });

    expect(view.versions).toHaveLength(1);
  });
});
