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
import { currentAppEnv } from '../lib/db/bootstrap';
import { AppEnvironmentBanner } from './_components/environment-banner';
import './tailwind.css';

export const metadata: Metadata = {
  title: t('product.name'),
};

/**
 * 🔴 T-10-05: **全ルートを要求時レンダリングにする。** 非本番バナー（下の
 *    `AppEnvironmentBanner`）は `APP_ENV` を**実行時に** `currentAppEnv()` から読む。
 *    これを宣言しないと、Request-time API を使わないページ（`/password-reset` 等）は
 *    `next build` 時に静的プリレンダされ、
 *      ① ビルド環境に `APP_ENV` が無い（CI の `pnpm run build` / E2E ハーネスの `next build`
 *         はどちらも環境変数無しで走る）ため `loadAppEnv` の検証が落ちてビルドが失敗する。
 *      ② 仮にビルド時に環境変数があっても、**ビルド時の環境がそのまま HTML に焼き込まれ**、
 *         `production` の成果物に `development` のバナーが残る／その逆が起こる
 *         （`F-028 AC-1` / `AC-3` の両方が静かに破れる）。
 *    `apps/web` の業務画面はすべて `force-dynamic`（各 `page.tsx`）であり、静的だったのは
 *    未認証の数画面だけである。失うものは無い。
 * 🔴 判定は `packages/config` が起動時に 1 度だけ行い、ここは結果を読むだけである
 *    （`CLAUDE.md` §11.1「リクエストごとの `if (APP_ENV === ...)` 分岐にしない」）。
 */
export const dynamic = 'force-dynamic';

/**
 * 🔴 **非本番バナー（`F-028` / `S-043`）。** T-21-03 が空けたスロット（`null`）を
 *    T-10-05 で `AppEnvironmentBanner` に置き換えた（レイアウトの構造はそのまま）。
 *
 * なぜ位置が固定なのか:
 *   - `CLAUDE.md` §11.1 が「本番でないことを UI に常時表示する」を求めており、
 *     `docs/04` §3.3-1 は管理平面の平面帯を「**環境バナーの直下**」と定めている。
 *     つまりバナーは `body` 直下・`children` の前でなければならない
 *     （管理平面の帯は `admin/layout.tsx` が `children` の先頭に描くので、root → admin の
 *     入れ子でこの順序が保たれる）。
 *   - 主平面・管理平面・モバイルのすべてで同じ 1 箇所から描く（`F-028 AC-1`）。
 *     平面ごとに別のレイアウトへ足すと、片方だけ直る状態が必ず生まれる。
 *   - `production` では `AppEnvironmentBanner` が `null` を返し、DOM に何も残らない
 *     （`F-028 AC-3`。`app/layout.render.test.tsx` が固定する）。
 */
export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang={DEFAULT_LOCALE}>
      <body className="min-h-dvh bg-white">
        <AppEnvironmentBanner env={currentAppEnv()} />
        {children}
      </body>
    </html>
  );
}
