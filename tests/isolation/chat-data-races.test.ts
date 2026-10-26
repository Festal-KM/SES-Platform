// tests/isolation/chat-data-races.test.ts
// ✅ 2026-10-26（チャットレーン。Issue #166 の 1・5）: 同時の要求で保存データが壊れないことを、実 DB（RLS 付き）で確かめる。
//
//   ① 🔴 **削除と編集が重なっても、消した本文が DB に戻らない**（#166 の 1）。
//      以前は「未削除か」を確かめた後に ID だけを条件に本文を書いていたので、その間に削除が確定すると
//      削除済みの行へ本文が書き戻っていた。いまは更新そのものを「本人・この部屋・未削除・未消去」で条件付けする。
//      - 決まった順で再現する: 別の接続で行をつかんだまま編集を走らせ（確認は通り、更新で待たされる）、
//        その間に削除を確定させる → 編集は 404、本文は NULL のまま。
//      - Promise.all で編集と削除を同時に何度も走らせ、どの順でも最後は本文 NULL・削除済みで残る。
//   ② 🔴 **既読位置が同時の要求で後退しない**（#166 の 5）。
//      以前は「今の位置を読む → 比べる → 書く」が別々で、新 → 旧の順に書かれると既読が戻っていた。
//      - 決まった順で再現する: 行をつかんだまま古い位置への既読を走らせ、その間に新しい位置を確定させる → 新しい位置が残る。
//      - 初回 INSERT を未確定で保持し、新旧両方の INSERT が一意制約で待つことを確かめてから解放し、新しい方が残る。
//   ③ 「ここから未読にする」（意図して戻す操作）は従来どおり戻せる。
//
// 🔴 モックは `requireTenantCtx` / `readRequestMeta` だけ（chat-threads.test.ts と同じ）。
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  configureTenantDb,
  disconnectTenantDb,
  resolveTenantCtx,
  type AuthenticatedTenantCtx,
} from '@ses/db';
import { createUnextendedClient, type UnextendedClient } from '@ses/db/testing';
import { PARTNER_A1, TENANT_A, THREAD_A_P1, USER_A_HOST, USER_A_PARTNER } from './support/fixtures.js';
import { startIsolationDatabase, type IsolationDatabase } from './support/postgres.js';

const SETUP_TIMEOUT_MS = 600_000;
const META = { deviceKind: 'desktop', ipAddress: '203.0.113.88' } as const;
const DEVICE = { deviceKind: META.deviceKind } as const;
const DEPS = { now: () => new Date('2026-10-26T09:00:00.000Z'), meta: { ipAddress: null } };
const ROUNDS = 8;

vi.mock('../../apps/web/lib/auth/session', () => ({
  requireTenantCtx: async () => {
    throw new Error('このテストはルートを通らない');
  },
  readRequestMeta: async () => META,
}));

/** この試験だけが足す発言の ID（`...0e{n}{xx}`）。 */
function raceMessageId(group: number, index: number): string {
  return `01930000-0000-7000-8000-0000000e${String(group)}${index.toString(16).padStart(3, '0')}`;
}

let database: IsolationDatabase;
let admin: UnextendedClient;
/** 🔴 行をつかんでおくための別の接続（`admin` は接続 1 本なので、つかんだまま待ちの様子を問い合わせられない）。 */
let locker: UnextendedClient;
let partnerA1: AuthenticatedTenantCtx;
let hostSales: AuthenticatedTenantCtx;

beforeAll(async () => {
  database = await startIsolationDatabase();
  admin = createUnextendedClient(database.superuserUrl);
  locker = createUnextendedClient(database.superuserUrl);
  configureTenantDb({ datasourceUrl: database.tenantUrl });
  const base = { tenantId: TENANT_A, lifecycleState: 'ACTIVE' as const, partnerSuspendedAt: null, twoFactor: 'NOT_ENROLLED' as const };
  partnerA1 = await resolveTenantCtx({ ...base, partnerCompanyId: PARTNER_A1, userId: USER_A_PARTNER, role: 'PARTNER_SALES' }, DEVICE);
  hostSales = await resolveTenantCtx({ ...base, partnerCompanyId: null, userId: USER_A_HOST, role: 'SALES' }, DEVICE);
}, SETUP_TIMEOUT_MS);

