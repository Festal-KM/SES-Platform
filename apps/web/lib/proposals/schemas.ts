// apps/web/lib/proposals/schemas.ts
// docs/05 §6.5 #39 / #40（`POST` / `GET /api/proposals/{id}/gate`）の境界検証。T-07-08。
//
// 🔴 **#39 は body を持たない**（docs/05 §6.5 #39 の request 欄は空）。持たせないことが
//    `F-020 AC-2`（ゲート FAIL を無視して送信する経路を作らない）の一部である ——
//    `force` / `skipLayers` / `reason` のような「呼び出し側が挙動を変える入力」を
//    1 つでも受け取ると、そこがゲートを緩める入口になる。
// 🔴 **query も持たない**（`?force=true` は Zod のスキーマが無い以上ハンドラに 1 バイトも届かない）。
import { z } from 'zod';
import { assertNoIsolationKeys, type AssertNoIsolationKeys } from '../api/isolation-keys';

/**
 * `#39` / `#40` の path params。
 * 🔴 `id` は**操作対象の指定**であって実行者のスコープではない。母集団は `proposals` の RLS（C5）が
 *    決め、境界外の ID は 404 になる（docs/05 §4.8「見えない ＝ 存在しない」）。
 */
export const proposalParamsSchema = z.object({ id: z.uuid() });

export type ProposalParams = z.infer<typeof proposalParamsSchema>;

export type ProposalParamsIsolationGuard = AssertNoIsolationKeys<ProposalParams>;

assertNoIsolationKeys(Object.keys(proposalParamsSchema.shape), 'proposalParamsSchema');
