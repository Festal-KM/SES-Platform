-- T-03-10: 組織設定（`S-035` / docs/05 §6.3 #64 `GET/PATCH /api/settings/organization`）を
-- テナント側から更新できるようにする。
--
-- ============================================================================
-- 🔴 なぜ新しい GRANT が要るか
-- ============================================================================
-- 20260903050000 §13 は `GRANT SELECT ON tenants TO app_tenant`（読み取りのみ）で止めていた。
-- docs/05 §4.2 の「`tenants` は `SELECT` のみ」は **`lifecycle_state` を書かせない**ための
-- 規律であり（`CLAUDE.md` §4.2「テナント側のロール〔`OWNER` を含む〕はこの状態を変更できない」）、
-- 「組織設定を一切変更できない」という意味ではない。#64 の PATCH（`{ name?,
-- autoApproveEnabled?, piiRetentionYears? }`）は `OWNER` / `ADMIN` の正当な操作である。
--
-- ============================================================================
-- 🔴 `lifecycleState` の読み取り専用を **DB 権限**で担保する（docs/05 §6.3 #64）
-- ============================================================================
-- 列レベル GRANT を使い、書ける列を **3 列ちょうど**に固定する。
--   - `lifecycle_state` / `lifecycle_changed_at` / `lifecycle_changed_by` / `suspend_reason` /
--     `sandbox_expires_at` / `closing_entered_at` … `app_platform_write` だけが書ける（§5.2）
--   - `environment` / `provisioning_request_id` / `created_by_platform_user_id` … 開設時にしか
--     書けない（`app_tenant` にも `app_platform_write` の UPDATE にも含めない）
--   - `timezone` … #64 の PATCH の body に無い（`S-035` の表示のみ）。**先回りして開かない**
-- アプリ側のスキーマ（Zod）が緩んでも、DB が `permission denied` を返す（二重防御）。
--
-- 🔴 ポリシーに `app_is_host()` を含める理由: `PARTNER_ADMIN` は `S-035` に到達しない
--    （`F-002 AC-4`）。ルートのロールガードが唯一の防御にならないよう、RLS でも閉じる。

DROP POLICY IF EXISTS tenants_c1_update ON tenants;
CREATE POLICY tenants_c1_update ON tenants FOR UPDATE TO app_tenant
  USING (id = app_tenant_id() AND app_is_host())
  WITH CHECK (id = app_tenant_id() AND app_is_host());

-- 🔴 テーブル単位の GRANT を使わない（列を列挙する）。テーブル単位にすると、後から追加された
--    列が自動的にテナント側から書けるようになる（`tenants` にはライフサイクル列が同居する）。
GRANT UPDATE (name, auto_approve_enabled, pii_retention_years) ON tenants TO app_tenant;
