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

/**
 * 🔴 **主カラムが切ってはいけない下限 = 1,320px**（`basis-330` = 330 × 0.25rem）。
 *
 * 値の根拠は**最も広い一覧表の min-content**（`S-010` 案件一覧 = 9 列 **1,313px**。2026-10-03 の
 * 実測）を Tailwind の spacing 倍数に切り上げたものである。🔴 **「主カラムが表を収められる幅を
 * 保てるときだけ副カラムを並置する」**という判定をこの 1 つの数で表す（下の `'main-min'` の 🔴）。
 */
export const PAGE_BODY_SPLIT_MAIN_MIN_PX = 1320;
/** 🔴 上の px と**対**。クラスと数のどちらかだけを変えると検査が落ちる。 */
export const PAGE_BODY_SPLIT_MAIN_MIN_CLASS = 'basis-330';
/** `split` の 2 カラムの間隔（`gap-6` = 24px）。🔴 幅の計算に入るので数でも持つ。 */
export const PAGE_BODY_SPLIT_GAP_PX = 24;
/** 副カラムの固定幅の最大値（`w-120` / `max-w-120` = 480px）。🔴 幅の計算に入るので数でも持つ。 */
export const PAGE_BODY_ASIDE_WIDTH_PX = 480;

/**
 * ✅ 2026-10-03（**同日中に差し替え**）: **副カラムを「主カラムが下限を保てるときだけ」並置する**
 * ときの副カラムの幅（上限 480px）。🔴 `asideFrom='main-min'` と**対で使う**。
 *
 * 🔴 **`w-full max-w-120` であり `w-120` ではない。** `flex-wrap` の行分割は各 item の
 *    *hypothetical main size*（flex-basis を min/max-width で挟んだ値）で決まるため、
 *    `width:100%` を `max-width:480px` で挟むことで **「並置時は 480px 固定」「下段に落ちた
 *    ときは行いっぱい（ただし 480px まで）」**を 1 つのクラスで表せる。
 * ⚠️ 🔴 **下段に落ちたときの幅が「行いっぱい」から「480px 上限」に変わった**（唯一の見た目の
 *    変化。1264px の表の下に 1264px の薄い帯が伸びるより、480px のカードのほうが読める）。
 */
export const PAGE_BODY_ASIDE_WIDTH_CLASSES_WRAP = 'w-full max-w-120';

/**
 * 🔴 **`'main-min'` の器**。`flex-wrap` だけで並置／下段を決める（**画面幅の境界を 1 つも
 *    使わない**）。`flex-col` も `*:flex-row` も書かない —— 書くと「幅で決める」に戻る。
 */
export const PAGE_BODY_SPLIT_ROW_CLASSES_WRAP = 'flex flex-wrap';

/** 🔴 **`'main-min'` の主カラム**。`basis` が行分割の判定値そのものである（上の 🔴）。 */
export const PAGE_BODY_SPLIT_MAIN_CLASSES_WRAP = `min-w-0 grow shrink ${PAGE_BODY_SPLIT_MAIN_MIN_CLASS}`;

