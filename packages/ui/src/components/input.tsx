// packages/ui/src/components/input.tsx
// shadcn/ui の `Input` を取り込み（docs/03 §2「UI」/ CLAUDE.md §2.1）。SP-21 T-21-02。
// 🔴 基底クラスの upstream との突き合わせは `../lib/control-classes.ts` に 1 語ずつ書いてある。
//    ここに書くのは **`Input` 固有の差分だけ**である。
//
// | upstream の語 | ここ | 判断と理由 |
// |---|---|---|
// | `h-9` `py-1` | `h-10` `py-1` | 高さの理由は `CONTROL_FIELD_SIZE_CLASSES` 参照 |
// | `file:inline-flex` `file:h-7` `file:border-0` `file:bg-transparent` `file:font-medium` | 同じ | **落とさない。** `S-008`（スキルシート取込）が `<input type="file">` を持つ |
// | `file:text-sm` | **`file:text-body`**（実寸は同じ 14px） | T-22-01。`docs/04` §7.9 の 6 トークンで参照する（`text-sm` を直接書かない） |
// | `file:text-foreground` | **`file:text-fg`** | テーマ変数が無いため T-21-02 は実色（`file:text-slate-900`）に置換した。T-22-01 で §7.9 の `--color-fg`（同値）を指す形にした |
// | `type` を明示的に取り出して `<input type={type}>` へ渡す | 取り込まない | `{...props}` で同じ結果になる（upstream の書き方は `data-slot` の位置合わせのため） |
//
// 🔴 **チェックボックス / ラジオにこのコンポーネントを使わない。** `w-full` と `h-10` が
//    押下領域を帯の幅いっぱいに広げ、旧 `globals.css` の
//    `.ses-field input[type='checkbox'] { width: auto }`（T-06-04 が「伸びると押下領域が
//    帯全体になり誤操作を招く」として入れた例外）が防いでいた誤操作を再発させる。
//    必要になったら `Checkbox` を別のプリミティブとして足すこと。
import type { ComponentProps, ReactNode } from 'react';
import { cn } from '../lib/cn.js';
import { CONTROL_BASE_CLASSES, CONTROL_FIELD_SIZE_CLASSES } from '../lib/control-classes.js';
import { FOCUS_RING_CLASSES, TRANSITION_CLASSES } from '../lib/state-classes.js';

export type InputProps = ComponentProps<'input'>;

export function Input({ className, ...props }: InputProps) {
  return (
    <input
      className={cn(
        CONTROL_BASE_CLASSES,
        CONTROL_FIELD_SIZE_CLASSES,
        'file:inline-flex file:h-7 file:border-0 file:bg-transparent file:text-body file:font-medium file:text-fg',
        className,
      )}
      {...props}
    />
  );
}

// ============================================================================
// 🔴 `SearchInput` — 一覧の検索欄（SP-22 `T-22-04`。`docs/04` §5-13）
// ============================================================================
// 🔴 **`Input` のバリアントとして実装し、別部品（`search-input.tsx`）を起こさない**（§5-13 の 🔴。
//    機械検査は `tests/static/ui-primitive-single-impl.test.ts` (b)④ がファイルの不在を見る）。
// 🔴 **`Enter` を押さないと検索されない形にしない**（§5-13）——
//    一覧の絞り込みは連続操作であり、1 文字ごとに結果が動くのが前提である。したがって
//    **入力のたびにデバウンスして通知する**（`<form>` の submit を待たない）。
//
// ============================================================================
// 🔴 なぜこのファイルに `'use client'` を書かないのか（**読み違えないこと**）
// ============================================================================
// `docs/05` §2.3.1 は `SearchInput` を **`@ses/ui/client`**（`../index.client.ts`）に置くと定めており、
// **置き場所は従っている**。一方でこのファイルには `'use client'` を**書けない**:
//
//   🔴 **同じファイルに `Input` が在る。** `Input` は 20 画面以上のサーバコンポーネントが描いており、
//      ここに `'use client'` を付けると**それらが丸ごとクライアントバンドルへ移る**
//      （`../index.ts` の共通規約 4 / `tests/static/ui-overlay-contract.test.ts` が
//      宣言のあるファイルの集合を overlay 6 部品に凍結している）。
//   🔴 **書かなくても壊れない。** 境界を宣言するのは**取り込む側**である ——
//      `@ses/ui/client` を import する画面は自身が `'use client'` を宣言していなければならず
//      （検査 (i)⑤）、`SearchInput` は `onSearchChange`（関数）を要求するので
//      **サーバコンポーネントからは構造的に渡せない。**
//   🔴 **だからフックを使わない。** デバウンスの状態は **DOM 要素をキーにした `WeakMap`** に持つ
//      （`useRef` を import すると、`Input` を描くサーバ側の経路にフックが混ざる）。
//      要素ごとに 1 つのタイマーが持てれば足り、再描画をまたいでも失われない。
//
// ============================================================================
// 🔴 アイコンは呼び出し側から受ける（`IconButton` と同じ判断。`./button.tsx` の 🔴）
// ============================================================================
// `search` アイコンとクリアのアイコンは `lucide-react`（**`T-22-05`**）であり、本タスクでは依存を
// 足さない。したがって `icon` / `clearIcon` を `ReactNode` で受け、**渡されなければ描かない**。
// 🔴 **クリアのボタンはアイコンが渡されたときだけ描く** —— 見えない当たり判定を置かないため
//    （`aria-label` だけあって絵の無いボタンは、触端末で「押せる場所」が分からない）。
//    ⚠️ **デバウンスは今日から効く**（`Enter` を要求しない定めは `T-22-04` の時点で満たしている）。

