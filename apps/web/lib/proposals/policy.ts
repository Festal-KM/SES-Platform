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
import { isManualProposalTransition, type ProposalState } from '@ses/domain';

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

// ============================================================================
// T-09-02: 状態遷移（#48）の実行者（docs/05 §6.5「#48 の実装の決着」/ docs/02 章 4.2 `F-024` `F-025` /
// 章 5.1 遷移 4・11〜15 / docs/04 §S-023 §S-024 権限差分）
// ============================================================================
//
// 🔴 #48 が受けるのは所有者 `MANUAL` の 10 本だけ（`isManualProposalTransition`。専有の遷移は
//    `transitionProposal` が 422 で止めるので、ここには MANUAL しか来ない前提で書くが、
//    念のため MANUAL でなければ `false` を返す）。
//
// 立場ごとの線:
//   - **ホストの `OWNER` / `ADMIN` / `SALES`** … MANUAL のすべて（提案先とやり取りするのはホスト）
//   - **取引先（`PARTNER_ADMIN` / `PARTNER_SALES`）** … 自社が作成した提案（母集団は C5）に対して、
//     `docs/04` §S-024「自社提案に対する記録（面談実施・辞退）まで」= `INTERVIEW_SCHEDULED → INTERVIEWED` /
//     `INTERVIEWED → RESULT_PENDING` / 4 状態からの `→ WITHDRAWN`。🔴 **面談日程の確定
//     （`SUBMITTED → INTERVIEW_SCHEDULED`。`F-041` の `PA` / `PS` = `−`）と結果の確定（`RESULT_PENDING →
//     WON` / `LOST`。提案先からホストに届く事実）は取引先からは行えない。**
//   - **`GATE_FAILED → DRAFT`**（修正のための差し戻し。docs/02 章 5.1 遷移 4「提案作成者」）… #37 / #39 と
//     同じ `canEditProposal`（作成者 / ホストの `OWNER`・`ADMIN`・`SALES`）。戻す主体と直す主体を分けない。
//   - **`VIEWER`** … 一切不可（ルートの `requireRole` + `requireNotViewer` が先に落とす。ここでも `false`）。
//
// 🔴 **ロールだけで決めない。** `requireRole`（ルート）はロールの集合しか見ないため、「取引先が結果を確定する」
//    「他人の `GATE_FAILED` を戻す」を止められない。行を読んでから本判定を通す。

/**
 * 🔴 `#48` の `requireRole`。**VIEWER を含まない**（`BR-31` / `F-024` `F-025` の `VI` = `○`）。
 *    #36 / #37 / #39 と同じ集合 —— 提案を作れる立場と商談を記録できる立場を別々に持つ理由が無い。
 */
export const PROPOSAL_TRANSITION_ROLES = PROPOSAL_GATE_REQUEST_ROLES;

/** ホスト側で商談の進行・結果・辞退を記録できるロール（`OWNER` / `ADMIN` / `SALES`）。 */
export const HOST_TRANSITION_ROLES = HOST_GATE_REQUEST_ROLES;

/** 取引先側で記録できるロール。 */
export const PARTNER_TRANSITION_ROLES = ['PARTNER_ADMIN', 'PARTNER_SALES'] as const satisfies readonly TenantRole[];

/**
 * 🔴 取引先が自社提案に対して記録できる遷移（`docs/04` §S-024 権限差分「面談実施・辞退」）。
 *    `SUBMITTED → INTERVIEW_SCHEDULED` と `RESULT_PENDING → WON` / `LOST` を**含まない**。
 *    広げたくなったら `docs/04` §S-024 / `docs/05` §6.5 を先に直す（`CLAUDE.md` §8.7）。
 */
export const PARTNER_RECORDABLE_PROPOSAL_TRANSITIONS: ReadonlyArray<readonly [ProposalState, ProposalState]> = [
  ['INTERVIEW_SCHEDULED', 'INTERVIEWED'],
  ['INTERVIEWED', 'RESULT_PENDING'],
  ['SUBMITTED', 'WITHDRAWN'],
  ['INTERVIEW_SCHEDULED', 'WITHDRAWN'],
  ['INTERVIEWED', 'WITHDRAWN'],
  ['RESULT_PENDING', 'WITHDRAWN'],
];

export type ProposalTransitionActor = GateRequestActor;
export type ProposalTransitionSubject = GateRequestSubject;

export type ProposalTransitionPair = {
  readonly from: ProposalState;
  readonly to: ProposalState;
};

function isPartnerRecordable(pair: ProposalTransitionPair): boolean {
  return PARTNER_RECORDABLE_PROPOSAL_TRANSITIONS.some(([from, to]) => from === pair.from && to === pair.to);
}

/**
 * 状態遷移（#48）を行えるか。
 *
 * 🔴 **判定材料は ctx と「読んだ行」と遷移の組だけ**である。リクエスト入力（body の `to` は遷移の組に
 *    畳まれた後）以外を引数に取らない（`CLAUDE.md` §3.1 / `BR-03`）。
 */
