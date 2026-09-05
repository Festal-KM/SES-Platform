// tests/isolation/email-dispatch.test.ts
// 🔴 T-04-03 の完了判定（docs/sprints/SP-04 §T-04-03）を実データで実証する:
//   ① `email.dispatch` の重複起動で **1 通のみ**（`EmailDispatch.dedupeKey` の `UNIQUE`）
//   ② Webhook の**重複配信・順序逆転**（`WebhookDelivery.dedupeKey` + `processedAt` の CAS /
//      `EmailEvent` の 3 列 `UNIQUE`）
//   ③ **レート上限**（1 テナント 1 日 500 通）— 501 通目が外部へ発行されない
//
// 🔴 モックは `packages/connectors/src/mock/**` をそのまま使う（docs/05 §17.5。テスト専用の
//    別モックを書かない）。到達回数は `EmailSender.callCount()`（インタフェース側）から読む。
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createConnectors } from '@ses/connectors';
import type { Connectors } from '@ses/connectors';
import { InMemoryMinuteWindowCounter } from '@ses/connectors';
import {
  configureTenantDb,
  disconnectTenantDb,
  emailDispatchDedupeKey,
  incrementUsageCounter,
  markWebhookDeliveryProcessed,
  readEmailDispatch,
  recordEmailEvent,
  recordWebhookDelivery,
  reserveEmailDailyQuota,
  reserveEmailDispatch,
  systemTenantCtx,
  type SystemTenantCtx,
} from '@ses/db';
import { createUnextendedClient, type UnextendedClient } from '@ses/db/testing';
import { performEmailSend } from '../../apps/worker/src/jobs/email-send.js';
import { TENANT_A, TENANT_B } from './support/fixtures.js';
import { startIsolationDatabase, type IsolationDatabase } from './support/postgres.js';

const SETUP_TIMEOUT_MS = 600_000;
const NOW = new Date('2026-09-05T03:00:00.000Z');
/** JST の暦日（docs/05 §8.7「日 = 暦日」）。 */
const PERIOD_KEY = '2026-09-05';

/**
 * 🔴 `EMAIL_DAILY_LIMIT_PER_TENANT` の既定値（`packages/config/src/schema.ts`）。
 *    値の出所は `packages/config` であり、その既定が 500 であることは
 *    `packages/config/src/schema.test.ts` が固定する。ここでは「上限に達したら送らない」
 *    という振る舞いだけを実データで確かめる。
 */
const DAILY_LIMIT = 500;
const MINUTE_LIMIT = 30;

const JOB = { queue: 'email.dispatch', jobId: 'email.dispatch:test' } as const;

let database: IsolationDatabase;
let admin: UnextendedClient;
let ctxA: SystemTenantCtx;
let ctxB: SystemTenantCtx;
let connectors: Connectors;

function deps(overrides: Record<string, unknown> = {}) {
  return {
    emailSender: connectors.email,
    // 🔴 全モックの選択（`development` / `demo` 相当）なので記録は `MOCKED` になる。
    emailImplementationKind: 'mock' as const,
    minuteWindow: new InMemoryMinuteWindowCounter(),
    dailyLimit: DAILY_LIMIT,
    minuteLimit: MINUTE_LIMIT,
    // 分類 1 なので共通ドメインでよい（`F-001 AC-5`）。
    resolveSendingDomain: async () => null,
    now: () => NOW,
    ...overrides,
  } as never;
}

async function reserve(ctx: SystemTenantCtx, targetId: string) {
  return reserveEmailDispatch(ctx, {
    recipientClass: 'HOST_MEMBER',
    recipientEmail: 'owner@example.co.jp',
    templateKey: 'TENANT_CLOSING_NOTICE',
    dedupeKey: emailDispatchDedupeKey({
      templateKey: 'TENANT_CLOSING_NOTICE',
      targetId,
      recipientEmail: 'owner@example.co.jp',
    }),
    observedAt: NOW,
  });
}

