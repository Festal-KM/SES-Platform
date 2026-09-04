// packages/db/src/serializers/platform/provisioning.ts
// `A-014`「直近の開設」の運営者向けシリアライザ（docs/05 §5.5 第 2 層 / `F-001`。T-03-10）。
//
// 🔴 出すのは**状態と日時だけ**である（`CLAUDE.md` §10.5「運営者に必要なのは件数・状態・
//    エラーであって内容ではない」/ `BR-40`）。招待先のメールアドレスは、クエリ関数が
//    そもそも `select` しない（第 1 層）うえに、ここにフィールドが**存在しない**（第 2 層）。
import type { TenantLifecycleState } from '../../context.js';
import type { TenantSendingDomainState } from '../../schema-value-sets.js';

/**
 * 初期 `OWNER` 招待の状態（`docs/04` §A-014 の「招待の状態」列）。
 *
 * 🔴 `NOT_ISSUED`（API-A4 は成功したが API-A5 をまだ実行していない）を独立した値として持つ。
 *    `A-014` の目的は「開設して終わりにせず、取引先へ送信できる状態まで追う」ことであり、
 *    **招待を出し忘れたテナント**が `PENDING` に紛れると、その取りこぼしが見えなくなる。
 * 🔴 送信の成否（送信済み / 送信失敗）は `EmailDispatch` を持つ SP-04 の範囲である。
 *    Phase 0 では「発行したか・受諾されたか・期限切れか」までを返す。
 */
export const PROVISIONING_INVITATION_STATES = [
  'NOT_ISSUED',
  'PENDING',
  'ACCEPTED',
  'EXPIRED',
  'REVOKED',
] as const;

export type ProvisioningInvitationState = (typeof PROVISIONING_INVITATION_STATES)[number];

export type PlatformProvisioningRow = {
  readonly id: string;
  readonly name: string;
  readonly environment: string;
  readonly lifecycleState: string;
  readonly createdAt: Date;
  readonly invitation: {
    readonly acceptedAt: Date | null;
    readonly revokedAt: Date | null;
    readonly expiresAt: Date;
  } | null;
  readonly sendingDomain: {
    readonly state: string;
    readonly verifiedAt: Date | null;
  } | null;
  /** 期限切れの判定に使う基準時刻（引数で受ける。関数内で `new Date()` を呼ばない）。 */
  readonly now: Date;
};

/** `A-014`「直近の開設」の 1 行。 */
export type PlatformProvisioningItemView = {
  readonly id: string;
  readonly name: string;
  readonly environment: string;
  readonly lifecycleState: TenantLifecycleState;
  readonly createdAt: string;
  readonly invitationState: ProvisioningInvitationState;
  /**
   * 送信ドメインの検証状態。未登録なら `null`。
   * 🔴 `null` は「取引先へ 1 通も送れない」ことを意味する（`F-001 AC-4`）。
   *    `A-005` の監視項目 11 に即日現れる（SP-11）。
   */
  readonly sendingDomainState: TenantSendingDomainState | null;
};

function invitationStateOf(row: PlatformProvisioningRow): ProvisioningInvitationState {
  const invitation = row.invitation;
  if (invitation === null) return 'NOT_ISSUED';
  if (invitation.acceptedAt !== null) return 'ACCEPTED';
  if (invitation.revokedAt !== null) return 'REVOKED';
  if (invitation.expiresAt.getTime() <= row.now.getTime()) return 'EXPIRED';
  return 'PENDING';
}

/** 🔴 応答に出してよいフィールドの明示列挙。Prisma の行を素通しさせない。 */
export function toPlatformProvisioningItem(
  row: PlatformProvisioningRow,
): PlatformProvisioningItemView {
  return {
    id: row.id,
    name: row.name,
    environment: row.environment,
    lifecycleState: row.lifecycleState as TenantLifecycleState,
    createdAt: row.createdAt.toISOString(),
    invitationState: invitationStateOf(row),
    sendingDomainState:
      row.sendingDomain === null
        ? null
        : (row.sendingDomain.state as TenantSendingDomainState),
  };
}
