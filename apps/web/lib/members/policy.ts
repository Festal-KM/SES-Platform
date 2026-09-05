// apps/web/lib/members/policy.ts
// アカウント管理（ロール変更・無効化）の可否を決める**純粋関数**（`F-002 AC-3` / `AC-4`）。T-04-09。
//
// 🔴 なぜ判定を関数として切り出すか（`lib/invitations/policy.ts` と同じ理由）:
//    `F-002 AC-4`（`PARTNER_ADMIN` は自社配下のみ）は条件分岐がハンドラに散ると片方だけ緩む。
//    ここを唯一の判定にし、ユニットテストで全組み合わせを固定する。
//
// 🔴 分離キーの出どころ（`CLAUDE.md` §3.1 / `BR-03`）:
//    - 実行者（actor）の所属・ロールは**認証コンテキスト**からしか来ない。
//    - 対象（target）の所属・ロールは **`withTenant` の内側で読んだ `memberships` の行**から来る。
//      リクエストが渡すのは `membershipId`（操作対象の指定）だけであり、その行が見えるかどうかは
//      RLS が決める（見えなければ 404。docs/05 §4.8）。
//
// 🔴 **本モジュールは「見える範囲」を広げない。** 判定は必ず 3 層目である:
//      ① RLS（`memberships` の UPDATE は C3 = `partner_company_id IS NOT DISTINCT FROM app_partner_id()`）
//      ② Prisma 拡張（テナントキーの注入）
//      ③ 本モジュール（誰が誰に何をしてよいか）
//    ①だけでも「ホストがパートナーの `Membership` を書き換える」は 0 件更新になるが、
//    それでは**利用者に理由が伝わらない**（404 と区別できない）。③は理由を返すためにある。
import type { TenantRole } from '@ses/db';
import { isPartnerRole } from '../tenants/roles';

/**
 * 🔴 アカウント管理を行い**うる**ロール（`F-002` 関連ロール:
 *    `OWNER` / `ADMIN`（テナント全体）、`PARTNER_ADMIN`（自社配下のみ））。
 *
 * 🔴 `requireRole`（docs/05 §6.2）に渡す粗いゲートであり、対象まで含めた可否は
 *    `decideMemberRoleChange` / `decideMemberRevoke` が決める（2 段構え）。
 *    ずれは `policy.test.ts` が機械的に検知する（招待側の `INVITATION_ISSUER_ROLES` と同じ規律）。
 */
export const MEMBER_MANAGER_ROLES = ['OWNER', 'ADMIN', 'PARTNER_ADMIN'] as const satisfies
  readonly TenantRole[];

export function isMemberManagerRole(role: TenantRole): boolean {
  return (MEMBER_MANAGER_ROLES as readonly TenantRole[]).includes(role);
}

/** 操作する利用者（🔴 すべて認証コンテキスト由来）。 */
export type MemberActor = {
  readonly role: TenantRole;
  /** null = ホスト所属。 */
  readonly partnerCompanyId: string | null;
  readonly userId: string;
};

/** 操作の対象（🔴 すべて `withTenant` の内側で読んだ `memberships` 行由来）。 */
export type MemberTarget = {
  readonly userId: string;
  readonly role: TenantRole;
  /** null = ホスト所属。 */
  readonly partnerCompanyId: string | null;
  readonly revoked: boolean;
};

/**
 * 判定に要る「数えないと分からない事実」。
 * 🔴 純粋関数に保つため、DB を読むのは呼び出し側（サービス層）である。
 */
export type MemberFacts = {
  /** 有効な（`revokedAt IS NULL`）`OWNER` の `Membership` 件数。 */
  readonly activeOwnerCount: number;
};

export const MEMBER_DENIAL_REASONS = [
  /** 実行者のロールにアカウント管理の権限が無い（`SALES` / `VIEWER` / `PARTNER_SALES`）。 */
  'ACTOR_ROLE_NOT_ALLOWED',
  /**
   * 🔴 実行者の所属の外にあるアカウントである（`F-002 AC-4`）。
   *    - `PARTNER_ADMIN` → 他社・ホストのアカウント（**RLS で行自体が見えないので通常 404 が先に返る**）
   *    - ホストの `OWNER` / `ADMIN` → パートナー配下のアカウント（行は見えるが書けない。C3）
   */
  'OUT_OF_SCOPE',
  /** 🔴 自分自身の `Membership`（自己昇格・自己ロックアウトの経路を作らない）。 */
  'SELF',
  /** 付与しようとしたロールが、対象の所属（ホスト / パートナー）と噛み合わない。 */
  'TARGET_ROLE_NOT_ALLOWED',
  /** すでに無効化済みの `Membership`（ロール変更の対象にならない）。 */
  'ALREADY_REVOKED',
  /** 🔴 最後の有効な `OWNER` を降格・無効化しようとした（テナントが管理不能になる）。 */
  'LAST_OWNER',
] as const;

export type MemberDenialReason = (typeof MEMBER_DENIAL_REASONS)[number];

export type MemberVerdict =
  | { readonly allowed: true }
  | { readonly allowed: false; readonly reason: MemberDenialReason };

const ALLOWED: MemberVerdict = { allowed: true };