beforeAll(async () => {
  database = await startIsolationDatabase();
  admin = createUnextendedClient(database.superuserUrl);
  configureTenantDb({ datasourceUrl: database.tenantUrl });
  ctxA = systemTenantCtx(TENANT_A, JOB);
  ctxB = systemTenantCtx(TENANT_B, JOB);
  connectors = createConnectors({
    email: 'mock',
    objectStore: 'mock',
    malwareScanner: 'mock',
    esign: 'mock',
    billing: 'mock',
  });
}, SETUP_TIMEOUT_MS);

afterAll(async () => {
  await disconnectTenantDb();
  await admin?.$disconnect();
  await database?.stop();
}, SETUP_TIMEOUT_MS);

beforeEach(async () => {
  // 各ケースを独立させる（`dedupeKey` はグローバル `UNIQUE` であり、日次カウンタも共有される）。
  await admin.emailDispatch.deleteMany({});
  await admin.usageCounter.deleteMany({ where: { metric: 'EMAIL_COUNT' } });
  await admin.webhookDelivery.deleteMany({});
  await admin.emailEvent.deleteMany({});
  connectors = createConnectors({
    email: 'mock',
    objectStore: 'mock',
    malwareScanner: 'mock',
    esign: 'mock',
    billing: 'mock',
  });
});

describe('🔴 ① 重複起動で 1 通のみ（docs/05 §9.4「再試行しても 1 通」）', () => {
  it('同じ dedupeKey の予約は同じ行に収束する（2 行目を作らない）', async () => {
    const first = await reserve(ctxA, 'target-1');
    const second = await reserve(ctxA, 'target-1');

    expect(first.created).toBe(true);
    expect(second.created).toBe(false);
    expect(second.dispatchId).toBe(first.dispatchId);
    expect(await admin.emailDispatch.count({ where: { tenantId: TENANT_A } })).toBe(1);
  });

  it('🔴 同じ行に対してジョブを 2 回走らせても、外部への送信は 1 回だけ', async () => {
    const reservation = await reserve(ctxA, 'target-2');
    const d = deps();

    const first = await performEmailSend(d, {
      ctx: ctxA,
      dispatch: (await readEmailDispatch(ctxA, reservation.dispatchId))!,
      params: {},
    });
    const second = await performEmailSend(d, {
      ctx: ctxA,
      dispatch: (await readEmailDispatch(ctxA, reservation.dispatchId))!,
      params: {},
    });

    expect(first.kind).toBe('MOCKED');
    expect(second).toEqual({ kind: 'ALREADY_SETTLED', status: 'MOCKED' });
    // 🔴 モックの到達回数（docs/05 §13.2 / §17.4 の二重検証と同じ読み方）。
    expect(connectors.email.callCount()).toBe(1);

    const row = await admin.emailDispatch.findFirst({ where: { id: reservation.dispatchId } });
    expect(row?.status).toBe('MOCKED');
    expect(row?.sentAt).not.toBeNull();
  });

  it('🔴 並行して 5 回予約しても行は 1 つ（ON CONFLICT DO NOTHING の原子性）', async () => {
    const results = await Promise.all(Array.from({ length: 5 }, () => reserve(ctxA, 'target-3')));
    const ids = new Set(results.map((result) => result.dispatchId));
    expect(ids.size).toBe(1);
    expect(results.filter((result) => result.created)).toHaveLength(1);
  });

  it('🔴 他テナントの dedupeKey と衝突したら、握り潰さず例外にする（UNIQUE はグローバル）', async () => {
    await reserve(ctxA, 'shared-target');
    await expect(reserve(ctxB, 'shared-target')).rejects.toThrow(/dedupeKey/);
  });
});

