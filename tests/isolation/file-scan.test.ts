// tests/isolation/file-scan.test.ts
// 🔴 SP-05 T-05-05 の完了判定を **DB + RLS 付きで**実証する:
//
//   ① 🔴 **`THREATS_FOUND` の後に `NO_THREATS_FOUND` が来ても `CLEAN` に戻らない**（順序逆転）
//   ② 🔴 **`UNSUPPORTED` / `ACCESS_DENIED` / `FAILED` を `CLEAN` として扱わない**（`BR-26`）
//   ③ 🔴 **重複配信で `FileScanResult` が 2 行にならない**（`UNIQUE(object_key, version_id)`）
//   ④ 🔴 **パートナー所属エンジニアのスキルシートにもスキャン結果が届く**
//      —— ジョブはホスト文脈（`systemTenantCtx`）であり、素の C3 ポリシーでは 1 行も見えない。
//      **ここが通らないと「パートナーが上げたファイルだけ永久に `SCANNING`」になる**
//      （migration 20260908000000 の判断事項）。
//   ⑤ 🔴 **テナント境界を越えない** —— 別テナントの文脈で同じオブジェクトキーを適用しても
//      `NOT_FOUND` であり、元の行は 1 ビットも動かない。
//   ⑥ 🔴 **`CLEAN` から外れた版は最新版フラグを失う**（`F-011 AC-1` を DB 制約と両立させる）。
//   ⑦ 滞留の照会（`scan.poll` の母集団）が所有者を問わず取れ、閾値より新しいものを含まない。
//
// 🔴 `packages/db` の関数を直接呼ぶ（ジョブのハンドラは `apps/worker` のユニットテストが見る）。
//    ここで見たいのは **RLS と SECURITY DEFINER 関数の実挙動**である。
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import {
  applyFileScanResult,
  configureTenantDb,
  disconnectTenantDb,
  listStalledScanTargets,
  systemTenantCtx,
  withTenant,
  type ScanStatus,
} from '@ses/db';
import { createUnextendedClient, type UnextendedClient } from '@ses/db/testing';
import { ISOLATION_SEED_IDS, runSeed } from '@ses/db/seed';
import { startIsolationDatabase, type IsolationDatabase } from './support/postgres.js';

const SETUP_TIMEOUT_MS = 600_000;
const NOW = new Date('2026-09-06T00:00:00.000Z');
/** 滞留判定の境界（`SCAN_STALL_ALERT_MINUTES` = 10 分相当）。 */
const STALL_BEFORE = new Date('2026-09-05T23:50:00.000Z');

const TENANT_1 = ISOLATION_SEED_IDS.tenants[0];
const TENANT_2 = ISOLATION_SEED_IDS.tenants[1];
const PARTNER_1_1 = TENANT_1.partners[0];

const JOB = { queue: 'scan.apply-result', jobId: 'job-1' } as const;

let database: IsolationDatabase;
/** 🔴 前提づくりと事実確認だけに使う特権接続。検証のクエリには使わない。 */
let admin: UnextendedClient;

type SheetSpec = {
  readonly tenantId: string;
  readonly engineerId: string;
  readonly ownerPartnerCompanyId: string | null;
  readonly uploadedBy: string;
  readonly scanStatus?: ScanStatus;
  readonly isLatest?: boolean;
  readonly uploadedAt?: Date;
};

let sheetSeq = 0;

async function createSkillSheet(
  spec: SheetSpec,
): Promise<{ readonly id: string; readonly objectKey: string }> {
  sheetSeq += 1;
  const objectKey = `t/${spec.tenantId}/skill-sheets/${spec.engineerId}/${sheetSeq}/${crypto.randomUUID()}.xlsx`;
  const row = await admin.skillSheet.create({
    data: {
      tenantId: spec.tenantId,
      ownerPartnerCompanyId: spec.ownerPartnerCompanyId,
      engineerId: spec.engineerId,
      version: sheetSeq,
      objectKey,
      contentType: 'application/pdf',
      byteSize: 1_000n,
      scanStatus: spec.scanStatus ?? 'SCANNING',
      isLatest: spec.isLatest ?? false,
      uploadedBy: spec.uploadedBy,
      uploadedAt: spec.uploadedAt ?? new Date('2026-09-05T23:00:00.000Z'),
    },
    select: { id: true },
  });
  return { id: row.id, objectKey };
}

