// packages/ui/src/lib/cn.ts
// プリミティブがクラス名を合成する唯一の関数。**`tailwind-merge` で競合を解決する**。
//
// ============================================================================
// 🔴 規律が変わった（SP-22 T-22-01。2026-09-29 に人間が依存の追加を承認した）
// ============================================================================
// **以前ここには「`className` で上書きはできない」と書いてあった。それは依存が無かった当時の
// 事実であり、いまは事実ではない。** 経緯を残す（規律が変わったことを次の者が誤らないため）:
//
//   - T-21-01 / T-21-02 の時点では `class-variance-authority` / `tailwind-merge` を**入れて
//     いなかった**（新規依存の追加は承認事項。`CLAUDE.md`）。そのため `cn()` は単純結合で、
//     `class` 属性の並び順は勝敗を決めず、**勝つのは Tailwind が生成した CSS 上で後ろにある方**
//     だった（詳細度が同じなので宣言順だけで決まる）。`<TableCell className="whitespace-normal">`
//     と書いても基底の `whitespace-nowrap` に勝てるとは限らない、という状態である。
//   - 🔴 **2026-09-29、`docs/04` 改訂 16 の §5-13 で人間が依存の追加を承認した**
//     （`class-variance-authority` / `tailwind-merge` / `lucide-react` / `@radix-ui/*`）。
//     位置づけは「`CLAUDE.md` §2 が宣言している shadcn/ui を**宣言どおりに入れる**」であり、
//     新しいスタックの導入ではない（shadcn/ui はこの 2 つを前提に構成されている）。
//     T-22-01 で入れたのは **`tailwind-merge` と `class-variance-authority` の 2 つだけ**である。
//
// 🔴 **新しい規律**（3 つ。古い規律 1 / 2 を置き換える）
//
//   1. **`className` は「余白・幅・表示」の調整に限る**（`mb-4` / `max-w-sm` /
//      `hidden sm:table-cell`）。競合しても後勝ちで解決されるようになったが、
//      🔴 **色・サイズ・状態を `className` に逃がさない。** それらは `variant` / `size` として
//      `packages/ui` が持つ（`class-variance-authority`）。理由は競合解決の有無ではなく
//      **`docs/04` §7.4 の意味の割り当てと §7.10 の 8 状態を 1 箇所に閉じるため**である ——
//      「1 箇所でしか色が決まらないことが、意味の対応を守る唯一の方法」（§5-13 `StatusBadge`）。
//      `className="bg-emerald-50"` を許すと、その画面だけ「成果（緑）」の意味から外れた緑が生える。
//   2. **既存の `variant` / `size` / `whitespace` / `align` / `padding` / `width` prop を
//      `className` 前提に戻さない。** これらは「上書きできなかったから prop にした」のではなく、
//      **選択肢を型で列挙するため**に prop である（`TableCell` の `align` は行からの伝播が
//      絡むので特に。`components/table.tsx` の実測表）。
//   3. 🔴 **本プロダクト固有のトークン名を `tailwind-merge` に教えること**（下の `extend`）。
//      教えないと `text-cell`（文字サイズ）が**文字色**と同じグループに分類され、
//      `cn('text-cell', 'text-fg')` が `text-cell` を**黙って捨てる**（実測。見た目だけが
//      壊れ、テストは落ちない）。**`@theme` にトークンを足したらここにも足す** ——
//      3 者一致（`docs/04` §7.9 の表 / `@theme` / ここ）は
//      `tests/static/design-tokens.test.ts` のミラーテストが固定する（`docs/05` §2.3.3-2）。
import { extendTailwindMerge } from 'tailwind-merge';

/**
 * `docs/04` §7.9 の文字サイズトークン 7 種（`@theme` の `--text-*`）。
 *
 * ✅ **`metric`（24px）は改訂 23 で足した 7 つ目**であり、**使ってよいのは `KpiCard` の件数 1 箇所
 *    だけ**である（`tests/static/design-tokens.test.ts` が参照元のファイルを固定する）。
 *    ここに登録するのは、登録しないと `cn('text-metric', 'text-fg')` が **`text-metric` を
 *    文字色と解釈して黙って捨てる**ためであり、使ってよい場所を広げる意味は持たない。
 *
 * 🔴 `tailwind-merge` の既定は `text-*` を「T シャツサイズ（`xs` / `sm` / `base` / `lg` / …）なら
 *    font-size、それ以外は**文字色**」と解釈する。`title` / `body` / `cell` / `micro` は
 *    既定のサイズ名ではないため、教えないと文字色として扱われ、同じ要素に文字サイズと文字色を
 *    渡したときにどちらかが消える。
 */
