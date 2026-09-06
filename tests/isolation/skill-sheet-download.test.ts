// tests/isolation/skill-sheet-download.test.ts
// 🔴 SP-05 T-05-07 の完了判定を **DB + RLS 付きで**実証する（`F-012 AC-1`〜`AC-4`）。
//    これは `CLAUDE.md` §7 の許容 0 指標 **K-7「スキルシートの閲覧・DL で監査ログが欠落した
//    件数 = 0 件」** の本丸である。
//
//   AC-1 閲覧（#21）とダウンロード（#20）が**個別に**監査ログへ記録される（`BR-28`）。
//        経路（デスクトップ / モバイル / API）によらず記録され、**デバイス種別も残る**（§13.3）。
//   AC-2 🔴 **監査ログの書き込みが失敗したらファイルの内容が返らない**（記録なしの閲覧が
//        成立しない）。**失敗を注入して**、署名付き URL が 1 本も発行されないことを確かめる。
//   AC-3 `VIEWER` はダウンロードを実行できない（API を直接呼んでも 403）。閲覧はできる。
//   AC-4 ホスト所属の利用者は、パートナー所属エンジニアのスキルシートに `Proposal` 作成前は
//        到達できない（`BR-59`）。境界外は 404 であり、**記録も残らない**。
//
// 併せて `BR-26` / `F-011 AC-1` / `AC-3`（`CLEAN` でない版は共有 URL を発行しない）と、
// ダウンロード名に PII が載らないこと（docs/05 §14.1 の決着）を確かめる。
//
// 🔴 実 S3 を叩かない。`createObjectStore('mock')`（E2E / `demo` と**同一のモック実装**。
//    docs/05 §13.2 / §17.5）を使う。テスト専用のモックは書かない。
// ⚠️ 画面経路（デスクトップ / モバイルビューポート / 共有 URL）の E2E は **T-05-10** の範囲。
//    ここではサーバ側の記録が経路によらず 1 本の関数（`issueDownloadUrl`）を通ることを固定する。
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  configureTenantDb,
  disconnectTenantDb,
  type AuthenticatedTenantCtx,
  type DeviceKind,
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
  issueSkillSheetDownloadUrl,
  issueSkillSheetUploadUrl,
  readSkillSheetPreview,
} = await import('../../apps/web/lib/skill-sheets/service');
const downloadRoute = await import(
  '../../apps/web/app/api/(main)/skill-sheets/[id]/download-url/route'
);
const previewRoute = await import('../../apps/web/app/api/(main)/skill-sheets/[id]/preview/route');

const TENANT_1 = ISOLATION_SEED_IDS.tenants[0];
const TENANT_2 = ISOLATION_SEED_IDS.tenants[1];
const PARTNER_1_1 = TENANT_1.partners[0];

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

/** 🔴 氏名を含むファイル名を意図的に使う（ダウンロード名・監査に漏れないことの対照）。 */
const UPLOAD_BODY = {
  fileName: '山田 太郎 スキルシート.xlsx',
  contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  byteSize: 1_500_000,
} as const;

/** 版のメモ（🔴 氏名を**入れない** —— このテストは「氏名がどこにも漏れない」ことを見るため）。 */
const NOTE = '2026-09 の更新';

const VIEW_ACTION = 'skill_sheet.view';
const DOWNLOAD_ACTION = 'skill_sheet.download';
const AUDIT_ACTIONS = [VIEW_ACTION, DOWNLOAD_ACTION, 'skill_sheet.create', 'engineer.view'];

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

async function ctxOf(
  identity: TenantIdentity,
  role: TenantRole,
  deviceKind: DeviceKind = 'api',
): Promise<AuthenticatedTenantCtx> {
  await setRole(identity, role);
  const ctx = await buildTenantCtx({ ...identity, twoFactorVerified: true }, { deviceKind });
  if (ctx === null) throw new Error('ctx を作れませんでした（前提の破綻）。');
  return ctx;
}

function downloadDeps() {
  return { objectStore: store };
}

function uploadDeps() {
  return {
    objectStore: store,
    uploadMaxBytes: 20 * 1024 * 1024,
    storageLimitBytes: 10n * 1024n * 1024n * 1024n,
    now: () => NOW,
  };
}

