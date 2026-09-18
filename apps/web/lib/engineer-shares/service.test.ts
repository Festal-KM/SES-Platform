// apps/web/lib/engineer-shares/service.test.ts
// 🔴 **形が不正なカーソル（400）で `withTenant` を開かない**ことを固定する（T-12-17 ②。SP-11 T-11-11 レビュー申し送り ②）。
//
// なぜユニットで書くか: 結合 `tests/isolation/engineer-shares.test.ts` は 400 が返ることまでは見るが、
// 「その要求のためにトランザクションと `SET LOCAL` が開かれたか」は応答からは分からない。ここでは
// `withTenant` を差し替えて呼ばれた回数を数え、復号が `assertPartnerContext` の直後（DB の手前）で
// 済んでいることを確定的に固定する。戻り値・エラー（`RangeError` / `CursorModeMismatchError`）は変えていない。
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuthenticatedTenantCtx } from '@ses/db';

const state = vi.hoisted(() => ({
  withTenantCalls: 0,
}));

vi.mock('@ses/db', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    withTenant: async () => {
      state.withTenantCalls += 1;
      throw new Error('このテストでは withTenant に到達してはならない');
    },
  };
});

const { listEngineerShares } = await import('./service');
const { CursorModeMismatchError } = await import('./errors');

const CTX = {
  tenantId: '01930000-0000-7000-8000-0000000000t1',
  partnerCompanyId: '01930000-0000-7000-8000-0000000000c1',
  userId: '01930000-0000-7000-8000-0000000000u1',
  role: 'PARTNER_ADMIN',
  lifecycleState: 'ACTIVE',
  deviceKind: 'api',
  partnerSuspendedAt: null,
} as unknown as AuthenticatedTenantCtx;

const REFERENCE_DATE = '2026-09-18';

describe('listEngineerShares: カーソルの復号は withTenant の手前（T-12-17 ②）', () => {
  beforeEach(() => {
    state.withTenantCalls = 0;
  });

  it('形が不正なカーソルは RangeError になり、withTenant は 1 回も呼ばれない', async () => {
    await expect(
      listEngineerShares(CTX, { limit: 50, shared: 'true', cursor: 'not-a-cursor' }, REFERENCE_DATE),
    ).rejects.toBeInstanceOf(RangeError);
    expect(state.withTenantCalls).toBe(0);
  });

  it('共有状態とモードが食い違うカーソルは CursorModeMismatchError になり、withTenant は 1 回も呼ばれない', async () => {
    await expect(
      listEngineerShares(
        CTX,
        { limit: 50, shared: 'true', cursor: 'u:1757000000000:01930000-0000-7000-8000-0000000000a1' },
        REFERENCE_DATE,
      ),
    ).rejects.toBeInstanceOf(CursorModeMismatchError);
    expect(state.withTenantCalls).toBe(0);
  });

  it('ホスト所属（partnerCompanyId = null）は 403 で、カーソルの復号にも withTenant にも到達しない', async () => {
    const hostCtx = { ...CTX, partnerCompanyId: null } as unknown as AuthenticatedTenantCtx;
    await expect(
      listEngineerShares(hostCtx, { limit: 50, shared: 'true', cursor: 'not-a-cursor' }, REFERENCE_DATE),
    ).rejects.not.toBeInstanceOf(RangeError);
    expect(state.withTenantCalls).toBe(0);
  });

  it('正しいカーソルは復号を通り、withTenant へ進む（対照。DB はこのテストでは差し替え済み）', async () => {
    await expect(
      listEngineerShares(
        CTX,
        { limit: 50, shared: 'true', cursor: 's:1757000000000:01930000-0000-7000-8000-0000000000a1' },
        REFERENCE_DATE,
      ),
    ).rejects.toThrow('このテストでは withTenant に到達してはならない');
    expect(state.withTenantCalls).toBe(1);
  });
});
