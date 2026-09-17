// apps/web/lib/data-exports/schemas.ts
// #77 / #78 の入力（docs/05 §6.7）。T-10-09。
import { z } from 'zod';

/**
 * #77 の body。docs/05 §6.7 #77 は `{ kind, scope }` と書くが、Phase 1 の `kind` は `CLOSING_RETURN` の 1 値、`scope` は
 * 固定（`CLOSING_RETURN_SCOPE`。`packages/db`）である。🔴 `scope` を**受け取らない**（受け取ると「エンジニア台帳だけ」等の
 * 部分返却が「返却済み」に見える経路になる。選択は `F-052`。Phase 3）。`kind` は将来の `OPERATIONAL` と区別するため受ける。
 */
export const dataExportCreateBodySchema = z
  .object({
    kind: z.literal('CLOSING_RETURN'),
  })
  .strict();

export type DataExportCreateBody = z.infer<typeof dataExportCreateBodySchema>;

export const dataExportParamsSchema = z.object({ id: z.string().uuid() });
