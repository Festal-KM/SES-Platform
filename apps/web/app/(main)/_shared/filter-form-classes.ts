// apps/web/app/(main)/_shared/filter-form-classes.ts
// 一覧画面の検索条件の帯（`S-005` / `S-010`）の器。旧 `globals.css` の `.ses-filter-form` の
// 移設先である（SP-21 T-21-04）。
//
// 🔴 **1 つの定数にする理由**: 旧 `.ses-filter-form` は 1 つの CSS 規則を 2 画面が共有していた。
//    移行の過程で画面ごとに書き下すと、**片方だけ直る**状態がその場で生まれる
//    （SP-21 T-21-02 の受け入れ基準 ①「同じ見た目のローカル実装を 2 つ作らない」）。
//
// 🔴 **grid にした理由**: 旧実装は `display:flex` + `flex-wrap` で、各条件の幅は中の
//    `<input>` の内容幅（`size=20` 由来の min-content）に依存していた。`@ses/ui` の
//    `Input` / `Select` は upstream どおり `w-full` を持つため、flex のままだと
//    **1 行 1 条件**に化ける。列数を明示すれば幅が器から決まり、条件が増えても崩れない。
//
// 🔴 **モバイルでも条件を省略しない**（`docs/04` §S-005 / §S-010 デバイス別）。
//    1 カラムに積むだけであり、間引くのは結果テーブルの列だけである（`CLAUDE.md` §13.3）。
// 🔴 ブレークポイントは Tailwind の既定のみを使う（`CLAUDE.md` §13.3）。
//
// ⚠️ **文言を持たない**（`CLAUDE.md` §3.5）。クラス名だけの純粋な定数であり、
//    `@ses/i18n` / `@ses/config` / `@ses/db` のいずれにも依存しない
//    （`*.render.test.tsx` が「文言が無い状態の描画」を試せる状態を壊さない）。

/** 検索条件の帯そのもの（`<form>`）。 */
export const FILTER_FORM_CLASSES =
  'mb-6 grid grid-cols-1 items-end gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4';

/**
 * 送信ボタンと「条件を解除」の行。
 * 🔴 条件の列数によらず**必ず 1 行を占める**（列の途中に紛れると押せる場所が毎回変わる）。
 */
export const FILTER_ACTIONS_CLASSES =
  'flex flex-wrap items-center gap-4 sm:col-span-2 lg:col-span-3 xl:col-span-4';
