'use client';

// apps/web/app/(main)/settings/partner-companies/partner-companies-screen.tsx
// `S-014` 取引先企業の一覧・詳細と招待 — 本体（docs/04 §S-014 / `F-007` / `F-002`）。T-04-07。
//
// 🔴 Tier 3（デスクトップ主体）だが**モバイルで遮断しない**（`CLAUDE.md` §13.3）。
//    一覧は横スクロールで劣化させ、非表示にはしない。
// 🔴 停止は**確認ステップを伴う**（docs/04 §S-014「操作と結果」）。確認の文言に
//    「データは削除されません」を必ず含める —— これが無いと、管理者は停止を「消す操作」と
//    受け取って実行できなくなる（`F-007 AC-2` の意図が伝わらない）。
// 🔴 未検証のときは**招待ボタンを描画しない**（docs/04 §S-014）。失敗しうる操作を出して
//    エラーで返すのではなく、理由と `S-036` への導線をその位置に置く。
//    ⚠️ これは UI の配慮であって境界の担保ではない。API（`#14`）は未検証でも招待を作り、
//    送達だけを保留する（`F-007 AC-5`。「招待そのものは作成できるが、送達は検証完了後」）。
// 🔴 「送信しました」と書かない（docs/04 §S-014「非同期処理の表現」）。**送信を受け付けた**
//    ことと、保留（`HELD_DOMAIN_UNVERIFIED`）を書き分ける。
import { useState, type FormEvent } from 'react';
import Link from 'next/link';
import { Button } from '@ses/ui';
import { formatDateTimeJst } from '../../../../lib/format/datetime';
import type {
  PartnerCompanyListView,
  PartnerCompanyView,
} from '../../../../lib/partner-companies/service';

/** `#14` の応答のうち本画面が使う部分（`lib/jobs/account-mail.ts` の `AccountMailDeliveryState`）。 */
type InvitationDeliveryState = string;

export type PartnerCompaniesScreenMessages = {
  readonly partnerScopeNotice: string;
  readonly readOnlyNote: string;

  readonly sectionList: string;
  readonly columnName: string;
  readonly columnStatus: string;
  readonly columnAccountCount: string;
  readonly columnOpenProjectCount: string;
  readonly columnProposalCount: string;
  readonly columnLastActivity: string;
  readonly statusLabels: Readonly<Record<PartnerCompanyView['status'], string>>;
  readonly valueNone: string;
  readonly select: string;
  readonly empty: string;

  readonly sectionRegister: string;
  readonly registerNameLabel: string;
  readonly registerContactNameLabel: string;
  readonly registerContactEmailLabel: string;
  readonly registerSubmit: string;
  readonly registerSubmitting: string;
  readonly registerDone: string;
  readonly registerError: string;

  readonly sectionDetail: string;
  readonly detailSelectPrompt: string;
  readonly detailContactName: string;
  readonly detailContactEmail: string;
  readonly detailInvitedAt: string;
  readonly detailPendingInvitations: string;
  readonly detailSuspendedAt: string;

  readonly sectionInvite: string;
  readonly inviteEmailLabel: string;
  readonly inviteRoleLabel: string;
  readonly inviteRoleValue: string;
  readonly inviteSubmit: string;
  readonly inviteSubmitting: string;
  readonly inviteQueued: string;
  readonly inviteHeld: string;
  readonly inviteError: string;
  readonly inviteBlocked: string;
  readonly inviteBlockedLink: string;
  readonly inviteBlockedMemberInviteNote: string;

  readonly sectionSuspension: string;
  readonly suspensionReasonLabel: string;
  readonly suspendSubmit: string;
  readonly suspendConfirmTitle: string;
  readonly suspendConfirmText: string;
  readonly suspendConfirm: string;
  readonly suspendCancel: string;
  readonly suspendSubmitting: string;
  readonly resumeSubmit: string;
  readonly resumeSubmitting: string;
  readonly suspensionError: string;
};

type Phase = 'idle' | 'submitting' | 'error';

/** 🔴 ホストがこの画面から招けるのは取引先の管理者だけである（`F-002 AC-4`）。 */
const INVITED_ROLE = 'PARTNER_ADMIN';

