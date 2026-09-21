// tests/isolation/audit-log-detail.test.ts
// 🔴 T-11-09（docs/05 §6.4「#10 の改訂」テスト②〔(a)〜(h)〕/ `docs/04` §S-041「行の詳細」/ `U-17` / §11-15。
//    [Issue #40](https://github.com/Festal-KM/SES-Platform/issues/40) = 選択肢 2）を **DB + RLS 付きで**実証する。
//
//   (a) 🔴 パートナー主体の台帳系 4 族（`engineer_share.update` / `engineer_career.update` / `skill_sheet.update` /
//       `engineer.view`）は、ホストの `ADMIN` の一覧で `entries: []` + `detailSuppressedReason: 'PARTNER_LEDGER'`。
//       応答の JSON に `periodFrom` / `changedFields` / `version` / `scanStatus` / `via` の**値**が 1 バイトも現れない
//       （`T-11-09` 受け入れ基準 2。第二境界）
//   (b) ホスト主体の `engineer_career.update` は `periodFrom` / `periodTo` / `changedFields` が出る（対照）
//   (c) 🔴 パートナー主体の `proposal_request.update`（`DECLINE`）は `operation` だけ。特権接続で `summary` に
//       `declineReason` / `reason` / `note` / `displayName` を注入しても応答に現れない（許可リスト側の保証。経路 4）
//   (d) `proposal_request.create` の `projectId` が案件名に解決され、削除済み・他テナントの案件は `null`
//   (e) `membership.role_change` の `beforeRole` / `afterRole` が対で返る（`F-002 AC-3` の画面側）
//   (f) 🔴 全 action について、許可リストの全キー + 禁止名 8 種を持つ `summary` を特権接続で書き、応答に禁止名の値が
//       現れない（`AUDIT_DETAIL_ALLOWLIST` のキーを走査して生成する = 列挙式にしない）
//   (g) `SYSTEM` 主体の `project.visibility_change`（`GATE_RESULT`）で `published` が社名に解決される
//   (h) 1 ページの DB クエリ本数が行数に依らず一定（`configureTenantDb` の `onQuery` で数える。N+1 の固定。
//       `audit_logs` + `users` + `memberships` + `partner_companies` + `projects` の最大 5 本）
//   (i) 🔴 T-12-18 ⑨ / ⑩ / ⑫（2026-09-18。docs/05 §6.4 の「T-12-18 ⑨ / ⑩ / ⑫ の追加分」）: 許可リストに足した行の**正のケース**
//       （`GATE_RESULT` の 4 verdict / `state.invalid_transition` の `entity` + `from → to` / `tenant.purge` の `count_{table}` /
//       `data_export.download` の `kind`）と、**負のケース**（`fields` / `wasLatest` / `runId` / `exportRequestId` / 形の合わない
//       `count_*` が落ちる）、および `admin.*` が接尾辞族の評価対象にならないこと
//   ＋ 認可: `VIEWER` は 403、他テナントの行は一覧に現れない（C2 HOST_ONLY）、`summary` プロパティが応答に無い
//
// 🔴 検証は `withApiRoute` が組み立てた**実物の Route Handler**（`GET /api/audit-logs`）に `Request` を渡して行う
//    （`project-visibility.test.ts` と同じ方針）。差し替えるのは `requireTenantCtx` の 1 点だけである。
//    行の投入は特権接続（superuser）で行う —— 書き込み側を経ずに「入っていたら」の形を作るのが本テストの目的。
import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  configureTenantDb,
  dataExportDownloadSummary,
  disconnectTenantDb,
  type AuthenticatedTenantCtx,
  type TenantIdentity,
  type TenantRole,
} from '@ses/db';
// 🔴 `@ses/config` をパッケージ名で import しない（`env-separation.test.ts` と同じ）。`tenant.purge` の表名の閉集合の出所。
import { PURGE_SPEC } from '../../packages/config/src/retention.js';
import { createUnextendedClient, type UnextendedClient } from '@ses/db/testing';
import {
  ISOLATION_SEED_IDS,
  isolationSeedCompanyNames,
  isolationSeedProjectNames,
  runSeed,
} from '@ses/db/seed';
import {
  AUDIT_DETAIL_ALLOWLIST,
  AUDIT_DETAIL_SUFFIX_FAMILIES,
  PARTNER_LEDGER_ACTION_PREFIXES,
  type AuditDetailAllowedKeySpec,
} from '../../packages/domain/src/audit/pick-detail.js';
import { startIsolationDatabase, type IsolationDatabase } from './support/postgres.js';

const SETUP_TIMEOUT_MS = 600_000;
/** 🔴 「実行日 = T」を固定する（docs/05 §17.6）。投入する行の `createdAt` もこれに揃える。 */
const NOW = new Date('2026-09-17T00:00:00.000Z');
const RANGE_FROM = new Date(NOW.getTime() - 60 * 60 * 1000).toISOString();
const RANGE_TO = new Date(NOW.getTime() + 60 * 60 * 1000).toISOString();
const META = { deviceKind: 'api', ipAddress: '203.0.113.21' } as const;

const requireTenantCtxMock = vi.fn<() => Promise<AuthenticatedTenantCtx>>();

vi.mock('../../apps/web/lib/auth/session', () => ({
  requireTenantCtx: () => requireTenantCtxMock(),
  readRequestMeta: async () => META,
}));

const { buildTenantCtx } = await import('../../apps/web/lib/auth/tenant-context');
const auditLogsRoute = await import('../../apps/web/app/api/(main)/audit-logs/route');

const TENANT_1 = ISOLATION_SEED_IDS.tenants[0];
const TENANT_2 = ISOLATION_SEED_IDS.tenants[1];
const PARTNER_1_1 = TENANT_1.partners[0];
const PARTNER_1_2 = TENANT_1.partners[1];
const COMPANY_NAMES = isolationSeedCompanyNames(1);
const PROJECT_NAMES = isolationSeedProjectNames(1);

