// tests/isolation/send-attempt.test.ts
// 🔴 T-09-05（`docs/sprints/SP-09-proposal-flow.md` §T-09-05）: **`SendAttempt` の 2 本の `UNIQUE` と冪等性キーの規約が
//    実 DB（RLS 付き）で効いている**ことを証明する。docs/05 §10.1 / §10.2 ④⑥ / §10.6 / docs/03 §4.7 / `CLAUDE.md` §3.4 /
//    §6.5「T-09-05 の実装の決着」。
//
// ---------------------------------------------------------------------------
// 🔴 何を固定するか
// ---------------------------------------------------------------------------
//   ① 同一 `(entity_type, entity_id, attempt_seq)` の 2 回目の INSERT が `UNIQUE` で落ち、`reserveSendAttempt` は
//      例外ではなく `ALREADY_RESERVED` を返す（外部 API を呼ばずに終了できる。§10.2 ④）。行は 1 つのまま
//   ② `UNIQUE(idempotency_key)` も**独立に**効く（三つ組が違ってもキーが同じなら落ちる / キーが違っても三つ組が同じなら落ちる）
//   ③ 同時 2 回の `reserveSendAttempt` で**1 回だけ**トークンが返る（`ON CONFLICT DO NOTHING` の原子性）
//   ④ `settleSendAttempt` は `RESERVED` からのみ確定し、2 回目は `ALREADY_SETTLED`（上書きしない。確定は 1 回）
//   ⑤ 他テナントのジョブ文脈・同一テナントの取引先文脈からは行が見えない（RLS C2 HOST_ONLY）。他テナントからの確定は
//      `NOT_FOUND` で行は動かず、他テナントからの同じ対象の予約は `SendAttemptConflictError`（黙って送らない）
//   ⑥ 人間の再送で `attempt_seq` が 2 になり `idempotency_key` が `proposal:<id>:2`、`requested_by` に人間が入る。
//      🔴 ジョブの再実行（同じ `SendAttemptOrigin`）では `attempt_seq` が増えない（確定済みでも `ALREADY_RESERVED`）
//
// 🔴 外部 API は 1 つも呼ばない（`SendAttempt` の予約と確定だけを検証する。送信ジョブの配線は T-09-06）。
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  configureTenantDb,
  disconnectTenantDb,
  INITIAL_SEND_ATTEMPT_SEQ,
  listSendAttempts,
  nextSendAttemptSeq,
  readSendAttempt,
  reserveSendAttempt,
  resolveTenantCtx,
  SendAttemptConflictError,
  settleSendAttempt,
  systemTenantCtx,
  type AuthenticatedTenantCtx,
  type SendAttemptReservation,
  type SystemTenantCtx,
} from '@ses/db';
import { createUnextendedClient, type UnextendedClient } from '@ses/db/testing';
import { idempotencyKey } from '../../packages/domain/src/idempotency.js';
import {
  PARTNER_A1,
  TENANT_A,
  TENANT_B,
  USER_A_HOST,
  USER_A_PARTNER,
  USER_B_HOST,
} from './support/fixtures.js';
import { startIsolationDatabase, type IsolationDatabase } from './support/postgres.js';

const SETUP_TIMEOUT_MS = 600_000;
const NOW = new Date('2026-09-16T01:00:00.000Z');
const SETTLED_AT = new Date('2026-09-16T01:00:05.000Z');
const JOB = { queue: 'send.proposal', jobId: 'send.proposal:t0905' } as const;
/** PostgreSQL の一意制約違反（Prisma は P2002 に写像する）。 */
const UNIQUE_VIOLATION = /Unique constraint failed|23505|P2002/;

let database: IsolationDatabase;
let admin: UnextendedClient;
let jobA: SystemTenantCtx;
let jobB: SystemTenantCtx;
let humanA: AuthenticatedTenantCtx;
let humanB: AuthenticatedTenantCtx;
let partnerA1: AuthenticatedTenantCtx;

function proposalTarget(): { readonly entityType: 'PROPOSAL'; readonly entityId: string } {
  return { entityType: 'PROPOSAL', entityId: randomUUID() };
}

/** 🔴 トークンの型は `@ses/db` の API から導く（`as` で偽造しない。生成経路は `reserveSendAttempt` だけ）。 */
type ReservedToken = Extract<SendAttemptReservation, { outcome: 'RESERVED' }>['token'];

function expectReserved(reservation: SendAttemptReservation): ReservedToken {
  if (reservation.outcome !== 'RESERVED') {
    throw new Error(`RESERVED のはずが ${reservation.outcome} でした`);
  }
  return reservation.token;
}

