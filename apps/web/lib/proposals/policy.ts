// apps/web/lib/proposals/policy.ts
// 🔴 「誰がレビュー依頼（#39）を出せるか」の判定（docs/05 §6.4 #39 / §9.10 ①）。T-07-08。純粋関数。
//
// docs/05 §9.10 ① は入口を「**作成者 / `SALES` / `ADMIN` のレビュー依頼**」と定めている。
// これは 2 つの立場を足したものである:
//   ① **その提案を作った本人** … パートナー所属でもよい（提案はパートナーが作る。越境経路 2）
//   ② **ホストの営業・管理者** … 提案先へ出すのはホストであり、承認・送信の当事者でもある
//      （`OWNER` を含む。`CLAUDE.md` §10.1「組織の全権」）
//
// 🔴 **パートナー所属の非作成者は入口にしない。** 同じ取引先の別の担当者がレビュー依頼を
//    出せるようにする理由が現時点で無く、広げるほど「誰が依頼したか」の説明責任が薄まる。
//    必要になったら `docs/05` §9.10 を先に直すこと（`CLAUDE.md` §8.7）。
//
// 🔴 **ロールだけで決めない。** `requireRole`（ルート）はロールの集合しか見ないため、
//    「パートナー所属の `PARTNER_SALES` が他人の提案のゲートを回す」を止められない。
//    行を読んでから本判定を通す（`lib/members/policy.ts` と同じ二段構え）。
import type { TenantRole } from '@ses/db';

/**
 * 🔴 `#39` の `requireRole`（docs/05 §6.4 #39）。**VIEWER を含まない**（`BR-31` / `F-004 AC-6`。
 *    `requireNotViewer` と二重に落とす）。
 *
 * 🔴 並び順は `TENANT_ROLES`（`@ses/db`）と同じにする（`PROJECT_EDITOR_ROLES` と同じ理由）。
 */
export const PROPOSAL_GATE_REQUEST_ROLES = [
  'OWNER',
  'ADMIN',
  'SALES',
  'PARTNER_ADMIN',
  'PARTNER_SALES',
] as const satisfies readonly TenantRole[];

/** 🔴 ホスト側でレビュー依頼を出せるロール（§9.10 ① の「`SALES` / `ADMIN`」+ `OWNER`）。 */
export const HOST_GATE_REQUEST_ROLES = [
  'OWNER',
  'ADMIN',
  'SALES',
] as const satisfies readonly TenantRole[];

export type GateRequestActor = {
  readonly userId: string;
  readonly role: TenantRole;
  /** `null` = ホスト所属。 */
  readonly partnerCompanyId: string | null;
};

export type GateRequestSubject = {
  readonly createdBy: string;
};

/**
 * レビュー依頼を出せるか（docs/05 §9.10 ①）。
 *
 * 🔴 **判定材料は ctx と「読んだ行」だけ**である。リクエスト入力を引数に取らない
 *    （`CLAUDE.md` §3.1 / `BR-03`）。
 */
export function canRequestProposalGate(
  actor: GateRequestActor,
  subject: GateRequestSubject,
): boolean {
  if (actor.userId === subject.createdBy) return true;
  return (
    actor.partnerCompanyId === null &&
    (HOST_GATE_REQUEST_ROLES as readonly TenantRole[]).includes(actor.role)
  );
}

// ============================================================================
// T-09-01: 提案の作成（#36）と編集（#37）
// ============================================================================

/**
 * 🔴 `#36` / `#37` の `requireRole`（docs/05 §6.5「T-09-01 の決着」）。**VIEWER を含まない**
 *    （`F-019` 関連ロール: `SALES` / `ADMIN` / `PARTNER_ADMIN` / `PARTNER_SALES`、`VIEWER` は閲覧のみ。
 *    `OWNER` は組織の全権。`CLAUDE.md` §10.1）。#39 の入口と同じ集合である —— 提案を作れる立場と
 *    レビューに出せる立場を別々に持つ理由が無い。
 */
export const PROPOSAL_EDITOR_ROLES = PROPOSAL_GATE_REQUEST_ROLES;

/** 画面（`S-016` / `S-020`）が導線を描くか決めるための判定。拒否の本体は API の `requireRole`。 */
export function isProposalEditorRole(role: TenantRole): boolean {
  return (PROPOSAL_EDITOR_ROLES as readonly TenantRole[]).includes(role);
}

export type ProposalEditActor = GateRequestActor;
export type ProposalEditSubject = GateRequestSubject;

/**
 * 🔴 提案を編集できるか（#37。`docs/04` §S-020 権限差分「取引先は自社が作成した提案のみ編集できる」）。
 *
 * **#39 の `canRequestProposalGate` と同じ判定**である（作成者 / ホストの `OWNER`・`ADMIN`・`SALES`）:
 * 経路 4 由来の `DRAFT` は提案先が空であり、それを埋める（#37）主体とレビューに出す（#39）主体を
 * 分けると、「埋められるのに出せない / 出せるのに埋められない」立場が生まれる。
 * 🔴 パートナー所属の非作成者は編集できない（同じ取引先の別の担当者にも開かない。#39 と同じ線）。
 *    広げたくなったら `docs/05` §6.5 / §9.10 を先に直す（`CLAUDE.md` §8.7）。
 */
export function canEditProposal(actor: ProposalEditActor, subject: ProposalEditSubject): boolean {
  return canRequestProposalGate(actor, subject);
}
