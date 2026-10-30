'use client';

// apps/web/app/(main)/projects/_search/skill-multi-select.tsx
// `S-010` の検索条件「スキル」（複数選択 / OR）。改修指示書 §3。
//
// ============================================================================
// 🔴🔴 この部品の一番の要求は「**高さが絶対に変わらない**」ことである
// ============================================================================
// 指示書 §3 / §8 の完成条件: 「スキルを増やしても 36px の入力欄が高くならず、＋N が正しい。」
//
// 守り方は 3 段:
//   ① 引き金は `h-9`（36px）**固定**（`MULTI_SELECT_TRIGGER_CLASSES`）。`min-h-*` ではない。
//   ② バッジの列は**折り返さない**（`MULTI_SELECT_BADGE_ROW_CLASSES` の `flex` 既定 = nowrap）。
//   ③ 入りきらない分は**切り落とさず「＋N」にまとめる**（指示書「単に overflow: hidden で
//      隠して、選択された項目が見えなくなる実装は禁止」）。**「＋N」は押せる**（押すと
//      ポップオーバーが「選択中」で開き、省略された項目を確認・解除できる）。
//
// 🔴 **何件見せるかは実幅から決める**（`visibleSkillBadgeCount`）。**器の幅とバッジ 1 つずつの
//    実幅を測って数える**のであって、持ち分の見積もりでも件数の上限でもない
//    （`active-filter-bar.tsx` の `visibleChipCount` と同じ造りである）。
// ✅✅ **2026-10-19: 「基本は最大 2 つ」という上限を撤廃した**（人間の明示指示「スキルの部分は
//    見切れない範囲まではバッジを表示して。見切れる分だけ『＋１』などの表示をして」）。
//    🔴 **改修指示書 §3 の「基本は最大 2 つ」はこの指示が上書きした**（指示書との食い違いは
//    意図である）。それまでは幅 400px 近い欄でも `Java` 1 つ + `＋2` しか出ておらず、
//    **余裕があるのに隠れていた** —— 原因は上限 2 と「バッジ 1 つ = 92px」の決め打ちの 2 つで、
//    実際の `Java` のバッジは 60px 程度である。
//
// ============================================================================
// 🔴 HTML の入れ子（指示書 §3「ボタンの中に別のボタンを入れるなど、不適切な HTML 構造で
//    実装しないでください」）
// ============================================================================
// 引き金は `<button>` ではなく **`role="combobox"` の `<div>`** である。バッジの `×` と「＋N」が
// `<button>` なので、引き金を `<button>` にすると**ボタンの中にボタン**になる。
// `<div>` + `tabIndex=0` + キー操作（Enter / Space / ↓）で、`<button>` と同じ操作性を保つ。
//
// 🔴 **`name="skills"` をここに置かない。** 送信は `search-panel.tsx` の hidden input が行う
//    （本文を折りたたんでも検索できる、という指示書 §4 の要求がそれを強制する）。

import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import {
  Checkbox,
  Badge,
  FOCUS_RING_CLASSES,
  Icon,
  Input,
  MULTI_SELECT_BADGE_CLASSES,
  MULTI_SELECT_BADGE_LABEL_CLASSES,
  MULTI_SELECT_BADGE_REMOVE_CLASSES,
  MULTI_SELECT_BADGE_ROW_CLASSES,
  MULTI_SELECT_EMPTY_CLASSES,
  MULTI_SELECT_OVERFLOW_CLASSES,
  MULTI_SELECT_SEARCH_CLASSES,
  MULTI_SELECT_TRIGGER_CLASSES,
  MULTI_SELECT_TRIGGER_OPEN_CLASSES,
  POPOVER_FOOTER_CLASSES,
  POPOVER_LIST_CLASSES,
  POPOVER_OPTION_CLASSES,
  POPOVER_OPTION_SELECTED_CLASSES,
  POPOVER_PANEL_CLASSES,
  POPOVER_SEARCH_INPUT_CLASSES,
  POPOVER_SEGMENT_CLASSES,
  POPOVER_SEGMENT_ITEM_CLASSES,
  POPOVER_SEGMENT_ITEM_SELECTED_CLASSES,
  SECONDARY_LINK_CLASSES,
  cn,
} from '@ses/ui';
import type { ProjectSearchOption } from './filters';

