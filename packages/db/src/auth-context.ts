// packages/db/src/auth-context.ts
// T-03-01（docs/sprints/SP-03-auth-audit-admin0.md / docs/05 §4.3 / §6.3 #1 / F-003 AC-1）。
//
// 🔴 本モジュールの責務は 1 つだけ:「**認証で確定した分離キー**（tenantId /
//    partnerCompanyId / userId）から、**ロールとテナントのライフサイクル状態を DB で確定**する」。
//
// なぜ packages/db に置くか:
//   ① `AuthenticatedTenantCtx` の材料（role / lifecycleState）を apps/web が自前で
//      組み立てられる状態にすると、「セッションに書いてあるロールを信じる」実装が可能になり、
//      JWT の中身がそのまま権限になってしまう。**ロールは常に DB の `memberships` 行が正**とする。
//   ② `withTenant` と同じ `SET LOCAL` 手順（第 1 防御）と Prisma 拡張（第 2 防御）を
//      通す必要がある。`runInTenantTransaction` を共有し、手順を書き分けない（docs/05 §4.3 規約 1）。
//
// 🔴 これは docs/05 §4.4.2 の「テナント文脈を持たない経路」ではない。
//    本関数は `app.tenant_id` / `app.partner_company_id` を**設定した上で**読むため、
//    RLS の C5（memberships）と C1（tenants）がそのまま効く。したがって
//    「他テナント・他パートナーの membership を引く」ことは、この関数を使ってもできない。
//
// 🔴 引数はすべて認証由来である（`withAuthLookup` が返した `users` 行 / セッション Cookie）。
//    リクエストの body / query / path を引数に取らない（CLAUDE.md §3.1 / BR-03 / F-003 AC-1）。
import { TENANT_ROLES, type TenantLifecycleState, type TenantRole } from './context.js';
import { TENANT_LIFECYCLE_STATES } from '@ses/domain';
import { TWO_FACTOR_SUBJECT_TYPE_USER } from './two-factor.js';
import { runInTenantTransaction } from './with-tenant.js';

/**
 * 認証で確定した分離キー。
 * 🔴 `partnerCompanyId` は `users.owner_partner_company_id`（= `withAuthLookup` の戻り値）が出所であり、
 *    利用者の入力ではない。
 */
export type TenantIdentity = {
  readonly tenantId: string;
  /** null = ホスト所属。 */
  readonly partnerCompanyId: string | null;
  readonly userId: string;
};

/** DB で確定したロールとテナント状態（`resolveTenantCtx` に渡す材料）。 */
export type TenantMembershipFacts = {
  readonly role: TenantRole;
  readonly lifecycleState: TenantLifecycleState;
  /**
   * 🔴 T-03-02: `TwoFactorCredential.confirmedAt IS NOT NULL`（docs/05 §6.2 / `F-003 AC-2`）。
   *    ロールと同じく**リクエストごとに DB から確定する**（セッションに焼き込まない）。
   *    焼き込むと、2FA を解除しても既存セッションが生き続ける。
   */
  readonly twoFactorEnrolled: boolean;
};

function isTenantRole(value: string): value is TenantRole {
  return (TENANT_ROLES as readonly string[]).includes(value);
}

function isTenantLifecycleState(value: string): value is TenantLifecycleState {
  return (TENANT_LIFECYCLE_STATES as readonly string[]).includes(value);
}

/**
 * 有効な `Membership` と `Tenant.lifecycleState` を読み、ロールとテナント状態を確定する。
 *
 * 次のいずれかに該当したら **`null`**（＝認証コンテキストを作らせない）:
 *   - 有効な `Membership` が無い（未受諾 / 失効 / 別テナント）
 *   - `Membership.partnerCompanyId` が引数の所属と食い違う（🔴 fail-closed。
 *     `users.owner_partner_company_id` と `memberships.partner_company_id` は DB トリガで
 *     一致が保証されている〔docs/05 §3.3〕ため、食い違うのは異常事態である）
 *   - `Tenant` の行が読めない（テナントが消えている / RLS で 0 件）
 *   - ロール・ライフサイクル状態が既知の値集合に無い（CHECK 制約があるので通常起きない）
 *
 * 🔴 呼び出しごとに DB を読む（セッションにロールを焼き込まない）。権限変更・
 *    `Membership` の失効・ライフサイクル遷移が**次のリクエストから**効く（F-004 関連ロール）。
 */
export async function loadTenantMembership(
  identity: TenantIdentity,
): Promise<TenantMembershipFacts | null> {
  return runInTenantTransaction(
    {
      tenantId: identity.tenantId,
      partnerCompanyId: identity.partnerCompanyId,
      actorUserId: identity.userId,
    },
    async (tx) => {
      // 🔴 `where` にテナントキーを書かない（第 2 防御が注入し、第 1 防御が RLS で絞る）。
      const membership = await tx.membership.findFirst({
        where: { userId: identity.userId, revokedAt: null },
        select: { role: true, partnerCompanyId: true },
      });
      if (membership === null) return null;
      if (membership.partnerCompanyId !== identity.partnerCompanyId) return null;
      if (!isTenantRole(membership.role)) return null;

      const tenant = await tx.tenant.findFirst({ select: { lifecycleState: true } });
      if (tenant === null) return null;
      if (!isTenantLifecycleState(tenant.lifecycleState)) return null;

      // 🔴 2 要素認証の設定状態（docs/05 §6.2 / F-003 AC-2）。RLS の C7 SELF により、
      //    ここで読めるのは**本人の行だけ**である（`subject_id = app_actor_user_id()` かつ
      //    `subject_type = 'USER'`）。他人の設定状態は 1 行も見えない。
      const twoFactor = await tx.twoFactorCredential.findFirst({
        where: {
          subjectId: identity.userId,
          subjectType: TWO_FACTOR_SUBJECT_TYPE_USER,
          confirmedAt: { not: null },
        },
        select: { id: true },
      });

      return {
        role: membership.role,
        lifecycleState: tenant.lifecycleState,
        twoFactorEnrolled: twoFactor !== null,
      };
    },
  );
}