/**
 * 🔴 **副カラムを並置する条件**（`docs/04` §7.1 の幅クラス B）。
 *
 * ============================================================================
 * 🔴 なぜ `'2xl'`（画面幅の境界）を捨てたのか —— **幅を広げると悪化していた**
 * ============================================================================
 * 2026-10-03 の朝、§7.1 改訂 25 / 26 の副作用（1280px で `S-010` の表が **44%** しか見えない）を
 * 「副カラムの並置を `2xl` まで遅らせる」で直した。🔴 **これは崖を 1280 から 1536 へ移しただけ
 * だった。** 同日の再監査（実画面 67 枚）の実測:
 *
 * | 幅 | 主カラム | `S-017` 可視率 | 行高 | 折返セル | `S-010` 可視率 |
 * |---:|---:|---:|---:|---:|---:|
 * | 1512 | 1,238 | 100% | 42 | 0 | 94% |
 * | **1536** | **758** | **88%** | **56** | **3** | **58%** |
 * | 1600 | 822 | 95% | 56 | 3 | 63% |
 * | 1680 | 902 | 100% | 42 | 0 | 69% |
 *
 * 🔴 **`2xl`（1536px）で副カラムが並置に入り、主カラムが 1,238 → 758px に半減する。** 表の
 *    min-content は変わらないので、**1280px のときより狭くなる**。しかも 🔴 **1536 は Windows
 *    ノートで最も多い論理幅**（1920×1080 の 125% 表示）であり、1512（MacBook Pro 14/16 の既定）
 *    の**すぐ隣が最悪の幅**になっていた。
 *
 * 🔴 **`2xl:flex-row` を使う限りこの崖は不可避である。** 並置に入った瞬間、主カラムは
 *    必ず `gap(24) + 副カラム(480)` だけ狭くなる。**境界を右にずらしても崖は移動するだけ**で
 *    消えない（1680 でも `S-010` は 69% にしかならない）。
 *
 * ⚠️ **副カラムを縮める案（`clamp`）では解けない。** 1536px で `S-010` の 1,313px を収めるには
 *    `主カラム = 1536 - 柱224 - gutter48 - gap24 - 副カラム >= 1313` ⇒ **副カラム <= -73px**。
 *    算数として不可能である（1920px でも 1,144px しか取れず 87%）。
 *
 * 🔴 **したがって判定を「幅」から「主カラムが下限を保てるか」に変える**（`'main-min'`）。
 *    実装は **`flex-wrap` + 主カラムの `flex-basis`** だけで、コンテナクエリも独自境界も
 *    要らない —— flexbox の行分割がまさにこの判定を行う。
 *
 * | 幅 | 器 | 並置 | 主カラム | `S-017` | `S-010` |
 * |---:|---:|---|---:|---:|---:|
 * | 1512 | 1,240 | 下段 | 1,240 | 100% | 94% |
 * | **1536** | 1,264 | 下段 | **1,264** | **100%** | **96%** |
 * | 1600 | 1,328 | 下段 | 1,328 | 100% | **100%** |
 * | 1920 | 1,648 | 下段 | 1,648 | 100% | 100% |
 * | 2096 | 1,824 | **並置** | 1,320 | 100% | 100% |
 *
 * 🔴 **どの幅でも「広げると悪化する」が起きない**（主カラムは並置に入る瞬間に 1,824 → 1,320 へ
 *    縮むが、1,320 >= 1,313 なので**見える量は減らない**）。機械検査は
 *    `tests/static/split-layout-width-regression.test.ts`（上の 2 つの表がその基準値である）。
 *
 * ⚠️ **代償**: 副カラムが横に並ぶのは **2,096px 以上**になった（1536〜1920 では表の下に積まれる）。
 *    §7.1 の表（`S-010` を「一覧 + 右パネル」と描いたワイヤーフレーム）との差分は上流の訂正として
 *    申し送る（`CLAUDE.md` §8.7）。🔴 **見える量を削ってまでパネルを横に置かない**が先である。
 *
 * 🔴 **既定は `lg` のままである**（`S-003` の右レール・`S-021` のプレビュー・`S-016` の候補パネル
 *    のように、**本体と同時に見えること自体が判断材料**の画面は 1 つも動かさない）。
 *    **`'main-min'` を選べるのは「主カラムが広い表で、副カラムが選択行の要約である」画面だけ**である。
 */
export type PageBodyAsideFrom = 'lg' | 'main-min';

/** 🔴 条件ごとの「副カラムの幅」。**画面で寸法を書かないための 1 箇所**（上の 🔴）。 */
export const PAGE_BODY_ASIDE_WIDTH_CLASSES_BY_FROM: Readonly<Record<PageBodyAsideFrom, string>> = {
  lg: PAGE_BODY_ASIDE_WIDTH_CLASSES,
  'main-min': PAGE_BODY_ASIDE_WIDTH_CLASSES_WRAP,
};

/**
 * 🔴 条件ごとの「2 カラムの器」。
 * - `lg`: 画面幅の境界で並置する（**Tailwind 既定の境界のみ**。`CLAUDE.md` §13.3）。
 * - `main-min`: 🔴 **境界を使わない**（`flex-wrap` が主カラムの `basis` で決める）。
 */
export const PAGE_BODY_ASIDE_ROW_CLASSES_BY_FROM: Readonly<Record<PageBodyAsideFrom, string>> = {
  lg: 'flex flex-col lg:flex-row',
  'main-min': PAGE_BODY_SPLIT_ROW_CLASSES_WRAP,
};

/** 🔴 条件ごとの「主カラムの器」。`main-min` は `basis` が行分割の判定値である（上の 🔴）。 */
export const PAGE_BODY_SPLIT_MAIN_CLASSES_BY_FROM: Readonly<Record<PageBodyAsideFrom, string>> = {
  lg: 'min-w-0 flex-1',
  'main-min': PAGE_BODY_SPLIT_MAIN_CLASSES_WRAP,
};

