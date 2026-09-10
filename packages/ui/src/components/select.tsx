// packages/ui/src/components/select.tsx
// 単一選択のプルダウン（`S-005` / `S-010` の絞り込み、`S-041` の分類）。SP-21 T-21-02。
//
// ============================================================================
// 🔴 これは upstream の `Select` の取り込みではない —— **意図的に別物である**
// ============================================================================
// 照合日 2026-09-10 / `https://ui.shadcn.com/r/styles/new-york-v4/select.json`。
// upstream の `Select` は `radix-ui`（`SelectPrimitive.Root` / `Trigger` / `Portal` /
// `Content` / `Item` …）と `lucide-react`（`ChevronDownIcon` / `CheckIcon`）に依存する
// **ポップオーバー実装**であり、ネイティブの `<select>` ではない。取り込まない理由:
//
//   1. 🔴 **新規依存が 2 つ増える**（`radix-ui` / `lucide-react`）。依存追加は承認事項であり、
//      「整形」であるはずの SP-21 の射程を超える。
//   2. 🔴 **ネイティブ `<select>` はモバイルで OS のピッカーを開く。** `CLAUDE.md` §13.2 の
//      Tier 1（モバイルで操作まで完結）とは相性がよく、ポップオーバー実装に置き換えると
//      **キーボード操作・IME・スクリーンリーダーの挙動を自前で背負う**ことになる。
//   3. 現況（`globals.css` の `.ses-field select`）が既にネイティブ `<select>` であり、
//      SP-21 は**挙動を変えない**スプリントである（`docs/sprints/SP-21` §5 冒頭）。
//
// したがって基底クラスは upstream の `SelectTrigger` ではなく **`Input` と同一のもの**
// （`../lib/control-classes.ts`）を使う。`globals.css` が `.ses-field select` に
// 「入力欄と同じ見え方に揃える」と書いているのと同じ意図である。
//
// ⚠️ 将来 upstream のポップオーバー版が要るようになった場合は、**この `Select` を作り替えず**
//    別名で足すこと（ネイティブの利点を失う画面と失わない画面が混在するため）。
//
// | upstream `SelectTrigger` の語 | ここ | 判断と理由 |
// |---|---|---|
// | `w-fit` | `w-full`（`CONTROL_BASE_CLASSES`） | 現況（`.ses-field select { width: 100% }`）に合わせる。幅は呼び出し側が `max-w-*` で絞る |
// | `flex items-center justify-between gap-2` `whitespace-nowrap` | 取り込まない | ネイティブ `<select>` の内部レイアウトは UA が描く。flex にしても効かない |
// | `[&_svg]:*` `data-[placeholder]:*` `*:data-[slot=select-value]:*` | 取り込まない | アイコンと Radix の内部スロットが前提。ネイティブでは対応物が無い |
// | `appearance-none` | **付けない** | 付けると UA の▼が消え、代わりのアイコン（`lucide-react`）が要る。**選択肢であることが見えなくなるほうが害が大きい** |
// | `data-[size=default]:h-9` / `data-[size=sm]:h-8` | `h-10`（`CONTROL_FIELD_SIZE_CLASSES`） | 高さは `Input` / `Button` と揃える |
// | `border-input` / `ring-ring` / `shadow-xs` / `disabled:*` / `aria-invalid:*` / `dark:*` | 実色へ置換 / 取り込まない | `CONTROL_BASE_CLASSES` を `Input` と共有しているため、判断は `../lib/control-classes.ts` の表に同じ（upstream に無い `disabled:pointer-events-none` が入る点も同じ） |
import type { ComponentProps } from 'react';
import { cn } from '../lib/cn.js';
import { CONTROL_BASE_CLASSES, CONTROL_FIELD_SIZE_CLASSES } from '../lib/control-classes.js';

export type SelectProps = ComponentProps<'select'>;

export function Select({ className, ...props }: SelectProps) {
  return (
    <select
      className={cn(CONTROL_BASE_CLASSES, CONTROL_FIELD_SIZE_CLASSES, className)}
      {...props}
    />
  );
}
