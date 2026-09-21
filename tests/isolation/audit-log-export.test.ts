// tests/isolation/audit-log-export.test.ts
// 🔴 T-12-18 ⑪（docs/05 §6.3 #10b / §6.4「CSV エクスポート」行 / §16.1 `audit_log.export` / `docs/04` §S-041 セクション 4）を
//    **DB + RLS 付きで**実証する。`S-041` の CSV エクスポート `GET /api/audit-logs/export`。
//
//   ① 🔴 ヘッダは 6 列固定（`createdAt` / `actorKind` / `actorDisplayName` / `action` / `target` / `ipAndDevice`）
//   ② 🔴 `detail` / `summary` / `note` / `email` の識別子・値が本文に無い —— 特権接続で `summary` に禁止名の値を注入した行を作っても
//      CSV に 1 バイトも現れない（許可リストの 2 実装が無い = そもそも `summary` を読まない）
//   ③ 先頭 `=` の `actorDisplayName` が `'=` になる（`packages/domain` の `sanitizeCsvCellText` を共用）
//   ④ 🔴 取引先 / `SALES` / `VIEWER` は 403（#10 と同じ `requireRole`）。他テナントの行は 0 行（C2 HOST_ONLY）
//   ⑤ 🔴 上限（`AUDIT_LOG_EXPORT_MAX_ROWS`）を超える母集団は 400 `AUDIT_LOG_EXPORT_TOO_LARGE` + `params.maxRows`。
//      **弾いた要求は `audit_log.export` に記録しない**。読み出し（`collectAuditLogsForExport`）は #10 を複数ページ追う
//   ⑥ 🔴 `audit_log.export` が 1 エクスポート 1 行、`USER` 主体・`targetType='Tenant'`・`summary = { rowCount, truncated }` だけで記録される
//      （検索条件は載らない）。記録された行自身も次のエクスポート・#10 の一覧に現れ、`detail` は `rowCount` / `truncated` の 2 キー
//   ⑦ #10 と同じ期間・カテゴリで行集合が一致する（件数と `createdAt` / `action` の並び）
//   ⑧ 応答は `text/csv; charset=utf-8` + `Content-Disposition: attachment` + UTF-8 BOM。`from > to` は 400
//
// 🔴 検証は `withApiRoute` が組み立てた**実物の Route Handler**に `Request` を渡して行う（`audit-log-detail.test.ts` と同じ方針）。
//    差し替えるのは `requireTenantCtx` の 1 点だけである。行の投入は特権接続（superuser）で行う。
import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
// 🔴 `@ses/config` をパッケージ名で import しない（ルートの package.json は依存に持たない。`env-separation.test.ts` と同じ）。
import { AUDIT_LOG_EXPORT_MAX_ROWS } from '../../packages/config/src/limits.js';
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
const NOW = new Date('2026-09-18T00:00:00.000Z');
const RANGE_FROM = new Date(NOW.getTime() - 60 * 60 * 1000).toISOString();
const RANGE_TO = new Date(NOW.getTime() + 60 * 60 * 1000).toISOString();
const META = { deviceKind: 'api', ipAddress: '203.0.113.42' } as const;

const requireTenantCtxMock = vi.fn<() => Promise<AuthenticatedTenantCtx>>();

vi.mock('../../apps/web/lib/auth/session', () => ({
  requireTenantCtx: () => requireTenantCtxMock(),
  readRequestMeta: async () => META,
}));

const { buildTenantCtx } = await import('../../apps/web/lib/auth/tenant-context');
const { collectAuditLogsForExport } = await import('../../apps/web/lib/audit-logs/export');
const { AUDIT_LOG_CSV_COLUMNS } = await import('../../apps/web/lib/audit-logs/csv');
const listRoute = await import('../../apps/web/app/api/(main)/audit-logs/route');
const exportRoute = await import('../../apps/web/app/api/(main)/audit-logs/export/route');

