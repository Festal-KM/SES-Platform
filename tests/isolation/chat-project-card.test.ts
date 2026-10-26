// tests/isolation/chat-project-card.test.ts
// ✅ 2026-10-23（チャットレーン・紺野）: 案件をチャットに貼る（`messages.attached_project_id`）の分離。
// `docs/05` §3.7.1 / §6.5 #51 / #51n。migration 20261023010000。`CLAUDE.md` §3.1 経路 1・3。
//
// 🔴 ここで固定すること:
//   ① 取引先 A1 の部屋に、A1 に公開していない案件（未公開 / A2 だけに公開）を貼れない（ホストからも・A1 からも）。
//      応答は同じ 400（`body.projectId`）で、理由を書き分けない。行は 1 件もできない
//   ② 取引先 A2 は、A1 にだけ公開した案件を自分の部屋に貼れない（RLS で読めない = 400）
//   ③ 社内だけの部屋は自社の案件なら何でも貼れる。取引先を含む DM は会社グループと同じ条件
//   ④ 🔴 カードは見る人の RLS で描く: 公開を解除したら取引先には `{ visible: false }` だけ（案件名も ID も出ない）。
//      ホストには見えたまま。応答に単価・エンド企業名が出ない
//   ⑤ 他テナント: 部屋は 404、他テナントの案件は貼れない（400）。DB の複合 FK も別テナントの案件を指す行を拒む
//   ⑥ 貼る案件の候補（#51n）: 部屋の取引先に公開中の案件だけ。キーは id / name / status だけ。閲覧専用は 403
//   ⑦ 監査ログに貼った案件の ID が残る。発言を削除したらカードも消える
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  configureTenantDb,
  disconnectTenantDb,
  resolveTenantCtx,
  type AuthenticatedTenantCtx,
} from '@ses/db';
import { createUnextendedClient, type UnextendedClient } from '@ses/db/testing';
import {
  PARTNER_A1,
  PARTNER_A2,
  PROJECT_A_PRIVATE,
  PROJECT_A_PUBLISHED,
  TENANT_A,
  TENANT_B,
  THREAD_A_P1,
  THREAD_A_P2,
  USER_A_HOST,
  USER_A_PARTNER,
  USER_A_PARTNER2,
  USER_B_HOST,
  VISIBILITY_A_P1,
} from './support/fixtures.js';
import { startIsolationDatabase, type IsolationDatabase } from './support/postgres.js';

const SETUP_TIMEOUT_MS = 600_000;
const META = { deviceKind: 'desktop', ipAddress: '203.0.113.83' } as const;
const DEVICE = { deviceKind: META.deviceKind } as const;

const requireTenantCtxMock = vi.fn<() => Promise<AuthenticatedTenantCtx>>();
vi.mock('../../apps/web/lib/auth/session', () => ({
  requireTenantCtx: () => requireTenantCtxMock(),
  readRequestMeta: async () => META,
}));

const messagesRoute = await import('../../apps/web/app/api/(main)/threads/[id]/messages/route');
const messageRoute = await import('../../apps/web/app/api/(main)/threads/[id]/messages/[messageId]/route');
const projectsRoute = await import('../../apps/web/app/api/(main)/threads/[id]/projects/route');
const dmRoute = await import('../../apps/web/app/api/(main)/threads/dm/route');
const groupsRoute = await import('../../apps/web/app/api/(main)/threads/groups/route');
const { CHAT_ROOM_AUDIT_ACTION_CREATE } = await import('../../apps/web/lib/chat/rooms');
const { CHAT_MESSAGE_AUDIT_ACTION_CREATE, CHAT_MESSAGE_AUDIT_ACTION_DELETE } = await import('../../apps/web/lib/chat/service');
const { CHAT_PROJECT_CANDIDATE_KEYS } = await import('../../apps/web/lib/chat/project-candidates');
const {
  CHAT_FORBIDDEN_RESPONSE_KEYS,
  CHAT_HIDDEN_PROJECT_CARD_KEYS,
  CHAT_MESSAGE_VIEW_KEYS,
  CHAT_VISIBLE_PROJECT_CARD_KEYS,
} = await import('../../apps/web/lib/chat/views');

