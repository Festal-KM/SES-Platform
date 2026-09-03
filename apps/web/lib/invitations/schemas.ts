// apps/web/lib/invitations/schemas.ts
// docs/05 §6.4 #14（招待の発行）/ §6.3 #7（受諾）の request スキーマ。
//
// 🔴 分離キー（`tenantId` / `partnerCompanyId`）を**キーとして持たない**（`F-003 AC-1` / `F-004 AC-2`）。
//    未知のキーは `z.object()` の既定（strip）で黙って捨てる（`schemas.ts` と同じ理由 ——
//    `strict()` にすると「改変すると応答が変わる」ことになり AC-1 の趣旨に反する）。
//
// ⚠️ docs/05 §6.4 #14 の request は `{ email, role, partnerCompanyId? }` だが、
//    `partnerCompanyId` は `apps/web/lib/api/isolation-keys.ts` が禁じるキーそのものである。
//    Phase 0 はホストロール宛のみ（`docs/sprints/SP-03` T-03-03）で不要なため、**ここでは持たない**。
//    SP-04 が取引先招待を実装するときに、「実行者の分離キー」ではなく「招待先の選択」として
//    どう受け取るか（キー名を含む）を決める必要がある。**そのまま `partnerCompanyId` を足すと
//    このガードが落ちる**（意図した強制装置である）。
import { z } from 'zod';
import { DISPLAY_NAME_MAX_LENGTH, EMAIL_MAX_LENGTH, PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH } from '@ses/config';
import { TENANT_ROLES } from '@ses/db';
import { assertNoIsolationKeys, type AssertNoIsolationKeys } from '../api/isolation-keys';

/**
 * `POST /api/invitations`（docs/05 §6.4 #14）の body。
 * 🔴 メールは小文字化して保存・照合する（`users.email` の照合が `lower(email)` であるため）。
 * 🔴 `role` は `TENANT_ROLES`（`packages/db` が単一の出所）に縛る。個別に列挙し直さない。
 */
export const createInvitationBodySchema = z.object({
  email: z.string().trim().toLowerCase().min(1).max(EMAIL_MAX_LENGTH).email(),
  role: z.enum(TENANT_ROLES),
});

export type CreateInvitationBody = z.infer<typeof createInvitationBodySchema>;

export type CreateInvitationBodyIsolationGuard = AssertNoIsolationKeys<CreateInvitationBody>;

assertNoIsolationKeys(Object.keys(createInvitationBodySchema.shape), 'createInvitationBodySchema');

/**
 * `POST /api/invitations/{token}/accept`（docs/05 §6.3 #7）の body。
 * 🔴 ロール・所属・メールアドレスを**受け取らない**。すべて招待行から決まる（CLAUDE.md §3.1）。
 */
export const acceptInvitationBodySchema = z.object({
  displayName: z.string().trim().min(1).max(DISPLAY_NAME_MAX_LENGTH),
  password: z.string().min(PASSWORD_MIN_LENGTH).max(PASSWORD_MAX_LENGTH),
});

export type AcceptInvitationBody = z.infer<typeof acceptInvitationBodySchema>;

export type AcceptInvitationBodyIsolationGuard = AssertNoIsolationKeys<AcceptInvitationBody>;

assertNoIsolationKeys(Object.keys(acceptInvitationBodySchema.shape), 'acceptInvitationBodySchema');
