// apps/web/app/layout.tsx
// 主平面（`/`）と管理平面（`/admin`）に共通する唯一のレイアウト。
// 🔴 文言は `packages/i18n` から引く（CLAUDE.md §3.5 / BR-32）。画面にベタ書きしない。
//
// 🔴 スタイルシートは `tailwind.css` **1 本だけ**である（T-21-07。SP-21 の終点）。
//    T-03-06 から続いていた「`tailwind.css` → `globals.css` の順で読み、**後勝ちで手書き
//    CSS を優先させる**」という暫定（SP-21 §3.1-2）は**解消済みであり、経過状態はもう無い**。
//    経緯: 基底（色 / 行間 / フォント）を T-21-03 で `tailwind.css` の `@theme` /
//    `@layer base` へ移し、画面のクラスを T-21-04 / T-21-05 で Tailwind ユーティリティと
//    `@ses/ui` へ移した結果、`globals.css` は参照 0 件になり T-21-07 で削除した。
// 🔴 **2 本目の CSS を足さない。** 足した瞬間に「どちらが後勝ちか」を読み手が追う状態が戻る
//    （それがこのスプリントで 5 タスクかけて外したものである）。新しい見た目は Tailwind の
//    ユーティリティか `@ses/ui`（`packages/ui`）で作る（CLAUDE.md §2 / §2.1）。
import type { ReactNode } from 'react';
import type { Metadata } from 'next';
import { DEFAULT_LOCALE, t } from '@ses/i18n';
import './tailwind.css';

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
