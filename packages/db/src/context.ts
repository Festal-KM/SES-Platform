// packages/db/src/context.ts
// 🔴 AuthenticatedTenantCtx の生成器はここだけ（docs/05 §4.3 / §4.1 第 3 防御）。
//
// T-01-04 で「ブランド型であること」「分離キーが認証情報からしか来ないこと」を実装した。
// T-01-06 で HostTenantCtx（docs/05 §4.3 実装の規約 6）を追加する。
// deviceKind の判定・lifecycleState の DB 参照・Auth.js のセッション型への差し替えは SP-02 以降。
//
// 🔴 T-02-01（T-01-07 からの申し送り①）: TenantLifecycleState は本ファイルと
//    packages/domain/src/state/tenant.ts の 2 箇所に重複定義されていた。
//    単一の出所を packages/domain に一本化する（packages/db → @ses/domain の依存は
//    docs/05 §2.2 で禁止されておらず、eslint.config.mjs の packages/db ゾーンも許可している。
//    逆向き〔domain → db〕は禁止のまま）。schema.prisma の `tenants.lifecycle_state` 列は
//    Prisma の `enum` ではなく `String`（TEXT + CHECK）である（schema.prisma 冒頭コメント参照。
//    Prisma の `enum` はネイティブ Postgres ENUM 型を要求し、実行時にキャストエラーを起こすため
//    使えなかった）。値の一致は tests/static/schema-enum-drift.test.ts が migration.sql の
//    CHECK 制約と自動で突合する（code-reviewer 指摘。「自動検証は現状無い。TBD」は解消済み）。
//    TenantRole は本ファイルの TENANT_ROLES（下記）が単一の出所。
import type { TenantLifecycleState } from '@ses/domain';

export type { TenantLifecycleState } from '@ses/domain';

declare const TenantCtxBrand: unique symbol;
declare const HostBrand: unique symbol;

/**
 * docs/05 §3.3 TenantRole の値の単一の出所。
 * 🔴 tests/static/schema-enum-drift.test.ts が migration.sql の `memberships_role_check` /
 *    `invitations_role_check` と突合する（code-reviewer 指摘。TENANT_LIFECYCLE_STATES と同じ扱い）。
 */
export const TENANT_ROLES = [
  'OWNER',
  'ADMIN',
  'SALES',
  'PARTNER_ADMIN',
  'PARTNER_SALES',
  'VIEWER',
] as const;

export type TenantRole = (typeof TENANT_ROLES)[number];

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

/**
 * ホスト文脈であることが型で保証された ctx（docs/05 §4.3 実装の規約 6）。
 * 🔴 `requireHost` 以外がこの型の値を構築できない（`apps/worker` 用の `systemTenantCtx` は SP-02 以降。
 * docs/05 §9.2）。`partnerCompanyId` はブランドと同時に `null` へ絞り込まれる。
 *
 * 🔴 SP-01 時点のスキーマ（`Tenant` / `Engineer` の 2 表のみ）には経路 5 の基底表
 * （`assignments` / `contracts` / `contract_documents` / `orders` / `extension_reviews`）が
 * 存在しないため、本型は ctx の契約（「ホスト文脈しか `withHostTenant` に入れない」）だけを
 * 実装する。`HostTenantDb` に 5 デリゲートを追加する作業（`Omit` / `Pick` と
 * `PartnerBaseTableAccessError` の実行時フック）は、その表が揃う SP-02 で行う
 * （`packages/db/src/with-tenant.ts` の `HostTenantDb` を参照）。
 */
export type HostTenantCtx = AuthenticatedTenantCtx & {
  readonly partnerCompanyId: null;
  readonly [HostBrand]: true;
};

/**
 * 🔴 `requireHost` がパートナー文脈を弾いたことを示す。
 * API 境界（`apps/web`。§15 のエラー階層が実装され次第）では `NotFoundError`（404）に写像する
 * ——「見えない ＝ 存在しない」（docs/05 §4.8）を守るため、403 とは区別しない。
 */
export class HostOnlyContextError extends Error {
  constructor() {
    super(
      'この操作はホスト所属の利用者のみが実行できます（docs/05 §4.3 実装の規約 6）。' +
        'パートナー文脈からは 404 として扱ってください（§4.8「見えない ＝ 存在しない」）。',
    );
    this.name = 'HostOnlyContextError';
  }
}

/**
 * 🔴 `HostTenantCtx` の生成経路の 1 つ（もう 1 つは `apps/worker` の `systemTenantCtx`。SP-02 以降）。
 * パートナー文脈（`partnerCompanyId !== null`）なら `HostOnlyContextError` を投げ、
 * ホスト文脈だけを型で絞り込む（TypeScript のアサーション関数）。
 */
export function requireHost(ctx: AuthenticatedTenantCtx): asserts ctx is HostTenantCtx {
  if (ctx.partnerCompanyId !== null) {
    throw new HostOnlyContextError();
  }
}
