'use client';

// apps/web/app/(main)/settings/account/account-form.tsx
// `S-048` アカウント設定のフォーム（2026-10-16。Issue #95）。
//
// 🔴 **2 つのフォームに分ける。** 「表示名・役職」と「パスワード」は**成功・失敗が別もの**で
//    あり（一方が通って他方が落ちる）、1 つの送信ボタンにまとめると「どこまで保存されたか」が
//    利用者に分からなくなる。API も別である（`PATCH /api/settings/account` /
//    `POST /api/settings/account/password`）。
// 🔴 **メールアドレスは入力欄にしない**（読み取り専用の行として出し、**変えられない理由を書く**）
//    —— サインインの識別子であり、変更には新しいアドレスの到達確認が要る
//    （`lib/settings/account.ts` の `AccountSettingsView.email` の 🔴）。
//    `S-035` が `lifecycleState` を同じ形（読み取り専用 + 理由）で出しているのに倣う。
// 🔴 **アイコン画像の入力欄を置かない**（イニシャルの円のまま）—— アップロードは
//    **ウイルススキャンが `CLEAN` になるまで共有 URL を発行しない**（`CLAUDE.md` §3.4）経路が
//    必要であり、ストレージと配信を伴う別タスクである。**押して何も起きない欄を置かない。**
// 🔴 **ロールは読み取り専用で必ず出す** —— 「なぜこの操作ができないか」の一次説明であり、
//    上部バーの「自分」メニュー（氏名 + ロール）を廃止したぶんをここが受け持つ。
// 🔴 **文言を持たない**（語はサーバ側のページが `packages/i18n` から解決して渡す）。
import { useState, type FormEvent } from 'react';
import { Alert, Button, Field, FieldError, Input } from '@ses/ui';

export type AccountSettings = {
  readonly displayName: string;
  readonly jobTitle: string | null;
  readonly email: string;
};

export type AccountFormMessages = {
  readonly profileSection: string;
  readonly displayNameLabel: string;
  readonly jobTitleLabel: string;
  readonly jobTitlePlaceholder: string;
  readonly jobTitleUnset: string;
  readonly emailLabel: string;
  readonly emailReadOnlyNote: string;
  readonly roleLabel: string;
  readonly roleName: string;
  readonly avatarLabel: string;
  readonly avatarNote: string;
  readonly save: string;
  readonly saving: string;
  readonly saved: string;
  readonly saveFailed: string;
  readonly passwordSection: string;
  readonly passwordNote: string;
  readonly currentPasswordLabel: string;
  readonly newPasswordLabel: string;
  readonly newPasswordNote: string;
  readonly passwordSubmit: string;
  readonly passwordSubmitting: string;
  readonly passwordChanged: string;
  readonly passwordFailed: string;
};

const PROFILE_ENDPOINT = '/api/settings/account';
const PASSWORD_ENDPOINT = '/api/settings/account/password';

/** 読み取り専用の行（メールアドレス / ロール / アイコン）。🔴 入力欄に見せない。 */
function ReadOnlyRow({
  label,
  value,
  note,
}: {
  readonly label: string;
  readonly value: string;
  readonly note: string | null;
}) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-cell text-fg-muted">{label}</span>
      <span className="text-row text-fg">{value}</span>
      {note === null ? null : <p className="m-0 text-cell text-fg-muted">{note}</p>}
    </div>
  );
}

