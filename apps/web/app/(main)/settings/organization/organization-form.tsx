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
//
// 🔴 T-21-04: 手書き CSS を `@ses/ui` と Tailwind へ移した。
//    ⚠️ **チェックボックスの 2 箇所には `Field` の `label` prop を使っていない** ——
//    現況の DOM は「チェックボックス → 説明文」の順であり、`Field label=…` は
//    ラベル文字を先に描く。順序が変わると読み上げの順も変わる（SP-21 の
//    「要素の並びを変えない」）。ここは `<label>` を素のまま残し、見た目だけを移した。
import { useState, type FormEvent } from 'react';
import { Button, Checkbox, Field, FieldError, Input } from '@ses/ui';

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
      <h2 className="mb-3 text-base font-bold text-slate-900">{messages.organizationSection}</h2>
      {error === null ? null : <FieldError className="mb-4">{error}</FieldError>}
      {saved ? (
        <p className="mb-4 text-sm text-emerald-700" role="status">
          {messages.saved}
        </p>
      ) : null}

      <Field className="mb-4" label={messages.nameLabel}>
        <Input
          name="name"
          type="text"
          required
          value={name}
          onChange={(event) => setName(event.target.value)}
          disabled={saving}
        />
      </Field>

      {/* 🔴 タイムゾーン・通貨・環境・契約の状態は読み取り専用（入力欄を作らない）。 */}
      <Field as="p" className="mb-4" label={messages.timezoneLabel}>
        <output>{settings.timezone}</output>
      </Field>
      <Field as="p" className="mb-4" label={messages.currencyLabel}>
        <output>{messages.currencyValue}</output>
      </Field>
      <Field as="p" className="mb-4" label={messages.environmentLabel}>
        <output>{settings.environment}</output>
      </Field>
      <Field as="p" className="mb-4" label={messages.lifecycleLabel}>
        <output>{messages.lifecycleStateName}</output>
      </Field>
      <p className="mb-4 text-sm text-slate-500">{messages.lifecycleReadOnlyNote}</p>

      <Field className="mb-4" label={messages.piiRetentionYearsLabel}>
        <Input
          name="piiRetentionYears"
          type="number"
          inputMode="numeric"
          value={piiRetentionYears}
          onChange={(event) => setPiiRetentionYears(event.target.value)}
          disabled={saving}
        />
      </Field>

      <h2 className="mb-3 text-base font-bold text-slate-900">{messages.approvalSection}</h2>
      <p className="mb-2 text-sm text-slate-600">{messages.autoApproveScopeNote}</p>
      <label className="mb-4 flex items-center gap-2 text-sm">
        <Checkbox
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
          <p
            className="mb-2 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900"
            role="alert"
          >
            {messages.autoApproveWarning}
          </p>
          <label className="mb-4 flex items-center gap-2 text-sm">
            <Checkbox
              name="acknowledged"
              checked={acknowledged}
              onChange={(event) => setAcknowledged(event.target.checked)}
              disabled={saving}
            />
            <span>{messages.autoApproveConfirm}</span>
          </label>
        </>
      ) : null}

      <Button className="w-full" type="submit" disabled={saving || blocked}>
        {saving ? messages.saving : messages.save}
      </Button>

      {/* 🔴 Phase 0 の範囲を隠さない（メンバー一覧・招待は後続。docs/04 §S-035 は Phase 0→P1）。 */}
      <p className="mt-4 text-sm text-slate-500">{messages.membersComingSoon}</p>
    </form>
  );
}
