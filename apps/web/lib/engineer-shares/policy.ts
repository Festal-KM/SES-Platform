// apps/web/lib/engineer-shares/policy.ts
// 匿名共有（越境経路 4）の設定を行えるロール（docs/05 §6.4 #29 の認可 /
// `docs/04` §S-015 権限差分 / `docs/02` `F-016` 関連ロール）。T-08-02。
//
// 🔴 なぜ定数を切り出すか（`lib/projects/policy.ts` と同じ理由）: 同じロール一覧を
//    ①Route Handler の `requireRole`（`#29` の GET / PUT）②`S-015` の到達判定
//    ③`S-004`（取引先ホーム）の導線の有無 の 3 か所が見る。書き写すと 1 つだけが緩み、
//    「画面には出ないが API は通る」/「API は拒否するのに画面は開く」が静かに成立する。
import type { TenantRole } from '@ses/db';

/**
 * 🔴 匿名共有の設定を読み書きできるロール（docs/05 §6.4 #29「**`PARTNER_ADMIN` /
 *    `PARTNER_SALES` のみ**。ホストは 403」/ `docs/04` §S-015 権限差分 /
 *    `F-016` 関連ロール「ホスト側ロールはこの設定を変更できない」）。
 *
 * 🔴 **ホストのロール（`OWNER` / `ADMIN` / `SALES`）を含まない。** 経路 4 の
 *    **主導権は最後まで取引先にある**（`CLAUDE.md` §3.1 経路 4「共有は既定オフ。
 *    パートナーの明示的な opt-in でのみ有効になる」）。ホストが自分で共有を有効化できる
 *    経路を作った時点で、取引先の台帳を実質的に開けることになる。
 *    担保は 3 枚: ①本定数を見る `requireRole`（403）②`setEngineerShare` /
 *    `listEngineerShares` の `assertPartnerContext`（所属の軸。ロールとは別）
 *    ③`engineer_shares` の RLS（C3 OWNER_SCOPED。ホスト文脈では
 *    `partner_company_id IS NOT DISTINCT FROM NULL` が常に偽で 0 件・書込不可）。
 * 🔴 `VIEWER` を含まない（`BR-31` / `F-004 AC-6` / `docs/04` §S-015
 *    「`VIEWER`（パートナー所属）は共有設定を変更できない」）。
 *    ⚠️ **現時点で「パートナー所属の `VIEWER`」は存在しない。** `CLAUDE.md` §10.1 は
 *    `VIEWER` を**ホスト所属専用**と定め、`memberships_partner_role_check`
 *    （migration 20260903000000）が `role IN ('PARTNER_ADMIN','PARTNER_SALES') =
 *    (partner_company_id IS NOT NULL)` を DB で強制している。したがって `docs/04` §S-015 の
 *    当該記述は、本定数が `VIEWER` を含まないことで**二重に**満たされる。
 * 🔴 **`PARTNER_VIEWER`（Phase 2 の `T-16-12`。[Issue #34](https://github.com/Festal-KM/SES-Platform/issues/34)）が
 *    入るときも、ここに足さない。** 閲覧専用ロールの規律は「承認・送信・ダウンロードは
 *    一切不可」であり、共有の設定は**ホストの候補一覧に人を出す実行系**である。
 *    足すとすれば「画面を開けるロール」の側であって、本定数ではない。
 *
 * 🔴 並び順は `TENANT_ROLES`（`@ses/db`）と同じにする（`PROJECT_EDITOR_ROLES` と同じ理由）。
 */
export const ENGINEER_SHARE_ROLES = [
  'PARTNER_ADMIN',
  'PARTNER_SALES',
] as const satisfies readonly TenantRole[];

export function isEngineerShareRole(role: TenantRole): boolean {
  return (ENGINEER_SHARE_ROLES as readonly TenantRole[]).includes(role);
}
