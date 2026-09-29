// packages/ui/src/components/page-body.tsx
// 🔴 幅 3 クラス（`docs/04` §7.1 / `docs/05` §2.3.4）。**本体カラムの幅を決める唯一の場所である。**
//    shadcn/ui の取り込みではなく本リポジトリ固有。SP-22 `T-22-04`。
//
// ============================================================================
// 🔴 なぜここ 1 箇所なのか（着手前に何が起きていたか）
// ============================================================================
// `docs/04` §7.1 の実測: 各画面が個別に `max-w-*` を書いており（`max-w-3xl` = **768px** が 12 箇所 /
// `max-w-6xl` 10 / `max-w-5xl` 7 / `max-w-4xl` 3）、**1920px のディスプレイでも一覧の中身が 768px に
// 絞られ、両側に大量の死んだ余白が生まれていた。** 8 列のテーブルを 768px に押し込めば
// 「8 列 + 操作列」も「ファーストビューに 12 行」も成立しない。
//
// 🔴 したがって **画面ファイルの `max-w-*` と `style` の幅指定は禁止**（検査 (c)）であり、
//    **全画面が `PageBody` に `widthClass` をちょうど 1 回渡す**（検査 (k)）。
//
// 🔴 **60 画面のクラスの割り当ては `docs/04` §7.1 の表が唯一の出所である。**
//    ここ（`packages/ui`）にも `docs/05` にも写し替えない（2 箇所に持つと片方だけ動く）。
//    **`PageBody` は `widthClass` を受け取るだけ**で、どの画面がどのクラスかを知らない。
//
// ============================================================================
// 🔴 任意寸法はこのファイルの中だけに存在する（`docs/05` §2.3.4 の 🔴）
// ============================================================================
// `w-90`（360px）/ `w-100`（400px）/ `w-120`（480px）/ `max-w-180`（720px）は Tailwind の
// 既定スケール（`--spacing` = 0.25rem）の倍数であり、**§7.9 の spacing 7 段の話ではない**
// （余白ではなく寸法である）。それでも**書ける場所を 1 ファイルに閉じる**のは、寸法が画面ごとに
// 増えるのを止めるためである。
// 🔴 **他の部品がこの寸法を必要とするときは、クラス文字列をここから import する**
//    （`EmptyState` の説明文が 720px を超えないための `PAGE_BODY_PROSE_MAX_WIDTH_CLASS`）。
//    **各部品が `max-w-180` と書き直さない。**
//
// ============================================================================
// 🔴 3 クラスの実装（`docs/04` §7.1 の表 / `docs/05` §2.3.4 の表）
// ============================================================================
// | クラス | 実装 | 🔴 規約 |
// |---|---|---|
// | `full` | 左右 gutter `px-6`（24px）のみ。**上限を設けない** | 列を削らないことが先。`2xl` でも全幅のまま（列が増えるのではなく列幅のゆとりに使う） |
// | `split` | 主カラム `flex-1 min-w-0` / 副カラム **`lg:w-90` → `xl:w-100` → `2xl:w-120` の固定**。`lg` 未満は 1 列に落として副カラムを下へ | 🔴 **可変にしない** —— 可変にすると大画面でプレビューだけが伸び、`S-021` の「送信先での見え方」が**実際のメールクライアントと違う幅**になって用を成さない（ゲートの最後の砦であるプレビューが嘘になる） |
// | `prose` | **`max-w-180`（720px）+ 左寄せ** | 🔴 **`mx-auto` を書かない** —— サイドバーが左にある構造で中央寄せすると、視線の起点が画面ごとに動く。⚠️ 左寄せは「サイドバーの右端から 720px」であり、ビューポート中央ではない |
//
// 🔴 **境界は Tailwind 既定の `lg` / `xl` / `2xl` の 3 本だけ**（1440 / 1920 に境界を作らない。
//    `docs/04` 改訂 17。機械検査は `tests/static/tailwind-breakpoints.test.ts`）。
//
// 🔴 `'use client'` を付けない（`../index.ts` の共通規約 4）。状態もイベントハンドラも持たない。
// 🔴 文言を持たない（共通規約 5）。
import type { ReactNode } from 'react';
import { cn } from '../lib/cn.js';

