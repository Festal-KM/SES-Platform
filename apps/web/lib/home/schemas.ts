// apps/web/lib/home/schemas.ts
// `GET /api/home`（docs/05 §6.3 #9）の境界検証。T-03-06。
//
// 🔴 `scope=mine|all` は docs/04 §S-003「自分の担当のみ」トグル（既定オン）の受け口。
//    ✅ T-12-15: 要対応キュー（`ACTION_QUEUE`）が使うようになった（`readActionQueueBlock`）。
// 🔴 `changedSince`（ISO 8601）は 60 秒ポーリングの差分応答の受け口（docs/04 申し送り 6 / docs/05 §6.3 #9）。
//    付けると `ACTION_QUEUE.items` は `rowVersion >= changedSince` の行だけになる（`targetIds` は常に全件）。
//    値は前回応答の `changedSince` をそのまま返すだけであり、分離キーではない（`assertBoundarySchema` の対象外の形）。
import { z } from 'zod';

export const HOME_SCOPES = ['mine', 'all'] as const;
export type HomeScope = (typeof HOME_SCOPES)[number];

/** 🔴 既定は「自分の担当のみ」（docs/04 §S-003 操作表「既定はオン」）。 */
export const DEFAULT_HOME_SCOPE: HomeScope = 'mine';

/**
 * ✅ 2026-10-02（`docs/04` §4.1 改訂 23）: ホームのタブ（**面の切替**）。
 * ✅ 2026-10-11（人間の仕様）: 🔴 **`メッセージ` を足して 4 つになった。**
 *
 * ~~🔴 **`メッセージ` を置かない**（チャットは Phase 2。`F-038`。実体が無いタブを先に置かない）。~~
 * → 🔴 **チャット（`S-031`）は実装済みである**（`e5c955d`）。「実体が無いタブを先に置かない」
 *    という規律は変えていない —— **実体が出来たので置けるようになった**。
 *    🔴 ただし **未読の件数は出さない**（`Message` に既読の列が無く、数える根拠が無い。
 *    `docs/04` §4.1 改訂 27 の 🔴。近似を黙って入れると「見たのに消えない」行を作る）。
 * 🔴 **並びは人間の仕様のとおり `メッセージ / 要対応 / 案件 / 人材`**（既定は `要対応`）。
 * 🔴 **状態の絞り込みに使わない**（§5-13 の `Tabs` 規約。同じ母集団のフィルタではない）。
 * 🔴 **選択は URL に載せる**（戻って同じ面に帰れる。§4.1 の操作表）。値は `?tab=` である。
 */
export const HOME_TABS = ['messages', 'actions', 'projects', 'engineers'] as const;
export type HomeTab = (typeof HOME_TABS)[number];

/** 🔴 既定タブは `要対応`（§4.1「既定タブは `要対応`」）。 */
export const DEFAULT_HOME_TAB: HomeTab = 'actions';

export const homeQuerySchema = z.object({
  scope: z.enum(HOME_SCOPES).optional(),
  changedSince: z.iso.datetime({ offset: true }).optional(),
  /**
   * 🔴 タブの選択（画面だけが使う。`GET /api/home` の応答は**タブで変わらない** ——
   *    1 回のポーリングで 3 つの面すべてを同じ応答から更新するため。§4.1 改訂 23）。
   */
  tab: z.enum(HOME_TABS).optional(),
});

export type HomeQuery = z.infer<typeof homeQuerySchema>;
