// apps/web/app/admin/audit-logs/admin-audit-logs-results.tsx
// `A-006` 監査ログ横断検索 — セクション 2「結果テーブル」の**純粋な描画**（docs/04 §A-006 / `F-058`）。T-11-03。
//
// 🔴 状態を持たない（`'use client'` を宣言しない）。状態（検索中 / 3 秒超 / エラー / 結果）は
//    `AdminAuditLogsView` が決めて `state` として渡す。`*.render.test.tsx` はこの部品を状態ごとに
//    描いて固定する（`docs/04` §A-006 の状態表: 該当なし / エラー + 期間短縮の提案 / 3 秒超で「検索しています」）。
// 🔴 表示するのは日時・テナント・主体（種別 + ID）・操作・対象種別・マスク済みの記録・IP・デバイスだけ
//    （`F-058 AC-1`）。**氏名・本文に相当する列は存在しない。** `summary` は API-A7 が
//    `toPlatformAuditLog` でマスクした固定形であり、ここは値をそのまま出す（`[masked]` を含む）。
// 🔴 行から遷移できるのは `A-003`（テナント詳細）だけである（`F-058 AC-2` / `BR-40`）。
//    `targetId` を表示しても、それを引く導線（リンク・ボタン・API 呼び出し）を置かない。
// 🔴 モバイルは「日時 + テナント + 操作」の 3 要素に間引く（docs/04 §A-006 デバイス別）。
//    **機能の省略ではなく列の間引き**であり、`CLAUDE.md` §13.3 の「遮断しない」を満たす。
//    ブレークポイントは Tailwind の既定 `sm`（640px）。独自定義しない。
import Link from 'next/link';
import type { PlatformAuditLogView } from '@ses/db/platform';
import {
  Alert,
  AlertDescription,
  SECONDARY_LINK_STACKED_CLASSES,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@ses/ui';

const TABLET_UP = 'hidden sm:table-cell';
const EMPTY_CLASSES = 'py-8 text-center text-slate-500';
const SKELETON_LINE_CLASSES = 'mb-3 h-4 rounded-sm bg-slate-200';
/** マスク済みの記録（JSON）。折り返して全文を出す（監視系の画面で切り詰めない。docs/04 §5-8 `A-005` と同じ理由）。 */
const SUMMARY_CLASSES = 'max-w-md whitespace-pre-wrap break-all font-mono text-xs text-slate-600';

export type AdminAuditLogsResultsMessages = {
  readonly searching: string;
  readonly searchingSlow: string;
  readonly loadMore: string;
  readonly loadingMore: string;
  readonly errorPeriodTooLong: string;
  readonly errorSearchFailed: string;
  readonly emptyBeforeSearch: string;
  readonly emptyNoMatch: string;
  readonly columnDate: string;
  readonly columnTenant: string;
  readonly columnActor: string;
  readonly columnAction: string;
  readonly columnTargetType: string;
  readonly columnSummary: string;
  readonly columnMeta: string;
  readonly actorKinds: Readonly<Record<PlatformAuditLogView['actorKind'], string>>;
  readonly tenantCrossTenant: string;
  readonly tenantUnresolved: string;
  readonly tenantOpenDetail: string;
};

export type AdminAuditLogsResultsState =
  | { readonly kind: 'idle' }
  /** `slow` = 3 秒を超えた（docs/04 §A-006 非同期処理の表現）。 */
  | { readonly kind: 'searching'; readonly slow: boolean }
  | { readonly kind: 'error'; readonly reason: 'PERIOD_TOO_LONG' | 'FAILED' }
  | {
      readonly kind: 'results';
      readonly items: readonly PlatformAuditLogView[];
      readonly nextCursor: string | null;
      readonly loadingMore: boolean;
    };

export type AdminAuditLogsResultsProps = {
  readonly state: AdminAuditLogsResultsState;
  readonly messages: AdminAuditLogsResultsMessages;
  readonly onLoadMore?: (cursor: string) => void;
};

function formatDateTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  const pad = (value: number): string => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(
    date.getHours(),
  )}:${pad(date.getMinutes())}`;
}

/** 主体 = 種別 + 不透明な ID。🔴 氏名・メールアドレスは応答に無く、ここでも解決しない。 */
function actorLabel(item: PlatformAuditLogView, messages: AdminAuditLogsResultsMessages): string {
  const kind = messages.actorKinds[item.actorKind] ?? item.actorKind;
  return item.actorId === null ? kind : `${kind} / ${item.actorId}`;
}

function summaryText(summary: PlatformAuditLogView['summary']): string {
  const keys = Object.keys(summary);
  return keys.length === 0 ? '—' : JSON.stringify(summary);
}

export function AdminAuditLogsResults({ state, messages, onLoadMore }: AdminAuditLogsResultsProps) {
  if (state.kind === 'idle') {
    return (
      <p className={EMPTY_CLASSES} data-testid="admin-audit-logs-empty-before-search">
        {messages.emptyBeforeSearch}
      </p>
    );
  }

  if (state.kind === 'searching') {
    return (
      <div aria-busy="true" aria-live="polite" data-testid="admin-audit-logs-searching">
        {/* 🔴 3 秒を超えたら「検索しています」+ 期間の短縮を促す（docs/04 §A-006）。 */}
        <p className="mb-3 text-sm text-slate-600" data-testid="admin-audit-logs-searching-text">
          {state.slow ? messages.searchingSlow : messages.searching}
        </p>
        <p className={SKELETON_LINE_CLASSES} />
        <p className={SKELETON_LINE_CLASSES} />
        <p className={SKELETON_LINE_CLASSES} />
      </div>
    );
  }

  if (state.kind === 'error') {
    // 🔴 「検索を実行できませんでした」+ 期間短縮の提案（docs/04 §A-006 エラー欄）。
    //    期間上限超過（400）も同じ次の行動（期間を短くする）に導く。
    return (
      <Alert variant="danger" data-testid="admin-audit-logs-error">
        <AlertDescription>
          {state.reason === 'PERIOD_TOO_LONG'
            ? messages.errorPeriodTooLong
            : messages.errorSearchFailed}
        </AlertDescription>
      </Alert>
    );
  }

  if (state.items.length === 0) {
    return (
      <p className={EMPTY_CLASSES} data-testid="admin-audit-logs-empty">
        {messages.emptyNoMatch}
      </p>
    );
  }

  return (
    <div>
      <Table data-testid="admin-audit-logs-table">
        <TableHeader>
          <TableRow>
            <TableHead>{messages.columnDate}</TableHead>
            <TableHead>{messages.columnTenant}</TableHead>
            <TableHead className={TABLET_UP}>{messages.columnActor}</TableHead>
            <TableHead>{messages.columnAction}</TableHead>
            <TableHead className={TABLET_UP}>{messages.columnTargetType}</TableHead>
            <TableHead className={TABLET_UP}>{messages.columnSummary}</TableHead>
            <TableHead className={TABLET_UP}>{messages.columnMeta}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {state.items.map((item) => (
            <TableRow key={item.id} data-testid={`admin-audit-logs-row-${item.id}`}>
              <TableCell>{formatDateTime(item.createdAt)}</TableCell>
              <TableCell whitespace="normal">
                {item.tenantId === null ? (
                  <span className="text-slate-500">{messages.tenantCrossTenant}</span>
                ) : (
                  <>
                    <span>{item.tenantName ?? messages.tenantUnresolved}</span>
                    {/* 🔴 行から辿れる唯一の導線 = `A-003`（docs/04 §A-006「行から A-003 へ」）。 */}
                    <Link
                      className="ml-2 text-xs text-slate-700 underline-offset-2 hover:underline"
                      href={`/admin/tenants/${item.tenantId}`}
                      data-testid={`admin-audit-logs-tenant-link-${item.id}`}
                    >
                      {messages.tenantOpenDetail}
                    </Link>
                  </>
                )}
              </TableCell>
              <TableCell className={TABLET_UP} whitespace="normal">
                <span className="break-all">{actorLabel(item, messages)}</span>
              </TableCell>
              <TableCell>{item.action}</TableCell>
              <TableCell className={TABLET_UP}>{item.targetType ?? '—'}</TableCell>
              <TableCell className={TABLET_UP} whitespace="normal">
                <pre className={SUMMARY_CLASSES} data-testid={`admin-audit-logs-summary-${item.id}`}>
                  {summaryText(item.summary)}
                </pre>
              </TableCell>
              <TableCell className={TABLET_UP}>
                {[item.deviceKind, item.ipAddress].filter(Boolean).join(' / ') || '—'}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      {state.nextCursor === null ? null : (
        <button
          className={SECONDARY_LINK_STACKED_CLASSES}
          type="button"
          disabled={state.loadingMore}
          data-testid="admin-audit-logs-load-more"
          onClick={() => {
            if (state.nextCursor !== null) onLoadMore?.(state.nextCursor);
          }}
        >
          {state.loadingMore ? messages.loadingMore : messages.loadMore}
        </button>
      )}
    </div>
  );
}
