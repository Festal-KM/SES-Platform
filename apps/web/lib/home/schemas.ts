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

export const homeQuerySchema = z.object({
  scope: z.enum(HOME_SCOPES).optional(),
  changedSince: z.iso.datetime({ offset: true }).optional(),
});

export type HomeQuery = z.infer<typeof homeQuerySchema>;