async function reserveInitial(ctx: SystemTenantCtx, target: { entityType: 'PROPOSAL' | 'CONTRACT'; entityId: string }) {
  return reserveSendAttempt(ctx, { ...target, origin: { kind: 'INITIAL' }, now: NOW });
}

beforeAll(async () => {
  database = await startIsolationDatabase();
  admin = createUnextendedClient(database.superuserUrl);
  configureTenantDb({ datasourceUrl: database.tenantUrl });
  jobA = systemTenantCtx(TENANT_A, JOB);
  jobB = systemTenantCtx(TENANT_B, JOB);
  const meta = { deviceKind: 'desktop' } as const;
  humanA = await resolveTenantCtx(
    {
      tenantId: TENANT_A,
      partnerCompanyId: null,
      userId: USER_A_HOST,
      role: 'SALES',
      lifecycleState: 'ACTIVE',
      partnerSuspendedAt: null,
      twoFactor: 'NOT_ENROLLED',
    },
    meta,
  );
  humanB = await resolveTenantCtx(
    {
      tenantId: TENANT_B,
      partnerCompanyId: null,
      userId: USER_B_HOST,
      role: 'SALES',
      lifecycleState: 'ACTIVE',
      partnerSuspendedAt: null,
      twoFactor: 'NOT_ENROLLED',
    },
    meta,
  );
  partnerA1 = await resolveTenantCtx(
    {
      tenantId: TENANT_A,
      partnerCompanyId: PARTNER_A1,
      userId: USER_A_PARTNER,
      role: 'PARTNER_SALES',
      lifecycleState: 'ACTIVE',
      partnerSuspendedAt: null,
      twoFactor: 'NOT_ENROLLED',
    },
    meta,
  );
}, SETUP_TIMEOUT_MS);

afterAll(async () => {
  await disconnectTenantDb();
  await admin?.$disconnect();
  await database?.stop();
}, SETUP_TIMEOUT_MS);

beforeEach(async () => {
  await admin.sendAttempt.deleteMany({});
});

describe('🔴 ① 同一 (entity_type, entity_id, attempt_seq) の 2 回目は UNIQUE で落ち、ALREADY_RESERVED になる（docs/05 §10.2 ④）', () => {
  it('1 回目はトークン（唯一の生成経路）、2 回目は ALREADY_RESERVED。行は 1 つのまま', async () => {
    const target = proposalTarget();

    const first = await reserveInitial(jobA, target);
    const token = expectReserved(first);
    expect(token).toEqual({
      idempotencyKey: `proposal:${target.entityId}:1`,
      attemptSeq: INITIAL_SEND_ATTEMPT_SEQ,
      entityType: 'PROPOSAL',
      entityId: target.entityId,
    });
    // 🔴 決定的（`@ses/domain` の 1 実装と一致）。
    expect(token.idempotencyKey).toBe(idempotencyKey('PROPOSAL', target.entityId, 1));

    const second = await reserveInitial(jobA, target);
    expect(second.outcome).toBe('ALREADY_RESERVED');
    if (second.outcome !== 'ALREADY_RESERVED') throw new Error('unreachable');
    expect(second.existing.attemptSeq).toBe(1);
    expect(second.existing.status).toBe('RESERVED');
    expect(second.existing.idempotencyKey).toBe(token.idempotencyKey);

    const rows = await admin.sendAttempt.findMany({ where: { entityId: target.entityId } });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      tenantId: TENANT_A,
      entityType: 'PROPOSAL',
      attemptSeq: 1,
      idempotencyKey: token.idempotencyKey,
      status: 'RESERVED',
      requestedBy: null,
      settledAt: null,
    });
    expect(rows[0]?.startedAt.toISOString()).toBe(NOW.toISOString());
  });

  it('🔴 三つ組が同じでキーだけ違う行は DB の UNIQUE(entity_type, entity_id, attempt_seq) が落とす（管理接続からでも）', async () => {
    const target = proposalTarget();
    expectReserved(await reserveInitial(jobA, target));

    await expect(
      admin.sendAttempt.create({
        data: {
          tenantId: TENANT_A,
          entityType: 'PROPOSAL',
          entityId: target.entityId,
          attemptSeq: 1,
          idempotencyKey: `proposal:${target.entityId}:1:forged`,
          status: 'RESERVED',
        },
      }),
    ).rejects.toThrow(UNIQUE_VIOLATION);
    expect(await admin.sendAttempt.count({ where: { entityId: target.entityId } })).toBe(1);
  });

  it('CHECK: entity_type は 3 値（CONTRACT でも予約でき、キーは contract:<id>:1）', async () => {
    const target = { entityType: 'CONTRACT' as const, entityId: randomUUID() };
    const token = expectReserved(await reserveInitial(jobA, target));
    expect(token.idempotencyKey).toBe(`contract:${target.entityId}:1`);
  });
});