const HOST_SALES: TenantIdentity = {
  tenantId: TENANT_1.tenantId,
  partnerCompanyId: null,
  userId: TENANT_1.hostUserId,
};
const HOST_OWNER: TenantIdentity = {
  tenantId: TENANT_1.tenantId,
  partnerCompanyId: null,
  userId: TENANT_1.hostOwnerUserId,
};
const PARTNER_USER: TenantIdentity = {
  tenantId: TENANT_1.tenantId,
  partnerCompanyId: PARTNER_1_1.partnerCompanyId,
  userId: PARTNER_1_1.userId,
};

/** 🔴 テストが作った行だけを見る・片付けるための目印（`targetType`）。 */
const MARKER = 'T1109Marker';

/** 応答の 1 件（`AuditLogListItem`）。🔴 `summary` は型に無い（`view.types.test.ts`）。 */
type DetailEntry = {
  readonly key: string;
  readonly pair: { readonly id: string; readonly side: 'BEFORE' | 'AFTER' } | null;
  readonly value: { readonly kind: string; readonly value?: unknown };
};
type AuditLogItemBody = {
  readonly id: string;
  readonly action: string;
  readonly actorKind: string;
  readonly actorId: string | null;
  readonly actorDisplayName: string | null;
  readonly targetType: string | null;
  readonly targetId: string | null;
  readonly detail: { readonly entries: readonly DetailEntry[] };
  readonly detailSuppressedReason: string | null;
};
type AuditLogPageBody = { readonly items: readonly AuditLogItemBody[]; readonly nextCursor: string | null };

type Summary = Readonly<Record<string, string | number | boolean | null>>;
type RowInput = {
  readonly action: string;
  readonly actorKind: 'USER' | 'SYSTEM' | 'PLATFORM_USER';
  readonly actorId: string | null;
  readonly summary: Summary;
  readonly targetId?: string;
  readonly tenantId?: string;
};

let database: IsolationDatabase;
/** 🔴 前提づくり（行の投入）と片付けだけに使う特権接続。検証のクエリには使わない。 */
let admin: UnextendedClient;
/** (h): `configureTenantDb` の `onQuery` が積む SQL 本文。 */
const observedQueries: string[] = [];

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

/** 特権接続で監査ログの行を投入する（書き込み側を経ない = 「入っていたら」の形を作る）。 */
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
      createdAt: NOW,
    })),
  });
}

/** `GET /api/audit-logs`（#10）を実物の Route Handler で叩く。 */
async function getAuditLogsResponse(ctx: AuthenticatedTenantCtx, extra: Readonly<Record<string, string>> = {}): Promise<Response> {
  requireTenantCtxMock.mockResolvedValue(ctx);
  const params = new URLSearchParams({ from: RANGE_FROM, to: RANGE_TO, limit: '200', ...extra });
  return auditLogsRoute.GET(new Request(`https://app.test/api/audit-logs?${params.toString()}`));
}

/** 本テストが投入した行（`targetType = MARKER`）だけを返す。 */
async function markerItems(ctx: AuthenticatedTenantCtx, extra: Readonly<Record<string, string>> = {}): Promise<readonly AuditLogItemBody[]> {
  const response = await getAuditLogsResponse(ctx, extra);
  expect(response.status).toBe(200);
  const body = (await response.json()) as AuditLogPageBody;
  return body.items.filter((item) => item.targetType === MARKER);
}

function only<T>(items: readonly T[]): T {
  expect(items).toHaveLength(1);
  return items[0] as T;
}

function keysOf(item: AuditLogItemBody): readonly string[] {
  return item.detail.entries.map((entry) => entry.key);
}

function entry(item: AuditLogItemBody, key: string): DetailEntry {
  return only(item.detail.entries.filter((candidate) => candidate.key === key));
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
  configureTenantDb({
    datasourceUrl: database.tenantUrl,
    onQuery: (event) => {
      observedQueries.push(event.query);
    },
  });

  // 🔴 `OWNER` / `ADMIN` は 2 要素認証が必須（`CLAUDE.md` §3.5）。
  await enrollTwoFactor(TENANT_1.hostOwnerUserId, TENANT_1.tenantId);
  await enrollTwoFactor(TENANT_1.hostUserId, TENANT_1.tenantId);
}, SETUP_TIMEOUT_MS);

afterAll(async () => {
  await disconnectTenantDb();
  await admin?.$disconnect();
  await database?.stop();
});

beforeEach(() => {
  requireTenantCtxMock.mockReset();
  observedQueries.length = 0;
});

afterEach(async () => {
  await setRole(HOST_SALES, 'SALES');
  await setRole(HOST_OWNER, 'OWNER');
  await setRole(PARTNER_USER, 'PARTNER_SALES');
  await admin.auditLog.deleteMany({ where: { targetType: MARKER } });
});