afterAll(async () => {
  await disconnectTenantDb();
  await admin?.$disconnect();
  await locker?.$disconnect();
  await database?.stop();
}, SETUP_TIMEOUT_MS);

/** 取引先 A1 の人が THREAD_A_P1 に送った発言を 1 件置く。 */
async function seedOwnMessage(id: string, sentAt: Date, body = 'race 元の本文'): Promise<void> {
  await admin.message.create({
    data: {
      id,
      tenantId: TENANT_A,
      ownerPartnerCompanyId: PARTNER_A1,
      threadId: THREAD_A_P1,
      senderUserId: USER_A_PARTNER,
      senderPartnerCompanyId: PARTNER_A1,
      body,
      sentAt,
    },
  });
}

/** 行ロックで待たされている要求が現れるまで待つ（決まった順で競合を起こすため）。 */
async function waitForLockWaiter(): Promise<void> {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const rows = await admin.$queryRaw<{ count: number }[]>`
      SELECT count(*)::int AS count FROM pg_stat_activity
       WHERE datname = current_database() AND wait_event_type = 'Lock'`;
    if ((rows[0]?.count ?? 0) > 0) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error('行ロックで待っている要求が現れなかった');
}

type Settled<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: unknown };
function settle<T>(promise: Promise<T>): Promise<Settled<T>> {
  return promise.then(
    (value) => ({ ok: true as const, value }),
    (error: unknown) => ({ ok: false as const, error }),
  );
}

/** 既読行の初回 INSERT の確定を待つ要求だけを数える。他の行ロックでは待ち合わせを通さない。 */
async function waitForReadStateInsertWaiters(blockerPid: number, count: number): Promise<void> {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const rows = await admin.$queryRaw<{ count: number }[]>`
      SELECT count(*)::int AS count FROM pg_stat_activity
       WHERE datname = current_database()
         AND wait_event_type = 'Lock' AND wait_event = 'transactionid'
         AND query LIKE '%INSERT INTO%chat_read_states%'
         AND ${blockerPid}::int = ANY(pg_blocking_pids(pid))`;
    if ((rows[0]?.count ?? 0) === count) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`既読行の初回 INSERT の確定を待つ要求が ${String(count)} 件にならなかった`);
}

