'use client';

// apps/web/app/(main)/settings/partner-companies/members-panel.tsx
// `S-014` セクション 2「配下アカウント」+ `PARTNER_ADMIN` のアカウント管理（`F-002 AC-3` / `AC-4`）。T-04-09。
//
// 🔴 **`PARTNER_ADMIN` の入口はここである**（`docs/04` §S-035 権限差分:「`PARTNER_ADMIN` は
//    自社配下のアカウントのみを別の入口（`S-014` の自社詳細）から管理し、`S-035` には到達しない」）。
// 🔴 一覧に何が出るかを画面が決めていない。母集団は `#83` の応答（= RLS の C5）であり、
//    パートナーには**自社配下しか返ってこない**（`F-002 AC-4`）。ここでの絞り込みは
//    「選択中の取引先の行だけを表示する」という**表示上の**都合であって、境界ではない。
// 🔴 ロール変更・無効化には**確認ステップ**を置く（`docs/04` §S-035「操作と結果」）。
//    変更前後のロールと「その結果できなくなること / できるようになること」を必ず出す ——
//    権限の変更は、実行した本人にも影響が見えないまま効いてしまう操作だからである。
// 🔴 Tier 3（デスクトップ主体）だが**モバイルで遮断しない**（`CLAUDE.md` §13.3）。
//    一覧は横スクロールで劣化させ、非表示にはしない。
import { useState, type FormEvent } from 'react';
import { Button } from '@ses/ui';
import type { TenantRole } from '@ses/db';
import { formatDateTimeJst } from '../../../../lib/format/datetime';
import type { InvitationIssueView } from '../../../../lib/invitations/invite-link';
import type { MemberStatus, MemberView } from '../../../../lib/members/service';
import { SandboxInviteLinkPanel, type InviteLinkPanelMessages } from './invite-link-panel';

export type MembersPanelMessages = InviteLinkPanelMessages & {
  readonly section: string;
  readonly readOnlyNote: string;
  readonly empty: string;
  readonly valueNone: string;

  readonly columnName: string;
  readonly columnEmail: string;
  readonly columnRole: string;
  readonly columnStatus: string;
  readonly columnLastLogin: string;
  readonly columnActions: string;

  readonly statusLabels: Readonly<Record<MemberStatus, string>>;
  readonly roleLabels: Readonly<Record<TenantRole, string>>;
  /** 🔴 確認ステップで「できること / できなくなること」を出すための説明（`docs/04` §S-035）。 */
  readonly roleCapabilities: Readonly<Record<TenantRole, string>>;

  readonly self: string;

  readonly roleChangeLabel: string;
  readonly roleChangeSubmit: string;
  readonly roleChangeConfirmTitle: string;
  readonly roleChangeConfirmBefore: string;
  readonly roleChangeConfirmAfter: string;
  readonly roleChangeConfirm: string;
  readonly roleChangeCancel: string;
  readonly roleChangeSubmitting: string;
  readonly roleChangeDone: string;
  readonly roleChangeError: string;

  readonly revokeSubmit: string;
  readonly revokeConfirmTitle: string;
  readonly revokeConfirmText: string;
  readonly revokeConfirm: string;
  readonly revokeCancel: string;
  readonly revokeSubmitting: string;
  readonly revokeDone: string;
  readonly revokeError: string;

  readonly inviteSection: string;
  readonly inviteEmailLabel: string;
  readonly inviteRoleLabel: string;
  readonly inviteSubmit: string;
  readonly inviteSubmitting: string;
  readonly inviteQueued: string;
  readonly inviteHeld: string;
  readonly inviteError: string;
  readonly invitePreNotice: string;
};

type Phase = 'idle' | 'submitting' | 'error';

/** 確認ステップの対象（ロール変更 / 無効化）。 */
type Pending =
  | { readonly kind: 'ROLE'; readonly member: MemberView; readonly nextRole: TenantRole }
  | { readonly kind: 'REVOKE'; readonly member: MemberView };