async function readSheet(id: string) {
  return admin.skillSheet.findUniqueOrThrow({
    where: { id },
    select: { scanStatus: true, scanUpdatedAt: true, isLatest: true },
  });
}

function jobCtxOf(tenantId: string) {
  return systemTenantCtx(tenantId, JOB);
}

function resultOf(
  objectKey: string,
  status: ScanStatus,
  rawStatus: string,
  objectVersionId = 'v-1',
) {
  return { objectKey, objectVersionId, status, rawStatus, occurredAt: NOW, receivedAt: NOW };
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
}, SETUP_TIMEOUT_MS);

afterAll(async () => {
  await disconnectTenantDb();
  await admin?.$disconnect();
  await database?.stop();
});

afterEach(async () => {
  await admin.fileScanResult.deleteMany({});
  await admin.skillSheet.deleteMany({});
});

describe('🔴 ① 順序逆転: THREATS_FOUND の後に NO_THREATS_FOUND が来ても CLEAN に戻らない', () => {
  it('INFECTED → CLEAN は KEPT（状態は INFECTED のまま）', async () => {
    const sheet = await createSkillSheet({
      tenantId: TENANT_1.tenantId,
      engineerId: TENANT_1.hostEngineerId,
      ownerPartnerCompanyId: null,
      uploadedBy: TENANT_1.hostUserId,
    });
    const ctx = jobCtxOf(TENANT_1.tenantId);

    const first = await applyFileScanResult(
      ctx,
      resultOf(sheet.objectKey, 'INFECTED', 'THREATS_FOUND', 'v-1'),
    );
    expect(first).toEqual({ target: 'APPLIED', previousStatus: 'SCANNING', recorded: true });

    // 遅れて到着した「安全」の判定（別の版として届いたと仮定）。
    const second = await applyFileScanResult(
      ctx,
      resultOf(sheet.objectKey, 'CLEAN', 'NO_THREATS_FOUND', 'v-2'),
    );
    expect(second.target).toBe('KEPT');
    expect(second.previousStatus).toBe('INFECTED');
    // 🔴 記録は残る（何が届いたかは監査できる）が、状態は動かない。
    expect(second.recorded).toBe(true);

    expect((await readSheet(sheet.id)).scanStatus).toBe('INFECTED');
  });

  it('🔴 UNSCANNABLE / FAILED からも CLEAN へ戻らない（同じ性質の抜け道を残さない）', async () => {
    for (const initial of ['UNSCANNABLE', 'FAILED'] as const) {
      const sheet = await createSkillSheet({
        tenantId: TENANT_1.tenantId,
        engineerId: TENANT_1.hostEngineerId,
        ownerPartnerCompanyId: null,
        uploadedBy: TENANT_1.hostUserId,
        scanStatus: initial,
      });
      const applied = await applyFileScanResult(
        jobCtxOf(TENANT_1.tenantId),
        resultOf(sheet.objectKey, 'CLEAN', 'NO_THREATS_FOUND'),
      );
      expect(applied.target).toBe('KEPT');
      expect((await readSheet(sheet.id)).scanStatus).toBe(initial);
    }
  });

  it('CLEAN → INFECTED は APPLY（安全側へは動く）', async () => {
    const sheet = await createSkillSheet({
      tenantId: TENANT_1.tenantId,
      engineerId: TENANT_1.hostEngineerId,
      ownerPartnerCompanyId: null,
      uploadedBy: TENANT_1.hostUserId,
      scanStatus: 'CLEAN',
    });
    const applied = await applyFileScanResult(
      jobCtxOf(TENANT_1.tenantId),
      resultOf(sheet.objectKey, 'INFECTED', 'THREATS_FOUND'),
    );
    expect(applied.target).toBe('APPLIED');
    expect((await readSheet(sheet.id)).scanStatus).toBe('INFECTED');
  });
});