/** `docs/04` §7.1 の幅 3 クラス。🔴 4 つ目を作らない（作れば画面ごとの幅が戻る）。 */
export type PageWidthClass = 'full' | 'split' | 'prose';

/**
 * 本体の左右 gutter（`docs/04` §7.9 の `--space-6` = 24px）。3 クラスに共通。
 * 🔴 クラスごとに gutter を変えない（画面を移動するたびに本文の左端が動く）。
 */
export const PAGE_BODY_GUTTER_CLASS = 'px-6';

/**
 * クラス C（読み幅）の上限 = **720px**。
 * 🔴 **この語が書かれているのはここだけである**（ファイル冒頭の「任意寸法」）。
 *    `docs/04` §7.1 は「本文・説明文・`EmptyState` の文言は 720px を超えて 1 行にしない」とも
 *    定めているので、`EmptyState` はこの定数を import する（`max-w-180` を書き直さない）。
 */
export const PAGE_BODY_PROSE_MAX_WIDTH_CLASS = 'max-w-180';

/**
 * クラス B（分割）の副カラムの固定幅。🔴 **`lg` 360 → `xl` 400 → `2xl` 480px**。
 * 🔴 `shrink-0` と対で使う（これが無いと主カラムに押されて可変になる）。
 */
export const PAGE_BODY_ASIDE_WIDTH_CLASSES = 'w-full lg:w-90 lg:shrink-0 xl:w-100 2xl:w-120';

export type PageBodyProps = {
  /** 🔴 `docs/04` §7.1 の割り当て。**どの画面がどれかは `docs/04` が持つ**（ここは受け取るだけ）。 */
  readonly widthClass: PageWidthClass;
  /** 主カラム（`full` / `prose` では本体そのもの）。 */
  readonly children: ReactNode;
  /**
   * `split` の副カラム（右パネル / プレビュー）。🔴 **`lg` 未満では下に落ちる**（隠さない）。
   * ⚠️ `widthClass` が `split` 以外のときに渡してはならない（実行時に落とす。下の壁）。
   */
  readonly aside?: ReactNode;
  readonly className?: string;
};

/** 主カラム側の器。🔴 `min-w-0` が無いと、テーブルの横溢れが副カラムを押し出す。 */
const MAIN_COLUMN_CLASSES = 'min-w-0 flex-1';

export function PageBody({ widthClass, children, aside, className }: PageBodyProps) {
  // 🔴 実行時の壁。`full` / `prose` に副カラムを渡すのは「幅クラスの取り違え」であり、
  //    黙って捨てると**判断材料が 1 つ消えたまま画面が成立する**（プレビューが出ない `S-021`）。
  if (aside !== undefined && widthClass !== 'split') {
    throw new Error(
      `PageBody: 副カラム（aside）は widthClass='split' だけが持てます（docs/04 §7.1）。widthClass='${widthClass}' で渡されました。`,
    );
  }
  if (widthClass === 'split') {
    return (
      <div
        data-width-class="split"
        className={cn('flex flex-col gap-6', PAGE_BODY_GUTTER_CLASS, 'lg:flex-row', className)}
      >
        <div className={MAIN_COLUMN_CLASSES}>{children}</div>
        {aside === undefined ? null : (
          <aside data-page-body-aside="true" className={PAGE_BODY_ASIDE_WIDTH_CLASSES}>
            {aside}
          </aside>
        )}
      </div>
    );
  }
  if (widthClass === 'prose') {
    // 🔴 `mx-auto` を書かない（左寄せ。§7.1）。
    return (
      <div data-width-class="prose" className={cn(PAGE_BODY_GUTTER_CLASS, className)}>
        <div className={PAGE_BODY_PROSE_MAX_WIDTH_CLASS}>{children}</div>
      </div>
    );
  }
  // `full`: 🔴 上限を設けない（列を削らないことが先。§7.1）。
  return (
    <div data-width-class="full" className={cn(PAGE_BODY_GUTTER_CLASS, className)}>
      {children}
    </div>
  );
}
