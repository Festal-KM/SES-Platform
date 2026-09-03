'use client';

// apps/web/app/(main)/audit-logs/audit-logs-view.tsx
// `S-041` の本体（docs/04 §S-041。T3 = デスクトップ主体、モバイルは列を間引く）。
//
// 🔴 期間未指定では検索を実行しない（「期間を指定してください」。docs/04 §S-041）。
// 🔴 検索中はボタンを検索中表示に置換する（二重送信防止。CLAUDE.md §13.3 の規律と同じ）。
// 🔴 「さらに読み込む」はカーソルページング（`GET /api/audit-logs` の `nextCursor`）であり、
//    `total`（残件数）は返らない（docs/05 §4.8「他にも N 件あります」に相当する情報を出さない）。
// 🔴 文言は props（`packages/i18n`）から受け取る。ここにベタ書きしない（CLAUDE.md §3.5）。
import { useCallback, useState, type FormEvent } from 'react';
import { AUDIT_LOG_CATEGORY_KEYS, type AuditLogCategoryKey } from '../../../lib/audit-logs/categories';

export type AuditLogsViewMessages = {
  readonly fromLabel: string;
  readonly toLabel: string;
  readonly categoryLabel: string;
  readonly categoryAll: string;
  readonly categoryNames: Readonly<Record<AuditLogCategoryKey, string>>;
  readonly actorIdLabel: string;
  readonly search: string;
  readonly searching: string;
  readonly loadMore: string;
  readonly loadingMore: string;
  readonly periodRequired: string;
  readonly searchFailed: string;
  readonly emptyBeforeSearch: string;
  readonly emptyNoMatch: string;
  readonly columnDate: string;
  readonly columnActor: string;
  readonly columnAction: string;
  readonly columnTarget: string;
  readonly columnMeta: string;
  readonly actorSystem: string;
  readonly actorPlatform: string;
};

type AuditLogItem = {
  readonly id: string;
  readonly createdAt: string;
  readonly actorKind: 'USER' | 'PLATFORM_USER' | 'SYSTEM';
  readonly actorId: string | null;
  readonly actorDisplayName: string | null;
  readonly action: string;
  readonly targetType: string | null;
  readonly targetId: string | null;
  readonly ipAddress: string | null;
  readonly deviceKind: string | null;
};

type AuditLogPage = {
  readonly items: readonly AuditLogItem[];
  readonly nextCursor: string | null;
};

type Phase = 'idle' | 'loading' | 'loadingMore' | 'error';

/** 🔴 UTC の日境界を使う（本画面に JST 丸めの明示要求は無い。docs/03 §9 未確定領域外）。 */
function toRangeStartIso(date: string): string {
  return `${date}T00:00:00.000Z`;
}
function toRangeEndIso(date: string): string {
  return `${date}T23:59:59.999Z`;
}

function formatDateTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  const pad = (value: number): string => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(
    date.getHours(),
  )}:${pad(date.getMinutes())}`;
}

function actorLabel(item: AuditLogItem, messages: AuditLogsViewMessages): string {
  if (item.actorKind === 'SYSTEM') return messages.actorSystem;
  if (item.actorKind === 'PLATFORM_USER') return messages.actorPlatform;
  return item.actorDisplayName ?? item.actorId ?? '—';
}

export function AuditLogsView({ messages }: { messages: AuditLogsViewMessages }) {
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [category, setCategory] = useState<AuditLogCategoryKey | ''>('');
  const [actorId, setActorId] = useState('');
  const [periodError, setPeriodError] = useState(false);
  const [phase, setPhase] = useState<Phase>('idle');
  const [results, setResults] = useState<AuditLogPage | null>(null);

  const runSearch = useCallback(
    async (cursor: string | null): Promise<void> => {
      if (from === '' || to === '') {
        setPeriodError(true);
        return;
      }
      setPeriodError(false);
      setPhase(cursor === null ? 'loading' : 'loadingMore');

      const params = new URLSearchParams({ from: toRangeStartIso(from), to: toRangeEndIso(to) });
      if (category !== '') params.set('action', category);
      if (actorId.trim() !== '') params.set('actorId', actorId.trim());
      if (cursor !== null) params.set('cursor', cursor);

      try {
        const response = await fetch(`/api/audit-logs?${params.toString()}`, {
          headers: { accept: 'application/json' },
        });
        if (!response.ok) {
          setPhase('error');
          return;
        }
        const body = (await response.json()) as AuditLogPage;
        setResults((prev) => ({
          items: cursor === null || prev === null ? body.items : [...prev.items, ...body.items],
          nextCursor: body.nextCursor,
        }));
        setPhase('idle');
      } catch {
        setPhase('error');
      }
    },
    [from, to, category, actorId],
  );

  function onSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    void runSearch(null);
  }

  const searching = phase === 'loading';
  const loadingMore = phase === 'loadingMore';

  return (
    <>
      <form className="ses-filter-form" onSubmit={onSubmit} noValidate>
        <label className="ses-field">
          <span>{messages.fromLabel}</span>
          <input
            type="date"
            value={from}
            required
            disabled={searching}
            onChange={(event) => setFrom(event.target.value)}
          />
        </label>
        <label className="ses-field">
          <span>{messages.toLabel}</span>
          <input
            type="date"
            value={to}
            required
            disabled={searching}
            onChange={(event) => setTo(event.target.value)}
          />
        </label>
        <label className="ses-field">
          <span>{messages.categoryLabel}</span>
          <select
            value={category}
            disabled={searching}
            onChange={(event) => setCategory(event.target.value as AuditLogCategoryKey | '')}
          >
            <option value="">{messages.categoryAll}</option>
            {AUDIT_LOG_CATEGORY_KEYS.map((key) => (
              <option key={key} value={key}>
                {messages.categoryNames[key]}
              </option>
            ))}
          </select>
        </label>
        <label className="ses-field">
          <span>{messages.actorIdLabel}</span>
          <input
            type="text"
            value={actorId}
            disabled={searching}
            onChange={(event) => setActorId(event.target.value)}
          />
        </label>
        <button className="ses-submit" type="submit" disabled={searching}>
          {searching ? messages.searching : messages.search}
        </button>
      </form>

      {periodError ? (
        <p className="ses-error" role="alert">
          {messages.periodRequired}
        </p>
      ) : null}
      {phase === 'error' ? (
        <p className="ses-error" role="alert">
          {messages.searchFailed}
        </p>
      ) : null}

      {searching ? (
        <div className="ses-skeleton" aria-busy="true" aria-live="polite">
          <p className="ses-skeleton-line" />
          <p className="ses-skeleton-line" />
          <p className="ses-skeleton-line" />
        </div>
      ) : results === null ? (
        <p className="ses-empty">{messages.emptyBeforeSearch}</p>
      ) : results.items.length === 0 ? (
        <p className="ses-empty">{messages.emptyNoMatch}</p>
      ) : (
        <div className="ses-table-wrap">
          <table className="ses-table">
            <thead>
              <tr>
                <th>{messages.columnDate}</th>
                <th>{messages.columnActor}</th>
                <th>{messages.columnAction}</th>
                <th className="ses-col-target">{messages.columnTarget}</th>
                <th className="ses-col-meta">{messages.columnMeta}</th>
              </tr>
            </thead>
            <tbody>
              {results.items.map((item) => (
                <tr key={item.id}>
                  <td>{formatDateTime(item.createdAt)}</td>
                  <td>{actorLabel(item, messages)}</td>
                  <td>{item.action}</td>
                  <td className="ses-col-target">{item.targetType ?? '—'}</td>
                  <td className="ses-col-meta">
                    {[item.deviceKind, item.ipAddress].filter(Boolean).join(' / ') || '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {results.nextCursor === null ? null : (
            <button
              className="ses-secondary-link"
              type="button"
              disabled={loadingMore}
              onClick={() => void runSearch(results.nextCursor)}
            >
              {loadingMore ? messages.loadingMore : messages.loadMore}
            </button>
          )}
        </div>
      )}
    </>
  );
}