describe('🔴 ① #166 の 1: 削除と編集が重なっても、消した本文が DB に戻らない', () => {
  beforeEach(async () => {
    await admin.auditLog.deleteMany({ where: { action: { in: ['message.update', 'message.delete'] } } });
  });

  afterAll(async () => {
    const ids = [raceMessageId(1, 0), raceMessageId(3, 0), ...Array.from({ length: ROUNDS }, (_, index) => raceMessageId(2, index))];
    await admin.message.deleteMany({ where: { id: { in: ids } } });
    await admin.auditLog.deleteMany({ where: { action: { in: ['message.update', 'message.delete'] } } });
  });

  it('決まった順: 編集が確認を通った後に削除が確定すると、編集は 404 になり本文は NULL のまま', async () => {
    const { editChatMessage } = await import('../../apps/web/lib/chat/service');
    const id = raceMessageId(1, 0);
    await seedOwnMessage(id, new Date('2026-10-20T00:00:00.000Z'));

    // 別の接続で行をつかむ → 編集は「未削除か」の確認（ロック不要の読み取り）を通り、更新で待たされる →
    // その間に削除を確定させる → 編集の更新は確定後の行で条件を測り直す。
    const holder = await locker.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT id FROM messages WHERE id = ${id}::uuid FOR UPDATE`;
        const editing = settle(editChatMessage(partnerA1, THREAD_A_P1, id, { body: 'race 書き戻し' }, DEPS));
        await waitForLockWaiter();
        await tx.$executeRaw`UPDATE messages SET body = NULL, deleted_at = now(), attached_project_id = NULL WHERE id = ${id}::uuid`;
        // 🔴 Promise をそのまま返すと、トランザクションの確定前に編集を待って行き詰まる（オブジェクトに包む）。
        return { editing };
      },
      { timeout: 30_000 },
    );
    const edited = await holder.editing;
    expect(edited.ok).toBe(false);
    if (!edited.ok) expect(edited.error).toMatchObject({ httpStatus: 404 });

    const row = await admin.message.findUniqueOrThrow({ where: { id } });
    expect(row.body).toBeNull();
    expect(row.deletedAt).not.toBeNull();
    expect(row.editedAt).toBeNull();
    // 🔴 失敗した編集は監査ログに残らない（巻き戻ったトランザクションの中で書かれるため）。
    expect(await admin.auditLog.count({ where: { action: 'message.update', targetId: id } })).toBe(0);
  });

  it(`Promise.all で編集と削除を同時に ${String(ROUNDS)} 回: どの順でも本文は NULL・削除済みで残り、削除の監査は 1 件`, async () => {
    const { deleteChatMessage, editChatMessage } = await import('../../apps/web/lib/chat/service');
    for (let index = 0; index < ROUNDS; index += 1) {
      const id = raceMessageId(2, index);
      await seedOwnMessage(id, new Date(Date.UTC(2026, 9, 21, 0, index)));
      const [edited, deleted] = await Promise.all([
        settle(editChatMessage(partnerA1, THREAD_A_P1, id, { body: `race 同時編集 ${String(index)}` }, DEPS)),
        settle(deleteChatMessage(partnerA1, THREAD_A_P1, id, DEPS)),
      ]);
      // 削除は必ず通る（編集は削除の条件を変えない）。編集は先に確定すれば通り、後なら 404。
      expect(deleted.ok, `round ${String(index)}`).toBe(true);
      if (deleted.ok) expect(deleted.value.message.body).toBeNull();
      if (!edited.ok) expect(edited.error).toMatchObject({ httpStatus: 404 });

      const row = await admin.message.findUniqueOrThrow({ where: { id } });
      expect(row.body, `round ${String(index)}`).toBeNull();
      expect(row.deletedAt).not.toBeNull();
      expect(await admin.auditLog.count({ where: { action: 'message.delete', targetId: id } })).toBe(1);
    }
  });

  it('同じ発言を同時に 2 回削除しても、確定するのは 1 回（もう片方は 404）で監査も 1 件', async () => {
    const { deleteChatMessage } = await import('../../apps/web/lib/chat/service');
    const id = raceMessageId(3, 0);
    await seedOwnMessage(id, new Date('2026-10-22T00:00:00.000Z'));
    const results = await Promise.all([
      settle(deleteChatMessage(partnerA1, THREAD_A_P1, id, DEPS)),
      settle(deleteChatMessage(partnerA1, THREAD_A_P1, id, DEPS)),
    ]);
    expect(results.filter((result) => result.ok)).toHaveLength(1);
    expect(await admin.auditLog.count({ where: { action: 'message.delete', targetId: id } })).toBe(1);
  });
});

describe('🔴 ② #166 の 5: 既読位置は同時の要求で後退しない', () => {
  const older = raceMessageId(4, 0);
  const newer = raceMessageId(4, 1);

  beforeAll(async () => {
    await seedOwnMessage(older, new Date('2026-10-23T00:00:00.000Z'), 'race 古い発言');
    await seedOwnMessage(newer, new Date('2026-10-23T00:05:00.000Z'), 'race 新しい発言');
  });

  beforeEach(async () => {
    await admin.chatReadState.deleteMany({ where: { userId: USER_A_HOST, threadId: THREAD_A_P1 } });
  });

  afterAll(async () => {
    await admin.chatReadState.deleteMany({ where: { userId: USER_A_HOST, threadId: THREAD_A_P1 } });
    await admin.message.deleteMany({ where: { id: { in: [older, newer] } } });
  });

  async function storedPosition(): Promise<string | null | undefined> {
    const row = await admin.chatReadState.findFirst({ where: { userId: USER_A_HOST, threadId: THREAD_A_P1 } });
    return row === null ? undefined : row.lastReadMessageId;
  }

  it('決まった順: 古い位置の要求が行を待っている間に新しい位置が確定しても、古い位置で上書きされない', async () => {
    const { markChatRead } = await import('../../apps/web/lib/chat/read-state');
    await markChatRead(hostSales, THREAD_A_P1, older);
    // 一度戻しておく（古い位置の要求が「今より新しい」と判断できる状態にする）。
    await admin.chatReadState.updateMany({
      where: { userId: USER_A_HOST, threadId: THREAD_A_P1 },
      data: { lastReadSentAt: null, lastReadMessageId: null },
    });
    const holder = await locker.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT id FROM chat_read_states WHERE user_id = ${USER_A_HOST}::uuid AND thread_id = ${THREAD_A_P1}::uuid FOR UPDATE`;
        const marking = settle(markChatRead(hostSales, THREAD_A_P1, older));
        await waitForLockWaiter();
        await tx.$executeRaw`
          UPDATE chat_read_states SET last_read_sent_at = ${new Date('2026-10-23T00:05:00.000Z')}, last_read_message_id = ${newer}::uuid
           WHERE user_id = ${USER_A_HOST}::uuid AND thread_id = ${THREAD_A_P1}::uuid`;
        return { marking };
      },
      { timeout: 30_000 },
    );
    const marked = await holder.marking;
    expect(marked.ok).toBe(true);
    if (marked.ok) expect(marked.value.lastReadMessageId).toBe(newer);
    expect(await storedPosition()).toBe(newer);
  });

  it(`初回 INSERT と新旧の既読要求を競合させて ${String(ROUNDS)} 回: 両方成功し、1 行だけで新しい方が残る`, async () => {
    const { markChatRead } = await import('../../apps/web/lib/chat/read-state');
    for (let index = 0; index < ROUNDS; index += 1) {
      await admin.chatReadState.deleteMany({ where: { userId: USER_A_HOST, threadId: THREAD_A_P1 } });
      const pair = [
        () => settle(markChatRead(hostSales, THREAD_A_P1, newer)),
        () => settle(markChatRead(hostSales, THREAD_A_P1, older)),
      ];
      const ordered = index % 2 === 0 ? pair : [...pair].reverse();
      const pending: ReturnType<(typeof pair)[number]>[] = [];
      try {
        await locker.$transaction(async (tx) => {
          const [connection] = await tx.$queryRaw<{ pid: number }[]>`SELECT pg_backend_pid() AS pid`;
          if (!connection) throw new Error('初回 INSERT を保持する接続が見つからない');
          // 行が無いところから初回 INSERT を行い、確定を止めておく。
          // 両要求の INSERT がこの未確定行と競合するので、単なる同時実行の成否に依存しない。
          await tx.chatReadState.create({
            data: { tenantId: TENANT_A, userId: USER_A_HOST, threadId: THREAD_A_P1 },
          });
          for (const start of ordered) {
            pending.push(start());
            await waitForReadStateInsertWaiters(connection.pid, pending.length);
          }
          // 両方が一意制約で待った後にだけ確定する。ここで要求を await すると行き詰まる。
        }, { timeout: 30_000 });
      } finally {
        // 待ち合わせが失敗しても、ロックの解放後に開始済みの要求を回収する。
        await Promise.all(pending);
      }
      const results = await Promise.all(pending);
      // 🔴 初回作成の一意制約の競合で落ちない。
      expect(results.every((result) => result.ok), `round ${String(index)}`).toBe(true);
      expect(await storedPosition(), `round ${String(index)}`).toBe(newer);
      expect(await admin.chatReadState.count({ where: { userId: USER_A_HOST, threadId: THREAD_A_P1 } })).toBe(1);
    }
  });

  it('③ 「ここから未読にする」は従来どおり戻せる（既読を進める処理だけが後退しない）', async () => {
    const { markChatRead, markChatUnread } = await import('../../apps/web/lib/chat/read-state');
    await markChatRead(hostSales, THREAD_A_P1, newer);
    const back = await markChatUnread(hostSales, THREAD_A_P1, newer);
    expect(back.lastReadMessageId).toBe(older);
    expect(await storedPosition()).toBe(older);
    // ピン留め・ミュートは既読の更新で変わらない。
    const row = await admin.chatReadState.findFirstOrThrow({ where: { userId: USER_A_HOST, threadId: THREAD_A_P1 } });
    expect({ pinned: row.pinned, muted: row.muted }).toEqual({ pinned: false, muted: false });
  });
});
