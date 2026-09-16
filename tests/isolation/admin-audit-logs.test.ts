// tests/isolation/admin-audit-logs.test.ts
// `A-006` 監査ログ横断検索 = API-A7 `GET /api/admin/audit-logs`（docs/05 §5.5 / §5.7 / §6.9 / `F-058`）。T-11-03。
//
// 🔴 ここで実証するのは `F-058 AC-1`〜`AC-4` である（`platform-plane.test.ts` / `platform-tenants.test.ts` の作法）:
//   AC-1 氏名・メールアドレス・電話番号を含む `summary` を管理接続で仕込み、応答がマスク済み（スナップショット）
//   AC-2 応答に `targetId` は載るが、そこから内容を引く API が管理平面に無い（静的: `tests/static/admin-no-content-reach.test.ts`。
//        ここでは応答の JSON に既知の氏名・本文・単価が 1 バイトも現れないことを実測する）
//   AC-3 `body` / `subject` / `note` 等の内容キーが**キーごと**落ちる
//   AC-4 検索の実行が `AuditLog(admin.audit_log.search)` に記録される（条件のみ。結果の内容を載せない）
//   + `from` / `to` 欠落は 400、上限（31 日）超過は 400 + `AUDIT_LOG_PERIOD_TOO_LONG`（Route Handler を実物で呼ぶ）
//   + `targetTenantId` 指定は RLS でそのテナントに閉じ、`tenantId`（分離キー名）は無視される
//   + `PLATFORM_SUPPORT` でも閲覧でき、書き込みは監査記録以外に 1 行も無い
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { configurePlatformReadDb, configurePlatformWriteDb, resolvePlatformCtx } from '@ses/db';
import type { AuthenticatedPlatformCtx } from '@ses/db';
import { searchPlatformAuditLogs } from '@ses/db/platform';
import { createUnextendedClient, type UnextendedClient } from '@ses/db/testing';
import { TENANT_A, TENANT_B, USER_A_HOST, USER_B_HOST } from './support/fixtures.js';
import { startIsolationDatabase, type IsolationDatabase } from './support/postgres.js';

const SETUP_TIMEOUT_MS = 600_000;

const OWNER_USER_ID = '01930000-0000-7000-8000-0000000000ca';
const SUPPORT_USER_ID = '01930000-0000-7000-8000-0000000000cb';

/** 仕込む行（`created_at` を固定し、検索の自分自身の監査行〔now()〕が窓に入らないようにする）。 */
const SEEDED_AT = new Date('2026-09-10T10:00:00.000Z');
const WINDOW_FROM = '2026-09-10T00:00:00.000Z';
const WINDOW_TO = '2026-09-10T23:59:59.999Z';

const ROW_A_ENGINEER_VIEW = '01930000-0000-7000-8000-00000000ad01';
const ROW_A_PROPOSAL_SUBMIT = '01930000-0000-7000-8000-00000000ad02';
const ROW_A_MESSAGE = '01930000-0000-7000-8000-00000000ad03';
const ROW_B_SKILL_SHEET = '01930000-0000-7000-8000-00000000ad04';
const ENGINEER_TARGET = '01930000-0000-7000-8000-0000000000e1';

/** 🔴 既知の PII・本文（応答に 1 バイトも現れてはならない）。 */
const FORBIDDEN_STRINGS = [
  '山田 太郎',
  '山田太郎',
  'taro.yamada@example.co.jp',
  '090-1234-5678',
  '1990-01-02',
  'ご提案（Java エンジニア）',
  '単価 80 万円',
  '株式会社パートナー',
  'partner1 からの本文',
  '800000',
  'skill-sheet-v3.xlsx',
  'yamada-taro-v3.xlsx',
  '600000',
] as const;

const META = { deviceKind: 'api', ipAddress: '203.0.113.10' } as const;

