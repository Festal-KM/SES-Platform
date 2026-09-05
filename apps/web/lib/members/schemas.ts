// apps/web/lib/members/schemas.ts
// docs/05 §6.7 #83 / #84 / #85（メンバー一覧・ロール変更・無効化）の境界検証。T-04-09。
//
// 🔴 分離キー（`tenantId` / `partnerCompanyId`）を**キーとして持たない**（`F-003 AC-1` / `F-004 AC-2`）。
//    対象は path の `{id}`（= `Membership.id`）で受けるが、これは「操作対象の指定」であって
//    実行者のスコープではない。母集団は RLS の C5 が決め、境界外の ID は 404 になる（docs/05 §4.8）。
//
// 🔴 `Membership.id` を対象にする（`userId` ではない）。所属とロールを持つのは `Membership` であり、
//    「どの所属としてのロールを変えるのか」が ID の時点で確定していなければならない。
import { z } from 'zod';
import { TENANT_ROLES } from '@ses/db';
import { assertNoIsolationKeys, type AssertNoIsolationKeys } from '../api/isolation-keys';

/** `PUT /api/members/{id}/role` / `POST /api/members/{id}/revoke` の path params。 */
export const memberParamsSchema = z.object({ id: z.uuid() });

export type MemberParams = z.infer<typeof memberParamsSchema>;

export type MemberParamsIsolationGuard = AssertNoIsolationKeys<MemberParams>;

assertNoIsolationKeys(Object.keys(memberParamsSchema.shape), 'memberParamsSchema');

/**
 * `PUT /api/members/{id}/role`（#84）の body。
 * 🔴 `role` は `TENANT_ROLES`（`packages/db` が単一の出所）に縛る。個別に列挙し直さない。
 * 🔴 **所属（取引先企業）を受け取らない。** 所属を変える経路は存在しない
 *    （`lib/members/policy.ts` の `decideMemberRoleChange` のコメント参照）。
 */
export const changeMemberRoleBodySchema = z.object({ role: z.enum(TENANT_ROLES) });

export type ChangeMemberRoleBody = z.infer<typeof changeMemberRoleBodySchema>;

export type ChangeMemberRoleBodyIsolationGuard = AssertNoIsolationKeys<ChangeMemberRoleBody>;

assertNoIsolationKeys(Object.keys(changeMemberRoleBodySchema.shape), 'changeMemberRoleBodySchema');