/** 🔴 #18 → S3（モック）→ #19 の**実際の経路**で 1 版を作る（キーをテスト側で組み立てない）。 */
async function uploadVersion(
  ctx: AuthenticatedTenantCtx,
  engineerId: string,
): Promise<{ readonly id: string; readonly objectKey: string }> {
  const ticket = await issueSkillSheetUploadUrl(ctx, engineerId, UPLOAD_BODY, uploadDeps());
  const confirmed = await confirmSkillSheetUpload(
    ctx,
    engineerId,
    { objectKey: ticket.objectKey, note: NOTE },
    { objectStore: store, now: () => NOW },
    { ipAddress: META.ipAddress },
  );
  return { id: confirmed.id, objectKey: ticket.objectKey };
}

/** スキャン結果の適用（T-05-05 の `applyFileScanResult` と同じ結果を DB 上で作る）。 */
async function setScanStatus(skillSheetId: string, scanStatus: string): Promise<void> {
  await admin.skillSheet.update({
    where: { id: skillSheetId },
    data: { scanStatus, scanUpdatedAt: NOW },
  });
}

/** 🔴 `CLEAN` な版を 1 つ用意する（ダウンロードの前提）。 */
async function cleanVersion(
  ctx: AuthenticatedTenantCtx,
  engineerId: string,
): Promise<{ readonly id: string; readonly objectKey: string }> {
  const created = await uploadVersion(ctx, engineerId);
  await setScanStatus(created.id, 'CLEAN');
  return created;
}

async function auditRows(action: string) {
  return admin.auditLog.findMany({
    where: { action },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
  });
}

/**
 * 🔴 **監査ログの書き込み失敗を注入する**（`F-012 AC-2` の証明）。
 *
 * 実装に「失敗させるための seam」を作らない —— 作った時点で、その seam は
 * **記録を書かずに進める経路**そのものになる。代わりに DB 側にトリガを仕掛け、
 * アプリから見て「INSERT が通らない」状況を本物として作る。
 *
 * - `mode='raise'` … 例外（権限エラー・制約違反に相当）。トランザクションが中断する。
 * - `mode='swallow'` … 🔴 **静かに 0 行**（`BEFORE INSERT` が NULL を返す）。
 *   `writeAuditLog` の `count !== 1` 判定だけが検出できる、**最も危険な壊れ方**である。
 */
async function injectAuditFailure(action: string, mode: 'raise' | 'swallow'): Promise<void> {
  const body =
    mode === 'raise'
      ? `RAISE EXCEPTION 'injected audit failure';`
      : `RETURN NULL;`;
  await admin.$executeRawUnsafe(`
    CREATE OR REPLACE FUNCTION test_block_audit() RETURNS trigger AS $fn$
    BEGIN
      IF NEW.action = '${action}' THEN
        ${body}
      END IF;
      RETURN NEW;
    END;
    $fn$ LANGUAGE plpgsql;
  `);
  await admin.$executeRawUnsafe(`DROP TRIGGER IF EXISTS test_block_audit ON audit_logs;`);
  await admin.$executeRawUnsafe(`
    CREATE TRIGGER test_block_audit BEFORE INSERT ON audit_logs
    FOR EACH ROW EXECUTE FUNCTION test_block_audit();
  `);
}

async function removeAuditFailure(): Promise<void> {
  await admin.$executeRawUnsafe(`DROP TRIGGER IF EXISTS test_block_audit ON audit_logs;`);
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
  await removeAuditFailure();
  await setRole(HOST_1, 'SALES');
  await setRole(PARTNER_USER_1_1, 'PARTNER_SALES');
  await admin.skillSheet.deleteMany({});
  await admin.usageCounter.deleteMany({ where: { metric: 'STORAGE_BYTES' } });
  await admin.auditLog.deleteMany({ where: { action: { in: AUDIT_ACTIONS } } });
});

