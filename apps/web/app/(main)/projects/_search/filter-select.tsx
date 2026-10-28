'use client';

// apps/web/app/(main)/projects/_search/filter-select.tsx
// `S-010` の検索条件の**単一選択**（ステータス / カテゴリ / 稼働形態 / 勤務地 / 開始時期）。
//
// ============================================================================
// 🔴 なぜ素の `<select>` をやめたのか
// ============================================================================
// 人間の明示指示（2026-10-19）: 「プルダウンの UI が要素によって異なるから、スキルの
// プルダウンと同じ UI にして」。
//
// 素の `<select>` が開くのは **OS 既定のドロップダウン**であり、行の高さ・選択中の印・
// 角丸・影をこちら側で揃えられない。同じ帯に並ぶスキル欄（`./skill-multi-select.tsx`）は
// 独自のポップオーバーなので、**1 つの検索エリアに 2 種類のプルダウンが混ざっていた**。
//
// 🔴 **この部品は `./skill-multi-select.tsx` の単一選択版である。** 引き金・ポップオーバー・
//    絞り込み欄のクラスは**同じ定数**（`@ses/ui`）を使う —— 見た目を揃えることが目的なので、
//    **ここで寸法・色・影を作り直してはならない**（`UI_GUIDELINES.md` §3 / §5 / §7）。
// 🔴 **引き金の高さは `h-9`（36px）固定**（`MULTI_SELECT_TRIGGER_CLASSES`）。スキル欄と同じ
//    行に並ぶので、ここが 1px でも違うと帯の底が揃わない（スキル欄の「高さが変わらない」
//    という一番の要求は、隣の欄が揃っていて初めて意味を持つ）。
//
// ============================================================================
// 🔴 スキル版との挙動の差は 1 つだけ —— **選んだら閉じる**
// ============================================================================
// 単一選択は**選んだ時点で条件が確定する**ので、閉じて引き金に焦点を戻す。
// 複数選択（スキル）が閉じないのは、続けて 2 つ目・3 つ目を選ぶためである ——
// 単一選択で開いたままにすると「選び終わったのに面が残り、下の欄が隠れている」になる。
//
// ============================================================================
// 🔴🔴 `name` を置かない
// ============================================================================
// `<select name="status">` を `role="combobox"` の `<div>` に替えると、**ネイティブの
// フォーム値が消える**。送信は `./search-panel.tsx` の hidden input が行う（スキル欄と
// まったく同じ扱いである）。🔴 **ここに `name` を置くと同じキーが 2 つ載り、
// `projectListQuerySchema` の `optionalFilter` が壊れる。**
//
// ============================================================================
// 🔴 引き金は `<button>` ではなく `role="combobox"` の `<div>` である
// ============================================================================
// 理由はスキル版の冒頭と同じで、**将来この中に `<button>` を置いてもボタンの入れ子に
// ならない**ためである。`<div>` + `tabIndex=0` + キー操作（Enter / Space / ↓）で、
// `<button>` と同じ操作性を保つ。
//
// ============================================================================
// 🔴 `data-testid` は現行の値をそのまま引き金に付ける（凍結されている）
// ============================================================================
// `project-list-filter-status` は `tests/static/testid-inventory.test.ts` の `FROZEN_EXACT`
// に在り、**ソースから消えると落ちる**。値は呼び出し側（`./search-filter-form.tsx` の
// `` testId={`${testIdPrefix}status`} ``）が組むので、凍結の射程から抜けない。
// 🔴 **`data-testid={testId}`（素の識別子）と書いてはならない。** 抽出器は識別子を
//    静的に解決できず、`apps/web` の「解決できない testid」として穴に数える
//    （`UNRESOLVED_ALLOWLIST` は増やさない方針である）。テンプレートで書けば接頭辞として
//    扱われ、実際の値は上記の呼び出し側で凍結されたままになる。

import { useEffect, useId, useRef, useState } from 'react';
import {
  FOCUS_RING_CLASSES,
  Icon,
  Input,
  MULTI_SELECT_EMPTY_CLASSES,
  MULTI_SELECT_SEARCH_CLASSES,
  MULTI_SELECT_TRIGGER_CLASSES,
  MULTI_SELECT_TRIGGER_OPEN_CLASSES,
  POPOVER_LIST_CLASSES,
  POPOVER_OPTION_CLASSES,
  POPOVER_OPTION_SELECTED_CLASSES,
  POPOVER_PANEL_CLASSES,
  POPOVER_SEARCH_INPUT_CLASSES,
  cn,
} from '@ses/ui';
import type { ProjectSearchOption } from './filters';

/**
 * 絞り込みの検索欄を出す選択肢の件数（「すべて」を含む）。
 *
 * 🔴 **常時表示にしない。** ステータス（3 件）や稼働形態（4 件）の上に検索欄を置くと、
 *    ポップオーバーの上半分が「3 件を絞り込むための欄」になり、**選ぶより読む量が増える**。
 *    一方で勤務地は 48 件あり、欄が無いと 1 件ずつ流して探すことになる。
 * 🔴 **閾値は名前付きの定数で 1 箇所に置く** —— 欄の有無を項目ごとに書き分けると、
 *    「この欄には検索があってこの欄には無い」理由が後から読めなくなる。
 */
export const FILTER_SELECT_SEARCH_THRESHOLD = 12;

export type FilterSelectMessages = {
  readonly searchLabel: string;
  readonly searchPlaceholder: string;
  readonly noMatch: string;
};

