'use client';

// apps/web/app/(main)/engineer-shares/engineer-share-screen.tsx
// `S-015` 匿名共有の設定（取引先）— 本体（docs/04 §S-015 / `F-016` / docs/05 §6.4 #29）。
// T-08-02 → 🔴 T-11-11 で **1 表 + 検索 3 条件 + 共有状態フィルタ + カーソルページング**に改めた
// （`docs/04` 改訂 12 / §11-13 / `U-15`。docs/05 §6.4「#29 の改訂」）。
//
// ============================================================================
// 🔴 この画面が守る 7 つ（`docs/04` §S-015 / `F-016` / `CLAUDE.md` §3.1 経路 4）
// ============================================================================
//   ① 🔴 **「一括で共有可にする」に相当する操作を 1 つも置かない**（`F-016 AC-1` / `BR-53`）。
//      行の選択チェックボックスも、全選択も、「すべて共有」「すべて解除」ボタンも無い。操作は常に 1 行 1 件で、
//      `PUT /api/engineers/{id}/share` を 1 回だけ呼ぶ（検索結果に対する一括も作らない。2026-09-17 再確認）。
//   ② 🔴 **煽らない**（`docs/04` §S-015 空状態）。「共有すると案件が見つかりやすくなります」に
//      相当する文言を持たない。空状態は事実（「共有している人材はいません」）だけを述べる。
//   ③ 🔴 **共有可にする操作には確認ステップを置き、そこで開示プレビューを見せる**
//      （`docs/04` §S-015「操作と結果」）。何が出るかを見ないまま共有可にできる導線を作らない。
//   ④ 🔴 **解除は 1 段の確認で即時に反映される**（`F-016 AC-2`）。**「反映まで数分かかります」に
//      相当する表示を作らない**（`docs/04` §S-015 非同期処理の表現。キャッシュを持たない設計）。
//   ⑤ 🔴 **丸める前の値を並置しない**（`docs/04` §5-2）。一覧の「稼働可能時期」も
//      プレビューと同じ**丸めた区分**である（組み立ては `lib/engineer-shares/row-view.ts`）。
//   ⑥ 🔴 **総件数・残件数・「あと N 件」を出さない**（`docs/05` §4.8。`S-005` #15 と同じ契約）。
//   ⑦ 🔴 **操作の反映は当該行だけをサーバ応答（`PUT` の `{ shared, sharedOn, previewedFields }`）で描き直す。**
//      一覧を再取得しない（再読込は 1 ページ目に戻るため、3 ページ目で操作した行が視界から消える）。
//      手元で先に書き換える楽観更新もしない（サーバの状態だけが正）。`共有中` フィルタ中に解除した行は、
//      フィルタに合致しなくなっても**その場に残し** `解除しました` と表示する（次の検索で消える）。
//
// 🔴 **T2（モバイル閲覧可）。1 件ずつの共有解除はモバイルで完結する**（`docs/04` §S-015 デバイス別）。
//    **検索条件はモバイルでも 3 条件すべてを提供する**（`CLAUDE.md` §13.3。本画面のモバイルの用途は
//    「稼働が決まった人を、移動中に名前で探して解除する」であり、氏名で探せなければ台帳 250 件を 5 ページ繰る）。
//    列の間引き（3 ブレークポイントとも同じテーブル。カードにしない）:
//      - モバイル（< sm） … 氏名 / 稼働可能時期 / 操作 の 3 列（操作列のボタンラベルが状態を文字で一意に示す）
//      - タブレット（sm 〜 lg） … + 共有状態 / 共有開始日 の 5 列
//      - デスクトップ（lg 〜） … + 受け取った提案依頼 の 6 列
//    🔴 **操作列はどのブレークポイントでも隠さない。** ブレークポイントは Tailwind の既定のみ（独自定義しない）。
//
// 🔴 検索は**同期**（素の `<form method="get">`。`S-005` と同じ）。実行した検索がそのまま URL になり、
//    共有・再読込・戻るのいずれでも同じ結果に戻る。**検索のたびにカーソルは捨てる**（1 ページ目から）。
// 🔴 「次の 50 件」は `GET /api/engineer-shares` の続き（`nextCursor`）を読み、**取得済みの行の下に追加**する
//    （置き換えない。無限スクロールにしない）。追加した行は初回ページと**同じ関数**（`engineerShareRow`）で
//    組み立てる —— 文言はサーバが解決した表（`rowLabels`）を注入する。
//
// 🔴 文言は props（`packages/i18n`）から受け取る。ここにベタ書きしない（`CLAUDE.md` §3.5）。
// 🔴 `@ses/db` / `@ses/i18n` を値 import しない（型だけ。`tests/static/client-db-boundary.test.ts`）。
import { useState } from 'react';
import Link from 'next/link';
import {
  Button,
  Field,
  Input,
  SECONDARY_LINK_CLASSES,
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
import {
  engineerShareRow,
  redrawEngineerShareRow,
  type EngineerShareRowLabels,
  type EngineerShareRowView,
} from '../../../lib/engineer-shares/row-view';
import type {
  EngineerShareActiveFilterView,
  EngineerShareEmptyState,
  EngineerShareFilter,
} from '../../../lib/engineer-shares/screen-query';
import type {
  EngineerShareListView,
  EngineerShareUpdateView,
} from '../../../lib/engineer-shares/service';

export type { EngineerShareRowView } from '../../../lib/engineer-shares/row-view';

export type EngineerShareFilterOption = {
  readonly value: EngineerShareFilter;
  readonly label: string;
};

/** 検索条件フォームの初期値（URL から。`q` / `availableBy` は未指定なら空文字）。 */
export type EngineerShareFilterValues = {
  readonly q: string;
  readonly availableBy: string;
  readonly shared: EngineerShareFilter;
};

export type EngineerShareScreenMessages = {
  readonly lead: string;
  readonly searchLegend: string;
  readonly searchQ: string;
  readonly searchAvailableBy: string;
  readonly searchShared: string;
  readonly searchSubmit: string;
  readonly searchClear: string;
  readonly sectionList: string;
  readonly sectionPreview: string;
  readonly columnName: string;
  readonly columnState: string;
  readonly columnSharedOn: string;
  readonly columnProposalRequestCount: string;
  readonly columnAvailability: string;
  readonly columnAction: string;
  readonly stateShared: string;
  readonly stateNotShared: string;
  readonly stateRevokedNow: string;
  readonly stateDeleted: string;
  readonly sharedEmpty: string;
  readonly sharedEmptyShowNotShared: string;
  readonly notSharedEmpty: string;
  readonly filteredEmpty: string;
  readonly activeFiltersTitle: string;
  readonly removeFilterSuffix: string;
  readonly ledgerEmpty: string;
  readonly ledgerRegister: string;
  readonly loadMore: string;
  readonly loadMoreLoading: string;
  readonly loadMoreError: string;
  readonly loadMoreRetry: string;
  readonly previewSelect: string;
  readonly previewNote: string;
  readonly previewCareersNote: string;
  readonly fieldSkills: string;
  readonly fieldYears: string;
  readonly fieldPrice: string;
  readonly fieldAvailability: string;
  readonly fieldLocation: string;
  readonly fieldUpdatedOn: string;
  readonly valueNone: string;
  readonly share: string;
  readonly shareConfirmTitle: string;
  readonly shareConfirmSubmit: string;
  readonly shareConfirmCancel: string;
  readonly shareSubmitting: string;
  readonly revoke: string;
  readonly revokeConfirmTitle: string;
  readonly revokeConfirmLead: string;
  readonly revokeConfirmSubmit: string;
  readonly revokeConfirmCancel: string;
  readonly revokeSubmitting: string;
  readonly errorSave: string;
  readonly errorRetryNote: string;
  readonly deniedTitle: string;
};

export type EngineerShareScreenProps = {
  /** 1 ページ目（サーバが `listEngineerShares` で読んだ分）。 */
  readonly rows: readonly EngineerShareRowView[];
  /** 続きがあれば `nextCursor`。無ければ `null`。🔴 残件数はここにも無い。 */
  readonly nextCursor: string | null;
  readonly filters: EngineerShareFilterValues;
  readonly filterOptions: readonly EngineerShareFilterOption[];
  /** いま効いている条件（条件あり・0 件の空状態で 1 つずつ外せる導線）。 */
  readonly activeFilters: readonly EngineerShareActiveFilterView[];
  /** 空状態の種別（行があれば `null`。判定は `engineerShareEmptyState`）。 */
  readonly emptyState: EngineerShareEmptyState | null;
  /** `共有中`・条件なし・0 件のときの導線（`?shared=false`）。 */
  readonly showNotSharedHref: string;
  /** 「条件を解除」（既定の一覧へ）。 */
  readonly clearHref: string;
  /** 「次の 50 件」が API を呼ぶときの query 文字列（`cursor` を除く）。 */
  readonly apiSearch: string;
  /** `S-007`（人材の登録）への導線（台帳が空のとき。`docs/04` §S-015 空状態）。 */
  readonly registerHref: string;
  /**
   * 🔴 実行系を止めている理由（`F-004 AC-7`）。`null` なら実行可。
   *    **拒否の本体は `#29` の PUT のガード**であり、これはその理由の表示である。
   */
  readonly denialMessage: string | null;
  /** 追加ページの行を組み立てる文言の表（サーバが `t` で解決。`share-props.ts`）。 */
  readonly rowLabels: EngineerShareRowLabels;
  readonly messages: EngineerShareScreenMessages;
};

/** 進行中の確認ステップ。🔴 **1 度に 1 件だけ**（一括操作が存在しないことの表れでもある）。 */
type Pending =
  | { readonly kind: 'NONE' }
  | { readonly kind: 'SHARE'; readonly engineerId: string }
  | { readonly kind: 'REVOKE'; readonly engineerId: string };

/**
 * 行の一時的な印（サーバ応答で描き直した結果の注記）。
 *   - `REVOKED_NOW` … `共有中` フィルタ中に解除した（フィルタに合致しなくなったがその場に残す）
 *   - `DELETED`     … 操作の応答が 404（対象が削除済み。`docs/04` §10.1 `S-015`）
 */
type RowMark = 'REVOKED_NOW' | 'DELETED';

/** タブレット以上で出す列（共有状態 / 共有開始日）。 */
const TABLET_UP = 'hidden sm:table-cell';
/** デスクトップ以上で出す列（受け取った提案依頼）。 */
const DESKTOP_UP = 'hidden lg:table-cell';

const API_PATH = '/api/engineer-shares';

export function EngineerShareScreen({
  rows: initialRows,
  nextCursor: initialNextCursor,
  filters,
  filterOptions,
  activeFilters,
  emptyState,
  showNotSharedHref,
  clearHref,
  apiSearch,
  registerHref,
  denialMessage,
  rowLabels,
  messages,
}: EngineerShareScreenProps) {
  const [rows, setRows] = useState<readonly EngineerShareRowView[]>(initialRows);
  const [nextCursor, setNextCursor] = useState<string | null>(initialNextCursor);
  const [marks, setMarks] = useState<Readonly<Record<string, RowMark>>>({});
  const [pending, setPending] = useState<Pending>({ kind: 'NONE' });
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [submittingId, setSubmittingId] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [loadMoreFailed, setLoadMoreFailed] = useState(false);

  const canExecute = denialMessage === null;
  // 🔴 プレビューの対象は「選択した 1 件」か「確認中の 1 件」。どちらも無ければ出さない
  //    （`docs/04` §S-015 ローディング「一覧を先に、プレビューは選択後」）。
  const focusedId = pending.kind === 'NONE' ? selectedId : pending.engineerId;
  const focused = rows.find((row) => row.engineerId === focusedId) ?? null;
  const hasActiveConditions = activeFilters.length > 0;

  function select(engineerId: string): void {
    setFailed(false);
    setPending({ kind: 'NONE' });
    setSelectedId(engineerId);
  }

  function ask(kind: 'SHARE' | 'REVOKE', engineerId: string): void {
    setFailed(false);
    setSelectedId(engineerId);
    setPending({ kind, engineerId });
  }

  /** 🔴 サーバ応答で**当該行だけ**を描き直す（一覧を再取得しない。楽観更新もしない。`redrawEngineerShareRow`）。 */
  function redrawRow(updated: EngineerShareUpdateView): void {
    setRows((current) => current.map((row) => redrawEngineerShareRow(row, updated, rowLabels)));
    setMarks((current) => {
      const next = { ...current };
      if (!updated.shared && filters.shared === 'true') next[updated.engineerId] = 'REVOKED_NOW';
      else delete next[updated.engineerId];
      return next;
    });
  }

  async function submit(engineerId: string, shared: boolean): Promise<void> {
    if (submittingId !== null || !canExecute) return;
    setSubmittingId(engineerId);
    setFailed(false);
    try {
      const response = await fetch(`/api/engineers/${engineerId}/share`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        // 🔴 送るのは対象 1 件の真偽だけである（配列を送る形が存在しない。`F-016 AC-1`）。
        body: JSON.stringify({ shared }),
      });
      if (response.status === 404) {
        // 対象が削除済み → 行を描き直し「削除済み」（`docs/04` §10.1 `S-015`）。
        setMarks((current) => ({ ...current, [engineerId]: 'DELETED' }));
        setPending({ kind: 'NONE' });
        setSubmittingId(null);
        return;
      }
      if (!response.ok) {
        setSubmittingId(null);
        setFailed(true);
        return;
      }
      // 🔴 解除はここで初めて画面に映り、その時点でホストの候補一覧からも消えている（`F-016 AC-2`。同じ 1 行が根拠）。
      redrawRow((await response.json()) as EngineerShareUpdateView);
      setPending({ kind: 'NONE' });
      setSubmittingId(null);
    } catch {
      setSubmittingId(null);
      setFailed(true);
    }
  }

  async function loadMore(): Promise<void> {
    if (nextCursor === null || loadingMore) return;
    setLoadingMore(true);
    setLoadMoreFailed(false);
    try {
      const params = new URLSearchParams(apiSearch);
      params.set('cursor', nextCursor);
      const response = await fetch(`${API_PATH}?${params.toString()}`, { cache: 'no-store' });
      if (!response.ok) {
        setLoadMoreFailed(true);
        return;
      }
      const body = (await response.json()) as EngineerShareListView;
      // 🔴 取得済みの行の下に追加する（置き換えない）。同じ行が再び来ても 1 行に畳む。
      setRows((current) => {
        const seen = new Set(current.map((row) => row.engineerId));
        const added = body.items
          .filter((item) => !seen.has(item.engineerId))
          .map((item) => engineerShareRow(item, rowLabels));
        return [...current, ...added];
      });
      setNextCursor(body.nextCursor);
    } catch {
      setLoadMoreFailed(true);
    } finally {
      setLoadingMore(false);
    }
  }

  function stateLabel(row: EngineerShareRowView): string {
    const mark = marks[row.engineerId];
    if (mark === 'DELETED') return messages.stateDeleted;
    if (mark === 'REVOKED_NOW') return messages.stateRevokedNow;
    return row.shared ? messages.stateShared : messages.stateNotShared;
  }

  function renderPreview(row: EngineerShareRowView) {
    const items: readonly { readonly key: string; readonly label: string; readonly value: string }[] = [
      {
        key: 'skills',
        label: messages.fieldSkills,
        value: row.preview.skills.length === 0 ? messages.valueNone : row.preview.skills.join('・'),
      },
      { key: 'years', label: messages.fieldYears, value: row.preview.yearsBand },
      { key: 'price', label: messages.fieldPrice, value: row.preview.priceBand },
      { key: 'availability', label: messages.fieldAvailability, value: row.preview.availabilityBand },
      { key: 'location', label: messages.fieldLocation, value: row.preview.location },
      { key: 'updatedOn', label: messages.fieldUpdatedOn, value: row.preview.updatedOn },
    ];
    return (
      <div
        className="border border-slate-200 bg-white p-4"
        data-testid={`engineer-share-preview-${row.engineerId}`}
      >
        <p className="mb-2 text-sm font-bold text-slate-900">{row.displayName}</p>
        <dl className="text-sm">
          {items.map((item) => (
            <div
              key={item.key}
              className="flex gap-3 border-b border-slate-100 py-1 last:border-b-0"
              data-testid={`engineer-share-preview-field-${item.key}`}
            >
              <dt className="w-40 shrink-0 text-slate-500">{item.label}</dt>
              <dd className="m-0 break-words text-slate-900">{item.value}</dd>
            </div>
          ))}
        </dl>
        {/* 🔴 「経歴は開示されません」を本文で明示する（`F-008 AC-7` / `docs/04` §5-2）。
            見えていないことを目で確かめられて初めて共有が続く。 */}
        <p className="mt-2 text-xs text-slate-500" data-testid="engineer-share-preview-careers-note">
          {messages.previewCareersNote}
        </p>
      </div>
    );
  }

  function renderEmptyState(kind: EngineerShareEmptyState) {
    if (kind === 'LEDGER') {
      return (
        <div data-testid="engineer-share-ledger-empty">
          <p className="mb-2 text-sm text-slate-600">{messages.ledgerEmpty}</p>
          <Link className={SECONDARY_LINK_STACKED_CLASSES} href={registerHref}>
            {messages.ledgerRegister}
          </Link>
        </div>
      );
    }
    if (kind === 'SHARED_NONE') {
      // 🔴 煽らない。事実だけを述べ、フィルタ切替の導線を置く（`docs/04` §S-015）。
      return (
        <div data-testid="engineer-share-shared-empty">
          <p className="mb-2 text-sm text-slate-600">{messages.sharedEmpty}</p>
          <Link
            className={SECONDARY_LINK_CLASSES}
            href={showNotSharedHref}
            data-testid="engineer-share-show-not-shared"
          >
            {messages.sharedEmptyShowNotShared}
          </Link>
        </div>
      );
    }
    if (kind === 'ALL_SHARED') {
      return (
        <p className="text-sm text-slate-600" data-testid="engineer-share-not-shared-empty">
          {messages.notSharedEmpty}
        </p>
      );
    }
    // 条件あり・0 件: 効いている条件を 1 つずつ外せる導線（`S-005` と同じ形。共有状態も条件の 1 つ）。
    return (
      <div
        className="border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700"
        data-testid="engineer-share-filtered-empty"
      >
        <p className="m-0">{messages.filteredEmpty}</p>
        {activeFilters.length === 0 ? null : (
          <div className="mt-3" data-testid="engineer-share-active-filters">
            <p className="mb-1 font-semibold">{messages.activeFiltersTitle}</p>
            <ul className="m-0 flex list-none flex-wrap gap-2 p-0">
              {activeFilters.map((filter) => (
                <li key={filter.key}>
                  <Link
                    className={SECONDARY_LINK_CLASSES}
                    href={filter.href}
                    data-testid={`engineer-share-remove-filter-${filter.key}`}
                  >
                    {filter.label} {messages.removeFilterSuffix}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    );
  }

  return (
    <div data-testid="engineer-share-screen">
      {/* --- 1. 共有の意味の説明（常設） ------------------------------------- */}
      <p className="mb-4 text-sm text-slate-600" data-testid="engineer-share-lead">
        {messages.lead}
      </p>

      {denialMessage === null ? null : (
        <div
          role="alert"
          className="mb-4 border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900"
          data-testid="engineer-share-denied"
        >
          <p className="font-bold">{messages.deniedTitle}</p>
          <p>{denialMessage}</p>
        </div>
      )}

      {/* --- 2. 検索条件（氏名 / 稼働可能時期 / 共有状態）。🔴 モバイルでも 3 条件を省略しない --- */}
      <form
        className={FILTER_FORM_CLASSES}
        method="get"
        action="/engineer-shares"
        data-testid="engineer-share-filters"
      >
        <fieldset className="contents">
          <legend className="sr-only">{messages.searchLegend}</legend>
          <Field label={messages.searchQ}>
            <Input
              type="search"
              name="q"
              defaultValue={filters.q}
              data-testid="engineer-share-filter-q"
            />
          </Field>
          <Field label={messages.searchAvailableBy}>
            <Input
              type="date"
              name="availableBy"
              defaultValue={filters.availableBy}
              data-testid="engineer-share-filter-available-by"
            />
          </Field>
          <Field label={messages.searchShared}>
            <Select
              name="shared"
              defaultValue={filters.shared}
              data-testid="engineer-share-filter-shared"
            >
              {filterOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </Select>
          </Field>
          <div className={FILTER_ACTIONS_CLASSES}>
            <Button type="submit" data-testid="engineer-share-search">
              {messages.searchSubmit}
            </Button>
            {hasActiveConditions ? (
              <Link className={SECONDARY_LINK_CLASSES} href={clearHref} data-testid="engineer-share-clear">
                {messages.searchClear}
              </Link>
            ) : null}
          </div>
        </fieldset>
      </form>

      {failed ? (
        <p role="alert" className="mb-4 text-sm text-red-700" data-testid="engineer-share-error">
          {messages.errorSave}
          <br />
          {/* 🔴 「反映まで数分かかります」ではなく「状態は変わっていない」と書く。 */}
          <span className="text-slate-600">{messages.errorRetryNote}</span>
        </p>
      ) : null}

      {/* --- 3. 一覧テーブル（🔴 1 表。共有状態フィルタで絞る）+ 4. カーソルページング ---------- */}
      {emptyState !== null ? (
        renderEmptyState(emptyState)
      ) : (
        <section
          className="mb-6"
          // 🔴 testid はいま出している母集団を示す（`共有中` / `共有していない` / すべて）。
          data-testid={
            filters.shared === 'true'
              ? 'engineer-share-shared'
              : filters.shared === 'false'
                ? 'engineer-share-not-shared'
                : 'engineer-share-list'
          }
        >
          <h2 className="mb-2 text-base font-bold text-slate-900">{messages.sectionList}</h2>
          <Table
            data-testid={
              filters.shared === 'true'
                ? 'engineer-share-shared-table'
                : filters.shared === 'false'
                  ? 'engineer-share-not-shared-table'
                  : 'engineer-share-table'
            }
          >
            <TableHeader>
              <TableRow>
                <TableHead>{messages.columnName}</TableHead>
                <TableHead className={TABLET_UP}>{messages.columnState}</TableHead>
                <TableHead className={TABLET_UP}>{messages.columnSharedOn}</TableHead>
                <TableHead className={DESKTOP_UP}>{messages.columnProposalRequestCount}</TableHead>
                <TableHead>{messages.columnAvailability}</TableHead>
                <TableHead>{messages.columnAction}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => {
                const mark = marks[row.engineerId];
                return (
                  <TableRow key={row.engineerId} data-testid={`engineer-share-row-${row.engineerId}`}>
                    <TableCell whitespace="normal">
                      <button
                        type="button"
                        className={SECONDARY_LINK_CLASSES}
                        onClick={() => select(row.engineerId)}
                        data-testid={`engineer-share-select-${row.engineerId}`}
                      >
                        {row.displayName}
                      </button>
                    </TableCell>
                    <TableCell className={TABLET_UP} data-testid={`engineer-share-state-${row.engineerId}`}>
                      {stateLabel(row)}
                    </TableCell>
                    <TableCell className={TABLET_UP}>{row.sharedOn}</TableCell>
                    <TableCell className={DESKTOP_UP}>{row.proposalRequestCount}</TableCell>
                    <TableCell>{row.availability}</TableCell>
                    <TableCell>
                      {/* 🔴 行ごとに `共有する` **または** `解除する` のどちらか 1 つ（両方を並べない）。
                          削除済みの行と停止中は操作を描かない。 */}
                      {!canExecute || mark === 'DELETED' ? null : row.shared ? (
                        <Button
                          type="button"
                          variant="secondary"
                          onClick={() => ask('REVOKE', row.engineerId)}
                          disabled={submittingId !== null}
                          data-testid={`engineer-share-revoke-${row.engineerId}`}
                        >
                          {messages.revoke}
                        </Button>
                      ) : (
                        <Button
                          type="button"
                          onClick={() => ask('SHARE', row.engineerId)}
                          disabled={submittingId !== null}
                          data-testid={`engineer-share-share-${row.engineerId}`}
                        >
                          {messages.share}
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>

          {/* 🔴 「次の 50 件」はボタンの位置でのみ進行表示し、取得済みの行を覆わない。総件数・残件数を出さない。 */}
          {nextCursor === null ? null : (
            <div className="mt-3 flex flex-wrap items-center gap-4">
              <Button
                type="button"
                variant="secondary"
                onClick={() => void loadMore()}
                disabled={loadingMore}
                data-testid="engineer-share-load-more"
              >
                {loadingMore
                  ? messages.loadMoreLoading
                  : loadMoreFailed
                    ? messages.loadMoreRetry
                    : messages.loadMore}
              </Button>
              {loadMoreFailed ? (
                <p role="alert" className="m-0 text-sm text-red-700" data-testid="engineer-share-load-more-error">
                  {messages.loadMoreError}
                </p>
              ) : null}
            </div>
          )}
        </section>
      )}

      {/* --- 5. 選択した候補の開示プレビュー ---------------------------------- */}
      {emptyState !== null ? null : (
        <section data-testid="engineer-share-preview">
          <h2 className="mb-2 text-base font-bold text-slate-900">{messages.sectionPreview}</h2>
          <p className="mb-3 text-xs text-slate-500" data-testid="engineer-share-preview-note">
            {messages.previewNote}
          </p>

          {focused === null ? (
            <p className="text-sm text-slate-600" data-testid="engineer-share-preview-placeholder">
              {messages.previewSelect}
            </p>
          ) : (
            <>
              {/* 🔴 共有可にする確認ステップ。**プレビューを見せたうえで**確定させる
                  （`docs/04` §S-015「操作と結果」）。プレビューを飛ばす導線を作らない。 */}
              {pending.kind === 'SHARE' ? (
                <div
                  className="mb-3 border border-slate-300 bg-slate-50 px-4 py-3 text-sm text-slate-800"
                  data-testid="engineer-share-share-confirm"
                >
                  <p className="font-bold">{messages.shareConfirmTitle}</p>
                </div>
              ) : null}
              {pending.kind === 'REVOKE' ? (
                <div
                  className="mb-3 border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900"
                  data-testid="engineer-share-revoke-confirm"
                >
                  <p className="font-bold">{messages.revokeConfirmTitle}</p>
                  <p>{messages.revokeConfirmLead}</p>
                </div>
              ) : null}

              {renderPreview(focused)}

              {pending.kind === 'NONE' ? null : (
                <div className="mt-3 flex flex-wrap items-center gap-4">
                  <Button
                    type="button"
                    variant={pending.kind === 'REVOKE' ? 'secondary' : 'primary'}
                    disabled={submittingId !== null || !canExecute}
                    onClick={() => submit(pending.engineerId, pending.kind === 'SHARE')}
                    data-testid="engineer-share-confirm-submit"
                  >
                    {submittingId !== null
                      ? pending.kind === 'SHARE'
                        ? messages.shareSubmitting
                        : messages.revokeSubmitting
                      : pending.kind === 'SHARE'
                        ? messages.shareConfirmSubmit
                        : messages.revokeConfirmSubmit}
                  </Button>
                  <button
                    type="button"
                    className={SECONDARY_LINK_CLASSES}
                    onClick={() => setPending({ kind: 'NONE' })}
                    data-testid="engineer-share-confirm-cancel"
                  >
                    {pending.kind === 'SHARE'
                      ? messages.shareConfirmCancel
                      : messages.revokeConfirmCancel}
                  </button>
                </div>
              )}
            </>
          )}
        </section>
      )}
    </div>
  );
}
