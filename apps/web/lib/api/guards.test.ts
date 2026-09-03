// apps/web/lib/api/guards.test.ts
// docs/05 §6.2 の共通ガードの**判定表**を固定する（T-03-04 / SP-03）。
//
// 🔴 ここで見るのは「判定そのもの」である。「その判定が実際の経路で効いていること」は
//    tests/isolation/api-boundary.test.ts（DB 付き）と tests/static/execute-guard.test.ts
//    （全ルート走査）が見る。3 つとも要る —— 判定が正しくても呼ばれなければ意味が無く、
//    呼ばれても判定が抜けていれば意味が無い。
import { describe, expect, it } from 'vitest';
import { TENANT_ROLES, type AuthenticatedTenantCtx, type TenantRole } from '@ses/db';
import { TENANT_LIFECYCLE_STATES, type TenantLifecycleState } from '@ses/domain';
import {
  applyGuards,
  assertGuardDeclaration,
  executionDenialMessageKey,
  GUARD_STAGES,
  IMPLEMENTED_GUARD_STAGES,
  requireExecutable,
  requireNotViewer,
  requireRole,
  type RouteGuard,
} from './guards';
import { ForbiddenError, TenantNotExecutableError, ViewerNotAllowedError } from './errors';

/**
 * 🔴 `AuthenticatedTenantCtx` はブランド型であり、**本番コードからは
 *    `resolveTenantCtx` 以外が構築できない**（docs/05 §4.3）。テストは判定表を網羅するために
 *    値を組み立てる必要があるため、ここでだけキャストする。
 *    「実物の ctx で効くこと」は結合テスト（tests/isolation/api-boundary.test.ts）が見る。
 */
function ctxOf(overrides: {
  readonly role: TenantRole;
  readonly lifecycleState?: TenantLifecycleState;
  readonly partnerCompanyId?: string | null;
}): AuthenticatedTenantCtx {
  return {
    tenantId: '01930000-0000-7000-8000-0000000000a1',
    partnerCompanyId: overrides.partnerCompanyId ?? null,
    userId: '01930000-0000-7000-8000-0000000000b1',
    role: overrides.role,
    lifecycleState: overrides.lifecycleState ?? 'ACTIVE',
    deviceKind: 'api',
  } as unknown as AuthenticatedTenantCtx;
}

describe('docs/05 §6.2 のガードの並び（この配列が実行順である）', () => {
  it('5 本が仕様どおりの順で宣言されている', () => {
    expect([...GUARD_STAGES]).toEqual([
      'role',
      'executable',
      'notViewer',
      'verifiedSendingDomain',
      'esignConnection',
    ]);
  });

  it('未実装の 2 本（SP-04 / SP-17）は実装済み一覧に含まれない', () => {
    expect([...IMPLEMENTED_GUARD_STAGES]).toEqual(['role', 'executable', 'notViewer']);
  });
});

describe('requireRole（403 ForbiddenError / F-004 AC-2）', () => {
  it('許可ロールは通る', async () => {
    await expect(
      applyGuards(ctxOf({ role: 'ADMIN' }), [requireRole(['OWNER', 'ADMIN'])]),
    ).resolves.toBeUndefined();
  });

  it.each(TENANT_ROLES.filter((role) => role !== 'OWNER' && role !== 'ADMIN'))(
    '許可されていない %s は 403 になる',
    async (role) => {
      await expect(
        applyGuards(ctxOf({ role }), [requireRole(['OWNER', 'ADMIN'])]),
      ).rejects.toBeInstanceOf(ForbiddenError);
    },
  );

  it('🔴 判定材料は ctx.role だけである（許可ロールが空のガードは構築時に落ちる）', () => {
    expect(() => requireRole([])).toThrow(/許可ロールが空/);
  });
});

