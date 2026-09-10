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
//
// 🔴 T-21-05: 手書き CSS（`.ses-field` / `.ses-error`）と無指定の要素を `@ses/ui` と
//    Tailwind へ移した。**入力の `name` / `type` / `required` / `checked` / 要素の並び・
//    フェーズの分岐・冪等キーの扱いは 1 つも変えていない**（`docs/sprints/SP-21` §5 冒頭）。
// 🔴 **確認ステップの 4 項目と既定値の一覧は、移行後もモバイルで折りたたまない**
//    （`docs/04` §A-014 操作表 / `CLAUDE.md` §13.3）。畳めるようにする実装を入れない。
import { useMemo, useState, type FormEvent } from 'react';
import { Button, Field, FieldError, Input, Radio } from '@ses/ui';

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

/**
 * 節の見出し。旧実装は無指定の `<h2>` であり、Tailwind の preflight 下では本文と同じ
 * 大きさで並んでいた（節の切れ目が読めない）。**1 つの定数にして 6 節で共有する** ——
 * 節ごとに書き下すと「片方だけ直る」状態がその場で生まれる（T-21-02 の受け入れ基準 ①）。
 */
const SECTION_HEADING_CLASSES = 'mt-6 mb-2 text-base font-bold text-slate-900';

/** 節に添える補足文（読み取り専用の注記・ヒント）。 */
const SECTION_NOTE_CLASSES = 'mb-4 text-sm text-slate-600';

/**
 * 🔴 開設**前**に読ませる既定値の一覧（`docs/04` §A-014 セクション 6）。
 *    Tailwind の preflight が `ul` の `list-style` と `padding` を落とすため、
 *    箇条書きに見せるには `list-disc` と `pl-5` を明示する必要がある。
 */
