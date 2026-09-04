'use client';

// apps/web/app/admin/tenants/new/provisioning-form.tsx
// `A-014` の開設フォーム（docs/04 §A-014 / `F-001`）。T-03-10。
//
// 🔴 **確認ステップを飛ばさない**（docs/04 §A-014 セクション 7 / 操作表）。企業名・環境・
//    契約の初期状態・招待先アドレスを再掲してから開設する。**モバイルでも折りたたまない。**
// 🔴 **API-A4 と API-A5 は別のリクエストである**（docs/05 §10.7）。招待に失敗しても
//    「テナントは作成されました。招待の送信に失敗しています」と 2 つの事実を分けて示し、
//    **開設のやり直しに誘導しない**（重複テナントが生まれる）。再送だけを出す。
// 🔴 `provisioningRequestId` は**この画面で 1 度だけ採番し、再送時も同じ値を送る**
//    （docs/05 §10.7 の冪等キー）。押し直しで 2 つ目のテナントが生まれない。
// 🔴 文言は props（`packages/i18n` が唯一の出所）。ここにベタ書きしない。
import { useMemo, useState, type FormEvent } from 'react';

export type ProvisioningFormMessages = {
  readonly environmentSection: string;
  readonly environmentReadOnlyNote: string;
  readonly companySection: string;
  readonly nameLabel: string;
  readonly currencyLabel: string;
  readonly currencyValue: string;
  readonly duplicateNameWarning: string;
  readonly lifecycleSection: string;
  readonly lifecycleSandbox: string;
  readonly lifecycleActive: string;
  readonly lifecycleSandboxNote: string;
  readonly planSection: string;
  readonly planLabel: string;
  readonly planHint: string;
  readonly ownerSection: string;
  readonly ownerEmailLabel: string;
  readonly ownerSingleNote: string;
  readonly sendingDomainSection: string;
  readonly sendingDomainLabel: string;
  readonly sendingDomainNote: string;
  readonly defaultsSection: string;
  readonly defaults: readonly string[];
  readonly confirmSection: string;
  readonly confirmLead: string;
  readonly confirmReview: string;
  readonly confirmBack: string;
  readonly submit: string;
  readonly submitting: string;
  readonly notCreated: string;
  readonly invitationFailed: string;
  readonly duplicateRequest: string;
  readonly success: string;
  readonly retryInvitation: string;
};

/** 契約の初期状態（`TENANT_CREATION_STATES` と 1 対 1。docs/02 章 5.4）。 */
type LifecycleChoice = 'SANDBOX' | 'ACTIVE';

type Phase = 'input' | 'confirm' | 'submitting' | 'created';

type Draft = {
  readonly name: string;
  readonly lifecycleState: LifecycleChoice;
  readonly planId: string;
  readonly ownerEmail: string;
  readonly sendingDomain: string;
};

const EMPTY_DRAFT: Draft = {
  name: '',
  lifecycleState: 'SANDBOX',
  planId: '',
  ownerEmail: '',
  sendingDomain: '',
};

/**
 * 🔴 環境（`Tenant.environment`）は**選ばせない**（docs/04 §A-014 セクション 1）。
 *    契約の初期状態から決まる: 試用 = `sandbox` / 本契約 = 接続先の環境。
 *    組み合わせの妥当性はサーバ（`isValidTenantCreation`）が最終判定する。
 */
function environmentFor(appEnv: string, lifecycleState: LifecycleChoice): string {
  if (lifecycleState === 'SANDBOX') return 'sandbox';
  return appEnv === 'demo' ? 'demo' : 'production';
}