describe('🔴 `F-012 AC-1`: 閲覧とダウンロードが個別に記録される（`BR-28`）', () => {
  it('#21（閲覧）は `skill_sheet.view` を、#20（DL）は `skill_sheet.download` を残す', async () => {
    const ctx = await ctxOf(HOST_1, 'SALES');
    const created = await cleanVersion(ctx, TENANT_1.hostEngineerId);

    await readSkillSheetPreview(ctx, created.id, { ipAddress: META.ipAddress });
    await issueSkillSheetDownloadUrl(ctx, created.id, downloadDeps(), {
      ipAddress: META.ipAddress,
    });

    const views = await auditRows(VIEW_ACTION);
    const downloads = await auditRows(DOWNLOAD_ACTION);
    expect(views).toHaveLength(1);
    expect(downloads).toHaveLength(1);
    // 🔴 「見ただけ」と「持ち出した」を 1 つの action に畳まない。
    expect(views[0]?.targetType).toBe('SkillSheet');
    expect(views[0]?.targetId).toBe(created.id);
    expect(views[0]?.actorId).toBe(TENANT_1.hostUserId);
    expect(views[0]?.tenantId).toBe(TENANT_1.tenantId);
    expect(downloads[0]?.targetId).toBe(created.id);
    expect(downloads[0]?.actorId).toBe(TENANT_1.hostUserId);
  });

  it('🔴 同じ版を 2 回ダウンロードすれば 2 件残る（回数がそのまま残る）', async () => {
    const ctx = await ctxOf(HOST_1, 'SALES');
    const created = await cleanVersion(ctx, TENANT_1.hostEngineerId);

    await issueSkillSheetDownloadUrl(ctx, created.id, downloadDeps(), {
      ipAddress: META.ipAddress,
    });
    await issueSkillSheetDownloadUrl(ctx, created.id, downloadDeps(), {
      ipAddress: META.ipAddress,
    });

    expect(await auditRows(DOWNLOAD_ACTION)).toHaveLength(2);
  });

  it.each(['desktop', 'mobile', 'tablet', 'api'] as const)(
    '🔴 %s のいずれの経路でも記録され、デバイス種別が残る（`CLAUDE.md` §13.3）',
    async (deviceKind) => {
      const ctx = await ctxOf(HOST_1, 'SALES', deviceKind);
      const created = await cleanVersion(ctx, TENANT_1.hostEngineerId);

      await readSkillSheetPreview(ctx, created.id, { ipAddress: META.ipAddress });
      await issueSkillSheetDownloadUrl(ctx, created.id, downloadDeps(), {
        ipAddress: META.ipAddress,
      });

      // 🔴 「モバイルだけ記録が漏れる」実装にしない（記録の経路がデバイスで分岐していない）。
      expect((await auditRows(VIEW_ACTION))[0]?.deviceKind).toBe(deviceKind);
      expect((await auditRows(DOWNLOAD_ACTION))[0]?.deviceKind).toBe(deviceKind);
      expect((await auditRows(DOWNLOAD_ACTION))[0]?.ipAddress).toBe(META.ipAddress);
    },
  );

  it('パートナーの閲覧・DL も同じ経路で記録される（ロールで記録が分かれない）', async () => {
    const ctx = await ctxOf(PARTNER_USER_1_1, 'PARTNER_SALES');
    const created = await cleanVersion(ctx, PARTNER_1_1.engineerId);

    await readSkillSheetPreview(ctx, created.id, { ipAddress: META.ipAddress });
    await issueSkillSheetDownloadUrl(ctx, created.id, downloadDeps(), {
      ipAddress: META.ipAddress,
    });

    expect((await auditRows(VIEW_ACTION))[0]?.actorId).toBe(PARTNER_1_1.userId);
    expect((await auditRows(DOWNLOAD_ACTION))[0]?.actorId).toBe(PARTNER_1_1.userId);
  });

  it('🔴 記録に PII を載せない（氏名・メモ・ファイル名・オブジェクトキー。§16.2 / §5.5）', async () => {
    const ctx = await ctxOf(HOST_1, 'SALES');
    const created = await cleanVersion(ctx, TENANT_1.hostEngineerId);

    await readSkillSheetPreview(ctx, created.id, { ipAddress: META.ipAddress });
    await issueSkillSheetDownloadUrl(ctx, created.id, downloadDeps(), {
      ipAddress: META.ipAddress,
    });

    const serialized = JSON.stringify([
      ...(await auditRows(VIEW_ACTION)),
      ...(await auditRows(DOWNLOAD_ACTION)),
    ]);
    expect(serialized).not.toContain('山田');
    expect(serialized).not.toContain('スキルシート.xlsx');
    expect(serialized).not.toContain(created.objectKey);
  });
});

