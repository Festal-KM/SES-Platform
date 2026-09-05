'use client';

// apps/web/app/(main)/(auth)/password-reset/request-form.tsx
// `S-046` ①②（docs/04 §S-046 / T1 = モバイル完結）。
//
// 🔴 存在有無を漏らさない: 応答の中身（ステータス・ボディ）を見て分岐しない。届いた時点で
//    常に同一の完了表示にする（`classifyRequestOutcome` の型がそれ以外を受け取れない）。
//    ネットワーク例外（接続不可）のときだけ例外的に別の表示になる（docs/04 §S-046）。
// 🔴 送信中はボタンを送信中表示に置換する（二重送信防止。`createSubmitGuard` が実行そのものを
//    1 回に畳み、UI の disabled はその結果を表示するだけ）。
// 🔴 文言は props で受け取る（`packages/i18n` が唯一の出所。ここにベタ書きしない）。
//
// 🔴 送信前のローカル検証（`isPlausibleEmail`）: `noValidate`（二重送信ガードのため付与）で
//    ブラウザの `type="email"` / `required` は働かない。本フォームは応答の中身を意図的に
//    見ないため、検証をここで行わないと空欄・形式不正のメールアドレスでも #5 を叩いて
//    「ご登録のメールアドレス宛に…お送りしました」が表示されてしまう
//    （#5 は 400 VALIDATION を返しメールは送られない ＝ `CLAUDE.md` §11.1 が名指しする
//    「成功したように見えて実際には送信されていない」壊れ方そのもの）。
//    判定は入力構文のみに基づきサーバ応答を読まないため、①②の非開示仕様は破らない。
import { useRef, useState, type FormEvent } from 'react';
import { createSubmitGuard } from '../../../../lib/forms/submit-guard';
import { classifyRequestOutcome, isPlausibleEmail } from '../../../../lib/password-reset/outcome';

export type RequestFormMessages = {
  readonly eyebrow: string;
  readonly emailLabel: string;
  readonly submit: string;
  readonly submitting: string;
  readonly backToSignIn: string;
  readonly networkError: string;
  readonly validationError: string;
  readonly completeEyebrow: string;
  readonly completeMessage: string;
  readonly completeNote: string;
};

type Stage = 'form' | 'complete';

const SIGNIN_PATH = '/signin';

export function RequestForm({ messages }: { messages: RequestFormMessages }) {
  const guardRef = useRef(createSubmitGuard<ReturnType<typeof classifyRequestOutcome>>());
  const [stage, setStage] = useState<Stage>('form');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (guardRef.current.pending) return;

    const data = new FormData(event.currentTarget);
    const email = String(data.get('email') ?? '');
    // 🔴 構文のみのローカル検証（サーバ応答は読まない。上記コメント参照）。
    if (!isPlausibleEmail(email)) {
      setError(messages.validationError);
      return;
    }

    setSubmitting(true);
    setError(null);

    const outcome = await guardRef.current.run(async () => {
      try {
        await fetch('/api/auth/password-reset', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ email }),
        });
        // 🔴 該当アカウントの有無によらず常に 204（docs/05 §6.3 #5）。応答の中身を見ない。
        return classifyRequestOutcome(true);
      } catch {
        return classifyRequestOutcome(false);
      }
    });

    setSubmitting(false);
    if (outcome === 'submitted') {
      setStage('complete');
      return;
    }
    if (outcome === 'network-error') {
      setError(messages.networkError);
    }
    // outcome === null: ガードにより弾かれた二重送信。表示を変えない。
  }

  if (stage === 'complete') {
    return (
      <div data-testid="password-reset-complete">
        <h2>{messages.completeEyebrow}</h2>
        <p className="ses-notice" data-testid="password-reset-complete-message">
          {messages.completeMessage}
        </p>
        <p>{messages.completeNote}</p>
        <a className="ses-secondary-link" href={SIGNIN_PATH}>
          {messages.backToSignIn}
        </a>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} noValidate data-testid="password-reset-request-form">
      <h2>{messages.eyebrow}</h2>
      {error === null ? null : (
        <p className="ses-error" role="alert" data-testid="password-reset-request-error">
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
          disabled={submitting}
          data-testid="password-reset-email"
        />
      </label>
      <button
        className="ses-submit"
        type="submit"
        disabled={submitting}
        data-testid="password-reset-request-submit"
      >
        {submitting ? messages.submitting : messages.submit}
      </button>
      <a className="ses-secondary-link" href={SIGNIN_PATH}>
        {messages.backToSignIn}
      </a>
    </form>
  );
}