export function ProvisioningForm({
  messages,
  appEnv,
  existingNames,
}: {
  messages: ProvisioningFormMessages;
  /** 現在の `APP_ENV`（読み取り専用の表示 + `environment` の決定に使う）。 */
  appEnv: string;
  /** 同名テナントの警告（docs/04 §A-014）。開設は止めない。 */
  existingNames: readonly string[];
}) {
  const [phase, setPhase] = useState<Phase>('input');
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT);
  const [error, setError] = useState<string | null>(null);
  const [createdTenantId, setCreatedTenantId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // 🔴 マウント時に 1 度だけ採番する（再送でも同じ値を送る = 冪等キー。docs/05 §10.7）。
  const provisioningRequestId = useMemo(() => crypto.randomUUID(), []);

  const duplicateName = existingNames.some(
    (name) => name.trim() !== '' && name.trim() === draft.name.trim(),
  );
  const environment = environmentFor(appEnv, draft.lifecycleState);
  const busy = phase === 'submitting';

  function update<K extends keyof Draft>(key: K, value: Draft[K]): void {
    setDraft((current) => ({ ...current, [key]: value }));
  }

  /** 招待だけを送る（開設済みのテナントに対する再送。テナントは作り直さない）。 */
  async function sendInvitation(tenantId: string): Promise<boolean> {
    const response = await fetch(`/api/admin/tenants/${tenantId}/owner-invitation`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: draft.ownerEmail }),
    });
    return response.ok;
  }

  async function onRetryInvitation(): Promise<void> {
    if (createdTenantId === null || busy) return;
    setPhase('submitting');
    setError(null);
    try {
      const ok = await sendInvitation(createdTenantId);
      setNotice(ok ? messages.success : null);
      setError(ok ? null : messages.invitationFailed);
    } catch {
      setError(messages.invitationFailed);
    }
    setPhase('created');
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (busy) return;
    setPhase('submitting');
    setError(null);
    setNotice(null);

    try {
      const response = await fetch('/api/admin/tenants', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          name: draft.name,
          environment,
          lifecycleState: draft.lifecycleState,
          planId: draft.planId,
          provisioningRequestId,
          ...(draft.sendingDomain.trim() === ''
            ? {}
            : { sendingDomain: draft.sendingDomain.trim() }),
        }),
      });

      if (!response.ok) {
        // 🔴 「テナントは作成されていません」と明示する（中途半端に作られた可能性を残さない）。
        const conflict = response.status === 409;
        setError(conflict ? messages.duplicateRequest : messages.notCreated);
        setPhase('confirm');
        return;
      }

      const created = (await response.json()) as { readonly id: string };
      setCreatedTenantId(created.id);

      // 🔴 ここから先で失敗しても、開設はすでに成立している。
      const invited = await sendInvitation(created.id);
      setNotice(invited ? messages.success : null);
      setError(invited ? null : messages.invitationFailed);
      setPhase('created');
    } catch {
      // 🔴 テナント作成の応答を受け取れていない場合も「作成されていません」とは言い切れないため、
      //    再試行は同じ `provisioningRequestId` で行われる（2 つ目は 409 になる）。
      setError(messages.notCreated);
      setPhase('confirm');
    }
  }

  const errorBlock =
    error === null ? null : (
      <p className="ses-error" role="alert">
        {error}
      </p>
    );

  if (phase === 'created') {
    return (
      <section>
        {errorBlock}
        {notice === null ? null : <p role="status">{notice}</p>}
        <p>
          <a href={createdTenantId === null ? '/admin/tenants' : `/admin/tenants/${createdTenantId}`}>
            {draft.name}
          </a>
        </p>
        {error === null ? null : (
          <button type="button" onClick={() => void onRetryInvitation()} disabled={busy}>
            {messages.retryInvitation}
          </button>
        )}
      </section>
    );
  }

  if (phase === 'confirm' || phase === 'submitting') {
    return (
      <form onSubmit={onSubmit} noValidate>
        <h2>{messages.confirmSection}</h2>
        <p>{messages.confirmLead}</p>
        {errorBlock}
        {/* 🔴 再掲する 4 項目（docs/04 §A-014 操作表）。モバイルでも折りたたまない。 */}
        <dl>
          <dt>{messages.nameLabel}</dt>
          <dd>{draft.name}</dd>
          <dt>{messages.environmentSection}</dt>
          <dd>{environment}</dd>
          <dt>{messages.lifecycleSection}</dt>
          <dd>
            {draft.lifecycleState === 'SANDBOX'
              ? messages.lifecycleSandbox
              : messages.lifecycleActive}
          </dd>
          <dt>{messages.ownerEmailLabel}</dt>
          <dd>{draft.ownerEmail}</dd>
        </dl>
        {/* 🔴 既定値の明示は確認ステップでも消さない（docs/04 §A-014 セクション 6）。 */}
        <h3>{messages.defaultsSection}</h3>
        <ul>
          {messages.defaults.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
        <button type="submit" disabled={busy}>
          {busy ? messages.submitting : messages.submit}
        </button>
        <button type="button" onClick={() => setPhase('input')} disabled={busy}>
          {messages.confirmBack}
        </button>
      </form>
    );
  }

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        setPhase('confirm');
      }}
      noValidate
    >
      <h2>{messages.environmentSection}</h2>
      {/* 🔴 選ばせずに表示する（docs/04 §A-014 セクション 1）。 */}
      <p>
        <output>{appEnv}</output>
      </p>
      <p>{messages.environmentReadOnlyNote}</p>

      <h2>{messages.companySection}</h2>
      <label className="ses-field">
        <span>{messages.nameLabel}</span>
        <input
          name="name"
          type="text"
          required
          value={draft.name}
          onChange={(event) => update('name', event.target.value)}
        />
      </label>
      {duplicateName ? <p role="alert">{messages.duplicateNameWarning}</p> : null}
      <p className="ses-field">
        <span>{messages.currencyLabel}</span>
        <output>{messages.currencyValue}</output>
      </p>

      <h2>{messages.lifecycleSection}</h2>
      <label className="ses-field">
        <input
          type="radio"
          name="lifecycleState"
          value="SANDBOX"
          checked={draft.lifecycleState === 'SANDBOX'}
          onChange={() => update('lifecycleState', 'SANDBOX')}
        />
        <span>{messages.lifecycleSandbox}</span>
      </label>
      {draft.lifecycleState === 'SANDBOX' ? <p>{messages.lifecycleSandboxNote}</p> : null}
      <label className="ses-field">
        <input
          type="radio"
          name="lifecycleState"
          value="ACTIVE"
          checked={draft.lifecycleState === 'ACTIVE'}
          onChange={() => update('lifecycleState', 'ACTIVE')}
        />
        <span>{messages.lifecycleActive}</span>
      </label>

      <h2>{messages.planSection}</h2>
      <label className="ses-field">
        <span>{messages.planLabel}</span>
        <input
          name="planId"
          type="text"
          required
          value={draft.planId}
          onChange={(event) => update('planId', event.target.value)}
        />
      </label>
      <p>{messages.planHint}</p>

      <h2>{messages.ownerSection}</h2>
      <label className="ses-field">
        <span>{messages.ownerEmailLabel}</span>
        <input
          name="ownerEmail"
          type="email"
          inputMode="email"
          required
          value={draft.ownerEmail}
          onChange={(event) => update('ownerEmail', event.target.value)}
        />
      </label>
      <p>{messages.ownerSingleNote}</p>

      <h2>{messages.sendingDomainSection}</h2>
      <label className="ses-field">
        <span>{messages.sendingDomainLabel}</span>
        <input
          name="sendingDomain"
          type="text"
          value={draft.sendingDomain}
          onChange={(event) => update('sendingDomain', event.target.value)}
        />
      </label>
      <p>{messages.sendingDomainNote}</p>

      {/* 🔴 開設**前**に既定値を運営者に読ませる（docs/04 §A-014 セクション 6 の「なぜこの構成か」）。 */}
      <h2>{messages.defaultsSection}</h2>
      <ul>
        {messages.defaults.map((line) => (
          <li key={line}>{line}</li>
        ))}
      </ul>

      <button type="submit">{messages.confirmReview}</button>
    </form>
  );
}
