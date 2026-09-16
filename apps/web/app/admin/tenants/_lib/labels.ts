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
import type { TenantHealthSignal, TenantListSortKey } from '@ses/domain';
import type { MessageKey } from '@ses/i18n';
import type { BadgeVariant } from '@ses/ui';

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

// ---------------------------------------------------------------------------
// T-11-01: `A-002` の健全性（異常度）と並び順（docs/04 §A-002 / docs/05 §6.9 API-A2 / `F-056 AC-2`）。
// ---------------------------------------------------------------------------

/**
 * 🔴 異常のシグナル → 文言キー。`Record<…>` なので `TENANT_HEALTH_SIGNALS` が増えたらコンパイルが落ちる
 *    （表示漏れが「そのシグナルだけ空欄」にならない）。文言に理由の自由文・閾値の数字を含めない。
 */
export const TENANT_HEALTH_SIGNAL_MESSAGE_KEYS: Readonly<Record<TenantHealthSignal, MessageKey>> = {
  TRIAL_EXPIRED: 'admin.tenants.health.signal.TRIAL_EXPIRED',
  INACTIVE: 'admin.tenants.health.signal.INACTIVE',
  SEATS_UNUSED: 'admin.tenants.health.signal.SEATS_UNUSED',
  NO_PARTNERS: 'admin.tenants.health.signal.NO_PARTNERS',
  TRIAL_EXPIRING: 'admin.tenants.health.signal.TRIAL_EXPIRING',
};

/**
 * 🔴 色分け（docs/04 §5-8「`A-002` で最も強調するのは異常の種別」）: 期限切れ・停滞 = `danger`（使われていない /
 *    失われかける）、席の未利用・パートナー 0・期限接近 = `warning`（定着していない / まだ期限内）。
 */
export const TENANT_HEALTH_SIGNAL_BADGE_VARIANTS: Readonly<Record<TenantHealthSignal, BadgeVariant>> = {
  TRIAL_EXPIRED: 'danger',
  INACTIVE: 'danger',
  SEATS_UNUSED: 'warning',
  NO_PARTNERS: 'warning',
  TRIAL_EXPIRING: 'warning',
};

export const TENANT_LIST_SORT_MESSAGE_KEYS: Readonly<Record<TenantListSortKey, MessageKey>> = {
  health: 'admin.tenants.sort.health',
  name: 'admin.tenants.sort.name',
  createdAt: 'admin.tenants.sort.createdAt',
};