/** 本テストが足す行（A2 にだけ公開した案件・他テナントの案件・ホストの 2 人目・テナント B の 2 人目）。 */
const PROJECT_A_ONLY_A2 = '01930000-0000-7000-8000-0000000009f1';
const REVIEW_GATE_A_ONLY_A2 = '01930000-0000-7000-8000-0000000009f2';
const VISIBILITY_A_ONLY_A2 = '01930000-0000-7000-8000-0000000009f3';
const PROJECT_B = '01930000-0000-7000-8000-0000000009f4';
const USER_A_HOST2 = '01930000-0000-7000-8000-0000000009e1';
const USER_B_HOST2 = '01930000-0000-7000-8000-0000000009e2';
const ABSENT_PROJECT = '01930000-0000-7000-8000-0000000009ff';

const NAME_A_ONLY_A2 = 'Project A Only A2';
const NAME_B = 'Project B Other Tenant';

let database: IsolationDatabase;
let admin: UnextendedClient;
let host: AuthenticatedTenantCtx;
let hostViewer: AuthenticatedTenantCtx;
let partnerA1: AuthenticatedTenantCtx;
let partnerA2: AuthenticatedTenantCtx;
let tenantB: AuthenticatedTenantCtx;
let internalGroup: string;
let dmWithA1: string;
let groupB: string;

function json(method: string, url: string, body?: unknown): Request {
  return new Request(url, {
    method,
    ...(body === undefined ? {} : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }),
  });
}

async function send(ctx: AuthenticatedTenantCtx, threadId: string, body: unknown): Promise<Response> {
  requireTenantCtxMock.mockResolvedValue(ctx);
  return messagesRoute.POST(json('POST', `https://app.test/api/threads/${threadId}/messages`, body), {
    params: Promise.resolve({ id: threadId }),
  });
}

async function listMessages(ctx: AuthenticatedTenantCtx, threadId: string): Promise<Record<string, unknown>[]> {
  requireTenantCtxMock.mockResolvedValue(ctx);
  const response = await messagesRoute.GET(new Request(`https://app.test/api/threads/${threadId}/messages`), {
    params: Promise.resolve({ id: threadId }),
  });
  expect(response.status, await response.clone().text()).toBe(200);
  return ((await response.json()) as { items: Record<string, unknown>[] }).items;
}

async function candidates(ctx: AuthenticatedTenantCtx, threadId: string, q?: string): Promise<Response> {
  requireTenantCtxMock.mockResolvedValue(ctx);
  const query = q === undefined ? '' : `?q=${encodeURIComponent(q)}`;
  return projectsRoute.GET(new Request(`https://app.test/api/threads/${threadId}/projects${query}`), {
    params: Promise.resolve({ id: threadId }),
  });
}

async function candidateIds(ctx: AuthenticatedTenantCtx, threadId: string, q?: string): Promise<string[]> {
  const response = await candidates(ctx, threadId, q);
  expect(response.status, await response.clone().text()).toBe(200);
  return ((await response.json()) as { items: { id: string }[] }).items.map((item) => item.id).sort();
}

async function createdId(response: Response): Promise<string> {
  expect(response.status, await response.clone().text()).toBe(201);
  return ((await response.json()) as { id: string }).id;
}

async function attachedRowCount(projectId: string): Promise<number> {
  return admin.message.count({ where: { attachedProjectId: projectId } });
}

function collectKeys(value: unknown, into: Set<string>): void {
  if (Array.isArray(value)) {
    for (const entry of value) collectKeys(entry, into);
    return;
  }
  if (typeof value !== 'object' || value === null) return;
  for (const [key, entry] of Object.entries(value)) {
    into.add(key);
    collectKeys(entry, into);
  }
}

