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
 * ✅ 2026-10-02（`docs/04` §4.1 改訂 23）: ホームのタブ 3 つ（**面の切替**）。
 *
 * 🔴 **`メッセージ` を置かない**（チャットは Phase 2。`F-038`。実体が無いタブを先に置かない）。
 * 🔴 **状態の絞り込みに使わない**（§5-13 の `Tabs` 規約。同じ母集団のフィルタではない）。
 * 🔴 **選択は URL に載せる**（戻って同じ面に帰れる。§4.1 の操作表）。値は `?tab=` である。
 */
export const HOME_TABS = ['actions', 'projects', 'engineers'] as const;
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