describe('🔴 `F-012 AC-2`: 監査の書き込みが失敗したらファイルが返らない（注入テスト）', () => {
  it.each(['raise', 'swallow'] as const)(
    '🔴 %s で失敗させると DL の署名付き URL が 1 本も発行されない',
    async (mode) => {
      const ctx = await ctxOf(HOST_1, 'SALES');
      const created = await cleanVersion(ctx, TENANT_1.hostEngineerId);
      await injectAuditFailure(DOWNLOAD_ACTION, mode);
      const before = store.callCount();

      await expect(
        issueSkillSheetDownloadUrl(ctx, created.id, downloadDeps(), {
          ipAddress: META.ipAddress,
        }),
      ).rejects.toThrow();

      // 🔴 これが本題である: **`presignGet` に到達していない。** 署名付き URL は発行した
      //    時点で有効であり、後から「記録できなかったので無効にします」ができない。
      expect(store.callCount()).toBe(before);
      expect(await auditRows(DOWNLOAD_ACTION)).toHaveLength(0);
    },
  );

  it('🔴 閲覧（#21）も同じ（記録できなければメタデータを返さない）', async () => {
    const ctx = await ctxOf(HOST_1, 'SALES');
    const created = await cleanVersion(ctx, TENANT_1.hostEngineerId);
    await injectAuditFailure(VIEW_ACTION, 'swallow');

    await expect(
      readSkillSheetPreview(ctx, created.id, { ipAddress: META.ipAddress }),
    ).rejects.toThrow();
    expect(await auditRows(VIEW_ACTION)).toHaveLength(0);
  });

  it('🔴 静かな 0 行は `AUDIT_WRITE_FAILED`（500）として現れる（握り潰さない）', async () => {
    const ctx = await ctxOf(HOST_1, 'SALES');
    const created = await cleanVersion(ctx, TENANT_1.hostEngineerId);
    await injectAuditFailure(VIEW_ACTION, 'swallow');
    requireTenantCtxMock.mockResolvedValue(ctx);

    const response = await previewRoute.GET(
      new Request(`https://app.test/api/skill-sheets/${created.id}/preview`),
      { params: Promise.resolve({ id: created.id }) },
    );

    expect(response.status).toBe(500);
    expect(((await response.json()) as ErrorBody).error.code).toBe('AUDIT_WRITE_FAILED');
  });

  it('🔴 対照: 注入を外せば発行される（テストが「常に失敗」で通っていない）', async () => {
    const ctx = await ctxOf(HOST_1, 'SALES');
    const created = await cleanVersion(ctx, TENANT_1.hostEngineerId);

    const ticket = await issueSkillSheetDownloadUrl(ctx, created.id, downloadDeps(), {
      ipAddress: META.ipAddress,
    });

    expect(ticket.url).toContain('mock-object-store:');
    expect(ticket.expiresIn).toBe(300);
    expect(await auditRows(DOWNLOAD_ACTION)).toHaveLength(1);
  });
});

