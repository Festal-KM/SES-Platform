'use client';

// apps/web/app/admin/audit-logs/admin-audit-logs-view.tsx
// `A-006` 監査ログ横断検索 — 本体（docs/04 §A-006 / API-A7 / `F-058`。T3 = デスクトップ主体）。T-11-03。
//
// 🔴 期間は必須で、**既定で直近 7 日を埋めて開く**（`initialPeriod`。空で送れない。docs/03 申し送り 9）。
//    期間未指定・逆転・上限超過は**送信前に**同じ判定（`validateAuditLogPeriod`。サーバと 1 実装）で止め、
//    API を呼ばない。サーバ側でも同じ判定が 400 を返す（画面の検査は UX であって境界ではない）。
// 🔴 3 秒を超えたら「検索しています」+ 期間短縮の提案に表示を切り替える（docs/04 §A-006 非同期処理の表現）。
// 🔴 エラーは「検索を実行できませんでした」+ 期間短縮の提案（docs/04 §A-006 エラー欄）。
//    上限超過（`AUDIT_LOG_PERIOD_TOO_LONG`）だけは理由を分けて出す（次の行動が明確なため）。
// 🔴 「さらに読み込む」はカーソルページング（`nextCursor`）。総件数は返らない（一覧 API の一般規約）。
// 🔴 文言は props（`packages/i18n`）から受け取る。ここにベタ書きしない（CLAUDE.md §3.5）。
// 🔴 `@ses/db` を値 import しない（`tests/static/client-db-boundary.test.ts`）。列挙値の選択肢は
//    サーバ（`page.tsx`）が組み立てて props で渡す。
import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import type { PlatformAuditLogView } from '@ses/db/platform';
import { Button, Field, FieldDescription, FieldError, Input, Select } from '@ses/ui';
import {
  toRangeEndIso,
  toRangeStartIso,
  validateAuditLogPeriod,
} from '../../../lib/admin-audit-logs/period';
import {
  AdminAuditLogsResults,
  type AdminAuditLogsResultsMessages,
  type AdminAuditLogsResultsState,
} from './admin-audit-logs-results';

/** 検索条件の帯。モバイルでも条件を省略しない（1 カラムに積むだけ。`CLAUDE.md` §13.3）。 */
const FILTER_FORM_CLASSES =
  'mb-6 grid grid-cols-1 items-end gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4';
const FILTER_ACTIONS_CLASSES =
  'flex flex-wrap items-center gap-4 sm:col-span-2 lg:col-span-3 xl:col-span-4';

/** 「検索しています」に切り替えるまでの時間（docs/04 §A-006「3 秒を超えたら」）。 */
const SLOW_THRESHOLD_MS = 3_000;

export type AdminAuditLogsSelectOption = { readonly value: string; readonly label: string };

export type AdminAuditLogsViewMessages = AdminAuditLogsResultsMessages & {
  readonly sectionFilters: string;
  readonly sectionResults: string;
  readonly sectionRecord: string;
  readonly fromLabel: string;
  readonly toLabel: string;
  readonly targetTenantIdLabel: string;
  readonly actionLabel: string;
  readonly actorTypeLabel: string;
  readonly actorTypeAll: string;
  readonly deviceKindLabel: string;
  readonly deviceKindAll: string;
  readonly periodNote: string;
  readonly search: string;
  readonly periodRequired: string;
  readonly periodInverted: string;
  readonly periodTooLong: string;
  readonly recordNote: string;
  readonly noReachNote: string;
};

export type AdminAuditLogsViewProps = {
  readonly messages: AdminAuditLogsViewMessages;
  /** 既定の期間（直近 7 日）。`YYYY-MM-DD`。 */
  readonly initialPeriod: { readonly from: string; readonly to: string };
  /** `A-003` から来たときの対象テナント（形は `page.tsx` が検証済み）。 */
  readonly initialTargetTenantId: string | null;
  /** 🔴 `AUDIT_LOG_SEARCH_MAX_PERIOD_DAYS`（`packages/config`）。ここにベタ書きしない。 */
  readonly maxPeriodDays: number;
  /** 🔴 `ADMIN_MONITORING_PAGE_SIZE`（`packages/config`）。 */
  readonly pageSize: number;
  readonly actorTypeOptions: readonly AdminAuditLogsSelectOption[];
  readonly deviceKindOptions: readonly AdminAuditLogsSelectOption[];
};

