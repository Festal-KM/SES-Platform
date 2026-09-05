// apps/web/lib/api/isolation-keys.ts
// 🔴 CLAUDE.md §3.1 / BR-03 / F-003 AC-1 / F-004 AC-2:
//    **分離キーをリクエストの body / query / path から受け取らない。**
//    「Zod スキーマにそのキーを持たない」ことを、コメントではなく**型**で固定する。
//
// 使い方:
//   type _Guard = AssertNoIsolationKeys<z.infer<typeof signInBodySchema>>;
// スキーマに `tenantId` などを足した瞬間、この行がコンパイルエラーになる。
//
// 🔴 T-03-04（`withApiRoute`）は params / query / body の 3 面すべてに同じガードを掛ける。
//    ガードの実装を増やさず、この 1 ファイルを共有する。

/**
 * 🔴 リクエスト入力に現れてはならないキー。
 *    増やすのは構わないが、**減らすことは情報境界の前提を変える**（CLAUDE.md §8.6）。
 */
export const ISOLATION_KEYS = [
  'tenantId',
  'tenant_id',
  'partnerCompanyId',
  'partner_company_id',
  'ownerPartnerCompanyId',
  'owner_partner_company_id',
  'counterpartyPartnerCompanyId',
  'counterparty_partner_company_id',
] as const;

export type IsolationKey = (typeof ISOLATION_KEYS)[number];

/**
 * 🔴 T-04-07（`#14` のキー名の決着。docs/05 §6.4 #14 / `F-007`）:
 *    **「実行者の分離キー」と「操作対象の選択」を、キー名で恒久的に区別する。**
 *
 * docs/05 §6.4 #14 の request は `{ email, role, partnerCompanyId? }` と書かれているが、
 * `partnerCompanyId` は上の `ISOLATION_KEYS` が禁じるキーそのものであり、そのまま足すと
 * `withApiRoute` の構築時に落ちる（T-03-03 が意図して残した強制装置）。3 つの案を検討した:
 *
 *   (a) `ISOLATION_KEYS` から `partnerCompanyId` を外す / 例外条件を足す
 *       → 🔴 **採らない。** 全 API に効いている 1 本のガードを、1 つの API のために緩める
 *         ことになる。以後「このルートでは許される」の判断がレビュー任せになり、
 *         いつか実行者のスコープを body で受け取るルートが混ざる（`CLAUDE.md` §3.1 / `BR-03`）。
 *   (b) ルート単位でガードを無効化できる口を `withApiRoute` に足す
 *       → 🔴 **採らない。** (a) と同じ問題に加え、「無効化されているルート」を数える手段が減る。
 *   (c) **キー名を分ける**（`targetPartnerCompanyId`）→ 採用。
 *
 * (c) が正しいのは、両者が**別の概念**だからである:
 *   - `partnerCompanyId`（禁止）… **実行者自身の所属**。参照範囲を決める値であり、
 *     `ctx` 以外から来てはならない。
 *   - `targetPartnerCompanyId`（許可）… **招待先の選択**。ホストの `OWNER` / `ADMIN` が
 *     「どの取引先に招待を出すか」を選ぶ業務入力であり、参照範囲は決めない。
 *
 * 🔴 したがって、このキーを受け取るルートには次の 2 つが**必ず**要る（片方でも欠けたら
 *    実質的に (a) と同じになる）:
 *   ① 実行者のスコープは引き続き `ctx` だけから決まること（`decideInvitation` は
 *     `PARTNER_ADMIN` の指定値を採用せず、常に `ctx.partnerCompanyId` を使う）。
 *   ② 指定された ID を、**`withTenant` の内側で母集団（RLS）に照合してから使う**こと。
 *     照合しないと、他テナントの取引先企業の ID を書き込めてしまう
 *     （`invitations.partner_company_id` の FK はテナントをまたいでも成立する）。
 *     見えなければ 404（`docs/05` §4.8「見えない ＝ 存在しない」）。
 *
 * 🔴 ここに名前を足すことは「リクエスト入力で対象を選べる操作」を増やすことである。
 *    足すときは上の ①② を満たすことを確認し、理由をこのコメントに書く。
 */
export const TARGET_SELECTION_KEYS = ['targetPartnerCompanyId'] as const;

export type TargetSelectionKey = (typeof TARGET_SELECTION_KEYS)[number];

/**
 * `T` が分離キーを 1 つでも持っていたら `never` に潰れる型。
 * 型引数の位置で使うと、違反したスキーマは代入不能になりコンパイルが落ちる。
 */
export type AssertNoIsolationKeys<T> = Extract<keyof T, IsolationKey> extends never
  ? T
  : never;

/**
 * 実行時の対照検査（型テストが空振りしていないことの担保 + 動的に組んだスキーマ用）。
 * 🔴 検出したら黙って無視せず throw する（fail-closed）。
 */
export function assertNoIsolationKeys(shapeKeys: readonly string[], label: string): void {
  const found = shapeKeys.filter((key) => (ISOLATION_KEYS as readonly string[]).includes(key));
  if (found.length > 0) {
    throw new Error(
      `${label}: リクエスト入力に分離キーを持たせることはできません（${found.join(', ')}）。` +
        'テナント / パートナー所属は認証コンテキストからのみ決まる（CLAUDE.md §3.1 / BR-03）。',
    );
  }
}