const TENANT_1 = ISOLATION_SEED_IDS.tenants[0];
const TENANT_2 = ISOLATION_SEED_IDS.tenants[1];
const PARTNER_1_1 = TENANT_1.partners[0];

const HOST_SALES: TenantIdentity = { tenantId: TENANT_1.tenantId, partnerCompanyId: null, userId: TENANT_1.hostUserId };
const HOST_OWNER: TenantIdentity = { tenantId: TENANT_1.tenantId, partnerCompanyId: null, userId: TENANT_1.hostOwnerUserId };
const PARTNER_USER: TenantIdentity = {
  tenantId: TENANT_1.tenantId,
  partnerCompanyId: PARTNER_1_1.partnerCompanyId,
  userId: PARTNER_1_1.userId,
};

/** 🔴 テストが作った行だけを見る・片付けるための目印（`targetType`）。 */
const MARKER = 'T1218Marker';
const EXPORT_ACTION = 'audit_log.export';
const BOM = '\uFEFF';

type Summary = Readonly<Record<string, string | number | boolean | null>>;
type RowInput = {
  readonly action: string;
  readonly actorKind: 'USER' | 'SYSTEM' | 'PLATFORM_USER';
  readonly actorId: string | null;
  readonly summary: Summary;
  readonly targetId?: string;
  readonly tenantId?: string;
  readonly createdAt?: Date;
};

let database: IsolationDatabase;
let admin: UnextendedClient;
/** 🔴 シードの表示名（③ で書き換えるので `afterEach` で元に戻す。値をテストにベタ書きしない）。 */
let hostDisplayName: string;

async function setRole(identity: TenantIdentity, role: TenantRole): Promise<void> {
  await admin.membership.updateMany({ where: { tenantId: identity.tenantId, userId: identity.userId }, data: { role } });
}

async function enrollTwoFactor(userId: string, tenantId: string): Promise<void> {
  const existing = await admin.twoFactorCredential.findFirst({ where: { subjectId: userId, subjectType: 'USER' }, select: { id: true } });
  if (existing !== null) return;
  await admin.twoFactorCredential.create({
    data: { subjectType: 'USER', subjectId: userId, tenantId, secretEncrypted: 'test:not-a-real-secret', recoveryCodeHashes: [], confirmedAt: NOW },
  });
}

async function ctxOf(identity: TenantIdentity, role: TenantRole): Promise<AuthenticatedTenantCtx> {
  await setRole(identity, role);
  const ctx = await buildTenantCtx({ ...identity, twoFactorVerified: true }, { deviceKind: 'api' });
  if (ctx === null) throw new Error('ctx を作れませんでした（前提の破綻）。');
  return ctx;
}

async function insertRows(rows: readonly RowInput[]): Promise<void> {
  await admin.auditLog.createMany({
    data: rows.map((row) => ({
      tenantId: row.tenantId ?? TENANT_1.tenantId,
      actorKind: row.actorKind,
      actorId: row.actorId,
      action: row.action,
      targetType: MARKER,
      targetId: row.targetId ?? randomUUID(),
      summary: row.summary,
      ipAddress: META.ipAddress,
      deviceKind: 'api',
      createdAt: row.createdAt ?? NOW,
    })),
  });
}

function queryParams(extra: Readonly<Record<string, string>> = {}): URLSearchParams {
  return new URLSearchParams({ from: RANGE_FROM, to: RANGE_TO, ...extra });
}

async function getExport(ctx: AuthenticatedTenantCtx, extra: Readonly<Record<string, string>> = {}): Promise<Response> {
  requireTenantCtxMock.mockResolvedValue(ctx);
  return exportRoute.GET(new Request(`https://app.test/api/audit-logs/export?${queryParams(extra).toString()}`));
}