/**
 * 🔴 **サーバでは `useEffect` に落とす**（`active-filter-bar.tsx` と同じ）。
 *    `useLayoutEffect` をサーバで呼ぶと React が警告を出すが、ここでは
 *    **描画の前に測る**ことが目的であり、サーバには測るものが無い。
 */
const useIsomorphicLayoutEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect;

// ============================================================================
// 🔴 「何件のバッジが入るか」の算数（**ここだけが見た目の幅を知っている**）
// ============================================================================
// 🔴 **px を直接書く唯一の場所である。** CSS に書けない（入る個数は中身の語長で変わる）ので、
//    **1 つの純粋関数に閉じてユニットテストで固定する**（`filters.render.test.tsx`）。
// 🔴 **バッジ 1 つぶんの幅をここで見積もらない。** 語長はばらばら（`Java` と
//    `Spring Framework`）で、決め打ちにすると**余裕があるのに「＋N」になる**（ファイル冒頭の
//    ✅✅）。幅は呼び出し側が**計測用の行で実測して配列で渡す**。

/** 「＋N」の持ち分（この幅を先に確保してから、何個入るかを数える）。 */
const OVERFLOW_SLOT_PX = 52;
/** バッジ同士の間隔（`MULTI_SELECT_BADGE_ROW_CLASSES` の `gap-1` = 4px）。 */
const BADGE_GAP_PX = 4;
/**
 * 欄の内側（左右の padding `px-3`）+ 右端の `chevron`（16px）+ その手前の間隔（`gap-2`）。
 *
 * 🔴 **`visibleChipCount` との唯一の違いがこれである。** 条件バーはバッジの器そのものを
 *    測れるが、ここで測れるのは**引き金の外形**なので、バッジが使えない分を引く。
 */
const FRAME_PX = 24 + 16 + 8;

/**
 * 引き金に出すバッジの数。
 *
 * 🔴🔴 **「入るだけ入れる」である**（2026-10-19 の人間の指示。ファイル冒頭の ✅✅）。
 *    **件数の上限を持たない** —— 旧実装の `SKILL_BADGE_MAX = 2` は撤廃した。
 * 🔴 **まだ測っていない（`null`）ときは全件返す** —— サーバ描画と水和直後の見た目を
 *    一致させる（`useLayoutEffect` で**描画の前に**確定するので、減るとしても画面には出ない）。
 * 🔴 **戻り値が `0` のときは呼び出し側が「N 件選択」に切り替える**（指示書「非常に狭くて
 *    1 つも収まらない場合は『5 件選択』のような表示」）。
 * 🔴 **「＋0」を出さない**（最後に 1 つ減らす）。
 */
export function visibleSkillBadgeCount(
  fieldWidth: number | null,
  badgeWidths: readonly number[],
): number {
  if (badgeWidths.length === 0) return 0;
  if (fieldWidth === null) return badgeWidths.length;
  const room = fieldWidth - FRAME_PX;
  // 🔴 まず「全部入るか」を見る（入るなら「＋N」の幅を取らない）。
  const total =
    badgeWidths.reduce((sum, width) => sum + width, 0) + BADGE_GAP_PX * (badgeWidths.length - 1);
  if (total <= room) return badgeWidths.length;
  const roomWithOverflow = room - OVERFLOW_SLOT_PX - BADGE_GAP_PX;
  let used = 0;
  let count = 0;
  for (const width of badgeWidths) {
    const next = used === 0 ? width : used + BADGE_GAP_PX + width;
    if (next > roomWithOverflow) break;
    used = next;
    count += 1;
  }
  // 🔴 **全部入ってしまったら 1 つ減らす** —— 上で「全部は入らない」と判っているので、
  //    ここで全件になるのは「＋N」の幅を引いた結果の端数であり、`＋0` を出さない。
  return count >= badgeWidths.length ? badgeWidths.length - 1 : count;
}

/** ポップオーバーの中の 2 面（指示書 §3「『すべて』『選択中 N』の小さな切り替え」）。 */
type SkillPopoverMode = 'ALL' | 'SELECTED';