describe('(a) 🔴 パートナー主体の台帳系 4 族は、ホストの ADMIN に 1 キーも出ない（U-17 / T-11-09 受け入れ基準 2）', () => {
  const LEDGER_ROWS: readonly RowInput[] = [
    {
      action: 'engineer_share.update',
      actorKind: 'USER',
      actorId: PARTNER_1_1.userId,
      summary: { operation: 'SHARE', engineerId: PARTNER_1_1.engineerId },
    },
    {
      action: 'engineer_career.update',
      actorKind: 'USER',
      actorId: PARTNER_1_1.userId,
      summary: {
        careerId: randomUUID(),
        periodFrom: '2019-04',
        periodTo: null,
        changedFields: 'periodFrom,role',
        source: 'MANUAL',
      },
    },
    {
      action: 'skill_sheet.update',
      actorKind: 'USER',
      actorId: PARTNER_1_1.userId,
      summary: { operation: 'SET_LATEST', engineerId: PARTNER_1_1.engineerId, version: 3, wasLatest: false },
    },
    {
      action: 'engineer.view',
      actorKind: 'USER',
      actorId: PARTNER_1_1.userId,
      summary: { via: 'EDIT_FORM', engineerId: PARTNER_1_1.engineerId },
    },
    {
      action: 'skill_sheet.download',
      actorKind: 'USER',
      actorId: PARTNER_1_1.userId,
      summary: { engineerId: PARTNER_1_1.engineerId, version: 2, scanStatus: 'CLEAN' },
    },
  ];

  it('entries: [] + detailSuppressedReason: PARTNER_LEDGER になり、値が 1 バイトも現れない', async () => {
    await insertRows(LEDGER_ROWS);
    const reader = await ctxOf(HOST_OWNER, 'ADMIN');

    const items = await markerItems(reader);
    expect(items).toHaveLength(LEDGER_ROWS.length);
    for (const item of items) {
      expect(item.actorId).toBe(PARTNER_1_1.userId);
      expect(item.detail).toEqual({ entries: [] });
      expect(item.detailSuppressedReason).toBe('PARTNER_LEDGER');
      expect(item).not.toHaveProperty('summary');
    }
    const json = JSON.stringify(items);
    for (const forbidden of ['2019-04', 'periodFrom', 'changedFields', 'SET_LATEST', 'SHARE', 'EDIT_FORM', 'CLEAN', '"version"', 'scanStatus', '"via"', 'MANUAL']) {
      expect(json, `${forbidden} が応答に現れた`).not.toContain(forbidden);
    }
    // 🔴 対照: 表示名（主体列）は従来どおり解決される —— 抑制されるのは detail だけ。
    expect(items.every((item) => item.actorDisplayName !== null)).toBe(true);
  });

  it('🔴 主体の所属の判定はサーバ側: 同じ summary でもホスト主体なら出る（対照）', async () => {
    await insertRows(LEDGER_ROWS.map((row) => ({ ...row, actorId: TENANT_1.hostUserId })));
    const reader = await ctxOf(HOST_OWNER, 'ADMIN');

    const items = await markerItems(reader);
    expect(items).toHaveLength(LEDGER_ROWS.length);
    expect(items.every((item) => item.detailSuppressedReason === null)).toBe(true);
    expect(items.every((item) => item.detail.entries.length > 0)).toBe(true);
  });

  it('無効化済み（revoked_at あり）のパートナー主体でも所属は解決され、抑制される', async () => {
    await admin.membership.updateMany({
      where: { tenantId: TENANT_1.tenantId, userId: PARTNER_1_1.userId },
      data: { revokedAt: NOW },
    });
    try {
      await insertRows([LEDGER_ROWS[3] as RowInput]);
      const reader = await ctxOf(HOST_OWNER, 'ADMIN');
      const item = only(await markerItems(reader));
      expect(item.detailSuppressedReason).toBe('PARTNER_LEDGER');
      expect(item.detail.entries).toEqual([]);
    } finally {
      await admin.membership.updateMany({
        where: { tenantId: TENANT_1.tenantId, userId: PARTNER_1_1.userId },
        data: { revokedAt: null },
      });
    }
  });

  it('所属が解決できない主体（所属行の無い USER / SYSTEM）の 4 族は entries: [] で、理由は出さない', async () => {
    await insertRows([
      { action: 'engineer.view', actorKind: 'USER', actorId: randomUUID(), summary: { via: 'DETAIL' } },
      { action: 'skill_sheet.update', actorKind: 'SYSTEM', actorId: null, summary: { operation: 'SET_LATEST', version: 1 } },
    ]);
    const reader = await ctxOf(HOST_OWNER, 'ADMIN');
    const items = await markerItems(reader);
    expect(items).toHaveLength(2);
    for (const item of items) {
      expect(item.detail).toEqual({ entries: [] });
      expect(item.detailSuppressedReason).toBeNull();
    }
    expect(JSON.stringify(items)).not.toContain('SET_LATEST');
  });
});

describe('(b) ホスト主体の engineer_career.update は期間と変更項目が出る（対照）', () => {
  it('periodFrom / periodTo（null = 継続中）/ changedFields が出て、careerId / source は落ちる', async () => {
    await insertRows([
      {
        action: 'engineer_career.update',
        actorKind: 'USER',
        actorId: TENANT_1.hostUserId,
        summary: { careerId: randomUUID(), periodFrom: '2020-04', periodTo: null, changedFields: 'periodFrom,role', source: 'MANUAL' },
      },
    ]);
    const reader = await ctxOf(HOST_OWNER, 'ADMIN');

    const item = only(await markerItems(reader));
    expect(item.detailSuppressedReason).toBeNull();
    expect(keysOf(item)).toEqual(['changedFields', 'periodFrom', 'periodTo']);
    expect(entry(item, 'periodFrom').value).toEqual({ kind: 'DATE', value: '2020-04' });
    expect(entry(item, 'periodTo').value).toEqual({ kind: 'DATE', value: null });
    expect(entry(item, 'changedFields').value).toEqual({ kind: 'FIELD_NAMES', value: ['periodFrom', 'role'] });
    expect(JSON.stringify(item)).not.toContain('careerId');
    expect(JSON.stringify(item)).not.toContain('MANUAL');
  });
});