/** 🔴 差し替えるのは「セッション → ctx」の 1 点だけ（`api-boundary.test.ts` と同じ手口）。 */
const requirePlatformCtxMock = vi.fn<() => Promise<AuthenticatedPlatformCtx>>();
vi.mock('../../apps/web/lib/auth/platform-session', () => ({
  requirePlatformCtx: () => requirePlatformCtxMock(),
  readPlatformRequestMeta: async () => META,
}));
// 🔴 主平面のセッション（`withApiRoute` が `searchParamsToObject` と同じモジュールから import する）は
//    本ルートでは呼ばれないが、`next-auth` の読み込みを避けるために差し替える（`api-boundary.test.ts` と同じ）。
//    ここで `requireTenantCtx` が呼ばれたら失敗させる（管理平面のルートが主平面の ctx に触れないことの対照）。
vi.mock('../../apps/web/lib/auth/session', () => ({
  requireTenantCtx: async () => {
    throw new Error('管理平面のルートが主平面の requireTenantCtx を呼んだ');
  },
  readRequestMeta: async () => META,
}));
const auditLogsRoute = await import('../../apps/web/app/api/admin/audit-logs/route');

let database: IsolationDatabase;
/** 🔴 仕込みと事後確認だけに使う特権接続。検証のクエリには使わない。 */
let superuser: UnextendedClient;
let ownerCtx: AuthenticatedPlatformCtx;
let supportCtx: AuthenticatedPlatformCtx;

type ErrorBody = {
  readonly error: { readonly code: string; readonly messageKey: string; readonly params?: Record<string, unknown> };
};

async function insertAuditRow(input: {
  readonly id: string;
  readonly tenantId: string;
  readonly actorId: string;
  readonly action: string;
  readonly targetType: string;
  readonly targetId: string | null;
  readonly summary: Record<string, unknown>;
}): Promise<void> {
  await superuser.$executeRaw`
    INSERT INTO audit_logs (id, tenant_id, actor_kind, actor_id, action, target_type, target_id, summary, ip_address, device_kind, created_at)
    VALUES (${input.id}::uuid, ${input.tenantId}::uuid, 'USER', ${input.actorId}::uuid, ${input.action}, ${input.targetType},
            ${input.targetId}::uuid, ${JSON.stringify(input.summary)}::jsonb, '198.51.100.7', 'mobile', ${SEEDED_AT})`;
}

async function searchAuditRows(): Promise<
  Array<{ tenant_id: string | null; actor_id: string | null; summary: Record<string, unknown> }>
> {
  return superuser.$queryRaw`
    SELECT tenant_id, actor_id, summary FROM audit_logs WHERE action = 'admin.audit_log.search' ORDER BY created_at, id`;
}

function get(query: Record<string, string>): Promise<Response> {
  const url = new URL('http://localhost/api/admin/audit-logs');
  for (const [key, value] of Object.entries(query)) url.searchParams.set(key, value);
  return auditLogsRoute.GET(new Request(url));
}

