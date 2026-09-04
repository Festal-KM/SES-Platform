'use client';

// apps/web/app/admin/signin/admin-signin-form.tsx
// `A-001` のサインインフォーム（docs/04 §A-001。T3 = デスクトップ主体だが
// **モバイルでもサインインは完結する**）。
//
// 🔴 認証失敗は理由を区別しない。**「テナント利用者の認証情報では到達できない」旨を
//    エラーに書かない**（docs/04 `A-001`「存在の示唆を避ける」）。
// 🔴 送信中はボタンを送信中表示に置換する（docs/04 §10.1 `A-001` 送信中列）。
// 🔴 2 要素認証は**必須**（`F-055 AC-3`）。1 段階目の成功後は必ず 2 段階目に入る。
// 🔴 文言は props で受け取る（`packages/i18n` が唯一の出所。ここにベタ書きしない）。
import { useCallback, useEffect, useState, type FormEvent } from 'react';

export type AdminSignInFormMessages = {
  readonly emailLabel: string;
  readonly passwordLabel: string;
  readonly submit: string;
  readonly submitting: string;
  readonly invalidCredentials: string;
  readonly networkError: string;
  readonly twoFactorRequiredNotice: string;
  readonly twoFactorTitle: string;
  readonly twoFactorSetupLead: string;
  readonly twoFactorUriLabel: string;
  readonly twoFactorRecoveryHeading: string;
  readonly twoFactorRecoveryNote: string;
  readonly twoFactorVerifyLead: string;
  readonly twoFactorCodeLabel: string;
  readonly twoFactorSubmit: string;
  readonly twoFactorSubmitting: string;
  readonly twoFactorInvalidCode: string;
  readonly twoFactorThrottled: string;
};

export type AdminSignInStage = 'credentials' | 'twoFactor';

type FormState = 'idle' | 'submitting';

type Enrollment = {
  readonly otpauthUrl: string;
  readonly recoveryCodes: readonly string[];
};

const ADMIN_HOME_PATH = '/admin';
/** 2FA の試行回数の上限（`TwoFactorThrottledError`）。 */
const TOO_MANY_REQUESTS = 429;

export function AdminSignInForm({
  messages,
  initialStage = 'credentials',
}: {
  messages: AdminSignInFormMessages;
  initialStage?: AdminSignInStage;
}) {
  const [stage, setStage] = useState<AdminSignInStage>(initialStage);
  const [state, setState] = useState<FormState>('idle');
  const [error, setError] = useState<string | null>(null);
  const [enrollment, setEnrollment] = useState<Enrollment | null>(null);

  const beginTwoFactor = useCallback(async (): Promise<void> => {
    setStage('twoFactor');
    try {
      const response = await fetch('/api/admin/auth/2fa/setup', { method: 'POST' });
      if (!response.ok) return;
      const body: unknown = await response.json();
      if (
        typeof body === 'object' &&
        body !== null &&
        (body as { status?: unknown }).status === 'ENROLLMENT_STARTED'
      ) {
        const started = body as { otpauthUrl: string; recoveryCodes: readonly string[] };
        setEnrollment({ otpauthUrl: started.otpauthUrl, recoveryCodes: started.recoveryCodes });
      }
    } catch {
      setError(messages.networkError);
    }
  }, [messages.networkError]);

  useEffect(() => {
    if (initialStage === 'twoFactor') void beginTwoFactor();
  }, [initialStage, beginTwoFactor]);

  async function onSubmitCredentials(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (state === 'submitting') return;
    setState('submitting');
    setError(null);

    const data = new FormData(event.currentTarget);
    try {
      const response = await fetch('/api/admin/auth/signin', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          email: String(data.get('email') ?? ''),
          password: String(data.get('password') ?? ''),
        }),
      });
      if (response.ok) {
        setState('idle');
        // 🔴 運営者は全員 2FA 必須。応答の `next` を分岐材料にしない。
        await beginTwoFactor();
        return;
      }
      setError(messages.invalidCredentials);
    } catch {
      setError(messages.networkError);
    }
    setState('idle');
  }

  async function onSubmitCode(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (state === 'submitting') return;
    setState('submitting');
    setError(null);

    const data = new FormData(event.currentTarget);
    try {
      const response = await fetch('/api/admin/auth/2fa/verify', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ code: String(data.get('code') ?? '') }),
      });
      if (response.ok) {
        window.location.assign(ADMIN_HOME_PATH);
        return;
      }
      setError(
        response.status === TOO_MANY_REQUESTS
          ? messages.twoFactorThrottled
          : messages.twoFactorInvalidCode,
      );
    } catch {
      setError(messages.networkError);
    }
    setState('idle');
  }

  const errorBlock =
    error === null ? null : (
      <p className="ses-error" role="alert">
        {error}
      </p>
    );

  if (stage === 'twoFactor') {
    return (
      <form onSubmit={onSubmitCode} noValidate>
        <h2>{messages.twoFactorTitle}</h2>
        <p>{messages.twoFactorRequiredNotice}</p>
        {errorBlock}
        {enrollment === null ? (
          <p>{messages.twoFactorVerifyLead}</p>
        ) : (
          <>
            <p>{messages.twoFactorSetupLead}</p>
            <p className="ses-field">
              <span>{messages.twoFactorUriLabel}</span>
              {/* 🔴 シークレットを含む。画面に出すだけで、どこにも保存・送信しない。 */}
              <code className="ses-otpauth-uri">{enrollment.otpauthUrl}</code>
            </p>
            <h3>{messages.twoFactorRecoveryHeading}</h3>
            <p>{messages.twoFactorRecoveryNote}</p>
            <ul className="ses-recovery-codes">
              {enrollment.recoveryCodes.map((code) => (
                <li key={code}>
                  <code>{code}</code>
                </li>
              ))}
            </ul>
          </>
        )}
        <label className="ses-field">
          <span>{messages.twoFactorCodeLabel}</span>
          <input
            name="code"
            type="text"
            inputMode="numeric"
            autoComplete="one-time-code"
            required
            disabled={state === 'submitting'}
          />
        </label>
        <button className="ses-submit" type="submit" disabled={state === 'submitting'}>
          {state === 'submitting' ? messages.twoFactorSubmitting : messages.twoFactorSubmit}
        </button>
      </form>
    );
  }

  return (
    <form onSubmit={onSubmitCredentials} noValidate>
      {errorBlock}
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
      {/* 🔴 主平面のパスワード再設定（`S-046`）への導線は置かない（`BR-36` の別テーブル・別認証。
          docs/04 §S-046「運営者のパスワード再設定は別ルート（`A-001`）が持つ」）。
          運営者向けの再設定は本画面が持つが、実装は SP-04 のメール単一経路に載せる。 */}
    </form>
  );
}