const DEFAULTS_LIST_CLASSES = 'mb-4 list-disc pl-5 text-sm text-slate-700';

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

  const errorBlock = error === null ? null : <FieldError className="mb-4">{error}</FieldError>;

  if (phase === 'created') {
    return (
      <section>
        {errorBlock}
        {notice === null ? null : (
          <p role="status" className="mb-4 text-sm text-emerald-700">
            {notice}
          </p>
        )}
        <p className="mb-4 text-sm">
          <a
            className="font-medium text-slate-900 underline-offset-2 hover:underline"
            href={createdTenantId === null ? '/admin/tenants' : `/admin/tenants/${createdTenantId}`}
          >
            {draft.name}
          </a>
        </p>
        {error === null ? null : (
          <Button type="button" onClick={() => void onRetryInvitation()} disabled={busy}>
            {messages.retryInvitation}
          </Button>
        )}
      </section>
    );
  }

  if (phase === 'confirm' || phase === 'submitting') {
    return (
      <form onSubmit={onSubmit} noValidate>
        <h2 className="mb-2 text-base font-bold text-slate-900">{messages.confirmSection}</h2>
        <p className={SECTION_NOTE_CLASSES}>{messages.confirmLead}</p>
        {errorBlock}
        {/* 🔴 再掲する 4 項目（docs/04 §A-014 操作表）。モバイルでも折りたたまない。
              2 列グリッドはラベル列が内容幅なので、狭い画面でも値が潰れない。長い
              メールアドレスは `wrap-anywhere` で折り返して**全部見せる**（切り詰めない）。 */}
        <dl className="mb-6 grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 border-y border-slate-200 py-3 text-sm">
          <dt className="text-slate-500">{messages.nameLabel}</dt>
          <dd className="wrap-anywhere text-slate-900">{draft.name}</dd>
          <dt className="text-slate-500">{messages.environmentSection}</dt>
          <dd className="text-slate-900">{environment}</dd>
          <dt className="text-slate-500">{messages.lifecycleSection}</dt>
          <dd className="text-slate-900">
            {draft.lifecycleState === 'SANDBOX'
              ? messages.lifecycleSandbox
              : messages.lifecycleActive}
          </dd>
          <dt className="text-slate-500">{messages.ownerEmailLabel}</dt>
          <dd className="wrap-anywhere text-slate-900">{draft.ownerEmail}</dd>
        </dl>
        {/* 🔴 既定値の明示は確認ステップでも消さない（docs/04 §A-014 セクション 6）。 */}
        <h3 className="mb-1 text-sm font-bold text-slate-900">{messages.defaultsSection}</h3>
        <ul className={DEFAULTS_LIST_CLASSES}>
          {messages.defaults.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
        {/* 見た目のためのラッパ。ボタンの並び（開設 → 戻る）は変えていない。 */}
        <div className="flex flex-wrap items-center gap-3">
          <Button type="submit" disabled={busy}>
            {busy ? messages.submitting : messages.submit}
          </Button>
          <Button
            type="button"
            variant="secondary"
            onClick={() => setPhase('input')}
            disabled={busy}
          >
            {messages.confirmBack}
          </Button>
        </div>
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
      <h2 className="mb-2 text-base font-bold text-slate-900">{messages.environmentSection}</h2>
      {/* 🔴 選ばせずに表示する（docs/04 §A-014 セクション 1）。 */}
      <p className="mb-1 text-sm font-medium text-slate-900">
        <output>{appEnv}</output>
      </p>
      <p className={SECTION_NOTE_CLASSES}>{messages.environmentReadOnlyNote}</p>

      <h2 className={SECTION_HEADING_CLASSES}>{messages.companySection}</h2>
      <Field className="mb-4" label={messages.nameLabel}>
        <Input
          name="name"
          type="text"
          required
          value={draft.name}
          onChange={(event) => update('name', event.target.value)}
        />
      </Field>
      {/* 🔴 同名テナントは**警告であって禁止ではない**（開設は止めない。docs/04 §A-014）。
            `FieldError` の赤にすると「直さないと進めない」と読めるため琥珀で出す
            （既存画面の警告帯と同じ語。`S-011` / `S-013` / `S-035` / `S-036`）。 */}
      {duplicateName ? (
        <p
          role="alert"
          className="mb-4 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900"
        >
          {messages.duplicateNameWarning}
        </p>
      ) : null}
      <Field as="p" className="mb-4" label={messages.currencyLabel}>
        <output className="text-sm text-slate-900">{messages.currencyValue}</output>
      </Field>

      <h2 className={SECTION_HEADING_CLASSES}>{messages.lifecycleSection}</h2>
      {/* 🔴 ラジオはラベル文字が**後ろ**に来る。`Field` の `label` prop は文字を先に描くため
            使わない（SP-21 の「要素の並びを変えない」）。見た目は `Radio` が持つ。 */}
      <label className="mb-2 flex w-fit items-center gap-2 text-sm font-medium text-slate-900 select-none">
        <Radio
          name="lifecycleState"
          value="SANDBOX"
          checked={draft.lifecycleState === 'SANDBOX'}
          onChange={() => update('lifecycleState', 'SANDBOX')}
        />
        <span>{messages.lifecycleSandbox}</span>
      </label>
      {draft.lifecycleState === 'SANDBOX' ? (
        <p className={SECTION_NOTE_CLASSES}>{messages.lifecycleSandboxNote}</p>
      ) : null}
      <label className="mb-2 flex w-fit items-center gap-2 text-sm font-medium text-slate-900 select-none">
        <Radio
          name="lifecycleState"
          value="ACTIVE"
          checked={draft.lifecycleState === 'ACTIVE'}
          onChange={() => update('lifecycleState', 'ACTIVE')}
        />
        <span>{messages.lifecycleActive}</span>
      </label>

      <h2 className={SECTION_HEADING_CLASSES}>{messages.planSection}</h2>
      <Field className="mb-1" label={messages.planLabel}>
        <Input
          name="planId"
          type="text"
          required
          value={draft.planId}
          onChange={(event) => update('planId', event.target.value)}
        />
      </Field>
      <p className={SECTION_NOTE_CLASSES}>{messages.planHint}</p>

      <h2 className={SECTION_HEADING_CLASSES}>{messages.ownerSection}</h2>
      <Field className="mb-1" label={messages.ownerEmailLabel}>
        <Input
          name="ownerEmail"
          type="email"
          inputMode="email"
          required
          value={draft.ownerEmail}
          onChange={(event) => update('ownerEmail', event.target.value)}
        />
      </Field>
      <p className={SECTION_NOTE_CLASSES}>{messages.ownerSingleNote}</p>

      <h2 className={SECTION_HEADING_CLASSES}>{messages.sendingDomainSection}</h2>
      <Field className="mb-1" label={messages.sendingDomainLabel}>
        <Input
          name="sendingDomain"
          type="text"
          value={draft.sendingDomain}
          onChange={(event) => update('sendingDomain', event.target.value)}
        />
      </Field>
      <p className={SECTION_NOTE_CLASSES}>{messages.sendingDomainNote}</p>

      {/* 🔴 開設**前**に既定値を運営者に読ませる（docs/04 §A-014 セクション 6 の「なぜこの構成か」）。 */}
      <h2 className={SECTION_HEADING_CLASSES}>{messages.defaultsSection}</h2>
      <ul className={DEFAULTS_LIST_CLASSES}>
        {messages.defaults.map((line) => (
          <li key={line}>{line}</li>
        ))}
      </ul>

      <Button type="submit">{messages.confirmReview}</Button>
    </form>
  );
}
