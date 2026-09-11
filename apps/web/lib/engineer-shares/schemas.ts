// apps/web/lib/engineer-shares/schemas.ts
// docs/05 §6.4 #29（`GET /api/engineer-shares` / `PUT /api/engineers/{id}/share`。
// `F-016` / `S-015`）の境界検証。T-08-02。
//
// 🔴 **body は `{ shared: boolean }` の 1 項目だけ**である（docs/05 §6.4 #29 の「入力」）。
//    足してはならないものと、その理由:
//      - `partnerCompanyId` / `tenantId` … 分離キーは認証コンテキストからしか来ない
//        （`CLAUDE.md` §3.1 / `BR-03`）。`assertNoIsolationKeys` が構築時に落とす。
//      - `engineerIds`（複数形）… 🔴 **一括で全件をオンにする既定操作を作らない**
//        （`F-016 AC-1` / `BR-53`）。対象は path の `{id}` 1 件だけであり、
//        **配列を受け取る形が存在しない**ことが「全部共有するボタン」を作れない理由になる。
//      - 開示項目の上書き（出す / 出さないの選択）… 🔴 開示は 5 項目で固定であり、
//        利用者にもテナントにも選ばせない（`BR-54` / `CLAUDE.md` §8.6）。
//      - 共有の有効期限・共有先パートナーの指定 … 経路 4 の読み手はホストだけであり
//        （`BR-56`）、宛先という概念が無い。
//
// 🔴 `GET /api/engineer-shares` に query を持たせない。検索・絞り込みは `S-005`（`#15`）の
//    仕事であり、本画面は「共有しているか / していないか」の 2 区分しか持たない
//    （`docs/04` §S-015 セクション 2・3）。
import { z } from 'zod';
import { assertNoIsolationKeys, type AssertNoIsolationKeys } from '../api/isolation-keys';

/** `PUT /api/engineers/{id}/share` の path（対象の指定であって実行者のスコープではない）。 */
export const engineerShareParamsSchema = z.object({ id: z.uuid() });

export type EngineerShareParams = z.infer<typeof engineerShareParamsSchema>;

export type EngineerShareParamsIsolationGuard = AssertNoIsolationKeys<EngineerShareParams>;

assertNoIsolationKeys(Object.keys(engineerShareParamsSchema.shape), 'engineerShareParamsSchema');

/**
 * `PUT /api/engineers/{id}/share` の body。
 *
 * 🔴 `shared` は**必須**である（`.optional()` にしない）。省略を「オン」と解釈する余地を
 *    1 つも残さない —— 既定オフ（`F-016 AC-1`）は「行の非存在」で表現されており、
 *    省略時の既定値を書いた瞬間にその表現が破れる。
 */
export const engineerShareBodySchema = z.object({ shared: z.boolean() });

export type EngineerShareBody = z.infer<typeof engineerShareBodySchema>;

export type EngineerShareBodyIsolationGuard = AssertNoIsolationKeys<EngineerShareBody>;

assertNoIsolationKeys(Object.keys(engineerShareBodySchema.shape), 'engineerShareBodySchema');
