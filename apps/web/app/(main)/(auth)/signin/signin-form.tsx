'use client';

// apps/web/app/(main)/(auth)/signin/signin-form.tsx
// `S-001` のサインインフォーム（docs/04 §S-001 / T1 = モバイル完結）。
//
// 🔴 テナント選択の UI を置かない（docs/04 §S-001）。画面に選択肢がある時点で
//    「入力で境界が切り替わる」設計に見え、BR-03 の反対になる。
// 🔴 送信中はボタンを送信中表示に置換する（二重送信防止）。
// 🔴 失敗理由を区別しない（「メールアドレスが存在しない」と「パスワードが違う」を分けない）。
// 🔴 文言は props で受け取る（`packages/i18n` が唯一の出所。ここにベタ書きしない）。
import { useState, type FormEvent } from 'react';

export type SignInFormMessages = {
  readonly emailLabel: string;
  readonly passwordLabel: string;
  readonly submit: string;
  readonly submitting: string;
  readonly invalidCredentials: string;
  readonly networkError: string;
  readonly passwordResetLink: string;
};

type FormState = 'idle' | 'submitting';

export function SignInForm({ messages }: { messages: SignInFormMessages }) {
  const [state, setState] = useState<FormState>('idle');
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (state === 'submitting') return;
    setState('submitting');
    setError(null);

    const data = new FormData(event.currentTarget);
    try {
      const response = await fetch('/api/auth/signin', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        // 🔴 テナント識別子を body に載せない（F-003 AC-1）。載せてもサーバは無視する。
        body: JSON.stringify({
          email: String(data.get('email') ?? ''),
          password: String(data.get('password') ?? ''),
        }),
      });
      if (response.ok) {
        window.location.assign('/');
        return;
      }
      setError(messages.invalidCredentials);
    } catch {
      setError(messages.networkError);
    }
    setState('idle');
  }

  return (
    <form onSubmit={onSubmit} noValidate>
      {error === null ? null : (
        <p className="ses-error" role="alert">
          {error}
        </p>
      )}
      <label className="ses-field">
        <span>{messages.emailLabel}</span>
        <input
          name="email"
          type="email"
          autoComplete="username"
          inputMode="email"
          required
          disabled={state === 'submitting'}
        />
      </label>
      <label className="ses-field">
        <span>{messages.passwordLabel}</span>
        <input
          name="password"
          type="password"
          autoComplete="current-password"
          required
          disabled={state === 'submitting'}
        />
      </label>
      <button className="ses-submit" type="submit" disabled={state === 'submitting'}>
        {state === 'submitting' ? messages.submitting : messages.submit}
      </button>
      {/* パスワード再設定（#5 / S-002 系）は T-03-03 が実装する。導線だけ先に置く。 */}
      <a className="ses-secondary-link" href="/password-reset">
        {messages.passwordResetLink}
      </a>
    </form>
  );
}