describe('(c) 🔴 パートナー主体の proposal_request.update（DECLINE）は operation だけ（経路 4「辞退の理由をホストに開示しない」）', () => {
  it('declineReason / reason / note / displayName を注入しても応答に 1 つも現れない', async () => {
    await insertRows([
      {
        action: 'proposal_request.update',
        actorKind: 'USER',
        actorId: PARTNER_1_1.userId,
        summary: {
          operation: 'DECLINE',
          fromState: 'REQUESTED',
          toState: 'DECLINED',
          proposalId: randomUUID(),
          declineReason: '単価が合わないため辞退します',
          reason: 'OTHER',
          note: '担当者メモ',
          displayName: '山田 太郎',
        },
      },
    ]);
    const reader = await ctxOf(HOST_OWNER, 'ADMIN');

    const item = only(await markerItems(reader));
    expect(item.detailSuppressedReason).toBeNull();
    expect(item.detail.entries).toEqual([{ key: 'operation', pair: null, value: { kind: 'ENUM', value: 'DECLINE' } }]);
    const json = JSON.stringify(item);
    for (const forbidden of ['単価', '辞退します', 'declineReason', 'OTHER', '担当者メモ', '山田', 'displayName', '"REQUESTED"', '"DECLINED"', 'proposalId']) {
      expect(json, `${forbidden} が応答に現れた`).not.toContain(forbidden);
    }
  });
});

describe('(d) proposal_request.create の projectId は案件名に解決される', () => {
  it('ホストの案件は名前、削除済み・他テナントの案件は null（位置を保つ）', async () => {
    const deletedProjectId = randomUUID();
    await insertRows([
      { action: 'proposal_request.create', actorKind: 'USER', actorId: TENANT_1.hostUserId, summary: { projectId: TENANT_1.publishedProjectId }, targetId: TENANT_1.publishedProjectId },
      { action: 'proposal_request.create', actorKind: 'USER', actorId: TENANT_1.hostUserId, summary: { projectId: deletedProjectId }, targetId: deletedProjectId },
      { action: 'proposal_request.create', actorKind: 'USER', actorId: TENANT_1.hostUserId, summary: { projectId: TENANT_2.publishedProjectId }, targetId: TENANT_2.publishedProjectId },
    ]);
    const reader = await ctxOf(HOST_OWNER, 'ADMIN');

    const items = await markerItems(reader);
    const byTarget = new Map(items.map((item) => [item.targetId, item] as const));
    expect(entry(byTarget.get(TENANT_1.publishedProjectId) as AuditLogItemBody, 'projectId').value).toEqual({ kind: 'NAME', value: PROJECT_NAMES.published });
    expect(entry(byTarget.get(deletedProjectId) as AuditLogItemBody, 'projectId').value).toEqual({ kind: 'NAME', value: null });
    // 🔴 他テナントの案件名は RLS（C4）で解決できない = null。名前が越境しない。
    expect(entry(byTarget.get(TENANT_2.publishedProjectId) as AuditLogItemBody, 'projectId').value).toEqual({ kind: 'NAME', value: null });
    expect(JSON.stringify(items)).not.toContain(isolationSeedProjectNames(2).published);
  });
});

describe('(e) membership.role_change の beforeRole / afterRole が対で返る（F-002 AC-3 の画面側）', () => {
  it('対の 2 件だけが出て、targetUserId / partnerScoped は落ちる。revoke は beforeRole の片側のみ', async () => {
    await insertRows([
      {
        action: 'membership.role_change',
        actorKind: 'USER',
        actorId: TENANT_1.hostOwnerUserId,
        summary: { targetUserId: TENANT_1.hostUserId, beforeRole: 'SALES', afterRole: 'ADMIN', partnerScoped: false },
        targetId: TENANT_1.hostMembershipId,
      },
      {
        action: 'membership.revoke',
        actorKind: 'USER',
        actorId: TENANT_1.hostOwnerUserId,
        summary: { targetUserId: PARTNER_1_2.userId, beforeRole: 'PARTNER_SALES', partnerScoped: true },
        targetId: PARTNER_1_2.membershipId,
      },
    ]);
    const reader = await ctxOf(HOST_OWNER, 'ADMIN');

    const items = await markerItems(reader);
    const change = only(items.filter((item) => item.action === 'membership.role_change'));
    expect(change.detail.entries).toEqual([
      { key: 'beforeRole', pair: { id: 'role', side: 'BEFORE' }, value: { kind: 'ENUM', value: 'SALES' } },
      { key: 'afterRole', pair: { id: 'role', side: 'AFTER' }, value: { kind: 'ENUM', value: 'ADMIN' } },
    ]);
    const revoke = only(items.filter((item) => item.action === 'membership.revoke'));
    expect(revoke.detail.entries).toEqual([
      { key: 'beforeRole', pair: { id: 'role', side: 'BEFORE' }, value: { kind: 'ENUM', value: 'PARTNER_SALES' } },
    ]);
    expect(JSON.stringify(items)).not.toContain('targetUserId');
    expect(JSON.stringify(items)).not.toContain('partnerScoped');
  });
});

