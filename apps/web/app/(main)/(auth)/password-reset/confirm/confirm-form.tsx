'use client';

// apps/web/app/(main)/(auth)/password-reset/confirm/confirm-form.tsx
// `S-046` ③ の本体（docs/04 §S-046 / T1 = モバイル完結）。
//
// 🔴 トークン無効・期限切れは「このリンクは無効か、有効期限が切れています」+ ①への導線を
//    画面内に表示する。404 ページに落とさない（docs/05 §6.3 #5b / docs/04 §S-046 Err 列）。
//    不一致・使用済み・期限切れ・形式不正を区別しない（区別するとトークンの実在が漏れる）。
// 🔴 送信中はボタンを送信中表示に置換する（二重送信防止。①と同じ `createSubmitGuard`）。
// 🔴 文言は props で受け取る（`packages/i18n` が唯一の出所。ここにベタ書きしない）。
//
// 🔴 トークンの事前検証エンドポイントは存在しない（`docs/05` §6.3 は #5b の POST のみ。
//    `S-002` の `GET #6` に相当する確認 API を持たない）。したがって「無効・期限切れの
//    トークンで③を開く」の実体は、フォームを表示したうえで実際に送信して #5b から
//    拒否されたときであり、ページを開いた瞬間には判定できない（トークンが URL に無い
//    到達だけは、送信を待たずにここで弾く）。
import { useRef, useState, type FormEvent } from 'react';
import { createSubmitGuard } from '../../../../../lib/forms/submit-guard';

export type ConfirmFormMessages = {
  readonly eyebrow: string;
  readonly newPasswordLabel: string;
  readonly newPasswordConfirmLabel: string;
  readonly passwordHint: string;
  readonly submit: string;
  readonly submitting: string;
  readonly mismatch: string;
  readonly success: string;
  readonly signInLink: string;
  readonly invalidLink: string;
  readonly invalidLinkRetry: string;
  readonly networkError: string;
  readonly validationError: string;
};

type ConfirmOutcome = 'updated' | 'invalid' | 'validation-error' | 'network-error';

/** `docs/05` §15.2 の応答ボディの一部だけを読む（存在有無・トークン実在を区別しない範囲）。 */
type ErrorCode = 'PASSWORD_RESET_TOKEN_INVALID' | string;

async function readErrorCode(response: Response): Promise<ErrorCode | null> {
  const body: unknown = await response.json().catch(() => null);
  if (body === null || typeof body !== 'object') return null;
  const errorField = (body as { error?: unknown }).error;
  if (errorField === null || typeof errorField !== 'object') return null;
  const code = (errorField as { code?: unknown }).code;
  return typeof code === 'string' ? code : null;
}

type Stage = 'form' | 'success' | 'invalid';

const SIGNIN_PATH = '/signin';
const REQUEST_PATH = '/password-reset';

export function ConfirmForm({
  token,
  minLength,
  messages,
}: {
  token: string;
  /** 🔴 #5b の既存実装（`@ses/config` の `PASSWORD_MIN_LENGTH`）と単一の出所にする。
   *    サーバコンポーネント（`page.tsx`）が import して prop で渡す（画面側で値を発明しない）。 */
  minLength: number;
  messages: ConfirmFormMessages;
}) {
  const guardRef = useRef(createSubmitGuard<ConfirmOutcome>());
  // 🔴 トークンが無い到達（クエリなしで直接開いた等）も無効扱いにする（404 に落とさない）。
  const [stage, setStage] = useState<Stage>(token.trim() === '' ? 'invalid' : 'form');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (guardRef.current.pending) return;

    const data = new FormData(event.currentTarget);
    const password = String(data.get('password') ?? '');
    const passwordConfirm = String(data.get('passwordConfirm') ?? '');
    if (password !== passwordConfirm) {
      setError(messages.mismatch);
      return;
    }
    // 🔴 `noValidate` によりブラウザの `minLength` 検証は働かない。ここで弾かないと、
    //    弱いパスワードの 400（`error.validation`）を「リンクが無効」と誤って表示してしまう。
    if (password.length < minLength) {
      setError(messages.passwordHint);
      return;
    }

    setSubmitting(true);
    setError(null);

    const outcome = await guardRef.current.run(async (): Promise<ConfirmOutcome> => {
      try {
        const response = await fetch('/api/auth/password-reset/confirm', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ token, password }),
        });
        if (response.ok) return 'updated';
        // 🔴 トークン不一致・使用済み・期限切れ・形式不正はまとめて「無効か期限切れ」に畳む
        //    （区別するとトークンの実在が漏れる）。それ以外（弱いパスワード等の入力検証エラー）を
        //    同じ文言で見せると、直せば直る問題を「リンクをやり直せ」と誤案内してしまうため分ける。
        const code = await readErrorCode(response);
        return code === 'PASSWORD_RESET_TOKEN_INVALID' ? 'invalid' : 'validation-error';
      } catch {
        return 'network-error';
      }
    });

    setSubmitting(false);
    if (outcome === 'updated') {
      setStage('success');
      return;
    }
    if (outcome === 'invalid') {
      setStage('invalid');
      return;
    }
    if (outcome === 'validation-error') {
      setError(messages.validationError);
      return;
    }
    if (outcome === 'network-error') {
      setError(messages.networkError);
    }
  }

  if (stage === 'invalid') {
    return (
      <div data-testid="password-reset-confirm-invalid">
        <p className="ses-error" role="alert" data-testid="password-reset-confirm-invalid-message">
          {messages.invalidLink}
        </p>
        <a className="ses-secondary-link" href={REQUEST_PATH}>
          {messages.invalidLinkRetry}
        </a>
      </div>
    );
  }

  if (stage === 'success') {
    return (
      <div data-testid="password-reset-confirm-success">
        <p role="status" data-testid="password-reset-confirm-success-message">
          {messages.success}
        </p>
        <a className="ses-secondary-link" href={SIGNIN_PATH}>
          {messages.signInLink}
        </a>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} noValidate data-testid="password-reset-confirm-form">
      <h2>{messages.eyebrow}</h2>
      {error === null ? null : (
        <p className="ses-error" role="alert" data-testid="password-reset-confirm-error">
          {error}
        </p>
      )}
      <label className="ses-field">
        <span>{messages.newPasswordLabel}</span>
        <input
          name="password"
          type="password"
          autoComplete="new-password"
          minLength={minLength}
          required
          disabled={submitting}
          data-testid="password-reset-new-password"
        />
      </label>
      <label className="ses-field">
        <span>{messages.newPasswordConfirmLabel}</span>
        <input
          name="passwordConfirm"
          type="password"
          autoComplete="new-password"
          minLength={minLength}
          required
          disabled={submitting}
          data-testid="password-reset-new-password-confirm"
        />
        <small>{messages.passwordHint}</small>
      </label>
      <button
        className="ses-submit"
        type="submit"
        disabled={submitting}
        data-testid="password-reset-confirm-submit"
      >
        {submitting ? messages.submitting : messages.submit}
      </button>
    </form>
  );
}
