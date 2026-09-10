// apps/web/app/layout.tsx
// 主平面（`/`）と管理平面（`/admin`）に共通する唯一のレイアウト。
// 🔴 文言は `packages/i18n` から引く（CLAUDE.md §3.5 / BR-32）。画面にベタ書きしない。
//
// 🔴 読み込み順（T-21-03 で意味が変わった）:
//    `tailwind.css` → `globals.css` の順は残しているが、**もう「後勝ちで手書き CSS を
//    優先させる」ための順序ではない。** 基底（色変数 / 行間 / フォント）は `tailwind.css`
//    へ移し、`globals.css` に残るのは `.ses-*` のコンポーネントクラスだけになった。
//    `.ses-*` は Tailwind のユーティリティと**セレクタ名が 1 つも競合しない**ため、
//    順序を入れ替えても見え方は変わらない。**この 2 行は T-21-07 が `globals.css` ごと
//    消すまでの経過状態である**（詳細は `tailwind.css` 冒頭と `globals.css` 冒頭）。
import type { ReactNode } from 'react';
import type { Metadata } from 'next';
import { DEFAULT_LOCALE, t } from '@ses/i18n';
import './tailwind.css';
import './globals.css';

export const metadata: Metadata = {
  title: t('product.name'),
};

/**
 * 🔴 **非本番バナー（`F-028` / `S-043`）のスロット。担当は SP-10 の `T-10-05` であり、
 *    本タスク（T-21-03）では作らない。** ここは「空けたまま渡す」ための場所である。
 *
 * なぜ位置が固定なのか:
 *   - `CLAUDE.md` §11.1 が「本番でないことを UI に常時表示する」を求めており、
 *     `docs/04` §3.3-1 は管理平面の平面帯を「**環境バナーの直下**」と定めている。
 *     つまりバナーは `body` 直下・`children` の前でなければならない。
 *   - 🔴 **ここを別の要素で埋めると、`T-10-05` がレイアウトの作り直しから始まる。**
 *
 * `T-10-05` はこの定数を `<EnvironmentBanner />` に置き換えるだけでよい
 * （現状は何も描かないため、DOM も見た目も 1px も増えていない）。
 */
const ENVIRONMENT_BANNER_SLOT: ReactNode = null;

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang={DEFAULT_LOCALE}>
      <body className="min-h-dvh bg-white">
        {ENVIRONMENT_BANNER_SLOT}
        {children}
      </body>
    </html>
  );
}
