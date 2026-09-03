'use client';

// apps/web/app/(main)/(auth)/invite/[token]/invite-form.tsx
// `S-002` の本体（docs/04 §S-002 / T1 = モバイル完結）。
//
// 🔴 付与されるロールを**受諾前に**明示する。`VIEWER` は「承認・送信・ダウンロードはできません」を
//    受諾前に示す（`BR-31`。あとで「できない」と気づく状態を作らない）。
// 🔴 期限切れ / 使用済みは専用文言 + 組織名のみ（担当者名を出さない）。使用済みはサインイン導線。
// 🔴 受諾処理中はボタンを無効化する（二重送信防止）。入力途中の離脱は確認する。
// 🔴 文言は props で受け取る（`packages/i18n` が唯一の出所。ここにベタ書きしない）。
import { useCallback, useEffect, useState, type FormEvent } from 'react';

export type InviteRoleName =
  | 'OWNER'
  | 'ADMIN'
  | 'SALES'
  | 'PARTNER_ADMIN'
  | 'PARTNER_SALES'
  | 'VIEWER';

export type InviteFormMessages = {
  readonly invitationHeading: string;
  readonly accountHeading: string;
  readonly tenantNameLabel: string;
  readonly partnerCompanyLabel: string;
  readonly roleLabel: string;
  readonly emailLabel: string;
  readonly expiresAtLabel: string;
  readonly displayNameLabel: string;
  readonly passwordLabel: string;
  readonly passwordHint: string;
  readonly onceOnlyNotice: string;
  readonly viewerNotice: string;
  readonly submit: string;
  readonly submitting: string;
  readonly expired: string;
  readonly accepted: string;
  readonly notFound: string;
  readonly failed: string;
  readonly network: string;
  readonly signInLink: string;
  readonly roleNames: Readonly<Record<InviteRoleName, string>>;
};

/** `#6` の応答（`lib/invitations/service.ts` の `InvitationView` と対）。 */
type InvitationView =
  | {
      readonly status: 'VALID';
      readonly tenantName: string;
      readonly partnerCompanyName: string | null;
      readonly role: InviteRoleName;
      readonly email: string;
      readonly expiresAt: string;
    }
  | { readonly status: 'EXPIRED' | 'ACCEPTED' | 'REVOKED'; readonly tenantName: string };

type LoadState =
  | { readonly kind: 'loading' }
  | { readonly kind: 'loaded'; readonly view: InvitationView }
  /** 🔴 「招待を確認できません」+ 再読込（docs/04 §S-002）。 */
  | { readonly kind: 'unavailable' };

const HOME_PATH = '/';
const SIGNIN_PATH = '/signin';

