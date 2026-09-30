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
//
// ============================================================================
// 🔴 SP-22 `T-22-08`（段② の一覧 ③）で変えたもの / 変えていないもの
// ============================================================================
// | 変えたもの | 一次資料 | 変えていないもの |
// |---|---|---|
// | 実色（`text-slate-*` / `bg-slate-*`）→ semantic トークン | `docs/04` §7.9 / 検査 (a) | 🔴 **7 列の集合・並び・間引きの境界**（`hidden sm:table-cell` の 1 段） |
// | `text-sm` → `--text-body`（**実寸は同じ 14px**） | §7.9 / 検査 (g) | 🔴 **`summary` は API-A7 がマスクした固定形をそのまま出す**（`MaskedAuditSummary`。許可リストを足さない） |
// | 骨格 → `@ses/ui` の `Skeleton`（3 本のまま） | §5-13 / §10.4 | 🔴 **行から遷移できるのは `A-003` だけ**（`F-058 AC-2`） |
// | 空状態 → `EmptyState`（検索前 / 0 件で別文言のまま） | §5-13 / §10.1 / §10.4 | 🔴 **testid**（削除・改名 0 件。器への併記で残す） |
// | 画面側の `hover:` を撤去（8 状態はプリミティブが持つ） | §7.10 / 検査 (j) | 🔴 **`閲覧のみ`（`page.tsx`）** |
// | `summary` の `max-w-md` を撤去（幅は画面が決めない） | §7.1 / 検査 (c) | 🔴 **折り返して全文**（切り詰めない） |
//
// 🔴 **`@ses/ui` の `DataTable` には移していない**（`S-041` と同じ理由 + 本画面固有の 1 つ）。
//    `DataTable` の列定義（`docs/05` §2.3.5）は `priority` を必須で持ち、検査 (m)①② は
//    🔴 **`A-005` / `A-006` の列定義が `always` のみであること**を要求する（監視画面では列を隠さない）。
//    ところが `docs/04` §10.3 の `S-041` / `A-006` の行は **`IP・デバイス種別` → `対象種別` を
//    先に隠す**と定めており（§A-006 デバイス別も「モバイルは日時 + テナント + 操作の 3 要素」）、
//    **その 2 つは両立しない。** 🔴 どちらを選んでも一方の条文か既存の検査を壊すため、
//    **この画面は列定義を持たない形（`Table` プリミティブ + `hidden sm:table-cell` の 1 段）を維持する**
//    —— 移行前の間引きの境界がそのまま残り、§7.1 の「`2xl` で 100 行 × 全列」も満たす
//    （`sm` 以上では 7 列すべてが出る）。**条文の食い違いは実装側で決めず、完了記録で提起する**
//    （`CLAUDE.md` §8.7 / `programmer` の「設計書にないアーキテクチャ変更をしない」）。
//    ⚠️ 表そのものは `@ses/ui` の `Table` プリミティブであり、ローカルの `<table>` ではない
//    （§5-13「同じ見た目のローカル実装を 2 つ作らない」は満たしている）。
import Link from 'next/link';
import type { PlatformAuditLogView } from '@ses/db/platform';
import {
  Alert,
  AlertDescription,
  EmptyState,
  SECONDARY_LINK_CLASSES,
  SECONDARY_LINK_STACKED_CLASSES,
  Skeleton,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  cn,
} from '@ses/ui';

const TABLET_UP = 'hidden sm:table-cell';
/**
 * マスク済みの記録（JSON）。折り返して全文を出す（監視系の画面で切り詰めない。docs/04 §5-8 `A-005` と同じ理由）。
 * 🔴 T-22-08: 旧 `max-w-md` を外した（検査 (c): 画面が幅を決めない）。**幅は表が決める** ——
 *    他の 6 列は `whitespace-nowrap`（`TableCell` の既定）なので最小幅を保ち、
 *    `whitespace="normal"` を持つこの列だけが余りを受けて折り返す（§7.1 の「伸びてよい列」）。
 */
const SUMMARY_CLASSES = 'whitespace-pre-wrap break-all font-mono text-xs text-fg-muted';

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
    // 🔴 T-22-08: 空状態は `EmptyState`（§10.4）。**検索前と 0 件で別の語**であり（§10.1）、
    //    どちらも**アクションを置かない** —— 次の一手は直上の検索条件そのものである。
    //    ⚠️ 器の `data-testid` は凍結済みの `admin-audit-logs-empty-before-search` である（`U-22`）。
    return (
      <div data-testid="admin-audit-logs-empty-before-search">
        <EmptyState
          testIdPrefix="admin-audit-logs-empty-before-search-state-"
          description={messages.emptyBeforeSearch}
        />
      </div>
    );
  }

  if (state.kind === 'searching') {
    return (
      <div aria-busy="true" aria-live="polite" data-testid="admin-audit-logs-searching">
        {/* 🔴 3 秒を超えたら「検索しています」+ 期間の短縮を促す（docs/04 §A-006）。 */}
        <p className="mb-3 text-body text-fg-muted" data-testid="admin-audit-logs-searching-text">
          {state.slow ? messages.searchingSlow : messages.searching}
        </p>
        {/* 🔴 T-22-08: 骨格は `@ses/ui` の `Skeleton`（§5-13。同じ見た目のローカル実装を 2 つ作らない）。
            **本数は従来どおり 3 本**である（行数を変えていない）。 */}
        <Skeleton height="body" lines={3} />
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
    // ⚠️ 器の `data-testid` は凍結済みの `admin-audit-logs-empty` である（`U-22`）。
    return (
      <div data-testid="admin-audit-logs-empty">
        <EmptyState testIdPrefix="admin-audit-logs-empty-state-" description={messages.emptyNoMatch} />
      </div>
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
                  <span className="text-fg-muted">{messages.tenantCrossTenant}</span>
                ) : (
                  <>
                    <span>{item.tenantName ?? messages.tenantUnresolved}</span>
                    {/* 🔴 行から辿れる唯一の導線 = `A-003`（docs/04 §A-006「行から A-003 へ」）。 */}
                    <Link
                      // 🔴 §7.6 の secondary（`@ses/ui` の 1 語）。8 状態はプリミティブが持つ（検査 (j)）。
                      className={cn(SECONDARY_LINK_CLASSES, 'ml-2 text-xs')}
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
