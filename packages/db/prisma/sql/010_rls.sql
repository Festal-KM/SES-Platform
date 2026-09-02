-- packages/db/prisma/sql/010_rls.sql
-- docs/05 §4.4（RLS ポリシー）/ §4.2・§5.2（GRANT）を、現時点の最小 2 表に対して適用する。
--
-- 🔴 このファイルは CREATE ROLE を含まない。5 ロールの定義は
--    packages/db/prisma/sql/000_roles.sql が唯一の真実（T-01-05。docs/05 §4.2）であり、
--    実行前に 000_roles.sql が適用済み（5 ロールが存在する）ことが前提。
--
-- 🔴 SP-02 で全 56 表に拡張するときは prisma/migrations/** の migration.sql へ移す
--    （docs/05 §2.1「RLS / ロール / トリガ / パーティションも SQL で含む」）。
--
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
--    ライフサイクル列の列レベル UPDATE のみを許す。現時点で存在するライフサイクル列は
--    lifecycle_state のみ（他の列は SP-02 でスキーマが増えたときに GRANT を追加する）。
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
GRANT UPDATE (lifecycle_state) ON tenants TO app_platform_write;

RESET ROLE;
