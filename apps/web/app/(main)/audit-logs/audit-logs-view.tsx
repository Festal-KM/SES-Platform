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
//
// 🔴 T-11-09: 行を開くと直下に詳細（`AuditLogDetail`）をインラインで展開する（docs/04 §S-041「行の詳細」）。
//    **詳細は一覧の応答（`detail` / `detailSuppressedReason`）に同梱されており、展開時の追加取得は無い**
//    （展開ごとに監査ログの閲覧が記録される経路を作らない）。複数行を同時に開ける（「要求 → 確定」の 2 行を
//    並べて読む）。検索し直すと全行が閉じ、「さらに読み込む」では開いた行を保つ。**既存 5 列は変えない。**
// 🔴 T-12-18 ⑪: セクション 4 エクスポート（docs/04 §S-041 / docs/05 §6.3 #10b）。検索を実行した後に、**その検索条件をそのまま**
//    `GET /api/audit-logs/export` へ渡す。ページングは渡さない（エクスポート側が #10 を追う）。
//    本画面は `OWNER` / `ADMIN` だけが到達する（`page.tsx`）ので、導線の出し分けはここでは行わない。
// 🔴 レビュー指摘 NG-1（2026-09-21）: `<a href download>` の素のナビゲーションだと、400（上限超過）のとき
//    ブラウザが JSON のエラー本文をファイルとして落としてしまい、文言が利用者に届かない。`onClick` で
//    `preventDefault()` し `fetch` → `blob()` → 一時 `<a>` でダウンロードに切り替える（`href` 属性は
//    そのまま残す。`docs/05` §6.4 ⑥「`<a href>` の GET」の形は変えない = JS 無効時の直リンクを壊さない）。
//    エクスポート節（`AuditLogsExportSection`）は状態を持たない純粋な描画部品として切り出した
//    —— `renderToStaticMarkup` は検索後の状態へ進められない（`useEffect` 同様、クリックの結果も再描画できない）ため、
//    `*.render.test.tsx` は本部品を状態ごとに直接描いて固定する（`AdminAuditLogsResults` と同じ分離）。
import { useCallback, useState, type FormEvent, type MouseEvent } from 'react';
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
import type { AuditLogDetailMessages } from '../../../lib/audit-logs/detail-labels';
import {
  auditLogCsvFileName,
  auditLogExportHref,
  classifyAuditLogExportError,
  type AuditLogExportCondition,
  type AuditLogExportErrorReason,
} from '../../../lib/audit-logs/export-href';
import type { AuditLogListItem } from '../../../lib/audit-logs/view';
import { AuditLogDetail } from './audit-log-detail';

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
  readonly columnDetail: string;
  readonly actorSystem: string;
  readonly actorPlatform: string;
  readonly detail: AuditLogDetailMessages;
  /** T-12-18 ⑪: セクション 4 エクスポート。 */
  readonly exportButton: string;
  readonly exportNote: string;
  /** 🔴 レビュー指摘 NG-1: 上限の予告（`page.tsx` が `AUDIT_LOG_EXPORT_MAX_ROWS` を差し込み済みの文字列）。 */
  readonly exportNoteLimit: string;
  /** 🔴 レビュー指摘 NG-1: 上限超過（400 `AUDIT_LOG_EXPORT_TOO_LARGE`）の表示。 */
  readonly exportTooLarge: string;
  /** 🔴 レビュー指摘 NG-1: 上限超過以外のエクスポート失敗（ネットワークエラー等）の表示。 */
  readonly exportFailed: string;
};

/** 応答の 1 行（`GET /api/audit-logs` の `AuditLogListItem`）。 */
type AuditLogItem = AuditLogListItem;

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

export type AuditLogsExportSectionMessages = Pick<
  AuditLogsViewMessages,
  'exportButton' | 'exportNote' | 'exportNoteLimit' | 'exportTooLarge' | 'exportFailed'
>;

export type AuditLogsExportSectionProps = {
  readonly href: string;
  readonly exporting: boolean;
  readonly error: AuditLogExportErrorReason | null;
  readonly messages: AuditLogsExportSectionMessages;
  readonly onExport: (event: MouseEvent<HTMLAnchorElement>) => void;
};

/**
 * `S-041` セクション 4（エクスポート）の**状態を持たない**描画部品（NG-1 / NG-2）。
 * 🔴 `href` 属性は常に本物の `#10b` の URL のまま（`onClick` が横取りするので JS 有効時は素のナビゲーションが
 *    走らないが、右クリック・コピー・JS 無効時のフォールバックとして機能する）。
 */
export function AuditLogsExportSection({ href, exporting, error, messages, onExport }: AuditLogsExportSectionProps) {
  return (
    <section className="mt-6 border-t border-slate-200 pt-4" data-testid="audit-logs-export">
      <p className="mb-1 text-xs text-slate-600">{messages.exportNote}</p>
      <p className="mb-2 text-xs text-slate-500">{messages.exportNoteLimit}</p>
      <a
        className="inline-flex items-center rounded border border-slate-300 px-3 py-1.5 text-sm text-slate-900 underline-offset-2 hover:underline aria-disabled:pointer-events-none aria-disabled:opacity-50"
        href={href}
        download
        aria-disabled={exporting}
        data-testid="audit-logs-export-link"
        onClick={onExport}
      >
        {messages.exportButton}
      </a>
      {error === null ? null : (
        <FieldError className="mt-2" data-testid="audit-logs-export-error">
          {error === 'TOO_LARGE' ? messages.exportTooLarge : messages.exportFailed}
        </FieldError>
      )}
    </section>
  );
}