describe('🔴 ② 4 種のステータス（判定不能を CLEAN として扱わない。docs/03 §3.4.3-3）', () => {
  it.each([
    ['NO_THREATS_FOUND', 'CLEAN'],
    ['THREATS_FOUND', 'INFECTED'],
    ['UNSUPPORTED', 'UNSCANNABLE'],
    ['ACCESS_DENIED', 'FAILED'],
  ] as const)('%s → %s が DB に入る（生値も残る）', async (rawStatus, status) => {
    const sheet = await createSkillSheet({
      tenantId: TENANT_1.tenantId,
      engineerId: TENANT_1.hostEngineerId,
      ownerPartnerCompanyId: null,
      uploadedBy: TENANT_1.hostUserId,
    });
    await applyFileScanResult(jobCtxOf(TENANT_1.tenantId), resultOf(sheet.objectKey, status, rawStatus));

    expect((await readSheet(sheet.id)).scanStatus).toBe(status);
    const recorded = await admin.fileScanResult.findFirstOrThrow({
      where: { objectKey: sheet.objectKey },
      select: { status: true, rawStatus: true, tenantId: true },
    });
    expect(recorded).toEqual({ status, rawStatus, tenantId: TENANT_1.tenantId });
  });
});

describe('🔴 ③ 重複配信（at-least-once。docs/03 §3.4.3-2）', () => {
  it('同じオブジェクト版を 2 回適用しても FileScanResult は 1 行', async () => {
    const sheet = await createSkillSheet({
      tenantId: TENANT_1.tenantId,
      engineerId: TENANT_1.hostEngineerId,
      ownerPartnerCompanyId: null,
      uploadedBy: TENANT_1.hostUserId,
    });
    const ctx = jobCtxOf(TENANT_1.tenantId);
    const input = resultOf(sheet.objectKey, 'CLEAN', 'NO_THREATS_FOUND', 'v-1');

    const first = await applyFileScanResult(ctx, input);
    const second = await applyFileScanResult(ctx, input);

    expect(first).toEqual({ target: 'APPLIED', previousStatus: 'SCANNING', recorded: true });
    // 🔴 2 回目は記録も状態変更も起きない（どちらも冪等）。エラーにはしない。
    expect(second).toEqual({ target: 'KEPT', previousStatus: 'CLEAN', recorded: false });

    expect(await admin.fileScanResult.count({ where: { objectKey: sheet.objectKey } })).toBe(1);
    expect((await readSheet(sheet.id)).scanStatus).toBe('CLEAN');
  });

  it('🔴 記録が重複でも状態の適用は必ず試みる（記録だけ残って未適用の状態を潰す）', async () => {
    const sheet = await createSkillSheet({
      tenantId: TENANT_1.tenantId,
      engineerId: TENANT_1.hostEngineerId,
      ownerPartnerCompanyId: null,
      uploadedBy: TENANT_1.hostUserId,
    });
    // 受信の記録だけが先に入っている（enqueue 後に落ちた場合の再現）。
    await admin.fileScanResult.create({
      data: {
        tenantId: TENANT_1.tenantId,
        objectKey: sheet.objectKey,
        objectVersionId: 'v-1',
        status: 'CLEAN',
        rawStatus: 'NO_THREATS_FOUND',
        receivedAt: NOW,
      },
    });

    const applied = await applyFileScanResult(
      jobCtxOf(TENANT_1.tenantId),
      resultOf(sheet.objectKey, 'CLEAN', 'NO_THREATS_FOUND', 'v-1'),
    );
    expect(applied).toEqual({ target: 'APPLIED', previousStatus: 'SCANNING', recorded: false });
    expect((await readSheet(sheet.id)).scanStatus).toBe('CLEAN');
  });
});

