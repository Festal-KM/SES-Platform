// apps/web/lib/home/schemas.ts
// `GET /api/home`（docs/05 §6.3 #9）の境界検証。T-03-06。
//
// 🔴 `scope=mine|all` は docs/04 §S-003「自分の担当のみ」トグル（既定オン）の受け口。
//    Phase 0 は要対応キューが無い（`blocks` は常に空）ため判定には使わないが、
//    Phase 1 が骨格を変えずに絞り込みを足せるよう、境界検証だけ先に用意する。
import { z } from 'zod';

export const HOME_SCOPES = ['mine', 'all'] as const;
export type HomeScope = (typeof HOME_SCOPES)[number];

export const homeQuerySchema = z.object({
  scope: z.enum(HOME_SCOPES).optional(),
});

export type HomeQuery = z.infer<typeof homeQuerySchema>;
