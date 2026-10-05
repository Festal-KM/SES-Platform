// packages/ui/src/lib/current-nav-path.ts
// 🔴 **現在地（カレントナビ）の判定の 1 実装。** 2026-10-04。
//
// ============================================================================
// 🔴 なぜ `components/sidebar.tsx` から切り出したのか
// ============================================================================
// 2026-10-04 の実測（demo 環境 / Playwright）: **サイドメニューがどこをクリックしてもホームが
// 光り続けていた。** 原因は「判定が間違っていた」ことではなく、**判定を適用する場所がサーバの
// レイアウトだけだった**ことである ——
//
//   App Router のレイアウトは**クライアントのソフトナビゲーションで再描画されない**
//   （`(main)/layout.tsx` は全画面で共有されるため、`/` から `/engineers` へリンクで移動しても
//   レイアウトの出力は差分に含まれない）。サインイン直後はホームに着地するので、
//   **以後どこへ移動してもホームが光り続ける**。
//
//   | 操作 | 修正前の実測（`app-sidebar` の `aria-current`） |
//   |---|---|
//   | `/` にハードリロード | `app-nav-home` ✅ |
//   | `/engineers` へリンクで移動 | `app-nav-home` ❌ |
//   | `/projects` へリンクで移動 | `app-nav-home` ❌ |
//   | `/projects` をハードリロード | `app-nav-projects` ✅ |
//   | `/settings` へリンクで移動 | `app-nav-projects` ❌（第 2 階層の帯も案件管理のまま残る） |
//
// 🔴 **したがって直し方は「クライアントでも同じ判定を当てる」であり、判定を増やすことではない。**
//    この 1 ファイルがその判定の唯一の置き場所であり、
//
//      - サーバ（`components/sidebar.tsx` / `components/nav-panel.tsx` / `components/app-shell.tsx`）は
//        **初回描画（水和前）の現在地**を、`apps/web/proxy.ts` が添えたヘッダ由来のパスで決める
//      - クライアント（`apps/web/app/(main)/_shell/nav-current.tsx` の島）は `usePathname()` で
//        **上書きするだけ**
//
//    の 2 者が**この同じ関数を呼ぶ**。🔴 **2 つ目の判定を書かない。**
//
// 🔴 **import を 1 本も持たない。** `packages/ui` の主バレル（サーバ）と、`apps/web` の
//    `'use client'` の島の**両方から読まれる**ため、React にも `next/*` にも依存させない
//    （`components/sidebar.tsx` に置いたままにすると、島が部品の実装ごとクライアントバンドルへ
//    引き込む）。

/**
 * `currentPath` がその遷移先の中に居るか。
 *
 * 🔴 **ホーム（`/`）だけは完全一致**である（前方一致にすると全画面がホームの現在地になる）。
 * 🔴 区切りは `/` を含めて見る —— `/engineers` が `/engineer-shares` を飲み込まないため。
 * 🔴 **取れなかったとき（空文字）はどの項目にも一致しない**（`apps/web/lib/shell/current-path.ts`
 *    の 🔴: 現在地の誤表示は「押した覚えのない場所に居る」ことになり、何も光らないより悪い）。
 */
export function isCurrentNavPath(currentPath: string, href: string): boolean {
  if (href === '/') return currentPath === '/';
  return currentPath === href || currentPath.startsWith(`${href}/`);
}

/**
 * その項目が現在地か（**自分の遷移先 + 第 2 階層 / 索引の射程**をまとめた `matchPaths`）。
 *
 * 🔴 **射程を部品側で推測しない**（出所は `apps/web/lib/shell/nav.ts` の `sectionPaths` と
 *    第 2 階層・索引の表である）。ここは判定を適用するだけである。
 */
export function matchesCurrentNavPath(
  currentPath: string,
  matchPaths: readonly string[],
): boolean {
  return matchPaths.some((candidate) => isCurrentNavPath(currentPath, candidate));
}

/**
 * 候補のうち、現在地を含む**最初の**ものの添字（無ければ `-1`）。
 *
 * 🔴 **「いまどのセクションに居るか」の 1 実装**である（第 2 階層の帯をどれか 1 つだけ描く）。
 *    最初の 1 つに限るのは、帯が 2 本出る状態を**構造的に作れない**ようにするためである。
 */
export function currentNavSectionIndex(
  currentPath: string,
  candidates: readonly (readonly string[])[],
): number {
  return candidates.findIndex((matchPaths) => matchesCurrentNavPath(currentPath, matchPaths));
}

/**
 * 現在地かどうかでクラスを選ぶ。
 *
 * 🔴 **`currentClassName` が無い呼び出し側は、現在地の表現を持たない**（「その他」のパネルと
 *    ボトムタブが現にそうである。`components/sidebar.tsx` の `variant === 'more'`）。
 *    その場合に `className` を返すので、**現在地の表現の有無は呼び出し側が決める**。
 */
export function navLinkClassName(
  current: boolean,
  className: string | undefined,
  currentClassName: string | undefined,
): string | undefined {
  return current && currentClassName !== undefined ? currentClassName : className;
}
