'use client';
// packages/ui/src/components/tabs.tsx
// 🔴 `docs/04` §5-13 の `Tabs`: **同一対象の面の切替。** 実装は `@radix-ui/react-tabs`。
//
// ============================================================================
// 🔴 §5-13 / §10.3 の 2 つの規約を、どう守ったか
// ============================================================================
// **① 🔴 5 つ以上に増やさない**（§10.3: 「タブを 5 つ以上に増やさない。増えるならフィルタか
//    セクションに置き換える」）。**「5 つ以上」= 5 も含む**ので上限は **4** である
//    （`TABS_MAX_ITEMS`）。守り方は 2 段:
//
//   - **型**（第一の壁）: `items` は 1〜4 要素の**タプルの合併**（`TabsItems`）。5 個目を
//     書いた時点でコンパイルが通らない。
//   - **実行時**（第二の壁）: 配列を `TabsItems` へキャストして迂回した場合に備え、
//     `Tabs` が `TABS_MAX_ITEMS` を超えた入力で `Error` を投げる。🔴 **黙って 5 件目を
//     描かない** —— 描いてしまえば規約は「気をつける」に戻る（`CLAUDE.md` §4.2 の
//     「サイレントに無視しない」と同じ立て方）。
//
//   ⚠️ **管理平面の横並びタブ 5 グループ（`docs/04` §3.3）は本部品ではない。** あちらは
//      **ナビゲーション**（`apps/web/app/admin/_components/console-nav.tsx`。`A-001`〜`A-014` への
//      遷移）であり、§10.3 の「同一対象の面の切替」ではない。**本部品を管理平面のナビに
//      流用しない**（流用すると 5 件目で落ちるが、落ちること自体が「別物である」という設計の
//      表明である）。
//
// **② 🔴 状態の絞り込みをタブで表現しない**（§5-13 / `S-019`）。提案の状態は 14 あり、それを
//    タブにすると①の上限と衝突するだけでなく、**URL に載るのがタブの選択なのかフィルタなのかが
//    画面ごとに分かれる**。絞り込みは `Toolbar`（`T-22-04`）のフィルタで表す。
//    ⚠️ これは**値を渡す側の規約**であり型では守れない（`label` は任意の文字列である）。
//    したがって上限 4 を型で締め、残りは呼び出し側のレビューに委ねる。
//
// 🔴 **キーボード操作（←→ / Home / End）と `role="tablist"` / `aria-selected` を自作しない**
//    （§5-13 / §7 の既定採用理由の表）。Radix が持つ。
// 🔴 **`focus-visible` のリングは `FOCUS_RING_CLASSES` と同一**（§7.10）。
// 🔴 **selected は `SELECTED_CLASSES` を使わない** —— あれは「背景 `--color-brand-bg` + 文字
//    `--color-brand` + **左端 2px**」であり、**縦に並ぶもの**（現在地のナビ / 行選択）の形である。
//    横に並ぶタブで左端に線を引くと「1 つ目のタブの左だけに線がある」形になって意味が読めない。
//    §7.10 の selected の本旨（**hover と別の、維持される見え方**）を、横並びに合わせて
//    **下端 2px + 文字 `--color-brand`** で表す（色は同じ semantic トークンである）。
// 🔴 **文言を持たない**（`../index.ts` 規約 5）。`label` は呼び出し側が `packages/i18n` から渡す。
import * as TabsPrimitive from '@radix-ui/react-tabs';
import type { ReactNode } from 'react';
import { cn } from '../lib/cn.js';
import { DISABLED_CLASSES, FOCUS_RING_CLASSES, TRANSITION_CLASSES } from '../lib/state-classes.js';

/** 🔴 §10.3「タブを 5 つ以上に増やさない」= 上限 4（ファイル冒頭①）。 */
export const TABS_MAX_ITEMS = 4;

export type TabsItem = {
  /** URL / 状態に載る値。**一意**であること。 */
  readonly value: string;
  /** タブの語（`packages/i18n`）。 */
  readonly label: string;
  /** その面の中身。 */
  readonly content: ReactNode;
};

/**
 * 🔴 **1〜4 要素のタプルの合併**（`TABS_MAX_ITEMS` = 4）。
 *    配列型（`readonly TabsItem[]`）にすると上限が型で表せない。
 */