describe('🔴 ③ レート上限（docs/05 §8.7 / F-027 AC-2）', () => {
  it('🔴 500 通目は送れて、501 通目は外部へ発行されない', async () => {
    // 499 通送信済みの状態を作る（500 回の往復をせずに境界を再現する）。
    await incrementUsageCounter(ctxA, {
      periodKind: 'DAY',
      metric: 'EMAIL_COUNT',
      amount: String(DAILY_LIMIT - 1),
      observedAt: NOW,
    });

    const d = deps();
    const five00 = await reserve(ctxA, 'target-500');
    const outcome500 = await performEmailSend(d, {
      ctx: ctxA,
      dispatch: (await readEmailDispatch(ctxA, five00.dispatchId))!,
      params: {},
    });
    expect(outcome500.kind).toBe('MOCKED');
    expect(connectors.email.callCount()).toBe(1);

    const five01 = await reserve(ctxA, 'target-501');
    const outcome501 = await performEmailSend(d, {
      ctx: ctxA,
      dispatch: (await readEmailDispatch(ctxA, five01.dispatchId))!,
      params: {},
    });

    // 🔴 完了判定: 501 通目が外部へ発行されない。
    expect(outcome501).toEqual({ kind: 'RATE_LIMITED', dailyLimit: DAILY_LIMIT });
    expect(connectors.email.callCount()).toBe(1);

    const row = await admin.emailDispatch.findFirst({ where: { id: five01.dispatchId } });
    // 🔴 障害（FAILED）でも保留（HELD_*）でもない。テナントの利用量として区別する（§8.3-Q ⑥）。
    expect(row?.status).toBe('SUPPRESSED');
    expect(row?.failureReason).toBe('RATE_LIMIT');
    expect(row?.heldAt).toBeNull();
  });

  it('🔴 分次上限に達したら DEFERRED になり、状態は QUEUED のまま（待機は状態にしない）', async () => {
    const minuteWindow = new InMemoryMinuteWindowCounter();
    for (let i = 0; i < MINUTE_LIMIT; i += 1) {
      await minuteWindow.record(TENANT_A, new Date(NOW.getTime() - 10_000));
    }
    const reservation = await reserve(ctxA, 'target-minute');
    const outcome = await performEmailSend(deps({ minuteWindow }), {
      ctx: ctxA,
      dispatch: (await readEmailDispatch(ctxA, reservation.dispatchId))!,
      params: {},
    });

    expect(outcome.kind).toBe('DEFERRED');
    expect(connectors.email.callCount()).toBe(0);
    const row = await admin.emailDispatch.findFirst({ where: { id: reservation.dispatchId } });
    expect(row?.status).toBe('QUEUED');
  });

  it('🔴 日次枠の予約は原子的（並行 20 件で上限 5 を超えない）', async () => {
    const results = await Promise.all(
      Array.from({ length: 20 }, () => reserveEmailDailyQuota(ctxA, { limit: 5, observedAt: NOW })),
    );
    expect(results.filter((result) => result.allowed)).toHaveLength(5);

    const counter = await admin.usageCounter.findFirst({
      where: { tenantId: TENANT_A, periodKind: 'DAY', periodKey: PERIOD_KEY, metric: 'EMAIL_COUNT' },
    });
    expect(Number(counter?.value)).toBe(5);
  });

  it('🔴 上限はテナントごと（他テナントの送信で枠が減らない）', async () => {
    await incrementUsageCounter(ctxA, {
      periodKind: 'DAY',
      metric: 'EMAIL_COUNT',
      amount: String(DAILY_LIMIT),
      observedAt: NOW,
    });
    expect((await reserveEmailDailyQuota(ctxA, { limit: DAILY_LIMIT, observedAt: NOW })).allowed).toBe(
      false,
    );
    expect((await reserveEmailDailyQuota(ctxB, { limit: DAILY_LIMIT, observedAt: NOW })).allowed).toBe(
      true,
    );
  });
});

describe('🔴 テナント境界（F-004 AC-1）', () => {
  it('他テナントの EmailDispatch は読めない（存在しないのと同じ）', async () => {
    const reservation = await reserve(ctxA, 'target-boundary');
    expect(await readEmailDispatch(ctxA, reservation.dispatchId)).not.toBeNull();
    expect(await readEmailDispatch(ctxB, reservation.dispatchId)).toBeNull();
  });
});

