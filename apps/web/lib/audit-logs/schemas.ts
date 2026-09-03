// apps/web/lib/audit-logs/schemas.ts
// `GET /api/audit-logs`（docs/05 §6.3 #10 / `F-005` / `S-041`）の境界検証。
//
// 🔴 期間は必須（docs/05 §6.3 #10「期間必須」/ docs/04 §S-041「期間未指定 → 検索を実行させず
//    『期間を指定してください』」）。`from` / `to` を `.optional()` にしない
//    — Zod の必須違反がそのまま 400 になる（別途コードを書かない）。
// 🔴 `.refine()` を使わない: `withApiRoute` の `assertBoundarySchema` はトップレベルの
//    `.shape` を読んで分離キーの混入を検査する（docs/05 §6.1）。`.refine()` は
//    `ZodObject` を `ZodEffects` で包み `.shape` を持たなくなるため、ここで使うとルート構築時に
//    「オブジェクトスキーマではない」として落ちる。`from <= to` の相互検証はルート側
//    （service 呼び出しの前）で行う。
import { z } from 'zod';
import { cursorPageQuerySchema } from '../api/pagination';
import { AUDIT_LOG_CATEGORY_KEYS } from './categories';

export const auditLogQuerySchema = cursorPageQuerySchema.extend({
  from: z.iso.datetime({ offset: true }),
  to: z.iso.datetime({ offset: true }),
  action: z.enum(AUDIT_LOG_CATEGORY_KEYS).optional(),
  actorId: z.uuid().optional(),
});

export type AuditLogQuery = z.infer<typeof auditLogQuerySchema>;

/** `from` が `to` 以前であること（Zod スキーマの外で検証する理由は本ファイル冒頭コメント）。 */
export function isValidAuditLogPeriod(query: Pick<AuditLogQuery, 'from' | 'to'>): boolean {
  return new Date(query.from).getTime() <= new Date(query.to).getTime();
}