beforeAll(async () => {
  database = await startIsolationDatabase();
  superuser = createUnextendedClient(database.superuserUrl);
  configurePlatformReadDb({ datasourceUrl: database.platformUrl });
  configurePlatformWriteDb({ datasourceUrl: database.platformWriteUrl });
  ownerCtx = await resolvePlatformCtx(
    { platformUserId: OWNER_USER_ID, platformRole: 'PLATFORM_OWNER', twoFactor: 'VERIFIED' },
    { deviceKind: 'desktop' },
  );
  supportCtx = await resolvePlatformCtx(
    { platformUserId: SUPPORT_USER_ID, platformRole: 'PLATFORM_SUPPORT', twoFactor: 'VERIFIED' },
    { deviceKind: 'desktop' },
  );
  requirePlatformCtxMock.mockImplementation(async () => ownerCtx);

  // 🔴 「過去の行に何が入っているかを前提にしない」を実測するため、§16.2 に**反する** summary を意図的に仕込む。
  await insertAuditRow({
    id: ROW_A_ENGINEER_VIEW,
    tenantId: TENANT_A,
    actorId: USER_A_HOST,
    action: 'engineer.view',
    targetType: 'Engineer',
    targetId: ENGINEER_TARGET,
    summary: {
      via: 'S-006',
      displayName: '山田 太郎',
      contactEmail: 'taro.yamada@example.co.jp',
      contactPhone: '090-1234-5678',
      birthDate: '1990-01-02',
      fileName: 'skill-sheet-v3.xlsx',
    },
  });
  await insertAuditRow({
    id: ROW_A_PROPOSAL_SUBMIT,
    tenantId: TENANT_A,
    actorId: USER_A_HOST,
    action: 'proposal.submit',
    targetType: 'Proposal',
    targetId: '01930000-0000-7000-8000-000000000111',
    summary: {
      operation: 'SEND',
      fromState: 'APPROVED',
      toState: 'SUBMITTED',
      subject: 'ご提案（Java エンジニア）',
      body: '山田太郎をご提案します。単価 80 万円。',
      recipientEmail: 'sales@partner.example.jp',
      recipientCompanyName: '株式会社パートナー',
      offeredUnitPrice: 800000,
      note: '担当: taro.yamada@example.co.jp',
    },
  });
  await insertAuditRow({
    id: ROW_A_MESSAGE,
    tenantId: TENANT_A,
    actorId: USER_A_HOST,
    action: 'message.create',
    targetType: 'Message',
    targetId: '01930000-0000-7000-8000-000000000123',
    summary: { threadId: '01930000-0000-7000-8000-000000000121', text: 'partner1 からの本文', attachmentCount: 1 },
  });
  await insertAuditRow({
    id: ROW_B_SKILL_SHEET,
    tenantId: TENANT_B,
    actorId: USER_B_HOST,
    action: 'skill_sheet.download',
    targetType: 'SkillSheet',
    targetId: '01930000-0000-7000-8000-000000000e30',
    summary: {
      engineerId: '01930000-0000-7000-8000-0000000000e3',
      version: 3,
      fileName: 'skill-sheet-v3.xlsx',
      // 🔴 T-11-03 レビュー指摘: docs/05 §5.5 の非開示列と同名のキー。パスの末尾に人名が入りうる
      objectKey: 'tenants/b1/skill-sheets/yamada-taro-v3.xlsx',
      unitPriceMin: 600000,
    },
  });
}, SETUP_TIMEOUT_MS);

afterAll(async () => {
  await superuser?.$disconnect();
  await database?.stop();
}, SETUP_TIMEOUT_MS);

