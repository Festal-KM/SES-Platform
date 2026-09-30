// apps/web/lib/home/action-availability.test.ts
// 🔴 `操作` 列の不能条件 4 つ（T-22-09 / docs/05 §6.11.2 / `docs/04` 申し送り 22 ⑤ / `U-10`）。
//
// 固定するもの:
//   ① 判定順が `requireExecutable` と同じ（テナント → 取引先 → ロール → 送信ドメイン）
//   ② 🔴 ①② は**全 4 kind**に効き、④（送信ドメイン）は **`RESEND` だけ**に効く
//   ③ 🔴 **`enabled === false` のとき `reasonKey` が必ず非 null**（理由の無い不能を作らない）
//   ④ 🔴 **代理閲覧では全 4 kind が `false`**（部品側で分岐しない。`CLAUDE.md` §10.5）
//   ⑤ 🔴 ロールの判定は `deriveMainCapabilities` の再利用であり、2 つ目のロール判定表を作っていない
import { describe, expect, it } from 'vitest';
import { TENANT_ROLES, type TenantRole } from '@ses/db';
import { TENANT_LIFECYCLE_STATES, type TenantLifecycleState } from '@ses/domain';
import {
  ACTION_QUEUE_ACTION_KINDS,
  actionQueueActionAvailability,
  type ActionQueueAvailabilityFacts,
} from './action-availability';
import { deriveMainCapabilities } from './capabilities';

const BASE: ActionQueueAvailabilityFacts = {
  role: 'SALES',
  lifecycleState: 'ACTIVE',
  partnerSuspendedAt: null,
  sendingDomainUnverified: false,
};

function availability(overrides: Partial<ActionQueueAvailabilityFacts> = {}) {
  return actionQueueActionAvailability({ ...BASE, ...overrides });
}

describe('🔴 4 kind の可否を毎回全量返す', () => {
  it('キーは 4 つ（`APPROVE` / `FIX` / `RESEND` / `RESPOND`）', () => {
    expect(Object.keys(availability()).sort()).toEqual(['APPROVE', 'FIX', 'RESEND', 'RESPOND']);
    expect(ACTION_QUEUE_ACTION_KINDS).toEqual(['APPROVE', 'FIX', 'RESEND', 'RESPOND']);
  });

  it('平常時（`ACTIVE` / 実行できるロール / ドメイン検証済み）は全部可で理由が `null`', () => {
    for (const entry of Object.values(availability())) {
      expect(entry).toEqual({ enabled: true, reasonKey: null });
    }
  });
});

describe('🔴 ① テナントのライフサイクル（全 4 kind に効く）', () => {
  it('`SANDBOX` / `ACTIVE` は可、`SUSPENDED` / `CLOSING` / `PURGED` は全部不能で理由が状態ごとに違う', () => {
    const reasons = new Set<string>();
    for (const state of TENANT_LIFECYCLE_STATES as readonly TenantLifecycleState[]) {
      const result = availability({ lifecycleState: state });
      const executable = state === 'SANDBOX' || state === 'ACTIVE';
      for (const kind of ACTION_QUEUE_ACTION_KINDS) {
        expect(result[kind].enabled, `${state}/${kind}`).toBe(executable);
      }
      if (!executable) {
        const reasonKey = result.APPROVE.reasonKey;
        expect(reasonKey, state).not.toBeNull();
        reasons.add(String(reasonKey));
      }
    }
    // 🔴 3 状態を 1 つの語に畳まない（`F-004 AC-9`。止まっている理由が違う）。
    expect(reasons.size).toBe(3);
  });
});