async function getList(ctx: AuthenticatedTenantCtx, extra: Readonly<Record<string, string>> = {}): Promise<Response> {
  requireTenantCtxMock.mockResolvedValue(ctx);
  const params = queryParams({ limit: '200', ...extra });
  return listRoute.GET(new Request(`https://app.test/api/audit-logs?${params.toString()}`));
}

/**
 * CSV 本文 → 行（末尾の空行を除く）。
 * 🔴 `Response.text()` は fetch 仕様の「UTF-8 decode」であり**先頭の BOM を取り除く**（undici）。したがって文字列の側では
 *    BOM を検査できない。BOM の有無は下の `expectUtf8Bom`（バイト列）で見る（`docs/04` §S-041 ④「文字コード・改行・先頭 BOM は
 *    返却 CSV と同じ」）。ここでは残っていても落としてから行に割る。
 */
function csvLines(body: string): readonly string[] {
  const lines = (body.startsWith(BOM) ? body.slice(BOM.length) : body).split('\r\n');
  expect(lines[lines.length - 1]).toBe('');
  return lines.slice(0, -1);
}

/** 🔴 実際に流れるバイト列の先頭が UTF-8 BOM（`EF BB BF`）であること（日本語版の表計算ソフトで開いて文字化けしない）。 */
async function expectUtf8Bom(response: Response): Promise<void> {
  const bytes = new Uint8Array(await response.clone().arrayBuffer());
  expect([...bytes.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
}

/** 本テストが投入した行（`target` 列が `MARKER:` で始まる）だけ。 */
function markerLines(lines: readonly string[]): readonly string[] {
  return lines.slice(1).filter((line) => line.split(',').some((cell) => cell.startsWith(`${MARKER}:`)));
}

async function exportRecords(): Promise<readonly { readonly actorId: string | null; readonly actorKind: string; readonly targetType: string | null; readonly targetId: string | null; readonly summary: unknown; readonly tenantId: string | null; readonly ipAddress: string | null }[]> {
  return admin.auditLog.findMany({
    where: { action: EXPORT_ACTION },
    select: { actorId: true, actorKind: true, targetType: true, targetId: true, summary: true, tenantId: true, ipAddress: true },
    orderBy: { createdAt: 'asc' },
  });
}

beforeAll(async () => {
  database = await startIsolationDatabase({ seed: 'none' });
  await runSeed({ appEnv: 'development', databaseUrl: database.superuserUrl, preset: 'isolation', reset: true, now: NOW });
  admin = createUnextendedClient(database.superuserUrl);
  configureTenantDb({ datasourceUrl: database.tenantUrl });
  await enrollTwoFactor(TENANT_1.hostOwnerUserId, TENANT_1.tenantId);
  await enrollTwoFactor(TENANT_1.hostUserId, TENANT_1.tenantId);
  const host = await admin.user.findUnique({ where: { id: TENANT_1.hostUserId }, select: { displayName: true } });
  if (host === null) throw new Error('シードのホスト利用者が見つかりません（前提の破綻）。');
  hostDisplayName = host.displayName;
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
  await setRole(HOST_SALES, 'SALES');
  await setRole(HOST_OWNER, 'OWNER');
  await setRole(PARTNER_USER, 'PARTNER_SALES');
  await admin.auditLog.deleteMany({ where: { OR: [{ targetType: MARKER }, { action: EXPORT_ACTION }] } });
  await admin.user.updateMany({ where: { id: TENANT_1.hostUserId }, data: { displayName: hostDisplayName } });
});

describe('① ⑧ ヘッダ 6 列固定と応答の形', () => {
  it('🔴 ヘッダは createdAt / actorKind / actorDisplayName / action / target / ipAndDevice の 6 列。text/csv + attachment + BOM', async () => {
    await insertRows([{ action: 'auth.login', actorKind: 'USER', actorId: TENANT_1.hostUserId, summary: { method: 'credentials' } }]);
    const reader = await ctxOf(HOST_OWNER, 'ADMIN');
    const response = await getExport(reader);
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('text/csv; charset=utf-8');
    expect(response.headers.get('content-disposition')).toMatch(/^attachment; filename="audit-logs-[0-9A-Za-z]+-[0-9A-Za-z]+\.csv"$/);
    expect(response.headers.get('cache-control')).toBe('no-store');
    await expectUtf8Bom(response);
    const lines = csvLines(await response.text());
    expect(lines[0]).toBe('createdAt,actorKind,actorDisplayName,action,target,ipAndDevice');
    expect(lines[0]?.split(',')).toEqual([...AUDIT_LOG_CSV_COLUMNS]);
    for (const line of lines.slice(1)) expect(line.split(',').length).toBeGreaterThanOrEqual(6);
    const mine = markerLines(lines);
    expect(mine).toHaveLength(1);
    // 🔴 主体はシードの表示名で載る（`actorDisplayName`。#10 と同じ解決）。値をベタ書きしない。
    expect(mine[0]).toMatch(
      new RegExp(`^${NOW.toISOString()},USER,${hostDisplayName},auth\\.login,${MARKER}:[0-9a-f-]+,203\\.0\\.113\\.42 api$`),
    );
  });

  it('from > to は 400（#10 と同じ判定）。CSV も記録も出ない', async () => {
    const reader = await ctxOf(HOST_OWNER, 'ADMIN');
    const response = await getExport(reader, { from: RANGE_TO, to: RANGE_FROM });
    expect(response.status).toBe(400);
    expect(await exportRecords()).toEqual([]);
  });
});

describe('② 🔴 detail / summary / 禁止名の値が本文に無い', () => {
  it('特権接続で summary に note / body / email / declineReason / displayName / unitPrice を注入しても CSV に 1 バイトも現れない', async () => {
    await insertRows([
      {
        action: 'proposal_request.update',
        actorKind: 'USER',
        actorId: PARTNER_1_1.userId,
        summary: {
          operation: 'DECLINE',
          note: '禁止-note-の値',
          body: '禁止-body-の値',
          email: 'forbidden-t1218@example.invalid',
          declineReason: '単価が合わないため辞退します',
          displayName: '禁止-displayName-山田太郎',
          unitPrice: 800000,
        },
      },
      {
        action: 'membership.role_change',
        actorKind: 'USER',
        actorId: TENANT_1.hostOwnerUserId,
        summary: { beforeRole: 'SALES', afterRole: 'ADMIN', targetUserId: TENANT_1.hostUserId },
      },
    ]);
    const reader = await ctxOf(HOST_OWNER, 'ADMIN');
    const response = await getExport(reader);
    expect(response.status).toBe(200);
    const body = await response.text();
    for (const forbidden of ['禁止-', 'example.invalid', '単価', '辞退します', '800000', 'beforeRole', 'afterRole', '"SALES"', 'DECLINE', 'summary', 'detail', 'note', 'email']) {
      expect(body, `${forbidden} が CSV に現れた`).not.toContain(forbidden);
    }
    // 対照: 行そのものは載る（主体・操作・対象・IP の 6 列だけ）。
    const mine = markerLines(csvLines(body));
    expect(mine).toHaveLength(2);
    expect(mine.some((line) => line.includes(',proposal_request.update,'))).toBe(true);
    expect(mine.some((line) => line.includes(',membership.role_change,'))).toBe(true);
  });
});

describe('③ 無害化（packages/domain の sanitizeCsvCellText を共用）', () => {
  it("🔴 先頭 = の actorDisplayName は '= になり、引用される", async () => {
    await admin.user.updateMany({ where: { id: TENANT_1.hostUserId }, data: { displayName: '=HYPERLINK("https://evil.example")' } });
    await insertRows([{ action: 'project.view', actorKind: 'USER', actorId: TENANT_1.hostUserId, summary: { via: 'DETAIL' } }]);
    const reader = await ctxOf(HOST_OWNER, 'ADMIN');
    const body = await (await getExport(reader)).text();
    const mine = markerLines(csvLines(body));
    expect(mine).toHaveLength(1);
    expect(mine[0]).toContain(`,USER,"'=HYPERLINK(""https://evil.example"")",project.view,`);
    expect(body).not.toMatch(/,=HYPERLINK/);
  });
});

describe('④ 🔴 認可と境界（#10 と同じ）', () => {
  it.each(['SALES', 'VIEWER'] as const)('ホストの %s は 403（ダウンロード不可）。記録も残らない', async (role) => {
    const ctx = await ctxOf(HOST_SALES, role);
    const response = await getExport(ctx);
    expect(response.status).toBe(403);
    expect(await exportRecords()).toEqual([]);
  });

  it.each(['PARTNER_ADMIN', 'PARTNER_SALES'] as const)('取引先の %s は 403（自社の行すら読めない = S-041 と同じ）', async (role) => {
    await insertRows([{ action: 'proposal_request.update', actorKind: 'USER', actorId: PARTNER_1_1.userId, summary: { operation: 'ACCEPT' } }]);
    const ctx = await ctxOf(PARTNER_USER, role);
    const response = await getExport(ctx);
    expect(response.status).toBe(403);
    expect(await exportRecords()).toEqual([]);
  });

  it('🔴 他テナントの行は 0 行（C2 HOST_ONLY。CSV にも記録の rowCount にも数えない）', async () => {
    await insertRows([
      { action: 'auth.login', actorKind: 'USER', actorId: TENANT_2.hostUserId, tenantId: TENANT_2.tenantId, summary: { method: 'credentials' } },
      { action: 'auth.login', actorKind: 'USER', actorId: TENANT_1.hostUserId, summary: { method: 'credentials' } },
    ]);
    const reader = await ctxOf(HOST_OWNER, 'ADMIN');
    const body = await (await getExport(reader)).text();
    const mine = markerLines(csvLines(body));
    expect(mine).toHaveLength(1);
    expect(body).not.toContain(TENANT_2.hostUserId);
    const records = await exportRecords();
    expect(records).toHaveLength(1);
    expect(records[0]?.tenantId).toBe(TENANT_1.tenantId);
    // rowCount は自テナントの行数（他テナントの 1 行は含まない）。マーカー以外の行（シード等）は同じ期間の #10 と一致する。
    const listBody = (await (await getList(reader)).json()) as { items: readonly unknown[] };
    expect((records[0]?.summary as { rowCount: number }).rowCount).toBe(listBody.items.length);
  });
});

describe('⑤ 🔴 上限（AUDIT_LOG_EXPORT_MAX_ROWS）', () => {
  it('collectAuditLogsForExport は #10 を複数ページ追い、上限を超えた時点で TOO_LARGE（上限ちょうどは OK）', async () => {
    const rows: RowInput[] = Array.from({ length: 5 }, (_, index) => ({
      action: 'auth.login',
      actorKind: 'USER',
      actorId: TENANT_1.hostUserId,
      summary: { method: 'credentials' },
      createdAt: new Date(NOW.getTime() + index * 1000),
    }));
    await insertRows(rows);
    const reader = await ctxOf(HOST_OWNER, 'ADMIN');
    const query = { from: NOW.toISOString(), to: new Date(NOW.getTime() + 10_000).toISOString() };
    const ok = await collectAuditLogsForExport(reader, query, { maxRows: 5, pageSize: 2 });
    expect(ok.kind).toBe('OK');
    if (ok.kind !== 'OK') throw new Error('unreachable');
    expect(ok.items.filter((item) => item.targetType === MARKER)).toHaveLength(5);
    // 並びは #10 と同じ（createdAt 降順）。ページの継ぎ目で重複・欠落が無い。
    const createdAts = ok.items.map((item) => item.createdAt);
    expect(createdAts).toEqual([...createdAts].sort((a, b) => (a < b ? 1 : a > b ? -1 : 0)));
    expect(new Set(ok.items.map((item) => item.id)).size).toBe(ok.items.length);
    const tooLarge = await collectAuditLogsForExport(reader, query, { maxRows: 4, pageSize: 2 });
    expect(tooLarge).toEqual({ kind: 'TOO_LARGE', maxRows: 4 });
    await expect(collectAuditLogsForExport(reader, query, { maxRows: 0 })).rejects.toThrow(RangeError);
  });

  it('🔴 route: 上限を超える母集団は 400 AUDIT_LOG_EXPORT_TOO_LARGE + params.maxRows。弾いた要求は audit_log.export に記録しない', async () => {
    const count = AUDIT_LOG_EXPORT_MAX_ROWS + 1;
    await admin.auditLog.createMany({
      data: Array.from({ length: count }, (_, index) => ({
        tenantId: TENANT_1.tenantId,
        actorKind: 'SYSTEM' as const,
        actorId: null,
        action: 'usage.limit_released',
        targetType: MARKER,
        targetId: TENANT_1.tenantId,
        summary: { metric: 'EMAIL_COUNT', from: 'REACHED', to: 'BELOW' },
        ipAddress: null,
        deviceKind: null,
        createdAt: new Date(NOW.getTime() + (index % 3600) * 1000),
      })),
    });
    const reader = await ctxOf(HOST_OWNER, 'ADMIN');
    const response = await getExport(reader);
    expect(response.status).toBe(400);
    const body = (await response.json()) as { error: { code: string; messageKey: string; params?: { maxRows?: number } } };
    expect(body.error.code).toBe('AUDIT_LOG_EXPORT_TOO_LARGE');
    expect(body.error.messageKey).toBe('error.auditLogs.exportTooLarge');
    expect(body.error.params?.maxRows).toBe(AUDIT_LOG_EXPORT_MAX_ROWS);
    // 実際の件数は 400 に載らない（母集団の大きさを教えない）。
    expect(JSON.stringify(body)).not.toContain(String(count));
    expect(await exportRecords()).toEqual([]);
  }, 120_000);
});

describe('⑥ 🔴 audit_log.export の記録（docs/05 §16.1）', () => {
  it('1 エクスポート 1 行。USER 主体・targetType=Tenant・targetId=自テナント・summary は rowCount / truncated の 2 キーだけ', async () => {
    await insertRows([
      { action: 'auth.login', actorKind: 'USER', actorId: TENANT_1.hostUserId, summary: { method: 'credentials' } },
      { action: 'project.view', actorKind: 'USER', actorId: TENANT_1.hostOwnerUserId, summary: { via: 'DETAIL' } },
    ]);
    const reader = await ctxOf(HOST_OWNER, 'ADMIN');
    const first = await getExport(reader, { action: 'LOGIN_LOGOUT', actorId: TENANT_1.hostUserId });
    expect(first.status).toBe(200);
    const firstLines = markerLines(csvLines(await first.text()));
    expect(firstLines).toHaveLength(1);

    const records = await exportRecords();
    expect(records).toHaveLength(1);
    const record = records[0];
    expect(record).toMatchObject({
      actorKind: 'USER',
      actorId: TENANT_1.hostOwnerUserId,
      targetType: 'Tenant',
      targetId: TENANT_1.tenantId,
      tenantId: TENANT_1.tenantId,
      ipAddress: META.ipAddress,
    });
    // 🔴 summary は 2 キーだけ。検索条件（from / to / action / actorId）は載らない。rowCount は CSV の行数（マーカー以外も含む）。
    const summary = record?.summary as Record<string, unknown>;
    expect(Object.keys(summary).sort()).toEqual(['rowCount', 'truncated']);
    expect(summary['truncated']).toBe(false);
    expect(Number.isInteger(summary['rowCount'])).toBe(true);
    expect(JSON.stringify(summary)).not.toContain('LOGIN_LOGOUT');
    expect(JSON.stringify(summary)).not.toContain(TENANT_1.hostUserId);

    // 2 回目のエクスポートで 2 行目が増える（冪等ではない = 持ち出しのたびに記録する）。
    const second = await getExport(reader);
    expect(second.status).toBe(200);
    expect(await exportRecords()).toHaveLength(2);
    // 記録された行は #10 の一覧に現れ、detail は許可リストの 2 キー（rowCount / truncated）だけ。
    // 🔴 `audit_log.export` の `createdAt` は DB の実時刻（`NOW` の固定窓の外）なので、実時刻を含む窓で #10 を読む。
    const wallClock = Date.now();
    const wide = {
      from: new Date(Math.min(new Date(RANGE_FROM).getTime(), wallClock - 3_600_000)).toISOString(),
      to: new Date(Math.max(new Date(RANGE_TO).getTime(), wallClock + 3_600_000)).toISOString(),
    };
    const listBody = (await (await getList(reader, wide)).json()) as {
      items: readonly { action: string; targetType: string | null; detail: { entries: readonly { key: string; value: { kind: string; value: unknown } }[] } }[];
    };
    const exported = listBody.items.filter((item) => item.action === EXPORT_ACTION);
    expect(exported.length).toBeGreaterThanOrEqual(1);
    for (const item of exported) {
      expect(item.targetType).toBe('Tenant');
      expect(item.detail.entries.map((entry) => entry.key)).toEqual(['rowCount', 'truncated']);
      expect(item.detail.entries[1]?.value).toEqual({ kind: 'BOOLEAN', value: false });
    }
  });
});

describe('⑦ #10 と同じ期間・カテゴリで行集合が一致する', () => {
  it('件数と createdAt / action の並びが #10（全ページ）と同じ。カテゴリの絞り込みも同じ判定', async () => {
    const rows: RowInput[] = [
      { action: 'auth.login', actorKind: 'USER', actorId: TENANT_1.hostUserId, summary: {}, createdAt: new Date(NOW.getTime() + 1000) },
      { action: 'project.view', actorKind: 'USER', actorId: TENANT_1.hostUserId, summary: { via: 'DETAIL' }, createdAt: new Date(NOW.getTime() + 2000) },
      { action: 'engineer.view', actorKind: 'USER', actorId: PARTNER_1_1.userId, summary: { via: 'DETAIL' }, createdAt: new Date(NOW.getTime() + 3000) },
      { action: 'tenant.purge', actorKind: 'SYSTEM', actorId: null, summary: { cause: 'TENANT_PURGED', tables: 1, count_engineers: 3 }, createdAt: new Date(NOW.getTime() + 4000) },
    ];
    await insertRows(rows);
    const reader = await ctxOf(HOST_OWNER, 'ADMIN');
    const conditions: readonly Readonly<Record<string, string>>[] = [{}, { action: 'ENGINEER_SKILL_SHEET_ACCESS' }, { actorId: TENANT_1.hostUserId }];
    for (const extra of conditions) {
      const listBody = (await (await getList(reader, extra)).json()) as { items: readonly { createdAt: string; action: string }[]; nextCursor: string | null };
      expect(listBody.nextCursor).toBeNull();
      const lines = csvLines(await (await getExport(reader, extra)).text()).slice(1);
      expect(lines, JSON.stringify(extra)).toHaveLength(listBody.items.length);
      expect(lines.map((line) => line.split(',').slice(0, 1)[0])).toEqual(listBody.items.map((item) => item.createdAt));
      expect(lines.map((line) => line.split(',')[3])).toEqual(listBody.items.map((item) => item.action));
    }
    // `tenant.purge` の件数（`count_engineers`）は #10 の detail には出るが、CSV には出ない（行の詳細の列が無い）。
    const csv = await (await getExport(reader)).text();
    expect(csv).not.toContain('count_engineers');
    expect(csv).not.toContain('TENANT_PURGED');
  });
});
