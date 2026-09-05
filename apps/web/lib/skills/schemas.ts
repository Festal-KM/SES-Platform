// apps/web/lib/skills/schemas.ts
// docs/05 §6.4 #23（`GET /api/skills` / `GET /api/skill-aliases`）と #24
// （`POST /api/skill-aliases/{id}/decide`）の境界検証。`F-010` / `S-009`。T-05-03。
//
// 🔴 分離キー（`tenantId` / `partnerCompanyId`）を**キーとして持たない**（`F-003 AC-1` /
//    `F-004 AC-2`）。テナント別名の母集団は RLS の C1（`SELECT` は `OR tenant_id IS NULL`、
//    書込は `tenant_id = app_tenant_id()`）と Prisma 拡張が決める。
//
// 🔴 `.refine()` を使わない（`withApiRoute` の `assertBoundarySchema` がトップレベルの
//    `.shape` を読むため。`partner-companies/schemas.ts` と同じ理由）。
//    **`decision` と `skillId` の組み合わせの検証も境界には置かない** —— 判定は
//    `policy.ts`（純粋関数）にあり、サービス層が呼ぶ。境界とサービスの 2 箇所に
//    同じ規則を書くと、片方だけが緩む。
import { z } from 'zod';
import { SKILL_ALIAS_STATUSES } from '@ses/db';
import { assertNoIsolationKeys, type AssertNoIsolationKeys } from '../api/isolation-keys';
import { SKILL_ALIAS_DECISIONS } from './policy';

/** 一覧の絞り込み文字列（`?q=`）。`partner-companies` と同じ上限。 */
const QUERY_MAX_LENGTH = 100;

/**
 * `GET /api/skills`（#23）の query。
 * 🔴 **`status` を持たない。** `skills`（グローバル辞書）に状態は無い（docs/05 §3.4）。
 *    docs/05 §6.4 #23 の `?q=&status=` は 2 本の GET をまとめて 1 行に書いたものであり、
 *    `status` は `skill_aliases` 側の絞り込みである。「表に書いてあるから」を理由に
 *    無視されるパラメータを受け取らない（受け取ると、効いていない絞り込みが画面から送られる）。
 * 🔴 ページングを持たない（#23 の response は `{ items }` であり `nextCursor` を持たない）。
 *    辞書は数十〜数百語の規模であり、`S-009` は 1 画面の表として全件を扱う。
 */
export const skillListQuerySchema = z.object({
  q: z.string().trim().max(QUERY_MAX_LENGTH).optional(),
});

export type SkillListQuery = z.infer<typeof skillListQuerySchema>;

export type SkillListQueryIsolationGuard = AssertNoIsolationKeys<SkillListQuery>;

assertNoIsolationKeys(Object.keys(skillListQuerySchema.shape), 'skillListQuerySchema');

/**
 * `GET /api/skill-aliases`（#23）の query。
 * 🔴 `status` はテナント別名・新語候補の状態（`PROPOSED` / `ACCEPTED` / `REJECTED`）であり、
 *    値集合の出所は `@ses/db` の `SKILL_ALIAS_STATUSES`（DB の CHECK と同じ 1 か所）である。
 */
export const skillAliasListQuerySchema = z.object({
  q: z.string().trim().max(QUERY_MAX_LENGTH).optional(),
  status: z.enum(SKILL_ALIAS_STATUSES).optional(),
});

export type SkillAliasListQuery = z.infer<typeof skillAliasListQuerySchema>;

export type SkillAliasListQueryIsolationGuard = AssertNoIsolationKeys<SkillAliasListQuery>;

assertNoIsolationKeys(Object.keys(skillAliasListQuerySchema.shape), 'skillAliasListQuerySchema');

/**
 * `POST /api/skill-aliases/{id}/decide`（#24）の path params。
 * 🔴 `id` は**操作対象の指定**であって実行者のスコープではない。母集団は RLS の C1 が決め、
 *    見えない ID は 404 になる（docs/05 §4.8）。
 */
export const skillAliasParamsSchema = z.object({ id: z.uuid() });

export type SkillAliasParams = z.infer<typeof skillAliasParamsSchema>;

export type SkillAliasParamsIsolationGuard = AssertNoIsolationKeys<SkillAliasParams>;

assertNoIsolationKeys(Object.keys(skillAliasParamsSchema.shape), 'skillAliasParamsSchema');

/**
 * `POST /api/skill-aliases/{id}/decide`（#24）の body。
 *
 * 🔴 `skillId` は**採用時の正規化先**（グローバル辞書の ID）である。`null` を既定にして
 *    「指定なし」と「REJECT」を同じ形で受け、組み合わせの妥当性は `policy.ts` が決める
 *    （`ACCEPT` に正規化先が無ければ 400、`REJECT` に正規化先が付いていても 400）。
 * 🔴 辞書に無い ID を弾くのはサービス層である（`skills` を読んで実在を確かめる）。
 *    **辞書そのものをここから作れる経路は無い**（`app_tenant` は `GRANT SELECT` のみ。
 *    migration 20260906000000 / `F-010 AC-2`）。
 */
export const skillAliasDecisionBodySchema = z.object({
  decision: z.enum(SKILL_ALIAS_DECISIONS),
  skillId: z.uuid().nullable().default(null),
});

export type SkillAliasDecisionBody = z.infer<typeof skillAliasDecisionBodySchema>;

export type SkillAliasDecisionBodyIsolationGuard = AssertNoIsolationKeys<SkillAliasDecisionBody>;

assertNoIsolationKeys(
  Object.keys(skillAliasDecisionBodySchema.shape),
  'skillAliasDecisionBodySchema',
);
