// tests/isolation/chat-search.test.ts
// ✅ 2026-10-29（チャットレーン・紺野の決定）: 会話の中の検索（`GET /api/threads/{id}/messages/search`。`docs/05` §6.5 #51s /
// `docs/02` F-038 ⑰）の分離を、実 DB（RLS 付き）+ 実 Route Handler で確かめる。
//
// 🔴 ここで固定すること:
//   ① 読める部屋の、読める発言だけが返る（新しい順）
//   ② 🔴 別の取引先・他テナント・メンバーでない人（同じ会社の管理者を含む）・不存在の部屋は 404 で、本文まで同じ応答
//   ③ 🔴 検査中（CLEAN でない）の他人の添付の発言は返らない（送った本人には返る）
//   ④ 🔴 消した発言・保持期限で消えた発言（purged）は返らない
//   ⑤ 引用の見出しの名前・写しだけに当たった発言は返らない
//   ⑥ 🔴 応答は `{ items }` だけで、件数を持たない。1 件のキーは messageId / sentAt / senderName / snippet だけ
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  configureTenantDb,
  disconnectTenantDb,
  resolveTenantCtx,
  type AuthenticatedTenantCtx,
} from '@ses/db';
import { createObjectStore, type ObjectStore } from '@ses/connectors';
import { createUnextendedClient, type UnextendedClient } from '@ses/db/testing';
import {
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
import { quotaDefaultsWith } from './support/quota-defaults.js';

const SETUP_TIMEOUT_MS = 600_000;
const META = { deviceKind: 'desktop', ipAddress: '203.0.113.93' } as const;
const DEVICE = { deviceKind: META.deviceKind } as const;
const USER_A_HOST2 = '01930000-0000-7000-8000-0000000009f1';
/** 自社の管理者（グループのメンバーではない）。 */
const USER_A_HOST3 = '01930000-0000-7000-8000-0000000009f2';
const ABSENT_THREAD = '01930000-0000-7000-8000-0000000009fe';
const SECRET = Buffer.alloc(32, 7).toString('base64');
/** 検索語（ほかのテストの本文と重ならない語）。 */
const WORD = 'しらべものX9';

const requireTenantCtxMock = vi.fn<() => Promise<AuthenticatedTenantCtx>>();
vi.mock('../../apps/web/lib/auth/session', () => ({
  requireTenantCtx: () => requireTenantCtxMock(),
  readRequestMeta: async () => META,
}));

const groupsRoute = await import('../../apps/web/app/api/(main)/threads/groups/route');
const searchRoute = await import('../../apps/web/app/api/(main)/threads/[id]/messages/search/route');
const { deleteChatMessage, sendChatMessage } = await import('../../apps/web/lib/chat/service');
const { issueChatAttachmentUploadUrl } = await import('../../apps/web/lib/chat/attachments');
const { createChatAttachmentTokenCodec } = await import('../../apps/web/lib/chat/attachment-token');
const { buildQuotedBody } = await import('../../apps/web/lib/chat/quote');
const QUOTA = quotaDefaultsWith({ storageLimitBytes: 10n * 1024n * 1024n * 1024n });

let database: IsolationDatabase;
let admin: UnextendedClient;
let host: AuthenticatedTenantCtx;
let host2: AuthenticatedTenantCtx;
let host3: AuthenticatedTenantCtx;
let partnerA1: AuthenticatedTenantCtx;
let partnerA2: AuthenticatedTenantCtx;
let tenantB: AuthenticatedTenantCtx;
let groupA: string;
let store: ObjectStore;
const tokens = createChatAttachmentTokenCodec(SECRET);
const now = () => new Date();

type SearchBody = { readonly items: readonly Record<string, unknown>[] };

async function say(ctx: AuthenticatedTenantCtx, threadId: string, body: string) {
  return (await sendChatMessage(ctx, threadId, { body }, { now, meta: { ipAddress: META.ipAddress } })).message;
}

async function search(ctx: AuthenticatedTenantCtx, threadId: string, q: string): Promise<Response> {
  requireTenantCtxMock.mockResolvedValue(ctx);
  return searchRoute.GET(
    new Request(`https://app.test/api/threads/${threadId}/messages/search?q=${encodeURIComponent(q)}`),
    { params: Promise.resolve({ id: threadId }) },
  );
}

async function hits(ctx: AuthenticatedTenantCtx, threadId: string, q: string): Promise<SearchBody> {
  const response = await search(ctx, threadId, q);
  expect(response.status, await response.clone().text()).toBe(200);
  return (await response.json()) as SearchBody;
}

const idsOf = (body: SearchBody) => body.items.map((item) => item['messageId']);

beforeAll(async () => {
  database = await startIsolationDatabase();
  admin = createUnextendedClient(database.superuserUrl);
  configureTenantDb({ datasourceUrl: database.tenantUrl });
  store = createObjectStore('mock');
  await admin.user.createMany({
    data: [
      { id: USER_A_HOST2, tenantId: TENANT_A, ownerPartnerCompanyId: null, email: 'host2@search.test', displayName: '検索 二郎', passwordHash: 'x' },
      { id: USER_A_HOST3, tenantId: TENANT_A, ownerPartnerCompanyId: null, email: 'host3@search.test', displayName: '検索 三郎', passwordHash: 'x' },
    ],
  });
  const base = { lifecycleState: 'ACTIVE' as const, partnerSuspendedAt: null, twoFactor: 'NOT_ENROLLED' as const };
  host = await resolveTenantCtx({ ...base, tenantId: TENANT_A, partnerCompanyId: null, userId: USER_A_HOST, role: 'SALES' }, DEVICE);
  host2 = await resolveTenantCtx({ ...base, tenantId: TENANT_A, partnerCompanyId: null, userId: USER_A_HOST2, role: 'SALES' }, DEVICE);
  host3 = await resolveTenantCtx({ ...base, twoFactor: 'VERIFIED', tenantId: TENANT_A, partnerCompanyId: null, userId: USER_A_HOST3, role: 'ADMIN' }, DEVICE);
  partnerA1 = await resolveTenantCtx({ ...base, tenantId: TENANT_A, partnerCompanyId: PARTNER_A1, userId: USER_A_PARTNER, role: 'PARTNER_SALES' }, DEVICE);
  partnerA2 = await resolveTenantCtx({ ...base, tenantId: TENANT_A, partnerCompanyId: PARTNER_A2, userId: USER_A_PARTNER2, role: 'PARTNER_SALES' }, DEVICE);
  tenantB = await resolveTenantCtx({ ...base, tenantId: TENANT_B, partnerCompanyId: null, userId: USER_B_HOST, role: 'SALES' }, DEVICE);
  requireTenantCtxMock.mockResolvedValue(host);
  const created = await groupsRoute.POST(
    new Request('https://app.test/api/threads/groups', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title: '検索の段取り', userIds: [USER_A_HOST2] }),
    }),
  );
  expect([200, 201], await created.clone().text()).toContain(created.status);
  groupA = ((await created.json()) as { id: string }).id;
}, SETUP_TIMEOUT_MS);