describe('(f) 🔴 全 action: 許可リストの全キー + 禁止名 8 種を書いても、禁止名の値は応答に現れない', () => {
  /** 禁止名（docs/05 テスト (f)）。値は非 ASCII を含め、どの形の検査にも合わない。 */
  const FORBIDDEN: Summary = {
    note: '禁止-note-の値',
    body: '禁止-body-の値',
    subject: '禁止-subject-の値',
    reason: '禁止-reason-の値',
    declineReason: '禁止-declineReason-の値',
    unitPrice: 800000,
    displayName: '禁止-displayName-山田太郎',
    email: 'forbidden-t1109@example.invalid',
  };

  /** 接尾辞族は具体的な action に写す（表に無い action が接尾辞で拾われる側の代表）。 */
  const FAMILY_REPRESENTATIVE: Readonly<Record<string, string>> = {
    '*.create': 'invitation.create',
    '*.update': 'partner_company.update',
    '*.delete': 'project_requirement.delete',
  };

  function conformingValue(spec: AuditDetailAllowedKeySpec): string | number | boolean {
    switch (spec.kind) {
      case 'ENUM':
        return spec.values?.[0] ?? 'SAMPLE_TOKEN';
      case 'NUMBER':
        return 7;
      case 'BOOLEAN':
        return true;
      case 'DATE':
        return '2026-09-17';
      case 'FIELD_NAMES':
        return 'alpha,beta';
      case 'REF':
        return spec.entity === 'PROJECT' ? TENANT_1.publishedProjectId : spec.entity === 'USER' ? TENANT_1.hostUserId : PARTNER_1_1.partnerCompanyId;
      case 'REF_LIST':
        return `${PARTNER_1_1.partnerCompanyId},${PARTNER_1_2.partnerCompanyId}`;
    }
  }

  it('AUDIT_DETAIL_ALLOWLIST を走査して生成した行のすべてで、禁止名の値が無く、キー集合が許可リストの部分集合', async () => {
    const actions = Object.keys(AUDIT_DETAIL_ALLOWLIST);
    expect(actions.length).toBeGreaterThan(20);
    const rows: RowInput[] = actions.map((listed) => {
      const specs = AUDIT_DETAIL_ALLOWLIST[listed] ?? {};
      const allowed: Record<string, string | number | boolean> = {};
      for (const [key, spec] of Object.entries(specs)) allowed[key] = conformingValue(spec);
      return {
        action: FAMILY_REPRESENTATIVE[listed] ?? listed,
        // 🔴 ホスト主体で書く（4 族の抑制ではなく、許可リストそのものの保証を見る）。
        actorKind: 'USER',
        actorId: TENANT_1.hostUserId,
        summary: { ...allowed, ...FORBIDDEN },
      };
    });
    await insertRows(rows);
    const reader = await ctxOf(HOST_OWNER, 'ADMIN');

    const items = await markerItems(reader);
    expect(items).toHaveLength(rows.length);
    const json = JSON.stringify(items);
    expect(json).not.toContain('禁止-');
    expect(json).not.toContain('800000');
    expect(json).not.toContain('example.invalid');
    expect(json).not.toContain('"summary"');
    for (const key of Object.keys(FORBIDDEN)) {
      expect(json, `キー ${key} が応答に現れた`).not.toContain(`"${key}"`);
    }
    // キー集合は許可リストの部分集合（4 族もホスト主体なので表が評価される）。
    for (const item of items) {
      const listed = Object.entries(FAMILY_REPRESENTATIVE).find(([, action]) => action === item.action)?.[0] ?? item.action;
      const allowed = new Set(Object.keys(AUDIT_DETAIL_ALLOWLIST[listed] ?? {}));
      for (const key of keysOf(item)) expect(allowed.has(key), `${item.action}.${key}`).toBe(true);
      expect(item.detailSuppressedReason).toBeNull();
    }
    // 対照: 走査が空振りしていない —— 許可されたキーは実際に出ている（proposal.approve の reason = ALL_LAYERS_PASS）。
    const approve = only(items.filter((item) => item.action === 'proposal.approve'));
    expect(entry(approve, 'requestedBy').value).toEqual({ kind: 'NAME', value: approve.actorDisplayName });
    expect(entry(approve, 'fromState').value).toEqual({ kind: 'ENUM', value: 'DRAFT' });
    // `reason` は proposal.approve で許可されたキーだが、注入した自由文は形の検査（閉集合）で落ちる = 2 段目の網。
    expect(keysOf(approve)).not.toContain('reason');
    expect(PARTNER_LEDGER_ACTION_PREFIXES.length).toBe(4);
    expect(AUDIT_DETAIL_SUFFIX_FAMILIES.every((family) => family in FAMILY_REPRESENTATIVE)).toBe(true);
  });
});

describe('(g) SYSTEM 主体の project.visibility_change（GATE_RESULT）', () => {
  it('published が社名に解決され、blocked は空配列、reviewGateId / *Verdict は落ちる', async () => {
    const reviewGateId = randomUUID();
    await insertRows([
      {
        action: 'project.visibility_change',
        actorKind: 'SYSTEM',
        actorId: null,
        summary: {
          operation: 'GATE_RESULT',
          verdict: 'PUBLISHED',
          published: [PARTNER_1_1.partnerCompanyId, PARTNER_1_2.partnerCompanyId].sort().join(','),
          blocked: '',
          reviewGateId,
          piiVerdict: 'PASS',
          commerceVerdict: 'PASS',
          consistencyVerdict: 'PASS',
        },
        targetId: TENANT_1.publishedProjectId,
      },
    ]);
    const reader = await ctxOf(HOST_OWNER, 'ADMIN');

    const item = only(await markerItems(reader));
    expect(item.actorKind).toBe('SYSTEM');
    expect(item.detailSuppressedReason).toBeNull();
    expect(keysOf(item)).toEqual(['published', 'blocked', 'verdict', 'operation']);
    const published = entry(item, 'published').value as { kind: string; value: readonly (string | null)[] };
    expect(published.kind).toBe('NAME_LIST');
    expect([...published.value].sort()).toEqual([...COMPANY_NAMES.partners].sort());
    expect(entry(item, 'blocked').value).toEqual({ kind: 'NAME_LIST', value: [] });
    expect(entry(item, 'verdict').value).toEqual({ kind: 'ENUM', value: 'PUBLISHED' });
    const json = JSON.stringify(item);
    expect(json).not.toContain(reviewGateId);
    expect(json).not.toContain('piiVerdict');
    expect(json).not.toContain(PARTNER_1_1.partnerCompanyId);
  });

  it('削除済みの取引先は null の要素として位置を保つ（画面が「削除済みの取引先」を描く）', async () => {
    const deletedPartnerId = randomUUID();
    await insertRows([
      {
        action: 'project.visibility_change',
        actorKind: 'USER',
        actorId: TENANT_1.hostUserId,
        summary: {
          before: [PARTNER_1_1.partnerCompanyId, deletedPartnerId].sort().join(','),
          after: PARTNER_1_1.partnerCompanyId,
          requested: PARTNER_1_1.partnerCompanyId,
          pending: '',
          revoked: deletedPartnerId,
          verdict: 'NO_PUBLISH_REQUESTED',
        },
        targetId: TENANT_1.publishedProjectId,
      },
    ]);
    const reader = await ctxOf(HOST_OWNER, 'ADMIN');

    const item = only(await markerItems(reader));
    const before = entry(item, 'before').value as { kind: string; value: readonly (string | null)[] };
    expect(before.kind).toBe('NAME_LIST');
    expect(before.value).toHaveLength(2);
    expect(before.value).toContain(COMPANY_NAMES.partners[0]);
    expect(before.value).toContain(null);
    expect(entry(item, 'revoked').value).toEqual({ kind: 'NAME_LIST', value: [null] });
    expect(JSON.stringify(item)).not.toContain(deletedPartnerId);
  });
});

