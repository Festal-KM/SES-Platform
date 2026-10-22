// tests/isolation/chat-saved-templates.test.ts
// ✅ 2026-10-22（チャットレーン・紺野）: 「保存済み」（`chat_saved_messages`）と「自分の定型文」（`chat_message_templates`）の分離。
// `docs/05` §3.7.1 / §6.5 #51l / #51m。migration 20261022010000 / 20261022020000。
//
// 🔴 ここで固定すること:
//   保存済み
//   ① 本人の栞しか読めない・外せない（同じ会社の人・ホストから取引先の人の栞は 0 件）
//   ② 🔴 取引先 A1 から、取引先 A2 の発言は保存できない（API は 404・RLS の INSERT も拒否）
//   ③ 他テナントからは 0 件・保存もできない
//   ④ 🔴 部屋から外れたら（参加会社の行に left_at が立ったら）保存済みが見えない（本文に届く経路を残さない）。戻ればまた見える
//   ⑤ 会話の発言に「自分が保存したか」が載る（他人の栞は載らない）。保存は冪等。閲覧専用は 403
//   自分の定型文
//   ⑥ 本人の定型文しか読めない・直せない・消せない（他人の ID は 404。RLS も 0 件）
//   ⑦ 他テナント・別の取引先から 0 件
//   ⑧ 入力の検査（見出し 31 文字・改行・本文 1001 文字・分離キーは 400）/ 50 件を超えると 409 / 閲覧専用は 403
//   ⑨ 作成・更新・削除のたびに監査ログが 1 行（見出し・本文を含まない。文字数だけ）
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  configureTenantDb,
  disconnectTenantDb,
  resolveTenantCtx,
  withTenant,
  type AuthenticatedTenantCtx,
} from '@ses/db';
import { createUnextendedClient, type UnextendedClient } from '@ses/db/testing';
import {
  MESSAGE_A_P1,
  MESSAGE_A_P2,
  PARTNER_A1,
  PARTNER_A2,
  TENANT_A,
  TENANT_B,
  THREAD_A_P1,
  THREAD_A_P2,
  USER_A_HOST,
  USER_A_PARTNER,
  USER_A_PARTNER2,
  USER_B_HOST,
} from './support/fixtures.js';
import { startIsolationDatabase, type IsolationDatabase } from './support/postgres.js';

const SETUP_TIMEOUT_MS = 600_000;
const META = { deviceKind: 'desktop', ipAddress: '203.0.113.81' } as const;
const DEVICE = { deviceKind: META.deviceKind } as const;
/** fixtures の参加会社の行（`THREAD_A_P1` × 取引先 A1）。④ で left_at を立てて戻す。 */
const PARTICIPANT_A_P1_PARTNER = '01930000-0000-7000-8000-000000000126';
const ABSENT_ID = '01930000-0000-7000-8000-0000000009ff';

const requireTenantCtxMock = vi.fn<() => Promise<AuthenticatedTenantCtx>>();
vi.mock('../../apps/web/lib/auth/session', () => ({
  requireTenantCtx: () => requireTenantCtxMock(),
  readRequestMeta: async () => META,
}));

const saveRoute = await import('../../apps/web/app/api/(main)/threads/[id]/messages/[messageId]/save/route');
const messagesRoute = await import('../../apps/web/app/api/(main)/threads/[id]/messages/route');
const templatesRoute = await import('../../apps/web/app/api/(main)/chat/templates/route');
const templateRoute = await import('../../apps/web/app/api/(main)/chat/templates/[templateId]/route');
const { readSavedList } = await import('../../apps/web/lib/chat/saved');
const {
  readChatTemplates,
  CHAT_TEMPLATE_AUDIT_ACTION_CREATE,
  CHAT_TEMPLATE_AUDIT_ACTION_UPDATE,
  CHAT_TEMPLATE_AUDIT_ACTION_DELETE,
} = await import('../../apps/web/lib/chat/templates');

let database: IsolationDatabase;
let admin: UnextendedClient;
let host: AuthenticatedTenantCtx;
let hostViewer: AuthenticatedTenantCtx;
let partnerA1: AuthenticatedTenantCtx;
let partnerA2: AuthenticatedTenantCtx;
let tenantB: AuthenticatedTenantCtx;

function json(method: string, url: string, body?: unknown): Request {
  return new Request(url, {
    method,
    ...(body === undefined ? {} : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }),
  });
}