type SearchPage = {
  readonly items: readonly PlatformAuditLogView[];
  readonly nextCursor: string | null;
};

type PeriodIssue = 'REQUIRED' | 'INVERTED' | 'TOO_LONG' | null;

type ErrorBody = { readonly error?: { readonly code?: string } };

export function AdminAuditLogsView({
  messages,
  initialPeriod,
  initialTargetTenantId,
  maxPeriodDays,
  pageSize,
  actorTypeOptions,
  deviceKindOptions,
}: AdminAuditLogsViewProps) {
  const [from, setFrom] = useState(initialPeriod.from);
  const [to, setTo] = useState(initialPeriod.to);
  const [targetTenantId, setTargetTenantId] = useState(initialTargetTenantId ?? '');
  const [action, setAction] = useState('');
  const [actorType, setActorType] = useState('');
  const [deviceKind, setDeviceKind] = useState('');
  const [periodIssue, setPeriodIssue] = useState<PeriodIssue>(null);
  const [state, setState] = useState<AdminAuditLogsResultsState>({ kind: 'idle' });
  const slowTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearSlowTimer = useCallback(() => {
    if (slowTimer.current !== null) {
      clearTimeout(slowTimer.current);
      slowTimer.current = null;
    }
  }, []);

  useEffect(() => clearSlowTimer, [clearSlowTimer]);

  const buildParams = useCallback(
    (cursor: string | null): URLSearchParams | PeriodIssue => {
      if (from === '' || to === '') return 'REQUIRED';
      const range = { from: toRangeStartIso(from), to: toRangeEndIso(to) };
      const verdict = validateAuditLogPeriod(range, maxPeriodDays);
      if (verdict !== 'OK') return verdict;
      const params = new URLSearchParams({ from: range.from, to: range.to, limit: String(pageSize) });
      if (targetTenantId.trim() !== '') params.set('targetTenantId', targetTenantId.trim());
      if (action.trim() !== '') params.set('action', action.trim());
      if (actorType !== '') params.set('actorType', actorType);
      if (deviceKind !== '') params.set('deviceKind', deviceKind);
      if (cursor !== null) params.set('cursor', cursor);
      return params;
    },
    [from, to, targetTenantId, action, actorType, deviceKind, maxPeriodDays, pageSize],
  );

  const runSearch = useCallback(
    async (cursor: string | null): Promise<void> => {
      const built = buildParams(cursor);
      if (!(built instanceof URLSearchParams)) {
        setPeriodIssue(built);
        return;
      }
      setPeriodIssue(null);

      if (cursor === null) {
        setState({ kind: 'searching', slow: false });
        clearSlowTimer();
        slowTimer.current = setTimeout(() => {
          setState((prev) => (prev.kind === 'searching' ? { kind: 'searching', slow: true } : prev));
        }, SLOW_THRESHOLD_MS);
      } else {
        setState((prev) => (prev.kind === 'results' ? { ...prev, loadingMore: true } : prev));
      }

      try {
        const response = await fetch(`/api/admin/audit-logs?${built.toString()}`, {
          headers: { accept: 'application/json' },
        });
        clearSlowTimer();
        if (!response.ok) {
          const body = (await response.json().catch(() => null)) as ErrorBody | null;
          setState({
            kind: 'error',
            reason: body?.error?.code === 'AUDIT_LOG_PERIOD_TOO_LONG' ? 'PERIOD_TOO_LONG' : 'FAILED',
          });
          return;
        }
        const page = (await response.json()) as SearchPage;
        setState((prev) => ({
          kind: 'results',
          items:
            cursor === null || prev.kind !== 'results' ? page.items : [...prev.items, ...page.items],
          nextCursor: page.nextCursor,
          loadingMore: false,
        }));
      } catch {
        clearSlowTimer();
        setState({ kind: 'error', reason: 'FAILED' });
      }
    },
    [buildParams, clearSlowTimer],
  );

  function onSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    void runSearch(null);
  }

  const searching = state.kind === 'searching';
  const periodMessage =
    periodIssue === 'REQUIRED'
      ? messages.periodRequired
      : periodIssue === 'INVERTED'
        ? messages.periodInverted
        : periodIssue === 'TOO_LONG'
          ? messages.periodTooLong
          : null;

  return (
    <>
      <section className="mb-6" data-testid="admin-audit-logs-filters">
        <h2 className="mb-2 text-sm font-semibold text-slate-700">{messages.sectionFilters}</h2>
        <form className={FILTER_FORM_CLASSES} onSubmit={onSubmit} noValidate>
          <Field label={messages.fromLabel}>
            <Input
              type="date"
              value={from}
              required
              disabled={searching}
              data-testid="admin-audit-logs-from"
              onChange={(event) => setFrom(event.target.value)}
            />
          </Field>
          <Field label={messages.toLabel}>
            <Input
              type="date"
              value={to}
              required
              disabled={searching}
              data-testid="admin-audit-logs-to"
              onChange={(event) => setTo(event.target.value)}
            />
          </Field>
          <Field label={messages.targetTenantIdLabel}>
            <Input
              type="text"
              value={targetTenantId}
              disabled={searching}
              data-testid="admin-audit-logs-target-tenant-id"
              onChange={(event) => setTargetTenantId(event.target.value)}
            />
          </Field>
          <Field label={messages.actionLabel}>
            <Input
              type="text"
              value={action}
              disabled={searching}
              data-testid="admin-audit-logs-action"
              onChange={(event) => setAction(event.target.value)}
            />
          </Field>
          <Field label={messages.actorTypeLabel}>
            <Select
              value={actorType}
              disabled={searching}
              data-testid="admin-audit-logs-actor-type"
              onChange={(event) => setActorType(event.target.value)}
            >
              <option value="">{messages.actorTypeAll}</option>
              {actorTypeOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={messages.deviceKindLabel}>
            <Select
              value={deviceKind}
              disabled={searching}
              data-testid="admin-audit-logs-device-kind"
              onChange={(event) => setDeviceKind(event.target.value)}
            >
              <option value="">{messages.deviceKindAll}</option>
              {deviceKindOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </Select>
          </Field>
          <div className={FILTER_ACTIONS_CLASSES}>
            <Button type="submit" disabled={searching} data-testid="admin-audit-logs-search">
              {searching ? messages.searching : messages.search}
            </Button>
            <FieldDescription>{messages.periodNote}</FieldDescription>
          </div>
        </form>
        {periodMessage === null ? null : (
          <FieldError className="mb-4" data-testid="admin-audit-logs-period-error">
            {periodMessage}
          </FieldError>
        )}
      </section>

      <section className="mb-6" data-testid="admin-audit-logs-results">
        <h2 className="mb-2 text-sm font-semibold text-slate-700">{messages.sectionResults}</h2>
        <AdminAuditLogsResults
          state={state}
          messages={messages}
          onLoadMore={(cursor) => void runSearch(cursor)}
        />
      </section>

      {/* 🔴 セクション 3「検索の実行記録」（docs/04 §A-006）と、内容へ到達できないことの明示（F-058 AC-2）。 */}
      <section data-testid="admin-audit-logs-record">
        <h2 className="mb-2 text-sm font-semibold text-slate-700">{messages.sectionRecord}</h2>
        <p className="text-sm text-slate-600">{messages.recordNote}</p>
        <p className="mt-1 text-sm text-slate-600" data-testid="admin-audit-logs-no-reach-note">
          {messages.noReachNote}
        </p>
      </section>
    </>
  );
}