function deny(reason: MemberDenialReason): MemberVerdict {
  return { allowed: false, reason };
}

/**
 * ロール変更・無効化に共通の判定（実行者の資格 → 射程 → 自分自身）。
 *
 * 🔴 順序に意味がある。権限の無い実行者に「その対象が自分の射程内か」を教えない
 *    （招待側の `decideInvitation` と同じ考え方）。
 */
function decideCommon(actor: MemberActor, target: MemberTarget): MemberVerdict {
  if (!isMemberManagerRole(actor.role)) return deny('ACTOR_ROLE_NOT_ALLOWED');

  // 🔴 ロールと所属の組み合わせを fail-closed で確かめる。`memberships` の CHECK 制約により
  //    「ホスト所属の `PARTNER_ADMIN`」「パートナー所属の `OWNER`」は存在しえないが、
  //    ここで前提を置かずに拒否しておくことで、制約が緩んだときに権限が広がらない。
  if (actor.partnerCompanyId === null) {
    if (actor.role !== 'OWNER' && actor.role !== 'ADMIN') return deny('ACTOR_ROLE_NOT_ALLOWED');
  } else if (actor.role !== 'PARTNER_ADMIN') {
    return deny('ACTOR_ROLE_NOT_ALLOWED');
  }

  // 🔴 射程は「実行者と同じ所属」だけである（`F-002 AC-4`）。この 1 本の等値で
  //    ①`PARTNER_ADMIN` → 他社 ②`PARTNER_ADMIN` → ホスト ③ホスト → パートナー配下
  //    のすべてを閉じる。RLS の C3（`memberships` の UPDATE）と**同じ述語**である。
  if (target.partnerCompanyId !== actor.partnerCompanyId) return deny('OUT_OF_SCOPE');

  // 🔴 自分自身は対象にできない。自己昇格（`ADMIN` → `OWNER`）も、
  //    自分を無効化して復旧できなくすることも、どちらも起こさない。
  if (target.userId === actor.userId) return deny('SELF');

  return ALLOWED;
}

/**
 * ロールを変更してよいか（`F-002 AC-3` / `AC-4`。docs/05 §6.7 #84）。
 *
 * 🔴 付与できるロールは**対象の所属の側**に閉じる:
 *    ホスト所属の `Membership` にはホストロールだけ、パートナー配下にはパートナーロールだけ。
 *    これは `memberships` の CHECK 制約（`(role IN (PARTNER_*)) = (partner_company_id IS NOT NULL)`）
 *    と同じ規律であり、アプリで通しても DB が弾く。**受け入れられない要求を先に断る**ために置く
 *    （`decideInvitation` が「受諾できない招待を作らない」ために同じ判定を持つのと同じ）。
 *
 * 🔴 所属を変える経路は存在しない。`Membership.partnerCompanyId` を書き換える API を作らない
 *    （書き換えは「他社のアカウントを自社に移す」ことと同義であり、`CLAUDE.md` §3.1 の第二境界を
 *    その場で破る。所属を変えるには無効化して新たに招待する）。
 */
export function decideMemberRoleChange(
  actor: MemberActor,
  target: MemberTarget,
  nextRole: TenantRole,
  facts: MemberFacts,
): MemberVerdict {
  const common = decideCommon(actor, target);
  if (!common.allowed) return common;

  // 無効化済みの所属にロールを付け直しても意味が無い（復帰は招待の再発行）。
  if (target.revoked) return deny('ALREADY_REVOKED');

  if (isPartnerRole(nextRole) !== (target.partnerCompanyId !== null)) {
    return deny('TARGET_ROLE_NOT_ALLOWED');
  }

  // 🔴 最後の `OWNER` を降格させない（テナントの契約者が居ない状態を作らない）。
  //    `ADMIN` は `OWNER` を降格できるが、最後の 1 人だけは止める。
  //    ⚠️ 「最後の `PARTNER_ADMIN`」には同じ規則を置かない —— そちらはホストの
  //    `OWNER` / `ADMIN` が招待を出し直せば復旧でき、不可逆ではないためである。
  if (target.role === 'OWNER' && nextRole !== 'OWNER' && facts.activeOwnerCount <= 1) {
    return deny('LAST_OWNER');
  }

  return ALLOWED;
}

/**
 * 無効化してよいか（`F-002 AC-3` / `AC-4`。docs/05 §6.7 #85）。
 *
 * 🔴 すでに無効化済みかどうかは**認可の問題ではない**ので、ここでは見ない
 *    （冪等な no-op として扱うのはサービス層の責務。#13 の停止・再開と同じ規律）。
 */
export function decideMemberRevoke(
  actor: MemberActor,
  target: MemberTarget,
  facts: MemberFacts,
): MemberVerdict {
  const common = decideCommon(actor, target);
  if (!common.allowed) return common;

  // 🔴 すでに無効化済みなら `activeOwnerCount` に含まれていないため、
  //    「最後の OWNER」の判定は有効な行に対してだけ働く。
  if (target.role === 'OWNER' && !target.revoked && facts.activeOwnerCount <= 1) {
    return deny('LAST_OWNER');
  }

  return ALLOWED;
}