beforeAll(async () => {
  database = await startIsolationDatabase();
  admin = createUnextendedClient(database.superuserUrl);
  configureTenantDb({ datasourceUrl: database.tenantUrl });

  // A2 にだけ公開した案件（公開時のゲート結果 → 公開の行）。fixtures の VISIBILITY_A_P1 と同じ形。
  await admin.project.create({
    data: { id: PROJECT_A_ONLY_A2, tenantId: TENANT_A, name: NAME_A_ONLY_A2, endClientName: 'End Client C', status: 'OPEN' },
  });
  await admin.$executeRawUnsafe(`
    INSERT INTO review_gates (
      id, tenant_id, owner_partner_company_id, target_type, target_id, content_hash,
      execution, pii_verdict, commerce_verdict, consistency_verdict, findings, ai_warnings, executed_at, run_trigger
    ) VALUES (
      '${REVIEW_GATE_A_ONLY_A2}', '${TENANT_A}', NULL, 'PROJECT_PUBLISH', '${PROJECT_A_ONLY_A2}', 'seed-content-hash-a2',
      'DONE', 'PASS', 'PASS', 'PASS', '[]'::jsonb, '[]'::jsonb, now(), 'PUBLISH'
    )`);
  await admin.$executeRawUnsafe(`
    INSERT INTO project_visibilities (id, tenant_id, project_id, partner_company_id, published_at, published_by, review_gate_id)
    VALUES ('${VISIBILITY_A_ONLY_A2}', '${TENANT_A}', '${PROJECT_A_ONLY_A2}', '${PARTNER_A2}', now(), '${USER_A_HOST}', '${REVIEW_GATE_A_ONLY_A2}')`);
  await admin.project.create({ data: { id: PROJECT_B, tenantId: TENANT_B, name: NAME_B, status: 'OPEN' } });
  await admin.user.create({
    data: { id: USER_A_HOST2, tenantId: TENANT_A, ownerPartnerCompanyId: null, email: 'host2@project-card.test', displayName: 'ホスト二人目', passwordHash: 'x' },
  });
  await admin.user.create({
    data: { id: USER_B_HOST2, tenantId: TENANT_B, ownerPartnerCompanyId: null, email: 'b2@project-card.test', displayName: 'テナントB二人目', passwordHash: 'x' },
  });

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

  requireTenantCtxMock.mockResolvedValue(host);
  internalGroup = await createdId(
    await groupsRoute.POST(json('POST', 'https://app.test/api/threads/groups', { title: '社内の部屋', userIds: [USER_A_HOST2] })),
  );
  dmWithA1 = await createdId(await dmRoute.POST(json('POST', 'https://app.test/api/threads/dm', { userId: USER_A_PARTNER })));
  requireTenantCtxMock.mockResolvedValue(tenantB);
  groupB = await createdId(
    await groupsRoute.POST(json('POST', 'https://app.test/api/threads/groups', { title: 'テナントBの部屋', userIds: [USER_B_HOST2] })),
  );
}, SETUP_TIMEOUT_MS);

afterAll(async () => {
  await admin?.auditLog.deleteMany({
    where: { action: { in: [CHAT_MESSAGE_AUDIT_ACTION_CREATE, CHAT_MESSAGE_AUDIT_ACTION_DELETE, CHAT_ROOM_AUDIT_ACTION_CREATE] } },
  });
  await admin?.message.deleteMany({ where: { attachedProjectId: { not: null } } });
  await admin?.message.deleteMany({ where: { threadId: { in: [THREAD_A_P1, THREAD_A_P2] }, body: '' } });
  await admin?.chatThread.deleteMany({ where: { kind: { in: ['DM', 'GROUP'] } } });
  await admin?.user.deleteMany({ where: { id: { in: [USER_A_HOST2, USER_B_HOST2] } } });
  await disconnectTenantDb();
  await admin?.$disconnect();
  await database?.stop();
}, SETUP_TIMEOUT_MS);

