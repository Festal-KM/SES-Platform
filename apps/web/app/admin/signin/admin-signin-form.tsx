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
//
// 🔴 T-21-05: 手書き CSS（`.ses-field` / `.ses-submit` / `.ses-error` / `.ses-otpauth-uri` /
//    `.ses-recovery-codes`）を `@ses/ui` と Tailwind へ移した。**主平面の `S-001`
//    （`app/(main)/(auth)/signin/signin-form.tsx`）と同じ部品・同じクラスを使う** ——
//    運営者側だけ別の見た目を作ると、**片方だけ直る**状態がその場で生まれる
//    （`docs/04` §A-001 改訂 7「`S-001` と同一の構成とし、同じ実装を共有する」）。
//    **testid・`name`・`autoComplete`・`aria-*`・要素の並びは 1 つも変えていない。**
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Button, Field, FieldError, Input } from '@ses/ui';
import { OtpauthQr } from '../../_components/otpauth-qr';

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
  readonly twoFactorQrLabel: string;
  readonly twoFactorQrAlt: string;
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
      <FieldError className="mb-4" data-testid="admin-signin-error">
        {error}
      </FieldError>
    );

  if (stage === 'twoFactor') {
    return (
      <form onSubmit={onSubmitCode} noValidate data-testid="admin-signin-2fa-form">
        <h2 className="mb-3 text-base font-bold text-slate-900">{messages.twoFactorTitle}</h2>
        <p className="mb-4 text-sm text-slate-700">{messages.twoFactorRequiredNotice}</p>
        {errorBlock}
        {enrollment === null ? (
          <p className="mb-4 text-sm text-slate-700">{messages.twoFactorVerifyLead}</p>
        ) : (
          <>
            <p className="mb-4 text-sm text-slate-700">{messages.twoFactorSetupLead}</p>
            {/* 🔴 主平面と同じ 1 実装を使う（運営者側だけ規律を緩めない。docs/04 §A-001 改訂 7）。
                  QR は利用者の端末の中だけで組み立て、外部の QR 生成サービスに渡さない。 */}
            <OtpauthQr
              otpauthUrl={enrollment.otpauthUrl}
              caption={messages.twoFactorQrLabel}
              alt={messages.twoFactorQrAlt}
              testId="admin-signin-otpauth-qr"
            />
            {/* 🔴 手入力用の表示を消さない（QR を読めない環境での唯一の経路 / E2E の読み取り元）。 */}
            <Field as="p" className="mb-4" label={messages.twoFactorUriLabel}>
              {/* 🔴 シークレットを含む。画面に出すだけで、どこにも保存・送信しない。
                  🔴 長いアドレスを**折り返して全部見せる**（`wrap-anywhere`）。切り詰めると、
                     QR を読めない端末の運営者が 2FA の登録を完了できない。 */}
              <code
                className="block rounded-md border border-slate-300 p-2 text-xs wrap-anywhere"
                data-testid="admin-signin-otpauth-uri"
              >
                {enrollment.otpauthUrl}
              </code>
            </Field>
            <h3 className="mb-1 text-sm font-bold text-slate-900">
              {messages.twoFactorRecoveryHeading}
            </h3>
            <p className="mb-2 text-sm text-slate-700">{messages.twoFactorRecoveryNote}</p>
            {/* 🔴 復旧コードもシークレットである。等幅（`<code>`）のまま、選択してコピー
                できる素のテキストで出す（画像化・伏せ字にしない）。 */}
            <ul className="mb-4 pl-5 text-sm">
              {enrollment.recoveryCodes.map((code) => (
                <li key={code}>
                  <code>{code}</code>
                </li>
              ))}
            </ul>
          </>
        )}
        <Field className="mb-4" label={messages.twoFactorCodeLabel}>
          <Input
            name="code"
            type="text"
            /* 🔴 モバイルで数字キーボードを呼ぶ。リカバリコードも入力しうるため text の
                  ままにし、pattern で縛らない（`S-001` と同じ）。 */
            inputMode="numeric"
            autoComplete="one-time-code"
            required
            disabled={state === 'submitting'}
            data-testid="admin-signin-2fa-code"
          />
        </Field>
        <Button
          className="w-full"
          type="submit"
          disabled={state === 'submitting'}
          data-testid="admin-signin-2fa-submit"
        >
          {state === 'submitting' ? messages.twoFactorSubmitting : messages.twoFactorSubmit}
        </Button>
      </form>
    );
  }

  return (
    <form onSubmit={onSubmitCredentials} noValidate data-testid="admin-signin-form">
      {errorBlock}
      <Field className="mb-4" label={messages.emailLabel}>
        <Input
          name="email"
          type="email"
          autoComplete="username"
          inputMode="email"
          required
          disabled={state === 'submitting'}
          data-testid="admin-signin-email"
        />
      </Field>
      <Field className="mb-4" label={messages.passwordLabel}>
        <Input
          name="password"
          type="password"
          autoComplete="current-password"
          required
          disabled={state === 'submitting'}
          data-testid="admin-signin-password"
        />
      </Field>
      <Button
        className="w-full"
        type="submit"
        disabled={state === 'submitting'}
        data-testid="admin-signin-submit"
      >
        {state === 'submitting' ? messages.submitting : messages.submit}
      </Button>
      {/* 🔴 主平面のパスワード再設定（`S-046`）への導線は置かない（`BR-36` の別テーブル・別認証。
          docs/04 §S-046「運営者のパスワード再設定は別ルート（`A-001`）が持つ」）。
          運営者向けの再設定は本画面が持つが、実装は SP-04 のメール単一経路に載せる。 */}
    </form>
  );
}