describe('🔴 `BR-26` / `F-011 AC-1` `AC-3`: `CLEAN` でない版は共有 URL を発行しない', () => {
  it.each(['SCANNING', 'INFECTED', 'UNSCANNABLE', 'FAILED'])(
    '🔴 %s の版は 409 で拒否され、署名も記録も残らない',
    async (scanStatus) => {
      const ctx = await ctxOf(HOST_1, 'SALES');
      const created = await uploadVersion(ctx, TENANT_1.hostEngineerId);
      await setScanStatus(created.id, scanStatus);
      const before = store.callCount();

      await expect(
        issueSkillSheetDownloadUrl(ctx, created.id, downloadDeps(), {
          ipAddress: META.ipAddress,
        }),
      ).rejects.toMatchObject({ code: 'FILE_NOT_CLEAN', httpStatus: 409 });

      expect(store.callCount()).toBe(before);
      // 🔴 発行されなかった DL を記録に残さない（`S-041` に「実際には渡っていない行」を混ぜない）。
      expect(await auditRows(DOWNLOAD_ACTION)).toHaveLength(0);
    },
  );

  it.each(['SCANNING', 'INFECTED', 'UNSCANNABLE', 'FAILED'])(
    '🔴 %s でも版の情報（#21）は開ける（本文は返らないので隔離の説明ができる）',
    async (scanStatus) => {
      const ctx = await ctxOf(HOST_1, 'SALES');
      const created = await uploadVersion(ctx, TENANT_1.hostEngineerId);
      await setScanStatus(created.id, scanStatus);

      const preview = await readSkillSheetPreview(ctx, created.id, {
        ipAddress: META.ipAddress,
      });

      expect(preview.scanStatus).toBe(scanStatus);
      expect(await auditRows(VIEW_ACTION)).toHaveLength(1);
    },
  );

  it('🔴 プレビューの応答にオブジェクトキー・本文が含まれない（docs/05 §6.4 #21）', async () => {
    const ctx = await ctxOf(HOST_1, 'SALES');
    const created = await cleanVersion(ctx, TENANT_1.hostEngineerId);

    const preview = await readSkillSheetPreview(ctx, created.id, { ipAddress: META.ipAddress });

    expect(JSON.stringify(preview)).not.toContain(created.objectKey);
    expect(Object.keys(preview).sort()).toEqual(
      [
        'byteSize',
        'contentType',
        'engineerId',
        'id',
        'isLatest',
        'note',
        'scanStatus',
        'uploadedAt',
        'uploadedByName',
        'version',
      ].sort(),
    );
  });
});

describe('🔴 `F-012 AC-3`: `VIEWER` は DL できない / 閲覧はできる（`BR-31`）', () => {
  it('🔴 `VIEWER` が #20 を直接呼んでも 403（画面の導線を消すだけにしない）', async () => {
    const salesCtx = await ctxOf(HOST_1, 'SALES');
    const created = await cleanVersion(salesCtx, TENANT_1.hostEngineerId);
    const viewerCtx = await ctxOf(HOST_1, 'VIEWER');
    requireTenantCtxMock.mockResolvedValue(viewerCtx);
    const before = store.callCount();

    const response = await downloadRoute.GET(
      new Request(`https://app.test/api/skill-sheets/${created.id}/download-url`),
      { params: Promise.resolve({ id: created.id }) },
    );

    expect(response.status).toBe(403);
    expect(((await response.json()) as ErrorBody).error.code).toBe('FORBIDDEN');
    expect(store.callCount()).toBe(before);
    expect(await auditRows(DOWNLOAD_ACTION)).toHaveLength(0);
  });

  it('🔴 `VIEWER` は #21（閲覧）を実行でき、記録も残る', async () => {
    const salesCtx = await ctxOf(HOST_1, 'SALES');
    const created = await cleanVersion(salesCtx, TENANT_1.hostEngineerId);
    const viewerCtx = await ctxOf(HOST_1, 'VIEWER');
    requireTenantCtxMock.mockResolvedValue(viewerCtx);

    const response = await previewRoute.GET(
      new Request(`https://app.test/api/skill-sheets/${created.id}/preview`),
      { params: Promise.resolve({ id: created.id }) },
    );

    expect(response.status).toBe(200);
    const body = (await response.json()) as { readonly meta: { readonly id: string } };
    expect(body.meta.id).toBe(created.id);
    const views = await auditRows(VIEW_ACTION);
    expect(views).toHaveLength(1);
    expect(views[0]?.actorId).toBe(TENANT_1.hostUserId);
  });
});

