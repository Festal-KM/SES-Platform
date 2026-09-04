// apps/web/app/admin/tenants/_lib/labels.ts
// `A-002` / `A-003` / `A-014` で共通の表示ラベル（docs/04 §A-002 / §A-003 / §A-014）。
//
// 🔴 文言は `packages/i18n` に集約する（CLAUDE.md §3.5）。ここは状態からメッセージキーへの
//    写像だけを持つ（テンプレートリテラルで動的にキーを組み立てない。誤ったキーの参照を
//    コンパイルで防ぐ）。
// 🔴 `TenantLifecycleState` / `Tenant.environment` の写像は**主平面（`S-035`）でも使う**ため
//    `apps/web/lib/tenants/labels.ts` に置き、ここから re-export する。管理平面のファイルを
//    主平面から import させない（この区画は `@ses/db/platform` を import できる唯一の区画であり、
//    参照が生まれると主平面から分離バイパスへ 1 ホップで届く）。
import type { TenantSendingDomainState } from '@ses/db';
import type { ProvisioningInvitationState } from '@ses/db/platform';
import type { MessageKey } from '@ses/i18n';

export {
  TENANT_LIFECYCLE_STATE_MESSAGE_KEYS,
  tenantEnvironmentMessageKey,
} from '../../../../lib/tenants/labels';

/**
 * 🔴 `A-014`「直近の開設」の招待の状態（T-03-10）。`Record<…>` にしているため、
 *    状態が増えたらコンパイルが落ちる（表示漏れが「その状態だけ空欄」にならない）。
 */
export const PROVISIONING_INVITATION_MESSAGE_KEYS: Readonly<
  Record<ProvisioningInvitationState, MessageKey>
> = {
  NOT_ISSUED: 'admin.provisioning.invitation.NOT_ISSUED',
  PENDING: 'admin.provisioning.invitation.PENDING',
  ACCEPTED: 'admin.provisioning.invitation.ACCEPTED',
  EXPIRED: 'admin.provisioning.invitation.EXPIRED',
  REVOKED: 'admin.provisioning.invitation.REVOKED',
};

/** 🔴 送信ドメインの検証状態（`F-001 AC-4`）。`null`（未登録）は呼び出し側が別文言で出す。 */
export const SENDING_DOMAIN_STATE_MESSAGE_KEYS: Readonly<
  Record<TenantSendingDomainState, MessageKey>
> = {
  REGISTERED: 'admin.provisioning.sendingDomain.REGISTERED',
  PENDING: 'admin.provisioning.sendingDomain.PENDING',
  VERIFIED: 'admin.provisioning.sendingDomain.VERIFIED',
  FAILED: 'admin.provisioning.sendingDomain.FAILED',
};
