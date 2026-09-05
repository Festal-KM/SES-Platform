'use client';

// apps/web/app/(main)/settings/sending-domains/sending-domain-screen.tsx
// `S-036` 送信ドメインの設定と検証 — 本体（docs/04 §S-036 / `F-001 AC-4`）。T-04-06。
//
// 🔴 未検証は「壊れている」ではなく「取引先へ送信できない状態」として、理由と手順とともに
//    示す（`BR-46`）。送信を試みて失敗させるボタンを置かない —— 失敗しうる操作は
//    最初から描画しない（`requireVerifiedSendingDomain` が守る境界を画面側でも再現する）。
// 🔴 状態は 4 値（`REGISTERED` / `PENDING` / `VERIFIED` / `FAILED`）であってエラーではない
//    （`docs/04` `program-design` 申し送り 8）。「登録が 1 件も無い」は 5 つ目の DB 値では
//    なく、この画面が扱う 5 つ目の**表示上の**状態（`domain === null`）である。
// 🔴 ドメインの再登録・変更フォームは持たない —— `#71` は `(tenant_id, domain)` の
//    `UNIQUE` で新規ドメインごとに別行を作る仕様であり、既存行を「編集」する API が
//    無い（docs/05 §6.3 #71）。登録済みのときに再びフォームを出すと、別ドメインとして
//    2 行目を作ってしまい「どちらが有効か」を利用者が誤認する経路になる。
import { useEffect, useState, type FormEvent } from 'react';
import { Button } from '@ses/ui';
import type { SendingDomainDnsRecord } from '@ses/connectors';
import type { TenantSendingDomainState } from '@ses/db';
import { SendingDomainStatusFact, type SendingDomainStatusFactMessages } from '../../_shared/sending-domain-status';
import {
  resolveSendingDomainFact,
  type SendingDomainFact,
} from '../../../../lib/settings/sending-domain-fact';
import type { SendingDomainListView, SendingDomainView } from '../../../../lib/settings/sending-domains';

export type SendingDomainScreenMessages = {
  readonly onboardingHeading: string;
  readonly onboardingSteps: readonly [string, string, string, string];
  readonly onboardingGoal: string;

  readonly sectionStatus: string;
  readonly fact: SendingDomainStatusFactMessages;

  readonly bannerUnset: string;
  readonly bannerFailed: string;
  readonly failureReasonLabels: Readonly<Record<string, string>>;

  readonly sectionRegister: string;
  readonly registerDomainLabel: string;
  readonly registerPlaceholder: string;
  readonly registerSubmit: string;
  readonly registerSubmitting: string;
  readonly registerError: string;
  readonly registerOwnerOnlyNote: string;

  readonly sectionRecords: string;
  readonly recordsColumnType: string;
  readonly recordsColumnName: string;
  readonly recordsColumnValue: string;
  readonly recordsColumnCopy: string;
  readonly recordsColumnResult: string;
  readonly recordsResultConfirmed: string;
  readonly recordsResultUnconfirmed: string;
  readonly recordsCopy: string;
  readonly recordsCopied: string;
  readonly recordsCopyFailed: string;
  readonly recordsDkimPending: string;
  readonly recordPurposeLabels: Readonly<Record<SendingDomainDnsRecord['purposeKey'], string>>;

  readonly verifySubmit: string;
  readonly verifySubmitting: string;
  readonly verifyRequested: string;
  readonly verifyPending: string;
  readonly verifyPendingNote: string;
  readonly verifyError: string;

  readonly sectionAffects: string;
  readonly affectsBlocked: string;
  readonly affectedFeatures: readonly string[];
  readonly exclusionMemberInvite: string;
  readonly exclusionMemberInviteNote: string;
  readonly exclusionEsign: string;
};

type RegisterPhase = 'idle' | 'submitting' | 'error';
type VerifyPhase = 'idle' | 'submitting' | 'error';
type CopyStatus = 'ok' | 'error';

function recordKey(record: SendingDomainDnsRecord, index: number): string {
  return `${record.type}-${record.name}-${index}`;
}