describe('(h) 1 ページの DB クエリ本数が行数に依らず一定（N+1 の固定）', () => {
  const TABLE_PATTERN = /"public"\."(audit_logs|users|memberships|partner_companies|projects)"/g;

  function rowsWithDistinctRefs(count: number): RowInput[] {
    return Array.from({ length: count }, (_, index): RowInput => ({
      action: index % 2 === 0 ? 'proposal_request.create' : 'project.visibility_change',
      actorKind: 'USER',
      // 主体を交互に変える（memberships / users の解決が集合になることを見る）。
      actorId: index % 3 === 0 ? PARTNER_1_1.userId : index % 3 === 1 ? TENANT_1.hostUserId : TENANT_1.hostOwnerUserId,
      summary: (index % 2 === 0
        ? { projectId: index % 4 === 0 ? TENANT_1.publishedProjectId : TENANT_1.privateProjectId }
        : { before: PARTNER_1_1.partnerCompanyId, after: `${PARTNER_1_1.partnerCompanyId},${PARTNER_1_2.partnerCompanyId}`, verdict: 'PENDING_GATE' }) as Summary,
    }));
  }

  /** 観測した SQL のうち、5 テーブルを読むものをテーブル別に数える。 */
  function tableReads(queries: readonly string[]): Readonly<Record<string, number>> {
    const counts: Record<string, number> = {};
    for (const query of queries) {
      if (!/^\s*SELECT/i.test(query)) continue;
      const tables = new Set([...query.matchAll(TABLE_PATTERN)].map((match) => match[1] as string));
      for (const table of tables) counts[table] = (counts[table] ?? 0) + 1;
    }
    return counts;
  }

  async function measure(rowCount: number): Promise<{ readonly total: number; readonly reads: Readonly<Record<string, number>>; readonly items: number }> {
    await admin.auditLog.deleteMany({ where: { targetType: MARKER } });
    await insertRows(rowsWithDistinctRefs(rowCount));
    const reader = await ctxOf(HOST_OWNER, 'ADMIN');
    observedQueries.length = 0;
    const items = await markerItems(reader);
    const snapshot = [...observedQueries];
    return { total: snapshot.length, reads: tableReads(snapshot), items: items.length };
  }

  it('3 行と 24 行で SQL の本数が同じで、5 テーブルの読み取りはそれぞれ最大 1 本', async () => {
    const small = await measure(3);
    const large = await measure(24);
    expect(small.items).toBe(3);
    expect(large.items).toBe(24);
    expect(small.total).toBeGreaterThan(0);
    expect(large.total).toBe(small.total);
    for (const table of ['audit_logs', 'users', 'memberships', 'partner_companies', 'projects']) {
      expect(large.reads[table] ?? 0, `${table} の読み取り本数`).toBeLessThanOrEqual(1);
    }
    // 対照: 5 テーブルは実際に読まれている（走査が空振りしていない）。
    expect(large.reads['audit_logs']).toBe(1);
    expect(large.reads['memberships']).toBe(1);
    expect(large.reads['users']).toBe(1);
    expect(large.reads['partner_companies']).toBe(1);
    expect(large.reads['projects']).toBe(1);
  });

  it('解決するものが無いページでは users / memberships / partner_companies / projects を読まない（往復を省く）', async () => {
    await insertRows([{ action: 'auth.login', actorKind: 'SYSTEM', actorId: null, summary: {} }]);
    const reader = await ctxOf(HOST_OWNER, 'ADMIN');
    observedQueries.length = 0;
    const items = await markerItems(reader);
    expect(items).toHaveLength(1);
    const reads = tableReads([...observedQueries]);
    expect(reads['audit_logs']).toBe(1);
    expect(reads['users'] ?? 0).toBe(0);
    expect(reads['memberships'] ?? 0).toBe(0);
    expect(reads['partner_companies'] ?? 0).toBe(0);
    expect(reads['projects'] ?? 0).toBe(0);
  });
});