/** デバウンスの既定（ms）。連続入力が止まってから検索する。 */
export const SEARCH_INPUT_DEBOUNCE_MS = 300;

/**
 * 🔴 デバウンスのタイマーを**入力要素ごと**に持つ（フックを使わない理由は上の 🔴）。
 *    `WeakMap` なので要素が捨てられればタイマーの参照も消える。
 */
const searchDebounceTimers = new WeakMap<HTMLInputElement, ReturnType<typeof setTimeout>>();

function scheduleSearch(element: HTMLInputElement, delayMs: number, notify: (value: string) => void): void {
  const pending = searchDebounceTimers.get(element);
  if (pending !== undefined) clearTimeout(pending);
  searchDebounceTimers.set(
    element,
    setTimeout(() => {
      searchDebounceTimers.delete(element);
      notify(element.value);
    }, delayMs),
  );
}

export type SearchInputProps = {
  /** 初期値（🔴 非制御。制御にすると 1 文字ごとの再描画で 50 行の一覧が毎回描き直される）。 */
  readonly defaultValue?: string;
  /** 🔴 **必須**（テキストのラベルを持たない検索欄には語が要る）。語は呼び出し側が渡す。 */
  readonly 'aria-label': string;
  readonly placeholder?: string;
  readonly name?: string;
  /** デバウンス後に呼ばれる。🔴 `Enter` を待たない（§5-13）。 */
  readonly onSearchChange: (value: string) => void;
  readonly debounceMs?: number;
  /** 先頭の `search` アイコン（`T-22-05`）。🔴 ここで `lucide-react` を import しない。 */
  readonly icon?: ReactNode;
  /** クリアのアイコン（`T-22-05`）。🔴 渡されたときだけクリアのボタンを描く。 */
  readonly clearIcon?: ReactNode;
  /** クリアのボタンの `aria-label`（`clearIcon` を渡すなら必須）。 */
  readonly clearLabel?: string;
  /** testid の接頭辞（例 `engineer-list-`）。🔴 部品はローカルで値を作らない。 */
  readonly testIdPrefix: string;
  readonly className?: string;
};

export function SearchInput({
  defaultValue,
  'aria-label': ariaLabel,
  placeholder,
  name,
  onSearchChange,
  debounceMs = SEARCH_INPUT_DEBOUNCE_MS,
  icon,
  clearIcon,
  clearLabel,
  testIdPrefix,
  className,
}: SearchInputProps) {
  if (clearIcon !== undefined && clearLabel === undefined) {
    throw new Error('SearchInput: clearIcon を渡すときは clearLabel（aria-label の語）も渡してください（packages/ui は文言を持ちません）。');
  }
  return (
    <div className={cn('relative flex items-center', className)}>
      {icon === undefined ? null : (
        <span aria-hidden="true" className="pointer-events-none absolute left-3 text-fg-muted">
          {icon}
        </span>
      )}
      <Input
        type="search"
        name={name}
        defaultValue={defaultValue}
        placeholder={placeholder}
        aria-label={ariaLabel}
        data-testid={`${testIdPrefix}search`}
        className={cn(icon === undefined ? null : 'pl-8', clearIcon === undefined ? null : 'pr-8')}
        onChange={(event) => {
          scheduleSearch(event.currentTarget, debounceMs, onSearchChange);
        }}
      />
      {clearIcon === undefined ? null : (
        <button
          type="button"
          aria-label={clearLabel}
          data-testid={`${testIdPrefix}search-clear`}
          // 🔴 hover は**背景を 1 段暗く**する（§7.10: 文字色は変えない）。
          className={cn('absolute right-2 rounded-sm p-1 text-fg-muted', 'hover:bg-bg-subtle', TRANSITION_CLASSES, FOCUS_RING_CLASSES)}
          onClick={(event) => {
            // 🔴 参照を持たずに入力欄へ到達する（フックを使わない）。器（`relative` の `<div>`）の
            //    中の唯一の `<input>` である。
            const field = event.currentTarget.parentElement?.querySelector('input');
            if (field === null || field === undefined) return;
            const pending = searchDebounceTimers.get(field);
            if (pending !== undefined) {
              clearTimeout(pending);
              searchDebounceTimers.delete(field);
            }
            field.value = '';
            field.focus();
            // 🔴 クリアは**待たずに**通知する（消したのに 300ms 結果が残るのは「効かなかった」に見える）。
            onSearchChange('');
          }}
        >
          {clearIcon}
        </button>
      )}
    </div>
  );
}