afterAll(async () => {
  await admin?.auditLog.deleteMany({ where: { action: { startsWith: 'chat_attachment.' } } });
  await admin?.chatThread.deleteMany({ where: { kind: { in: ['DM', 'GROUP'] } } });
  await admin?.user.deleteMany({ where: { id: { in: [USER_A_HOST2, USER_A_HOST3] } } });
  await disconnectTenantDb();
  await admin?.$disconnect();
  await database?.stop();
}, SETUP_TIMEOUT_MS);

describe('① 読める部屋の、読める発言だけ', () => {
  it('取引先 A1 の会社グループで書いた発言を、ホストと A1 が新しい順に見つけられる', async () => {
    const first = await say(partnerA1, THREAD_A_P1, `面談の件 ${WORD} その1`);
    const second = await say(host, THREAD_A_P1, `承知しました ${WORD} その2`);
    for (const ctx of [host, partnerA1]) {
      const body = await hits(ctx, THREAD_A_P1, WORD);
      expect(idsOf(body).slice(0, 2)).toEqual([second.id, first.id]);
    }
  });

  it('🔴 ほかの部屋（A2 の会社グループ）の同じ語の発言は混ざらない', async () => {
    const elsewhere = await say(partnerA2, THREAD_A_P2, `別の部屋 ${WORD}`);
    expect(idsOf(await hits(host, THREAD_A_P1, WORD))).not.toContain(elsewhere.id);
  });
});