export function SendingDomainScreen({
  initial,
  canRegister,
  messages,
}: {
  readonly initial: SendingDomainListView;
  /** 🔴 登録（#71 の POST）は `OWNER` のみ（docs/04 §S-036「権限差分」）。 */
  readonly canRegister: boolean;
  readonly messages: SendingDomainScreenMessages;
}) {
  const initialFact = resolveSendingDomainFact(initial);
  const initialDomain =
    initial.domains.find((row) => row.state === 'VERIFIED') ?? initial.domains[0] ?? null;

  const [domain, setDomain] = useState<SendingDomainView | null>(initialDomain);
  const [fact, setFact] = useState<SendingDomainFact>(initialFact);

  const [domainInput, setDomainInput] = useState('');
  const [registerPhase, setRegisterPhase] = useState<RegisterPhase>('idle');

  const [verifyPhase, setVerifyPhase] = useState<VerifyPhase>('idle');
  const [verifyRequested, setVerifyRequested] = useState(false);

  const [copyStatus, setCopyStatus] = useState<Readonly<Record<string, CopyStatus>>>({});

  // 🔴 ドメイン入力途中の離脱を確認する（docs/04 §S-036 状態遷移表。`invite-form.tsx` と同じ
  //    `beforeunload` パターン）。フォームが表示されていて（`domain === null`）、
  //    入力があり、送信中でないときだけ有効にする。登録に成功すると `domain` が非 null に
  //    なりフォーム自体が消えるため、この効果も自動的に無効になる。
  useEffect(() => {
    if (domain !== null || domainInput.trim() === '' || registerPhase === 'submitting') return undefined;
    const handler = (event: BeforeUnloadEvent): void => {
      event.preventDefault();
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [domain, domainInput, registerPhase]);

  async function onRegister(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (registerPhase === 'submitting') return;
    const trimmed = domainInput.trim();
    if (trimmed === '') {
      setRegisterPhase('error');
      return;
    }
    setRegisterPhase('submitting');
    try {
      const response = await fetch('/api/settings/sending-domains', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ domain: trimmed }),
      });
      if (!response.ok) {
        setRegisterPhase('error');
        return;
      }
      const created = (await response.json()) as SendingDomainView;
      setDomain(created);
      // 🔴 登録直後の応答は行の実際の値（4 値のいずれか）であり `NOT_REQUIRED` を取らない
      //    （`resolveSendingDomainFact` と同じ理由。sending-domain-fact.ts 冒頭コメント参照）。
      setFact({ kind: 'SET', domain: created.domain, state: created.state as TenantSendingDomainState });
      setDomainInput('');
      setRegisterPhase('idle');
    } catch {
      setRegisterPhase('error');
    }
  }

  async function onVerify(): Promise<void> {
    if (domain === null || verifyPhase === 'submitting') return;
    setVerifyPhase('submitting');
    setVerifyRequested(false);
    try {
      const response = await fetch(`/api/settings/sending-domains/${domain.id}/verify`, {
        method: 'POST',
      });
      if (!response.ok) {
        setVerifyPhase('error');
        return;
      }
      const body = (await response.json()) as { readonly state: string; readonly failureReasonKey?: string };
      setDomain((current) =>
        current === null
          ? current
          : {
              ...current,
              state: body.state as SendingDomainView['state'],
              failureReasonKey: (body.failureReasonKey as SendingDomainView['failureReasonKey']) ?? null,
            },
      );
      setFact((current) =>
        current.kind === 'SET' ? { ...current, state: body.state as typeof current.state } : current,
      );
      setVerifyRequested(true);
      setVerifyPhase('idle');
    } catch {
      setVerifyPhase('error');
    }
  }

  async function onCopy(key: string, value: string): Promise<void> {
    try {
      if (typeof navigator === 'undefined' || !navigator.clipboard) {
        throw new Error('clipboard unavailable');
      }
      await navigator.clipboard.writeText(value);
      setCopyStatus((prev) => ({ ...prev, [key]: 'ok' }));
    } catch {
      setCopyStatus((prev) => ({ ...prev, [key]: 'error' }));
    }
    window.setTimeout(() => {
      setCopyStatus((prev) => {
        if (!(key in prev)) return prev;
        const next = { ...prev };
        delete next[key];
        return next;
      });
    }, 2000);
  }

  const onboardingStrip = (
    <section
      data-testid="sending-domain-onboarding"
      className="mb-6 rounded-md border border-slate-200 bg-slate-50 p-4"
    >
      <h2 className="mb-2 text-sm font-semibold text-slate-700">{messages.onboardingHeading}</h2>
      <ol className="mb-2 flex flex-wrap items-center gap-2 text-xs text-slate-600">
        {messages.onboardingSteps.map((step, index) => {
          const isCurrent = index === messages.onboardingSteps.length - 1;
          return (
            <li key={step} className="flex items-center gap-2">
              {index > 0 ? <span aria-hidden="true">→</span> : null}
              <span
                className={
                  isCurrent
                    ? 'rounded bg-slate-900 px-2 py-1 font-semibold text-white'
                    : 'rounded border border-slate-300 px-2 py-1'
                }
              >
                {step}
              </span>
            </li>
          );
        })}
      </ol>
      <p className="text-xs text-slate-500">{messages.onboardingGoal}</p>
    </section>
  );

  if (fact.kind === 'NOT_REQUIRED') {
    return (
      <div data-testid="sending-domain-screen" data-fact-kind="NOT_REQUIRED">
        {onboardingStrip}
        <section className="mb-6">
          <h2 className="mb-2 text-sm font-semibold text-slate-700">{messages.sectionStatus}</h2>
          <SendingDomainStatusFact fact={fact} messages={messages.fact} />
        </section>
      </div>
    );
  }

  const allRecords: readonly SendingDomainDnsRecord[] =
    domain === null ? [] : [...domain.dkimRecords, ...domain.mailFromRecords];

  return (
    <div data-testid="sending-domain-screen" data-fact-kind={domain === null ? 'UNSET' : domain.state}>
      {onboardingStrip}

      <section className="mb-6">
        <h2 className="mb-2 text-sm font-semibold text-slate-700">{messages.sectionStatus}</h2>
        <SendingDomainStatusFact fact={fact} messages={messages.fact} />
      </section>

      {domain === null ? (
        <p
          data-testid="sending-domain-unset-banner"
          role="alert"
          className="mb-6 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900"
        >
          {messages.bannerUnset}
        </p>
      ) : null}

      {domain !== null && domain.state === 'FAILED' ? (
        <div
          data-testid="sending-domain-failed-banner"
          role="alert"
          className="mb-6 rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-900"
        >
          <p>{messages.bannerFailed}</p>
          {domain.failureReasonKey === null ? null : (
            <p data-testid="sending-domain-failure-reason">
              {messages.failureReasonLabels[domain.failureReasonKey] ?? domain.failureReasonKey}
            </p>
          )}
        </div>
      ) : null}

      {domain === null ? (
        <section className="mb-6" data-testid="sending-domain-register-section">
          <h2 className="mb-2 text-sm font-semibold text-slate-700">{messages.sectionRegister}</h2>
          {canRegister ? (
            <form onSubmit={onRegister} noValidate data-testid="sending-domain-register-form">
              <label className="mb-2 block text-sm">
                <span className="mb-1 block text-slate-700">{messages.registerDomainLabel}</span>
                <input
                  type="text"
                  name="domain"
                  required
                  placeholder={messages.registerPlaceholder}
                  value={domainInput}
                  disabled={registerPhase === 'submitting'}
                  onChange={(event) => setDomainInput(event.target.value)}
                  className="w-full max-w-sm rounded-md border border-slate-300 px-3 py-2 text-sm"
                  data-testid="sending-domain-register-input"
                />
              </label>
              {registerPhase === 'error' ? (
                <p role="alert" className="mb-2 text-sm text-red-700" data-testid="sending-domain-register-error">
                  {messages.registerError}
                </p>
              ) : null}
              <Button type="submit" disabled={registerPhase === 'submitting'} data-testid="sending-domain-register-submit">
                {registerPhase === 'submitting' ? messages.registerSubmitting : messages.registerSubmit}
              </Button>
            </form>
          ) : (
            <p className="text-sm text-slate-600" data-testid="sending-domain-register-owner-only">
              {messages.registerOwnerOnlyNote}
            </p>
          )}
        </section>
      ) : null}

      {domain !== null ? (
        <section className="mb-6" data-testid="sending-domain-records-section">
          <h2 className="mb-2 text-sm font-semibold text-slate-700">{messages.sectionRecords}</h2>
          {allRecords.length === 0 ? (
            <p className="text-sm text-slate-600" data-testid="sending-domain-records-empty">
              {messages.recordsDkimPending}
            </p>
          ) : (
            <>
              <div className="overflow-x-auto">
                <table className="w-full border-collapse text-sm" data-testid="sending-domain-records-table">
                  <thead>
                    <tr className="border-b border-slate-200 text-left text-slate-500">
                      <th className="px-3 py-2 font-medium">{messages.recordsColumnType}</th>
                      <th className="px-3 py-2 font-medium">{messages.recordsColumnName}</th>
                      <th className="px-3 py-2 font-medium">{messages.recordsColumnValue}</th>
                      <th className="px-3 py-2 font-medium">{messages.recordsColumnCopy}</th>
                      <th className="px-3 py-2 font-medium">{messages.recordsColumnResult}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {allRecords.map((record, index) => {
                      const key = recordKey(record, index);
                      const status = copyStatus[key];
                      return (
                        <tr key={key} className="border-b border-slate-100 align-top">
                          <td className="px-3 py-2 whitespace-nowrap">
                            {record.type}
                            <span className="ml-1 text-xs text-slate-400">
                              （{messages.recordPurposeLabels[record.purposeKey]}）
                            </span>
                          </td>
                          <td className="px-3 py-2 font-mono text-xs break-all">{record.name}</td>
                          <td className="px-3 py-2 font-mono text-xs break-all">{record.value}</td>
                          <td className="px-3 py-2">
                            <Button
                              type="button"
                              variant="secondary"
                              size="sm"
                              onClick={() => void onCopy(key, record.value)}
                              data-testid={`sending-domain-record-copy-${index}`}
                            >
                              {messages.recordsCopy}
                            </Button>
                            {status === undefined ? null : (
                              <span
                                role="status"
                                className={
                                  status === 'ok' ? 'ml-2 text-xs text-emerald-700' : 'ml-2 text-xs text-red-700'
                                }
                                data-testid={`sending-domain-record-copy-feedback-${index}`}
                              >
                                {status === 'ok' ? messages.recordsCopied : messages.recordsCopyFailed}
                              </span>
                            )}
                          </td>
                          <td className="px-3 py-2 whitespace-nowrap">
                            {domain.state === 'VERIFIED'
                              ? messages.recordsResultConfirmed
                              : messages.recordsResultUnconfirmed}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              {/* 🔴 DKIM は `domain.provision` 完了後に現れる（MAIL FROM の MX/TXT はドメイン名から
                  即時に決まるため先に出る）。REGISTERED のまま留まる利用者への補足。 */}
              {domain.dkimRecords.length === 0 ? (
                <p className="mt-2 text-xs text-slate-500" data-testid="sending-domain-dkim-pending">
                  {messages.recordsDkimPending}
                </p>
              ) : null}
            </>
          )}

          <div className="mt-4 flex flex-wrap items-center gap-3">
            <Button
              type="button"
              onClick={() => void onVerify()}
              disabled={verifyPhase === 'submitting'}
              data-testid="sending-domain-verify-submit"
            >
              {verifyPhase === 'submitting' ? messages.verifySubmitting : messages.verifySubmit}
            </Button>
            {verifyPhase === 'error' ? (
              <span role="alert" className="text-sm text-red-700" data-testid="sending-domain-verify-error">
                {messages.verifyError}
              </span>
            ) : null}
          </div>

          {verifyRequested ? (
            <p role="status" className="mt-2 text-sm text-slate-600" data-testid="sending-domain-verify-requested">
              {messages.verifyRequested}
            </p>
          ) : null}

          {domain.state === 'REGISTERED' || domain.state === 'PENDING' ? (
            <div
              className="mt-2 rounded-md border border-dashed border-slate-300 p-3 text-sm text-slate-600"
              data-testid="sending-domain-verify-pending"
            >
              <p>{messages.verifyPending}</p>
              <p className="text-xs text-slate-400">{messages.verifyPendingNote}</p>
            </div>
          ) : null}
        </section>
      ) : null}

      <section data-testid="sending-domain-affects">
        <h2 className="mb-2 text-sm font-semibold text-slate-700">{messages.sectionAffects}</h2>
        <ul className="mb-2 divide-y divide-slate-100 rounded-md border border-slate-200">
          {messages.affectedFeatures.map((label) => (
            <li key={label} className="px-3 py-2 text-sm text-slate-700">
              {label}
            </li>
          ))}
        </ul>
        {domain === null || domain.state !== 'VERIFIED' ? (
          <p className="mb-4 text-sm font-medium text-slate-900">{messages.affectsBlocked}</p>
        ) : null}
        <p className="mb-1 text-xs text-slate-500">
          {messages.exclusionMemberInvite}
          <br />
          <span className="text-slate-400">{messages.exclusionMemberInviteNote}</span>
        </p>
        <p className="text-xs text-slate-500">{messages.exclusionEsign}</p>
      </section>
    </div>
  );
}
