// apps/web/lib/tenants/roles.ts
// テナントロールの分類（ホスト所属 / パートナー所属）。`CLAUDE.md` §10.1 / docs/05 §3.3。
//
// 🔴 T-04-09 で `lib/invitations/policy.ts` から移設した。招待（`F-002` の発行）と
//    アカウント管理（`F-002` のロール変更・無効化）の**両方**が同じ分類を必要とし、
//    片方に置いたままだともう片方が「自前の判定」を持つことになる。
//    ロールの分類はテナントの構造そのものであり、機能ごとに解釈が分かれてはならない。
//
// 🔴 分類は `memberships` の CHECK 制約と 1 対 1 である（docs/05 §3.3）:
//      (role IN ('PARTNER_ADMIN','PARTNER_SALES')) = (partner_company_id IS NOT NULL)
//    したがって「パートナーロール ⇔ 取引先企業に紐づく」は DB が保証しており、
//    本モジュールはその同じ規律をアプリ側に写しているだけである。
//    ⚠️ `VIEWER` は現状ホスト側にしか存在できない（上記 CHECK の帰結）。
//       docs/04 §S-044 / §S-045 と docs/05 §6.6 #80 が言及する「パートナー所属 `VIEWER`」は
//       スキーマ上まだ表現できない（T-04-09 の申し送り。Phase 2 の経路 5 で必要になる）。
import type { TenantRole } from '@ses/db';

/** ホスト（契約 SES 企業）側のロール。`Membership.partnerCompanyId` は必ず null。 */
export const HOST_TENANT_ROLES = ['OWNER', 'ADMIN', 'SALES', 'VIEWER'] as const satisfies
  readonly TenantRole[];

/** 取引先側のロール。`Membership.partnerCompanyId` は必ず非 null（DB の CHECK 制約と対）。 */
export const PARTNER_TENANT_ROLES = ['PARTNER_ADMIN', 'PARTNER_SALES'] as const satisfies
  readonly TenantRole[];

export type HostTenantRole = (typeof HOST_TENANT_ROLES)[number];
export type PartnerTenantRole = (typeof PARTNER_TENANT_ROLES)[number];

export function isPartnerRole(role: TenantRole): role is PartnerTenantRole {
  return (PARTNER_TENANT_ROLES as readonly TenantRole[]).includes(role);
}

export function isHostRole(role: TenantRole): role is HostTenantRole {
  return (HOST_TENANT_ROLES as readonly TenantRole[]).includes(role);
}