export function canTransitionProposal(
  actor: ProposalTransitionActor,
  subject: ProposalTransitionSubject,
  pair: ProposalTransitionPair,
): boolean {
  if (!isManualProposalTransition(pair.from, pair.to)) return false;
  if (actor.role === 'VIEWER') return false;

  // 修正のための差し戻し（遷移 4）: 直す主体と同じ線。
  if (pair.from === 'GATE_FAILED' && pair.to === 'DRAFT') return canEditProposal(actor, subject);

  if (actor.partnerCompanyId === null) {
    return (HOST_TRANSITION_ROLES as readonly TenantRole[]).includes(actor.role);
  }
  return (PARTNER_TRANSITION_ROLES as readonly TenantRole[]).includes(actor.role) && isPartnerRecordable(pair);
}

// ============================================================================
// T-09-03: 承認・却下（#41 / #42）の実行者（docs/05 §6.5 #41 / #42 / `docs/04` §S-021 権限差分 /
// docs/02 `F-021` 関連ロール / `CLAUDE.md` §3.3）
// ============================================================================
//
// 🔴 **承認・却下できるのはホスト所属の `OWNER` / `ADMIN` / `SALES` だけ**である。提案先へ出すのはホストであり
//    （越境経路 2 の受け手）、取引先（`PARTNER_ADMIN` / `PARTNER_SALES`）は「自社が作成した提案の内容とゲート結果を
//    確認する」まで（`docs/02` `F-021` 関連ロール / `docs/04` §S-021「ホスト宛の最終承認・却下のアクションは表示されない」）。
//    `VIEWER` は一切不可（`F-004 AC-6`）。代理閲覧中の運営者は `AuthenticatedTenantCtx` を持たず（Phase 2 の
//    `F-060`。別経路）、この判定に到達しない。
// 🔴 **ロールだけで決めない。** `requireRole`（ルート）はロールの集合しか見ない。ホストの 3 ロールは所属が
//    `null` の会員にしか付かない（`memberships` の CHECK）が、判定はここでも `partnerCompanyId === null` を要求する
//    （ロール表の変更で第二境界が緩まないよう二重にする）。
// 🔴 判定材料は ctx だけである（提案の行の値で緩めない —— 「作成者だから承認できる」を作ると、取引先が自社の提案を
//    自分で承認して送れる経路になる。`CLAUDE.md` §3.3「既定は人間承認必須」の「人間」はホストの承認者である）。

/**
 * 🔴 `#41` / `#42` の `requireRole`（docs/05 §6.5 #41「`OWNER`/`ADMIN`/`SALES`」）。**取引先と VIEWER を含まない。**
 *    並び順は `TENANT_ROLES`（`@ses/db`）と同じ。
 */
export const PROPOSAL_APPROVAL_ROLES = HOST_GATE_REQUEST_ROLES;

export type ProposalApprovalActor = Pick<GateRequestActor, 'role' | 'partnerCompanyId'>;

/** 承認・却下（#41 / #42）を行えるか。🔴 判定材料は ctx だけ（リクエスト入力・行の値を引数に取らない）。 */
export function canApproveProposal(actor: ProposalApprovalActor): boolean {
  return actor.partnerCompanyId === null && (PROPOSAL_APPROVAL_ROLES as readonly TenantRole[]).includes(actor.role);
}

/** 画面（`S-020` / `S-021`）が承認の導線を描くか決めるための判定。拒否の本体は API の `requireRole` + `canApproveProposal`。 */
export function isProposalApproverRole(role: TenantRole): boolean {
  return (PROPOSAL_APPROVAL_ROLES as readonly TenantRole[]).includes(role);
}

// ============================================================================
// T-09-06: 送信の要求（#43）の実行者（docs/05 §6.5 #43 / docs/02 `F-022` 関連ロール / `CLAUDE.md` §3.3）
// ============================================================================
//
// 🔴 **送信を要求できるのはホスト所属の `OWNER` / `ADMIN` / `SALES` だけ**である（`F-022` 関連ロール「`OWNER` / `ADMIN` /
//    `SALES`（送信の実行）、`VIEWER`（不可）」）。提案先へ出すのはホストであり、取引先は自社の提案を自分で送れない
//    （承認と同じ線。`canApproveProposal`）。T-09-05 の申し送り 10: `nextSendAttemptSeq` は取引先文脈でも呼べてしまう
//    （C2 で常に 1 が返る = 黙って誤った採番）ため、**`requireRole` で取引先を先に弾く**。
// 🔴 判定材料は ctx だけ（行の値で緩めない）。ロール表の変更で第二境界が緩まないよう `partnerCompanyId === null` を要求する。

/** 🔴 `#43` の `requireRole`。承認（#41 / #42）と同じ集合 —— 承認できる立場と送信を要求できる立場を別々に持つ理由が無い。 */
export const PROPOSAL_SUBMIT_ROLES = PROPOSAL_APPROVAL_ROLES;

/** 送信の要求（#43）を行えるか。🔴 判定材料は ctx だけ。 */
export function canSubmitProposal(actor: ProposalApprovalActor): boolean {
  return actor.partnerCompanyId === null && (PROPOSAL_SUBMIT_ROLES as readonly TenantRole[]).includes(actor.role);
}