describe('🔴 ② Webhook の重複配信・順序逆転（docs/05 §8.5 / docs/03 §3.2.5）', () => {
  const payload = { sesMessageId: 'm-1', eventType: 'Bounce', recipientHashes: ['a'.repeat(64)] };

  it('同じ dedupeKey の受信は 1 行に収束し、2 回目は duplicate になる', async () => {
    const first = await recordWebhookDelivery({
      provider: 'ses',
      externalEventId: 'm-1',
      dedupeKey: 'ses:m-1:Bounce:2026-09-05T03:00:00.000Z',
      payload,
      receivedAt: NOW,
    });
    const second = await recordWebhookDelivery({
      provider: 'ses',
      externalEventId: 'm-1',
      dedupeKey: 'ses:m-1:Bounce:2026-09-05T03:00:00.000Z',
      payload,
      receivedAt: new Date(NOW.getTime() + 5_000),
    });

    expect(first.duplicate).toBe(false);
    expect(second.duplicate).toBe(true);
    expect(second.deliveryId).toBe(first.deliveryId);
    expect(await admin.webhookDelivery.count()).toBe(1);
  });

  it('🔴 processedAt の CAS は 1 回しか成功しない（重複配信で 2 回処理しない）', async () => {
    const record = await recordWebhookDelivery({
      provider: 'ses',
      externalEventId: 'm-2',
      dedupeKey: 'ses:m-2:Bounce:2026-09-05T03:00:00.000Z',
      payload,
      receivedAt: NOW,
    });
    expect(await markWebhookDeliveryProcessed(record.deliveryId, NOW)).toBe(true);
    expect(await markWebhookDeliveryProcessed(record.deliveryId, NOW)).toBe(false);
  });

  it('🔴 同じイベントの重複記録は 1 行（EmailEvent の 3 列 UNIQUE）', async () => {
    const event = {
      tenantId: null,
      sesMessageId: 'm-3',
      eventType: 'Bounce' as const,
      occurredAt: new Date('2026-09-05T03:00:00.000Z'),
      payload,
    };
    expect(await recordEmailEvent(event)).toBe(true);
    expect(await recordEmailEvent(event)).toBe(false);
    expect(await admin.emailEvent.count({ where: { sesMessageId: 'm-3' } })).toBe(1);
  });

  it('🔴 順序逆転: 後から届いた古いイベントが新しい行を上書きしない', async () => {
    const newer = new Date('2026-09-05T03:00:00.000Z');
    const older = new Date('2026-09-05T02:00:00.000Z');
    await recordEmailEvent({
      tenantId: null,
      sesMessageId: 'm-4',
      eventType: 'Bounce',
      occurredAt: newer,
      payload: { ...payload, marker: 'newer' },
    });
    await recordEmailEvent({
      tenantId: null,
      sesMessageId: 'm-4',
      eventType: 'Bounce',
      occurredAt: older,
      payload: { ...payload, marker: 'older' },
    });

    const rows = await admin.emailEvent.findMany({
      where: { sesMessageId: 'm-4' },
      orderBy: { occurredAt: 'asc' },
    });
    // 2 行が独立して残り、どちらの内容も相手に潰されていない。
    expect(rows).toHaveLength(2);
    expect((rows[0]?.payload as { marker: string }).marker).toBe('older');
    expect((rows[1]?.payload as { marker: string }).marker).toBe('newer');
  });

  it('種別が違えば別の行（バウンスと苦情を潰し合わない）', async () => {
    const occurredAt = new Date('2026-09-05T03:00:00.000Z');
    await recordEmailEvent({ tenantId: null, sesMessageId: 'm-5', eventType: 'Bounce', occurredAt, payload });
    await recordEmailEvent({
      tenantId: null,
      sesMessageId: 'm-5',
      eventType: 'Complaint',
      occurredAt,
      payload,
    });
    expect(await admin.emailEvent.count({ where: { sesMessageId: 'm-5' } })).toBe(2);
  });
});