async function save(ctx: AuthenticatedTenantCtx, threadId: string, messageId: string, method: 'PUT' | 'DELETE' = 'PUT'): Promise<Response> {
  requireTenantCtxMock.mockResolvedValue(ctx);
  const request = json(method, `https://app.test/api/threads/${threadId}/messages/${messageId}/save`);
  const segment = { params: Promise.resolve({ id: threadId, messageId }) };
  return method === 'PUT' ? saveRoute.PUT(request, segment) : saveRoute.DELETE(request, segment);
}

async function savedMessageIds(ctx: AuthenticatedTenantCtx): Promise<string[]> {
  return withTenant(ctx, async (db) => (await readSavedList(db)).items.map((item) => item.messageId));
}

async function rawSavedCount(ctx: AuthenticatedTenantCtx): Promise<number> {
  return withTenant(ctx, async (db) => db.chatSavedMessage.count());
}

async function listMessages(ctx: AuthenticatedTenantCtx, threadId: string): Promise<readonly Record<string, unknown>[]> {
  requireTenantCtxMock.mockResolvedValue(ctx);
  const response = await messagesRoute.GET(new Request(`https://app.test/api/threads/${threadId}/messages`), {
    params: Promise.resolve({ id: threadId }),
  });
  expect(response.status, await response.clone().text()).toBe(200);
  return ((await response.json()) as { items: readonly Record<string, unknown>[] }).items;
}

async function createTemplate(ctx: AuthenticatedTenantCtx, body: unknown): Promise<Response> {
  requireTenantCtxMock.mockResolvedValue(ctx);
  return templatesRoute.POST(json('POST', 'https://app.test/api/chat/templates', body));
}

async function patchTemplate(ctx: AuthenticatedTenantCtx, templateId: string, body: unknown): Promise<Response> {
  requireTenantCtxMock.mockResolvedValue(ctx);
  return templateRoute.PATCH(json('PATCH', `https://app.test/api/chat/templates/${templateId}`, body), {
    params: Promise.resolve({ templateId }),
  });
}

async function deleteTemplate(ctx: AuthenticatedTenantCtx, templateId: string): Promise<Response> {
  requireTenantCtxMock.mockResolvedValue(ctx);
  return templateRoute.DELETE(json('DELETE', `https://app.test/api/chat/templates/${templateId}`), {
    params: Promise.resolve({ templateId }),
  });
}

async function visibleTemplateLabels(ctx: AuthenticatedTenantCtx): Promise<string[]> {
  return withTenant(ctx, async (db) => (await readChatTemplates(db)).map((template) => template.label));
}

beforeAll(async () => {
  database = await startIsolationDatabase();
  admin = createUnextendedClient(database.superuserUrl);
  configureTenantDb({ datasourceUrl: database.tenantUrl });

  const base = { lifecycleState: 'ACTIVE' as const, partnerSuspendedAt: null, twoFactor: 'NOT_ENROLLED' as const };
  host = await resolveTenantCtx({ ...base, tenantId: TENANT_A, partnerCompanyId: null, userId: USER_A_HOST, role: 'SALES' }, DEVICE);
  hostViewer = await resolveTenantCtx({ ...base, tenantId: TENANT_A, partnerCompanyId: null, userId: USER_A_HOST, role: 'VIEWER' }, DEVICE);
  partnerA1 = await resolveTenantCtx(
    { ...base, tenantId: TENANT_A, partnerCompanyId: PARTNER_A1, userId: USER_A_PARTNER, role: 'PARTNER_SALES' },
    DEVICE,
  );
  partnerA2 = await resolveTenantCtx(
    { ...base, tenantId: TENANT_A, partnerCompanyId: PARTNER_A2, userId: USER_A_PARTNER2, role: 'PARTNER_SALES' },
    DEVICE,
  );
  tenantB = await resolveTenantCtx({ ...base, tenantId: TENANT_B, partnerCompanyId: null, userId: USER_B_HOST, role: 'SALES' }, DEVICE);
}, SETUP_TIMEOUT_MS);

afterAll(async () => {
  await admin?.auditLog.deleteMany({
    where: { action: { in: [CHAT_TEMPLATE_AUDIT_ACTION_CREATE, CHAT_TEMPLATE_AUDIT_ACTION_UPDATE, CHAT_TEMPLATE_AUDIT_ACTION_DELETE] } },
  });
  await admin?.chatSavedMessage.deleteMany({});
  await admin?.chatMessageTemplate.deleteMany({});
  await disconnectTenantDb();
  await admin?.$disconnect();
  await database?.stop();
}, SETUP_TIMEOUT_MS);

