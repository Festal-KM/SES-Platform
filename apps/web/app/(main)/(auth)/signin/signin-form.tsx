'use client';

// apps/web/app/(main)/(auth)/signin/signin-form.tsx
// `S-001` のサインインフォーム（docs/04 §S-001 / T1 = モバイル完結）。
//
// 🔴 テナント選択の UI を置かない（docs/04 §S-001）。画面に選択肢がある時点で
//    「入力で境界が切り替わる」設計に見え、BR-03 の反対になる。
// 🔴 送信中はボタンを送信中表示に置換する（二重送信防止）。
// 🔴 失敗理由を区別しない（「メールアドレスが存在しない」と「パスワードが違う」を分けない）。
// 🔴 文言は props で受け取る（`packages/i18n` が唯一の出所。ここにベタ書きしない）。
//
// 🔴 T-03-02: 2 段階目（2 要素認証）を同じ画面に足した（docs/04 §S-001 セクション 3）。
//    **モバイルで機能を省略しない**（コード入力は数字キーボードを呼ぶ）。
//    設定ウィザード（`OWNER` / `ADMIN` が未設定の場合）もここに含める。
import { useCallback, useEffect, useState, type FormEvent } from 'react';

export type SignInFormMessages = {
  readonly emailLabel: string;
  readonly passwordLabel: string;
  readonly submit: string;
  readonly submitting: string;
  readonly invalidCredentials: string;
  readonly networkError: string;
  readonly passwordResetLink: string;
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

/** 2 段階目の入口。`credentials` から遷移するか、`?step=2fa` で直接開く。 */
export type SignInStage = 'credentials' | 'twoFactor';

type FormState = 'idle' | 'submitting';

type Enrollment = {
  readonly otpauthUrl: string;
  readonly recoveryCodes: readonly string[];
};

const HOME_PATH = '/';
/** 2FA の試行回数の上限（`TwoFactorThrottledError`）。 */
const TOO_MANY_REQUESTS = 429;

export function SignInForm({
  messages,
  initialStage = 'credentials',
}: {
  messages: SignInFormMessages;
  initialStage?: SignInStage;
}) {
  const [stage, setStage] = useState<SignInStage>(initialStage);
  const [state, setState] = useState<FormState>('idle');
  const [error, setError] = useState<string | null>(null);
  const [enrollment, setEnrollment] = useState<Enrollment | null>(null);

  /**
   * 2 段階目に入るときに `#3 setup` を呼ぶ。
   * 🔴 応答の `ALREADY_ENROLLED` は「確認済みの資格情報があるので上書きしない」であり、
   *    その場合は登録ウィザードを出さずにコード入力だけを見せる。
   */
  const beginTwoFactor = useCallback(async (): Promise<void> => {
    setStage('twoFactor');
    try {
      const response = await fetch('/api/auth/2fa/setup', { method: 'POST' });
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
        const body: unknown = await response.json();
        const next = (body as { next?: unknown }).next;
        if (next === '2fa') {
          setState('idle');
          await beginTwoFactor();
          return;
        }
        window.location.assign(HOME_PATH);
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
      const response = await fetch('/api/auth/2fa/verify', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ code: String(data.get('code') ?? '') }),
      });
      if (response.ok) {
        window.location.assign(HOME_PATH);
        return;
      }
      // 🔴 429 は「入力が違う」ではなく「試行回数の上限」（docs/04 §S-001 のロックアウト）。
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
            /* 🔴 モバイルで数字キーボードを呼ぶ（docs/04 §S-001 デバイス別）。
                  リカバリコードも入力しうるため text のままにし、pattern で縛らない。 */
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
      {/* パスワード再設定（#5 / S-002 系）は T-03-03 が実装する。導線だけ先に置く。 */}
      <a className="ses-secondary-link" href="/password-reset">
        {messages.passwordResetLink}
      </a>
    </form>
  );
}