export const TOKEN_TEXT_SCALE = ['title', 'metric', 'lg', 'body', 'cell', 'xs', 'micro'] as const;

/**
 * `docs/04` §7.9 の semantic な色の名前（`@theme` の `--color-*` から接頭辞を除いたもの）。
 *
 * 🔴 **`@theme` の宣言とこの配列が一致することをミラーテストで固定する**
 *    （`tests/static/design-tokens.test.ts` / `docs/05` §2.3.3-2）。
 * ⚠️ 挙動としては、`tailwind-merge` の既定が「`bg-*` / `text-*` / `border-*` / `ring-*` の値は
 *    何でも色」なので、**登録しなくても色同士の競合解決は効く**（実測:
 *    `cn('bg-bg-subtle', 'bg-brand')` → `bg-brand`）。それでも登録するのは、**`@theme` に
 *    足したトークンをここに足し忘れたことを検査で捕まえるため**である（3 者一致 =
 *    `docs/04` §7.9 の表 / `@theme` / ここ）。
 * 🔴 **radius / shadow は登録しない** —— 名前を Tailwind 既定のまま（`rounded-sm` /
 *    `rounded-md` / `shadow-*`）にしたので、既定の設定がそのまま正しく分類する
 *    （`docs/05` §2.3.2: 同じ値に 2 つの名前を作らない）。
 */
export const TOKEN_COLOR_SCALE = [
  'fg',
  'fg-muted',
  'fg-placeholder',
  'bg',
  'bg-subtle',
  'bg-inset',
  'border',
  'border-strong',
  'brand',
  'brand-hover',
  'brand-active',
  'brand-bg',
  'brand-fg',
  'danger',
  'danger-bg',
  'danger-border',
  'warning',
  'warning-bg',
  'warning-border',
  'success',
  'success-bg',
  'success-border',
  'info',
  'info-bg',
  'info-border',
  'neutral-bg',
  'neutral-border',
  // ✅ 2026-10-02（`docs/04` §7.9 改訂 23 / 人間のブリーフ）。**カード・パネル・overlay の地。**
  //    🔴 `bg`（ページの地）と値は同じで役割が違う（`apps/web/app/tailwind.css` の 🔴）。
  'surface',
  // ✅ ③ component 層の色（**部品 1 つのための色**）。🔴 参照してよい部品はそれぞれ 1 つだけで、
  //    `design-tokens.test.ts` が参照元のファイルを固定する。
  'sidebar-bg',
  'sidebar-fg',
  'sidebar-fg-muted',
  'sidebar-border',
  'sidebar-hover-bg',
  'sidebar-selected-bg',
  'sidebar-selected-fg',
  // ✅ 2026-10-04: `sidebar-selected-bar` を外した（現在地の左端 2px をやめ、`@theme` の宣言を
  //    消したため。`apps/web/app/tailwind.css` の ✅ / `design-tokens.test.ts` のミラー検査）。
  'row-hover-bg',
  'table-header-bg',
] as const;

const twMerge = extendTailwindMerge({
  extend: {
    theme: {
      text: [...TOKEN_TEXT_SCALE],
      color: [...TOKEN_COLOR_SCALE],
    },
  },
});

/**
 * クラス名を合成し、**競合するユーティリティは後勝ちで解決する**（`tailwind-merge`）。
 *
 * ⚠️ **挙動として教えないと壊れるのは文字サイズだけ**である（値の形で群を見分けているため）。
 *    色を登録する理由は `TOKEN_COLOR_SCALE` の 🔴 を読むこと。
 */
export function cn(...classes: ReadonlyArray<string | false | null | undefined>): string {
  return twMerge(
    classes.filter((value): value is string => typeof value === 'string' && value.length > 0).join(' '),
  );
}
