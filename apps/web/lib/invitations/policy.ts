// apps/web/lib/invitations/policy.ts
// 招待の可否を決める**純粋関数**（`F-002 AC-1` / `AC-4` / docs/05 §6.4 #14）。
//
// 🔴 なぜ判定を関数として切り出すか: `F-002 AC-1`（パートナーロールは必ず 1 社に紐づく）と
//    `AC-4`（`PARTNER_ADMIN` は自社配下のみ）は、条件分岐がハンドラに散ると片方だけ緩む。
//    ここを唯一の判定にし、ユニットテストで全組み合わせを固定する。
//
// 🔴 `packages/domain` に置かなかった理由: docs/05 §2.1 の `packages/domain` の内訳
//    （state / matching / anonymize / gate / recipient / contract / money / dates）に
//    認可の区画が無く、勝手に増やすのは設計変更にあたるため（CLAUDE.md §8.7）。
//    本モジュールは I/O を持たない純粋関数であり、必要になれば移設できる。
//
// 🔴 分離キーの出どころ（CLAUDE.md §3.1 / BR-03）:
//    - 実行者（actor）の所属は**認証コンテキスト**からしか来ない。
//    - `PARTNER_ADMIN` が招く相手の所属は「実行者と同じ会社」であり、**入力で選ばせない**。
//      判定はそれを `SAME_AS_ACTOR` として表現し、呼び出し側が ctx の値を入れる。
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

/** 招待を実行する利用者（🔴 すべて認証コンテキスト由来）。 */
export type InvitationActor = {
  readonly role: TenantRole;
  /** null = ホスト所属。 */
  readonly partnerCompanyId: string | null;
};

/** 招待の宛先。🔴 所属そのものは持たない（下の `verdict` が「誰の所属になるか」を決める）。 */
export type InvitationTarget = {
  readonly role: TenantRole;
  /**
   * ホストの `OWNER` / `ADMIN` が取引先の担当者を招くときに指定する取引先企業（`S-014`）。
   * 🔴 これは実行者の分離キーではなく**招待先の選択**である。`PARTNER_ADMIN` は指定できない
   *    （自社以外を選べてしまうため。`AC-4`）。
   */
  readonly partnerCompanyId?: string | null;
};

export const INVITATION_DENIAL_REASONS = [
  /** 実行者のロールに招待の権限が無い（`SALES` / `VIEWER` / `PARTNER_SALES`）。 */
  'ACTOR_ROLE_NOT_ALLOWED',
  /** 実行者が招けないロール（`PARTNER_ADMIN` がホストロールを招こうとした）。`AC-4`。 */
  'TARGET_ROLE_NOT_ALLOWED',
  /** 🔴 パートナーロールなのに取引先企業が決まらない。`AC-1`。 */
  'PARTNER_COMPANY_REQUIRED',
  /** 🔴 自社以外の取引先企業を指定した（`PARTNER_ADMIN`）。`AC-4`。 */
  'OTHER_PARTNER_COMPANY',
  /** ホストロールなのに取引先企業が指定された（`Membership` の CHECK 制約と同じ規律）。 */
  'PARTNER_COMPANY_NOT_ALLOWED',
] as const;

export type InvitationDenialReason = (typeof INVITATION_DENIAL_REASONS)[number];

export type InvitationVerdict =
  | {
      readonly allowed: true;
      /** 🔴 作成される `Invitation.partnerCompanyId`。ホストロールなら null。 */
      readonly partnerCompanyId: string | null;
    }
  | { readonly allowed: false; readonly reason: InvitationDenialReason };

function deny(reason: InvitationDenialReason): InvitationVerdict {
  return { allowed: false, reason };
}

/**
 * 招待できるかを決める（docs/05 §6.4 #14 の「認可」欄）。
 *
 * 規則:
 *   - ホストの `OWNER` / `ADMIN` … テナント内の全ロールを招ける。
 *     パートナーロールを招くときは取引先企業の指定が必須（`AC-1`）。
 *   - `PARTNER_ADMIN` … **自社 + パートナーロールのみ**（`AC-4`）。
 *     取引先企業の指定は受け付けず、常に自社（ctx の所属）になる。
 *   - それ以外（`SALES` / `VIEWER` / `PARTNER_SALES`）… 招待できない。
 *
 * 🔴 「ホストロールに取引先企業が付く」「パートナーロールに取引先企業が付かない」の 2 つは
 *    `memberships` の CHECK 制約（docs/05 §3.3）と同じ規律であり、ここでも同じく拒否する。
 *    アプリで通しても受諾時に DB が弾くため、**受諾できない招待が作られるのを防ぐ**。
 */
export function decideInvitation(
  actor: InvitationActor,
  target: InvitationTarget,
): InvitationVerdict {
  const requested = target.partnerCompanyId ?? null;

  if (actor.partnerCompanyId === null) {
    // --- ホスト所属の実行者 ---
    if (actor.role !== 'OWNER' && actor.role !== 'ADMIN') return deny('ACTOR_ROLE_NOT_ALLOWED');
    if (isPartnerRole(target.role)) {
      if (requested === null) return deny('PARTNER_COMPANY_REQUIRED');
      return { allowed: true, partnerCompanyId: requested };
    }
    if (requested !== null) return deny('PARTNER_COMPANY_NOT_ALLOWED');
    return { allowed: true, partnerCompanyId: null };
  }

  // --- パートナー所属の実行者 ---
  if (actor.role !== 'PARTNER_ADMIN') return deny('ACTOR_ROLE_NOT_ALLOWED');
  // 🔴 ホストロール（自社 = ホストのアカウント）は招けない（AC-4）。
  if (!isPartnerRole(target.role)) return deny('TARGET_ROLE_NOT_ALLOWED');
  // 🔴 他社の取引先企業を指定させない。自社の指定は冗長だが受け入れる（同じ結論になるため）。
  if (requested !== null && requested !== actor.partnerCompanyId) return deny('OTHER_PARTNER_COMPANY');
  return { allowed: true, partnerCompanyId: actor.partnerCompanyId };
}
