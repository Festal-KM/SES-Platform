'use client';

// apps/web/app/admin/usage/quota-override-form.tsx
// `A-004` のクォータ上書きフォーム（docs/04 §A-004 セクション 3 / API-A6 `PUT /api/admin/tenants/{id}/quota` / `F-057 AC-2`〜`AC-4`）。T-11-02。
//
// 🔴 **`PLATFORM_OWNER` にだけ描かれる**（`admin-usage-view.tsx` が `canEditQuota` で分岐する。`PLATFORM_SUPPORT` にはこの部品が
//    存在しない = グレーアウトではなく不在。`F-057 AC-2` / `BR-44`）。API 側も `requirePlatformOwnerCtx` で 403 にする（二重）。
// 🔴 引き下げ（新しい上限 < 現在の上限）のときは、適用日の最小値を**翌日**にし、通知の確認チェックを**必須**にする（`F-057 AC-3`）。
//    画面の制約はあくまで補助であり、最終判定はサーバ（`decideQuotaChange` + RLS の `WITH CHECK`）が行う。**即時に下げる導線は無い。**
// 🔴 文言は props（`packages/i18n`）。ここにベタ書きしない。`@ses/db` を import しない（`tests/static/client-db-boundary.test.ts`）。
import { useMemo, useState, type FormEvent } from 'react';
import type { QuotaOverrideMetric } from '@ses/domain';
import { Alert, AlertDescription, Button, Checkbox, Field, FieldDescription, FieldError, Input, Select, Textarea } from '@ses/ui';
import type { AdminUsageTenantRow } from '../../../lib/admin-usage/view';

export type QuotaOverrideFormMessages = {
  readonly title: string;
  readonly lead: string;
  readonly selectTenant: string;
  readonly tenant: string;
  readonly metric: string;
  readonly current: string;
  readonly limit: string;
  readonly limitHint: string;
  readonly effectiveFrom: string;
  readonly lowering: string;
  readonly raising: string;
  readonly notify: string;
  readonly reason: string;
  readonly submit: string;
  readonly submitting: string;
  readonly success: string;
  readonly failed: string;
};

export type QuotaOverrideFormProps = {
  readonly messages: QuotaOverrideFormMessages;
  readonly metricLabels: Readonly<Record<QuotaOverrideMetric, string>>;
  readonly metrics: readonly QuotaOverrideMetric[];
  /** 対象テナントの行（一覧から選んだもの）。未選択なら案内だけを出す。 */
  readonly tenant: AdminUsageTenantRow | null;
  /** 今日（`YYYY-MM-DD`。JST）。適用日の最小値に使う。 */
  readonly today: string;
  /** `PUT` の URL を組み立てる（テストが差し替えられるように props で受ける）。 */
  readonly quotaEndpoint: (tenantId: string) => string;
  /** 保存に成功したら一覧を再取得する。 */
  readonly onSaved: () => void;
};

type Phase = 'input' | 'submitting' | 'saved';

/** `YYYY-MM-DD` を 1 日進める（`<input type="date">` の `min` 用。UTC で計算しても暦日の文字列だけを使うので TZ に依存しない）。 */
function nextDay(dayKey: string): string {
  const at = new Date(`${dayKey}T00:00:00.000Z`);
  at.setUTCDate(at.getUTCDate() + 1);
  return at.toISOString().slice(0, 10);
}

/** 行から現在効いている上限（文字列）を引く。🔴 `QuotaOverrideMetric` は AI の月次件数 4 単位のみ（メール / ストレージは上書きの対象外）。 */
function currentLimitOf(tenant: AdminUsageTenantRow, metric: QuotaOverrideMetric): string {
  return String(tenant.aiUnits[metric].limit);
}