describe('F-058 AC-1 / AC-3: 応答はマスク済みで、内容キーはキーごと落ちる', () => {
  it('🔴 氏名・メール・電話・生年月日を含む行がマスク済みで返る（スナップショット）', async () => {
    const page = await searchPlatformAuditLogs(ownerCtx, {
      from: new Date(WINDOW_FROM),
      to: new Date(WINDOW_TO),
      limit: 100,
    });
    const row = page.items.find((item) => item.id === ROW_A_ENGINEER_VIEW);
    expect(row).toMatchInlineSnapshot(`
      {
        "action": "engineer.view",
        "actorId": "01930000-0000-7000-8000-0000000000d1",
        "actorKind": "USER",
        "createdAt": "2026-09-10T10:00:00.000Z",
        "deviceKind": "mobile",
        "id": "01930000-0000-7000-8000-00000000ad01",
        "impersonationSessionId": null,
        "ipAddress": "198.51.100.7",
        "summary": {
          "birthDate": "[masked]",
          "contactEmail": "[masked]",
          "contactPhone": "[masked]",
          "displayName": "[masked]",
          "fileName": "[masked]",
          "via": "S-006",
        },
        "targetId": "01930000-0000-7000-8000-0000000000e1",
        "targetType": "Engineer",
        "tenantId": "01930000-0000-7000-8000-0000000000a1",
        "tenantName": "Tenant A",
      }
    `);
  });

  it('🔴 AC-3: 提案本文・件名・メモ・チャット本文はキーごと落ち、宛先・単価は伏せられる', async () => {
    const page = await searchPlatformAuditLogs(ownerCtx, {
      from: new Date(WINDOW_FROM),
      to: new Date(WINDOW_TO),
      limit: 100,
    });
    const proposal = page.items.find((item) => item.id === ROW_A_PROPOSAL_SUBMIT);
    expect(proposal?.summary).toEqual({
      fromState: 'APPROVED',
      offeredUnitPrice: '[masked]',
      operation: 'SEND',
      recipientCompanyName: '[masked]',
      recipientEmail: '[masked]',
      toState: 'SUBMITTED',
    });
    for (const key of ['subject', 'body', 'note']) expect(proposal?.summary).not.toHaveProperty(key);

    const message = page.items.find((item) => item.id === ROW_A_MESSAGE);
    expect(message?.summary).toEqual({ attachmentCount: 1, threadId: '01930000-0000-7000-8000-000000000121' });
    expect(message?.summary).not.toHaveProperty('text');
  });

  it('🔴 AC-1 / AC-2: 既知の氏名・メール・電話・本文・単価が応答の JSON に 1 バイトも現れない', async () => {
    const page = await searchPlatformAuditLogs(ownerCtx, {
      from: new Date(WINDOW_FROM),
      to: new Date(WINDOW_TO),
      limit: 100,
    });
    expect(page.items.length).toBeGreaterThanOrEqual(4); // 対照（空振り防止）
    const serialized = JSON.stringify(page);
    for (const forbidden of FORBIDDEN_STRINGS) expect(serialized).not.toContain(forbidden);
    // `summary` の生 JSON の痕跡（`actorDisplayName` のような氏名解決フィールド）も無い。
    expect(serialized).not.toContain('actorDisplayName');
  });

  it('応答のフィールドは固定列挙のみ（境界外フィールドが無い）', async () => {
    const page = await searchPlatformAuditLogs(ownerCtx, {
      from: new Date(WINDOW_FROM),
      to: new Date(WINDOW_TO),
      limit: 100,
    });
    for (const item of page.items) {
      expect(Object.keys(item).sort()).toEqual(
        [
          'action',
          'actorId',
          'actorKind',
          'createdAt',
          'deviceKind',
          'id',
          'impersonationSessionId',
          'ipAddress',
          'summary',
          'targetId',
          'targetType',
          'tenantId',
          'tenantName',
        ].sort(),
      );
    }
  });
});

describe('F-058 AC-4: 検索の実行が AuditLog に記録される（条件のみ）', () => {
  it('🔴 横断検索は tenant_id = NULL で、誰が・どの条件で、が summary に載る。結果の内容は載らない', async () => {
    const before = (await searchAuditRows()).length;
    await searchPlatformAuditLogs(
      ownerCtx,
      {
        from: new Date(WINDOW_FROM),
        to: new Date(WINDOW_TO),
        action: 'engineer.view',
        actorType: 'USER',
        deviceKind: 'mobile',
        limit: 50,
      },
      { ipAddress: '203.0.113.10' },
    );
    const rows = await searchAuditRows();
    expect(rows).toHaveLength(before + 1);
    const last = rows[rows.length - 1];
    expect(last?.tenant_id).toBeNull();
    expect(last?.actor_id).toBe(OWNER_USER_ID);
    expect(last?.summary).toEqual({
      periodFrom: WINDOW_FROM,
      periodTo: WINDOW_TO,
      filterTenantId: null,
      filterAction: 'engineer.view',
      filterActorType: 'USER',
      filterDeviceKind: 'mobile',
      limit: 50,
      page: 'FIRST',
      platformRole: 'PLATFORM_OWNER',
    });
    // 🔴 結果の件数・内容（氏名など）を記録に載せない（監査が fn の結果に依存しない。docs/05 §5.3）。
    const serialized = JSON.stringify(last?.summary);
    for (const forbidden of FORBIDDEN_STRINGS) expect(serialized).not.toContain(forbidden);
    expect(serialized).not.toContain('count');
  });

  it('テナントを指定した検索は tenant_id = そのテナントで記録される（S-041 から透明。BR-41）', async () => {
    await searchPlatformAuditLogs(ownerCtx, {
      from: new Date(WINDOW_FROM),
      to: new Date(WINDOW_TO),
      tenantId: TENANT_A,
      limit: 100,
    });
    const rows = await searchAuditRows();
    const last = rows[rows.length - 1];
    expect(last?.tenant_id).toBe(TENANT_A);
    expect(last?.summary['filterTenantId']).toBe(TENANT_A);
  });
});

