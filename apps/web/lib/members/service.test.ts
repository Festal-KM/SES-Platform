// apps/web/lib/members/service.test.ts
// 🔴 **並行実行に負けた場合の分岐**（条件付き UPDATE が 0 件だったときの振る舞い）を固定する。
//    T-04-09 iteration 2（`code-reviewer` 指摘 2 / 3）。
//
// なぜユニットで書くか: 「CAS が 0 件を返した」状態は、実 DB では**別のトランザクションを
// 同時に走らせて初めて**再現する。再現に成功するかどうかがタイミング依存になり、
// **通ったのか空振りしたのかが分からないテスト**になる。ここでは `withTenant` を差し替えて
// 0 件を確定的に注入し、分岐そのもの（何を返すか / 監査を書くか / どの例外か）を固定する。
//
// 🔴 実 DB 側の担保（RLS・監査・不変条件）は `tests/isolation/members.test.ts` が見る。
//    本ファイルはそちらの代わりではなく、**そちらで確定的に作れない 1 点**を埋めるものである。
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuthenticatedTenantCtx } from '@ses/db';

/**
 * 🔴 `vi.mock` のファクトリはホイストされるため、参照する可変状態は `vi.hoisted` で用意する
 *    （ファクトリ本体の評価時点では、テストファイルの `const` はまだ初期化されていない）。
 */
const state = vi.hoisted(() => ({
  db: null as unknown,
  audits: [] as { readonly action: string }[],
  isolationLevels: [] as (string | undefined)[],
}));

vi.mock('@ses/db', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    // 🔴 `options` も記録する（`Serializable` を指定していることを固定するため。指摘 1）。
    withTenant: async (
      _ctx: unknown,
      fn: (db: unknown) => Promise<unknown>,
      options?: { readonly isolationLevel?: string },
    ) => {
      state.isolationLevels.push(options?.isolationLevel);
      return fn(state.db);
    },
    writeAuditLog: async (_db: unknown, entry: { readonly action: string }) => {
      state.audits.push(entry);
    },
  };
});

const { changeMemberRole, revokeMember } = await import('./service');

const TENANT = '01930000-0000-7000-8000-0000000000t1';
const PARTNER = '01930000-0000-7000-8000-0000000000c1';
const ACTOR_USER = '01930000-0000-7000-8000-0000000000u1';
const TARGET_USER = '01930000-0000-7000-8000-0000000000u2';
const MEMBERSHIP = '01930000-0000-7000-8000-0000000000m2';

const CTX = {
  tenantId: TENANT,
  partnerCompanyId: PARTNER,
  userId: ACTOR_USER,
  role: 'PARTNER_ADMIN',
  lifecycleState: 'ACTIVE',
  deviceKind: 'api',
  partnerSuspendedAt: null,
} as unknown as AuthenticatedTenantCtx;

const META = { deviceKind: 'api', ipAddress: '203.0.113.10' } as const;

type MembershipRow = {
  readonly id: string;
  readonly userId: string;
  readonly role: string;
  readonly partnerCompanyId: string | null;
  readonly joinedAt: Date;
  readonly revokedAt: Date | null;
};

function targetRow(overrides: Partial<MembershipRow> = {}): MembershipRow {
  return {
    id: MEMBERSHIP,
    userId: TARGET_USER,
    role: 'PARTNER_SALES',
    partnerCompanyId: PARTNER,
    joinedAt: new Date('2026-06-01T00:00:00.000Z'),
    revokedAt: null,
    ...overrides,
  };
}

/**
 * `withTenant` に渡す最小の偽物。
 * 🔴 **`findFirst` は呼ばれた順に応答を返す**（1 回目 = 対象の読み取り、2 回目 = CAS が 0 件
 *    だったときの再読）。順序に意味がある分岐を検証するため、呼び出し回数を数えている。
 */
function fakeDb(options: {
  readonly reads: readonly (MembershipRow | { readonly revokedAt: Date | null } | null)[];
  readonly updateCount: number;
  readonly userUpdateCount?: number;
}) {
  let readIndex = 0;
  return {
    membership: {
      findFirst: async () => options.reads[readIndex++] ?? null,
      count: async () => 0,
      updateMany: async () => ({ count: options.updateCount }),
    },
    user: {
      updateMany: async () => ({ count: options.userUpdateCount ?? 1 }),
    },
  };
}

beforeEach(() => {
  state.db = null;
  state.audits = [];
  state.isolationLevels = [];
});