export function FilterSelect({
  options,
  value,
  onChange,
  label,
  messages,
  testId,
}: {
  readonly options: readonly ProjectSearchOption[];
  readonly value: string;
  readonly onChange: (next: string) => void;
  /**
   * 引き金の読み上げ名（`各欄のラベル`）。
   * 🔴 見える label は `Field` が持つが、`role="combobox"` には**名前が要る**
   *    （`Field` が `<div>` なので `<label>` では結べない）。
   */
  readonly label: string;
  readonly messages: FilterSelectMessages;
  /** 🔴 引き金の `data-testid`。**現行の凍結値をそのまま受け取る**（ファイル冒頭の 🔴）。 */
  readonly testId: string;
}) {
  const [open, setOpen] = useState(false);
  const [keyword, setKeyword] = useState('');
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const panelId = useId();

  const searchable = options.length >= FILTER_SELECT_SEARCH_THRESHOLD;

  // 🔴 引き金に出すのは**選択中の選択肢のラベル 1 つ**だけである（溢れは `truncate`）。
  // 🔴 選択肢に無い値は「すべて」（`value: ''`）に倒す —— `page.tsx` の Zod が未知の値を
  //    落とすのでここには届かないが、**空の引き金は「壊れている」に見える**
  //    （条件バーも未知の値をバッジにしない。`./filters.ts` の `labelOf`）。
  const selected =
    options.find((option) => option.value === value) ??
    options.find((option) => option.value === '') ??
    null;

  const close = (focusTrigger: boolean): void => {
    setOpen(false);
    setKeyword('');
    // 🔴 閉じたら**元の操作位置へ焦点を戻す**（スキル版と同じ。指示書 §7）。
    if (focusTrigger) triggerRef.current?.focus({ preventScroll: true });
  };

  // 🔴 開いたら検索欄に焦点。**検索欄が無い欄では焦点を動かさない** —— 移す先が無いので
  //    引き金に留め、Tab で一覧に入れる。
  // 🔴 `preventScroll` —— 焦点でページが飛ぶと検索エリアの上端が画面外に出る
  //    （スキル版の 🔴。実測で一覧が上へ飛び、Playwright が「要素が安定しない」と判定した）。
  useEffect(() => {
    if (!open || !searchable) return;
    searchRef.current?.focus({ preventScroll: true });
  }, [open, searchable]);

  // 🔴 外側を押したら閉じる / Escape で閉じる（指示書 §7）。
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
  const listed = options.filter(
    (option) => normalized === '' || option.label.toLowerCase().includes(normalized),
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
        aria-label={label}
        className={cn(
          MULTI_SELECT_TRIGGER_CLASSES,
          FOCUS_RING_CLASSES,
          open ? MULTI_SELECT_TRIGGER_OPEN_CLASSES : null,
        )}
        // 🔴 テンプレートで書く（素の識別子にしない）。理由はファイル冒頭の 🔴。
        data-testid={`${testId}`}
        onClick={() => {
          if (open) close(false);
          else setOpen(true);
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ' ' || event.key === 'ArrowDown') {
            // 🔴 Space / Enter は `<form>` の送信にも割り当たるので、必ず止める。
            event.preventDefault();
            setOpen(true);
          }
        }}
      >
        <span className="min-w-0 flex-1 truncate text-fg">{selected?.label ?? ''}</span>
        <Icon
          name="chevron-down"
          className={cn('shrink-0 text-fg-muted transition-transform', open ? 'rotate-180' : null)}
        />
      </div>

      {open ? (
        <div id={panelId} className={POPOVER_PANEL_CLASSES} data-testid={`${testId}-panel`}>
          {/* 🔴 選択肢が多い欄だけ上部に 32px の絞り込み欄（`FILTER_SELECT_SEARCH_THRESHOLD`）。
              🔴 `name` を持たせない（URL に乗せない）。 */}
          {searchable ? (
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
                data-testid={`${testId}-search`}
                onChange={(event) => {
                  setKeyword(event.currentTarget.value);
                }}
                onKeyDown={(event) => {
                  // 🔴 **ここの Enter で検索を走らせない**（絞る意図の Enter である）。
                  if (event.key === 'Enter') event.preventDefault();
                }}
              />
            </div>
          ) : null}
          {/* 中央: 一覧（1 行 36px / 最大 240px でスクロール）。 */}
          <div className={POPOVER_LIST_CLASSES} role="listbox" aria-label={label}>
            {listed.length === 0 ? (
              <p className={MULTI_SELECT_EMPTY_CLASSES} data-testid={`${testId}-no-match`}>
                {messages.noMatch}
              </p>
            ) : (
              listed.map((option) => {
                const checked = option.value === value;
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
                    data-testid={`${testId}-option-${option.value}`}
                    onClick={() => {
                      onChange(option.value);
                      // 🔴 **単一選択は選んだ時点で条件が確定する**ので閉じて焦点を戻す
                      //    （スキル版は閉じない。ファイル冒頭の 🔴）。
                      close(true);
                    }}
                  >
                    <span className="min-w-0 flex-1 truncate">{option.label}</span>
                    {/* 🔴 選んである行だけ**右端に小さなチェック**（未選択の行に空の箱を置かない）。 */}
                    {checked ? <Icon name="check" size="sm" className="shrink-0" /> : null}
                  </button>
                );
              })
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}