describe('テナントの指定と分離', () => {
  it('横断（指定なし）は両テナントの行を返す', async () => {
    const page = await searchPlatformAuditLogs(ownerCtx, {
      from: new Date(WINDOW_FROM),
      to: new Date(WINDOW_TO),
      limit: 100,
    });
    expect(page.items.map((item) => item.id)).toEqual(
      expect.arrayContaining([ROW_A_ENGINEER_VIEW, ROW_B_SKILL_SHEET]),
    );
    expect(page.items.find((item) => item.id === ROW_B_SKILL_SHEET)?.tenantName).toBe('Tenant B');
  });

  it('🔴 テナントを指定すると、そのテナントの行だけが返る（RLS + where の二重）', async () => {
    const page = await searchPlatformAuditLogs(ownerCtx, {
      from: new Date(WINDOW_FROM),
      to: new Date(WINDOW_TO),
      tenantId: TENANT_A,
      limit: 100,
    });
    expect(page.items.length).toBeGreaterThan(0);
    expect(page.items.every((item) => item.tenantId === TENANT_A)).toBe(true);
    expect(page.items.some((item) => item.id === ROW_B_SKILL_SHEET)).toBe(false);
  });

  it('実在しないテナントを指定すると 0 件（500 にならない。docs/05 §5.2 の T-03-09 補正）', async () => {
    const page = await searchPlatformAuditLogs(ownerCtx, {
      from: new Date(WINDOW_FROM),
      to: new Date(WINDOW_TO),
      tenantId: '01930000-0000-7000-8000-000000000fff',
      limit: 100,
    });
    expect(page.items).toEqual([]);
    expect(page.nextCursor).toBeNull();
  });

  it('カーソルページング（limit=1 で 2 ページ目に別の行が現れ、総件数は返らない）', async () => {
    const first = await searchPlatformAuditLogs(ownerCtx, {
      from: new Date(WINDOW_FROM),
      to: new Date(WINDOW_TO),
      limit: 1,
    });
    expect(first.items).toHaveLength(1);
    expect(first.nextCursor).not.toBeNull();
    expect('total' in first).toBe(false);
    const second = await searchPlatformAuditLogs(ownerCtx, {
      from: new Date(WINDOW_FROM),
      to: new Date(WINDOW_TO),
      limit: 1,
      cursor: first.nextCursor as string,
    });
    expect(second.items).toHaveLength(1);
    expect(second.items[0]?.id).not.toBe(first.items[0]?.id);
  });
});

describe('PLATFORM_SUPPORT でも閲覧でき、書き込みは監査記録以外に無い', () => {
  it('🔴 PLATFORM_SUPPORT の ctx で同じ結果が返り、記録の platformRole が PLATFORM_SUPPORT になる', async () => {
    const tableCountsBefore = await superuser.$queryRaw<Array<{ n: bigint }>>`
      SELECT (SELECT count(*) FROM engineers) + (SELECT count(*) FROM proposals) + (SELECT count(*) FROM messages)
           + (SELECT count(*) FROM tenants) + (SELECT count(*) FROM users) AS n`;
    const page = await searchPlatformAuditLogs(supportCtx, {
      from: new Date(WINDOW_FROM),
      to: new Date(WINDOW_TO),
      limit: 100,
    });
    expect(page.items.some((item) => item.id === ROW_A_ENGINEER_VIEW)).toBe(true);
    const rows = await searchAuditRows();
    expect(rows[rows.length - 1]?.actor_id).toBe(SUPPORT_USER_ID);
    expect(rows[rows.length - 1]?.summary['platformRole']).toBe('PLATFORM_SUPPORT');
    const tableCountsAfter = await superuser.$queryRaw<Array<{ n: bigint }>>`
      SELECT (SELECT count(*) FROM engineers) + (SELECT count(*) FROM proposals) + (SELECT count(*) FROM messages)
           + (SELECT count(*) FROM tenants) + (SELECT count(*) FROM users) AS n`;
    expect(tableCountsAfter[0]?.n).toBe(tableCountsBefore[0]?.n);
  });
});

