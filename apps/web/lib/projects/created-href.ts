// apps/web/lib/projects/created-href.ts
// `S-012`（案件の登録）の**保存成功後の遷移先**を、サーバ側とクライアント側の両方から
// 同じ値で組み立てるための共有モジュール。T-06-01（Iteration 2 で新設）。
//
// ============================================================================
// 🔴 なぜ独立したファイルが要るのか（Iteration 1 の欠陥の是正）
// ============================================================================
// Iteration 1 は差し込み記号（`'{id}'`）を **`project-form.tsx`（`'use client'`）から
// `form-props.ts`（サーバ）へ値 import** していた。これは**実行時に確実に壊れる**:
//
//   RSC の**サーバグラフ**では、`'use client'` を宣言したモジュールの export は
//   すべて **client reference（プロキシ）に置換される**。したがってサーバ側で
//   `` `/projects/${CREATED_HREF_ID_PLACEHOLDER}/edit` `` を評価すると、文字列 `'{id}'` では
//   なく**プロキシ関数のソース**が埋め込まれた壊れた文字列になり、登録の保存に成功した
//   直後に `/projects/function(){throw Error(...)}/edit` へ遷移する。
//   （ビルド済みチャンク `apps/web/.next/server/chunks/ssr/_1n58f8y._.js` で実証済み。
//    `export const dynamic = 'force-dynamic'` のためビルドでは発火せず、`vitest` の
//    render テストは RSC 変換を経ないため素通りする —— **静的検査でも単体でも出ない壊れ方**である。）
//
// 🔴 したがって本モジュールは次の 3 つを守る:
//   ①**`'use client'` を宣言しない**（サーバグラフでは通常のモジュールとして評価され、
//     値がそのまま読める。クライアントグラフからも普通に import できる）
//   ②**`@ses/db` / `@ses/i18n` など実行時依存を 1 つも持たない**
//     （`project-form.tsx`〔`'use client'`〕からも import するため。
//      `tests/static/client-db-boundary.test.ts`）
//   ③🔴 **`app/**` ではなく `lib/**` に置く。** `vitest.config.ts` は `app/**` から
//     `*.render.test.tsx` しか拾わず（「`app/**` はルート定義とビューであり、ユニットテストを
//     置かない」）、`_form/` に置くと**この値を固定するテストが 1 度も走らない**。
//     フレームワーク非依存のロジックは `apps/web/lib/**` に置く、が本リポジトリの規約である。
//
// 🔴 一般化した規律: **`'use client'` のモジュールから値を import してよいのは
//    「そのモジュールを描画する側」だけ**である。定数を共有したくなったら、
//    どちらでもない第 3 のモジュールに置く。
//
// ============================================================================
// ビルドチャンクでの確認（`pnpm -r build` 後の `apps/web/.next/server/chunks/ssr/*.js`）
// ============================================================================
// 是正前（Iteration 1。`_1n58f8y._.js`）:
//     l=`/projects/${k.CREATED_HREF_ID_PLACEHOLDER}/edit`
//   かつ同チャンク内に client reference のスタブが同居していた ——
//     "Attempted to call CREATED_HREF_ID_PLACEHOLDER() from the server but
//      CREATED_HREF_ID_PLACEHOLDER is on the client. It's not possible to invoke
//      a client function from the server"
//   つまりサーバ側の評価では**この関数のソースが URL に埋め込まれていた**。
//
// 是正後（Iteration 2。クリーンビルド）:
//     "PROJECT_CREATED_HREF_PATTERN",0,"/projects/{id}/edit"
//   素の文字列リテラルとして SSR チャンクに焼き込まれ、`CREATED_HREF_ID_PLACEHOLDER` の
//   client reference は SSR チャンクから 1 件も消えた（`grep` で 0 件）。
//   （`/projects/${…}` の形で残るのはクライアント側の `PATCH` の fetch URL だけである。）
//   ⚠️ 上の実測値は当時のもの（末尾が `/edit`）。**T-06-02 で値そのものは `/projects/{id}` に
//   変わった**が、「素の文字列リテラルとして焼き込まれる」という確認の形は変わらない。

/**
 * 遷移先パターンに埋め込む差し込み記号。
 * 🔴 URL に現れうる文字を避けている（`{` / `}` は `encodeURIComponent` の対象外なので、
 *    置換前のパターンがそのまま `location.assign` に渡っても壊れ方が見て分かる）。
 */
export const CREATED_HREF_ID_PLACEHOLDER = '{id}';

/**
 * 登録直後の遷移先パターン。
 *
 * 🔴 **`S-011`（案件詳細）である**（`docs/04` §S-012 関連画面「→ `S-011`」/ 操作と結果
 *    「保存 → 案件更新 + 監査ログ」）。T-06-01 は `S-011` が未実装だったため暫定で
 *    `/projects/{id}/edit`（＝ 保存した画面に戻る）を指していたが、T-06-02 で本来の値にした。
 *    ⚠️ 保存直後に**詳細**へ送ることには、`F-014 AC-2` 上の意味もある —— 詳細には
 *    「この案件はまだどの取引先にも公開されていません」の警告が出るため、登録した本人が
 *    **その場で公開範囲の未設定に気づける**（編集画面へ戻すと気づけない）。
 * 🔴 関数ではなく**文字列**で持つ（サーバコンポーネントからクライアントコンポーネントへ渡す
 *    props は直列化できる必要があり、関数は渡せない。docs/05 §6.1「Server Actions を使わない」）。
 */
export const PROJECT_CREATED_HREF_PATTERN = `/projects/${CREATED_HREF_ID_PLACEHOLDER}`;

/**
 * パターンの差し込み記号を、採番された ID で置き換える。
 * 🔴 ID は `encodeURIComponent` を通す（サーバが返す `uuid(7)` は安全な文字だけだが、
 *    「応答の値をそのまま URL に連結しない」規律を経路の側で守る）。
 */
export function buildCreatedHref(pattern: string, id: string): string {
  return pattern.replace(CREATED_HREF_ID_PLACEHOLDER, encodeURIComponent(id));
}