function formatExpiresAt(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  // 🔴 表示は利用者の端末のロケール任せにせず、判読しやすい固定の形にする。
  const pad = (value: number): string => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(
    date.getHours(),
  )}:${pad(date.getMinutes())}`;
}

export function InviteForm({
  token,
  messages,
}: {
  token: string;
  messages: InviteFormMessages;
}) {
  const [load, setLoad] = useState<LoadState>({ kind: 'loading' });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);

  const fetchInvitation = useCallback(async (): Promise<void> => {
    setLoad({ kind: 'loading' });
    try {
      const response = await fetch(`/api/invitations/${encodeURIComponent(token)}`, {
        headers: { accept: 'application/json' },
      });
      if (!response.ok) {
        setLoad({ kind: 'unavailable' });
        return;
      }
      setLoad({ kind: 'loaded', view: (await response.json()) as InvitationView });
    } catch {
      setLoad({ kind: 'unavailable' });
    }
  }, [token]);

  useEffect(() => {
    void fetchInvitation();
  }, [fetchInvitation]);

  // 🔴 入力途中の離脱を確認する（docs/04 §S-002）。受諾中・受諾後は確認しない。
  useEffect(() => {
    if (!dirty || submitting) return undefined;
    const handler = (event: BeforeUnloadEvent): void => {
      event.preventDefault();
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [dirty, submitting]);

  async function onSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (submitting) return;
    setSubmitting(true);
    setError(null);

    const data = new FormData(event.currentTarget);
    try {
      const response = await fetch(`/api/invitations/${encodeURIComponent(token)}/accept`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        // 🔴 ロール・所属・メールアドレスを送らない（すべて招待行から決まる）。
        body: JSON.stringify({
          displayName: String(data.get('displayName') ?? ''),
          password: String(data.get('password') ?? ''),
        }),
      });
      if (response.ok) {
        setDirty(false);
        // 🔴 受諾で張られたセッションのまま `/` へ。`OWNER` / `ADMIN` はそこから
        //    2 要素認証のウィザード（`S-001`）へ送られる。サインインできていない場合も
        //    `/` が `S-001` へ落とすため、遷移先を分岐させない。
        window.location.assign(HOME_PATH);
        return;
      }
      setError(messages.failed);
    } catch {
      setError(messages.network);
    }
    setSubmitting(false);
  }

  if (load.kind === 'loading') {
    // 🔴 招待内容の骨格（docs/04 §S-002 のローディング）。
    return (
      <div className="ses-skeleton" aria-busy="true" aria-live="polite">
        <p className="ses-skeleton-line" />
        <p className="ses-skeleton-line" />
        <p className="ses-skeleton-line" />
      </div>
    );
  }

  if (load.kind === 'unavailable') {
    return (
      <>
        <p className="ses-error" role="alert">
          {messages.notFound}
        </p>
        <button className="ses-submit" type="button" onClick={() => void fetchInvitation()}>
          {messages.submit}
        </button>
      </>
    );
  }

  const { view } = load;

  if (view.status !== 'VALID') {
    // 🔴 出すのは組織名だけ（担当者名・ロール・メールアドレスを出さない）。
    return (
      <>
        <p className="ses-error" role="alert">
          {view.status === 'EXPIRED' ? messages.expired : messages.accepted}
        </p>
        <dl className="ses-summary">
          <dt>{messages.tenantNameLabel}</dt>
          <dd>{view.tenantName}</dd>
        </dl>
        <a className="ses-secondary-link" href={SIGNIN_PATH}>
          {messages.signInLink}
        </a>
      </>
    );
  }

  return (
    <form onSubmit={onSubmit} noValidate>
      <h2>{messages.invitationHeading}</h2>
      <dl className="ses-summary">
        <dt>{messages.tenantNameLabel}</dt>
        <dd>{view.tenantName}</dd>
        {view.partnerCompanyName === null ? null : (
          <>
            <dt>{messages.partnerCompanyLabel}</dt>
            <dd>{view.partnerCompanyName}</dd>
          </>
        )}
        <dt>{messages.roleLabel}</dt>
        <dd>{messages.roleNames[view.role]}</dd>
        <dt>{messages.emailLabel}</dt>
        <dd>{view.email}</dd>
        <dt>{messages.expiresAtLabel}</dt>
        <dd>{formatExpiresAt(view.expiresAt)}</dd>
      </dl>

      {/* 🔴 VIEWER は「できないこと」を受諾前に示す（BR-31）。 */}
      {view.role === 'VIEWER' ? <p className="ses-notice">{messages.viewerNotice}</p> : null}

      <h2>{messages.accountHeading}</h2>
      {error === null ? null : (
        <p className="ses-error" role="alert">
          {error}
        </p>
      )}
      <label className="ses-field">
        <span>{messages.displayNameLabel}</span>
        <input
          name="displayName"
          type="text"
          autoComplete="name"
          required
          disabled={submitting}
          onChange={() => setDirty(true)}
        />
      </label>
      <label className="ses-field">
        <span>{messages.passwordLabel}</span>
        <input
          name="password"
          type="password"
          autoComplete="new-password"
          required
          disabled={submitting}
          onChange={() => setDirty(true)}
        />
        <small>{messages.passwordHint}</small>
      </label>

      {/* 🔴 「受諾すると失効する」ことを、押す前に伝える。 */}
      <p className="ses-notice">{messages.onceOnlyNotice}</p>
      <button className="ses-submit" type="submit" disabled={submitting}>
        {submitting ? messages.submitting : messages.submit}
      </button>
    </form>
  );
}
