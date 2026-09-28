// apps/web/lib/usage/request-scope.ts
// 🔴 `readUsageView` / `readBlockedNotice` を**1 リクエスト 1 回**に畳む包み
//    （T-12-20 の code-reviewer 指摘 #5）。
//
// ============================================================================
// なぜ別ファイルなのか
// ============================================================================
// `view.ts` は「Next.js / Auth.js に依存しない（`@ses/db` / `@ses/domain` のみ）」ことを不変条件に
// している —— 結合テストがサーバを立てずに同じ経路を実行できるようにするためである。
// リクエストという概念は**フレームワークの側**にあるので、畳み込みはこちらに置く。
// `view.ts` を読む API ルート（#69 / #70）と結合テストは、これまでどおり素の関数を呼ぶ。
//
// ============================================================================
// 🔴 どこで効くか
// ============================================================================
// `/settings/usage` では、共通外枠のヘッダ（上限インジケータ）と `S-038` 本体が**同じリクエストで
// 同じ読み取り**を要求する。畳まないと `readUsageView` が 2 回 = トランザクション 3 本 × 2 になる。
//
// 🔴 ヒットの条件は**引数の同一性**である（`cache()` の仕様）。`ctx` は `resolveTenantCtxOutcome`
//    （`cache()` 済み）が返す同一オブジェクト、`now` は `requestNow()`（`cache()` 済み）が返す
//    同一インスタンスでなければならない。**どちらかを呼び出し側で作り直すと、静かに 2 回読む**
//    （壊れはしないが、この包みの意味が無くなる）。
// 🔴 `cache()` の有効範囲はそのリクエストのレンダリングだけであり、リクエストを越えて共有されない。
//    **モジュールスコープの Map に持たせる実装に置き換えてはならない** —— 他テナントの残量が
//    見える事故になる（`apps/web/lib/auth/request-cache.test.ts` が同じ不変条件を固定する）。
import { cache } from 'react';
import { readBlockedNotice, readUsageView } from './view';

/** `GET /api/usage`（#69）と同じ読み取り。🔴 ホストロールのみ（`readUsageView` が `requireHost`）。 */
export const readUsageViewOnce = cache(readUsageView);

/** `GET /api/usage/blocked-notice`（#70）と同じ読み取り。全ロール。 */
export const readBlockedNoticeOnce = cache(readBlockedNotice);