export function AccountForm({
  initial,
  initials,
  roleName,
  messages,
}: {
  readonly initial: AccountSettings;
  /** 🔴 **解決済みのイニシャル 1〜2 文字**（切り出しは呼び出し側。`@ses/ui` の `Avatar` の 🔴）。 */
  readonly initials: string;
  readonly roleName: string;
  readonly messages: AccountFormMessages;
}) {
  const [displayName, setDisplayName] = useState(initial.displayName);
  const [jobTitle, setJobTitle] = useState(initial.jobTitle ?? '');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [changing, setChanging] = useState(false);
  const [changed, setChanged] = useState(false);
  const [passwordError, setPasswordError] = useState<string | null>(null);

  async function onSaveProfile(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (saving) return;
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      const response = await fetch(PROFILE_ENDPOINT, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        cache: 'no-store',
        // 🔴 **空文字は `null`（未設定）として送る** —— サーバ側でも畳むが、
        //    「空欄のまま保存したら未設定に戻る」ことを画面の側でも成立させる。
        body: JSON.stringify({ displayName, jobTitle: jobTitle.trim() === '' ? null : jobTitle }),
      });
      if (!response.ok) throw new Error(messages.saveFailed);
      setSaved(true);
    } catch {
      setError(messages.saveFailed);
    } finally {
      setSaving(false);
    }
  }

  async function onChangePassword(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (changing) return;
    setChanging(true);
    setPasswordError(null);
    setChanged(false);
    try {
      const response = await fetch(PASSWORD_ENDPOINT, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        cache: 'no-store',
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      // 🔴 **失敗の理由を区別しない**（サーバも区別しない。`route.ts` の 🔴）。
      if (!response.ok) throw new Error(messages.passwordFailed);
      setChanged(true);
      // 🔴 **入力を残さない**（平文を画面に置き続けない）。
      setCurrentPassword('');
      setNewPassword('');
    } catch {
      setPasswordError(messages.passwordFailed);
    } finally {
      setChanging(false);
    }
  }

  return (
    <div className="flex flex-col gap-8" data-testid="account-settings">
      {/* 🔴 **`method="post"` を必ず書く**（`tests/static/form-method-required.test.ts`）——
          書かないと**水和前の既定が GET** になり、送信した値（ここにはパスワードが在る）が
          そのまま URL に載る。`onSubmit` で `preventDefault` していても、JS が動く前の
          1 回目は素の `<form>` として送られる。 */}
      <form
        method="post"
        className="flex flex-col gap-4"
        onSubmit={onSaveProfile}
        data-testid="account-profile-form"
      >
        <h2 className="m-0 text-section text-fg">{messages.profileSection}</h2>

        {/* 🔴 **アイコン画像は読み取り専用の行で「できないこと」を書く**（冒頭の 🔴）。
            ⚠️ **装飾のイニシャルの円を置かない** —— 画像を扱えないのに丸が在ると
            「ここを押せば変えられる」に見える。イニシャルはサイドバー下部に既に在る。 */}
        <ReadOnlyRow label={messages.avatarLabel} value={initials} note={messages.avatarNote} />

        <Field label={messages.displayNameLabel} htmlFor="account-display-name">
          <Input
            id="account-display-name"
            name="displayName"
            value={displayName}
            required
            onChange={(event) => setDisplayName(event.target.value)}
            data-testid="account-display-name"
          />
        </Field>

        <Field label={messages.jobTitleLabel} htmlFor="account-job-title">
          <Input
            id="account-job-title"
            name="jobTitle"
            value={jobTitle}
            placeholder={messages.jobTitlePlaceholder}
            onChange={(event) => setJobTitle(event.target.value)}
            data-testid="account-job-title"
          />
        </Field>

        <ReadOnlyRow label={messages.emailLabel} value={initial.email} note={messages.emailReadOnlyNote} />
        <ReadOnlyRow label={messages.roleLabel} value={roleName} note={null} />

        {error === null ? null : <FieldError>{error}</FieldError>}
        {saved ? <Alert variant="success">{messages.saved}</Alert> : null}
        <div>
          <Button type="submit" disabled={saving} data-testid="account-profile-save">
            {saving ? messages.saving : messages.save}
          </Button>
        </div>
      </form>

      <form
        method="post"
        className="flex flex-col gap-4"
        onSubmit={onChangePassword}
        data-testid="account-password-form"
      >
        <h2 className="m-0 text-section text-fg">{messages.passwordSection}</h2>
        <p className="m-0 text-cell text-fg-muted">{messages.passwordNote}</p>

        <Field label={messages.currentPasswordLabel} htmlFor="account-current-password">
          <Input
            id="account-current-password"
            name="currentPassword"
            type="password"
            autoComplete="current-password"
            value={currentPassword}
            required
            onChange={(event) => setCurrentPassword(event.target.value)}
            data-testid="account-current-password"
          />
        </Field>

        <Field
          label={messages.newPasswordLabel}
          htmlFor="account-new-password"
          description={messages.newPasswordNote}
        >
          <Input
            id="account-new-password"
            name="newPassword"
            type="password"
            autoComplete="new-password"
            value={newPassword}
            required
            onChange={(event) => setNewPassword(event.target.value)}
            data-testid="account-new-password"
          />
        </Field>

        {passwordError === null ? null : <FieldError>{passwordError}</FieldError>}
        {changed ? <Alert variant="success">{messages.passwordChanged}</Alert> : null}
        <div>
          <Button type="submit" disabled={changing} data-testid="account-password-save">
            {changing ? messages.passwordSubmitting : messages.passwordSubmit}
          </Button>
        </div>
      </form>
    </div>
  );
}
