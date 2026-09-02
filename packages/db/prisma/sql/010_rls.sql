-- packages/db/prisma/sql/010_rls.sql
-- docs/05 §4.4（RLS ポリシー）/ §4.2・§5.2（GRANT）を、現時点のスキーマに対して適用する。
--
-- 🔴 このファイルは CREATE ROLE を含まない。5 ロールの定義は
--    packages/db/prisma/sql/000_roles.sql が唯一の真実（T-01-05。docs/05 §4.2）であり、
--    実行前に 000_roles.sql が適用済み（5 ロールが存在する）ことが前提。
--
-- 🔴 SP-02 で全 56 表に拡張するときは prisma/migrations/** の migration.sql へ移す
--    （docs/05 §2.1「RLS / ロール / トリガ / パーティションも SQL で含む」）。
--
-- 🔴 T-02-01（docs/05 §3.3）で追加した 6 表（users / memberships / partner_companies /
--    invitations / two_factor_credentials / tenant_sending_domains）は、C0〜C8 のポリシー本体
--    （T-02-06 の範囲）をまだ持たない。「ポリシーが無い業務テーブルを放置しない」ため、
--    ENABLE + FORCE ROW LEVEL SECURITY だけを先に付け、ポリシー 0 件 = 常に 0 行
--    （app_tenant からは何も見えない・何も書けない。FORCE により所有者 app_migrator も同様）
--    という安全側のデフォルトにする。GRANT も追加しない（ポリシーが無ければ意味を持たないため）。
--    C0〜C8 の本適用は T-02-06 で行う。
-- 🔴 T-02-02（docs/05 §3.4 / §3.5）で追加した 10 表（skill_aliases / engineer_skills /
--    skill_sheets / skill_sheet_extractions / file_scan_results / projects /
--    project_requirements / project_visibilities / engineer_shares / match_candidates）も
--    同じ fail-closed 既定（ENABLE + FORCE のみ。ポリシー・GRANT 無し）にする。
--    `skills` は対象外（CLAUDE.md §3.1 射程外の 4 表の 1 つ。グローバルマスタであり RLS を
--    一切適用しない。docs/05 §4.4「射程外の 4 表」/ §4.7 BUSINESS_TABLE_EXCLUSIONS）。
-- 🔴 T-02-03（docs/05 §3.6）で追加した 5 表（proposal_requests / proposals /
--    engineer_snapshots / proposal_events / review_gates）も同じ fail-closed 既定
--    （ENABLE + FORCE のみ。C5 PARTY 等のポリシー本体・GRANT は T-02-06 / T-02-07）。
-- テーブル所有者として実行する（docs/05 §4.2「テーブル所有者は app_migrator であり、
-- FORCE ROW LEVEL SECURITY を全業務テーブルに付ける。これが無いと所有者が RLS を素通りする」）。
SET ROLE app_migrator;

-- --- ヘルパ関数（docs/05 §4.4。SECURITY INVOKER。ポリシーからのみ使う）-------------------
-- 🔴 未設定時に例外を投げない（current_setting の第 2 引数 true）。二重防御テスト #2
--    「SET LOCAL を発行せずにクエリする」で NULL になり、ポリシー式が真にならないことが要件。
CREATE OR REPLACE FUNCTION app_tenant_id() RETURNS uuid LANGUAGE sql STABLE AS
  $$ SELECT NULLIF(current_setting('app.tenant_id', true), '')::uuid $$;

CREATE OR REPLACE FUNCTION app_partner_id() RETURNS uuid LANGUAGE sql STABLE AS
  $$ SELECT NULLIF(current_setting('app.partner_company_id', true), '')::uuid $$;

CREATE OR REPLACE FUNCTION app_is_host() RETURNS boolean LANGUAGE sql STABLE AS
  $$ SELECT app_partner_id() IS NULL $$;

CREATE OR REPLACE FUNCTION app_actor_user_id() RETURNS uuid LANGUAGE sql STABLE AS
  $$ SELECT NULLIF(current_setting('app.actor_user_id', true), '')::uuid $$;

-- --- RLS の有効化（docs/05 §4.1 第 1 防御）-----------------------------------------------
ALTER TABLE tenants   ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenants   FORCE  ROW LEVEL SECURITY;
ALTER TABLE engineers ENABLE ROW LEVEL SECURITY;
ALTER TABLE engineers FORCE  ROW LEVEL SECURITY;

-- 🔴 T-02-01: 新規 6 表は ENABLE + FORCE のみ（ポリシー本体・GRANT は T-02-06）。
ALTER TABLE users                   ENABLE ROW LEVEL SECURITY;
ALTER TABLE users                   FORCE  ROW LEVEL SECURITY;
ALTER TABLE memberships             ENABLE ROW LEVEL SECURITY;
ALTER TABLE memberships             FORCE  ROW LEVEL SECURITY;
ALTER TABLE partner_companies       ENABLE ROW LEVEL SECURITY;
ALTER TABLE partner_companies       FORCE  ROW LEVEL SECURITY;
ALTER TABLE invitations             ENABLE ROW LEVEL SECURITY;
ALTER TABLE invitations             FORCE  ROW LEVEL SECURITY;
ALTER TABLE two_factor_credentials  ENABLE ROW LEVEL SECURITY;
ALTER TABLE two_factor_credentials  FORCE  ROW LEVEL SECURITY;
ALTER TABLE tenant_sending_domains  ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_sending_domains  FORCE  ROW LEVEL SECURITY;

-- 🔴 T-02-02: 新規 10 表も ENABLE + FORCE のみ（ポリシー本体・GRANT は T-02-06 / T-02-07）。
--    `skills` は含めない（射程外の 4 表。RLS を一切適用しない）。
ALTER TABLE skill_aliases           ENABLE ROW LEVEL SECURITY;
ALTER TABLE skill_aliases           FORCE  ROW LEVEL SECURITY;
ALTER TABLE engineer_skills         ENABLE ROW LEVEL SECURITY;
ALTER TABLE engineer_skills         FORCE  ROW LEVEL SECURITY;
ALTER TABLE skill_sheets            ENABLE ROW LEVEL SECURITY;
ALTER TABLE skill_sheets            FORCE  ROW LEVEL SECURITY;
ALTER TABLE skill_sheet_extractions ENABLE ROW LEVEL SECURITY;
ALTER TABLE skill_sheet_extractions FORCE  ROW LEVEL SECURITY;
ALTER TABLE file_scan_results       ENABLE ROW LEVEL SECURITY;
ALTER TABLE file_scan_results       FORCE  ROW LEVEL SECURITY;
ALTER TABLE projects                ENABLE ROW LEVEL SECURITY;
ALTER TABLE projects                FORCE  ROW LEVEL SECURITY;
ALTER TABLE project_requirements    ENABLE ROW LEVEL SECURITY;
ALTER TABLE project_requirements    FORCE  ROW LEVEL SECURITY;
ALTER TABLE project_visibilities    ENABLE ROW LEVEL SECURITY;
ALTER TABLE project_visibilities    FORCE  ROW LEVEL SECURITY;
ALTER TABLE engineer_shares         ENABLE ROW LEVEL SECURITY;
ALTER TABLE engineer_shares         FORCE  ROW LEVEL SECURITY;
ALTER TABLE match_candidates        ENABLE ROW LEVEL SECURITY;
ALTER TABLE match_candidates        FORCE  ROW LEVEL SECURITY;

-- 🔴 T-02-03: 新規 5 表も ENABLE + FORCE のみ（ポリシー本体・GRANT は T-02-06 / T-02-07）。
ALTER TABLE proposal_requests       ENABLE ROW LEVEL SECURITY;
ALTER TABLE proposal_requests       FORCE  ROW LEVEL SECURITY;
ALTER TABLE proposals               ENABLE ROW LEVEL SECURITY;
ALTER TABLE proposals               FORCE  ROW LEVEL SECURITY;
ALTER TABLE engineer_snapshots      ENABLE ROW LEVEL SECURITY;
ALTER TABLE engineer_snapshots      FORCE  ROW LEVEL SECURITY;
ALTER TABLE proposal_events         ENABLE ROW LEVEL SECURITY;
ALTER TABLE proposal_events         FORCE  ROW LEVEL SECURITY;
ALTER TABLE review_gates            ENABLE ROW LEVEL SECURITY;
ALTER TABLE review_gates            FORCE  ROW LEVEL SECURITY;

-- 🔴 T-02-04（docs/05 §3.7）で追加した 9 表も同じ fail-closed 既定
--    （ENABLE + FORCE のみ。C2/C5/C6/C9 のポリシー本体・GRANT・射影ビュー 4 本は T-02-06 / T-02-07）。
--    当事者列（counterparty_partner_company_id）を持つ 4 表（assignments / contracts /
--    contract_documents / orders）も例外なく含める。
ALTER TABLE chat_threads            ENABLE ROW LEVEL SECURITY;
ALTER TABLE chat_threads            FORCE  ROW LEVEL SECURITY;
ALTER TABLE thread_participants     ENABLE ROW LEVEL SECURITY;
ALTER TABLE thread_participants     FORCE  ROW LEVEL SECURITY;
ALTER TABLE messages                ENABLE ROW LEVEL SECURITY;
ALTER TABLE messages                FORCE  ROW LEVEL SECURITY;
ALTER TABLE contracts               ENABLE ROW LEVEL SECURITY;
ALTER TABLE contracts               FORCE  ROW LEVEL SECURITY;
ALTER TABLE contract_documents      ENABLE ROW LEVEL SECURITY;
ALTER TABLE contract_documents      FORCE  ROW LEVEL SECURITY;
ALTER TABLE contract_templates      ENABLE ROW LEVEL SECURITY;
ALTER TABLE contract_templates      FORCE  ROW LEVEL SECURITY;
ALTER TABLE orders                  ENABLE ROW LEVEL SECURITY;
ALTER TABLE orders                  FORCE  ROW LEVEL SECURITY;
ALTER TABLE assignments             ENABLE ROW LEVEL SECURITY;
ALTER TABLE assignments             FORCE  ROW LEVEL SECURITY;
ALTER TABLE extension_reviews       ENABLE ROW LEVEL SECURITY;
ALTER TABLE extension_reviews       FORCE  ROW LEVEL SECURITY;

-- 🔴 T-02-05（docs/05 §3.8 / §3.9 / §3.10）で追加した 23 表のうち 20 表も同じ fail-closed 既定
--    （ENABLE + FORCE のみ。C0〜C2 のポリシー本体・GRANT は T-02-06）。
--    `platform_users` / `plans` / `subscriptions` は対象外（CLAUDE.md §3.1 射程外の 4 表のうちの
--    3 つ。`skills` と同じく RLS を一切適用しない）。
--    🔴 `audit_logs` は PARTITION BY RANGE (created_at) の親表であり、親に対する
--    ENABLE + FORCE だけで足りる（パーティション経由の直接アクセスは GRANT が無いため別途
--    permission denied になる。実測で確認済み。プログラマ完了報告参照）。個々のパーティション
--    （audit_logs_2026_09 等）へ ENABLE/FORCE を明示的に適用する必要はない。
ALTER TABLE tasks                    ENABLE ROW LEVEL SECURITY;
ALTER TABLE tasks                    FORCE  ROW LEVEL SECURITY;
ALTER TABLE notifications            ENABLE ROW LEVEL SECURITY;
ALTER TABLE notifications            FORCE  ROW LEVEL SECURITY;
ALTER TABLE ai_usage                 ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_usage                 FORCE  ROW LEVEL SECURITY;
ALTER TABLE audit_logs               ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_logs               FORCE  ROW LEVEL SECURITY;
ALTER TABLE usage_counters           ENABLE ROW LEVEL SECURITY;
ALTER TABLE usage_counters           FORCE  ROW LEVEL SECURITY;
ALTER TABLE tenant_esign_connections ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_esign_connections FORCE  ROW LEVEL SECURITY;
ALTER TABLE send_attempts            ENABLE ROW LEVEL SECURITY;
ALTER TABLE send_attempts            FORCE  ROW LEVEL SECURITY;
ALTER TABLE email_dispatches         ENABLE ROW LEVEL SECURITY;
ALTER TABLE email_dispatches         FORCE  ROW LEVEL SECURITY;
ALTER TABLE email_events             ENABLE ROW LEVEL SECURITY;
ALTER TABLE email_events             FORCE  ROW LEVEL SECURITY;
ALTER TABLE webhook_deliveries       ENABLE ROW LEVEL SECURITY;
ALTER TABLE webhook_deliveries       FORCE  ROW LEVEL SECURITY;
ALTER TABLE data_export_requests     ENABLE ROW LEVEL SECURITY;
ALTER TABLE data_export_requests     FORCE  ROW LEVEL SECURITY;
ALTER TABLE tenant_purge_runs        ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_purge_runs        FORCE  ROW LEVEL SECURITY;
ALTER TABLE scheduler_runs           ENABLE ROW LEVEL SECURITY;
ALTER TABLE scheduler_runs           FORCE  ROW LEVEL SECURITY;
ALTER TABLE impersonation_sessions   ENABLE ROW LEVEL SECURITY;
ALTER TABLE impersonation_sessions   FORCE  ROW LEVEL SECURITY;
ALTER TABLE announcements            ENABLE ROW LEVEL SECURITY;
ALTER TABLE announcements            FORCE  ROW LEVEL SECURITY;
ALTER TABLE tenant_role_approval_modes ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_role_approval_modes FORCE  ROW LEVEL SECURITY;
ALTER TABLE tenant_role_models       ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_role_models       FORCE  ROW LEVEL SECURITY;
ALTER TABLE tenant_match_weights     ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_match_weights     FORCE  ROW LEVEL SECURITY;
ALTER TABLE tenant_monthly_costs     ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_monthly_costs     FORCE  ROW LEVEL SECURITY;
ALTER TABLE billing_meter_submissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE billing_meter_submissions FORCE  ROW LEVEL SECURITY;

-- --- C1 TENANT_ALL: tenants（<T> = id。app_tenant は SELECT のみ）------------------------
DROP POLICY IF EXISTS tenants_c1_select ON tenants;
CREATE POLICY tenants_c1_select ON tenants
  FOR SELECT USING (id = app_tenant_id());

-- --- C3 OWNER_SCOPED: engineers（<O> = owner_partner_company_id）-------------------------
-- USING / WITH CHECK ともに同じ式（docs/05 §4.4「WITH CHECK の既定は USING と同じ式」。
-- engineers は「自分の所属としてしか書けない」4 表の 1 つでもあるため C3 式のままでよい）。
DROP POLICY IF EXISTS engineers_c3_select ON engineers;
CREATE POLICY engineers_c3_select ON engineers
  FOR SELECT USING (
    tenant_id = app_tenant_id()
    AND owner_partner_company_id IS NOT DISTINCT FROM app_partner_id()
  );

DROP POLICY IF EXISTS engineers_c3_insert ON engineers;
CREATE POLICY engineers_c3_insert ON engineers
  FOR INSERT WITH CHECK (
    tenant_id = app_tenant_id()
    AND owner_partner_company_id IS NOT DISTINCT FROM app_partner_id()
  );

DROP POLICY IF EXISTS engineers_c3_update ON engineers;
CREATE POLICY engineers_c3_update ON engineers
  FOR UPDATE USING (
    tenant_id = app_tenant_id()
    AND owner_partner_company_id IS NOT DISTINCT FROM app_partner_id()
  ) WITH CHECK (
    tenant_id = app_tenant_id()
    AND owner_partner_company_id IS NOT DISTINCT FROM app_partner_id()
  );

DROP POLICY IF EXISTS engineers_c3_delete ON engineers;
CREATE POLICY engineers_c3_delete ON engineers
  FOR DELETE USING (
    tenant_id = app_tenant_id()
    AND owner_partner_company_id IS NOT DISTINCT FROM app_partner_id()
  );

-- --- GRANT（docs/05 §4.2）----------------------------------------------------------------
-- app_tenant: 業務テーブルへの SELECT/INSERT/UPDATE/DELETE。🔴 tenants は SELECT のみ。
GRANT USAGE ON SCHEMA public TO app_tenant;
GRANT SELECT ON tenants TO app_tenant;
GRANT SELECT, INSERT, UPDATE, DELETE ON engineers TO app_tenant;
GRANT EXECUTE ON FUNCTION app_tenant_id(), app_partner_id(), app_is_host(), app_actor_user_id() TO app_tenant;

-- --- 管理平面用の RLS ポリシー（docs/05 §5.2。app_platform / app_platform_write にのみ適用）-----
-- 🔴 GRANT だけでは行を返さない/書けない。FORCE ROW LEVEL SECURITY の下では、ポリシーが
--    無ければ GRANT があっても SELECT は 0 件・INSERT/UPDATE は WITH CHECK 違反で全拒否になる。
--    ポリシーと GRANT は対で「読み取り専用」「6 領域のみ」の担保を構成する。
--
-- 🔴 app.platform_user_id / app.target_tenant_id は withPlatformRead / withPlatformWrite
--    （T-03-08）が SET LOCAL する GUC。本タスクではポリシーと GRANT の存在・内容のみを
--    整備し、実際に発行する側の実装は SP-03 の範囲。
DROP POLICY IF EXISTS tenants_platform_read ON tenants;
CREATE POLICY tenants_platform_read ON tenants FOR SELECT TO app_platform
  USING (
    current_setting('app.platform_user_id', true) <> ''
    AND (
      current_setting('app.target_tenant_id', true) = ''
      OR id::text = current_setting('app.target_tenant_id', true)
    )
  );

-- 🔴 tenants は §5.2 が挙げる 3 表のうちの 1 表。INSERT（全列。API-A4）と
--    ライフサイクル列の列レベル UPDATE のみを許す。T-02-01 で lifecycle_changed_at /
--    lifecycle_changed_by / suspend_reason / sandbox_expires_at / closing_entered_at が
--    増えたため、下の GRANT UPDATE 対象に含める（docs/05 §5.2 の列挙どおり）。
--    name / environment は開設時にしか書けない（UPDATE の GRANT に含めない）。
DROP POLICY IF EXISTS tenants_platform_write_insert ON tenants;
CREATE POLICY tenants_platform_write_insert ON tenants FOR INSERT TO app_platform_write
  WITH CHECK (current_setting('app.platform_user_id', true) <> '');

DROP POLICY IF EXISTS tenants_platform_write_update ON tenants;
CREATE POLICY tenants_platform_write_update ON tenants FOR UPDATE TO app_platform_write
  USING (current_setting('app.platform_user_id', true) <> '')
  WITH CHECK (current_setting('app.platform_user_id', true) <> '');

DROP POLICY IF EXISTS engineers_platform_read ON engineers;
CREATE POLICY engineers_platform_read ON engineers FOR SELECT TO app_platform
  USING (
    current_setting('app.platform_user_id', true) <> ''
    AND (
      current_setting('app.target_tenant_id', true) = ''
      OR tenant_id::text = current_setting('app.target_tenant_id', true)
    )
  );
-- 🔴 engineers は業務テーブル（§5.2 の 3 表に含まれない）。app_platform_write に
--    INSERT/UPDATE/DELETE のいずれも GRANT しない。書込ポリシーも作らない。

-- app_platform: 業務テーブルへの SELECT のみ（docs/05 §4.2 / §5.2）。
-- 🔴 engineers は列を列挙して GRANT する（docs/05 §5.5 第 1 層）。display_name は
--    CLAUDE.md §10.5「運営者にも見せないもの: エンジニアの氏名」に該当するため除外する
--    （§5.5 の非開示列一覧。現行スキーマに存在する列のうち display_name のみが該当）。
GRANT SELECT ON tenants TO app_platform;
GRANT SELECT (id, tenant_id, owner_partner_company_id, created_at, updated_at) ON engineers TO app_platform;

-- app_platform_write: tenants の INSERT + lifecycle_state の列レベル UPDATE のみ。
-- 🔴 engineers を含む他の業務テーブルには一切 GRANT しない（docs/05 §5.2「業務テーブルへの
--    書き込み権限を一切持たない」）。
GRANT INSERT ON tenants TO app_platform_write;
GRANT UPDATE (
  lifecycle_state, lifecycle_changed_at, lifecycle_changed_by,
  suspend_reason, sandbox_expires_at, closing_entered_at
) ON tenants TO app_platform_write;

RESET ROLE;