export function PartnerCompaniesScreen({
  initial,
  canManage,
  invitationBlocked,
  messages,
}: {
  readonly initial: PartnerCompanyListView;
  /** 🔴 登録・招待・停止は `OWNER` / `ADMIN`（ホスト所属）のみ（docs/04 §S-014 権限差分）。 */
  readonly canManage: boolean;
  /** 🔴 送信元ドメインが未検証（`F-007 AC-5` / `S-036`）。招待の導線を出さない理由になる。 */
  readonly invitationBlocked: boolean;
  readonly messages: PartnerCompaniesScreenMessages;
}) {
  const [items, setItems] = useState<readonly PartnerCompanyView[]>(initial.items);
  const [selectedId, setSelectedId] = useState<string | null>(initial.items[0]?.id ?? null);

  const [name, setName] = useState('');
  const [contactName, setContactName] = useState('');
  const [contactEmail, setContactEmail] = useState('');
  const [registerPhase, setRegisterPhase] = useState<Phase>('idle');
  const [registered, setRegistered] = useState(false);

  const [inviteEmail, setInviteEmail] = useState('');
  const [invitePhase, setInvitePhase] = useState<Phase>('idle');
  const [inviteResult, setInviteResult] = useState<InvitationDeliveryState | null>(null);

  const [reason, setReason] = useState('');
  const [confirming, setConfirming] = useState(false);
  const [suspensionPhase, setSuspensionPhase] = useState<Phase>('idle');

  const selected = items.find((item) => item.id === selectedId) ?? null;

  /** 一覧を引き直す（件数・状態は API の値だけを正とし、クライアントで組み立てない）。 */
  async function reload(): Promise<void> {
    const response = await fetch('/api/partner-companies', { headers: { accept: 'application/json' } });
    if (!response.ok) return;
    const view = (await response.json()) as PartnerCompanyListView;
    setItems(view.items);
  }

  async function onRegister(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (registerPhase === 'submitting') return;
    const trimmed = name.trim();
    if (trimmed === '') {
      setRegisterPhase('error');
      return;
    }
    setRegisterPhase('submitting');
    setRegistered(false);
    try {
      const response = await fetch('/api/partner-companies', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          name: trimmed,
          ...(contactName.trim() === '' ? {} : { contactName: contactName.trim() }),
          ...(contactEmail.trim() === '' ? {} : { contactEmail: contactEmail.trim() }),
        }),
      });
      if (!response.ok) {
        setRegisterPhase('error');
        return;
      }
      const created = (await response.json()) as { readonly id: string };
      setName('');
      setContactName('');
      setContactEmail('');
      setRegistered(true);
      setRegisterPhase('idle');
      await reload();
      setSelectedId(created.id);
    } catch {
      setRegisterPhase('error');
    }
  }

  async function onInvite(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (invitePhase === 'submitting' || selected === null) return;
    const email = inviteEmail.trim();
    if (email === '') {
      setInvitePhase('error');
      return;
    }
    setInvitePhase('submitting');
    setInviteResult(null);
    try {
      const response = await fetch('/api/invitations', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          email,
          role: INVITED_ROLE,
          // 🔴 招待先の選択であり、実行者のスコープではない（`lib/api/isolation-keys.ts`）。
          targetPartnerCompanyId: selected.id,
        }),
      });
      if (!response.ok) {
        setInvitePhase('error');
        return;
      }
      const created = (await response.json()) as { readonly deliveryState: InvitationDeliveryState };
      setInviteEmail('');
      setInviteResult(created.deliveryState);
      setInvitePhase('idle');
      await reload();
    } catch {
      setInvitePhase('error');
    }
  }

  async function onSuspension(operation: 'suspend' | 'resume'): Promise<void> {
    if (suspensionPhase === 'submitting' || selected === null) return;
    setSuspensionPhase('submitting');
    try {
      const response = await fetch(`/api/partner-companies/${selected.id}/${operation}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(reason.trim() === '' ? {} : { reason: reason.trim() }),
      });
      if (!response.ok) {
        setSuspensionPhase('error');
        return;
      }
      setReason('');
      setConfirming(false);
      setSuspensionPhase('idle');
      await reload();
    } catch {
      setSuspensionPhase('error');
    }
  }

  return (
    <div data-testid="partner-companies-screen">
      {/* 🔴 `F-007 AC-1`: パートナーには自社 1 社しか出ない。件数の示唆を含めずに常時示す。 */}
      {canManage ? null : (
        <p className="mb-4 text-sm text-slate-600" data-testid="partner-companies-scope-notice">
          {messages.partnerScopeNotice}
          <br />
          <span className="text-slate-500">{messages.readOnlyNote}</span>
        </p>
      )}

      <section className="mb-8" data-testid="partner-companies-list-section">
        <h2 className="mb-2 text-sm font-semibold text-slate-700">{messages.sectionList}</h2>
        {items.length === 0 ? (
          <p className="rounded-md border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700" data-testid="partner-companies-empty">
            {messages.empty}
          </p>
        ) : (
          // 🔴 Tier 3 の一覧は横スクロールで劣化させる（モバイルで隠さない。`CLAUDE.md` §13.3）。
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-sm" data-testid="partner-companies-table">
              <thead>
                <tr className="border-b border-slate-200 text-left text-slate-500">
                  <th className="px-3 py-2 font-medium">{messages.columnName}</th>
                  <th className="px-3 py-2 font-medium">{messages.columnStatus}</th>
                  <th className="px-3 py-2 font-medium">{messages.columnAccountCount}</th>
                  <th className="px-3 py-2 font-medium">{messages.columnOpenProjectCount}</th>
                  <th className="px-3 py-2 font-medium">{messages.columnProposalCount}</th>
                  <th className="px-3 py-2 font-medium">{messages.columnLastActivity}</th>
                  <th className="px-3 py-2 font-medium" />
                </tr>
              </thead>
              <tbody>
                {items.map((item) => (
                  <tr
                    key={item.id}
                    className={
                      item.id === selectedId
                        ? 'border-b border-slate-100 bg-slate-50'
                        : 'border-b border-slate-100'
                    }
                    data-testid={`partner-company-row-${item.id}`}
                    data-status={item.status}
                  >
                    <td className="px-3 py-2">{item.name}</td>
                    <td className="px-3 py-2 whitespace-nowrap">{messages.statusLabels[item.status]}</td>
                    <td className="px-3 py-2 tabular-nums">{item.accountCount}</td>
                    <td className="px-3 py-2 tabular-nums">{item.openProjectCount}</td>
                    <td className="px-3 py-2 tabular-nums">{item.proposalCount}</td>
                    <td className="px-3 py-2 whitespace-nowrap">
                      {item.lastActivityAt === null
                        ? messages.valueNone
                        : formatDateTimeJst(item.lastActivityAt)}
                    </td>
                    <td className="px-3 py-2">
                      <Button
                        type="button"
                        variant="secondary"
                        size="sm"
                        onClick={() => setSelectedId(item.id)}
                        data-testid={`partner-company-select-${item.id}`}
                      >
                        {messages.select}
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {canManage ? (
        <section className="mb-8" data-testid="partner-companies-register-section">
          <h2 className="mb-2 text-sm font-semibold text-slate-700">{messages.sectionRegister}</h2>
          <form onSubmit={onRegister} noValidate data-testid="partner-company-register-form">
            <label className="mb-2 block text-sm">
              <span className="mb-1 block text-slate-700">{messages.registerNameLabel}</span>
              <input
                type="text"
                name="name"
                required
                value={name}
                disabled={registerPhase === 'submitting'}
                onChange={(event) => setName(event.target.value)}
                className="w-full max-w-sm rounded-md border border-slate-300 px-3 py-2 text-sm"
                data-testid="partner-company-register-name"
              />
            </label>
            <label className="mb-2 block text-sm">
              <span className="mb-1 block text-slate-700">{messages.registerContactNameLabel}</span>
              <input
                type="text"
                name="contactName"
                value={contactName}
                disabled={registerPhase === 'submitting'}
                onChange={(event) => setContactName(event.target.value)}
                className="w-full max-w-sm rounded-md border border-slate-300 px-3 py-2 text-sm"
                data-testid="partner-company-register-contact-name"
              />
            </label>
            <label className="mb-2 block text-sm">
              <span className="mb-1 block text-slate-700">{messages.registerContactEmailLabel}</span>
              <input
                type="email"
                name="contactEmail"
                value={contactEmail}
                disabled={registerPhase === 'submitting'}
                onChange={(event) => setContactEmail(event.target.value)}
                className="w-full max-w-sm rounded-md border border-slate-300 px-3 py-2 text-sm"
                data-testid="partner-company-register-contact-email"
              />
            </label>
            {registerPhase === 'error' ? (
              <p role="alert" className="mb-2 text-sm text-red-700" data-testid="partner-company-register-error">
                {messages.registerError}
              </p>
            ) : null}
            {registered ? (
              <p role="status" className="mb-2 text-sm text-emerald-700" data-testid="partner-company-register-done">
                {messages.registerDone}
              </p>
            ) : null}
            <Button type="submit" disabled={registerPhase === 'submitting'} data-testid="partner-company-register-submit">
              {registerPhase === 'submitting' ? messages.registerSubmitting : messages.registerSubmit}
            </Button>
          </form>
        </section>
      ) : null}

      <section data-testid="partner-companies-detail-section">
        <h2 className="mb-2 text-sm font-semibold text-slate-700">{messages.sectionDetail}</h2>
        {selected === null ? (
          <p className="text-sm text-slate-600" data-testid="partner-company-detail-prompt">
            {messages.detailSelectPrompt}
          </p>
        ) : (
          <div data-testid="partner-company-detail" data-partner-company-id={selected.id}>
            <h3 className="mb-2 text-base font-semibold text-slate-900">{selected.name}</h3>
            <dl className="mb-6 grid grid-cols-1 gap-1 text-sm sm:grid-cols-2">
              <div>
                <dt className="text-slate-500">{messages.columnStatus}</dt>
                <dd data-testid="partner-company-detail-status">{messages.statusLabels[selected.status]}</dd>
              </div>
              <div>
                <dt className="text-slate-500">{messages.detailInvitedAt}</dt>
                <dd>{formatDateTimeJst(selected.invitedAt)}</dd>
              </div>
              <div>
                <dt className="text-slate-500">{messages.detailContactName}</dt>
                <dd>{selected.contactName ?? messages.valueNone}</dd>
              </div>
              <div>
                <dt className="text-slate-500">{messages.detailContactEmail}</dt>
                <dd>{selected.contactEmail ?? messages.valueNone}</dd>
              </div>
              <div>
                <dt className="text-slate-500">{messages.detailPendingInvitations}</dt>
                <dd data-testid="partner-company-detail-pending-invitations">{selected.pendingInvitationCount}</dd>
              </div>
              {selected.suspendedAt === null ? null : (
                <div>
                  <dt className="text-slate-500">{messages.detailSuspendedAt}</dt>
                  <dd>{formatDateTimeJst(selected.suspendedAt)}</dd>
                </div>
              )}
            </dl>

            {canManage ? (
              <>
                <section className="mb-8" data-testid="partner-company-invite-section">
                  <h3 className="mb-2 text-sm font-semibold text-slate-700">{messages.sectionInvite}</h3>
                  {invitationBlocked ? (
                    // 🔴 ボタンを出さず、理由と `S-036` への導線を置く（docs/04 §S-014）。
                    <div
                      role="status"
                      className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900"
                      data-testid="partner-company-invite-blocked"
                    >
                      <p>{messages.inviteBlocked}</p>
                      <Link
                        href="/settings/sending-domains"
                        className="font-medium underline underline-offset-2"
                        data-testid="partner-company-invite-blocked-link"
                      >
                        {messages.inviteBlockedLink}
                      </Link>
                      <p className="mt-1 text-xs text-amber-800">
                        {messages.inviteBlockedMemberInviteNote}
                      </p>
                    </div>
                  ) : (
                    <form onSubmit={onInvite} noValidate data-testid="partner-company-invite-form">
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
                          data-testid="partner-company-invite-email"
                        />
                      </label>
                      {/* 🔴 ロールは読み取り専用（この画面から招けるのは PARTNER_ADMIN だけ）。 */}
                      <p className="mb-2 text-sm">
                        <span className="mb-1 block text-slate-700">{messages.inviteRoleLabel}</span>
                        <output data-testid="partner-company-invite-role">{messages.inviteRoleValue}</output>
                      </p>
                      {invitePhase === 'error' ? (
                        <p role="alert" className="mb-2 text-sm text-red-700" data-testid="partner-company-invite-error">
                          {messages.inviteError}
                        </p>
                      ) : null}
                      {inviteResult === null ? null : (
                        <p
                          role="status"
                          className="mb-2 text-sm text-slate-700"
                          data-testid="partner-company-invite-result"
                          data-delivery-state={inviteResult}
                        >
                          {inviteResult === 'HELD_DOMAIN_UNVERIFIED'
                            ? messages.inviteHeld
                            : messages.inviteQueued}
                        </p>
                      )}
                      <Button type="submit" disabled={invitePhase === 'submitting'} data-testid="partner-company-invite-submit">
                        {invitePhase === 'submitting' ? messages.inviteSubmitting : messages.inviteSubmit}
                      </Button>
                    </form>
                  )}
                </section>

                <section data-testid="partner-company-suspension-section">
                  <h3 className="mb-2 text-sm font-semibold text-slate-700">{messages.sectionSuspension}</h3>
                  <label className="mb-2 block text-sm">
                    <span className="mb-1 block text-slate-700">{messages.suspensionReasonLabel}</span>
                    <input
                      type="text"
                      name="reason"
                      value={reason}
                      disabled={suspensionPhase === 'submitting'}
                      onChange={(event) => setReason(event.target.value)}
                      className="w-full max-w-sm rounded-md border border-slate-300 px-3 py-2 text-sm"
                      data-testid="partner-company-suspension-reason"
                    />
                  </label>
                  {suspensionPhase === 'error' ? (
                    <p role="alert" className="mb-2 text-sm text-red-700" data-testid="partner-company-suspension-error">
                      {messages.suspensionError}
                    </p>
                  ) : null}
                  {selected.status === 'SUSPENDED' ? (
                    <Button
                      type="button"
                      onClick={() => void onSuspension('resume')}
                      disabled={suspensionPhase === 'submitting'}
                      data-testid="partner-company-resume-submit"
                    >
                      {suspensionPhase === 'submitting' ? messages.resumeSubmitting : messages.resumeSubmit}
                    </Button>
                  ) : confirming ? (
                    // 🔴 確認ステップ（docs/04 §S-014）。何が起きて何が起きないかを両方書く。
                    <div
                      className="rounded-md border border-slate-300 p-3 text-sm"
                      data-testid="partner-company-suspend-confirm"
                    >
                      <p className="mb-1 font-medium text-slate-900">{messages.suspendConfirmTitle}</p>
                      <p className="mb-2 text-slate-700">{messages.suspendConfirmText}</p>
                      <div className="flex flex-wrap gap-2">
                        <Button
                          type="button"
                          onClick={() => void onSuspension('suspend')}
                          disabled={suspensionPhase === 'submitting'}
                          data-testid="partner-company-suspend-confirm-submit"
                        >
                          {suspensionPhase === 'submitting' ? messages.suspendSubmitting : messages.suspendConfirm}
                        </Button>
                        <Button
                          type="button"
                          variant="secondary"
                          onClick={() => setConfirming(false)}
                          disabled={suspensionPhase === 'submitting'}
                          data-testid="partner-company-suspend-cancel"
                        >
                          {messages.suspendCancel}
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <Button
                      type="button"
                      variant="secondary"
                      onClick={() => setConfirming(true)}
                      data-testid="partner-company-suspend-start"
                    >
                      {messages.suspendSubmit}
                    </Button>
                  )}
                </section>
              </>
            ) : null}
          </div>
        )}
      </section>
    </div>
  );
}
