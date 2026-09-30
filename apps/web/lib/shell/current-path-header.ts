// apps/web/lib/shell/current-path-header.ts
// 🔴 現在地ヘッダ名の**唯一の定義**（SP-22 `T-22-05` / `docs/04` §3.1）。
//
// 🔴 **なぜ定数だけを 1 ファイルに切り出すか**（`lib/auth/cookie-names.ts` と同じ理由）:
//    `apps/web/proxy.ts` は **Edge ランタイム**で動く。隣の `./current-path.ts` は
//    `next/headers` を import しており、それは CJS shim 経由で `next/dist/server/request/*` を
//    `require` する ＝ **ミドルウェアのバンドルにサーバ側の実装が入りうる**。
//    proxy は**全リクエストの入口**であり、壊れたときの影響範囲は主平面の全画面である。
//    名前を 2 箇所に書き分ける手も採らない —— 片方を変えたときに**添える側と読む側が違う名前を
//    見続ける**（= 現在地がどの項目でも光らない）という静かな壊れ方をする。
//
// 🔴 **このファイルに import を 1 本も足さない。** 1 本でも足すと切り出した意味が消える
//    （Edge から読める保証がこのファイルの存在理由そのものである）。

/** 🔴 `apps/web/proxy.ts` が添え、`./current-path.ts` が読む。**両者がこの定数を共有する。** */
export const CURRENT_PATH_HEADER = 'x-ses-pathname';