describe('🔴 requireExecutable（409 / F-004 AC-7〜AC-9）', () => {
  /**
   * 🔴 全 5 状態を網羅する。ここが「どの状態で実行系を止めるか」の唯一の表であり、
   *    状態が増えたときにこのテストが落ちることで気づける。
   */
  const EXPECTED: Readonly<Record<TenantLifecycleState, string | null>> = {
    SANDBOX: null,
    ACTIVE: null,
    SUSPENDED: 'error.tenant.suspended',
    CLOSING: 'error.tenant.closing',
    PURGED: 'error.tenant.purged',
  };

  it('テナントのライフサイクル 5 状態を尽くしている（列挙漏れの検知）', () => {
    expect(Object.keys(EXPECTED).sort()).toEqual([...TENANT_LIFECYCLE_STATES].sort());
  });

  it.each(TENANT_LIFECYCLE_STATES)('%s の判定が表どおりである', (state) => {
    expect(executionDenialMessageKey(state)).toBe(EXPECTED[state]);
  });

  it.each(['SANDBOX', 'ACTIVE'] as const)('%s では実行できる', async (lifecycleState) => {
    await expect(
      applyGuards(ctxOf({ role: 'OWNER', lifecycleState }), [requireExecutable()]),
    ).resolves.toBeUndefined();
  });

  it.each(['CLOSING', 'PURGED'] as const)(
    '🔴 %s では OWNER でも実行できない（ロールの権限より優先する）',
    async (lifecycleState) => {
      const error = await applyGuards(ctxOf({ role: 'OWNER', lifecycleState }), [
        requireExecutable(),
      ]).catch((caught: unknown) => caught);
      expect(error).toBeInstanceOf(TenantNotExecutableError);
      const typed = error as TenantNotExecutableError;
      expect(typed.httpStatus).toBe(409);
      expect(typed.lifecycleState).toBe(lifecycleState);
      expect(typed.userMessageKey).toBe(EXPECTED[lifecycleState]);
    },
  );

  it('🔴 CLOSING と PURGED で文言キーが異なる（F-004 AC-9「拒否の理由が表示される」）', () => {
    expect(executionDenialMessageKey('CLOSING')).not.toBe(executionDenialMessageKey('PURGED'));
  });

  /**
   * 🔴 判定の完成は T-20-05（`ACTIVE` → `SUSPENDED` は Phase 3 でしか起きないため、
   *    本スプリントの完了判定に `F-004 AC-7` は含めない）。表としては先に安全側へ倒しておく。
   */
  it('SUSPENDED は先取りで拒否側にある（T-20-05 の前倒し。fail-closed）', () => {
    expect(executionDenialMessageKey('SUSPENDED')).toBe('error.tenant.suspended');
  });
});

describe('🔴 requireNotViewer（403 / BR-31 / F-004 AC-6）', () => {
  it('VIEWER は実行系を実行できない', async () => {
    await expect(
      applyGuards(ctxOf({ role: 'VIEWER' }), [requireNotViewer()]),
    ).rejects.toBeInstanceOf(ViewerNotAllowedError);
  });

  it.each(TENANT_ROLES.filter((role) => role !== 'VIEWER'))('%s は通る', async (role) => {
    await expect(
      applyGuards(ctxOf({ role }), [requireNotViewer()]),
    ).resolves.toBeUndefined();
  });
});

describe('🔴 ガードの実行順は宣言順ではなく GUARD_STAGES の順である', () => {
  const GUARDS_IN_WRONG_ORDER: readonly RouteGuard[] = [
    requireNotViewer(),
    requireExecutable(),
    requireRole(['OWNER', 'ADMIN', 'VIEWER']),
  ];

  it('ロール外の VIEWER には 403 ForbiddenError が返る（テナント状態を教えない）', async () => {
    const error = await applyGuards(ctxOf({ role: 'SALES', lifecycleState: 'CLOSING' }), [
      requireNotViewer(),
      requireExecutable(),
      requireRole(['OWNER', 'ADMIN']),
    ]).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(ForbiddenError);
    expect(error).not.toBeInstanceOf(ViewerNotAllowedError);
    expect((error as ForbiddenError).code).toBe('FORBIDDEN');
  });

  it('🔴 CLOSING の VIEWER には 409（テナント状態がロールの権限より優先する）', async () => {
    const error = await applyGuards(
      ctxOf({ role: 'VIEWER', lifecycleState: 'CLOSING' }),
      GUARDS_IN_WRONG_ORDER,
    ).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(TenantNotExecutableError);
  });

  it('ACTIVE の VIEWER には 403 ViewerNotAllowedError（テナント状態は問題ない）', async () => {
    const error = await applyGuards(
      ctxOf({ role: 'VIEWER', lifecycleState: 'ACTIVE' }),
      GUARDS_IN_WRONG_ORDER,
    ).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(ViewerNotAllowedError);
    expect((error as ViewerNotAllowedError).httpStatus).toBe(403);
  });

  it('実行順そのものを観測する（宣言をどう並べても role → executable → notViewer）', async () => {
    const calls: string[] = [];
    const probe = (stage: RouteGuard['stage']): RouteGuard => ({
      stage,
      run: () => {
        calls.push(stage);
      },
    });
    await applyGuards(ctxOf({ role: 'OWNER' }), [
      probe('notViewer'),
      probe('executable'),
      probe('role'),
    ]);
    expect(calls).toEqual(['role', 'executable', 'notViewer']);
  });
});

describe('🔴 ガード宣言の破綻はルート構築時に落とす', () => {
  it('同じ stage を 2 回宣言できない', () => {
    expect(() =>
      assertGuardDeclaration([requireExecutable(), requireExecutable()], 'テスト'),
    ).toThrow(/重複/);
  });

  it('未実装の stage（SP-04 / SP-17）を宣言できない', () => {
    const notImplemented: RouteGuard = { stage: 'verifiedSendingDomain', run: () => undefined };
    expect(() => assertGuardDeclaration([notImplemented], 'テスト')).toThrow(/未実装/);
  });

  it('未知の stage を宣言できない', () => {
    const unknownStage = { stage: 'requireNothing', run: () => undefined } as unknown as RouteGuard;
    expect(() => assertGuardDeclaration([unknownStage], 'テスト')).toThrow(/未知/);
  });

  it('ガードなし（読み取り専用ルート）は許される', () => {
    expect(() => assertGuardDeclaration([], 'テスト')).not.toThrow();
  });
});