describe('Route Handler（API-A7）: 期間必須・上限・分離キー名', () => {
  it('🔴 to が欠けると 400（期間なしの全件検索の経路が無い）', async () => {
    const response = await get({ from: WINDOW_FROM });
    expect(response.status).toBe(400);
    const body = (await response.json()) as ErrorBody;
    expect(body.error.code).toBe('VALIDATION');
  });

  it('🔴 from が欠けると 400', async () => {
    const response = await get({ to: WINDOW_TO });
    expect(response.status).toBe(400);
  });

  it('🔴 両方欠けると 400（記録も残らない = 監査行は増えない）', async () => {
    const before = (await searchAuditRows()).length;
    const response = await get({});
    expect(response.status).toBe(400);
    expect((await searchAuditRows()).length).toBe(before);
  });

  it('🔴 31 日を超える期間は 400 + AUDIT_LOG_PERIOD_TOO_LONG（期間短縮の理由キー。DB に触れない）', async () => {
    const before = (await searchAuditRows()).length;
    const response = await get({ from: '2026-08-01T00:00:00.000Z', to: '2026-09-01T00:00:00.001Z' });
    expect(response.status).toBe(400);
    const body = (await response.json()) as ErrorBody;
    expect(body.error.code).toBe('AUDIT_LOG_PERIOD_TOO_LONG');
    expect(body.error.messageKey).toBe('error.admin.auditLogs.periodTooLong');
    expect(body.error.params).toEqual({ maxDays: 31 });
    expect((await searchAuditRows()).length).toBe(before);
  });

  it('31 日ちょうどは通る', async () => {
    const response = await get({ from: '2026-08-10T00:00:00.000Z', to: '2026-09-10T00:00:00.000Z' });
    expect(response.status).toBe(200);
  });

  it('from > to は 400（VALIDATION）', async () => {
    const response = await get({ from: WINDOW_TO, to: WINDOW_FROM });
    expect(response.status).toBe(400);
    expect(((await response.json()) as ErrorBody).error.code).toBe('VALIDATION');
  });

  it('🔴 200 の応答はマスク済みで、既知の PII・本文が 1 バイトも現れない（HTTP 境界での実測）', async () => {
    const response = await get({ from: WINDOW_FROM, to: WINDOW_TO });
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    const text = await response.text();
    for (const forbidden of FORBIDDEN_STRINGS) expect(text).not.toContain(forbidden);
    const page = JSON.parse(text) as { items: Array<{ id: string; summary: Record<string, unknown> }> };
    const row = page.items.find((item) => item.id === ROW_A_PROPOSAL_SUBMIT);
    expect(row?.summary).toEqual({
      fromState: 'APPROVED',
      offeredUnitPrice: '[masked]',
      operation: 'SEND',
      recipientCompanyName: '[masked]',
      recipientEmail: '[masked]',
      toState: 'SUBMITTED',
    });
  });

  it('targetTenantId で絞れる。🔴 `tenantId`（分離キー名）は無視され、絞り込みにならない', async () => {
    const scoped = await get({ from: WINDOW_FROM, to: WINDOW_TO, targetTenantId: TENANT_A });
    const scopedPage = (await scoped.json()) as { items: Array<{ tenantId: string | null }> };
    expect(scopedPage.items.every((item) => item.tenantId === TENANT_A)).toBe(true);

    const ignored = await get({ from: WINDOW_FROM, to: WINDOW_TO, tenantId: TENANT_A });
    const ignoredPage = (await ignored.json()) as { items: Array<{ tenantId: string | null }> };
    expect(ignoredPage.items.some((item) => item.tenantId === TENANT_B)).toBe(true);
  });

  it('不正な targetTenantId / cursor は 400（Prisma の uuid キャストで 500 にしない）', async () => {
    expect((await get({ from: WINDOW_FROM, to: WINDOW_TO, targetTenantId: 'x' })).status).toBe(400);
    expect((await get({ from: WINDOW_FROM, to: WINDOW_TO, cursor: "1' OR '1'='1" })).status).toBe(400);
  });
});
