// tests/isolation/chat-threads.test.ts
// 🔴🔴 **越境経路 3（チャット）の分離を、実 DB（RLS 付き）+ 実 Route Handler で証明する。**
//    `CLAUDE.md` §3.1「`ThreadParticipant` に列挙された会社だけが、そのスレッドと添付を読む」/
//    §3.1 の 🔴「パートナー同士が相互に参照できる経路を 1 つも作らない」/ §7「パートナー間の
//    相互参照 0 件（許容しない）」/ `F-038 AC-1` / `AC-2` / `docs/05` §4.4 **C6 THREAD** / §4.8。
//
// ============================================================================
// 🔴 何を固定するか（本ファイルが本タスク最大の成果物である）
// ============================================================================
//   ① 🔴 **参加していない会社から、スレッドが 1 件も読めない。**
//      `PARTNER_A1` の一覧に `THREAD_A_P2`（`PARTNER_A2` のスレッド）が**現れない**。
//      逆も同様。ホストは両方を読む（C6 の `app_is_host()`）。他テナント（`TENANT_B`）は 0 件。
//   ② 🔴 **本文が 1 文字も読めない。** 応答の生テキストに他社のメッセージ本文・他社の社名が
//      **1 度も現れない**（JSON を深さ優先で走査するのではなく**生の本文**で見る —— キーの
//      見落としを防ぐため）。
//   ③ 🔴 **「見えない」と「存在しない」が区別できない。** 他社のスレッド / 他テナントのスレッド /
//      実在しない ID で**状態コードと本文が完全に一致**する（`docs/05` §4.8。区別できると
//      「他社にスレッドが在る」ことを応答から探れる）。
//   ④ 🔴 **投稿も同じ境界である。** 参加していないスレッドへの `POST` は 404 で、**`messages` に
//      行が 1 件も増えない**（RLS の `WITH CHECK` とアプリの照合の二重防御）。
//   ⑤ 🔴 **応答に禁止キーが 1 つも無い**（未読 / 添付 / `owner_partner_company_id` /
//      `sender_partner_company_id` / 単価 / エンド企業名 / 総件数）。
//   ⑥ 🔴 **参加会社の一覧は RLS が決める。** ホストは 2 行（自社 + 取引先）、取引先は**自社 1 行**
//      （`thread_participants` は C5 PARTY であり、ホストの行〔`partner_company_id IS NULL`〕は
//      取引先の述語に合致しない）。**アプリが見えない行を補っていない**ことを数で固定する。
//   ⑦ 🔴 **案件名は `projects` の RLS（C4）が決める。** 自社に公開されていない案件に紐づく
//      スレッドでは、取引先に**案件名が出ない**（`project: null`）。ホストには出る。
//   ⑧ 認可: `VIEWER` は投稿 403 / `SUSPENDED` は 409 / 取引先企業の停止は 409。**読み取りは全ロール可**。
//   ⑨ 監査: 投稿 1 件につき `message.create` が 1 行。🔴 **`summary` に本文が載らない**（`docs/05` §16.2）。
//   ⑩ 会話のカーソルページング: 重複・欠落が無く、`total` を返さない。
//   ⑪ 🔴 **スレッド一覧のカーソルページング**: `last_message_at` が `NULL` の行が 2 ページ目以降で
//      **静かに落ちない**（`apps/web/lib/chat/thread-cursor.ts` の 🔴。行の ID 単体のカーソルは 400）。
//
// 🔴 モックは `requireTenantCtx` / `readRequestMeta`（ctx と IP の出所）だけ。Redis / worker は要らない
//    （チャットはジョブを積まない）。
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  configureTenantDb,
  disconnectTenantDb,
  resolveTenantCtx,
  type AuthenticatedTenantCtx,
} from '@ses/db';
import { createUnextendedClient, type UnextendedClient } from '@ses/db/testing';
import {
  MESSAGE_A_P1,
  MESSAGE_A_P2,
  PARTNER_A1,
  PARTNER_A2,
  PROJECT_A_PRIVATE,
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
const META = { deviceKind: 'desktop', ipAddress: '203.0.113.77' } as const;
const DEVICE = { deviceKind: META.deviceKind } as const;

const requireTenantCtxMock = vi.fn<() => Promise<AuthenticatedTenantCtx>>();

vi.mock('../../apps/web/lib/auth/session', () => ({
  requireTenantCtx: () => requireTenantCtxMock(),
  readRequestMeta: async () => META,
}));

const threadsRoute = await import('../../apps/web/app/api/(main)/threads/route');
const messagesRoute = await import('../../apps/web/app/api/(main)/threads/[id]/messages/route');
const { CHAT_MESSAGE_AUDIT_ACTION_CREATE, CHAT_MESSAGE_AUDIT_TARGET_TYPE } = await import(
  '../../apps/web/lib/chat/service'
);
const {
  CHAT_FORBIDDEN_RESPONSE_KEYS,
  CHAT_MESSAGE_VIEW_KEYS,
  CHAT_PARTICIPANT_VIEW_KEYS,
  CHAT_THREAD_LIST_ITEM_KEYS,
} = await import('../../apps/web/lib/chat/views');

/** 🔴 `fixtures.ts` が投入した本文。**他社の文脈に 1 度も現れてはならない文字列**である。 */
const BODY_P1 = 'partner1 からの本文';
const BODY_P2 = 'partner2 からの本文';
/** 🔴 他社の社名（`fixtures.ts`）。 */
const COMPANY_A1 = 'Partner A1';
const COMPANY_A2 = 'Partner A2';
/** 実在しない ID（境界外の ID と応答が一致することの比較対象）。 */
const ABSENT_THREAD = '01930000-0000-7000-8000-0000000009ff';

/** 本テストが作る行（`afterAll` で消す）。 */
const created = {
  /** `PARTNER_A1` と紐づく **未公開案件**のスレッド（⑦ の材料）。 */
  privateProjectThread: '01930000-0000-7000-8000-0000000009a1',
  hostParticipant: '01930000-0000-7000-8000-0000000009a2',
  partnerParticipant: '01930000-0000-7000-8000-0000000009a3',
  /** ⑩ の材料（`THREAD_A_P1` に足す 3 件）。 */
  pageMessages: ['01930000-0000-7000-8000-0000000009b1', '01930000-0000-7000-8000-0000000009b2', '01930000-0000-7000-8000-0000000009b3'],
};

let database: IsolationDatabase;
let admin: UnextendedClient;
let hostSales: AuthenticatedTenantCtx;
let hostViewer: AuthenticatedTenantCtx;
let hostSuspended: AuthenticatedTenantCtx;
let partnerA1: AuthenticatedTenantCtx;
let partnerA2: AuthenticatedTenantCtx;
let partnerA1Suspended: AuthenticatedTenantCtx;
let hostB: AuthenticatedTenantCtx;

type ThreadListBody = {
  readonly items: readonly Record<string, unknown>[];
  readonly nextCursor: string | null;
};
type MessageListBody = {
  readonly items: readonly Record<string, unknown>[];
  readonly nextCursor: string | null;
};
type ErrorBody = { readonly error: { readonly code: string } };

function segment(id: string): { params: Promise<Record<string, string>> } {
  return { params: Promise.resolve({ id }) };
}

async function listThreads(ctx: AuthenticatedTenantCtx, query = ''): Promise<Response> {
  requireTenantCtxMock.mockResolvedValue(ctx);
  return threadsRoute.GET(new Request(`https://app.test/api/threads${query}`));
}

async function listMessages(ctx: AuthenticatedTenantCtx, threadId: string, query = ''): Promise<Response> {
  requireTenantCtxMock.mockResolvedValue(ctx);
  return messagesRoute.GET(
    new Request(`https://app.test/api/threads/${threadId}/messages${query}`),
    segment(threadId),
  );
}

async function postMessage(ctx: AuthenticatedTenantCtx, threadId: string, body: unknown): Promise<Response> {
  requireTenantCtxMock.mockResolvedValue(ctx);
  return messagesRoute.POST(
    new Request(`https://app.test/api/threads/${threadId}/messages`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
    segment(threadId),
  );
}

async function okJson<T>(response: Response, status = 200): Promise<T> {
  expect(response.status, await response.clone().text()).toBe(status);
  return (await response.json()) as T;
}

/** 応答 JSON を深さ優先で走査してキーを集める。 */
function collectKeys(value: unknown, into: Set<string>): void {
  if (Array.isArray(value)) {
    for (const item of value) collectKeys(item, into);
    return;
  }
  if (typeof value === 'object' && value !== null) {
    for (const [key, nested] of Object.entries(value)) {
      into.add(key);
      collectKeys(nested, into);
    }
  }
}

function idsOf(body: ThreadListBody | MessageListBody): string[] {
  return body.items.map((item) => item['id'] as string);
}

beforeAll(async () => {
  database = await startIsolationDatabase();
  admin = createUnextendedClient(database.superuserUrl);
  configureTenantDb({ datasourceUrl: database.tenantUrl });

  const base = { tenantId: TENANT_A, lifecycleState: 'ACTIVE' as const, partnerSuspendedAt: null, twoFactor: 'NOT_ENROLLED' as const };
  hostSales = await resolveTenantCtx({ ...base, partnerCompanyId: null, userId: USER_A_HOST, role: 'SALES' }, DEVICE);
  hostViewer = await resolveTenantCtx({ ...base, partnerCompanyId: null, userId: USER_A_HOST, role: 'VIEWER' }, DEVICE);
  hostSuspended = await resolveTenantCtx(
    { ...base, partnerCompanyId: null, userId: USER_A_HOST, role: 'SALES', lifecycleState: 'SUSPENDED' },
    DEVICE,
  );
  partnerA1 = await resolveTenantCtx({ ...base, partnerCompanyId: PARTNER_A1, userId: USER_A_PARTNER, role: 'PARTNER_SALES' }, DEVICE);
  partnerA2 = await resolveTenantCtx({ ...base, partnerCompanyId: PARTNER_A2, userId: USER_A_PARTNER2, role: 'PARTNER_SALES' }, DEVICE);
  partnerA1Suspended = await resolveTenantCtx(
    {
      ...base,
      partnerCompanyId: PARTNER_A1,
      userId: USER_A_PARTNER,
      role: 'PARTNER_SALES',
      partnerSuspendedAt: new Date('2026-10-01T00:00:00.000Z'),
    },
    DEVICE,
  );
  hostB = await resolveTenantCtx({ ...base, tenantId: TENANT_B, partnerCompanyId: null, userId: USER_B_HOST, role: 'SALES' }, DEVICE);

  // ⑦ の材料: **`PARTNER_A1` に公開していない案件**に紐づくスレッド（特権接続で作る。
  //    スレッドを起こす API はまだ存在しない —— `docs/05` §6.5 に `POST /api/threads` が無い）。
  await admin.chatThread.create({
    data: {
      id: created.privateProjectThread,
      tenantId: TENANT_A,
      kind: 'PROJECT',
      projectId: PROJECT_A_PRIVATE,
      partnerCompanyId: PARTNER_A1,
      lastMessageAt: new Date('2026-09-30T00:00:00.000Z'),
    },
  });
  await admin.threadParticipant.createMany({
    data: [
      { id: created.hostParticipant, tenantId: TENANT_A, threadId: created.privateProjectThread, partnerCompanyId: null, joinedAt: new Date('2026-09-01T00:00:00.000Z') },
      { id: created.partnerParticipant, tenantId: TENANT_A, threadId: created.privateProjectThread, partnerCompanyId: PARTNER_A1, joinedAt: new Date('2026-09-01T00:00:00.000Z') },
    ],
  });

  // ⑩ の材料: `THREAD_A_P1` に 3 件（`sentAt` は昇順）。
  await admin.message.createMany({
    data: created.pageMessages.map((id, index) => ({
      id,
      tenantId: TENANT_A,
      ownerPartnerCompanyId: PARTNER_A1,
      threadId: THREAD_A_P1,
      senderUserId: USER_A_HOST,
      senderPartnerCompanyId: null,
      body: `t2301 page ${String(index + 1)}`,
      sentAt: new Date(`2026-10-0${String(index + 1)}T00:00:00.000Z`),
    })),
  });
}, SETUP_TIMEOUT_MS);

afterAll(async () => {
  await admin.message.deleteMany({ where: { id: { notIn: [MESSAGE_A_P1, MESSAGE_A_P2] } } });
  await admin.threadParticipant.deleteMany({ where: { threadId: created.privateProjectThread } });
  await admin.chatThread.deleteMany({ where: { id: created.privateProjectThread } });
  await admin.auditLog.deleteMany({ where: { action: CHAT_MESSAGE_AUDIT_ACTION_CREATE } });
  await disconnectTenantDb();
  await admin?.$disconnect();
  await database?.stop();
}, SETUP_TIMEOUT_MS);

beforeEach(() => {
  requireTenantCtxMock.mockReset();
});

afterEach(async () => {
  // 投稿のテストが足した行と監査を消す（材料は残す）。
  await admin.message.deleteMany({
    where: { id: { notIn: [MESSAGE_A_P1, MESSAGE_A_P2, ...created.pageMessages] } },
  });
  await admin.auditLog.deleteMany({ where: { action: CHAT_MESSAGE_AUDIT_ACTION_CREATE } });
  // 🔴 `fixtures.ts` は `last_message_at` を入れていない（`NULL` = 発言なし）。投稿のテストが
  //    進めた値を**元の `NULL` に戻す** —— 固定の日付に戻すと、CI の時計がその日付より前のときに
  //    「進んだこと」の検査が成立しなくなる（実時刻に依存する検査を作らない）。
  await admin.chatThread.update({ where: { id: THREAD_A_P1 }, data: { lastMessageAt: null } });
});

// ---------------------------------------------------------------------------
// ① ② 参加していない会社からスレッドと本文が 1 件も読めない
// ---------------------------------------------------------------------------

describe('🔴🔴 ① GET /api/threads: 参加していない会社のスレッドが 1 件も現れない（C6 / F-038 AC-1）', () => {
  it('`PARTNER_A1` の一覧は自社のスレッドだけ（`THREAD_A_P2` が無い）', async () => {
    const body = await okJson<ThreadListBody>(await listThreads(partnerA1));
    const ids = idsOf(body);
    expect(ids).toContain(THREAD_A_P1);
    expect(ids).toContain(created.privateProjectThread);
    // 🔴 他社のスレッドは 1 件も無い。
    expect(ids).not.toContain(THREAD_A_P2);
  });

  it('`PARTNER_A2` の一覧は自社のスレッドだけ（`THREAD_A_P1` が無い）', async () => {
    const body = await okJson<ThreadListBody>(await listThreads(partnerA2));
    expect(idsOf(body)).toEqual([THREAD_A_P2]);
  });

  it('ホストは両方のスレッドを読む（C6 の `app_is_host()`）', async () => {
    const ids = idsOf(await okJson<ThreadListBody>(await listThreads(hostSales)));
    expect(ids).toContain(THREAD_A_P1);
    expect(ids).toContain(THREAD_A_P2);
  });

  it('🔴 他テナントのホストは 0 件（第一境界）', async () => {
    const body = await okJson<ThreadListBody>(await listThreads(hostB));
    expect(body.items).toEqual([]);
    expect(body.nextCursor).toBeNull();
  });

  it('🔴 `VIEWER` も `CLOSING` でも一覧は読める（読み取りはロールで止めない）', async () => {
    expect((await listThreads(hostViewer)).status).toBe(200);
    const closing = await resolveTenantCtx(
      {
        tenantId: TENANT_A,
        partnerCompanyId: null,
        userId: USER_A_HOST,
        role: 'SALES',
        lifecycleState: 'CLOSING',
        partnerSuspendedAt: null,
        twoFactor: 'NOT_ENROLLED',
      },
      DEVICE,
    );
    expect((await listThreads(closing)).status).toBe(200);
  });

  it('🔴 応答の生テキストに他社の本文・他社の社名が 1 度も現れない', async () => {
    const text = await (await listThreads(partnerA1)).text();
    expect(text).not.toContain(BODY_P2);
    expect(text).not.toContain(COMPANY_A2);
    const text2 = await (await listThreads(partnerA2)).text();
    expect(text2).not.toContain(BODY_P1);
    expect(text2).not.toContain(COMPANY_A1);
  });

  it('🔴 行のキー集合が凍結どおりで、禁止キーが 1 つも無い（総件数も返さない）', async () => {
    const response = await listThreads(hostSales);
    const body = await okJson<ThreadListBody>(response);
    expect(Object.keys(body).sort()).toEqual(['items', 'nextCursor']);
    for (const item of body.items) {
      expect(Object.keys(item).sort()).toEqual([...CHAT_THREAD_LIST_ITEM_KEYS].sort());
    }
    const keys = new Set<string>();
    collectKeys(body, keys);
    for (const forbidden of CHAT_FORBIDDEN_RESPONSE_KEYS) {
      expect([...keys], forbidden).not.toContain(forbidden);
    }
  });
});

describe('🔴🔴 ② ③ GET /api/threads/{id}/messages: 本文が読めず、「見えない」と「存在しない」が区別できない', () => {
  it('参加している会社は自社のスレッドの本文を読める（対照 = 検査が空振りしていない）', async () => {
    const body = await okJson<MessageListBody>(await listMessages(partnerA1, THREAD_A_P1));
    expect(body.items.map((item) => item['body'])).toContain(BODY_P1);
  });

  it('🔴 他社のスレッドは 404 で、本文が 1 文字も含まれない', async () => {
    const response = await listMessages(partnerA1, THREAD_A_P2);
    expect(response.status).toBe(404);
    const text = await response.text();
    expect(text).not.toContain(BODY_P2);
    expect(text).not.toContain(COMPANY_A2);
  });

  it('🔴 他社 / 他テナント / 不存在で**状態コードと本文が完全に一致**する（§4.8）', async () => {
    const other = await listMessages(partnerA1, THREAD_A_P2);
    const absent = await listMessages(partnerA1, ABSENT_THREAD);
    const crossTenant = await listMessages(hostB, THREAD_A_P1);
    const texts = [await other.text(), await absent.text(), await crossTenant.text()];
    expect([other.status, absent.status, crossTenant.status]).toEqual([404, 404, 404]);
    expect(new Set(texts).size).toBe(1);
  });

  it('🔴 行のキー集合が凍結どおりで、禁止キーが 1 つも無い', async () => {
    const body = await okJson<MessageListBody>(await listMessages(hostSales, THREAD_A_P1));
    expect(Object.keys(body).sort()).toEqual(['items', 'nextCursor']);
    for (const item of body.items) {
      expect(Object.keys(item).sort()).toEqual([...CHAT_MESSAGE_VIEW_KEYS].sort());
    }
    const keys = new Set<string>();
    collectKeys(body, keys);
    for (const forbidden of CHAT_FORBIDDEN_RESPONSE_KEYS) {
      expect([...keys], forbidden).not.toContain(forbidden);
    }
  });

  it('🔴 `own` は会社で決まる（取引先の発言はホストにとって `own` ではない）', async () => {
    const forHost = await okJson<MessageListBody>(await listMessages(hostSales, THREAD_A_P1));
    const partnerRowForHost = forHost.items.find((item) => item['id'] === MESSAGE_A_P1);
    expect(partnerRowForHost?.['own']).toBe(false);
    const forPartner = await okJson<MessageListBody>(await listMessages(partnerA1, THREAD_A_P1));
    const partnerRowForPartner = forPartner.items.find((item) => item['id'] === MESSAGE_A_P1);
    expect(partnerRowForPartner?.['own']).toBe(true);
  });

  it('🔴 送信者の会社名は「その発言の会社」である（自分の発言に相手の商号を出さない）', async () => {
    const hostMessage = await okJson<{ readonly id: string }>(
      await postMessage(hostSales, THREAD_A_P1, { body: 't2301 会社名の確認' }),
      201,
    );
    // 取引先の視点: 自分の発言は自社の商号、ホストの発言はテナントの商号。
    const forPartner = await okJson<MessageListBody>(await listMessages(partnerA1, THREAD_A_P1));
    expect(forPartner.items.find((item) => item['id'] === MESSAGE_A_P1)?.['senderCompanyName']).toBe(COMPANY_A1);
    expect(forPartner.items.find((item) => item['id'] === hostMessage.id)?.['senderCompanyName']).toBe('Tenant A');
    // ホストの視点も同じ値になる（視点で社名が入れ替わらない）。
    const forHost = await okJson<MessageListBody>(await listMessages(hostSales, THREAD_A_P1));
    expect(forHost.items.find((item) => item['id'] === MESSAGE_A_P1)?.['senderCompanyName']).toBe(COMPANY_A1);
    expect(forHost.items.find((item) => item['id'] === hostMessage.id)?.['senderCompanyName']).toBe('Tenant A');
  });

  it('🔴 形の違うカーソルは 400（500 にしない = 実在する ID かを応答で探れない）', async () => {
    const response = await listMessages(hostSales, THREAD_A_P1, '?cursor=not-a-uuid');
    expect(response.status).toBe(400);
  });
});

// ---------------------------------------------------------------------------
// ⑩ カーソルページング（古い方へ辿る）
// ---------------------------------------------------------------------------

describe('⑩ 会話のページング（直近 N 件 → 上方向）', () => {
  it('新しい順に読み、古い順に並べて返す。カーソルで重複も欠落も無く辿れる', async () => {
    const first = await okJson<MessageListBody>(await listMessages(hostSales, THREAD_A_P1, '?limit=2'));
    expect(first.items.length).toBe(2);
    expect(first.nextCursor).not.toBeNull();
    // 🔴 返りは**古い順**（最後の要素が最も新しい）。
    const firstSentAt = first.items.map((item) => item['sentAt'] as string);
    expect([...firstSentAt].sort()).toEqual(firstSentAt);

    const second = await okJson<MessageListBody>(
      await listMessages(hostSales, THREAD_A_P1, `?limit=2&cursor=${String(first.nextCursor)}`),
    );
    const firstIds = idsOf(first);
    const secondIds = idsOf(second);
    // 重複が無い。
    expect(secondIds.filter((id) => firstIds.includes(id))).toEqual([]);
    // 🔴 2 ページで材料の全件（fixtures の 1 件 + 本テストの 3 件）に届く。
    const all = [...secondIds, ...firstIds];
    for (const id of [MESSAGE_A_P1, ...created.pageMessages]) expect(all).toContain(id);
    // 🔴 総件数・残件数を返さない。
    expect(Object.keys(first)).not.toContain('total');
  });
});

// ---------------------------------------------------------------------------
// ⑥ ⑦ 参加会社と案件名（RLS が決める）
// ---------------------------------------------------------------------------

describe('🔴 ⑥ 参加会社は `thread_participants`（C5）が返した行だけ', () => {
  it('ホストは 2 行（自社 + 取引先）、取引先は自社 1 行（見えない行を補っていない）', async () => {
    const { readChatScreen } = await import('../../apps/web/lib/chat/read');
    const forHost = await readChatScreen(hostSales, {
      threadId: THREAD_A_P1,
      threadsQuery: { limit: 50 },
      messagesQuery: { limit: 50 },
    });
    expect(forHost.thread?.participants.map((row) => row.isHost).sort()).toEqual([false, true]);
    for (const row of forHost.thread?.participants ?? []) {
      expect(Object.keys(row).sort()).toEqual([...CHAT_PARTICIPANT_VIEW_KEYS].sort());
    }
    const forPartner = await readChatScreen(partnerA1, {
      threadId: THREAD_A_P1,
      threadsQuery: { limit: 50 },
      messagesQuery: { limit: 50 },
    });
    // 🔴 ホストの行（`partner_company_id IS NULL`）は C5 の述語に合致せず**見えない**。
    expect(forPartner.thread?.participants.map((row) => row.isHost)).toEqual([false]);
    expect(forPartner.thread?.participants[0]?.companyName).toBe(COMPANY_A1);
    // 🔴 相手（ホスト企業）の名前はスレッド行から別に伝わる（参加行を補わない代わり）。
    expect(forPartner.thread?.counterpartyName).toBe('Tenant A');
  });

  it('🔴 見えないスレッドを指定したら `requestedThreadMissing`（一覧は返る / 本文は返らない）', async () => {
    const { readChatScreen } = await import('../../apps/web/lib/chat/read');
    const screen = await readChatScreen(partnerA1, {
      threadId: THREAD_A_P2,
      threadsQuery: { limit: 50 },
      messagesQuery: { limit: 50 },
    });
    expect(screen.requestedThreadMissing).toBe(true);
    expect(screen.thread).toBeNull();
    expect(screen.messages.items).toEqual([]);
    // 🔴 不存在の ID でも**同じ形**になる（区別できない）。
    const absent = await readChatScreen(partnerA1, {
      threadId: ABSENT_THREAD,
      threadsQuery: { limit: 50 },
      messagesQuery: { limit: 50 },
    });
    expect(absent.requestedThreadMissing).toBe(true);
    expect(absent.thread).toBeNull();
  });
});

describe('🔴 ⑪ スレッド一覧のページング（`last_message_at` が `NULL` の行が落ちない）', () => {
  /** ページサイズ 1 で最後まで辿り、現れた ID を順に集める。 */
  async function walk(ctx: AuthenticatedTenantCtx): Promise<readonly string[]> {
    const seen: string[] = [];
    let cursor: string | null = null;
    for (let page = 0; page < 6; page += 1) {
      const query: string = cursor === null ? '?limit=1' : `?limit=1&cursor=${encodeURIComponent(cursor)}`;
      const body = await okJson<ThreadListBody>(await listThreads(ctx, query));
      seen.push(...idsOf(body));
      if (body.nextCursor === null) break;
      cursor = body.nextCursor;
    }
    return seen;
  }

  it('ページサイズ 1 で全件をちょうど 1 度ずつ辿れる', async () => {
    // 🔴 ホスト A には 3 本（うち 2 本は `last_message_at` が `NULL`）。行の ID 単体を
    //    カーソルにしていると、2 ページ目以降で `NULL` の行が静かに落ちる
    //    （`apps/web/lib/chat/thread-cursor.ts` の 🔴）。
    const seen = await walk(hostSales);
    expect(new Set(seen).size).toBe(seen.length);
    expect([...seen].sort()).toEqual([THREAD_A_P1, THREAD_A_P2, created.privateProjectThread].sort());
  });

  it('🔴 行の ID 単体のカーソルは 400（複合カーソルでなければ受けない）', async () => {
    expect((await listThreads(hostSales, `?cursor=${THREAD_A_P1}`)).status).toBe(400);
    expect((await listThreads(hostSales, '?cursor=not-a-cursor')).status).toBe(400);
  });

  it('🔴 取引先のページングも自社のスレッドだけを辿る（他社が混ざらない）', async () => {
    const seen = await walk(partnerA1);
    expect([...seen].sort()).toEqual([THREAD_A_P1, created.privateProjectThread].sort());
    expect(seen).not.toContain(THREAD_A_P2);
  });
});

describe('🔴 ⑦ 案件名は `projects` の RLS（C4）が決める', () => {
  it('自社に公開されていない案件のスレッドでは、取引先に案件名が出ない（ホストには出る）', async () => {
    const forPartner = await okJson<ThreadListBody>(await listThreads(partnerA1));
    const partnerRow = forPartner.items.find((item) => item['id'] === created.privateProjectThread);
    expect(partnerRow?.['kind']).toBe('PROJECT');
    // 🔴 名前が出ない（`null`）。スレッド自体は参加しているので見える。
    expect(partnerRow?.['project']).toBeNull();

    const forHost = await okJson<ThreadListBody>(await listThreads(hostSales));
    const hostRow = forHost.items.find((item) => item['id'] === created.privateProjectThread);
    expect((hostRow?.['project'] as { readonly name: string } | null)?.name).toBe('Project A Private');
  });
});

// ---------------------------------------------------------------------------
// ④ ⑧ ⑨ 投稿
// ---------------------------------------------------------------------------

describe('🔴🔴 ④ POST /api/threads/{id}/messages: 参加していないスレッドへは投稿できず、行が 1 件も増えない', () => {
  it('🔴 他社のスレッドへの投稿は 404 で、`messages` に行が増えない', async () => {
    const before = await admin.message.count({ where: { threadId: THREAD_A_P2 } });
    const response = await postMessage(partnerA1, THREAD_A_P2, { body: 't2301 他社のスレッドへの投稿' });
    expect(response.status).toBe(404);
    expect(await admin.message.count({ where: { threadId: THREAD_A_P2 } })).toBe(before);
  });

  it('🔴 他テナントのスレッドへの投稿も 404 で、行が増えない', async () => {
    const before = await admin.message.count({ where: { threadId: THREAD_A_P1 } });
    expect((await postMessage(hostB, THREAD_A_P1, { body: 't2301 他テナント' })).status).toBe(404);
    expect(await admin.message.count({ where: { threadId: THREAD_A_P1 } })).toBe(before);
  });

  it('🔴 不存在の ID も同じ 404（本文まで一致）', async () => {
    const other = await postMessage(partnerA1, THREAD_A_P2, { body: 't2301 x' });
    const absent = await postMessage(partnerA1, ABSENT_THREAD, { body: 't2301 x' });
    expect([other.status, absent.status]).toEqual([404, 404]);
    expect(await other.text()).toBe(await absent.text());
  });

  it('参加している会社は投稿でき、相手（ホスト）に見え、他社には見えない', async () => {
    const created201 = await okJson<{ readonly id: string; readonly message: Record<string, unknown> }>(
      await postMessage(partnerA1, THREAD_A_P1, { body: 't2301 取引先からの投稿' }),
      201,
    );
    expect(created201.message['own']).toBe(true);
    expect(Object.keys(created201.message).sort()).toEqual([...CHAT_MESSAGE_VIEW_KEYS].sort());

    // ホストには見える。
    const forHost = await okJson<MessageListBody>(await listMessages(hostSales, THREAD_A_P1));
    expect(idsOf(forHost)).toContain(created201.id);
    expect(forHost.items.find((item) => item['id'] === created201.id)?.['own']).toBe(false);

    // 🔴 他社（`PARTNER_A2`）には 404 であり、本文も現れない。
    const forOther = await listMessages(partnerA2, THREAD_A_P1);
    expect(forOther.status).toBe(404);
    expect(await forOther.text()).not.toContain('t2301 取引先からの投稿');
  });

  it('ホストも投稿できる（相手の `own` は `false`）', async () => {
    const body = await okJson<{ readonly message: Record<string, unknown> }>(
      await postMessage(hostSales, THREAD_A_P1, { body: 't2301 ホストからの投稿' }),
      201,
    );
    expect(body.message['own']).toBe(true);
    const forPartner = await okJson<MessageListBody>(await listMessages(partnerA1, THREAD_A_P1));
    expect(forPartner.items.find((item) => item['body'] === 't2301 ホストからの投稿')?.['own']).toBe(false);
  });

  it('🔴 ⑨ 投稿 1 件につき `message.create` が 1 行。`summary` に本文が載らない', async () => {
    const posted = await okJson<{ readonly id: string }>(
      await postMessage(partnerA1, THREAD_A_P1, { body: 't2301 監査の確認' }),
      201,
    );
    const logs = await admin.auditLog.findMany({ where: { action: CHAT_MESSAGE_AUDIT_ACTION_CREATE } });
    expect(logs.length).toBe(1);
    const log = logs[0];
    expect(log?.targetType).toBe(CHAT_MESSAGE_AUDIT_TARGET_TYPE);
    expect(log?.targetId).toBe(posted.id);
    expect(log?.actorId).toBe(USER_A_PARTNER);
    expect(log?.actorKind).toBe('USER');
    expect(log?.tenantId).toBe(TENANT_A);
    // 🔴 本文が 1 文字も載っていない（`docs/05` §16.2）。
    expect(JSON.stringify(log?.summary)).not.toContain('監査の確認');
    expect(log?.summary).toEqual({ threadId: THREAD_A_P1, bodyLength: 't2301 監査の確認'.length });
  });

  it('🔴 ⑨ 404 のときは監査ログを 1 行も書かない（起きなかった操作を記録しない）', async () => {
    expect((await postMessage(partnerA1, THREAD_A_P2, { body: 't2301 x' })).status).toBe(404);
    expect(await admin.auditLog.count({ where: { action: CHAT_MESSAGE_AUDIT_ACTION_CREATE } })).toBe(0);
  });

  it('🔴 投稿でスレッドの `last_message_at` が進み、`NULL`（発言なし）より前に並ぶ', async () => {
    const before = await admin.chatThread.findUniqueOrThrow({
      where: { id: THREAD_A_P1 },
      select: { lastMessageAt: true },
    });
    const posted = await okJson<{ readonly message: { readonly sentAt: string } }>(
      await postMessage(partnerA1, THREAD_A_P1, { body: 't2301 並びの確認' }),
      201,
    );
    const after = await admin.chatThread.findUniqueOrThrow({
      where: { id: THREAD_A_P1 },
      select: { lastMessageAt: true },
    });
    // 🔴 投稿と**同じ時刻**がスレッドに書かれている（別の now を 2 回読んでいない）。
    expect(after.lastMessageAt?.toISOString()).toBe(posted.message.sentAt);
    expect(after.lastMessageAt?.getTime() ?? 0).toBeGreaterThan(before.lastMessageAt?.getTime() ?? 0);

    // 🔴 並びは「最終更新の新しい順、発言なし（`NULL`）は最後」である（`read.ts` の `orderBy`）。
    //    🔴 **実時刻に依存しない形で固定する** —— `THREAD_A_P2` は `last_message_at` が `NULL` の
    //    ままなので、投稿したスレッドは**必ず**その前に来る（CI の時計が材料の日付と前後しても成立する）。
    const ids = idsOf(await okJson<ThreadListBody>(await listThreads(hostSales)));
    expect(ids.indexOf(THREAD_A_P1)).toBeLessThan(ids.indexOf(THREAD_A_P2));
    expect(ids[ids.length - 1]).toBe(THREAD_A_P2);
  });
});

describe('🔴 ⑧ 投稿の認可', () => {
  it('`VIEWER` は 403（`docs/04` §S-031「`VIEWER` は投稿・添付ができない」）', async () => {
    const response = await postMessage(hostViewer, THREAD_A_P1, { body: 't2301 viewer' });
    expect(response.status).toBe(403);
    expect(await admin.message.count({ where: { body: 't2301 viewer' } })).toBe(0);
  });

  it('`SUSPENDED` のテナントは 409（実行系は一切できない。`F-004 AC-7`）', async () => {
    const response = await postMessage(hostSuspended, THREAD_A_P1, { body: 't2301 suspended' });
    expect(response.status).toBe(409);
    expect(await admin.message.count({ where: { body: 't2301 suspended' } })).toBe(0);
  });

  it('停止された取引先企業は 409（`requireExecutable` の 2 つ目の判定）', async () => {
    const response = await postMessage(partnerA1Suspended, THREAD_A_P1, { body: 't2301 partner-suspended' });
    expect(response.status).toBe(409);
    expect(await admin.message.count({ where: { body: 't2301 partner-suspended' } })).toBe(0);
  });

  it('🔴 空・空白だけの本文は 400、上限超えも 400（行は増えない）', async () => {
    expect((await postMessage(partnerA1, THREAD_A_P1, { body: '   ' })).status).toBe(400);
    expect((await postMessage(partnerA1, THREAD_A_P1, {})).status).toBe(400);
    const before = await admin.message.count({ where: { threadId: THREAD_A_P1 } });
    expect((await postMessage(partnerA1, THREAD_A_P1, { body: 'あ'.repeat(4001) })).status).toBe(400);
    expect(await admin.message.count({ where: { threadId: THREAD_A_P1 } })).toBe(before);
  });

  it('🔴 添付のキーを混ぜても無視される（スキャン前のオブジェクトキーが相手に渡らない）', async () => {
    const posted = await okJson<{ readonly id: string }>(
      await postMessage(partnerA1, THREAD_A_P1, { body: 't2301 添付の口', attachmentKey: 't/x/y.pdf' }),
      201,
    );
    const row = await admin.message.findUniqueOrThrow({
      where: { id: posted.id },
      select: { attachmentKey: true, attachmentScanStatus: true, reviewGateId: true },
    });
    expect(row.attachmentKey).toBeNull();
    expect(row.attachmentScanStatus).toBeNull();
    expect(row.reviewGateId).toBeNull();
  });

  it('🔴 `owner_partner_company_id` は継承トリガが確定させる（入力で付け替えられない）', async () => {
    const posted = await okJson<{ readonly id: string }>(
      await postMessage(hostSales, THREAD_A_P1, { body: 't2301 継承の確認' }),
      201,
    );
    const row = await admin.message.findUniqueOrThrow({
      where: { id: posted.id },
      select: { ownerPartnerCompanyId: true, senderPartnerCompanyId: true, senderUserId: true },
    });
    // 🔴 スレッドの相手（`PARTNER_A1`）に揃う。送信者がホストでも変わらない。
    expect(row.ownerPartnerCompanyId).toBe(PARTNER_A1);
    expect(row.senderPartnerCompanyId).toBeNull();
    expect(row.senderUserId).toBe(USER_A_HOST);
  });

  it('形の違うスレッド ID は 400（`docs/05` §6.1 の境界検証）', async () => {
    requireTenantCtxMock.mockResolvedValue(partnerA1);
    const response = await messagesRoute.POST(
      new Request('https://app.test/api/threads/not-a-uuid/messages', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ body: 't2301 x' }),
      }),
      segment('not-a-uuid'),
    );
    expect(response.status).toBe(400);
    expect(((await response.json()) as ErrorBody).error.code).toBe('VALIDATION');
  });
});
