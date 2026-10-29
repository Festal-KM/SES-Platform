'use client';

// apps/web/app/(main)/projects/_search/active-filter-bar.tsx
// `S-010` の検索エリアの**条件バー**（改修指示書 §2 の C 層 / §4）。
//
// ============================================================================
// 🔴 この帯は「本文を閉じても残る」層である
// ============================================================================
// 指示書 §2: 「左：『選択中の条件』と条件バッジ。入りきらない分は『＋N』。
//             右：『クリア』『検索』。変更が未適用なら『未適用』を表示する。
//             **本文を閉じても、この条件バーとヘッダーは残す。**」
//
// 🔴 **バッジは `draftFilters` から導出する**（指示書 §6「条件バーは draftFilters から導出し、
//    バッジ専用の別状態で二重管理しないでください」）。導出は `./filters.ts` の
//    `projectSearchChips` の 1 本だけである。
//
// ============================================================================
// 🔴 「＋N」をどう数えるか（推定ではなく**実測**）
// ============================================================================
// 指示書 §4: 「PC では原則 1 行とし、操作ボタンの幅を確保したうえで、収まらない条件を
//             『＋N』にまとめます。」「ページ全体や条件バーに横スクロールを出さないでください。」
//
// バッジの語長はばらばら（`勤務地：神奈川県` と `募集中`）なので、**個数の決め打ちでは
// 収まり方が幅で変わる**。そこで **見えない計測用の行**を 1 つ置き、そこに全バッジを
// 並べて各々の実幅を測る。
//
// 🔴 **計測用の行は `visibility: hidden` で、`aria-hidden` である**（読み上げに 2 度出ない）。
// 🔴 **計測の結果で本物の行の内容が変わっても、計測用の行は変わらない** —— だから
//    「隠す → 幅が変わる → 数え直す」の無限ループにならない。

import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';

/**
 * 🔴 **サーバでは `useEffect` に落とす。**
 *    `useLayoutEffect` をサーバで呼ぶと React が警告を出すが、ここでは
 *    **描画の前に測る**ことが目的であり、サーバには測るものが無い。
 */
const useIsomorphicLayoutEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect;
import {
  Badge,
  Button,
  FILTER_SUMMARY_BAR_CLASSES,
  FILTER_SUMMARY_CHIPS_CLASSES,
  Icon,
  MULTI_SELECT_BADGE_CLASSES,
  MULTI_SELECT_BADGE_LABEL_CLASSES,
  MULTI_SELECT_BADGE_WIDE_CLASSES,
  MULTI_SELECT_BADGE_REMOVE_CLASSES,
  MULTI_SELECT_OVERFLOW_CLASSES,
  POPOVER_LIST_CLASSES,
  POPOVER_PANEL_END_CLASSES,
  cn,
} from '@ses/ui';
import { t } from '@ses/i18n';
import { Tooltip } from '@ses/ui/client';
import type { ProjectSearchChip } from './filters';

/** 「＋N」の持ち分（この幅を先に確保してから、何個入るかを数える）。 */
const OVERFLOW_SLOT_PX = 52;
/** バッジ同士の間隔（`gap-2` = 8px）。 */
const CHIP_GAP_PX = 8;

/**
 * 何個のバッジが 1 行に収まるか。
 *
 * 🔴 **純粋関数**（幅の配列と器の幅だけで決まる）。ユニットテストで固定する。
 * 🔴 **1 つも入らないときは 0** —— そのときバッジは出さず「＋N」だけを出す
 *    （指示書「＋N はクリック・キーボードで開き、全条件の確認と個別解除ができる」）。
 */
export function visibleChipCount(containerWidth: number | null, chipWidths: readonly number[]): number {
  if (chipWidths.length === 0) return 0;
  if (containerWidth === null) return chipWidths.length;
  // 🔴 まず「全部入るか」を見る（入るなら「＋N」の幅を取らない）。
  const total = chipWidths.reduce((sum, width) => sum + width, 0) + CHIP_GAP_PX * (chipWidths.length - 1);
  if (total <= containerWidth) return chipWidths.length;
  const room = containerWidth - OVERFLOW_SLOT_PX - CHIP_GAP_PX;
  let used = 0;
  let count = 0;
  for (const width of chipWidths) {
    const next = used === 0 ? width : used + CHIP_GAP_PX + width;
    if (next > room) break;
    used = next;
    count += 1;
  }
  // 🔴 **全部入ってしまったら 1 つ減らす** —— 上で「全部は入らない」と判っているので、
  //    ここで全件になるのは「＋N」の幅を引いた結果の端数であり、`＋0` を出さない。
  return count >= chipWidths.length ? chipWidths.length - 1 : count;
}

