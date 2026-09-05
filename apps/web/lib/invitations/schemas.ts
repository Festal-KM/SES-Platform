// apps/web/lib/invitations/schemas.ts
// docs/05 §6.4 #14（招待の発行）/ §6.3 #7（受諾）の request スキーマ。
//
// 🔴 分離キー（`tenantId` / `partnerCompanyId`）を**キーとして持たない**（`F-003 AC-1` / `F-004 AC-2`）。
//    未知のキーは `z.object()` の既定（strip）で黙って捨てる（`schemas.ts` と同じ理由 ——
//    `strict()` にすると「改変すると応答が変わる」ことになり AC-1 の趣旨に反する）。
//
// 🔴 T-04-07（キー名の決着。docs/05 §6.4 #14 の ⚠️ を解消した）:
//    docs/05 §6.4 #14 の request は `{ email, role, partnerCompanyId? }` だが、
//    `partnerCompanyId` は `apps/web/lib/api/isolation-keys.ts` が禁じるキーそのものであり、
//    そのまま足すとルート構築時に落ちる（T-03-03 が意図して残した強制装置）。
//    **「実行者の分離キー」ではなく「招待先の選択」であることをキー名で示す**ため、
//    `targetPartnerCompanyId` として受け取る（判断の全文は `isolation-keys.ts` の
//    `TARGET_SELECTION_KEYS` のコメント。ガードは 1 mm も緩めていない）。
import { z } from 'zod';
import { DISPLAY_NAME_MAX_LENGTH, EMAIL_MAX_LENGTH, PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH } from '@ses/config';
import { TENANT_ROLES } from '@ses/db';
import { assertNoIsolationKeys, type AssertNoIsolationKeys } from '../api/isolation-keys';

/**
 * `POST /api/invitations`（docs/05 §6.4 #14）の body。
 * 🔴 メールは小文字化して保存・照合する（`users.email` の照合が `lower(email)` であるため）。
 * 🔴 `role` は `TENANT_ROLES`（`packages/db` が単一の出所）に縛る。個別に列挙し直さない。
 * 🔴 `targetPartnerCompanyId` は**招待先の選択**であり、実行者の参照範囲を決めない
 *    （`F-007`。ホストの `OWNER` / `ADMIN` が「どの取引先に招くか」を選ぶ）。
 *    `PARTNER_ADMIN` が指定しても採用されず、常に自社になる（`decideInvitation`。`F-002 AC-4`）。
 *    値の実在確認は `issueInvitation` が **RLS の母集団に照合して**行う（他テナントの ID を書けない）。
 */
export const createInvitationBodySchema = z.object({
  email: z.string().trim().toLowerCase().min(1).max(EMAIL_MAX_LENGTH).email(),
  role: z.enum(TENANT_ROLES),
  targetPartnerCompanyId: z.uuid().optional(),
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
