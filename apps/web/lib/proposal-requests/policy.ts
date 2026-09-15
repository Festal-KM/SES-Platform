// apps/web/lib/proposal-requests/policy.ts
// 提案依頼を発行・取り下げできるロール（docs/05 §6.5 #31 / #35 の認可 / `docs/02` `F-018` 関連ロール /
// `docs/04` §S-016 権限差分）。T-08-06。
//
// 🔴 なぜ定数を切り出すか（`lib/engineer-shares/policy.ts` と同じ理由）: 同じロール一覧を
//    ①Route Handler の `requireRole`（`#31` / `#35`）②`S-016` の依頼導線の有無 ③`S-017` の
//    取り下げ導線の有無 の 3 か所が見る。書き写すと 1 つだけが緩み、「画面には出ないが API は通る」/
//    「API は拒否するのに画面は開く」が静かに成立する。
import type { TenantRole } from '@ses/db';

/**
 * 🔴 提案依頼を発行・取り下げできるロール（docs/05 §6.5 #31「`OWNER`/`ADMIN`/`SALES`」/
 *    `F-018` 関連ロール「`OWNER` / `ADMIN` / `SALES`（発行・取り下げ）」）。
 *
 * 🔴 **パートナーロールを含まない。** 経路 4 の読み手はホストだけであり（`BR-56`）、依頼を出すのも
 *    ホストだけである。パートナーが本 API に到達すると、他社の共有候補に依頼を出す経路になる。
 *    担保は 3 枚: ①本定数を見る `requireRole`（403）②`withSharedCandidateScope` の `requireHost`
 *    （所属の軸。ロールとは別。パートナー文脈は 404 に写像される）③`match_candidates` の RLS
 *    （C2 HOST_ONLY。パートナー文脈では逆引きの母集団が 0 件）。
 * 🔴 `VIEWER` を含まない（`BR-31` / `F-004 AC-6` / `docs/04` §S-016「`VIEWER` は提案作成・提案依頼の
 *    導線が無い」）。`requireNotViewer` と二重に落とす。
 *
 * 🔴 並び順は `TENANT_ROLES`（`@ses/db`）と同じにする（`PROJECT_EDITOR_ROLES` と同じ理由）。
 */
export const PROPOSAL_REQUEST_ISSUER_ROLES = [
  'OWNER',
  'ADMIN',
  'SALES',
] as const satisfies readonly TenantRole[];

export function isProposalRequestIssuerRole(role: TenantRole): boolean {
  return (PROPOSAL_REQUEST_ISSUER_ROLES as readonly TenantRole[]).includes(role);
}

/**
 * 🔴 T-08-07: 提案依頼に応諾・辞退できるロール（docs/05 §6.5 #33 / #34「`PA`/`PS`」/ `F-018` 関連ロール
 *    「`PARTNER_ADMIN` / `PARTNER_SALES`（応諾・辞退）」/ `docs/04` §S-018 権限差分）。
 *
 * 🔴 **ホストロールを含まない。** 応諾は「自社の人材の実名を開示する」判断であり、その主体は共有元の取引先
 *    だけである（`BR-57`）。ホストが応諾できると、匿名候補を自分で開示できる経路になる（`F-017 AC-6` 違反）。
 *    担保は 2 枚: ①本定数を見る `requireRole`（403）②`assertPartnerContext`（所属の軸。ホスト文脈は 404）。
 * 🔴 `VIEWER` を含まない（取引先所属の `VIEWER` は閲覧のみ。`docs/04` §S-018）。`requireNotViewer` と二重に落とす。
 */
export const PROPOSAL_REQUEST_RESPONDER_ROLES = [
  'PARTNER_ADMIN',
  'PARTNER_SALES',
] as const satisfies readonly TenantRole[];

export function isProposalRequestResponderRole(role: TenantRole): boolean {
  return (PROPOSAL_REQUEST_RESPONDER_ROLES as readonly TenantRole[]).includes(role);
}