describe('🔴 ② 所属取引先の停止（全 4 kind に効き、テナントの停止とは別の理由）', () => {
  it('停止中は全部不能で、テナント停止と別の `reasonKey` を返す', () => {
    const suspended = availability({ role: 'PARTNER_SALES', partnerSuspendedAt: new Date('2026-09-20T00:00:00.000Z') });
    for (const kind of ACTION_QUEUE_ACTION_KINDS) {
      expect(suspended[kind].enabled, kind).toBe(false);
    }
    const tenantSuspended = availability({ lifecycleState: 'SUSPENDED' });
    expect(suspended.RESPOND.reasonKey).not.toBe(tenantSuspended.RESPOND.reasonKey);
  });

  it('🔴 判定順はテナントが先（より広い停止を先に返す。`requireExecutable` と同じ）', () => {
    const both = availability({ lifecycleState: 'SUSPENDED', partnerSuspendedAt: new Date() });
    expect(both.APPROVE.reasonKey).toBe(availability({ lifecycleState: 'SUSPENDED' }).APPROVE.reasonKey);
  });
});

describe('🔴 ③ ロール（`deriveMainCapabilities` の再利用。2 つ目の判定表を作らない）', () => {
  it('閲覧専用ロールでは全部不能、それ以外は可（`deriveMainCapabilities` と一致する）', () => {
    for (const role of TENANT_ROLES as readonly TenantRole[]) {
      const result = availability({ role });
      const allowed = deriveMainCapabilities(role).execute.approve;
      for (const kind of ACTION_QUEUE_ACTION_KINDS) {
        expect(result[kind].enabled, `${role}/${kind}`).toBe(allowed);
      }
      if (!allowed) expect(result.APPROVE.reasonKey, role).not.toBeNull();
    }
  });
});

describe('🔴 ④ 送信ドメイン未検証は `RESEND` だけに効く', () => {
  it('`RESEND` のみ不能になり、`APPROVE` / `FIX` / `RESPOND` は可のままである', () => {
    const result = availability({ sendingDomainUnverified: true });
    expect(result.RESEND.enabled).toBe(false);
    expect(result.RESEND.reasonKey).not.toBeNull();
    for (const kind of ['APPROVE', 'FIX', 'RESPOND'] as const) {
      expect(result[kind], kind).toEqual({ enabled: true, reasonKey: null });
    }
  });

  it('🔴 理由はロールの理由とも停止の理由とも別である（次の行動が違う）', () => {
    const domain = availability({ sendingDomainUnverified: true }).RESEND.reasonKey;
    expect(domain).not.toBe(availability({ role: 'VIEWER' }).RESEND.reasonKey);
    expect(domain).not.toBe(availability({ lifecycleState: 'SUSPENDED' }).RESEND.reasonKey);
  });
});

describe('🔴 ⑤ 代理閲覧では全 4 kind が false（部品側で分岐しない）', () => {
  it('他の条件がすべて可でも全部不能になり、専用の理由が出る', () => {
    const result = availability({ mode: 'IMPERSONATION' });
    for (const kind of ACTION_QUEUE_ACTION_KINDS) {
      expect(result[kind].enabled, kind).toBe(false);
      expect(result[kind].reasonKey, kind).not.toBeNull();
    }
    expect(result.APPROVE.reasonKey).not.toBe(availability({ lifecycleState: 'SUSPENDED' }).APPROVE.reasonKey);
  });

  it('`NORMAL`（主平面の既定）では通常の判定が働く', () => {
    expect(availability({ mode: 'NORMAL' }).APPROVE.enabled).toBe(true);
  });
});

describe('🔴 不能なら理由が必ず在る（型の保証を実行時にも確かめる）', () => {
  it('どの組み合わせでも `enabled === false` と `reasonKey === null` が同時に起きない', () => {
    for (const state of TENANT_LIFECYCLE_STATES as readonly TenantLifecycleState[]) {
      for (const role of TENANT_ROLES as readonly TenantRole[]) {
        for (const unverified of [true, false]) {
          for (const mode of ['NORMAL', 'IMPERSONATION'] as const) {
            const result = actionQueueActionAvailability({
              role,
              lifecycleState: state,
              partnerSuspendedAt: null,
              sendingDomainUnverified: unverified,
              mode,
            });
            for (const kind of ACTION_QUEUE_ACTION_KINDS) {
              const entry = result[kind];
              expect(entry.enabled || entry.reasonKey !== null, `${state}/${role}/${kind}`).toBe(true);
            }
          }
        }
      }
    }
  });
});
