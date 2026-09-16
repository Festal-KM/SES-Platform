// packages/db/src/tenant-admin-recipients.ts
// 🔴 テナント管理者（ホスト所属の `OWNER` / `ADMIN`）宛の運用メールの**宛先の引き当て**
//    （docs/02 `F-027` 処理④「上限接近でテナント管理者に通知」/ docs/05 §8.2）。T-10-03。
//
// 🔴 分類は自己申告させない（docs/05 §8.2）。母集団は `memberships`（C5 PARTY）で
//    「ホスト所属（`partner_company_id IS NULL`）かつ管理ロール」に絞り、宛先 1 人ごとに
//    `resolveRecipientClass` へ通して `HOST_MEMBER`（分類 1）だけを残す。
//    分類 1 は `sandbox` でも実送信される（`CLAUDE.md` §11.1 / `F-054 AC-9`「上限接近の通知」）。
// 🔴 `SALES` / `VIEWER` / パートナーロールには送らない —— 残量・上限値はテナントの契約情報であり、
//    通知先も `OWNER` / `ADMIN` に限る（`F-027` 関連ロール）。
import type { SystemTenantCtx, TenantRole } from './context.js';
import { resolveRecipientClass } from './recipient.js';
import { runInTenantTransaction } from './with-tenant.js';

const TENANT_ADMIN_ROLES = ['OWNER', 'ADMIN'] as const satisfies readonly TenantRole[];

/** 通知の宛先 1 人。`recipientClass` は `resolveRecipientClass` が導いた値である（常に分類 1）。 */
export type TenantAdminRecipient = {
  readonly userId: string;
  readonly email: string;
  readonly recipientClass: 'HOST_MEMBER';
};

/**
 * ホスト所属の管理者（分類 1）を、決定的な順序（`users.id` 昇順）で返す。
 * 呼び出せるのはジョブ（`SystemTenantCtx`）だけ。無効化済み（`disabled_at`）は含めない。
 */
export async function readTenantAdminRecipients(ctx: SystemTenantCtx): Promise<readonly TenantAdminRecipient[]> {
  return runInTenantTransaction(
    { tenantId: ctx.tenantId, partnerCompanyId: null, actorUserId: ctx.userId },
    async (tx) => {
      const memberships = await tx.membership.findMany({
        where: { revokedAt: null, partnerCompanyId: null, role: { in: [...TENANT_ADMIN_ROLES] } },
        select: { userId: true },
      });
      const userIds = [...new Set(memberships.map((membership) => membership.userId))].sort();
      if (userIds.length === 0) return [];

      const users = await tx.user.findMany({
        where: { id: { in: userIds }, ownerPartnerCompanyId: null, disabledAt: null },
        select: { id: true, email: true },
        orderBy: { id: 'asc' },
      });

      const recipients: TenantAdminRecipient[] = [];
      for (const user of users) {
        // 🔴 `fallback` は型により分類 3 / 4 しか渡せない。引けなかった宛先はモック側に倒れて除外される。
        const recipientClass = await resolveRecipientClass(tx, { userId: user.id }, 'CLIENT');
        if (recipientClass !== 'HOST_MEMBER') continue;
        recipients.push({ userId: user.id, email: user.email, recipientClass });
      }
      return recipients;
    },
  );
}