describe('🔴 指摘 1: OWNER の不変条件を守るトランザクションは Serializable で開く', () => {
  it('changeMemberRole / revokeMember の両方が Serializable を要求する', async () => {
    state.db = fakeDb({ reads: [targetRow()], updateCount: 1 });
    await changeMemberRole(CTX, { membershipId: MEMBERSHIP, role: 'PARTNER_ADMIN' }, META);

    state.db = fakeDb({ reads: [targetRow()], updateCount: 1 });
    await revokeMember(CTX, { membershipId: MEMBERSHIP, now: new Date() }, META);

    expect(state.isolationLevels).toEqual(['Serializable', 'Serializable']);
  });
});

describe('🔴 指摘 3: changeMemberRole の CAS が 0 件だったとき', () => {
  it('行が残っていれば 409（並行変更）で、監査ログを書かない', async () => {
    state.db = fakeDb({ reads: [targetRow(), { revokedAt: null }], updateCount: 0 });

    await expect(
      changeMemberRole(CTX, { membershipId: MEMBERSHIP, role: 'PARTNER_ADMIN' }, META),
    ).rejects.toMatchObject({ code: 'CONCURRENT_UPDATE', httpStatus: 409 });
    expect(state.audits).toEqual([]);
  });

  it('行が消えていれば 404（見えない ＝ 存在しない）で、監査ログを書かない', async () => {
    state.db = fakeDb({ reads: [targetRow(), null], updateCount: 0 });

    await expect(
      changeMemberRole(CTX, { membershipId: MEMBERSHIP, role: 'PARTNER_ADMIN' }, META),
    ).rejects.toMatchObject({ code: 'NOT_FOUND', httpStatus: 404 });
    expect(state.audits).toEqual([]);
  });

  it('対照: 1 件更新されたときだけ `membership.role_change` を書く', async () => {
    state.db = fakeDb({ reads: [targetRow()], updateCount: 1 });

    const result = await changeMemberRole(
      CTX,
      { membershipId: MEMBERSHIP, role: 'PARTNER_ADMIN' },
      META,
    );

    expect(result).toEqual({ changed: true });
    expect(state.audits).toHaveLength(1);
    expect(state.audits[0]).toMatchObject({
      action: 'membership.role_change',
      // 🔴 CAS が成功した ＝ 置き換えたのは読んだロールである（`F-002 AC-3` の「変更前」が事実）。
      summary: { beforeRole: 'PARTNER_SALES', afterRole: 'PARTNER_ADMIN' },
    });
  });
});

describe('🔴 指摘 2: revokeMember の CAS が 0 件だったとき', () => {
  it('すでに無効化されていれば冪等な no-op（changed: false）で、監査ログを書かない', async () => {
    state.db = fakeDb({
      // 1 回目 = 有効な行を読む（判定を通す）→ CAS が 0 件 → 2 回目 = 無効化済みだった。
      reads: [targetRow(), { revokedAt: new Date('2026-09-02T00:00:00.000Z') }],
      updateCount: 0,
    });

    const result = await revokeMember(CTX, { membershipId: MEMBERSHIP, now: new Date() }, META);

    expect(result).toEqual({ changed: false });
    // 🔴 二重の無効化で監査ログが 2 件にならない（実際には何も変えていない）。
    expect(state.audits).toEqual([]);
  });

  it('行が消えていれば 404 で、監査ログを書かない', async () => {
    state.db = fakeDb({ reads: [targetRow(), null], updateCount: 0 });

    await expect(
      revokeMember(CTX, { membershipId: MEMBERSHIP, now: new Date() }, META),
    ).rejects.toMatchObject({ code: 'NOT_FOUND', httpStatus: 404 });
    expect(state.audits).toEqual([]);
  });

  it('🔴 所属を無効化できても利用者を無効化できなければ成立させない（fail-closed）', async () => {
    state.db = fakeDb({ reads: [targetRow()], updateCount: 1, userUpdateCount: 0 });

    await expect(
      revokeMember(CTX, { membershipId: MEMBERSHIP, now: new Date() }, META),
    ).rejects.toMatchObject({ code: 'INTERNAL' });
    expect(state.audits).toEqual([]);
  });

  it('対照: 1 件更新されたときだけ `membership.revoke` を書く', async () => {
    state.db = fakeDb({ reads: [targetRow()], updateCount: 1 });

    const result = await revokeMember(CTX, { membershipId: MEMBERSHIP, now: new Date() }, META);

    expect(result).toEqual({ changed: true });
    expect(state.audits).toHaveLength(1);
    expect(state.audits[0]).toMatchObject({ action: 'membership.revoke' });
  });
});