export function MembersPanel({
  members,
  canManage,
  assignableRoles,
  currentUserId,
  sandboxLinkHandover,
  messages,
  onChanged,
}: {
  /** 🔴 表示対象（親が選択中の取引先で絞った行）。母集団そのものは `#83` が決める。 */
  readonly members: readonly MemberView[];
  /** 🔴 `PARTNER_ADMIN` が**自社**を見ているときだけ true（ホストは配下アカウントを閲覧のみ）。 */
  readonly canManage: boolean;
  /** 付与できるロール（パートナー配下なら `PARTNER_ADMIN` / `PARTNER_SALES`）。 */
  readonly assignableRoles: readonly TenantRole[];
  /** 🔴 自分自身の行には操作を出さない（拒否の本体は `#84` / `#85` の `decideMember*`）。 */
  readonly currentUserId: string;
  /** 🔴 `sandbox`（招待メールがモックになり、リンクを手渡す。`F-007 AC-4` / `U-07`）。 */
  readonly sandboxLinkHandover: boolean;
  readonly messages: MembersPanelMessages;
  readonly onChanged: () => Promise<void>;
}) {
  const [pending, setPending] = useState<Pending | null>(null);
  const [phase, setPhase] = useState<Phase>('idle');
  const [done, setDone] = useState<'ROLE' | 'REVOKE' | null>(null);

  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<TenantRole>(assignableRoles[0] ?? 'PARTNER_SALES');
  const [invitePhase, setInvitePhase] = useState<Phase>('idle');
  const [inviteResult, setInviteResult] = useState<string | null>(null);
  /** 🔴 `sandbox` × 分類 2 のときだけ値が入る（`production` の応答には存在しないフィールド）。 */
  const [inviteUrl, setInviteUrl] = useState<string | null>(null);

  async function submitPending(): Promise<void> {
    if (pending === null || phase === 'submitting') return;
    setPhase('submitting');
    setDone(null);
    try {
      const response =
        pending.kind === 'ROLE'
          ? await fetch(`/api/members/${pending.member.id}/role`, {
              method: 'PUT',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({ role: pending.nextRole }),
            })
          : await fetch(`/api/members/${pending.member.id}/revoke`, { method: 'POST' });
      if (!response.ok) {
        setPhase('error');
        return;
      }
      setDone(pending.kind);
      setPending(null);
      setPhase('idle');
      await onChanged();
    } catch {
      setPhase('error');
    }
  }

  async function onInvite(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (invitePhase === 'submitting') return;
    const email = inviteEmail.trim();
    if (email === '') {
      setInvitePhase('error');
      return;
    }
    setInvitePhase('submitting');
    setInviteResult(null);
    // 🔴 前回のリンクを消してから発行する（別の宛先のリンクが画面に残らないようにする）。
    setInviteUrl(null);
    try {
      // 🔴 `targetPartnerCompanyId` を送らない。`PARTNER_ADMIN` の招待先は**常に自社**であり、
      //    それを決めるのは `ctx` である（`decideInvitation`。`F-002 AC-4`）。
      const response = await fetch('/api/invitations', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email, role: inviteRole }),
      });
      if (!response.ok) {
        setInvitePhase('error');
        return;
      }
      const created = (await response.json()) as InvitationIssueView;
      setInviteEmail('');
      setInviteResult(created.deliveryState);
      // 🔴 判別子で分岐する（`inviteUrl` の有無を推測しない）。
      if (created.disclosure === 'SANDBOX_INVITE_URL') setInviteUrl(created.inviteUrl);
      setInvitePhase('idle');
      await onChanged();
    } catch {
      setInvitePhase('error');
    }
  }

  return (
    <section className="mb-8" data-testid="members-panel">
      <h3 className="mb-2 text-sm font-semibold text-slate-700">{messages.section}</h3>
      {canManage ? null : (
        <p className="mb-2 text-xs text-slate-500" data-testid="members-read-only-note">
          {messages.readOnlyNote}
        </p>
      )}

      {members.length === 0 ? (
        <p
          className="rounded-md border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700"
          data-testid="members-empty"
        >
          {messages.empty}
        </p>
      ) : (
        // 🔴 Tier 3 の一覧は横スクロールで劣化させる（モバイルで隠さない。`CLAUDE.md` §13.3）。
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-sm" data-testid="members-table">
            <thead>
              <tr className="border-b border-slate-200 text-left text-slate-500">
                <th className="px-3 py-2 font-medium">{messages.columnName}</th>
                <th className="px-3 py-2 font-medium">{messages.columnEmail}</th>
                <th className="px-3 py-2 font-medium">{messages.columnRole}</th>
                <th className="px-3 py-2 font-medium">{messages.columnStatus}</th>
                <th className="px-3 py-2 font-medium">{messages.columnLastLogin}</th>
                {canManage ? <th className="px-3 py-2 font-medium">{messages.columnActions}</th> : null}
              </tr>
            </thead>
            <tbody>
              {members.map((member) => {
                const self = member.userId === currentUserId;
                return (
                  <tr
                    key={member.id}
                    className="border-b border-slate-100"
                    data-testid={`member-row-${member.id}`}
                    data-role={member.role}
                    data-status={member.status}
                  >
                    <td className="px-3 py-2">{member.displayName}</td>
                    <td className="px-3 py-2">{member.email}</td>
                    <td className="px-3 py-2 whitespace-nowrap">{messages.roleLabels[member.role]}</td>
                    <td className="px-3 py-2 whitespace-nowrap">
                      {messages.statusLabels[member.status]}
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap">
                      {member.lastLoginAt === null
                        ? messages.valueNone
                        : formatDateTimeJst(member.lastLoginAt)}
                    </td>
                    {canManage ? (
                      <td className="px-3 py-2">
                        {self ? (
                          // 🔴 自分自身には操作を出さない（サーバも 422 で拒否する）。
                          <span className="text-xs text-slate-500" data-testid={`member-self-${member.id}`}>
                            {messages.self}
                          </span>
                        ) : member.status === 'REVOKED' ? (
                          <span className="text-xs text-slate-500">{messages.valueNone}</span>
                        ) : (
                          <div className="flex flex-wrap items-center gap-2">
                            <label className="text-xs text-slate-600">
                              <span className="sr-only">{messages.roleChangeLabel}</span>
                              <select
                                value={member.role}
                                onChange={(event) =>
                                  setPending({
                                    kind: 'ROLE',
                                    member,
                                    nextRole: event.target.value as TenantRole,
                                  })
                                }
                                className="rounded-md border border-slate-300 px-2 py-1 text-xs"
                                data-testid={`member-role-select-${member.id}`}
                              >
                                {assignableRoles.map((role) => (
                                  <option key={role} value={role}>
                                    {messages.roleLabels[role]}
                                  </option>
                                ))}
                              </select>
                            </label>
                            <Button
                              type="button"
                              variant="secondary"
                              size="sm"
                              onClick={() => setPending({ kind: 'REVOKE', member })}
                              data-testid={`member-revoke-start-${member.id}`}
                            >
                              {messages.revokeSubmit}
                            </Button>
                          </div>
                        )}
                      </td>
                    ) : null}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* 🔴 確認ステップ（`docs/04` §S-035「操作と結果」）。変更前後と影響を必ず出す。 */}
      {pending === null ? null : (
        <div
          className="mt-3 rounded-md border border-slate-300 p-3 text-sm"
          data-testid={pending.kind === 'ROLE' ? 'member-role-confirm' : 'member-revoke-confirm'}
        >
          <p className="mb-1 font-medium text-slate-900">
            {pending.kind === 'ROLE' ? messages.roleChangeConfirmTitle : messages.revokeConfirmTitle}
          </p>
          {pending.kind === 'ROLE' ? (
            <dl className="mb-2 text-slate-700">
              <div className="mb-1">
                <dt className="text-xs text-slate-500">{messages.roleChangeConfirmBefore}</dt>
                <dd data-testid="member-role-confirm-before">
                  {messages.roleLabels[pending.member.role]} —{' '}
                  {messages.roleCapabilities[pending.member.role]}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-slate-500">{messages.roleChangeConfirmAfter}</dt>
                <dd data-testid="member-role-confirm-after">
                  {messages.roleLabels[pending.nextRole]} —{' '}
                  {messages.roleCapabilities[pending.nextRole]}
                </dd>
              </div>
            </dl>
          ) : (
            <p className="mb-2 text-slate-700" data-testid="member-revoke-confirm-text">
              {messages.revokeConfirmText}
            </p>
          )}
          {phase === 'error' ? (
            <p role="alert" className="mb-2 text-sm text-red-700" data-testid="member-action-error">
              {pending.kind === 'ROLE' ? messages.roleChangeError : messages.revokeError}
            </p>
          ) : null}
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              onClick={() => void submitPending()}
              disabled={phase === 'submitting'}
              data-testid="member-action-confirm"
            >
              {phase === 'submitting'
                ? pending.kind === 'ROLE'
                  ? messages.roleChangeSubmitting
                  : messages.revokeSubmitting
                : pending.kind === 'ROLE'
                  ? messages.roleChangeConfirm
                  : messages.revokeConfirm}
            </Button>
            <Button
              type="button"
              variant="secondary"
              onClick={() => {
                setPending(null);
                setPhase('idle');
              }}
              disabled={phase === 'submitting'}
              data-testid="member-action-cancel"
            >
              {pending.kind === 'ROLE' ? messages.roleChangeCancel : messages.revokeCancel}
            </Button>
          </div>
        </div>
      )}

      {done === null ? null : (
        <p role="status" className="mt-2 text-sm text-emerald-700" data-testid="member-action-done">
          {done === 'ROLE' ? messages.roleChangeDone : messages.revokeDone}
        </p>
      )}

      {canManage ? (
        <div className="mt-6" data-testid="members-invite-section">
          <h4 className="mb-2 text-sm font-semibold text-slate-700">{messages.inviteSection}</h4>
          {/* 🔴 docs/04 §3.5: `sandbox` では**操作の隣に**バナーと同じ趣旨を再掲する。 */}
          {sandboxLinkHandover ? (
            <p
              className="mb-3 rounded-md border border-sky-300 bg-sky-50 p-2 text-xs text-sky-900"
              data-testid="members-invite-sandbox-notice"
            >
              {messages.invitePreNotice}
            </p>
          ) : null}
          <form onSubmit={onInvite} noValidate data-testid="members-invite-form">
            <label className="mb-2 block text-sm">
              <span className="mb-1 block text-slate-700">{messages.inviteEmailLabel}</span>
              <input
                type="email"
                name="email"
                required
                value={inviteEmail}
                disabled={invitePhase === 'submitting'}
                onChange={(event) => setInviteEmail(event.target.value)}
                className="w-full max-w-sm rounded-md border border-slate-300 px-3 py-2 text-sm"
                data-testid="members-invite-email"
              />
            </label>
            <label className="mb-2 block text-sm">
              <span className="mb-1 block text-slate-700">{messages.inviteRoleLabel}</span>
              <select
                name="role"
                value={inviteRole}
                disabled={invitePhase === 'submitting'}
                onChange={(event) => setInviteRole(event.target.value as TenantRole)}
                className="rounded-md border border-slate-300 px-3 py-2 text-sm"
                data-testid="members-invite-role"
              >
                {assignableRoles.map((role) => (
                  <option key={role} value={role}>
                    {messages.roleLabels[role]}
                  </option>
                ))}
              </select>
            </label>
            {invitePhase === 'error' ? (
              <p role="alert" className="mb-2 text-sm text-red-700" data-testid="members-invite-error">
                {messages.inviteError}
              </p>
            ) : null}
            {inviteResult === null ? null : (
              <p
                role="status"
                className="mb-2 text-sm text-slate-700"
                data-testid="members-invite-result"
                data-delivery-state={inviteResult}
              >
                {/* 🔴 「送信しました」と書かない（docs/04 §S-014「非同期処理の表現」）。
                    保留（分類 2 は送信ドメイン検証の対象）と受け付けを書き分ける。 */}
                {inviteResult === 'HELD_DOMAIN_UNVERIFIED' ? messages.inviteHeld : messages.inviteQueued}
              </p>
            )}
            <Button
              type="submit"
              disabled={invitePhase === 'submitting'}
              data-testid="members-invite-submit"
            >
              {invitePhase === 'submitting' ? messages.inviteSubmitting : messages.inviteSubmit}
            </Button>
            {inviteUrl === null ? null : (
              <SandboxInviteLinkPanel inviteUrl={inviteUrl} messages={messages} />
            )}
          </form>
        </div>
      ) : null}
    </section>
  );
}
