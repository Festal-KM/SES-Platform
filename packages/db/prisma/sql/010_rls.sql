-- packages/db/prisma/sql/010_rls.sql
-- docs/05 §4.4（RLS ポリシー）/ §4.2（GRANT）を、T-01-04 の最小 2 表に対して適用する。
--
-- 🔴 このファイルは CREATE ROLE を含まない。ロールの作成と本番のパスワード管理は
--    T-01-05（docs/05 §4.2 の 5 ロール）の範囲であり、ここでロールを作ると
--    「アプリのマイグレーションがロールを握る」設計になってしまう。
--    実行前に app_migrator / app_tenant が存在していることが前提。
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

RESET ROLE;