describe('🔴 ④ パートナー所属エンジニアのスキルシートにも届く（migration 20260908000000 の判断事項）', () => {
  it('ホスト文脈のジョブがパートナー所有の版を INFECTED にできる', async () => {
    const sheet = await createSkillSheet({
      tenantId: TENANT_1.tenantId,
      engineerId: PARTNER_1_1.engineerId,
      ownerPartnerCompanyId: PARTNER_1_1.partnerCompanyId,
      uploadedBy: PARTNER_1_1.userId,
    });
    const applied = await applyFileScanResult(
      jobCtxOf(TENANT_1.tenantId),
      resultOf(sheet.objectKey, 'INFECTED', 'THREATS_FOUND'),
    );
    expect(applied.target).toBe('APPLIED');
    expect((await readSheet(sheet.id)).scanStatus).toBe('INFECTED');
  });

  it('🔴 対照: 素の withTenant（ホスト文脈）ではパートナー所有の版が 1 行も見えない（C3 は緩んでいない）', async () => {
    const sheet = await createSkillSheet({
      tenantId: TENANT_1.tenantId,
      engineerId: PARTNER_1_1.engineerId,
      ownerPartnerCompanyId: PARTNER_1_1.partnerCompanyId,
      uploadedBy: PARTNER_1_1.userId,
    });
    // 🔴 ジョブと**同じホスト文脈**（`systemTenantCtx`）で、素の `withTenant` から読む。
    //    見えないことが C3 の効いている証拠であり、`applyFileScanResult` が届くのは
    //    SECURITY DEFINER 関数を経由しているからである（両者の差がこの 2 つの it に出る）。
    const found = await withTenant(jobCtxOf(TENANT_1.tenantId), (db) =>
      db.skillSheet.findFirst({ where: { id: sheet.id }, select: { id: true } }),
    );
    expect(found).toBeNull();
  });
});

describe('🔴 ⑤ テナント境界（他テナントの文脈からは 1 ビットも動かない）', () => {
  it('別テナントの ctx で同じオブジェクトキーを適用しても NOT_FOUND', async () => {
    const sheet = await createSkillSheet({
      tenantId: TENANT_1.tenantId,
      engineerId: TENANT_1.hostEngineerId,
      ownerPartnerCompanyId: null,
      uploadedBy: TENANT_1.hostUserId,
    });

    const applied = await applyFileScanResult(
      // 🔴 テナント 2 の文脈でテナント 1 のキーを指定する（受信側の検査をすり抜けた想定）。
      jobCtxOf(TENANT_2.tenantId),
      resultOf(sheet.objectKey, 'INFECTED', 'THREATS_FOUND'),
    );
    expect(applied.target).toBe('NOT_FOUND');
    expect(applied.previousStatus).toBeNull();
    expect((await readSheet(sheet.id)).scanStatus).toBe('SCANNING');
  });

  it('🔴 存在しないオブジェクトキーは NOT_FOUND（0 件更新を成功に畳まない）', async () => {
    const applied = await applyFileScanResult(
      jobCtxOf(TENANT_1.tenantId),
      resultOf(`t/${TENANT_1.tenantId}/skill-sheets/x/1/none.xlsx`, 'CLEAN', 'NO_THREATS_FOUND'),
    );
    expect(applied).toEqual({ target: 'NOT_FOUND', previousStatus: null, recorded: false });
    // 🔴 対象が無いなら記録もしない（どのテナントの判定か確定できないため）。
    //    受信そのものは `WebhookDelivery` に残り `A-005` から追える。
    expect(await admin.fileScanResult.count()).toBe(0);
  });

  it('🔴 実在しないテナントのプレフィックスでも例外にならず NOT_FOUND に収束する', async () => {
    // `file_scan_results.tenant_id` は `tenants` への FK を持つ。記録を先に書くと FK 違反で
    // 「ジョブの失敗」に化けるため、実装は**適用を先に**行う（file-scan.ts の順序の理由）。
    const orphanTenantId = '01930000-0000-7000-8000-00000000ffff';
    const applied = await applyFileScanResult(
      jobCtxOf(orphanTenantId),
      resultOf(`t/${orphanTenantId}/skill-sheets/x/1/none.xlsx`, 'INFECTED', 'THREATS_FOUND'),
    );
    expect(applied.target).toBe('NOT_FOUND');
    expect(await admin.fileScanResult.count()).toBe(0);
  });

  it('🔴 app_apply_scan_status はテナント文脈が無ければ失敗する（fail-closed）', async () => {
    const tenantClient = createUnextendedClient(database.tenantUrl);
    try {
      await expect(
        tenantClient.$queryRaw`
          SELECT * FROM app_apply_scan_status('any-key', 'CLEAN', ARRAY['SCANNING']::text[], now())`,
      ).rejects.toThrow(/テナント文脈がありません/);
    } finally {
      await tenantClient.$disconnect();
    }
  });

  it('🔴 app_apply_scan_status は SCANNING を適用できない（確定 → 未確定の巻き戻しを DB でも拒む）', async () => {
    const sheet = await createSkillSheet({
      tenantId: TENANT_1.tenantId,
      engineerId: TENANT_1.hostEngineerId,
      ownerPartnerCompanyId: null,
      uploadedBy: TENANT_1.hostUserId,
      scanStatus: 'INFECTED',
    });
    const tenantClient = createUnextendedClient(database.tenantUrl);
    try {
      await expect(
        tenantClient.$transaction(async (tx) => {
          await tx.$queryRaw`SELECT set_config('app.tenant_id', ${TENANT_1.tenantId}, true)`;
          return tx.$queryRaw`
            SELECT * FROM app_apply_scan_status(
              ${sheet.objectKey}, 'SCANNING', ARRAY['INFECTED']::text[], now())`;
        }),
      ).rejects.toThrow(/SCANNING/);
      expect((await readSheet(sheet.id)).scanStatus).toBe('INFECTED');
    } finally {
      await tenantClient.$disconnect();
    }
  });
});

