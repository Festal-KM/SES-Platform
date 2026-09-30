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
// ============================================================================
// 🔴 SP-22 `T-22-07`（一覧の適用 ②）で変えたもの / 変えていないもの
// ============================================================================
// | 変えたもの | 一次資料 | 変えていないもの |
// |---|---|---|
// | 実色（`text-slate-*` / `bg-slate-*` / `border-slate-*`）→ semantic トークン | `docs/04` §7.9 / 検査 (a) | 🔴 **列の集合・並び・間引きの境界**（6 列 / `hidden sm:table-cell`） |
// | `text-sm` → `--text-body`（**実寸は同じ 14px**） | §7.9 / 検査 (g) | 🔴 **行の詳細の描き方**（許可リスト・伏せる規則はサーバと `packages/domain`） |
// | `py-1.5` → spacing 7 段 | §7.9 / 検査 (f) | 🔴 **エクスポートの範囲と上限の扱い**（`exportCondition`） |
// | 画面側の `hover:` を撤去（8 状態はプリミティブが持つ） | §7.10 / 検査 (j) | 🔴 **testid**（削除・改名 0 件。`EmptyState` の 2 つは**追加**） |
// | 骨格 → `@ses/ui` の `Skeleton` / 空状態 → `EmptyState` | §5-13 / §10.4 | 🔴 **骨格の本数（3 本）と空状態の 2 通りの文言** |
// | 幅 → `PageBody widthClass="full"`（`page.tsx`。旧 `max-w-5xl` を撤去） | §7.1 / `U-23` / 検査 (c)(k) | — |
//
// 🔴 **`@ses/ui` の `DataTable` には移していない**（`T-22-06` の 3 画面とは形が違う）。理由は 2 つで、
//    どちらも `docs/05` §2.3.5 の `DataTableProps` に**口が無い**ことに由来する:
//      ① **行の直下にもう 1 本の `<tr>` を挿す**（`docs/04` §7.2 の 🔴「監査ログの行の中身は行の直下への
//         インライン展開。`Drawer` にしない。複数行を同時に開ける」）。`DataTable` は **1 行 = 1 `<tr>`** で
//         あり、`rowDetail` に相当する prop は §2.3.5 に無い。
//      ② **`<tr>` 自身の `onClick`**（行をクリックしても開く）。`rowAttributes` は `className` と `data-*`
//         だけを通す形で設計されており（`data-table.tsx` の 🔴）、ハンドラを通す口が無い。
//    🔴 器に ① ② の穴を開けるのは `docs/05` §2.3.5 の改訂であり、**実装側で勝手に決めない**
//       （`CLAUDE.md` §8.7 / `programmer` の「設計書にないアーキテクチャ変更をしない」）。完了記録で提起する。
//    ⚠️ ただし表そのものは `@ses/ui` の `Table` プリミティブであり、ローカルの `<table>` ではない
//       （§5-13「同じ見た目のローカル実装を 2 つ作らない」は満たしている）。列の間引きは `docs/04` §10.3 の
//       `S-041` の行（`IP・デバイス種別` → `対象種別`）どおり `hidden sm:table-cell` の 1 段だけである。
//
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
import { useCallback, useRef, useState, type FormEvent, type MouseEvent } from 'react';
import {
  Button,
  EmptyState,
  FOCUS_RING_CLASSES,
  Field,
  FieldError,
  Input,
  SECONDARY_LINK_CLASSES,
  SECONDARY_LINK_STACKED_CLASSES,
  Select,
  Skeleton,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  cn,
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

/**
 * 🔴 行を開く / 閉じる（展開の起点）。§7.10 の 8 状態はプリミティブが持つので、ここに
 *    `hover:` を書かない（`docs/05` §17.7.1 (j)）。フォーカスリングは共通の 1 語を使う。
 * ⚠️ `h-6 w-6` は**寸法**であり §7.9 の spacing 7 段の話ではない（余白ではない）。
 */
const ROW_TOGGLE_CLASSES = cn(
  'inline-flex h-6 w-6 items-center justify-center rounded-sm text-fg-muted',
  FOCUS_RING_CLASSES,
);

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

function actorLabel(
  item: AuditLogItem,
  messages: Pick<AuditLogsViewMessages, 'actorSystem' | 'actorPlatform'>,
): string {
  if (item.actorKind === 'SYSTEM') return messages.actorSystem;
  if (item.actorKind === 'PLATFORM_USER') return messages.actorPlatform;
  return item.actorDisplayName ?? item.actorId ?? '—';
}

export type AuditLogsResultsMessages = Pick<
  AuditLogsViewMessages,
  | 'columnDate'
  | 'columnActor'
  | 'columnAction'
  | 'columnTarget'
  | 'columnMeta'
  | 'columnDetail'
  | 'actorSystem'
  | 'actorPlatform'
  | 'detail'
>;

export type AuditLogsResultsProps = {
  readonly items: readonly AuditLogItem[];
  /** 🔴 **開いている行の集合**（複数。`docs/04` §S-041「複数行を同時に開ける」）。 */
  readonly expandedIds: ReadonlySet<string>;
  readonly messages: AuditLogsResultsMessages;
  readonly onToggle: (id: string) => void;
};

/**
 * `S-041` セクション 2〜3（結果テーブルと**行の直下へのインライン展開**）の**状態を持たない**描画部品。
 *
 * ============================================================================
 * 🔴 なぜ切り出すのか（`T-22-07`。`AuditLogsExportSection` と同じ理由）
 * ============================================================================
 * `AuditLogsView` は検索の結果を `useState` で持つため、`renderToStaticMarkup` では**検索後の状態に
 * 進められない**（`useEffect` 同様、クリックの結果も再描画できない）。ところが `docs/04` §7.2 /
 * §S-041 が定める 🔴 は **検索後の描画の形**そのものである:
 *   ① 行の詳細は**行の直下の `<tr>`**（同じ表の中）であり、`Drawer` / モーダル / オーバーレイではない
 *   ② **複数行を同時に開ける**（「要求 → 確定」の 2 行を並べて読む）
 *   ③ 詳細は**一覧の応答に同梱**されており、展開時の追加取得が無い（`item` を渡すだけ = fetch を持たない）
 * 🔴 この 3 つを render テストで固定できる形にするために、**状態（`expandedIds`）を props で受ける**
 *    純粋な描画部品にした。**JSX は 1 行も書き換えていない**（`toggleExpanded` → `onToggle` の名だけ）。
 */
export function AuditLogsResults({ items, expandedIds, messages, onToggle }: AuditLogsResultsProps) {
  return (
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
        {items.map((item) => {
          const expanded = expandedIds.has(item.id);
          return [
            <TableRow
              key={item.id}
              data-testid={`audit-logs-row-${item.id}`}
              data-state={expanded ? 'selected' : undefined}
              className="cursor-pointer"
              onClick={() => onToggle(item.id)}
            >
              <TableCell padding="compact">
                <button
                  type="button"
                  data-testid={`audit-logs-row-toggle-${item.id}`}
                  aria-expanded={expanded}
                  aria-controls={`audit-logs-detail-${item.id}`}
                  aria-label={expanded ? messages.detail.toggleClose : messages.detail.toggleOpen}
                  className={ROW_TOGGLE_CLASSES}
                  onClick={(event) => {
                    event.stopPropagation();
                    onToggle(item.id);
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
              // 🔴 T-22-07: 面は §7.9 の `--color-bg-subtle`（旧 `bg-slate-50` と同値）。
              //    `hover:bg-slate-50` は `TableRow` の hover を打ち消すために書かれていたが、
              //    `TableRow` の hover は同じ `bg-bg-subtle` なので**打ち消しが要らなくなった**
              //    （画面側に状態バリアントを書かない = 検査 (j)）。
              <TableRow key={`${item.id}-detail`} className="bg-bg-subtle">
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
  );
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
    <section className="mt-6 border-t border-border pt-4" data-testid="audit-logs-export">
      <p className="mb-1 text-xs text-fg-muted">{messages.exportNote}</p>
      <p className="mb-2 text-xs text-fg-muted">{messages.exportNoteLimit}</p>
      <a
        // 🔴 T-22-07: 見た目は §7.6 の secondary（`SECONDARY_LINK_CLASSES`。リポジトリで唯一の語）。
        //    `hover:underline` を画面に書かない（§7.10 の 8 状態は部品側が持つ。検査 (j)）。
        //    ⚠️ `aria-disabled:*` は 8 状態の `disabled` ではなく「生成中は押させない」の表現であり、
        //       `<a>` には `disabled` 属性が無いためここに残す（`onExport` 側も二重に弾いている）。
        className={cn(SECONDARY_LINK_CLASSES, 'aria-disabled:pointer-events-none aria-disabled:opacity-50')}
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
  // 🔴 2026-09-30: 検索条件の 4 つの入力は**非制御**（値は DOM が持ち、検索の実行時に読む）。
  //
  //    制御（`useState` + `value=`）にすると、**ハイドレーションが終わる前に入力された値が捨てられる**。
  //    React は水和のあいだは DOM の value を書き換えない（`initInput` の `isHydrating ||` の枝）が、
  //    その後**最初の再描画**で `updateInput` が `element.value !== props.value` を見て props の値
  //    （= 空文字）を書き戻す。つまり「水和前に入力 → 水和後に別の欄を触る」と、先に入れた値が画面から
  //    消え、検索は「期間を指定してください」で止まる。
  //    🔴 実害として観測した（2026-09-29 の CI。`settings.mobile.spec.ts` の `S-041`。トレースで
  //    ①2 つの日付欄に値が入る ②操作種別を選んだ瞬間に**両方が空に戻る** ③「期間を指定してください」
  //    を確認）。共通外枠（`T-12-20` / `T-12-21`）が入って水和が遅くなり、表面化した。
  //    🔴 **これはテストの都合ではない** —— 移動中の営業が開いた直後に日付を入れると同じことが起きる
  //    （`CLAUDE.md` §13.3「モバイルで破綻させない」）。本画面の入力は「検索の実行時に 1 度読む」だけで
  //    再描画に使わないので、DOM を値の持ち主にするのが素直でもある（1 文字ごとの再描画も無くなる）。
  const fromRef = useRef<HTMLInputElement>(null);
  const toRef = useRef<HTMLInputElement>(null);
  const categoryRef = useRef<HTMLSelectElement>(null);
  const actorIdRef = useRef<HTMLInputElement>(null);
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
      // 🔴 条件は**実行の瞬間に入力欄から読む**（上の 🔴）。読む先が state から DOM に変わっただけで、
      //    「さらに読み込む」が現在の入力欄の条件を使う点（＝ 従来の挙動）は変わらない。
      const from = fromRef.current?.value ?? '';
      const to = toRef.current?.value ?? '';
      const category = (categoryRef.current?.value ?? '') as AuditLogCategoryKey | '';
      const actorId = actorIdRef.current?.value ?? '';
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
    // 🔴 入力欄は ref 経由で読むため依存は無い（`runSearch` の同一性が入力のたびに変わらない）。
    [],
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
        {/* 🔴 非制御（`value` / `onChange` を持たない）。理由は `AuditLogsView` 冒頭の 🔴。 */}
        <Field label={messages.fromLabel}>
          <Input type="date" ref={fromRef} required disabled={searching} />
        </Field>
        <Field label={messages.toLabel}>
          <Input type="date" ref={toRef} required disabled={searching} />
        </Field>
        <Field label={messages.categoryLabel}>
          <Select ref={categoryRef} disabled={searching}>
            <option value="">{messages.categoryAll}</option>
            {AUDIT_LOG_CATEGORY_KEYS.map((key) => (
              <option key={key} value={key}>
                {messages.categoryNames[key]}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={messages.actorIdLabel}>
          <Input type="text" ref={actorIdRef} disabled={searching} />
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
        // 🔴 T-22-07: 骨格は `@ses/ui` の `Skeleton`（§5-13。同じ見た目のローカル実装を 2 つ作らない）。
        //    本数は従来どおり 3 本である（**行数は変えていない**）。
        <div aria-busy="true" aria-live="polite" className="mb-3">
          <Skeleton height="body" lines={3} />
        </div>
      ) : results === null ? (
        // 🔴 T-22-07: 空状態は `EmptyState`（§10.4）。**検索前と 0 件で別の語**であり（§10.1）、
        //    どちらも**アクションを置かない** —— 期間を指定して検索するのが次の一手であり、
        //    その導線は直上の検索条件そのものである（ナビの写しを空状態に並べない。§5-13）。
        <EmptyState testIdPrefix="audit-logs-empty-before-search-" description={messages.emptyBeforeSearch} />
      ) : results.items.length === 0 ? (
        <EmptyState testIdPrefix="audit-logs-empty-no-match-" description={messages.emptyNoMatch} />
      ) : (
        <div>
          {/* 🔴 詳細は**一覧の応答に同梱されたまま**（`item` をそのまま渡す）。展開時の追加取得を持たない ——
              展開ごとに取得すると監査ログの閲覧自体が記録の対象になり、行数が読めなくなる
              （`docs/04` §S-041「空 / ローディング / エラー」/ `audit-detail-single-path.test.ts` ⑤）。 */}
          <AuditLogsResults
            items={results.items}
            expandedIds={expandedIds}
            messages={messages}
            onToggle={toggleExpanded}
          />
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