export function QuotaOverrideForm({ messages, metricLabels, metrics, tenant, today, quotaEndpoint, onSaved }: QuotaOverrideFormProps) {
  const [metric, setMetric] = useState<QuotaOverrideMetric>(metrics[0] ?? 'AI_UNIT_SHEET_PARSE');
  const [limit, setLimit] = useState('');
  const [effectiveFrom, setEffectiveFrom] = useState(today);
  const [notify, setNotify] = useState(false);
  const [reason, setReason] = useState('');
  const [phase, setPhase] = useState<Phase>('input');
  const [error, setError] = useState<string | null>(null);

  const current = tenant === null ? null : currentLimitOf(tenant, metric);
  const isLowering = useMemo(() => {
    if (current === null || !/^\d+$/.test(limit)) return false;
    return BigInt(limit) < BigInt(current);
  }, [current, limit]);
  const minEffectiveFrom = isLowering ? nextDay(today) : today;

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (tenant === null) return;
    setPhase('submitting');
    setError(null);
    try {
      const response = await fetch(quotaEndpoint(tenant.tenantId), {
        method: 'PUT',
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ metric, limit, effectiveFrom, notifyTenantAdmins: notify, reason }),
      });
      if (!response.ok) {
        // 🔴 サーバの文言（`error.message`。`packages/i18n` 由来）をそのまま出す。理由（`QUOTA_CHANGE_REJECTED`）ごとに次の行動が書かれている。
        const body = (await response.json().catch(() => null)) as { error?: { message?: string } } | null;
        setError(body?.error?.message ?? messages.failed);
        setPhase('input');
        return;
      }
      setPhase('saved');
      setLimit('');
      setReason('');
      setNotify(false);
      onSaved();
    } catch {
      setError(messages.failed);
      setPhase('input');
    }
  }

  return (
    <section className="mt-8 rounded border border-slate-200 p-4" data-testid="admin-usage-quota-form">
      <h2 className="mb-1 text-base font-bold text-slate-900">{messages.title}</h2>
      <p className="mb-4 text-sm text-slate-600">{messages.lead}</p>
      {tenant === null ? (
        <p className="text-sm text-slate-600" data-testid="admin-usage-quota-form-select-tenant">
          {messages.selectTenant}
        </p>
      ) : (
        <form onSubmit={(event) => void submit(event)} className="flex max-w-xl flex-col gap-4">
          <Field as="div" label={messages.tenant}>
            <p className="text-sm font-medium text-slate-900" data-testid="admin-usage-quota-form-tenant">
              {tenant.name}
            </p>
          </Field>
          <Field label={messages.metric} description={`${messages.current}: ${current ?? ''}`}>
            <Select
              name="metric"
              value={metric}
              onChange={(event) => setMetric(event.target.value as QuotaOverrideMetric)}
              data-testid="admin-usage-quota-form-metric"
            >
              {metrics.map((value) => (
                <option key={value} value={value}>
                  {metricLabels[value]}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={messages.limit} description={messages.limitHint}>
            <Input
              name="limit"
              type="text"
              inputMode="numeric"
              pattern="[0-9]+"
              required
              value={limit}
              onChange={(event) => setLimit(event.target.value)}
              data-testid="admin-usage-quota-form-limit"
            />
          </Field>
          <Field label={messages.effectiveFrom}>
            <Input
              name="effectiveFrom"
              type="date"
              required
              min={minEffectiveFrom}
              value={effectiveFrom}
              onChange={(event) => setEffectiveFrom(event.target.value)}
              data-testid="admin-usage-quota-form-effective-from"
            />
            {/* 🔴 引き下げか引き上げかを入力中に示す（判定の本体はサーバ。ここは案内）。 */}
            {limit !== '' && current !== null ? (
              <FieldDescription data-testid="admin-usage-quota-form-direction" data-lowering={isLowering ? 'true' : 'false'}>
                {isLowering ? messages.lowering : messages.raising}
              </FieldDescription>
            ) : null}
          </Field>
          <div>
            <label className="flex items-start gap-2 text-sm text-slate-800">
              <Checkbox
                name="notifyTenantAdmins"
                checked={notify}
                required={isLowering}
                onChange={(event) => setNotify(event.target.checked)}
                data-testid="admin-usage-quota-form-notify"
              />
              <span>{messages.notify}</span>
            </label>
          </div>
          <Field label={messages.reason}>
            <Textarea
              name="reason"
              required
              maxLength={500}
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              data-testid="admin-usage-quota-form-reason"
            />
          </Field>
          {error === null ? null : (
            <FieldError data-testid="admin-usage-quota-form-error">{error}</FieldError>
          )}
          {phase === 'saved' ? (
            <Alert variant="success" data-testid="admin-usage-quota-form-saved">
              <AlertDescription>{messages.success}</AlertDescription>
            </Alert>
          ) : null}
          <div>
            <Button type="submit" disabled={phase === 'submitting'} data-testid="admin-usage-quota-form-submit">
              {phase === 'submitting' ? messages.submitting : messages.submit}
            </Button>
          </div>
        </form>
      )}
    </section>
  );
}