describe('② 🔴 読めない部屋は 404（区別できない）', () => {
  it('別の取引先・他テナント・メンバーでない管理者・不存在で、状態コードと本文が完全に一致する', async () => {
    await say(host2, groupA, `社内だけ ${WORD}`);
    const responses = [
      await search(partnerA1, THREAD_A_P2, WORD),
      await search(tenantB, THREAD_A_P1, WORD),
      await search(host3, groupA, WORD),
      await search(partnerA1, ABSENT_THREAD, WORD),
    ];
    const texts = await Promise.all(responses.map((response) => response.text()));
    expect(responses.map((response) => response.status)).toEqual([404, 404, 404, 404]);
    expect(new Set(texts).size).toBe(1);
    for (const text of texts) {
      expect(text).not.toContain(WORD);
      expect(text).not.toContain('Partner A2');
    }
    // 対照: メンバーには同じ方法で見える（検査が空振りしていない）。
    expect((await hits(host, groupA, WORD)).items.length).toBeGreaterThan(0);
  });
});

describe('③ 🔴 検査中の他人の添付の発言は返らない', () => {
  it('送った本人には返り、ほかのメンバーには返らない', async () => {
    const ticket = await issueChatAttachmentUploadUrl(
      host2,
      groupA,
      { contentType: 'application/pdf', byteSize: 321 },
      { objectStore: store, tokens, uploadMaxBytes: 20 * 1024 * 1024, quotaDefaults: QUOTA, now },
    );
    const sent = (
      await sendChatMessage(
        host2,
        groupA,
        { body: `資料です ${WORD} 検査中`, attachmentUploadToken: ticket.uploadToken },
        { now, meta: { ipAddress: META.ipAddress }, attachments: { objectStore: store, tokens, quotaDefaults: QUOTA } },
      )
    ).message;
    expect(idsOf(await hits(host2, groupA, '検査中'))).toContain(sent.id);
    expect(idsOf(await hits(host, groupA, '検査中'))).not.toContain(sent.id);
  });
});

describe('④ 🔴 消えた発言は返らない', () => {
  it('送った本人が消した発言', async () => {
    const sent = await say(host, THREAD_A_P1, `消します ${WORD} 削除予定`);
    expect(idsOf(await hits(host, THREAD_A_P1, '削除予定'))).toContain(sent.id);
    await deleteChatMessage(host, THREAD_A_P1, sent.id, { now, meta: { ipAddress: null } });
    expect(idsOf(await hits(host, THREAD_A_P1, '削除予定'))).not.toContain(sent.id);
  });

  it('保持期限で消えた発言（purged。本文が残っていても）', async () => {
    const sent = await say(host, THREAD_A_P1, `保持期限 ${WORD} 消去予定`);
    await admin.message.update({ where: { id: sent.id }, data: { purgedAt: new Date() } });
    expect(idsOf(await hits(host, THREAD_A_P1, '消去予定'))).not.toContain(sent.id);
  });
});

describe('⑤ 引用の見出し・写しだけに当たった発言は返らない', () => {
  it('引用の名前・写した冒頭で検索しても当たらず、返信の本文では当たる', async () => {
    const quoted = await say(partnerA1, THREAD_A_P1, `元の発言 ${WORD}`);
    const reply = await say(
      host,
      THREAD_A_P1,
      buildQuotedBody({ messageId: quoted.id, name: '引用だけの名前', snippet: '写しだけの文' }, `返信の本文 ${WORD} 返答`),
    );
    expect(idsOf(await hits(host, THREAD_A_P1, '引用だけの名前'))).toEqual([]);
    expect(idsOf(await hits(host, THREAD_A_P1, '写しだけの文'))).toEqual([]);
    const found = await hits(host, THREAD_A_P1, '返答');
    expect(idsOf(found)).toEqual([reply.id]);
    expect(String(found.items[0]?.['snippet'])).not.toContain('chat-message:');
  });
});

describe('⑥ 🔴 応答の形', () => {
  it('`{ items }` だけで件数を持たず、1 件のキーは 4 つだけ', async () => {
    const response = await search(host, THREAD_A_P1, WORD);
    const body = (await response.json()) as SearchBody;
    expect(Object.keys(body)).toEqual(['items']);
    for (const item of body.items) expect(Object.keys(item).sort()).toEqual(['messageId', 'senderName', 'sentAt', 'snippet']);
  });

  it('2 文字未満の検索語は 400（部屋が読めるかに関わらず同じ）', async () => {
    const readable = await search(host, THREAD_A_P1, 'あ');
    const unreadable = await search(partnerA1, THREAD_A_P2, 'あ');
    expect([readable.status, unreadable.status]).toEqual([400, 400]);
    expect(await readable.text()).toBe(await unreadable.text());
  });
});