describe('(i) 🔴 T-12-18 ⑨ / ⑩ / ⑫: 許可リストに足した行の正のケースと、載せないキーが落ちる負のケース', () => {
  it('⑨ proposal.update の GATE_RESULT（SYSTEM 主体。gate-run.ts の形）: 4 つの verdict が ENUM、件数が NUMBER で出て、aiFailed は落ちる', async () => {
    await insertRows([
      {
        action: 'proposal.update',
        actorKind: 'SYSTEM',
        actorId: null,
        // `apps/worker/src/jobs/gate-run.ts` が書く `summary` と同じキー集合。
        summary: {
          operation: 'GATE_RESULT',
          overall: 'FAIL',
          piiVerdict: 'FAIL',
          commerceVerdict: 'PASS',
          consistencyVerdict: 'PASS',
          aiFailed: true,
          findingCount: 2,
          warningCount: 1,
        },
      },
    ]);
    const reader = await ctxOf(HOST_OWNER, 'ADMIN');
    const item = only(await markerItems(reader));
    expect(keysOf(item)).toEqual([
      'operation',
      'overall',
      'piiVerdict',
      'commerceVerdict',
      'consistencyVerdict',
      'findingCount',
      'warningCount',
    ]);
    expect(entry(item, 'overall').value).toEqual({ kind: 'ENUM', value: 'FAIL' });
    expect(entry(item, 'piiVerdict').value).toEqual({ kind: 'ENUM', value: 'FAIL' });
    expect(entry(item, 'commerceVerdict').value).toEqual({ kind: 'ENUM', value: 'PASS' });
    expect(entry(item, 'consistencyVerdict').value).toEqual({ kind: 'ENUM', value: 'PASS' });
    expect(entry(item, 'findingCount').value).toEqual({ kind: 'NUMBER', value: 2 });
    expect(entry(item, 'warningCount').value).toEqual({ kind: 'NUMBER', value: 1 });
    expect(JSON.stringify(item)).not.toContain('aiFailed');
  });

  it('⑨ state.invalid_transition（invalid-transition.ts の形 { entity, from, to }）: entity は閉集合の ENUM、from → to は state の対。取引先主体でも出る', async () => {
    await insertRows([
      { action: 'state.invalid_transition', actorKind: 'USER', actorId: PARTNER_1_1.userId, summary: { entity: 'Proposal', from: 'DRAFT', to: 'WON' } },
      {
        action: 'state.invalid_transition',
        actorKind: 'USER',
        actorId: TENANT_1.hostUserId,
        summary: { entity: 'ProposalRequest', from: 'REQUESTED', to: 'ACCEPTED', reason: '応諾できません' },
      },
    ]);
    const reader = await ctxOf(HOST_OWNER, 'ADMIN');
    const items = await markerItems(reader);
    expect(items).toHaveLength(2);
    for (const item of items) {
      expect(item.detailSuppressedReason).toBeNull();
      expect(keysOf(item)).toEqual(['entity', 'from', 'to']);
      expect(entry(item, 'from').pair).toEqual({ id: 'state', side: 'BEFORE' });
      expect(entry(item, 'to').pair).toEqual({ id: 'state', side: 'AFTER' });
    }
    const partnerRow = only(items.filter((item) => item.actorId === PARTNER_1_1.userId));
    expect(entry(partnerRow, 'entity').value).toEqual({ kind: 'ENUM', value: 'Proposal' });
    expect(entry(partnerRow, 'to').value).toEqual({ kind: 'ENUM', value: 'WON' });
    expect(JSON.stringify(items)).not.toContain('応諾できません');
  });

  it('🔴 ⑩ tenant.purge（tenant-purge.ts の形。SYSTEM 主体）: count_{table} が PURGE_SPEC.delete の表名ぶん NUMBER で出て、runId は落ちる', async () => {
    const tables = PURGE_SPEC.delete.map((spec) => spec.table);
    const runId = randomUUID();
    const counts: Record<string, number> = {};
    tables.forEach((table, index) => {
      counts[`count_${table}`] = index;
    });
    await insertRows([
      {
        action: 'tenant.purge',
        actorKind: 'SYSTEM',
        actorId: null,
        summary: { cause: 'TENANT_PURGED', runId, tables: tables.length, ...counts },
        targetId: TENANT_1.tenantId,
      },
    ]);
    const reader = await ctxOf(HOST_OWNER, 'ADMIN');
    const item = only(await markerItems(reader));
    expect(keysOf(item)).toEqual(['cause', 'tables', ...tables.map((table) => `count_${table}`).sort()]);
    expect(entry(item, 'cause').value).toEqual({ kind: 'ENUM', value: 'TENANT_PURGED' });
    expect(entry(item, 'tables').value).toEqual({ kind: 'NUMBER', value: tables.length });
    for (const [index, table] of tables.entries()) {
      expect(entry(item, `count_${table}`).value).toEqual({ kind: 'NUMBER', value: index });
    }
    const json = JSON.stringify(item);
    expect(json).not.toContain('runId');
    expect(json).not.toContain(runId);
    expect(tables.length).toBeGreaterThan(10);
  });

  it('⑩ data_export.download（dataExportDownloadSummary の形）: kind = CLOSING_RETURN が出て、exportRequestId は落ちる', async () => {
    const exportRequestId = randomUUID();
    await insertRows([
      {
        action: 'data_export.download',
        actorKind: 'USER',
        actorId: TENANT_1.hostOwnerUserId,
        summary: dataExportDownloadSummary(exportRequestId),
        targetId: exportRequestId,
      },
    ]);
    const reader = await ctxOf(HOST_OWNER, 'ADMIN');
    const item = only(await markerItems(reader));
    expect(item.detail.entries).toEqual([{ key: 'kind', pair: null, value: { kind: 'ENUM', value: 'CLOSING_RETURN' } }]);
    // 要求の識別子は `対象` 列（targetId）で読む。detail には重ねない。
    expect(item.targetId).toBe(exportRequestId);
    expect(JSON.stringify(item.detail)).not.toContain(exportRequestId);
    expect(JSON.stringify(item.detail)).not.toContain('exportRequestId');
  });

  it('🔴 負のケース: DRAFT_UPDATE の fields / skill_sheet.update の wasLatest / 表名の形でない count_ / 負数の count_ が落ちる', async () => {
    await insertRows([
      { action: 'proposal.update', actorKind: 'USER', actorId: TENANT_1.hostUserId, summary: { operation: 'DRAFT_UPDATE', fields: 'body,subject' } },
      { action: 'skill_sheet.update', actorKind: 'USER', actorId: TENANT_1.hostUserId, summary: { operation: 'SET_LATEST', version: 2, wasLatest: false } },
      {
        action: 'tenant.purge',
        actorKind: 'SYSTEM',
        actorId: null,
        summary: { cause: 'RETENTION', tables: 2, 'count_Engineers!': 1, count_engineers: -1, count_skill_sheets: 3 },
      },
    ]);
    const reader = await ctxOf(HOST_OWNER, 'ADMIN');
    const items = await markerItems(reader);
    const draft = only(items.filter((item) => item.action === 'proposal.update'));
    expect(keysOf(draft)).toEqual(['operation']);
    const sheet = only(items.filter((item) => item.action === 'skill_sheet.update'));
    expect(keysOf(sheet)).toEqual(['operation']);
    const purge = only(items.filter((item) => item.action === 'tenant.purge'));
    expect(keysOf(purge)).toEqual(['cause', 'tables', 'count_skill_sheets']);
    const json = JSON.stringify(items);
    for (const forbidden of ['fields', 'body,subject', 'wasLatest', 'count_Engineers!', '"count_engineers"']) {
      expect(json, `${forbidden} が応答に現れた`).not.toContain(forbidden);
    }
  });

  it('🔴 ⑫ admin.tenant.create / admin.tenant.update は CRUD_KEYS の全キーを持っていても entries: []（対照: partner_company.update は出る）', async () => {
    const crud: Record<string, string | number> = {
      operation: 'SUSPEND',
      decision: 'ACCEPT',
      mode: 'AUTO',
      status: 'ACTIVE',
      fields: 'name',
      changedFields: 'name',
      skillCount: 1,
      headcount: 2,
      mustCount: 3,
      niceCount: 4,
      periodFrom: '2026-09',
      periodTo: '2026-10',
    };
    await insertRows([
      { action: 'admin.tenant.create', actorKind: 'PLATFORM_USER', actorId: null, summary: { ...crud, before: 'x', after: 'y', platformRole: 'PLATFORM_OWNER' } },
      { action: 'admin.tenant.update', actorKind: 'PLATFORM_USER', actorId: null, summary: crud },
      {
        action: 'partner_company.update',
        actorKind: 'USER',
        actorId: TENANT_1.hostOwnerUserId,
        summary: { operation: 'SUSPEND', reason: 'PII を含みうる自由文' },
        targetId: PARTNER_1_1.partnerCompanyId,
      },
    ]);
    const reader = await ctxOf(HOST_OWNER, 'ADMIN');
    const items = await markerItems(reader);
    for (const action of ['admin.tenant.create', 'admin.tenant.update']) {
      const row = only(items.filter((item) => item.action === action));
      expect(row.detail, action).toEqual({ entries: [] });
      expect(row.detailSuppressedReason).toBeNull();
      expect(row.actorKind).toBe('PLATFORM_USER');
    }
    const partner = only(items.filter((item) => item.action === 'partner_company.update'));
    expect(partner.detail.entries).toEqual([{ key: 'operation', pair: null, value: { kind: 'ENUM', value: 'SUSPEND' } }]);
    const json = JSON.stringify(items);
    // 🔴 `SUSPEND` が出るのは `partner_company.update` の 1 件だけ（`admin.*` に CRUD の許可キーが当たっていない）。
    expect(json.match(/"SUSPEND"/g)).toHaveLength(1);
    expect(json).not.toContain('PII を含みうる');
    expect(json).not.toContain('platformRole');
  });
});