export type TabsItems =
  | readonly [TabsItem]
  | readonly [TabsItem, TabsItem]
  | readonly [TabsItem, TabsItem, TabsItem]
  | readonly [TabsItem, TabsItem, TabsItem, TabsItem];

export type TabsProps = {
  readonly items: TabsItems;
  /** 制御する場合の選択値（サーバコンポーネントからは渡せないので `defaultValue` を使う）。 */
  readonly value?: string;
  readonly onValueChange?: (value: string) => void;
  /** 非制御の初期値。省略時は 1 つ目。 */
  readonly defaultValue?: string;
  /** タブ帯の読み上げ名（`packages/i18n`。`aria-label`）。 */
  readonly label: string;
  readonly className?: string;
  readonly 'data-testid'?: string;
};

export function Tabs({
  items,
  value,
  onValueChange,
  defaultValue,
  label,
  className,
  ...passThrough
}: TabsProps) {
  // 🔴 第二の壁（ファイル冒頭①）。キャストで型の壁を越えた入力を黙って描かない。
  if (items.length > TABS_MAX_ITEMS) {
    // ⚠️ メッセージは **`new Error(…)` の直接の引数である 1 つのテンプレート**にする ——
    //    `+` で連結すると `tests/static/no-hardcoded-copy.test.ts` ④ の例外
    //    （`new XxxError('…')` の**直接の**引数）から外れ、開発者向けの例外文が
    //    「ビューへの日本語直書き」として検出される（同テストの `isErrorConstructorArgument`）。
    throw new Error(
      `Tabs: タブは ${String(TABS_MAX_ITEMS)} つまでです（docs/04 §10.3「タブを 5 つ以上に増やさない」）。${String(items.length)} 件渡されました。増えるならフィルタかセクションに置き換えてください。`,
    );
  }
  const first = items[0];
  return (
    <TabsPrimitive.Root
      className={cn('flex flex-col gap-4', className)}
      value={value}
      onValueChange={onValueChange}
      defaultValue={value === undefined ? (defaultValue ?? first.value) : undefined}
      {...passThrough}
    >
      <TabsPrimitive.List className={TABS_LIST_CLASSES} aria-label={label}>
        {items.map((item) => (
          <TabsPrimitive.Trigger key={item.value} value={item.value} className={TABS_TRIGGER_CLASSES}>
            {item.label}
          </TabsPrimitive.Trigger>
        ))}
      </TabsPrimitive.List>
      {items.map((item) => (
        <TabsPrimitive.Content key={item.value} value={item.value}>
          {item.content}
        </TabsPrimitive.Content>
      ))}
    </TabsPrimitive.Root>
  );
}

/**
 * タブ帯。
 * 🔴 **下端の 1px で帯を閉じる**（§7.9「階層は border と background の差で表す」。影を使わない）。
 */
export const TABS_LIST_CLASSES = 'flex items-stretch gap-4 border-b border-border';

/**
 * タブ 1 つ。§7.10 の 8 状態のうち **default / hover / active / selected / focus-visible /
 * disabled** を取る（`loading` / `error` は面の側の状態であり、タブは持たない）。
 *
 * 🔴 **selected は下端 2px + 文字 `--color-brand`**（ファイル冒頭の 🔴）。hover は背景 1 段暗く
 *    （`--color-bg-subtle`）で、**selected と別の見え方**にする（§7.10）。
 * 🔴 **`transform` を遷移させない**（§7.9）。`TRANSITION_CLASSES` は色だけを遷移させる。
 * ⚠️ 選択されていないタブにも `border-b-2`（透明）を置く —— 置かないと選択が切り替わるたびに
 *    2px 分だけ帯の高さが動き、**50 行の一覧の上でタブが波打つ**（§7.10 の「1px も動かさない」）。
 */
export const TABS_TRIGGER_CLASSES = cn(
  'cursor-pointer border-b-2 border-b-transparent px-3 py-2 text-body font-medium text-fg-muted',
  TRANSITION_CLASSES,
  'hover:bg-bg-subtle',
  'data-[state=active]:border-b-brand data-[state=active]:text-brand',
  DISABLED_CLASSES,
  FOCUS_RING_CLASSES,
);
