'use client';

// apps/web/app/(main)/settings/organization/organization-form.tsx
// `S-035` の組織設定フォーム（docs/04 §S-035 / `F-001` / `F-021`）。T-03-10。
//
// 🔴 **`lifecycleState` は読み取り専用**（docs/05 §6.3 #64）。入力欄を持たず、PATCH の body にも
//    載せない。担保の主体は DB の列レベル `GRANT`（migration 20260905000000）であり、
//    この画面はその事実を利用者に**説明する**（変更できない理由を書く）。
// 🔴 承認ポリシーの有効化は**危険な操作としての確認ステップ**を伴う（docs/04 §S-035 操作表）:
//    警告文 + チェックボックスによる同意が無いと有効にできない。
// 🔴 `autoApproveEnabled`（提案の承認・テナント単位）と `S-039` の AI ロール別承認モードを
//    同じブロックに置かない（`F-035 AC-6`）。違いの 1 行説明を添える。
import { useState, type FormEvent } from 'react';

export type OrganizationSettings = {
  readonly name: string;
  readonly environment: string;
  readonly lifecycleState: string;
  readonly autoApproveEnabled: boolean;
  readonly piiRetentionYears: number;
  readonly timezone: string;
};

export type OrganizationFormMessages = {
  readonly organizationSection: string;
  readonly nameLabel: string;
  readonly timezoneLabel: string;
  readonly currencyLabel: string;
  readonly currencyValue: string;
  readonly environmentLabel: string;
  readonly lifecycleLabel: string;
  readonly lifecycleReadOnlyNote: string;
  readonly lifecycleStateName: string;
  readonly piiRetentionYearsLabel: string;
  readonly approvalSection: string;
  readonly autoApproveLabel: string;
  readonly autoApproveWarning: string;
  readonly autoApproveConfirm: string;
  readonly autoApproveScopeNote: string;
  readonly save: string;
  readonly saving: string;
  readonly saved: string;
  readonly saveFailed: string;
  readonly membersComingSoon: string;
};

export function OrganizationForm({
  initial,
  messages,
}: {
  initial: OrganizationSettings;
  messages: OrganizationFormMessages;
}) {
  const [settings, setSettings] = useState<OrganizationSettings>(initial);
  const [name, setName] = useState(initial.name);
  const [piiRetentionYears, setPiiRetentionYears] = useState(String(initial.piiRetentionYears));
  const [autoApprove, setAutoApprove] = useState(initial.autoApproveEnabled);
  const [acknowledged, setAcknowledged] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  // 🔴 「オフ → オン」に変えるときだけ同意を要求する（オフに戻すのは安全側の操作）。
  const turningOn = autoApprove && !settings.autoApproveEnabled;
  const blocked = turningOn && !acknowledged;

  async function onSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (saving || blocked) return;
    setSaving(true);
    setError(null);
    setSaved(false);

    try {
      const response = await fetch('/api/settings/organization', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          name,
          autoApproveEnabled: autoApprove,
          piiRetentionYears: Number(piiRetentionYears),
        }),
      });
      if (!response.ok) {
        setError(messages.saveFailed);
        setSaving(false);
        return;
      }
      const updated = (await response.json()) as OrganizationSettings;
      setSettings(updated);
      setName(updated.name);
      setPiiRetentionYears(String(updated.piiRetentionYears));
      setAutoApprove(updated.autoApproveEnabled);
      setAcknowledged(false);
      setSaved(true);
    } catch {
      setError(messages.saveFailed);
    }
    setSaving(false);
  }

  return (
    <form onSubmit={onSubmit} noValidate>
      <h2>{messages.organizationSection}</h2>
      {error === null ? null : (
        <p className="ses-error" role="alert">
          {error}
        </p>
      )}
      {saved ? <p role="status">{messages.saved}</p> : null}

      <label className="ses-field">
        <span>{messages.nameLabel}</span>
        <input
          name="name"
          type="text"
          required
          value={name}
          onChange={(event) => setName(event.target.value)}
          disabled={saving}
        />
      </label>

      {/* 🔴 タイムゾーン・通貨・環境・契約の状態は読み取り専用（入力欄を作らない）。 */}
      <p className="ses-field">
        <span>{messages.timezoneLabel}</span>
        <output>{settings.timezone}</output>
      </p>
      <p className="ses-field">
        <span>{messages.currencyLabel}</span>
        <output>{messages.currencyValue}</output>
      </p>
      <p className="ses-field">
        <span>{messages.environmentLabel}</span>
        <output>{settings.environment}</output>
      </p>
      <p className="ses-field">
        <span>{messages.lifecycleLabel}</span>
        <output>{messages.lifecycleStateName}</output>
      </p>
      <p>{messages.lifecycleReadOnlyNote}</p>

      <label className="ses-field">
        <span>{messages.piiRetentionYearsLabel}</span>
        <input
          name="piiRetentionYears"
          type="number"
          inputMode="numeric"
          value={piiRetentionYears}
          onChange={(event) => setPiiRetentionYears(event.target.value)}
          disabled={saving}
        />
      </label>

      <h2>{messages.approvalSection}</h2>
      <p>{messages.autoApproveScopeNote}</p>
      <label className="ses-field">
        <input
          type="checkbox"
          name="autoApproveEnabled"
          checked={autoApprove}
          onChange={(event) => setAutoApprove(event.target.checked)}
          disabled={saving}
        />
        <span>{messages.autoApproveLabel}</span>
      </label>
      {turningOn ? (
        <>
          {/* 🔴 危険な操作の確認（docs/04 §S-035）。1 層でも不合格なら人間に差し戻される旨を明記。 */}
          <p role="alert">{messages.autoApproveWarning}</p>
          <label className="ses-field">
            <input
              type="checkbox"
              name="acknowledged"
              checked={acknowledged}
              onChange={(event) => setAcknowledged(event.target.checked)}
              disabled={saving}
            />
            <span>{messages.autoApproveConfirm}</span>
          </label>
        </>
      ) : null}

      <button className="ses-submit" type="submit" disabled={saving || blocked}>
        {saving ? messages.saving : messages.save}
      </button>

      {/* 🔴 Phase 0 の範囲を隠さない（メンバー一覧・招待は後続。docs/04 §S-035 は Phase 0→P1）。 */}
      <p>{messages.membersComingSoon}</p>
    </form>
  );
}