describe('🔴 ② UNIQUE(idempotency_key) は三つ組の UNIQUE と独立に効く（docs/05 §10.1 の 2 本）', () => {
  it('三つ組が違ってもキーが同じなら DB が落とす（管理接続からでも）', async () => {
    const target = proposalTarget();
    const token = expectReserved(await reserveInitial(jobA, target));

    await expect(
      admin.sendAttempt.create({
        data: {
          tenantId: TENANT_A,
          entityType: 'PROPOSAL',
          entityId: target.entityId,
          attemptSeq: 99,
          idempotencyKey: token.idempotencyKey,
          status: 'RESERVED',
        },
      }),
    ).rejects.toThrow(UNIQUE_VIOLATION);
    expect(await admin.sendAttempt.count({ where: { entityId: target.entityId } })).toBe(1);
  });

  it('🔴 キーだけ揃えた行が先にあると、予約は三つ組が空いていても ALREADY_RESERVED（キーの UNIQUE が主体で止める）', async () => {
    const target = proposalTarget();
    // 三つ組は (PROPOSAL, id, 99) だがキーは attempt_seq 1 のもの、という「片方だけ揃えた」行。
    await admin.sendAttempt.create({
      data: {
        tenantId: TENANT_A,
        entityType: 'PROPOSAL',
        entityId: target.entityId,
        attemptSeq: 99,
        idempotencyKey: `proposal:${target.entityId}:1`,
        status: 'SUCCEEDED',
        settledAt: SETTLED_AT,
      },
    });

    const reservation = await reserveInitial(jobA, target);
    expect(reservation.outcome).toBe('ALREADY_RESERVED');
    if (reservation.outcome !== 'ALREADY_RESERVED') throw new Error('unreachable');
    expect(reservation.existing.attemptSeq).toBe(99);
    expect(reservation.existing.status).toBe('SUCCEEDED');
    expect(await admin.sendAttempt.count({ where: { entityId: target.entityId } })).toBe(1);
  });
});

describe('🔴 ③ 同時 2 回の予約で 1 回だけトークンが返る（ON CONFLICT DO NOTHING の原子性）', () => {
  it('並行 2 回: RESERVED が 1、ALREADY_RESERVED が 1、行は 1', async () => {
    const target = proposalTarget();
    const results = await Promise.all([reserveInitial(jobA, target), reserveInitial(jobA, target)]);
    const outcomes = results.map((r) => r.outcome).sort();
    expect(outcomes).toEqual(['ALREADY_RESERVED', 'RESERVED']);
    expect(await admin.sendAttempt.count({ where: { entityId: target.entityId } })).toBe(1);
  });

  it('並行 5 回でもトークンは 1 つだけ', async () => {
    const target = proposalTarget();
    const results = await Promise.all(Array.from({ length: 5 }, () => reserveInitial(jobA, target)));
    expect(results.filter((r) => r.outcome === 'RESERVED')).toHaveLength(1);
    expect(results.filter((r) => r.outcome === 'ALREADY_RESERVED')).toHaveLength(4);
    expect(await admin.sendAttempt.count({ where: { entityId: target.entityId } })).toBe(1);
  });
});