describe('🔴 `F-012 AC-4`: ホストはパートナーの版に `Proposal` 作成前は到達できない（`BR-59`）', () => {
  it('🔴 ホストがパートナー所有の版を DL できない（404。署名も記録も無い）', async () => {
    const hostCtx = await ctxOf(HOST_1, 'SALES');
    const partnerCtx = await ctxOf(PARTNER_USER_1_1, 'PARTNER_SALES');
    const partnerVersion = await cleanVersion(partnerCtx, PARTNER_1_1.engineerId);
    const before = store.callCount();

    await expect(
      issueSkillSheetDownloadUrl(hostCtx, partnerVersion.id, downloadDeps(), {
        ipAddress: META.ipAddress,
      }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND', httpStatus: 404 });

    // 🔴 見えない版の署名を出しに行かない（`ObjectStore` を 1 回も呼ばない）。
    expect(store.callCount()).toBe(before);
    // 🔴 見ていない閲覧・DL を記録しない（`audit` オプションを使わない理由そのもの）。
    expect(await auditRows(DOWNLOAD_ACTION)).toHaveLength(0);
  });

  it('🔴 ホストがパートナー所有の版を閲覧（#21）できない（404。記録も残らない）', async () => {
    const hostCtx = await ctxOf(HOST_1, 'SALES');
    const partnerCtx = await ctxOf(PARTNER_USER_1_1, 'PARTNER_SALES');
    const partnerVersion = await cleanVersion(partnerCtx, PARTNER_1_1.engineerId);

    await expect(
      readSkillSheetPreview(hostCtx, partnerVersion.id, { ipAddress: META.ipAddress }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(await auditRows(VIEW_ACTION)).toHaveLength(0);
  });

  it('🔴 対照: 所有者（パートナー）本人は同じ版を DL できる（テストが空振りしていない）', async () => {
    const partnerCtx = await ctxOf(PARTNER_USER_1_1, 'PARTNER_SALES');
    const partnerVersion = await cleanVersion(partnerCtx, PARTNER_1_1.engineerId);

    const ticket = await issueSkillSheetDownloadUrl(
      partnerCtx,
      partnerVersion.id,
      downloadDeps(),
      { ipAddress: META.ipAddress },
    );

    expect(ticket.url).toContain('mock-object-store:');
  });

  it('🔴 他テナントの版にも到達できない（第一境界）', async () => {
    const hostCtx = await ctxOf(HOST_1, 'SALES');
    const otherCtx = await ctxOf(HOST_2, 'SALES');
    const otherVersion = await cleanVersion(otherCtx, TENANT_2.hostEngineerId);

    await expect(
      issueSkillSheetDownloadUrl(hostCtx, otherVersion.id, downloadDeps(), {
        ipAddress: META.ipAddress,
      }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(
      readSkillSheetPreview(hostCtx, otherVersion.id, { ipAddress: META.ipAddress }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});

describe('🔴 ダウンロード名に PII を載せない（docs/05 §14.1 の決着。T-05-07）', () => {
  it('版番号ベースの名前が署名に載る（原本のファイル名は保存も送出もしない）', async () => {
    const ctx = await ctxOf(HOST_1, 'SALES');
    const created = await cleanVersion(ctx, TENANT_1.hostEngineerId);

    const ticket = await issueSkillSheetDownloadUrl(ctx, created.id, downloadDeps(), {
      ipAddress: META.ipAddress,
    });

    const url = new URL(ticket.url.replace('mock-object-store://', 'https://mock/'));
    expect(url.searchParams.get('response-content-disposition')).toBe(
      'attachment; filename="skill-sheet-v1.xlsx"',
    );
    // 🔴 URL はブラウザ履歴・アクセスログ・エラー追跡に残る。氏名が 1 文字も載らないこと。
    expect(ticket.url).not.toContain('山田');
    expect(decodeURIComponent(ticket.url)).not.toContain('山田');
  });

  it('🔴 原本のファイル名は DB のどの列にも保存されていない（列を足さない決定の実体）', async () => {
    const ctx = await ctxOf(HOST_1, 'SALES');
    const created = await cleanVersion(ctx, TENANT_1.hostEngineerId);

    // 🔴 docs/05 §14.1 の ⚠️ は「列を足さない」で決着した（T-05-07）。ファイル名は氏名を
    //    含みうる PII であり、保存すれば運営者 GRANT・監査・エクスポートの全経路で
    //    除外し続ける必要が生じる。**集めていない情報は漏れない**（`BR-52`）。
    const row = await admin.skillSheet.findUnique({ where: { id: created.id } });
    // `byte_size` は bigint なので、そのままでは JSON にできない（文字列化して走査する）。
    const serialized = JSON.stringify(row, (_key, value: unknown) =>
      typeof value === 'bigint' ? value.toString() : value,
    );
    expect(serialized).not.toContain('山田');
    expect(serialized).not.toContain('スキルシート.xlsx');
    // 対照: 版のメモ（`F-011` の入力）は保存される。列があること自体は検査できている。
    expect(row?.note).toBe(NOTE);
  });
});