describe('🔴 ① 取引先 A1 の部屋に、A1 に公開していない案件を貼れない', () => {
  it('ホストが未公開の案件 / A2 だけに公開の案件を貼ると、どちらも同じ 400（理由を書き分けない）で行もできない', async () => {
    const privateResponse = await send(host, THREAD_A_P1, { body: '見てください', projectId: PROJECT_A_PRIVATE });
    const otherPartnerResponse = await send(host, THREAD_A_P1, { body: '見てください', projectId: PROJECT_A_ONLY_A2 });
    const absentResponse = await send(host, THREAD_A_P1, { body: '見てください', projectId: ABSENT_PROJECT });
    for (const response of [privateResponse, otherPartnerResponse, absentResponse]) {
      expect(response.status).toBe(400);
    }
    const bodies = await Promise.all([privateResponse, otherPartnerResponse, absentResponse].map((response) => response.json()));
    expect(bodies[0]).toEqual(bodies[1]);
    expect(bodies[1]).toEqual(bodies[2]);
    expect((bodies[0] as { error: { details: string[] } }).error.details).toEqual(['body.projectId']);
    expect(await attachedRowCount(PROJECT_A_PRIVATE)).toBe(0);
    expect(await attachedRowCount(PROJECT_A_ONLY_A2)).toBe(0);
  });

  it('A1 自身も、読めない案件（A2 だけに公開・未公開）は貼れない。A1 に公開した案件は貼れる', async () => {
    expect((await send(partnerA1, THREAD_A_P1, { projectId: PROJECT_A_ONLY_A2 })).status).toBe(400);
    expect((await send(partnerA1, THREAD_A_P1, { projectId: PROJECT_A_PRIVATE })).status).toBe(400);
    await createdId(await send(partnerA1, THREAD_A_P1, { projectId: PROJECT_A_PUBLISHED }));
  });
});

describe('🔴 ② 取引先 A2 は、A1 にだけ公開した案件を貼れない', () => {
  it('自分の部屋でも 400（RLS で読めない）。A2 に公開した案件は貼れる', async () => {
    expect((await send(partnerA2, THREAD_A_P2, { projectId: PROJECT_A_PUBLISHED })).status).toBe(400);
    expect((await send(host, THREAD_A_P2, { body: 'x', projectId: PROJECT_A_PUBLISHED })).status).toBe(400);
    await createdId(await send(partnerA2, THREAD_A_P2, { projectId: PROJECT_A_ONLY_A2 }));
  });

  it('🔴 A2 は A1 の部屋そのものに届かない（404）', async () => {
    expect((await send(partnerA2, THREAD_A_P1, { projectId: PROJECT_A_ONLY_A2 })).status).toBe(404);
  });
});

describe('③ 社内だけの部屋 / 取引先を含む DM', () => {
  it('社内だけの部屋は自社の案件なら何でも貼れる（未公開・別の取引先に公開した案件も）', async () => {
    await createdId(await send(host, internalGroup, { projectId: PROJECT_A_PRIVATE }));
    await createdId(await send(host, internalGroup, { body: 'こちらも', projectId: PROJECT_A_ONLY_A2 }));
  });

  it('取引先 A1 を含む DM は、A1 に公開した案件だけ', async () => {
    expect((await send(host, dmWithA1, { projectId: PROJECT_A_PRIVATE })).status).toBe(400);
    expect((await send(host, dmWithA1, { projectId: PROJECT_A_ONLY_A2 })).status).toBe(400);
    await createdId(await send(host, dmWithA1, { projectId: PROJECT_A_PUBLISHED }));
  });

  it('本文も案件も無い投稿は 400（従来どおり）', async () => {
    expect((await send(host, internalGroup, { body: '   ' })).status).toBe(400);
  });
});

