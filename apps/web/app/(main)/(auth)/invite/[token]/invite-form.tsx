'use client';

// apps/web/app/(main)/(auth)/invite/[token]/invite-form.tsx
// `S-002` の本体（docs/04 §S-002 / T1 = モバイル完結）。
//
// 🔴 付与されるロールを**受諾前に**明示する。`VIEWER` は「承認・送信・ダウンロードはできません」を
//    受諾前に示す（`BR-31`。あとで「できない」と気づく状態を作らない）。
// 🔴 期限切れ / 使用済みは専用文言 + 組織名のみ（担当者名を出さない）。使用済みはサインイン導線。
// 🔴 受諾処理中はボタンを無効化する（二重送信防止）。入力途中の離脱は確認する。
// 🔴 文言は props で受け取る（`packages/i18n` が唯一の出所。ここにベタ書きしない）。
//
// 🔴 T-21-04: 手書き CSS を `@ses/ui` と Tailwind へ移した（`signin-form.tsx` と同じ規律）。
//    ⚠️ `S-002` は T-21-04 の 16 画面の列挙には無いが、**認証系 5 画面の 1 つであり、
//    `.ses-field` / `.ses-submit` / `.ses-error` / `.ses-summary` / `.ses-notice` /
//    `.ses-skeleton-line` を共有している**。ここだけ残すと `globals.css` を撤去できず
//    T-21-07 に進めない（SP-21 §5 T-21-04 の「半分だけ Tailwind の状態で止めない」）。
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Button, Field, FieldError, Input, SECONDARY_LINK_STACKED_CLASSES } from '@ses/ui';
import { formatDateTimeJst } from '../../../../../lib/format/datetime';

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

/**
 * 招待の内容（読み取り専用の定義リスト）と注意書きの見た目。旧 `globals.css` の
 * `.ses-summary` / `.ses-notice` の移設先である（T-21-04）。
 * 🔴 この 2 つは**この画面にしか無い**ため `packages/ui` へは出さない
 *    （使い手が 1 つのものを共有プリミティブにすると、次の画面が形を合わせに来る）。
 */
const SUMMARY_CLASSES = 'mb-6 text-sm';
const SUMMARY_TERM_CLASSES = 'mt-3 text-slate-500';
const SUMMARY_VALUE_CLASSES = 'mt-0.5 wrap-anywhere';
const NOTICE_CLASSES = 'mb-4 rounded-md border border-slate-300 px-3 py-2 text-sm';

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
      <div aria-busy="true" aria-live="polite">
        <p className="mb-3 h-4 rounded-sm bg-slate-200" />
        <p className="mb-3 h-4 rounded-sm bg-slate-200" />
        <p className="mb-3 h-4 rounded-sm bg-slate-200" />
      </div>
    );
  }

  if (load.kind === 'unavailable') {
    return (
      <>
        <FieldError className="mb-4">{messages.notFound}</FieldError>
        <Button className="w-full" type="button" onClick={() => void fetchInvitation()}>
          {messages.submit}
        </Button>
      </>
    );
  }

  const { view } = load;

  if (view.status !== 'VALID') {
    // 🔴 出すのは組織名だけ（担当者名・ロール・メールアドレスを出さない）。
    return (
      <>
        <FieldError className="mb-4">
          {view.status === 'EXPIRED' ? messages.expired : messages.accepted}
        </FieldError>
        <dl className={SUMMARY_CLASSES}>
          <dt className={SUMMARY_TERM_CLASSES}>{messages.tenantNameLabel}</dt>
          <dd className={SUMMARY_VALUE_CLASSES}>{view.tenantName}</dd>
        </dl>
        <a className={SECONDARY_LINK_STACKED_CLASSES} href={SIGNIN_PATH}>
          {messages.signInLink}
        </a>
      </>
    );
  }

  return (
    <form onSubmit={onSubmit} noValidate>
      <h2 className="mb-3 text-base font-bold text-slate-900">{messages.invitationHeading}</h2>
      <dl className={SUMMARY_CLASSES}>
        <dt className={SUMMARY_TERM_CLASSES}>{messages.tenantNameLabel}</dt>
        <dd className={SUMMARY_VALUE_CLASSES}>{view.tenantName}</dd>
        {view.partnerCompanyName === null ? null : (
          <>
            <dt className={SUMMARY_TERM_CLASSES}>{messages.partnerCompanyLabel}</dt>
            <dd className={SUMMARY_VALUE_CLASSES}>{view.partnerCompanyName}</dd>
          </>
        )}
        <dt className={SUMMARY_TERM_CLASSES}>{messages.roleLabel}</dt>
        <dd className={SUMMARY_VALUE_CLASSES}>{messages.roleNames[view.role]}</dd>
        <dt className={SUMMARY_TERM_CLASSES}>{messages.emailLabel}</dt>
        <dd className={SUMMARY_VALUE_CLASSES}>{view.email}</dd>
        <dt className={SUMMARY_TERM_CLASSES}>{messages.expiresAtLabel}</dt>
        <dd className={SUMMARY_VALUE_CLASSES}>{formatDateTimeJst(view.expiresAt)}</dd>
      </dl>

      {/* 🔴 VIEWER は「できないこと」を受諾前に示す（BR-31）。 */}
      {view.role === 'VIEWER' ? <p className={NOTICE_CLASSES}>{messages.viewerNotice}</p> : null}

      <h2 className="mb-3 text-base font-bold text-slate-900">{messages.accountHeading}</h2>
      {error === null ? null : <FieldError className="mb-4">{error}</FieldError>}
      <Field className="mb-4" label={messages.displayNameLabel}>
        <Input
          name="displayName"
          type="text"
          autoComplete="name"
          required
          disabled={submitting}
          onChange={() => setDirty(true)}
        />
      </Field>
      <Field className="mb-4" label={messages.passwordLabel}>
        <Input
          name="password"
          type="password"
          autoComplete="new-password"
          required
          disabled={submitting}
          onChange={() => setDirty(true)}
        />
        {/* 🔴 `<small>` のまま（`<label>` の中に `<p>` を入れない。`FieldDescription` を使うと
            説明文が入力欄のアクセシブル名に畳み込まれる）。 */}
        <small className="text-sm text-slate-500">{messages.passwordHint}</small>
      </Field>

      {/* 🔴 「受諾すると失効する」ことを、押す前に伝える。 */}
      <p className={NOTICE_CLASSES}>{messages.onceOnlyNotice}</p>
      <Button className="w-full" type="submit" disabled={submitting}>
        {submitting ? messages.submitting : messages.submit}
      </Button>
    </form>
  );
}
