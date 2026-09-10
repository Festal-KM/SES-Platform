'use client';

// apps/web/app/(main)/audit-logs/audit-logs-view.tsx
// `S-041` の本体（docs/04 §S-041。T3 = デスクトップ主体、モバイルは列を間引く）。
//
// 🔴 期間未指定では検索を実行しない（「期間を指定してください」。docs/04 §S-041）。
// 🔴 検索中はボタンを検索中表示に置換する（二重送信防止。CLAUDE.md §13.3 の規律と同じ）。
// 🔴 「さらに読み込む」はカーソルページング（`GET /api/audit-logs` の `nextCursor`）であり、
//    `total`（残件数）は返らない（docs/05 §4.8「他にも N 件あります」に相当する情報を出さない）。
// 🔴 文言は props（`packages/i18n`）から受け取る。ここにベタ書きしない（CLAUDE.md §3.5）。
//
// 🔴 T-21-04: 手書き CSS（`.ses-filter-form` / `.ses-table` / `.ses-col-*` / `.ses-empty` ほか）を
//    `@ses/ui` と Tailwind へ移した。**列の間引きの境界は変えていない** ——
//    旧 `@media (max-width: 640px) { display: none }` と `hidden sm:table-cell` は
//    どちらも Tailwind の既定 `sm`（640px）を境にする（`CLAUDE.md` §13.3。独自定義しない）。
import { useCallback, useState, type FormEvent } from 'react';
import {
  Button,
  Field,
  FieldError,
  Input,
  SECONDARY_LINK_STACKED_CLASSES,
  Select,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@ses/ui';
import {
  FILTER_ACTIONS_CLASSES,
  FILTER_FORM_CLASSES,
} from '../_shared/filter-form-classes';
import { AUDIT_LOG_CATEGORY_KEYS, type AuditLogCategoryKey } from '../../../lib/audit-logs/categories';

/**
 * 🔴 モバイルは「日時 + 主体 + 操作」の 3 要素に劣化する（`docs/04` §S-041）。
 *    **機能の省略ではなく列の間引き**であり、`CLAUDE.md` §13.3 の「遮断しない」を満たす。
 */
const TABLET_UP = 'hidden sm:table-cell';
/** 検索前・0 件の空状態（旧 `.ses-empty`）。 */
const EMPTY_CLASSES = 'py-8 text-center text-slate-500';
/** 読み込み中の骨格 1 行（旧 `.ses-skeleton-line`）。 */
const SKELETON_LINE_CLASSES = 'mb-3 h-4 rounded-sm bg-slate-200';

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
      <form className={FILTER_FORM_CLASSES} onSubmit={onSubmit} noValidate>
        <Field label={messages.fromLabel}>
          <Input
            type="date"
            value={from}
            required
            disabled={searching}
            onChange={(event) => setFrom(event.target.value)}
          />
        </Field>
        <Field label={messages.toLabel}>
          <Input
            type="date"
            value={to}
            required
            disabled={searching}
            onChange={(event) => setTo(event.target.value)}
          />
        </Field>
        <Field label={messages.categoryLabel}>
          <Select
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
          </Select>
        </Field>
        <Field label={messages.actorIdLabel}>
          <Input
            type="text"
            value={actorId}
            disabled={searching}
            onChange={(event) => setActorId(event.target.value)}
          />
        </Field>
        <div className={FILTER_ACTIONS_CLASSES}>
          <Button type="submit" disabled={searching}>
            {searching ? messages.searching : messages.search}
          </Button>
        </div>
      </form>

      {periodError ? <FieldError className="mb-4">{messages.periodRequired}</FieldError> : null}
      {phase === 'error' ? <FieldError className="mb-4">{messages.searchFailed}</FieldError> : null}

      {searching ? (
        <div aria-busy="true" aria-live="polite">
          <p className={SKELETON_LINE_CLASSES} />
          <p className={SKELETON_LINE_CLASSES} />
          <p className={SKELETON_LINE_CLASSES} />
        </div>
      ) : results === null ? (
        <p className={EMPTY_CLASSES}>{messages.emptyBeforeSearch}</p>
      ) : results.items.length === 0 ? (
        <p className={EMPTY_CLASSES}>{messages.emptyNoMatch}</p>
      ) : (
        <div>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{messages.columnDate}</TableHead>
                <TableHead>{messages.columnActor}</TableHead>
                <TableHead>{messages.columnAction}</TableHead>
                <TableHead className={TABLET_UP}>{messages.columnTarget}</TableHead>
                <TableHead className={TABLET_UP}>{messages.columnMeta}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {results.items.map((item) => (
                <TableRow key={item.id}>
                  <TableCell>{formatDateTime(item.createdAt)}</TableCell>
                  <TableCell>{actorLabel(item, messages)}</TableCell>
                  <TableCell>{item.action}</TableCell>
                  <TableCell className={TABLET_UP}>{item.targetType ?? '—'}</TableCell>
                  <TableCell className={TABLET_UP}>
                    {[item.deviceKind, item.ipAddress].filter(Boolean).join(' / ') || '—'}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          {results.nextCursor === null ? null : (
            <button
              className={SECONDARY_LINK_STACKED_CLASSES}
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