describe('🔴 ④ カードは見る人の RLS で描く', () => {
  let messageId: string;

  beforeAll(async () => {
    messageId = await createdId(await send(host, THREAD_A_P1, { body: 'この案件です', projectId: PROJECT_A_PUBLISHED }));
  });

  it('ホストにも A1 にもカードが見え、キー集合が凍結どおり。単価・エンド企業名が出ない', async () => {
    for (const ctx of [host, partnerA1]) {
      const items = await listMessages(ctx, THREAD_A_P1);
      const item = items.find((entry) => entry.id === messageId);
      expect(Object.keys(item ?? {}).sort()).toEqual([...CHAT_MESSAGE_VIEW_KEYS].sort());
      const card = item?.attachedProject as Record<string, unknown>;
      expect(card.visible).toBe(true);
      expect(card.name).toBe('Project A Published');
      expect(Object.keys(card).sort()).toEqual([...CHAT_VISIBLE_PROJECT_CARD_KEYS].sort());
      const keys = new Set<string>();
      collectKeys(items, keys);
      for (const forbidden of CHAT_FORBIDDEN_RESPONSE_KEYS) {
        expect(keys.has(forbidden), forbidden).toBe(false);
      }
      const text = JSON.stringify(items);
      expect(text).not.toContain('End Client');
      expect(text).not.toContain('900000');
    }
  });

  it('🔴 A1 への公開を解除したら、A1 には { visible: false } だけ（案件名も ID も出ない）。ホストには見えたまま', async () => {
    await admin.projectVisibility.update({ where: { id: VISIBILITY_A_P1 }, data: { revokedAt: new Date(), revokedReason: 'MANUAL' } });
    try {
      const partnerItems = await listMessages(partnerA1, THREAD_A_P1);
      const partnerCard = partnerItems.find((entry) => entry.id === messageId)?.attachedProject as Record<string, unknown>;
      expect(partnerCard).toEqual({ visible: false });
      expect(Object.keys(partnerCard)).toEqual([...CHAT_HIDDEN_PROJECT_CARD_KEYS]);
      const partnerText = JSON.stringify(partnerItems);
      expect(partnerText).not.toContain(PROJECT_A_PUBLISHED);
      expect(partnerText).not.toContain('Project A Published');

      const hostCard = (await listMessages(host, THREAD_A_P1)).find((entry) => entry.id === messageId)?.attachedProject as Record<string, unknown>;
      expect(hostCard.visible).toBe(true);

      // 解除中は貼ることもできない。
      expect((await send(host, THREAD_A_P1, { projectId: PROJECT_A_PUBLISHED })).status).toBe(400);
    } finally {
      await admin.projectVisibility.update({ where: { id: VISIBILITY_A_P1 }, data: { revokedAt: null, revokedReason: null } });
    }
  });

  it('🔴 投稿の応答（201）も見る人の RLS で描いた形で、キー集合が凍結どおり', async () => {
    const response = await send(partnerA1, THREAD_A_P1, { body: '確認します', projectId: PROJECT_A_PUBLISHED });
    expect(response.status).toBe(201);
    const created = (await response.json()) as { message: Record<string, unknown> };
    expect(Object.keys(created.message).sort()).toEqual([...CHAT_MESSAGE_VIEW_KEYS].sort());
    expect((created.message.attachedProject as Record<string, unknown>).visible).toBe(true);
  });
});

describe('🔴 ⑤ 他テナント', () => {
  it('テナント B から A の部屋は 404。B の社内の部屋に A の案件は貼れない（400）。B の案件は貼れる', async () => {
    expect((await send(tenantB, THREAD_A_P1, { projectId: PROJECT_A_PUBLISHED })).status).toBe(404);
    expect((await send(tenantB, groupB, { projectId: PROJECT_A_PUBLISHED })).status).toBe(400);
    await createdId(await send(tenantB, groupB, { projectId: PROJECT_B }));
  });

  it('🔴 テナント A の部屋に B の案件は貼れない（400）。B の案件名は A の応答に出ない', async () => {
    expect((await send(host, internalGroup, { projectId: PROJECT_B })).status).toBe(400);
    expect(JSON.stringify(await listMessages(host, internalGroup))).not.toContain(NAME_B);
  });

  it('🔴 DB の複合 FK も、別テナントの案件を指す発言を拒む', async () => {
    await expect(
      admin.$executeRawUnsafe(`
        INSERT INTO messages (id, tenant_id, owner_partner_company_id, thread_id, sender_user_id, sender_partner_company_id, body, attached_project_id)
        VALUES ('01930000-0000-7000-8000-0000000009fa', '${TENANT_A}', NULL, '${internalGroup}', '${USER_A_HOST}', NULL, 'x', '${PROJECT_B}')`),
    ).rejects.toThrow();
  });
});