describe('保存済み', () => {
  beforeAll(async () => {
    expect((await save(host, THREAD_A_P1, MESSAGE_A_P1)).status).toBe(200);
    expect((await save(partnerA1, THREAD_A_P1, MESSAGE_A_P1)).status).toBe(200);
    expect((await save(partnerA2, THREAD_A_P2, MESSAGE_A_P2)).status).toBe(200);
  });

  it('⑤ 保存は冪等（2 回押しても 1 行）で、応答は { saved: true }', async () => {
    const response = await save(host, THREAD_A_P1, MESSAGE_A_P1);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ saved: true });
    expect(await admin.chatSavedMessage.count({ where: { userId: USER_A_HOST, messageId: MESSAGE_A_P1 } })).toBe(1);
  });

  it('🔴 ① 本人の栞しか読めない（ホストから取引先の人の栞・取引先から別の人の栞は 0 件）', async () => {
    expect(await savedMessageIds(host)).toEqual([MESSAGE_A_P1]);
    expect(await rawSavedCount(host)).toBe(1);
    expect(await savedMessageIds(partnerA1)).toEqual([MESSAGE_A_P1]);
    expect(await rawSavedCount(partnerA1)).toBe(1);
    expect(await savedMessageIds(partnerA2)).toEqual([MESSAGE_A_P2]);
    expect(await rawSavedCount(partnerA2)).toBe(1);
  });

  it('🔴 ① 他人の栞は外せない（DELETE は 0 件）', async () => {
    const deleted = await withTenant(host, async (db) => db.chatSavedMessage.deleteMany({ where: { userId: USER_A_PARTNER } }));
    expect(deleted.count).toBe(0);
    expect(await admin.chatSavedMessage.count({ where: { userId: USER_A_PARTNER } })).toBe(1);
  });

  it('🔴 ② 取引先 A1 は取引先 A2 の発言を保存できない（API は 404・RLS の INSERT も拒否）', async () => {
    expect((await save(partnerA1, THREAD_A_P2, MESSAGE_A_P2)).status).toBe(404);
    // 自分の部屋の ID に、別の部屋の発言を組み合わせても通らない。
    expect((await save(partnerA1, THREAD_A_P1, MESSAGE_A_P2)).status).toBe(404);
    // 実在しない ID と同じ応答（「見えない」と「無い」を区別させない）。
    expect((await save(partnerA1, THREAD_A_P1, ABSENT_ID)).status).toBe(404);
    await expect(
      withTenant(partnerA1, async (db) =>
        db.chatSavedMessage.create({ data: { tenantId: TENANT_A, userId: USER_A_PARTNER, messageId: MESSAGE_A_P2 } }),
      ),
    ).rejects.toThrow();
    expect(await admin.chatSavedMessage.count({ where: { userId: USER_A_PARTNER, messageId: MESSAGE_A_P2 } })).toBe(0);
  });

  it('🔴 ② 他人の user_id では保存できない（RLS の INSERT が拒否）', async () => {
    await expect(
      withTenant(host, async (db) =>
        db.chatSavedMessage.create({ data: { tenantId: TENANT_A, userId: USER_A_PARTNER2, messageId: MESSAGE_A_P2 } }),
      ),
    ).rejects.toThrow();
  });

  it('🔴 ③ 他テナントからは 0 件で、テナント A の発言は保存できない', async () => {
    expect(await savedMessageIds(tenantB)).toEqual([]);
    expect(await rawSavedCount(tenantB)).toBe(0);
    expect((await save(tenantB, THREAD_A_P1, MESSAGE_A_P1)).status).toBe(404);
  });

  it('🔴 ④ 部屋から外れたら保存済みが見えない（行は残り、戻ればまた見える）', async () => {
    await admin.threadParticipant.update({ where: { id: PARTICIPANT_A_P1_PARTNER }, data: { leftAt: new Date() } });
    try {
      expect(await savedMessageIds(partnerA1)).toEqual([]);
      expect(await rawSavedCount(partnerA1)).toBe(0);
      // 外す操作も「見えない発言」として 404（存在を探れない）。
      expect((await save(partnerA1, THREAD_A_P1, MESSAGE_A_P1, 'DELETE')).status).toBe(404);
      expect(await admin.chatSavedMessage.count({ where: { userId: USER_A_PARTNER } })).toBe(1);
    } finally {
      await admin.threadParticipant.update({ where: { id: PARTICIPANT_A_P1_PARTNER }, data: { leftAt: null } });
    }
    expect(await savedMessageIds(partnerA1)).toEqual([MESSAGE_A_P1]);
  });

  it('⑤ 会話の発言には「自分が保存したか」だけが載る（他人の栞は載らない）', async () => {
    const forHost = await listMessages(host, THREAD_A_P1);
    expect(forHost.find((item) => item['id'] === MESSAGE_A_P1)?.['saved']).toBe(true);
    // 外すとホストの印だけが消え、取引先 A1 の栞は残る。
    const response = await save(host, THREAD_A_P1, MESSAGE_A_P1, 'DELETE');
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ saved: false });
    expect((await listMessages(host, THREAD_A_P1)).find((item) => item['id'] === MESSAGE_A_P1)?.['saved']).toBe(false);
    expect((await listMessages(partnerA1, THREAD_A_P1)).find((item) => item['id'] === MESSAGE_A_P1)?.['saved']).toBe(true);
    // 元に戻す。
    expect((await save(host, THREAD_A_P1, MESSAGE_A_P1)).status).toBe(200);
  });

  it('⑤ 閲覧専用（VIEWER）は 403', async () => {
    expect((await save(hostViewer, THREAD_A_P1, MESSAGE_A_P1)).status).toBe(403);
    expect((await save(hostViewer, THREAD_A_P1, MESSAGE_A_P1, 'DELETE')).status).toBe(403);
  });
});