export type SkillMultiSelectMessages = {
  /** 未選択のときの引き金の語（指示書「未選択 →『スキルを選択』」）。 */
  readonly placeholder: string;
  /** `×` の読み上げ（`${label}${remove}` で「Python を解除」になる）。 */
  readonly remove: string;
  /** 「＋N」の読み上げ（省略された分を開く）。 */
  readonly overflowLabel: string;
  /** 1 つも入らないときの表示（`${count}${selectedCountSuffix}` = `5 件選択`）。 */
  readonly selectedCountSuffix: string;
  readonly searchLabel: string;
  readonly searchPlaceholder: string;
  readonly modeAll: string;
  readonly modeSelected: string;
  readonly noMatch: string;
  /**
   * 下部の「N 件選択中」の後ろ半。
   * 🔴🔴 **関数ではなく文字列で持つ**（RSC の境界を関数は越えられない）。
   */
  readonly selectedSummarySuffix: string;
  readonly clearSelection: string;
  /** 引き金の読み上げ名（ラベルは `Field` が持つが、combobox には名前が要る）。 */
  readonly triggerLabel: string;
};

export function SkillMultiSelect({
  options,
  values,
  onChange,
  messages,
  testIdPrefix,
  checklist = false,
  topHint,
}: {
  readonly checklist?: boolean;
  readonly topHint?: string;
  readonly options: readonly ProjectSearchOption[];
  readonly values: readonly string[];
  readonly onChange: (next: readonly string[]) => void;
  readonly messages: SkillMultiSelectMessages;
  readonly testIdPrefix: string;
}) {
  const [open, setOpen] = useState(false);
  const [placement, setPlacement] = useState<{ left: number; top: number; maxHeight: number } | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const [mode, setMode] = useState<SkillPopoverMode>('ALL');
  const [keyword, setKeyword] = useState('');
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLDivElement>(null);
  const measureRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const panelId = useId();
  const [visible, setVisible] = useState<number | null>(null);

  useIsomorphicLayoutEffect(() => {
    if (!open) return;
    const position = (): void => {
      const rect = triggerRef.current?.getBoundingClientRect(); const panel = panelRef.current;
      if (!rect || !panel) return;
      const maxHeight = Math.max(0, window.innerHeight - 32);
      const width = Math.min(panel.offsetWidth, window.innerWidth - 32);
      const height = Math.min(panel.offsetHeight, maxHeight);
      const desiredLeft = Math.max(16, Math.min(rect.left, window.innerWidth - 16 - width));
      const availableBelow = window.innerHeight - rect.bottom;
      const preferredTop = availableBelow >= height + 4 ? rect.bottom + 4 : rect.top - height - 4;
      const desiredTop = Math.max(16, Math.min(preferredTop, window.innerHeight - 16 - height));
      const next = { left: desiredLeft - rect.left, top: desiredTop - rect.top, maxHeight };
      setPlacement(current => current?.left === next.left && current.top === next.top && current.maxHeight === maxHeight ? current : next);
    };
    position(); const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(position); if (panelRef.current) observer?.observe(panelRef.current);
    window.addEventListener('resize', position); window.addEventListener('scroll', position, true);
    return () => { observer?.disconnect(); window.removeEventListener('resize', position); window.removeEventListener('scroll', position, true); };
  }, [open]);

  // 🔴 **並びは辞書の順のまま**（指示書「選択するたびに行順を並べ替えて、クリック対象を
  //    移動させないでください」）。選んだ順にしない。
  const selected = options.filter((option) => values.includes(option.value));
  // 🔴 測り直しの引き金は**選んだ中身**である（配列の同一性ではない）—— `selected` は毎描画で
  //    作り直されるので、そのまま依存に置くと描画ごとに `ResizeObserver` を張り替える。
  const selectedKey = selected.map((option) => option.value).join(',');

  // 🔴 **描画の前に測る**（`useLayoutEffect`）—— 1 フレームだけ全バッジが出てから減る、を避ける。
  useIsomorphicLayoutEffect(() => {
    const trigger = triggerRef.current;
    const measure = measureRef.current;
    if (trigger === null || measure === null) return;
    const recount = (): void => {
      const widths = Array.from(measure.children).map((child) =>
        child instanceof HTMLElement ? child.offsetWidth : 0,
      );
      // 🔴 器は**引き金の外形**なので `FRAME_PX` を引くのは `visibleSkillBadgeCount` の側。
      setVisible(visibleSkillBadgeCount(trigger.clientWidth, widths));
    };
    recount();
    if (typeof ResizeObserver === 'undefined') return;
    // 🔴 引き金の幅は副カラムの並置や段組みの切り替えで変わる（ビューポート幅では決まらない）。
    const observer = new ResizeObserver(recount);
    observer.observe(trigger);
    return () => {
      observer.disconnect();
    };
  }, [selectedKey]);

  const visibleCount = visible === null ? selected.length : Math.min(visible, selected.length);
  const hiddenCount = selected.length - visibleCount;

  const openWith = (next: SkillPopoverMode): void => {
    setMode(next);
    setOpen(true);
  };

  const close = (focusTrigger: boolean): void => {
    setOpen(false);
    setKeyword('');
    // 🔴 閉じたら**元の操作位置へ焦点を戻す**（指示書 §7）。
    if (focusTrigger) triggerRef.current?.focus({ preventScroll: true });
  };

  // 🔴 開いたら検索欄に焦点（指示書 §3 の上部の欄はそのために在る）。
  // 🔴 `preventScroll` —— 焦点でページが飛ぶと、絞り込みの帯の上端が画面外に出る。
  useEffect(() => {
    if (!open) return;
    searchRef.current?.focus({ preventScroll: true });
  }, [open]);

  // 🔴 外側を押したら閉じる / Escape で閉じる（指示書 §7「Escape で最前面のポップオーバーを
  //    閉じ、元の操作位置へフォーカスを戻します」）。
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: Event): void => {
      const root = rootRef.current;
      if (root === null) return;
      if (event.target instanceof Node && root.contains(event.target)) return;
      setOpen(false);
      setKeyword('');
    };
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return;
      // 🔴 **最前面のポップオーバーだけを閉じる**（親の折りたたみまで巻き込まない）。
      event.stopPropagation();
      close(true);
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown, true);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown, true);
    };
  }, [open]);

  const normalized = keyword.trim().toLowerCase();
  // 🔴 **「選択中」で絞っても、選択そのものは変えない**（指示書「文字検索で候補を絞っても、
  //    検索結果から隠れた選択済みスキルは解除しません」）。見せ方だけの切り替えである。
  const listed = options.filter((option) => {
    if (mode === 'SELECTED' && !values.includes(option.value)) return false;
    return normalized === '' || option.label.toLowerCase().includes(normalized);
  });

  const toggle = (value: string): void => {
    onChange(
      values.includes(value) ? values.filter((id) => id !== value) : [...values, value],
    );
  };

  /**
   * 🔴 **`measuring` のときは `data-testid` と `aria-label` と `title` を出さない。**
   *    計測用の行は同じバッジをもう 1 組描くので、そのままだと**同じ印と読み上げの語が
   *    2 つずつ DOM に出る**（`active-filter-bar.tsx` の `chipBadge` と同じ対処）。
   * 🔴 **`×` も `<button>` にしない** —— 押せる `×` が 2 つになる。
   * ⚠️ 幅は `<span>` でも同じ（同じクラス・同じ中身である）。
   */
  const skillBadge = (option: ProjectSearchOption, measuring = false) => (
    <Badge
      key={option.value}
      variant="brand"
      className={MULTI_SELECT_BADGE_CLASSES}
      // 🔴 **全文はホバーで読める**（指示書「長いスキル名はバッジ内で省略し、
      //    ホバーまたはキーボード操作で全文を確認できるようにします」）。
      title={measuring ? undefined : option.label}
    >
      <span className={MULTI_SELECT_BADGE_LABEL_CLASSES}>{option.shortLabel ?? option.label}</span>
      {measuring ? (
        <span className={MULTI_SELECT_BADGE_REMOVE_CLASSES}>
          <Icon name="x" size="sm" />
        </span>
      ) : (
        <button
          type="button"
          className={MULTI_SELECT_BADGE_REMOVE_CLASSES}
          // 🔴 **「Python を解除」と読み上げられる**（指示書 §7）。全文がここに入るので、
          //    キーボードだけでも省略された語を確認できる。
          aria-label={`${option.label}${messages.remove}`}
          data-testid={`${testIdPrefix}skill-remove-${option.value}`}
          onClick={(event) => {
            // 🔴 **親の開閉と `<form>` の送信を誤発火させない**（指示書 §3）。
            event.preventDefault();
            event.stopPropagation();
            onChange(values.filter((id) => id !== option.value));
          }}
        >
          <Icon name="x" size="sm" />
        </button>
      )}
    </Badge>
  );

  return (
    <div ref={rootRef} className="relative">
      {/* 🔴 引き金。`role="combobox"` の `<div>` である理由はファイル冒頭の 🔴。 */}
      <div
        ref={triggerRef}
        role="combobox"
        tabIndex={0}
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-controls={panelId}
        aria-label={messages.triggerLabel}
        className={cn(
          MULTI_SELECT_TRIGGER_CLASSES,
          FOCUS_RING_CLASSES,
          open ? MULTI_SELECT_TRIGGER_OPEN_CLASSES : null,
        )}
        data-testid={`${testIdPrefix}skills`}
        onClick={() => {
          if (open) close(false);
          else openWith('ALL');
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ' ' || event.key === 'ArrowDown') {
            // 🔴 Space / Enter は `<form>` の送信にも割り当たるので、必ず止める。
            event.preventDefault();
            openWith('ALL');
          }
        }}
      >
        {/* 🔴 `relative` は計測用の行（`absolute`）の基準点である。**`relative` をここに置く
            ことが、計測用の行が `overflow-hidden` に掛かる条件でもある** ——
            絶対配置の要素を切るのは「その包含ブロックになっている箱」の `overflow` だけで、
            基準点が外（根の `relative`）にあると**`w-max` の全幅がページの横スクロールに載る**
            （バッジ 20 件で 2,600px 以上。指示書 §4「横スクロールを出さないでください」）。 */}
        <span className={cn(MULTI_SELECT_BADGE_ROW_CLASSES, 'relative')}>
          {selected.length === 0 ? (
            <span className="text-fg-placeholder">{messages.placeholder}</span>
          ) : visibleCount === 0 ? (
            // 🔴 1 つも収まらない幅（指示書「『5 件選択』のような表示に切り替えます」）。
            <span className="truncate text-fg">
              {`${String(selected.length)}${messages.selectedCountSuffix}`}
            </span>
          ) : (
            selected.slice(0, visibleCount).map((option) => skillBadge(option))
          )}
          {hiddenCount > 0 && visibleCount > 0 ? (
            <button
              type="button"
              className={MULTI_SELECT_OVERFLOW_CLASSES}
              aria-label={messages.overflowLabel}
              data-testid={`${testIdPrefix}skills-overflow`}
              onClick={(event) => {
                event.preventDefault();
                event.stopPropagation();
                // 🔴 **「＋N」から開いたら「選択中」を出す**（指示書 §3）——
                //    省略された項目をその場で確認・解除できる。
                openWith('SELECTED');
              }}
            >
              {`+${String(hiddenCount)}`}
            </button>
          ) : null}
          {/* ==================================================================
              🔴 計測用の行（見えない / 読み上げない / 当たり判定を持たない）
              ==================================================================
              🔴 **ここは `visibleCount` を見ない** —— いつでも**選択中の全件**を描く。
                 本物の行の内容が減ってもこの行は変わらないので、「隠す → 幅が変わる →
                 数え直す」の無限ループにならない。
              🔴 **`gap-1` は本物の行と同じでなければならない**（`BADGE_GAP_PX` と対で
                 ある。片方だけ変えると数が合わなくなる）。 */}
          <div
            ref={measureRef}
            aria-hidden="true"
            className="pointer-events-none invisible absolute top-0 left-0 flex w-max items-center gap-1"
          >
            {selected.map((option) => skillBadge(option, true))}
          </div>
        </span>
        <Icon
          name="chevron-down"
          className={cn('shrink-0 text-fg-muted transition-transform', open ? 'rotate-180' : null)}
        />
      </div>

      {open ? (
        <div
          id={panelId}
          ref={panelRef}
          className={POPOVER_PANEL_CLASSES}
          style={placement ? { ...placement, right: 'auto', marginTop: 0 } : undefined}
          data-testid={`${testIdPrefix}skills-panel`}
        >
          {/* 上部: 32px の検索欄（指示書 §3）。🔴 `name` を持たせない（URL に乗せない）。 */}
          <div className={MULTI_SELECT_SEARCH_CLASSES}>
            <Icon
              name="search"
              className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-fg-muted"
            />
            <Input
              ref={searchRef}
              type="search"
              className={POPOVER_SEARCH_INPUT_CLASSES}
              value={keyword}
              aria-label={messages.searchLabel}
              placeholder={messages.searchPlaceholder}
              data-testid={`${testIdPrefix}skills-search`}
              onChange={(event) => {
                setKeyword(event.currentTarget.value);
              }}
              onKeyDown={(event) => {
                // 🔴 **ここの Enter で検索を走らせない**（絞る意図の Enter である）。
                if (event.key === 'Enter') event.preventDefault();
                if (event.key === 'ArrowDown') { event.preventDefault(); panelRef.current?.querySelector<HTMLButtonElement>('[role=option]')?.focus(); }
              }}
            />
          </div>
          {/* その下: 「すべて」「選択中 N」（指示書 §3）。 */}
          <div className={POPOVER_SEGMENT_CLASSES} role="group" aria-label={messages.triggerLabel}>
            {(['ALL', 'SELECTED'] as const).map((item) => (
              <button
                key={item}
                type="button"
                aria-pressed={mode === item}
                className={cn(
                  POPOVER_SEGMENT_ITEM_CLASSES,
                  mode === item ? POPOVER_SEGMENT_ITEM_SELECTED_CLASSES : null,
                )}
                data-testid={`${testIdPrefix}skills-mode-${item.toLowerCase()}`}
                onClick={() => {
                  setMode(item);
                }}
              >
                {item === 'ALL'
                  ? messages.modeAll
                  : `${messages.modeSelected} ${String(values.length)}`}
              </button>
            ))}
          </div>
          {/* 中央: 一覧（1 行 36px / 最大 240px でスクロール）。 */}
          {topHint ? <p className="m-0 px-3 py-2 text-xs text-fg-muted">{topHint}</p> : null}
          <div className={POPOVER_LIST_CLASSES} role="listbox" aria-multiselectable="true" onKeyDown={event => {
            if (!['ArrowDown','ArrowUp','Home','End'].includes(event.key)) return;
            const items = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('[role=option]'));
            if (!items.length) return;
            event.preventDefault();
            const current = items.indexOf(document.activeElement as HTMLButtonElement);
            const index = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : (current + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
            items[index]?.focus();
          }}>
            {listed.length === 0 ? (
              <p className={MULTI_SELECT_EMPTY_CLASSES} data-testid={`${testIdPrefix}skills-no-match`}>
                {messages.noMatch}
              </p>
            ) : (
              listed.map((option) => {
                const checked = values.includes(option.value);
                return (
                  <button
                    key={option.value}
                    type="button"
                    role="option"
                    aria-selected={checked}
                    className={cn(
                      POPOVER_OPTION_CLASSES,
                      checked ? POPOVER_OPTION_SELECTED_CLASSES : null,
                    )}
                    data-testid={`${testIdPrefix}skills-option-${option.value}`}
                    onClick={() => {
                      // 🔴 **複数選択してもポップオーバーは閉じない**（指示書 §3）。
                      toggle(option.value);
                    }}
                  >
                    <>{checklist ? <Checkbox checked={checked} readOnly tabIndex={-1} aria-hidden className="pointer-events-none" /> : null}<span className="min-w-0 flex-1 truncate">{option.label}</span></>
                    {/* 🔴 選んである行だけ**右端に小さなチェック**（未選択の行に空の箱を置かない）。 */}
                    {checked && !checklist ? <Icon name="check" size="sm" className="shrink-0" /> : null}
                  </button>
                );
              })
            )}
          </div>
          {/* 下部: 「N 件選択中」と「選択をクリア」（指示書 §3）。 */}
          <div className={POPOVER_FOOTER_CLASSES}>
            <span data-testid={`${testIdPrefix}skills-count`}>
              {`${String(values.length)}${messages.selectedSummarySuffix}`}
            </span>
            <button
              type="button"
              className={cn(SECONDARY_LINK_CLASSES, FOCUS_RING_CLASSES)}
              data-testid={`${testIdPrefix}skills-clear`}
              onClick={() => {
                onChange([]);
              }}
            >
              {messages.clearSelection}
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
