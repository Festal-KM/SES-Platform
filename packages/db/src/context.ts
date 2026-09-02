// packages/db/src/context.ts
// 🔴 AuthenticatedTenantCtx の生成器はここだけ（docs/05 §4.3 / §4.1 第 3 防御）。
//
// T-01-04 の範囲では「ブランド型であること」「分離キーが認証情報からしか来ないこと」までを実装する。
// deviceKind の判定・lifecycleState の DB 参照・Auth.js のセッション型への差し替えは T-01-06 / SP-02。

declare const TenantCtxBrand: unique symbol;

export type TenantRole = 'OWNER' | 'ADMIN' | 'SALES' | 'PARTNER_ADMIN' | 'PARTNER_SALES' | 'VIEWER';

export type TenantLifecycleState = 'SANDBOX' | 'ACTIVE' | 'SUSPENDED' | 'CLOSING' | 'PURGED';

export type DeviceKind = 'desktop' | 'mobile' | 'tablet' | 'api';

/**
 * 認証済みのテナント文脈。🔴 ブランドプロパティは外部から書けないため、
 * `resolveTenantCtx` 以外がこの型の値を構築できない（docs/05 §4.3 の違反時の挙動 = コンパイルエラー）。
 */
export type AuthenticatedTenantCtx = {
  readonly tenantId: string;
  readonly partnerCompanyId: string | null; // null = ホスト所属
  readonly userId: string;
  readonly role: TenantRole;
  readonly lifecycleState: TenantLifecycleState;
  readonly deviceKind: DeviceKind;
  readonly [TenantCtxBrand]: true;
};

/**
 * 主平面の認証済みセッション。
 * 🔴 分離キー（tenantId / partnerCompanyId）はこの型からのみ来る。
 *    `resolveTenantCtx` はリクエスト body / query / path を引数に取らない（CLAUDE.md §3.1 / BR-03）。
 */
export type MainSession = {
  readonly tenantId: string;
  readonly partnerCompanyId: string | null;
  readonly userId: string;
  readonly role: TenantRole;
  readonly lifecycleState: TenantLifecycleState;
};

/** ctx に載せてよいリクエスト由来の情報。🔴 分離キーを含めてはならない。 */
export type RequestMeta = {
  readonly deviceKind: DeviceKind;
};

/** 🔴 AuthenticatedTenantCtx の唯一の生成経路。 */
export async function resolveTenantCtx(
  session: MainSession,
  req: RequestMeta,
): Promise<AuthenticatedTenantCtx> {
  return {
    tenantId: session.tenantId,
    partnerCompanyId: session.partnerCompanyId,
    userId: session.userId,
    role: session.role,
    lifecycleState: session.lifecycleState,
    deviceKind: req.deviceKind,
  } as AuthenticatedTenantCtx;
}