describe('自分の定型文', () => {
  let hostTemplateId: string;
  let partnerTemplateId: string;

  beforeAll(async () => {
    const hostCreated = await createTemplate(host, { label: 'ホストの定型文', body: 'ホストの本文' });
    expect(hostCreated.status, await hostCreated.clone().text()).toBe(201);
    hostTemplateId = ((await hostCreated.json()) as { template: { id: string } }).template.id;
    const partnerCreated = await createTemplate(partnerA1, { label: '取引先 A1 の定型文', body: '取引先 A1 の本文' });
    expect(partnerCreated.status).toBe(201);
    partnerTemplateId = ((await partnerCreated.json()) as { template: { id: string } }).template.id;
    expect((await createTemplate(tenantB, { label: 'テナント B の定型文', body: 'テナント B の本文' })).status).toBe(201);
  });

  it('🔴 ⑥ / ⑦ 本人の定型文しか読めない（同じテナントのほかの人・別の取引先・他テナントから 0 件）', async () => {
    expect(await visibleTemplateLabels(host)).toEqual(['ホストの定型文']);
    expect(await visibleTemplateLabels(partnerA1)).toEqual(['取引先 A1 の定型文']);
    expect(await visibleTemplateLabels(partnerA2)).toEqual([]);
    expect(await withTenant(partnerA2, async (db) => db.chatMessageTemplate.count())).toBe(0);
    expect(await visibleTemplateLabels(tenantB)).toEqual(['テナント B の定型文']);
  });

  it('🔴 ⑥ 他人の定型文は直せない・消せない（404。行は変わらない）', async () => {
    expect((await patchTemplate(host, partnerTemplateId, { label: '乗っ取り', body: '乗っ取り' })).status).toBe(404);
    expect((await deleteTemplate(host, partnerTemplateId)).status).toBe(404);
    expect((await patchTemplate(tenantB, hostTemplateId, { label: '乗っ取り', body: '乗っ取り' })).status).toBe(404);
    expect((await deleteTemplate(partnerA2, partnerTemplateId)).status).toBe(404);
    const updated = await withTenant(host, async (db) =>
      db.chatMessageTemplate.updateMany({ where: { id: partnerTemplateId }, data: { label: '乗っ取り' } }),
    );
    expect(updated.count).toBe(0);
    const row = await admin.chatMessageTemplate.findUniqueOrThrow({ where: { id: partnerTemplateId } });
    expect([row.label, row.body]).toEqual(['取引先 A1 の定型文', '取引先 A1 の本文']);
  });

  it('🔴 ⑥ 他人の user_id では作れない（RLS の INSERT が拒否）', async () => {
    await expect(
      withTenant(host, async (db) =>
        db.chatMessageTemplate.create({ data: { tenantId: TENANT_A, userId: USER_A_PARTNER, label: '乗っ取り', body: '乗っ取り' } }),
      ),
    ).rejects.toThrow();
  });

  it('⑧ 入力の検査: 見出し 31 文字・改行・本文 1001 文字・空・分離キーは 400', async () => {
    expect((await createTemplate(host, { label: 'あ'.repeat(31), body: '本文' })).status).toBe(400);
    expect((await createTemplate(host, { label: '1 行目\n2 行目', body: '本文' })).status).toBe(400);
    expect((await createTemplate(host, { label: '見出し', body: 'あ'.repeat(1001) })).status).toBe(400);
    expect((await createTemplate(host, { label: '   ', body: '本文' })).status).toBe(400);
    for (const extra of [{ userId: USER_A_PARTNER }, { tenantId: TENANT_B }, { partnerCompanyId: PARTNER_A2 }]) {
      expect((await createTemplate(host, { label: '見出し', body: '本文', ...extra })).status, JSON.stringify(extra)).toBe(400);
    }
    expect(await visibleTemplateLabels(host)).toEqual(['ホストの定型文']);
  });

  it('⑧ 閲覧専用（VIEWER）は 403', async () => {
    expect((await createTemplate(hostViewer, { label: '閲覧専用', body: '閲覧専用' })).status).toBe(403);
    expect((await patchTemplate(hostViewer, hostTemplateId, { label: '閲覧専用', body: '閲覧専用' })).status).toBe(403);
    expect((await deleteTemplate(hostViewer, hostTemplateId)).status).toBe(403);
  });

  it('⑧ 1 人 50 件まで（51 件目は 409）。ほかの人の件数には影響しない', async () => {
    await admin.chatMessageTemplate.createMany({
      data: Array.from({ length: 50 }, (_, index) => ({
        tenantId: TENANT_A,
        userId: USER_A_PARTNER2,
        label: `見出し ${String(index)}`,
        body: `本文 ${String(index)}`,
      })),
    });
    try {
      expect((await createTemplate(partnerA2, { label: '51 件目', body: '51 件目' })).status).toBe(409);
      expect((await createTemplate(partnerA1, { label: '2 件目', body: '2 件目' })).status).toBe(201);
    } finally {
      await admin.chatMessageTemplate.deleteMany({ where: { userId: USER_A_PARTNER2 } });
      await admin.chatMessageTemplate.deleteMany({ where: { userId: USER_A_PARTNER, label: '2 件目' } });
    }
  });

  it('🔴 ⑨ 作成・更新・削除のたびに監査ログが 1 行（見出し・本文を含まない。文字数だけ）', async () => {
    const label = '監査に出てはならない見出し';
    const body = '監査に出てはならない本文';
    const created = await createTemplate(host, { label, body });
    expect(created.status).toBe(201);
    const id = ((await created.json()) as { template: { id: string } }).template.id;
    expect((await patchTemplate(host, id, { label: `${label}2`, body: `${body}2` })).status).toBe(200);
    expect((await deleteTemplate(host, id)).status).toBe(200);
    const rows = await admin.auditLog.findMany({ where: { targetId: id }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] });
    expect(rows.map((row) => row.action)).toEqual([
      CHAT_TEMPLATE_AUDIT_ACTION_CREATE,
      CHAT_TEMPLATE_AUDIT_ACTION_UPDATE,
      CHAT_TEMPLATE_AUDIT_ACTION_DELETE,
    ]);
    for (const row of rows) {
      expect(row.tenantId).toBe(TENANT_A);
      expect(row.actorId).toBe(USER_A_HOST);
      expect(row.targetType).toBe('ChatMessageTemplate');
      expect(JSON.stringify(row)).not.toContain(label);
      expect(JSON.stringify(row)).not.toContain(body);
    }
    expect(rows[0]?.summary).toEqual({ labelLength: label.length, bodyLength: body.length });
    // 失敗した書き込み（400 / 403 / 404）では増えない。
    const before = await admin.auditLog.count({ where: { actorId: USER_A_HOST, action: { startsWith: 'chat_template.' } } });
    expect((await createTemplate(host, { label: '', body: '' })).status).toBe(400);
    expect((await createTemplate(hostViewer, { label: 'x', body: 'x' })).status).toBe(403);
    expect((await deleteTemplate(host, partnerTemplateId)).status).toBe(404);
    expect(await admin.auditLog.count({ where: { actorId: USER_A_HOST, action: { startsWith: 'chat_template.' } } })).toBe(before);
  });
});
