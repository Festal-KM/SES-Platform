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