describe('🔴 ④ 確定は RESERVED からのみ。2 回目は ALREADY_SETTLED（docs/05 §10.2 ⑥ / §10.6）', () => {
  it('SUCCEEDED: external_id と settled_at が入り、2 回目（FAILED）は上書きされない', async () => {
    const target = proposalTarget();
    const token = expectReserved(await reserveInitial(jobA, target));

    const first = await settleSendAttempt(jobA, token, { status: 'SUCCEEDED', externalId: 'ses-message-1', now: SETTLED_AT });
    expect(first).toEqual({ outcome: 'SETTLED' });

    const second = await settleSendAttempt(jobA, token, {
      status: 'FAILED',
      failureKind: 'PROVIDER_REJECTED',
      failureDetail: 'later',
      now: SETTLED_AT,
    });
    expect(second).toEqual({ outcome: 'ALREADY_SETTLED', status: 'SUCCEEDED' });

    const row = await admin.sendAttempt.findFirstOrThrow({ where: { entityId: target.entityId } });
    expect(row).toMatchObject({
      status: 'SUCCEEDED',
      externalId: 'ses-message-1',
      failureKind: null,
      failureDetail: null,
    });
    expect(row.settledAt?.toISOString()).toBe(SETTLED_AT.toISOString());
  });

  it('FAILED: failure_kind / failure_detail が入り、failure_detail は 500 文字で切られる', async () => {
    const target = proposalTarget();
    const token = expectReserved(await reserveInitial(jobA, target));

    const outcome = await settleSendAttempt(jobA, token, {
      status: 'FAILED',
      failureKind: 'PROVIDER_REJECTED',
      failureDetail: 'x'.repeat(1_000),
      now: SETTLED_AT,
    });
    expect(outcome).toEqual({ outcome: 'SETTLED' });

    const row = await admin.sendAttempt.findFirstOrThrow({ where: { entityId: target.entityId } });
    expect(row.status).toBe('FAILED');
    expect(row.failureKind).toBe('PROVIDER_REJECTED');
    expect(row.failureDetail).toHaveLength(500);
    expect(row.externalId).toBeNull();
  });

  it('🔴 UNKNOWN（応答不明）は隔離状態として残り、RESERVED に戻す手段が無い', async () => {
    const target = proposalTarget();
    const token = expectReserved(await reserveInitial(jobA, target));

    expect(await settleSendAttempt(jobA, token, { status: 'UNKNOWN', failureKind: 'TIMEOUT', now: SETTLED_AT })).toEqual({
      outcome: 'SETTLED',
    });
    // 確定後は SUCCEEDED にも FAILED にも書き換えられない。
    expect(
      await settleSendAttempt(jobA, token, { status: 'SUCCEEDED', externalId: 'late-arrival', now: SETTLED_AT }),
    ).toEqual({ outcome: 'ALREADY_SETTLED', status: 'UNKNOWN' });

    const row = await admin.sendAttempt.findFirstOrThrow({ where: { entityId: target.entityId } });
    expect(row).toMatchObject({ status: 'UNKNOWN', failureKind: 'TIMEOUT', externalId: null });
  });

  it('確定後に同じ試行を再予約しても ALREADY_RESERVED（確定済みの行が返る。行は増えない）', async () => {
    const target = proposalTarget();
    const token = expectReserved(await reserveInitial(jobA, target));
    await settleSendAttempt(jobA, token, { status: 'SUCCEEDED', externalId: 'ses-message-2', now: SETTLED_AT });

    const again = await reserveInitial(jobA, target);
    expect(again.outcome).toBe('ALREADY_RESERVED');
    if (again.outcome !== 'ALREADY_RESERVED') throw new Error('unreachable');
    expect(again.existing.status).toBe('SUCCEEDED');
    expect(await admin.sendAttempt.count({ where: { entityId: target.entityId } })).toBe(1);
  });
});

describe('🔴 ⑤ 他テナント / 取引先文脈からは行が見えない（RLS C2 HOST_ONLY。CLAUDE.md §3.1）', () => {
  it('他テナントのジョブ文脈: 読めない・確定できない（NOT_FOUND）・行は RESERVED のまま', async () => {
    const target = proposalTarget();
    const token = expectReserved(await reserveInitial(jobA, target));

    expect(await readSendAttempt(jobB, { ...target, attemptSeq: 1 })).toBeNull();
    expect(await listSendAttempts(jobB, target)).toEqual([]);
    expect(
      await settleSendAttempt(jobB, token, { status: 'SUCCEEDED', externalId: 'stolen', now: SETTLED_AT }),
    ).toEqual({ outcome: 'NOT_FOUND' });

    const row = await admin.sendAttempt.findFirstOrThrow({ where: { entityId: target.entityId } });
    expect(row).toMatchObject({ tenantId: TENANT_A, status: 'RESERVED', externalId: null, settledAt: null });

    // 対照: 自テナントからは見える。
    expect((await readSendAttempt(jobA, { ...target, attemptSeq: 1 }))?.status).toBe('RESERVED');
    expect(await listSendAttempts(jobA, target)).toHaveLength(1);
  });

  it('🔴 他テナントからの同じ対象の予約は、見えない行と衝突するので SendAttemptConflictError（黙って送らない）', async () => {
    const target = proposalTarget();
    expectReserved(await reserveInitial(jobA, target));

    await expect(reserveInitial(jobB, target)).rejects.toThrow(SendAttemptConflictError);
    expect(await admin.sendAttempt.count({ where: { entityId: target.entityId } })).toBe(1);
  });

  it('同一テナントの取引先文脈: C2 は host のみ（読めない）', async () => {
    const target = proposalTarget();
    expectReserved(await reserveInitial(jobA, target));

    expect(await readSendAttempt(partnerA1, { ...target, attemptSeq: 1 })).toBeNull();
    expect(await listSendAttempts(partnerA1, target)).toEqual([]);
  });

  it('採番も文脈の母集団で決まる（他テナントの人間には他社の試行が見えず 1 が返る）', async () => {
    const target = proposalTarget();
    expectReserved(await reserveInitial(jobA, target));

    expect(await nextSendAttemptSeq(humanA, target)).toBe(2);
    expect(await nextSendAttemptSeq(humanB, target)).toBe(1);
  });
});