export function AuditLogsView({ messages }: { messages: AuditLogsViewMessages }) {
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [category, setCategory] = useState<AuditLogCategoryKey | ''>('');
  const [actorId, setActorId] = useState('');
  const [periodError, setPeriodError] = useState(false);
  const [phase, setPhase] = useState<Phase>('idle');
  const [results, setResults] = useState<AuditLogPage | null>(null);
  const [expandedIds, setExpandedIds] = useState<ReadonlySet<string>>(() => new Set());
  // 🔴 エクスポートの範囲は「最後に実行した検索の条件」（入力欄を書き換えただけでは変わらない = 一覧と同じ範囲）。
  const [exportCondition, setExportCondition] = useState<AuditLogExportCondition | null>(null);
  const [exportError, setExportError] = useState<AuditLogExportErrorReason | null>(null);
  const [exporting, setExporting] = useState(false);

  function toggleExpanded(id: string): void {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const runSearch = useCallback(
    async (cursor: string | null): Promise<void> => {
      if (from === '' || to === '') {
        setPeriodError(true);
        return;
      }
      setPeriodError(false);
      setPhase(cursor === null ? 'loading' : 'loadingMore');

      const condition = {
        from: toRangeStartIso(from),
        to: toRangeEndIso(to),
        action: category === '' ? undefined : category,
        actorId: actorId.trim() === '' ? undefined : actorId.trim(),
      };
      const params = new URLSearchParams({ from: condition.from, to: condition.to });
      if (condition.action !== undefined) params.set('action', condition.action);
      if (condition.actorId !== undefined) params.set('actorId', condition.actorId);
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
        if (cursor === null) {
          setExpandedIds(new Set());
          setExportCondition(condition);
          setExportError(null);
        }
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

  /**
   * 🔴 レビュー指摘 NG-1: `<a href download>` の素のナビゲーションを横取りし、`fetch` → `blob()` の
   *    ダウンロードに切り替える。400（`AUDIT_LOG_EXPORT_TOO_LARGE`）はエラー文言を出す（`classifyAuditLogExportError`。
   *    応答の `messageKey` は解釈しない）。ファイル名は `#10b` の route と同じ `auditLogCsvFileName` を使う。
   */
  async function onExport(event: MouseEvent<HTMLAnchorElement>): Promise<void> {
    event.preventDefault();
    if (exportCondition === null || exporting) return;
    setExporting(true);
    setExportError(null);
    try {
      const response = await fetch(auditLogExportHref(exportCondition));
      if (!response.ok) {
        setExportError(await classifyAuditLogExportError(response));
        return;
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = auditLogCsvFileName(exportCondition);
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    } catch {
      setExportError('FAILED');
    } finally {
      setExporting(false);
    }
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
          <Table data-testid="audit-logs-table">
            <TableHeader>
              <TableRow>
                <TableHead>
                  <span className="sr-only">{messages.columnDetail}</span>
                </TableHead>
                <TableHead>{messages.columnDate}</TableHead>
                <TableHead>{messages.columnActor}</TableHead>
                <TableHead>{messages.columnAction}</TableHead>
                <TableHead className={TABLET_UP}>{messages.columnTarget}</TableHead>
                <TableHead className={TABLET_UP}>{messages.columnMeta}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {results.items.map((item) => {
                const expanded = expandedIds.has(item.id);
                return [
                  <TableRow
                    key={item.id}
                    data-testid={`audit-logs-row-${item.id}`}
                    data-state={expanded ? 'selected' : undefined}
                    className="cursor-pointer"
                    onClick={() => toggleExpanded(item.id)}
                  >
                    <TableCell padding="compact">
                      <button
                        type="button"
                        data-testid={`audit-logs-row-toggle-${item.id}`}
                        aria-expanded={expanded}
                        aria-controls={`audit-logs-detail-${item.id}`}
                        aria-label={expanded ? messages.detail.toggleClose : messages.detail.toggleOpen}
                        className="inline-flex h-6 w-6 items-center justify-center rounded-sm text-slate-500 hover:bg-slate-100"
                        onClick={(event) => {
                          event.stopPropagation();
                          toggleExpanded(item.id);
                        }}
                      >
                        <span aria-hidden="true">{expanded ? '▾' : '▸'}</span>
                      </button>
                    </TableCell>
                    <TableCell>{formatDateTime(item.createdAt)}</TableCell>
                    <TableCell>{actorLabel(item, messages)}</TableCell>
                    <TableCell>{item.action}</TableCell>
                    <TableCell className={TABLET_UP}>{item.targetType ?? '—'}</TableCell>
                    <TableCell className={TABLET_UP}>
                      {[item.deviceKind, item.ipAddress].filter(Boolean).join(' / ') || '—'}
                    </TableCell>
                  </TableRow>,
                  expanded ? (
                    <TableRow key={`${item.id}-detail`} className="bg-slate-50 hover:bg-slate-50">
                      <TableCell
                        id={`audit-logs-detail-${item.id}`}
                        data-testid={`audit-logs-row-detail-${item.id}`}
                        colSpan={6}
                        whitespace="normal"
                        className="pl-8"
                      >
                        <AuditLogDetail item={item} messages={messages.detail} />
                      </TableCell>
                    </TableRow>
                  ) : null,
                ];
              })}
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
          {exportCondition === null ? null : (
            <AuditLogsExportSection
              href={auditLogExportHref(exportCondition)}
              exporting={exporting}
              error={exportError}
              messages={messages}
              onExport={onExport}
            />
          )}
        </div>
      )}
    </>
  );
}
