'use client';
// apps/web/app/global-error.tsx
// ルートレイアウトごと落ちたときの最後の受け皿（Next.js の `global-error`）。
//
// 🔴 **なぜ必要か**: Next.js のビルトインの `global-error` は英語の固定文言
//    （"This page couldn’t load" / "Reload"）である。ここは利用者が実際に見る画面なので、
//    文言は `packages/i18n` から引かなければならない（`CLAUDE.md` §3.5 / `BR-32`）。
//
// 🔴 **ビルドの失敗とは無関係である（2026-09-28 に実測して確定）。** このファイルは一時期
//    「`next build` が `/_global-error` の事前生成で落ちるのを避けるため」と説明されていたが、
//    それは誤りだった。`/_global-error` が事前生成するのは Next 自身の
//    `next/dist/client/components/builtin/app-error.js`（サーバコンポーネント）であり、
//    **この `global-error.tsx` は事前生成の対象に入っていない**。したがって置いても外しても
//    ビルドの成否は変わらない。真の原因は `NODE_ENV=development` のままビルドしていたことで、
//    対処は `apps/web/next.config.ts` の `assertProductionNodeEnv`（同ファイルの 🔴 に詳述）。
//    **この画面をビルド回避のために触らないこと。**
//
// 🔴 `global-error` はルートレイアウトを**置き換える**ため、`<html>` と `<body>` を自分で描く
//    （Next.js の仕様）。したがってここにはルートレイアウトの環境バナーが無い —— この画面に
//    到達している時点でアプリの外枠が落ちており、バナーの有無より「操作をやり直せること」が先である。
//
// 🔴 **だから `tailwind.css` を自分で import する。** ルートレイアウトを置き換える＝
//    `app/layout.tsx` の `import './tailwind.css'` が効かない。入れ忘れると、
//    **ルートレイアウトごと落ちた唯一の場面で素の HTML が出る**（2026-09-28 の実測: ビルド出力
//    `.next/server/app/_global-error.html` に CSS への参照が 0 本だった）。
//    この画面は「一番壊れているときに見る画面」であり、そこだけ体裁が崩れてよい理由は無い。
//
//    🔴 **再確認の手順**（`NODE_ENV` を持たないシェルで `pnpm --filter @ses/web run build` の後）:
//      ① `.next/server/app/_global-error.html` に `*.css` への参照が 1 本ある
//      ② その CSS チャンクに本ファイルが使うユーティリティ（`PageBody` の `.max-w-180` / `.min-h-11`）が含まれる
//    2026-09-28 の実測では ①1 本（`rel="preload" as="style"`）②いずれも含まれる、であった。
//
// 🔴 文言は `packages/i18n` から引く（`CLAUDE.md` §3.5 / `BR-32`）。ベタ書きしない。
//    `t()` は純粋関数（辞書の参照）なのでクライアント側でも同じ値を返す。
//
// 🔴 `error` の中身を画面に出さない。スタックトレースやメッセージには内部の識別子・SQL・
//    接続情報が入りうる（`CLAUDE.md` §3.5 / §10.5 の「内容を出さない」と同じ規律）。
//    出すのは `digest`（Sentry・サーバログと突き合わせるための不透明な識別子）だけである。
import { Button, PageBody } from '@ses/ui';
import { t } from '@ses/i18n';
// 🔴 ルートレイアウトの import は効かない（上の 🔴）。この 1 本がこの画面の唯一のスタイル源である。
import './tailwind.css';

export default function GlobalError({
  error,
  reset,
}: {
  readonly error: Error & { readonly digest?: string };
  readonly reset: () => void;
}) {
  return (
    <html lang="ja">
      <body className="min-h-dvh bg-bg">
        {/* 🔴 T-22-05: 幅は `PageBody` の 3 クラス（`docs/04` §7.1）に寄せた。**画面ファイルに
            `max-w-*` を書かない**（`tests/static/ui-screen-width.test.ts`）。この画面は 1 対象の
            文章なのでクラス C（読み幅 720px・左寄せ）である。 */}
        <main className="py-12" data-testid="global-error">
          <PageBody widthClass="prose">
          <h1 className="mb-4 text-title font-semibold text-fg">{t('error.internal')}</h1>
          {/* 🔴 手書きの `<button>` にしない（既存の error 境界 5 本と同じ `Button` を使う）。
              手書きだと `focus-visible:ring-*`（キーボードだけで操作している利用者が押す先を
              見失わない）と `disabled:*` が落ちる —— この画面はキーボード操作だけで抜ける先である。 */}
          <Button
            // 🔴 `min-h-11` は元の手書きボタンが持っていたタップ領域（44px）。`Button` の `h-10`（40px）
            //    とは別プロパティなので競合せず、`cn()` の「競合は解決しない」制約にも掛からない。
            //    モバイルで唯一の脱出口になる操作なので、置き換えで縮めない（`CLAUDE.md` §13.3）。
            className="min-h-11"
            data-testid="global-error-retry"
            onClick={() => {
              reset();
            }}
          >
            {t('error.retry')}
          </Button>
          {error.digest === undefined ? null : (
            <p className="mt-6 text-xs text-fg-muted" data-testid="global-error-digest">
              {error.digest}
            </p>
          )}
          </PageBody>
        </main>
      </body>
    </html>
  );
}