describe('🔴 ⑥ 再送で attempt_seq が 2 になり idempotency_key が proposal:<id>:2（docs/05 §10.1 / §10.6）', () => {
  it('人間の採番 → RESEND の予約で 2 行目ができ、requested_by に人間が入る', async () => {
    const target = proposalTarget();
    expect(await nextSendAttemptSeq(humanA, target)).toBe(INITIAL_SEND_ATTEMPT_SEQ);

    const first = expectReserved(await reserveInitial(jobA, target));
    await settleSendAttempt(jobA, first, { status: 'FAILED', failureKind: 'PROVIDER_REJECTED', now: SETTLED_AT });

    const nextSeq = await nextSendAttemptSeq(humanA, target);
    expect(nextSeq).toBe(2);

    const resend = await reserveSendAttempt(jobA, {
      ...target,
      origin: { kind: 'RESEND', attemptSeq: nextSeq, requestedBy: USER_A_HOST },
      now: SETTLED_AT,
    });
    const second = expectReserved(resend);
    expect(second.attemptSeq).toBe(2);
    expect(second.idempotencyKey).toBe(`proposal:${target.entityId}:2`);
    expect(second.idempotencyKey).not.toBe(first.idempotencyKey);

    const rows = await listSendAttempts(jobA, target);
    expect(rows.map((r) => [r.attemptSeq, r.idempotencyKey, r.status, r.requestedBy])).toEqual([
      [1, `proposal:${target.entityId}:1`, 'FAILED', null],
      [2, `proposal:${target.entityId}:2`, 'RESERVED', USER_A_HOST],
    ]);
    expect(await nextSendAttemptSeq(humanA, target)).toBe(3);
  });

  it('🔴 ジョブの再実行（同じ SendAttemptOrigin）では attempt_seq が増えない', async () => {
    const target = proposalTarget();
    const first = expectReserved(await reserveInitial(jobA, target));
    await settleSendAttempt(jobA, first, { status: 'UNKNOWN', failureKind: 'TIMEOUT', now: SETTLED_AT });

    // 初回のジョブが確定後にもう一度走っても、seq 2 は生まれない（採番は人間だけ）。
    const rerunInitial = await reserveInitial(jobA, target);
    expect(rerunInitial.outcome).toBe('ALREADY_RESERVED');

    const resendOrigin = { kind: 'RESEND', attemptSeq: 2, requestedBy: USER_A_HOST } as const;
    expectReserved(await reserveSendAttempt(jobA, { ...target, origin: resendOrigin, now: SETTLED_AT }));
    // 再送ジョブが再実行されても seq 3 は生まれない。
    const rerunResend = await reserveSendAttempt(jobA, { ...target, origin: resendOrigin, now: SETTLED_AT });
    expect(rerunResend.outcome).toBe('ALREADY_RESERVED');

    const rows = await admin.sendAttempt.findMany({ where: { entityId: target.entityId }, orderBy: { attemptSeq: 'asc' } });
    expect(rows.map((r) => r.attemptSeq)).toEqual([1, 2]);
  });

  it('採番を飛ばした RESEND（seq 3 を先に予約）でも UNIQUE は効き、後から来た seq 2 と衝突しない', async () => {
    // 想定外の順序でも「同じキーは 1 行」「別のキーは別の行」が崩れないことの対照。
    const target = proposalTarget();
    expectReserved(await reserveInitial(jobA, target));
    expectReserved(
      await reserveSendAttempt(jobA, { ...target, origin: { kind: 'RESEND', attemptSeq: 3, requestedBy: USER_A_HOST }, now: NOW }),
    );
    expectReserved(
      await reserveSendAttempt(jobA, { ...target, origin: { kind: 'RESEND', attemptSeq: 2, requestedBy: USER_A_HOST }, now: NOW }),
    );
    expect(await nextSendAttemptSeq(humanA, target)).toBe(4);
    expect(await admin.sendAttempt.count({ where: { entityId: target.entityId } })).toBe(3);
  });
});
