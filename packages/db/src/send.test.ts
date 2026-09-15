// packages/db/src/send.test.ts
// T-09-05: `attempt_seq` の規律（docs/05 §10.1 / §10.6）が**関数の形**で表れていることを固定する。
//
// 🔴 型テスト（`@ts-expect-error`）と、DB を要らない実行時の検証だけを置く。実 DB での検証
//    （2 本の `UNIQUE` / RLS / CAS）は `tests/isolation/send-attempt.test.ts`。
//    `context.test.ts` と同じく、`@ts-expect-error` は `pnpm --filter @ses/db typecheck` で意味を持つ。
import { describe, expect, expectTypeOf, it } from 'vitest';
import { resolveTenantCtx, systemTenantCtx, type AuthenticatedTenantCtx, type SystemTenantCtx } from './context.js';
import {
  INITIAL_SEND_ATTEMPT_SEQ,
  nextSendAttemptSeq,
  reserveSendAttempt,
  SendAttemptOriginError,
  settleSendAttempt,
  type HumanTenantCtx,
  type SendAttemptOrigin,
} from './send.js';

const TENANT = '01930000-0000-7000-8000-0000000000a1';
const ENTITY = '01930000-0000-7000-8000-000000000111';
const NOW = new Date('2026-09-16T00:00:00.000Z');

const jobCtx: SystemTenantCtx = systemTenantCtx(TENANT, { queue: 'send.proposal', jobId: 'send.proposal:test' });

async function humanCtx(): Promise<AuthenticatedTenantCtx> {
  return resolveTenantCtx(
    {
      tenantId: TENANT,
      partnerCompanyId: null,
      userId: '01930000-0000-7000-8000-0000000000d1',
      role: 'SALES',
      lifecycleState: 'ACTIVE',
      partnerSuspendedAt: null,
      twoFactor: 'NOT_ENROLLED',
    },
    { deviceKind: 'desktop' },
  );
}

describe('🔴 型: 予約と確定は送信ジョブだけ、採番は人間だけ（docs/05 §10.2 ④⑥ / §10.6）', () => {
  it('型テスト（実行時には何もしない）', () => {
    type ReserveCtx = Parameters<typeof reserveSendAttempt>[0];
    type SettleCtx = Parameters<typeof settleSendAttempt>[0];
    type NextSeqCtx = Parameters<typeof nextSendAttemptSeq>[0];

    expectTypeOf<SystemTenantCtx>().toMatchTypeOf<ReserveCtx>();
    expectTypeOf<SystemTenantCtx>().toMatchTypeOf<SettleCtx>();
    // 🔴 利用者文脈（`job` を持たない）は予約・確定に渡せない。`apps/web` は `SUBMITTING` に入れられない。
    expectTypeOf<AuthenticatedTenantCtx>().not.toMatchTypeOf<ReserveCtx>();
    expectTypeOf<AuthenticatedTenantCtx>().not.toMatchTypeOf<SettleCtx>();
    // 🔴 ジョブ文脈は採番に渡せない（`HumanTenantCtx` は `job` を持てない）。ジョブは採番しない。
    expectTypeOf<SystemTenantCtx>().not.toMatchTypeOf<NextSeqCtx>();
    expectTypeOf<AuthenticatedTenantCtx>().toMatchTypeOf<HumanTenantCtx>();

    const typeOnly = (human: AuthenticatedTenantCtx): void => {
      // @ts-expect-error 🔴 利用者文脈では予約できない（SystemTenantCtx が要る）
      void reserveSendAttempt(human, { entityType: 'PROPOSAL', entityId: ENTITY, origin: { kind: 'INITIAL' }, now: NOW });
      // @ts-expect-error 🔴 ジョブ文脈では採番できない（人間の明示操作でしか attempt_seq は増えない）
      void nextSendAttemptSeq(jobCtx, { entityType: 'PROPOSAL', entityId: ENTITY });
      // @ts-expect-error 🔴 RESEND は requestedBy（人間）が必須
      const missingRequester: SendAttemptOrigin = { kind: 'RESEND', attemptSeq: 2 };
      // @ts-expect-error 🔴 INITIAL は attemptSeq を持たない（1 固定。ジョブが値を持ち込めない）
      const initialWithSeq: SendAttemptOrigin = { kind: 'INITIAL', attemptSeq: 2 };
      void missingRequester;
      void initialWithSeq;
    };
    expect(typeof typeOnly).toBe('function');
    expect(INITIAL_SEND_ATTEMPT_SEQ).toBe(1);
  });
});

describe('🔴 実行時: 由来（SendAttemptOrigin）の規律は DB に触れる前に検査される', () => {
  it('RESEND の attemptSeq が 2 未満なら SendAttemptOriginError（1 に丸めない）', async () => {
    await expect(
      reserveSendAttempt(jobCtx, {
        entityType: 'PROPOSAL',
        entityId: ENTITY,
        origin: { kind: 'RESEND', attemptSeq: 1, requestedBy: '01930000-0000-7000-8000-0000000000d1' },
        now: NOW,
      }),
    ).rejects.toThrow(SendAttemptOriginError);
  });

  it('RESEND の attemptSeq が整数でなければ SendAttemptOriginError', async () => {
    await expect(
      reserveSendAttempt(jobCtx, {
        entityType: 'PROPOSAL',
        entityId: ENTITY,
        origin: { kind: 'RESEND', attemptSeq: 2.5, requestedBy: '01930000-0000-7000-8000-0000000000d1' },
        now: NOW,
      }),
    ).rejects.toThrow(SendAttemptOriginError);
  });

  it('RESEND の requestedBy が空なら SendAttemptOriginError（NULL で書かない）', async () => {
    await expect(
      reserveSendAttempt(jobCtx, {
        entityType: 'PROPOSAL',
        entityId: ENTITY,
        origin: { kind: 'RESEND', attemptSeq: 2, requestedBy: '' },
        now: NOW,
      }),
    ).rejects.toThrow(SendAttemptOriginError);
  });

  it('🔴 採番は SYSTEM_ACTOR_ID（ジョブ文脈の利用者 ID）では実行時にも拒否される', async () => {
    // 型を握り潰して渡しても（`as`）、実行時の二重防御が止める。
    const smuggled = jobCtx as unknown as HumanTenantCtx;
    await expect(nextSendAttemptSeq(smuggled, { entityType: 'PROPOSAL', entityId: ENTITY })).rejects.toThrow(
      SendAttemptOriginError,
    );
  });

  it('対照: 人間の文脈は型としてそのまま採番に渡せる（DB は呼ばない）', async () => {
    const human = await humanCtx();
    const accepts = (ctx: HumanTenantCtx): string => ctx.userId;
    expect(accepts(human)).toBe('01930000-0000-7000-8000-0000000000d1');
  });
});