describe('🔴 ⑥ CLEAN から外れた版は最新版フラグを失う（F-011 AC-1 / DB の CHECK と両立）', () => {
  it('is_latest = true の CLEAN が INFECTED になるとフラグが落ちる', async () => {
    const sheet = await createSkillSheet({
      tenantId: TENANT_1.tenantId,
      engineerId: TENANT_1.hostEngineerId,
      ownerPartnerCompanyId: null,
      uploadedBy: TENANT_1.hostUserId,
      scanStatus: 'CLEAN',
      isLatest: true,
    });
    const applied = await applyFileScanResult(
      jobCtxOf(TENANT_1.tenantId),
      resultOf(sheet.objectKey, 'INFECTED', 'THREATS_FOUND'),
    );
    expect(applied.target).toBe('APPLIED');
    expect(await readSheet(sheet.id)).toMatchObject({ scanStatus: 'INFECTED', isLatest: false });
  });

  it('CLEAN のままなら最新版フラグは保たれる', async () => {
    const sheet = await createSkillSheet({
      tenantId: TENANT_1.tenantId,
      engineerId: TENANT_1.hostEngineerId,
      ownerPartnerCompanyId: null,
      uploadedBy: TENANT_1.hostUserId,
      isLatest: false,
    });
    await applyFileScanResult(
      jobCtxOf(TENANT_1.tenantId),
      resultOf(sheet.objectKey, 'CLEAN', 'NO_THREATS_FOUND'),
    );
    // 🔴 スキャン結果の適用が最新版フラグを**立てる**ことはない（版の切替は #19 の責務）。
    expect(await readSheet(sheet.id)).toMatchObject({ scanStatus: 'CLEAN', isLatest: false });
  });
});