describe('⑥ 貼る案件の候補（#51n）', () => {
  it('取引先 A1 の部屋: A1 に公開中の案件だけ（未公開・A2 だけに公開は出ない）', async () => {
    expect(await candidateIds(host, THREAD_A_P1)).toEqual([PROJECT_A_PUBLISHED]);
    expect(await candidateIds(partnerA1, THREAD_A_P1)).toEqual([PROJECT_A_PUBLISHED]);
    expect(await candidateIds(host, dmWithA1)).toEqual([PROJECT_A_PUBLISHED]);
  });

  it('社内だけの部屋: 自社の案件すべて（他テナントの案件は出ない）', async () => {
    expect(await candidateIds(host, internalGroup)).toEqual([PROJECT_A_PUBLISHED, PROJECT_A_PRIVATE, PROJECT_A_ONLY_A2].sort());
  });

  it('案件名で絞り込める', async () => {
    expect(await candidateIds(host, internalGroup, 'Only A2')).toEqual([PROJECT_A_ONLY_A2]);
  });

  it('🔴 見えない部屋は 404（他社・他テナント）。閲覧専用は 403。キーは id / name / status だけ', async () => {
    expect((await candidates(partnerA2, THREAD_A_P1)).status).toBe(404);
    expect((await candidates(tenantB, THREAD_A_P1)).status).toBe(404);
    expect((await candidates(hostViewer, THREAD_A_P1)).status).toBe(403);
    const response = await candidates(host, THREAD_A_P1);
    const payload = (await response.json()) as { items: Record<string, unknown>[] };
    expect(Object.keys(payload)).toEqual(['items']);
    expect(Object.keys(payload.items[0] ?? {}).sort()).toEqual([...CHAT_PROJECT_CANDIDATE_KEYS].sort());
    expect(JSON.stringify(payload)).not.toContain('End Client');
  });
});

describe('⑦ 監査ログ・削除', () => {
  it('監査ログに貼った案件の ID が残る（本文は残さない）', async () => {
    const messageId = await createdId(await send(host, internalGroup, { body: '監査の確認', projectId: PROJECT_A_PRIVATE }));
    const log = await admin.auditLog.findFirst({ where: { action: CHAT_MESSAGE_AUDIT_ACTION_CREATE, targetId: messageId } });
    expect(log?.summary).toEqual({ threadId: internalGroup, bodyLength: '監査の確認'.length, attachedProjectId: PROJECT_A_PRIVATE });
    expect(JSON.stringify(log?.summary)).not.toContain('監査の確認');
  });

  it('発言を削除したらカードも消え、列も空になる', async () => {
    const messageId = await createdId(await send(host, internalGroup, { body: '消す発言', projectId: PROJECT_A_PRIVATE }));
    requireTenantCtxMock.mockResolvedValue(host);
    const response = await messageRoute.DELETE(json('DELETE', `https://app.test/api/threads/${internalGroup}/messages/${messageId}`), {
      params: Promise.resolve({ id: internalGroup, messageId }),
    });
    expect(response.status).toBe(200);
    const deleted = ((await response.json()) as { message: Record<string, unknown> }).message;
    expect(deleted.attachedProject).toBeNull();
    expect((await admin.message.findUnique({ where: { id: messageId } }))?.attachedProjectId).toBeNull();
  });
});