describe('認可と境界（既存どおり）', () => {
  it('VIEWER は 403（S-041 の閲覧者は OWNER / ADMIN のみ）', async () => {
    const viewer = await ctxOf(HOST_SALES, 'VIEWER');
    const response = await getAuditLogsResponse(viewer);
    expect(response.status).toBe(403);
  });

  it('PARTNER_ADMIN は 403 で、詳細にも到達しない', async () => {
    await insertRows([{ action: 'proposal_request.update', actorKind: 'USER', actorId: PARTNER_1_1.userId, summary: { operation: 'ACCEPT' } }]);
    const partner = await ctxOf(PARTNER_USER, 'PARTNER_ADMIN');
    const response = await getAuditLogsResponse(partner);
    expect(response.status).toBe(403);
  });

  it('🔴 他テナントの行は一覧に現れない（C2 HOST_ONLY。名前解決の材料にもならない）', async () => {
    await insertRows([
      {
        action: 'project.visibility_change',
        actorKind: 'USER',
        actorId: TENANT_2.hostUserId,
        tenantId: TENANT_2.tenantId,
        summary: { before: '', after: TENANT_2.partners[0].partnerCompanyId, verdict: 'PENDING_GATE' },
        targetId: TENANT_2.publishedProjectId,
      },
    ]);
    const reader = await ctxOf(HOST_OWNER, 'ADMIN');
    const items = await markerItems(reader);
    expect(items).toEqual([]);
  });

  it('応答の各行に summary プロパティが無く、detail / detailSuppressedReason を必ず持つ', async () => {
    await insertRows([
      { action: 'auth.login', actorKind: 'USER', actorId: TENANT_1.hostUserId, summary: { method: 'credentials' } },
      { action: 'engineer.view', actorKind: 'USER', actorId: PARTNER_1_1.userId, summary: { via: 'DETAIL' } },
    ]);
    const reader = await ctxOf(HOST_OWNER, 'ADMIN');
    const items = await markerItems(reader);
    expect(items).toHaveLength(2);
    for (const item of items) {
      expect(item).not.toHaveProperty('summary');
      expect(item).toHaveProperty('detail');
      expect(item).toHaveProperty('detailSuppressedReason');
    }
    // auth.* は 0 キー（「詳細はありません」）。`method` は落ちる。
    const login = only(items.filter((item) => item.action === 'auth.login'));
    expect(login.detail).toEqual({ entries: [] });
    expect(login.detailSuppressedReason).toBeNull();
    expect(JSON.stringify(items)).not.toContain('credentials');
  });
});
