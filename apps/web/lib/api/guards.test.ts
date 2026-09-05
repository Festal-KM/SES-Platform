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
  requireVerifiedSendingDomain,
  type RouteGuard,
  type SendingDomainResolver,
} from './guards';
import {
  ForbiddenError,
  PartnerCompanySuspendedError,
  SendingDomainNotVerifiedError,
  TenantNotExecutableError,
  ViewerNotAllowedError,
} from './errors';

/** `verificationRequired === false`（`sandbox` / `demo` / `development`）に相当する判定。 */
const notRequired: SendingDomainResolver = async () => ({ kind: 'NOT_REQUIRED' });

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
  readonly partnerSuspendedAt?: Date | null;
}): AuthenticatedTenantCtx {
  return {
    tenantId: '01930000-0000-7000-8000-0000000000a1',
    partnerCompanyId: overrides.partnerCompanyId ?? null,
    userId: '01930000-0000-7000-8000-0000000000b1',
    role: overrides.role,
    lifecycleState: overrides.lifecycleState ?? 'ACTIVE',
    partnerSuspendedAt: overrides.partnerSuspendedAt ?? null,
    deviceKind: 'api',
  } as unknown as AuthenticatedTenantCtx;
}

/** 取引先企業の停止時刻（`F-007 AC-2`）。値そのものに意味は無い（`null` かどうかだけを見る）。 */
const SUSPENDED_AT = new Date('2026-09-05T00:00:00.000Z');
const PARTNER_COMPANY_ID = '01930000-0000-7000-8000-0000000000c1';

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

  it('🔴 T-04-05 で verifiedSendingDomain が実装済みになり、残るは esignConnection（SP-17）だけ', () => {
    expect([...IMPLEMENTED_GUARD_STAGES]).toEqual([
      'role',
      'executable',
      'notViewer',
      'verifiedSendingDomain',
    ]);
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

/**
 * 🔴 T-04-07（`F-007 AC-2`）: 取引先企業の停止も `requireExecutable` が見る。
 *    **別のガードにしない**理由は `guards.ts` のコメントのとおり（掛け忘れたルートだけ
 *    停止が効かない状態を作らない。`tests/static/execute-guard.test.ts` が網羅を担保する）。
 */
describe('🔴 requireExecutable — 取引先企業の停止（409 / F-007 AC-2）', () => {
  it.each(['PARTNER_ADMIN', 'PARTNER_SALES'] as const)(
    '停止中の取引先に所属する %s は実行系を実行できない',
    async (role) => {
      const error = await applyGuards(
        ctxOf({ role, partnerCompanyId: PARTNER_COMPANY_ID, partnerSuspendedAt: SUSPENDED_AT }),
        [requireExecutable()],
      ).catch((caught: unknown) => caught);

      expect(error).toBeInstanceOf(PartnerCompanySuspendedError);
      expect((error as PartnerCompanySuspendedError).httpStatus).toBe(409);
      expect((error as PartnerCompanySuspendedError).userMessageKey).toBe(
        'error.partnerCompany.suspended',
      );
    },
  );

  it('停止されていない取引先に所属する PARTNER_ADMIN は通る', async () => {
    await expect(
      applyGuards(ctxOf({ role: 'PARTNER_ADMIN', partnerCompanyId: PARTNER_COMPANY_ID }), [
        requireExecutable(),
      ]),
    ).resolves.toBeUndefined();
  });

  it('🔴 ホスト所属は取引先の停止の影響を受けない（停止の単位は取引先企業である）', async () => {
    await expect(
      applyGuards(ctxOf({ role: 'ADMIN' }), [requireExecutable()]),
    ).resolves.toBeUndefined();
  });

  it('🔴 テナントの状態を先に返す（より広い停止を優先する。誰に解除を頼むかが変わる）', async () => {
    const error = await applyGuards(
      ctxOf({
        role: 'PARTNER_ADMIN',
        lifecycleState: 'CLOSING',
        partnerCompanyId: PARTNER_COMPANY_ID,
        partnerSuspendedAt: SUSPENDED_AT,
      }),
      [requireExecutable()],
    ).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(TenantNotExecutableError);
    expect(error).not.toBeInstanceOf(PartnerCompanySuspendedError);
  });

  it('🔴 テナントの停止と取引先の停止は別のコードである（畳まない）', () => {
    expect(new PartnerCompanySuspendedError().code).toBe('PARTNER_COMPANY_SUSPENDED');
    expect(new PartnerCompanySuspendedError().code).not.toBe('TENANT_NOT_EXECUTABLE');
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

describe('🔴 requireVerifiedSendingDomain（422 / BR-51 / F-022 AC-7）', () => {
  const DKIM = [
    {
      type: 'CNAME' as const,
      name: 'tok1._domainkey.example.co.jp',
      value: 'tok1.dkim.amazonses.com',
      purposeKey: 'DKIM' as const,
    },
  ];
  const MAIL_FROM = [
    {
      type: 'MX' as const,
      name: 'mail.example.co.jp',
      value: 'feedback-smtp.ap-northeast-1.amazonses.com',
      priority: 10,
      purposeKey: 'MAIL_FROM_MX' as const,
    },
  ];

  const unverified: SendingDomainResolver = async () => ({
    kind: 'UNVERIFIED',
    detail: {
      domain: 'example.co.jp',
      state: 'PENDING',
      failureReasonKey: 'settings.sendingDomain.failure.DKIM_NOT_VERIFIED',
      dkimRecords: DKIM,
      mailFromRecords: MAIL_FROM,
    },
  });

  it('検証済みなら通る', async () => {
    const verified: SendingDomainResolver = async () => ({
      kind: 'VERIFIED',
      domain: 'example.co.jp',
    });
    await expect(
      applyGuards(ctxOf({ role: 'OWNER' }), [requireVerifiedSendingDomain({ resolve: verified })]),
    ).resolves.toBeUndefined();
  });

  it('🔴 検証を求めない環境（sandbox / demo / development）では通る（docs/03 §3.2.7-4 / -5）', async () => {
    await expect(
      applyGuards(ctxOf({ role: 'OWNER' }), [requireVerifiedSendingDomain({ resolve: notRequired })]),
    ).resolves.toBeUndefined();
  });

  it('🔴 未検証なら 422 になる（OWNER でも通らない = フォールバックしない）', async () => {
    const error = await applyGuards(ctxOf({ role: 'OWNER' }), [
      requireVerifiedSendingDomain({ resolve: unverified }),
    ]).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(SendingDomainNotVerifiedError);
    const typed = error as SendingDomainNotVerifiedError;
    expect(typed.httpStatus).toBe(422);
    expect(typed.userMessageKey).toBe('error.sendingDomain.unverified');
  });

  it('🔴 応答に設定すべき DNS レコードが載る（F-022 AC-7 / F-001 AC-4）', async () => {
    const error = (await applyGuards(ctxOf({ role: 'SALES' }), [
      requireVerifiedSendingDomain({ resolve: unverified }),
    ]).catch((caught: unknown) => caught)) as SendingDomainNotVerifiedError;

    expect(error.params).toEqual({
      domain: 'example.co.jp',
      state: 'PENDING',
      failureReasonKey: 'settings.sendingDomain.failure.DKIM_NOT_VERIFIED',
      dkimRecords: DKIM,
      mailFromRecords: MAIL_FROM,
    });
  });

  it('🔴 未登録（1 件も無い）でも 422 であり、理由と登録すべきことが分かる', async () => {
    const notRegistered: SendingDomainResolver = async () => ({
      kind: 'UNVERIFIED',
      detail: {
        domain: null,
        state: null,
        failureReasonKey: null,
        dkimRecords: [],
        mailFromRecords: [],
      },
    });
    const error = (await applyGuards(ctxOf({ role: 'OWNER' }), [
      requireVerifiedSendingDomain({ resolve: notRegistered }),
    ]).catch((caught: unknown) => caught)) as SendingDomainNotVerifiedError;

    expect(error).toBeInstanceOf(SendingDomainNotVerifiedError);
    expect(error.params).toMatchObject({ domain: null, state: null });
  });

  it('🔴 SUBMIT_FAILED（障害）と混ざらない別のコードである（F-022 AC-7）', async () => {
    const error = (await applyGuards(ctxOf({ role: 'OWNER' }), [
      requireVerifiedSendingDomain({ resolve: unverified }),
    ]).catch((caught: unknown) => caught)) as SendingDomainNotVerifiedError;

    expect(error.code).toBe('SENDING_DOMAIN_NOT_VERIFIED');
    expect(error.retryable).toBe(false);
  });

  it('🔴 判定材料は ctx だけである（リクエスト入力を受け取らない）', async () => {
    const seen: unknown[] = [];
    const spy: SendingDomainResolver = async (ctx) => {
      seen.push(ctx);
      return { kind: 'NOT_REQUIRED' };
    };
    const ctx = ctxOf({ role: 'ADMIN' });
    await applyGuards(ctx, [requireVerifiedSendingDomain({ resolve: spy })]);
    expect(seen).toEqual([ctx]);
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

  it('実行順そのものを観測する（宣言をどう並べても GUARD_STAGES の順）', async () => {
    const calls: string[] = [];
    const probe = (stage: RouteGuard['stage']): RouteGuard => ({
      stage,
      run: () => {
        calls.push(stage);
      },
    });
    await applyGuards(ctxOf({ role: 'OWNER' }), [
      probe('verifiedSendingDomain'),
      probe('notViewer'),
      probe('executable'),
      probe('role'),
    ]);
    expect(calls).toEqual(['role', 'executable', 'notViewer', 'verifiedSendingDomain']);
  });

  it('🔴 送信ドメインの判定は最後である（権限もテナント状態も満たさない呼び出しでは DB を見ない）', async () => {
    let resolved = 0;
    const spy: SendingDomainResolver = async () => {
      resolved += 1;
      return { kind: 'NOT_REQUIRED' };
    };
    await expect(
      applyGuards(ctxOf({ role: 'VIEWER', lifecycleState: 'CLOSING' }), [
        requireVerifiedSendingDomain({ resolve: spy }),
        requireExecutable(),
        requireRole(['OWNER', 'ADMIN']),
      ]),
    ).rejects.toBeInstanceOf(ForbiddenError);
    expect(resolved).toBe(0);
  });
});

describe('🔴 ガード宣言の破綻はルート構築時に落とす', () => {
  it('同じ stage を 2 回宣言できない', () => {
    expect(() =>
      assertGuardDeclaration([requireExecutable(), requireExecutable()], 'テスト'),
    ).toThrow(/重複/);
  });

  it('未実装の stage（SP-17 の esignConnection）を宣言できない', () => {
    const notImplemented: RouteGuard = { stage: 'esignConnection', run: () => undefined };
    expect(() => assertGuardDeclaration([notImplemented], 'テスト')).toThrow(/未実装/);
  });

  it('🔴 実装済みになった verifiedSendingDomain は宣言できる（T-04-05）', () => {
    expect(() =>
      assertGuardDeclaration([requireVerifiedSendingDomain({ resolve: notRequired })], 'テスト'),
    ).not.toThrow();
  });

  it('未知の stage を宣言できない', () => {
    const unknownStage = { stage: 'requireNothing', run: () => undefined } as unknown as RouteGuard;
    expect(() => assertGuardDeclaration([unknownStage], 'テスト')).toThrow(/未知/);
  });

  it('ガードなし（読み取り専用ルート）は許される', () => {
    expect(() => assertGuardDeclaration([], 'テスト')).not.toThrow();
  });
});