describe('🔴 ⑦ 滞留の照会（scan.poll の母集団。docs/05 §8.5 の保険）', () => {
  it('所有者を問わず、閾値より古い SCANNING だけを返す', async () => {
    const hostStalled = await createSkillSheet({
      tenantId: TENANT_1.tenantId,
      engineerId: TENANT_1.hostEngineerId,
      ownerPartnerCompanyId: null,
      uploadedBy: TENANT_1.hostUserId,
      uploadedAt: new Date('2026-09-05T22:00:00.000Z'),
    });
    const partnerStalled = await createSkillSheet({
      tenantId: TENANT_1.tenantId,
      engineerId: PARTNER_1_1.engineerId,
      ownerPartnerCompanyId: PARTNER_1_1.partnerCompanyId,
      uploadedBy: PARTNER_1_1.userId,
      uploadedAt: new Date('2026-09-05T22:30:00.000Z'),
    });
    // 閾値より新しい（まだ滞留とみなさない）。
    await createSkillSheet({
      tenantId: TENANT_1.tenantId,
      engineerId: TENANT_1.hostEngineerId,
      ownerPartnerCompanyId: null,
      uploadedBy: TENANT_1.hostUserId,
      uploadedAt: new Date('2026-09-05T23:59:00.000Z'),
    });
    // 既に確定している（対象外）。
    await createSkillSheet({
      tenantId: TENANT_1.tenantId,
      engineerId: TENANT_1.hostEngineerId,
      ownerPartnerCompanyId: null,
      uploadedBy: TENANT_1.hostUserId,
      scanStatus: 'CLEAN',
      uploadedAt: new Date('2026-09-05T20:00:00.000Z'),
    });
    // 🔴 別テナントの滞留（見えてはならない）。
    await createSkillSheet({
      tenantId: TENANT_2.tenantId,
      engineerId: TENANT_2.hostEngineerId,
      ownerPartnerCompanyId: null,
      uploadedBy: TENANT_2.hostUserId,
      uploadedAt: new Date('2026-09-05T20:00:00.000Z'),
    });

    const rows = await listStalledScanTargets(jobCtxOf(TENANT_1.tenantId), {
      before: STALL_BEFORE,
      limit: 100,
    });
    expect(rows.map((row) => row.skillSheetId)).toEqual([hostStalled.id, partnerStalled.id]);
  });

  it('🔴 別テナントの滞留は 1 件も返らない', async () => {
    await createSkillSheet({
      tenantId: TENANT_2.tenantId,
      engineerId: TENANT_2.hostEngineerId,
      ownerPartnerCompanyId: null,
      uploadedBy: TENANT_2.hostUserId,
      uploadedAt: new Date('2026-09-05T20:00:00.000Z'),
    });
    const rows = await listStalledScanTargets(jobCtxOf(TENANT_1.tenantId), {
      before: STALL_BEFORE,
      limit: 100,
    });
    expect(rows).toEqual([]);
  });

  it('limit を超えて返さない（1 回のジョブが全件を舐めない）', async () => {
    for (let index = 0; index < 3; index += 1) {
      await createSkillSheet({
        tenantId: TENANT_1.tenantId,
        engineerId: TENANT_1.hostEngineerId,
        ownerPartnerCompanyId: null,
        uploadedBy: TENANT_1.hostUserId,
        uploadedAt: new Date('2026-09-05T20:00:00.000Z'),
      });
    }
    const rows = await listStalledScanTargets(jobCtxOf(TENANT_1.tenantId), {
      before: STALL_BEFORE,
      limit: 2,
    });
    expect(rows).toHaveLength(2);
  });
});

describe('🔴 skill_sheets(object_key) の UNIQUE（引き当ての曖昧さを DB で禁止する）', () => {
  it('同じオブジェクトキーの版を 2 つ作れない', async () => {
    const first = await createSkillSheet({
      tenantId: TENANT_1.tenantId,
      engineerId: TENANT_1.hostEngineerId,
      ownerPartnerCompanyId: null,
      uploadedBy: TENANT_1.hostUserId,
    });
    await expect(
      admin.skillSheet.create({
        data: {
          tenantId: TENANT_2.tenantId,
          ownerPartnerCompanyId: null,
          engineerId: TENANT_2.hostEngineerId,
          version: 999,
          objectKey: first.objectKey,
          contentType: 'application/pdf',
          byteSize: 1_000n,
          uploadedBy: TENANT_2.hostUserId,
          uploadedAt: NOW,
        },
      }),
    ).rejects.toThrow(/Unique constraint failed on the fields: \(`object_key`\)/);
  });
});