/**
 * 🔴 **flexbox の行分割をそのまま写した純関数**（`'main-min'` 用）。
 *    `tests/static/split-layout-width-regression.test.ts` が**実クラスから取り出した数**を
 *    この関数に通して、幅ごとの可視率・折り返しを固定する。
 *
 * ⚠️ **ここに画面幅（ビューポート）を渡さない。** 受け取るのは `PageBody` の**内容ボックスの幅**
 *    （= ビューポート − 柱 − gutter）であり、柱の幅を知るのは `AppShell` / `Sidebar` の責務である。
 */
export function pageBodySplitGeometry(contentWidthPx: number): {
  readonly asideBeside: boolean;
  readonly mainWidthPx: number;
  readonly asideWidthPx: number;
} {
  const besideNeeds = PAGE_BODY_SPLIT_MAIN_MIN_PX + PAGE_BODY_SPLIT_GAP_PX + PAGE_BODY_ASIDE_WIDTH_PX;
  if (contentWidthPx >= besideNeeds) {
    return {
      asideBeside: true,
      mainWidthPx: contentWidthPx - PAGE_BODY_SPLIT_GAP_PX - PAGE_BODY_ASIDE_WIDTH_PX,
      asideWidthPx: PAGE_BODY_ASIDE_WIDTH_PX,
    };
  }
  return {
    asideBeside: false,
    mainWidthPx: contentWidthPx,
    // 下段では行いっぱい（ただし 480px 上限。`PAGE_BODY_ASIDE_WIDTH_CLASSES_WRAP` の ⚠️）。
    asideWidthPx: Math.min(contentWidthPx, PAGE_BODY_ASIDE_WIDTH_PX),
  };
}

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
  /**
   * 🔴 副カラムを並置する条件（既定 `lg` = 画面幅の境界）。`PageBodyAsideFrom` の 🔴 を読むこと。
   * ⚠️ `widthClass` が `split` 以外のときは意味を持たない（副カラム自体が渡せない）。
   */
  readonly asideFrom?: PageBodyAsideFrom;
  readonly className?: string;
};

/**
 * ✅ `T-22-06`: **`data-testid="page-body"` を足した**（3 クラスすべてで同じ値）。
 *
 * 🔴 この器には testid が 1 つも無く、**本体カラムを掴めるのが `data-width-class` だけ**だった。
 *    幅クラスの割り当て（検査 (k)）は「`widthClass` を渡しているか」をソースで見るが、
 *    **描画結果の側で「本体がどこからどこまでか」を掴む手がかりが無い**（帯・トースト・
 *    overlay が同じ DOM に混ざる）。値は 3 クラスで同一にする —— **幅は
 *    `data-width-class` が表しており、testid で幅を表すと 2 か所で同じことを言う**ことになる。
 * 🔴 `testIdPrefix` を受け取る形にしない（1 画面に 1 つしか置けない器であり、接頭辞で
 *    区別する対象が無い。渡せる形にすると画面ごとに違う値が生まれる）。
 */
export function PageBody({ widthClass, children, aside, asideFrom = 'lg', className }: PageBodyProps) {
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
        data-testid="page-body"
        data-width-class="split"
        data-aside-from={asideFrom}
        className={cn(
          'gap-6',
          PAGE_BODY_GUTTER_CLASS,
          PAGE_BODY_ASIDE_ROW_CLASSES_BY_FROM[asideFrom],
          className,
        )}
      >
        <div className={PAGE_BODY_SPLIT_MAIN_CLASSES_BY_FROM[asideFrom]}>{children}</div>
        {aside === undefined ? null : (
          <aside data-page-body-aside="true" className={PAGE_BODY_ASIDE_WIDTH_CLASSES_BY_FROM[asideFrom]}>
            {aside}
          </aside>
        )}
      </div>
    );
  }
  if (widthClass === 'prose') {
    // 🔴 `mx-auto` を書かない（左寄せ。§7.1）。
    return (
      <div data-testid="page-body" data-width-class="prose" className={cn(PAGE_BODY_GUTTER_CLASS, className)}>
        <div className={PAGE_BODY_PROSE_MAX_WIDTH_CLASS}>{children}</div>
      </div>
    );
  }
  // `full`: 🔴 上限を設けない（列を削らないことが先。§7.1）。
  return (
    <div data-testid="page-body" data-width-class="full" className={cn(PAGE_BODY_GUTTER_CLASS, className)}>
      {children}
    </div>
  );
}