export type ActiveFilterBarMessages = {
  readonly label: string;
  readonly empty: string;
  readonly remove: string;
  readonly overflowLabel: string;
  readonly clear: string;
  readonly submit: string;
  /** 🔴 `draftFilters` と `appliedFilters` が違うときの印（指示書 §6）。 */
  readonly pending: string;
  readonly pendingHint: string;
};

export function ActiveFilterBar({
  chips,
  pending,
  submitting = false,
  compact = false,
  keywordGroupCount = 0,
  onOpenDetails,
  onRemove,
  onClear,
  onCancel,
  messages,
  testIdPrefix,
}: {
  readonly chips: readonly ProjectSearchChip[];
  readonly pending: boolean;
  readonly submitting?: boolean;
  readonly compact?: boolean;
  readonly keywordGroupCount?: number;
  readonly onOpenDetails?: () => void;
  readonly onRemove: (key: string) => void;
  readonly onClear: () => void;
  readonly onCancel?: () => void;
  readonly messages: ActiveFilterBarMessages;
  readonly testIdPrefix: string;
}) {
  const rowRef = useRef<HTMLDivElement>(null);
  const measureRef = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState<number | null>(null);
  const [overflowOpen, setOverflowOpen] = useState(false);
  const overflowRef = useRef<HTMLDivElement>(null);
  const overflowTriggerRef = useRef<HTMLButtonElement>(null);
  const panelId = useId();

  // 🔴 **描画の前に測る**（`useLayoutEffect`）—— 1 フレームだけ全バッジが出てから減る、を避ける。
  useIsomorphicLayoutEffect(() => {
    const row = rowRef.current;
    const measure = measureRef.current;
    if (row === null || measure === null) return;
    const recount = (): void => {
      const widths = Array.from(measure.children).map((child) =>
        child instanceof HTMLElement ? child.offsetWidth : 0,
      );
      setVisible(visibleChipCount(row.clientWidth, widths));
    };
    recount();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(recount);
    observer.observe(row);
    return () => {
      observer.disconnect();
    };
  }, [chips]);

  const shown = visible === null ? chips.length : Math.min(visible, chips.length);
  const hidden = chips.slice(shown);

  const closeOverflow = (focusTrigger: boolean): void => {
    setOverflowOpen(false);
    // 🔴 **元の操作位置へ焦点を戻す**（指示書 §7）—— パネルの中の `×` に
    //    焦点がある状態で閉じると、戻さなければ焦点が body に落ちる。
    if (focusTrigger) overflowTriggerRef.current?.focus({ preventScroll: true });
  };

  // 🔴🔴 **「＋N」が消えたらパネルも閉じる。**
  //    パネルの中から最後の 1 件を解除すると引き金ごと消えるが、`overflowOpen` が
    //    `true` のまま残ると、**次に条件が溢れた瞬間にパネルが勝手に開く**。
  useEffect(() => {
    if (overflowOpen && chips.length <= shown) setOverflowOpen(false);
  }, [overflowOpen, chips.length, shown]);

  // 🔴 「＋N」のポップオーバー: 外側クリックと Escape で閉じる（指示書 §7）。
  useEffect(() => {
    if (!overflowOpen) return;
    const onPointerDown = (event: Event): void => {
      const root = overflowRef.current;
      if (root === null) return;
      if (event.target instanceof Node && root.contains(event.target)) return;
      closeOverflow(false);
    };
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return;
      event.stopPropagation();
      closeOverflow(true);
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown, true);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown, true);
    };
  }, [overflowOpen]);


  /**
   * 🔴 **`measuring` のときは `<button>` にしない。**
   *    計測用の行は同じバッジをもう 1 組描くので、そのままだと
   *    **同じ `data-testid` と読み上げの語が 2 つずつ DOM に出る**。
   *    （`visibility: hidden` なので焦点は入らないが、E2E が掘る印を二重にしない。）
   * ⚠️ 幅は `<span>` でも同じ（同じクラス・同じ中身である）。
   */
  const chipBadge = (chip: ProjectSearchChip, inPopover: boolean, measuring = false) => (
    <Badge
      key={chip.key}
      variant="brand"
      className={cn(MULTI_SELECT_BADGE_CLASSES, inPopover ? MULTI_SELECT_BADGE_WIDE_CLASSES : null)}
      title={measuring ? undefined : chip.label}
    >
      <span className={MULTI_SELECT_BADGE_LABEL_CLASSES}>{chip.label}</span>
      {measuring ? (
        <span className={MULTI_SELECT_BADGE_REMOVE_CLASSES}>
          <Icon name="x" size="sm" />
        </span>
      ) : (
        <button
          type="button"
          className={MULTI_SELECT_BADGE_REMOVE_CLASSES}
          aria-label={`${chip.label}${messages.remove}`}
          data-testid={`${testIdPrefix}chip-remove-${chip.key}`}
          onClick={(event) => {
            // 🔴 `<form>` の中に居るので、既定の送信を必ず止める。
            event.preventDefault();
            onRemove(chip.key);
          }}
        >
          <Icon name="x" size="sm" />
        </button>
      )}
    </Badge>
  );

  return (
    <div className={cn(FILTER_SUMMARY_BAR_CLASSES, 'flex-col items-stretch')} data-testid={`${testIdPrefix}summary`}>
      <div className={FILTER_SUMMARY_CHIPS_CLASSES}>
        <span className="shrink-0 text-xs text-fg-muted">{messages.label}</span>
        {chips.length === 0 ? (
          <span className="truncate text-xs text-fg-muted" data-testid={`${testIdPrefix}summary-empty`}>
            {messages.empty}
          </span>
        ) : (
          // 🔴 `relative` は計測用の行（`absolute`）の基準点である。
          <div ref={rowRef} className="relative flex min-w-0 flex-1 items-center gap-2 overflow-hidden">
            {chips.slice(0, shown).map((chip) => chipBadge(chip, false))}
            {hidden.length > 0 ? (
              <div ref={overflowRef} className="relative shrink-0">
                <button
                  ref={overflowTriggerRef}
                  type="button"
                  className={MULTI_SELECT_OVERFLOW_CLASSES}
                  aria-expanded={overflowOpen}
                  aria-controls={panelId}
                  aria-label={messages.overflowLabel}
                  data-testid={`${testIdPrefix}summary-overflow`}
                  onClick={(event) => {
                    event.preventDefault();
                    setOverflowOpen((current) => !current);
                  }}
                >
                  {`+${String(hidden.length)}`}
                </button>
                {overflowOpen ? (
                  // 🔴 **単なるホバー用ツールチップにしない**（指示書 §4）——
                  //    ここから 1 つずつ解除できる。
                  <div
                    id={panelId}
                    className={POPOVER_PANEL_END_CLASSES}
                    data-testid={`${testIdPrefix}summary-overflow-panel`}
                  >
                    <div className={cn(POPOVER_LIST_CLASSES, 'gap-2 p-1')}>
                      {hidden.map((chip) => (
                        <div key={chip.key} className="flex shrink-0 items-center">
                          {chipBadge(chip, true)}
                        </div>
                      ))}
                    </div>
                  </div>
                ) : null}
              </div>
            ) : null}
            {/* 🔴 計測用の行（見えない / 読み上げない / 当たり判定を持たない）。 */}
            <div
              ref={measureRef}
              aria-hidden="true"
              className="pointer-events-none invisible absolute top-0 left-0 flex w-max items-center gap-2"
            >
              {chips.map((chip) => chipBadge(chip, false, true))}
            </div>
          </div>
        )}
      {compact && keywordGroupCount > 0 && onOpenDetails ? <Button type="button" variant="ghost" size="sm" onClick={onOpenDetails} data-testid={`${testIdPrefix}details-summary`}>{t('projects.search.advanced')} ({keywordGroupCount}{t('projects.search.groupCountSuffix')})</Button> : null}
      </div>
      {!compact ? <div className="flex w-full shrink-0 flex-wrap items-center justify-end gap-2">
        {/* 🔴 **未適用**（指示書 §6「検索結果がまだ以前の条件であることを示します」）。 */}
        {pending ? (
          <span
            className="text-xs font-medium text-warning"
            title={messages.pendingHint}
            data-testid={`${testIdPrefix}pending`}
          >
            {messages.pending}
          </span>
        ) : null}
        <Tooltip content={messages.clear}>
          <Button type="button" variant="secondary" size="sm" className="mr-auto" aria-label={messages.clear}
            data-testid={`${testIdPrefix}clear`} onClick={onClear}><Icon name="filter-x" />{t('projects.search.clearAll')}</Button>
        </Tooltip>
        {onCancel ? <Button type="button" variant="secondary" size="sm" onClick={onCancel} data-testid={`${testIdPrefix}cancel-search`}>{t('projects.search.cancel')}</Button> : null}
        <Tooltip content={messages.submit}>
          <Button type="submit" variant="primary" size="sm" aria-label={messages.submit} aria-busy={submitting}
            data-testid={`${testIdPrefix}search`}><Icon name="search" />{t('projects.search.submit')}</Button>
        </Tooltip>
      </div> : null}
    </div>
  );
}
