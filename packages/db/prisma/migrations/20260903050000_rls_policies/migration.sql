-- T-02-06（docs/sprints/SP-02-schema-isolation.md）: RLS ヘルパ関数とポリシークラス C0〜C8 の本適用。
-- 一次資料: docs/05 §4.4（クラス定義と適用テーブルの表）/ §4.4.2（テナント文脈を持たない経路）/
--           §4.2（DB ロールと GRANT）/ §5.2（分離バイパスと管理平面用ポリシー）/ §5.5（列レベル GRANT）。
--
-- 🔴 このファイルが RLS の唯一の定義である（docs/05 §2.1「RLS / ロール / トリガ / パーティションも
--    SQL で含む」）。T-01-05〜T-02-05 の間だけ暫定的に使っていた packages/db/prisma/sql/010_rls.sql は
--    本マイグレーションへ全内容を移設したうえで削除した。移設した理由:
--      ① 010_rls.sql は Testcontainers だけが適用しており、ローカル docker-compose と実デプロイでは
--         一度も適用されていなかった（= 本番相当の経路に RLS が入らない状態だった）
--      ② 適用順が「ロール → migrate deploy → 010_rls.sql」と 3 段になり、CI・ローカル・デプロイで
--         手順が食い違いうる。migrate deploy に含めれば「ロール → migrate deploy」の 2 段に固定できる
--    🔴 前提は 000_roles.sql（5 ロールの唯一の定義。docs/05 §4.2）が適用済みであること。
--       既存の migration（20260903040000）も `REVOKE ... FROM app_tenant` でロールの存在を前提にしており、
--       この前提は本ファイルで新たに増やしたものではない。
--
-- 🔴 ポリシーはすべて `TO app_tenant`（管理平面用は `TO app_platform` / `TO app_platform_write`）で
--    作る。ロール指定を省略（= TO PUBLIC）にすると、テナント用のポリシーが app_platform にも
--    permissive に OR 結合され、管理平面の読み取り範囲を静かに広げうるため。
--    テーブル所有者 app_migrator には適用ポリシーが 1 つも無く、FORCE ROW LEVEL SECURITY により
--    「所有者でも 0 件・書き込み不可」という fail-closed が保たれる（既存の制約テストの前提）。
--
-- 🔴 `USING (true)` は 1 件も書かない（docs/05 §4.7 テスト #3）。すべてのポリシー式が
--    app_tenant_id() を参照する。
--
-- 🔴 実装上の重要な帰結（PostgreSQL の仕様。T-02-06 で実測）:
--    **`INSERT ... RETURNING` には SELECT ポリシーが適用される。** Prisma の `create()` は常に
--    RETURNING を伴うため、「書けるが自分では読み返せない」行は `create()` では作れず、
--    `createMany()`（RETURNING 無し）を使う必要がある。該当するのは次の 2 つで、いずれも
--    仕様どおりの帰結である（ポリシーを緩めて解決しない）:
--      ① notifications … 他人宛の通知（INSERT は C1 式 / SELECT は C7 = 本人のみ）
--      ② audit_logs   … パートナーの操作の記録（INSERT は C1 / SELECT は C2 = ホストのみ）
--    回帰は tests/isolation/rls-classes.test.ts が両方向（createMany は成功 / create は失敗）で固定する。
--
-- 適用方法: `app_migrator`（MIGRATION_DATABASE_URL 相当）で `prisma migrate deploy`（docs/05 §4.2）。

-- ============================================================================
-- 1. ヘルパ関数（docs/05 §4.4。SECURITY INVOKER / STABLE。ポリシーからのみ使う）
-- ============================================================================
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

GRANT EXECUTE ON FUNCTION app_tenant_id(), app_partner_id(), app_is_host(), app_actor_user_id()
  TO app_tenant, app_platform, app_platform_write;

-- ============================================================================
-- 2. RLS の有効化（docs/05 §4.1 第 1 防御）
-- ============================================================================
-- 🔴 対象は「全 56 表 − 射程外の 4 表（skills / platform_users / plans / subscriptions）」の 52 表。
--    射程外の 4 表には RLS を一切適用しない（CLAUDE.md §3.1 / docs/05 §4.4「射程外の 4 表」）。
-- 🔴 audit_logs は PARTITION BY RANGE (created_at) の親表であり、親への ENABLE + FORCE だけで足りる
--    （T-02-05 実測。パーティションへの直接アクセスは GRANT が無いため permission denied になる）。
DO $do$
DECLARE
  t text;
  tables text[] := ARRAY[
    -- docs/05 §3.3
    'tenants', 'users', 'memberships', 'partner_companies', 'invitations',
    'two_factor_credentials', 'tenant_sending_domains',
    -- docs/05 §3.4
    'engineers', 'skill_aliases', 'engineer_skills', 'skill_sheets', 'file_scan_results',
    'skill_sheet_extractions',
    -- docs/05 §3.5
    'projects', 'project_requirements', 'project_visibilities', 'engineer_shares',
    'match_candidates',
    -- docs/05 §3.6
    'proposal_requests', 'proposals', 'engineer_snapshots', 'proposal_events', 'review_gates',
    -- docs/05 §3.7
    'chat_threads', 'thread_participants', 'messages', 'contracts', 'contract_documents',
    'contract_templates', 'orders', 'assignments', 'extension_reviews',
    -- docs/05 §3.8
    'tasks', 'notifications', 'ai_usage', 'audit_logs', 'usage_counters',
    -- docs/05 §3.9
    'tenant_esign_connections', 'send_attempts', 'email_dispatches', 'email_events',
    'webhook_deliveries', 'data_export_requests', 'tenant_purge_runs', 'scheduler_runs',
    -- docs/05 §3.10
    'impersonation_sessions', 'announcements', 'tenant_role_approval_modes', 'tenant_role_models',
    'tenant_match_weights', 'tenant_monthly_costs', 'billing_meter_submissions'
  ];
BEGIN
  IF array_length(tables, 1) <> 52 THEN
    RAISE EXCEPTION 'RLS 対象は 52 表のはずが % 表です（docs/05 §4.4）', array_length(tables, 1);
  END IF;
  FOREACH t IN ARRAY tables LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE  ROW LEVEL SECURITY', t);
  END LOOP;
END
$do$;

-- ============================================================================
-- 3. C0 SYSTEM_ONLY（docs/05 §4.4）
-- ============================================================================
-- USING / WITH CHECK = `app_tenant_id() IS NULL`。
-- 🔴 テナントキーを持てない 3 表。app_tenant は withSystemScope()（docs/05 §4.4.2）からのみ到達でき、
--    テナント文脈（app.tenant_id が入っている）では 0 件になる。
--    impersonation_sessions は同じ C0 だが app_tenant に権限を与えない（app_platform* のみ。§8 参照）。
DO $do$
DECLARE
  t text;
  tables text[] := ARRAY['scheduler_runs', 'webhook_deliveries', 'email_events'];
BEGIN
  FOREACH t IN ARRAY tables LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', t || '_c0_select', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', t || '_c0_insert', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', t || '_c0_update', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', t || '_c0_delete', t);
    EXECUTE format('CREATE POLICY %I ON %I FOR SELECT TO app_tenant USING (app_tenant_id() IS NULL)', t || '_c0_select', t);
    EXECUTE format('CREATE POLICY %I ON %I FOR INSERT TO app_tenant WITH CHECK (app_tenant_id() IS NULL)', t || '_c0_insert', t);
    EXECUTE format('CREATE POLICY %I ON %I FOR UPDATE TO app_tenant USING (app_tenant_id() IS NULL) WITH CHECK (app_tenant_id() IS NULL)', t || '_c0_update', t);
    EXECUTE format('CREATE POLICY %I ON %I FOR DELETE TO app_tenant USING (app_tenant_id() IS NULL)', t || '_c0_delete', t);
  END LOOP;
END
$do$;

-- ============================================================================
-- 4. C1 TENANT_ALL（docs/05 §4.4）
-- ============================================================================

-- --- tenants（🔴 <T> = id。app_tenant は SELECT のみ）----------------------------------
DROP POLICY IF EXISTS tenants_c1_select ON tenants;
CREATE POLICY tenants_c1_select ON tenants FOR SELECT TO app_tenant
  USING (id = app_tenant_id());

-- --- skill_aliases（SELECT は OR tenant_id IS NULL。書込は tenant_id = app_tenant_id()）---
-- 🔴 グローバル行（tenant_id IS NULL）はテナントから読めるが更新・削除できない（F-010 AC-2）。
-- 🔴 先頭に `app_tenant_id() IS NOT NULL` を置く: これが無いと、テナント文脈を持たない接続
--    （withSystemScope / SET LOCAL 未発行）からグローバル行が読めてしまう。announcements の
--    読み替え式（docs/05 §4.4）が同じ理由で先頭に IS NOT NULL を置いているのと同じ扱いにする。
DROP POLICY IF EXISTS skill_aliases_c1_select ON skill_aliases;
CREATE POLICY skill_aliases_c1_select ON skill_aliases FOR SELECT TO app_tenant
  USING (app_tenant_id() IS NOT NULL AND (tenant_id = app_tenant_id() OR tenant_id IS NULL));

DROP POLICY IF EXISTS skill_aliases_c1_insert ON skill_aliases;
CREATE POLICY skill_aliases_c1_insert ON skill_aliases FOR INSERT TO app_tenant
  WITH CHECK (tenant_id = app_tenant_id());

DROP POLICY IF EXISTS skill_aliases_c1_update ON skill_aliases;
CREATE POLICY skill_aliases_c1_update ON skill_aliases FOR UPDATE TO app_tenant
  USING (tenant_id = app_tenant_id()) WITH CHECK (tenant_id = app_tenant_id());

DROP POLICY IF EXISTS skill_aliases_c1_delete ON skill_aliases;
CREATE POLICY skill_aliases_c1_delete ON skill_aliases FOR DELETE TO app_tenant
  USING (tenant_id = app_tenant_id());

-- --- announcements（🔴 C1 の読み替え。SELECT のみ。書込は app_platform_write）-------------
-- 🔴 先頭の IS NOT NULL により withSystemScope からも 0 件になる（docs/05 §4.4）。
DROP POLICY IF EXISTS announcements_c1_select ON announcements;
CREATE POLICY announcements_c1_select ON announcements FOR SELECT TO app_tenant
  USING (
    app_tenant_id() IS NOT NULL
    AND (cardinality(target_tenant_ids) = 0 OR app_tenant_id() = ANY(target_tenant_ids))
  );

-- --- audit_logs（🔴 INSERT のみ C1。パートナーの操作も記録されるため）--------------------
-- 🔴 SELECT は C2 HOST_ONLY。UPDATE / DELETE はポリシーを作らない（GRANT も無く、
--    20260903040000 で REVOKE 済み。F-005 AC-3）。
DROP POLICY IF EXISTS audit_logs_c1_insert ON audit_logs;
CREATE POLICY audit_logs_c1_insert ON audit_logs FOR INSERT TO app_tenant
  WITH CHECK (tenant_id = app_tenant_id());

DROP POLICY IF EXISTS audit_logs_c2_select ON audit_logs;
CREATE POLICY audit_logs_c2_select ON audit_logs FOR SELECT TO app_tenant
  USING (tenant_id = app_tenant_id() AND app_is_host());

-- ============================================================================
-- 5. C2 HOST_ONLY（docs/05 §4.4）
-- ============================================================================
-- USING / WITH CHECK = `<T> = app_tenant_id() AND app_is_host()`。
-- 🔴 assignments / contracts / contract_documents / orders はここで「書込 + ホストの SELECT」を敷く。
--    パートナーの SELECT（C9 COUNTERPARTY_READ）は T-02-07 が別ポリシーとして追加する（OR 結合）。
-- 🔴 extension_reviews は SELECT も C2 のみ（パートナー読み取りのポリシーを一切書かない。BR-67）。
DO $do$
DECLARE
  t text;
  tables text[] := ARRAY[
    'match_candidates', 'file_scan_results', 'tenant_sending_domains', 'contract_templates',
    'orders', 'assignments', 'extension_reviews', 'contracts', 'contract_documents',
    'ai_usage', 'usage_counters', 'send_attempts', 'email_dispatches',
    'tenant_esign_connections', 'tenant_role_approval_modes', 'tenant_role_models',
    'tenant_match_weights', 'tenant_monthly_costs', 'billing_meter_submissions',
    'data_export_requests', 'tenant_purge_runs'
  ];
BEGIN
  FOREACH t IN ARRAY tables LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', t || '_c2_select', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', t || '_c2_insert', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', t || '_c2_update', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', t || '_c2_delete', t);
    EXECUTE format('CREATE POLICY %I ON %I FOR SELECT TO app_tenant USING (tenant_id = app_tenant_id() AND app_is_host())', t || '_c2_select', t);
    EXECUTE format('CREATE POLICY %I ON %I FOR INSERT TO app_tenant WITH CHECK (tenant_id = app_tenant_id() AND app_is_host())', t || '_c2_insert', t);
    EXECUTE format('CREATE POLICY %I ON %I FOR UPDATE TO app_tenant USING (tenant_id = app_tenant_id() AND app_is_host()) WITH CHECK (tenant_id = app_tenant_id() AND app_is_host())', t || '_c2_update', t);
    EXECUTE format('CREATE POLICY %I ON %I FOR DELETE TO app_tenant USING (tenant_id = app_tenant_id() AND app_is_host())', t || '_c2_delete', t);
  END LOOP;
END
$do$;

-- --- C2（書込のみ）: 読みが別クラスの 4 表 -----------------------------------------------
-- projects / project_requirements の SELECT は C4 VISIBILITY、
-- project_visibilities / partner_companies の SELECT は C5 PARTY（それぞれ §6 / §7 で作る）。
DO $do$
DECLARE
  t text;
  tables text[] := ARRAY['projects', 'project_requirements', 'project_visibilities', 'partner_companies'];
BEGIN
  FOREACH t IN ARRAY tables LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', t || '_c2_insert', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', t || '_c2_update', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', t || '_c2_delete', t);
    EXECUTE format('CREATE POLICY %I ON %I FOR INSERT TO app_tenant WITH CHECK (tenant_id = app_tenant_id() AND app_is_host())', t || '_c2_insert', t);
    EXECUTE format('CREATE POLICY %I ON %I FOR UPDATE TO app_tenant USING (tenant_id = app_tenant_id() AND app_is_host()) WITH CHECK (tenant_id = app_tenant_id() AND app_is_host())', t || '_c2_update', t);
    EXECUTE format('CREATE POLICY %I ON %I FOR DELETE TO app_tenant USING (tenant_id = app_tenant_id() AND app_is_host())', t || '_c2_delete', t);
  END LOOP;
END
$do$;

-- ============================================================================
-- 6. C3 OWNER_SCOPED（docs/05 §4.4）
-- ============================================================================
-- USING / WITH CHECK = `<T> = app_tenant_id() AND <O> IS NOT DISTINCT FROM app_partner_id()`。
-- 🔴 engineers / engineer_shares は「WITH CHECK を C3 の式に絞る 4 表」に含まれるが、
--    C3 は USING も同じ式のため追加の絞り込みは不要（残る 2 表 users / memberships は §9 / §10）。
-- 🔴 子表（engineer_skills / skill_sheets / skill_sheet_extractions）のオーナー列は
--    継承トリガ（T-02-08）が親の値で必ず上書きするため、呼び出し側が偽装できない。
DO $do$
DECLARE
  r record;
  expr text;
BEGIN
  FOR r IN SELECT * FROM (VALUES
      ('engineers', 'owner_partner_company_id'),
      ('engineer_skills', 'owner_partner_company_id'),
      ('skill_sheets', 'owner_partner_company_id'),
      ('skill_sheet_extractions', 'owner_partner_company_id'),
      ('engineer_shares', 'partner_company_id')
    ) AS v(tbl, owner_col)
  LOOP
    expr := format('(tenant_id = app_tenant_id() AND %I IS NOT DISTINCT FROM app_partner_id())', r.owner_col);
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', r.tbl || '_c3_select', r.tbl);
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', r.tbl || '_c3_insert', r.tbl);
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', r.tbl || '_c3_update', r.tbl);
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', r.tbl || '_c3_delete', r.tbl);
    EXECUTE format('CREATE POLICY %I ON %I FOR SELECT TO app_tenant USING %s', r.tbl || '_c3_select', r.tbl, expr);
    EXECUTE format('CREATE POLICY %I ON %I FOR INSERT TO app_tenant WITH CHECK %s', r.tbl || '_c3_insert', r.tbl, expr);
    EXECUTE format('CREATE POLICY %I ON %I FOR UPDATE TO app_tenant USING %s WITH CHECK %s', r.tbl || '_c3_update', r.tbl, expr, expr);
    EXECUTE format('CREATE POLICY %I ON %I FOR DELETE TO app_tenant USING %s', r.tbl || '_c3_delete', r.tbl, expr);
  END LOOP;
END
$do$;

-- ============================================================================
-- 7. C4 VISIBILITY（越境経路 1。docs/05 §4.4）
-- ============================================================================
-- 🔴 越境の判断をアプリの if に書かない。project_visibilities の行の有無がそのまま見える／見えない。
-- 🔴 副問い合わせの project_visibilities にも RLS が効く（C5。パートナーは自社宛の行を読める）。
--    これが C4 の EXISTS が成立する前提である（docs/05 §4.4 C5 の 🔴）。
DROP POLICY IF EXISTS projects_c4_select ON projects;
CREATE POLICY projects_c4_select ON projects FOR SELECT TO app_tenant
  USING (
    tenant_id = app_tenant_id()
    AND (
      app_is_host()
      OR EXISTS (
        SELECT 1 FROM project_visibilities v
        WHERE v.tenant_id = projects.tenant_id
          AND v.project_id = projects.id
          AND v.partner_company_id = app_partner_id()
          AND v.revoked_at IS NULL
      )
    )
  );

DROP POLICY IF EXISTS project_requirements_c4_select ON project_requirements;
CREATE POLICY project_requirements_c4_select ON project_requirements FOR SELECT TO app_tenant
  USING (
    tenant_id = app_tenant_id()
    AND (
      app_is_host()
      OR EXISTS (
        SELECT 1 FROM project_visibilities v
        WHERE v.tenant_id = project_requirements.tenant_id
          AND v.project_id = project_requirements.project_id
          AND v.partner_company_id = app_partner_id()
          AND v.revoked_at IS NULL
      )
    )
  );

-- ============================================================================
-- 8. C5 PARTY（越境経路 2 / 4。docs/05 §4.4）
-- ============================================================================
-- USING / WITH CHECK = `<T> = app_tenant_id() AND (app_is_host() OR <O> = app_partner_id())`。
DO $do$
DECLARE
  r record;
  expr text;
BEGIN
  FOR r IN SELECT * FROM (VALUES
      ('proposals', 'owner_partner_company_id'),
      ('engineer_snapshots', 'owner_partner_company_id'),
      ('proposal_events', 'owner_partner_company_id'),
      ('review_gates', 'owner_partner_company_id'),
      ('tasks', 'owner_partner_company_id'),
      ('proposal_requests', 'partner_company_id'),
      ('thread_participants', 'partner_company_id'),
      ('invitations', 'partner_company_id')
    ) AS v(tbl, owner_col)
  LOOP
    expr := format('(tenant_id = app_tenant_id() AND (app_is_host() OR %I = app_partner_id()))', r.owner_col);
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', r.tbl || '_c5_select', r.tbl);
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', r.tbl || '_c5_insert', r.tbl);
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', r.tbl || '_c5_update', r.tbl);
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', r.tbl || '_c5_delete', r.tbl);
    EXECUTE format('CREATE POLICY %I ON %I FOR SELECT TO app_tenant USING %s', r.tbl || '_c5_select', r.tbl, expr);
    EXECUTE format('CREATE POLICY %I ON %I FOR INSERT TO app_tenant WITH CHECK %s', r.tbl || '_c5_insert', r.tbl, expr);
    EXECUTE format('CREATE POLICY %I ON %I FOR UPDATE TO app_tenant USING %s WITH CHECK %s', r.tbl || '_c5_update', r.tbl, expr, expr);
    EXECUTE format('CREATE POLICY %I ON %I FOR DELETE TO app_tenant USING %s', r.tbl || '_c5_delete', r.tbl, expr);
  END LOOP;
END
$do$;

-- --- C5（SELECT のみ。書込は §5 の C2）---------------------------------------------------
-- 🔴 project_visibilities: パートナーが自社宛の行を読めることが C4 の EXISTS の前提。
DROP POLICY IF EXISTS project_visibilities_c5_select ON project_visibilities;
CREATE POLICY project_visibilities_c5_select ON project_visibilities FOR SELECT TO app_tenant
  USING (
    tenant_id = app_tenant_id()
    AND (app_is_host() OR partner_company_id = app_partner_id())
  );

-- 🔴 partner_companies: <O> = id。パートナー文脈では自社 1 行のみ（F-004 AC-1）。
DROP POLICY IF EXISTS partner_companies_c5_select ON partner_companies;
CREATE POLICY partner_companies_c5_select ON partner_companies FOR SELECT TO app_tenant
  USING (
    tenant_id = app_tenant_id()
    AND (app_is_host() OR id = app_partner_id())
  );

-- --- memberships（C5 の USING + 🔴 WITH CHECK は C3 の式に絞る）---------------------------
-- 🔴 「自分の所属としてしか書けない」4 表の 1 つ（docs/05 §4.4）。ホストが
--    partner_company_id 付きの membership を直接作ることはできず、
--    書き手は §4.4.2 の withInvitationAccept（招待行から所属を取る）だけになる。
DROP POLICY IF EXISTS memberships_c5_select ON memberships;
CREATE POLICY memberships_c5_select ON memberships FOR SELECT TO app_tenant
  USING (
    tenant_id = app_tenant_id()
    AND (app_is_host() OR partner_company_id = app_partner_id())
  );

DROP POLICY IF EXISTS memberships_c3_insert ON memberships;
CREATE POLICY memberships_c3_insert ON memberships FOR INSERT TO app_tenant
  WITH CHECK (
    tenant_id = app_tenant_id()
    AND partner_company_id IS NOT DISTINCT FROM app_partner_id()
  );

DROP POLICY IF EXISTS memberships_c3_update ON memberships;
CREATE POLICY memberships_c3_update ON memberships FOR UPDATE TO app_tenant
  USING (
    tenant_id = app_tenant_id()
    AND partner_company_id IS NOT DISTINCT FROM app_partner_id()
  )
  WITH CHECK (
    tenant_id = app_tenant_id()
    AND partner_company_id IS NOT DISTINCT FROM app_partner_id()
  );

DROP POLICY IF EXISTS memberships_c3_delete ON memberships;
CREATE POLICY memberships_c3_delete ON memberships FOR DELETE TO app_tenant
  USING (
    tenant_id = app_tenant_id()
    AND partner_company_id IS NOT DISTINCT FROM app_partner_id()
  );

-- ============================================================================
-- 9. C6 THREAD（越境経路 3。docs/05 §4.4）
-- ============================================================================
-- 🔴 ThreadParticipant の行の有無がそのまま見える／見えないになる。
--    thread_participants 自身は C5（自表を参照しない）＝ RLS の再帰を避ける。
-- 🔴 chat_threads の INSERT の WITH CHECK は「USING と同じ式」の既定どおりに書く（docs/05 §4.4）。
--    結果として、パートナー文脈からのスレッド新規作成は必ず落ちる（参加行がまだ存在しないため
--    EXISTS が偽になる）。スレッドを起こすのはホストであり（F-038）、パートナーは既存スレッドへ
--    Message を書く。ここを緩めると「参加していないスレッドを自社宛に作る」経路になるため、
--    緩和は SP-15（チャット）で必要性が確定してから設計側で判断する。
DROP POLICY IF EXISTS chat_threads_c6_select ON chat_threads;
CREATE POLICY chat_threads_c6_select ON chat_threads FOR SELECT TO app_tenant
  USING (
    tenant_id = app_tenant_id()
    AND (
      app_is_host()
      OR (
        partner_company_id = app_partner_id()
        AND EXISTS (
          SELECT 1 FROM thread_participants p
          WHERE p.tenant_id = chat_threads.tenant_id
            AND p.thread_id = chat_threads.id
            AND p.partner_company_id = app_partner_id()
            AND p.left_at IS NULL
        )
      )
    )
  );

DROP POLICY IF EXISTS chat_threads_c6_insert ON chat_threads;
CREATE POLICY chat_threads_c6_insert ON chat_threads FOR INSERT TO app_tenant
  WITH CHECK (
    tenant_id = app_tenant_id()
    AND (
      app_is_host()
      OR (
        partner_company_id = app_partner_id()
        AND EXISTS (
          SELECT 1 FROM thread_participants p
          WHERE p.tenant_id = chat_threads.tenant_id
            AND p.thread_id = chat_threads.id
            AND p.partner_company_id = app_partner_id()
            AND p.left_at IS NULL
        )
      )
    )
  );

DROP POLICY IF EXISTS chat_threads_c6_update ON chat_threads;
CREATE POLICY chat_threads_c6_update ON chat_threads FOR UPDATE TO app_tenant
  USING (
    tenant_id = app_tenant_id()
    AND (
      app_is_host()
      OR (
        partner_company_id = app_partner_id()
        AND EXISTS (
          SELECT 1 FROM thread_participants p
          WHERE p.tenant_id = chat_threads.tenant_id
            AND p.thread_id = chat_threads.id
            AND p.partner_company_id = app_partner_id()
            AND p.left_at IS NULL
        )
      )
    )
  )
  WITH CHECK (
    tenant_id = app_tenant_id()
    AND (
      app_is_host()
      OR (
        partner_company_id = app_partner_id()
        AND EXISTS (
          SELECT 1 FROM thread_participants p
          WHERE p.tenant_id = chat_threads.tenant_id
            AND p.thread_id = chat_threads.id
            AND p.partner_company_id = app_partner_id()
            AND p.left_at IS NULL
        )
      )
    )
  );

DROP POLICY IF EXISTS chat_threads_c6_delete ON chat_threads;
CREATE POLICY chat_threads_c6_delete ON chat_threads FOR DELETE TO app_tenant
  USING (
    tenant_id = app_tenant_id()
    AND (
      app_is_host()
      OR (
        partner_company_id = app_partner_id()
        AND EXISTS (
          SELECT 1 FROM thread_participants p
          WHERE p.tenant_id = chat_threads.tenant_id
            AND p.thread_id = chat_threads.id
            AND p.partner_company_id = app_partner_id()
            AND p.left_at IS NULL
        )
      )
    )
  );

DROP POLICY IF EXISTS messages_c6_select ON messages;
CREATE POLICY messages_c6_select ON messages FOR SELECT TO app_tenant
  USING (
    tenant_id = app_tenant_id()
    AND (
      app_is_host()
      OR (
        owner_partner_company_id = app_partner_id()
        AND EXISTS (
          SELECT 1 FROM thread_participants p
          WHERE p.tenant_id = messages.tenant_id
            AND p.thread_id = messages.thread_id
            AND p.partner_company_id = app_partner_id()
            AND p.left_at IS NULL
        )
      )
    )
  );

DROP POLICY IF EXISTS messages_c6_insert ON messages;
CREATE POLICY messages_c6_insert ON messages FOR INSERT TO app_tenant
  WITH CHECK (
    tenant_id = app_tenant_id()
    AND (
      app_is_host()
      OR (
        owner_partner_company_id = app_partner_id()
        AND EXISTS (
          SELECT 1 FROM thread_participants p
          WHERE p.tenant_id = messages.tenant_id
            AND p.thread_id = messages.thread_id
            AND p.partner_company_id = app_partner_id()
            AND p.left_at IS NULL
        )
      )
    )
  );

DROP POLICY IF EXISTS messages_c6_update ON messages;
CREATE POLICY messages_c6_update ON messages FOR UPDATE TO app_tenant
  USING (
    tenant_id = app_tenant_id()
    AND (
      app_is_host()
      OR (
        owner_partner_company_id = app_partner_id()
        AND EXISTS (
          SELECT 1 FROM thread_participants p
          WHERE p.tenant_id = messages.tenant_id
            AND p.thread_id = messages.thread_id
            AND p.partner_company_id = app_partner_id()
            AND p.left_at IS NULL
        )
      )
    )
  )
  WITH CHECK (
    tenant_id = app_tenant_id()
    AND (
      app_is_host()
      OR (
        owner_partner_company_id = app_partner_id()
        AND EXISTS (
          SELECT 1 FROM thread_participants p
          WHERE p.tenant_id = messages.tenant_id
            AND p.thread_id = messages.thread_id
            AND p.partner_company_id = app_partner_id()
            AND p.left_at IS NULL
        )
      )
    )
  );

DROP POLICY IF EXISTS messages_c6_delete ON messages;
CREATE POLICY messages_c6_delete ON messages FOR DELETE TO app_tenant
  USING (
    tenant_id = app_tenant_id()
    AND (
      app_is_host()
      OR (
        owner_partner_company_id = app_partner_id()
        AND EXISTS (
          SELECT 1 FROM thread_participants p
          WHERE p.tenant_id = messages.tenant_id
            AND p.thread_id = messages.thread_id
            AND p.partner_company_id = app_partner_id()
            AND p.left_at IS NULL
        )
      )
    )
  );

-- ============================================================================
-- 10. C7 SELF（docs/05 §4.4）
-- ============================================================================
-- 🔴 notifications の INSERT だけ WITH CHECK が C1 式（ジョブもチャット相手も他人宛に作るため）。
--    読みは本人だけ。
DROP POLICY IF EXISTS notifications_c7_select ON notifications;
CREATE POLICY notifications_c7_select ON notifications FOR SELECT TO app_tenant
  USING (tenant_id = app_tenant_id() AND recipient_user_id = app_actor_user_id());

DROP POLICY IF EXISTS notifications_c1_insert ON notifications;
CREATE POLICY notifications_c1_insert ON notifications FOR INSERT TO app_tenant
  WITH CHECK (tenant_id = app_tenant_id());

DROP POLICY IF EXISTS notifications_c7_update ON notifications;
CREATE POLICY notifications_c7_update ON notifications FOR UPDATE TO app_tenant
  USING (tenant_id = app_tenant_id() AND recipient_user_id = app_actor_user_id())
  WITH CHECK (tenant_id = app_tenant_id() AND recipient_user_id = app_actor_user_id());

DROP POLICY IF EXISTS notifications_c7_delete ON notifications;
CREATE POLICY notifications_c7_delete ON notifications FOR DELETE TO app_tenant
  USING (tenant_id = app_tenant_id() AND recipient_user_id = app_actor_user_id());

-- 🔴 two_factor_credentials: subject_type = 'USER' を AND する。
--    PLATFORM_USER 行は tenant_id IS NULL のため、この式では 1 行も見えない。
DROP POLICY IF EXISTS two_factor_credentials_c7_select ON two_factor_credentials;
CREATE POLICY two_factor_credentials_c7_select ON two_factor_credentials FOR SELECT TO app_tenant
  USING (
    tenant_id = app_tenant_id()
    AND subject_id = app_actor_user_id()
    AND subject_type = 'USER'
  );

DROP POLICY IF EXISTS two_factor_credentials_c7_insert ON two_factor_credentials;
CREATE POLICY two_factor_credentials_c7_insert ON two_factor_credentials FOR INSERT TO app_tenant
  WITH CHECK (
    tenant_id = app_tenant_id()
    AND subject_id = app_actor_user_id()
    AND subject_type = 'USER'
  );

DROP POLICY IF EXISTS two_factor_credentials_c7_update ON two_factor_credentials;
CREATE POLICY two_factor_credentials_c7_update ON two_factor_credentials FOR UPDATE TO app_tenant
  USING (
    tenant_id = app_tenant_id()
    AND subject_id = app_actor_user_id()
    AND subject_type = 'USER'
  )
  WITH CHECK (
    tenant_id = app_tenant_id()
    AND subject_id = app_actor_user_id()
    AND subject_type = 'USER'
  );

DROP POLICY IF EXISTS two_factor_credentials_c7_delete ON two_factor_credentials;
CREATE POLICY two_factor_credentials_c7_delete ON two_factor_credentials FOR DELETE TO app_tenant
  USING (
    tenant_id = app_tenant_id()
    AND subject_id = app_actor_user_id()
    AND subject_type = 'USER'
  );

-- ============================================================================
-- 11. C8 DIRECTORY（docs/05 §4.4）
-- ============================================================================
-- 🔴 ホスト所属の行（owner_partner_company_id IS NULL）だけが全員に見える
--    （チャットの送信者名・ProposalEvent の実行者名に要る）。他パートナーの利用者は 1 行も見えない。
-- 🔴 書込（INSERT / UPDATE）は C3 の式に絞る（自分の所属としてしか書けない）。DELETE は
--    GRANT もポリシーも作らない（業務データを論理削除しない規約と、退会は disabled_at のため）。
DROP POLICY IF EXISTS users_c8_select ON users;
CREATE POLICY users_c8_select ON users FOR SELECT TO app_tenant
  USING (
    tenant_id = app_tenant_id()
    AND (
      app_is_host()
      OR owner_partner_company_id IS NULL
      OR owner_partner_company_id = app_partner_id()
    )
  );

DROP POLICY IF EXISTS users_c3_insert ON users;
CREATE POLICY users_c3_insert ON users FOR INSERT TO app_tenant
  WITH CHECK (
    tenant_id = app_tenant_id()
    AND owner_partner_company_id IS NOT DISTINCT FROM app_partner_id()
  );

DROP POLICY IF EXISTS users_c3_update ON users;
CREATE POLICY users_c3_update ON users FOR UPDATE TO app_tenant
  USING (
    tenant_id = app_tenant_id()
    AND owner_partner_company_id IS NOT DISTINCT FROM app_partner_id()
  )
  WITH CHECK (
    tenant_id = app_tenant_id()
    AND owner_partner_company_id IS NOT DISTINCT FROM app_partner_id()
  );

-- ============================================================================
-- 12. テナント文脈を持たない経路（docs/05 §4.4.2。🔴 これ以外を作らない）
-- ============================================================================
-- 🔴 いずれも先頭が `app_tenant_id() IS NULL` である = 通常の withTenant 文脈（app.tenant_id が
--    入っている）では 1 行も返さない。したがってテナント利用者がこの経路で他テナントを覗くことは
--    できず、GUC を立てられるのは packages/db の該当関数だけである。
-- 🔴 該当 1 行だけを返す（メール / トークンハッシュの完全一致）。列挙も部分一致もできない。

-- withAuthLookup(email)（docs/05 §4.4.2）
DROP POLICY IF EXISTS users_auth_lookup_select ON users;
CREATE POLICY users_auth_lookup_select ON users FOR SELECT TO app_tenant
  USING (
    app_tenant_id() IS NULL
    AND lower(email) = lower(NULLIF(current_setting('app.auth_email', true), ''))
  );

-- withPasswordResetConfirm(hash, ...)（docs/05 §4.4.2）
DROP POLICY IF EXISTS users_password_reset_select ON users;
CREATE POLICY users_password_reset_select ON users FOR SELECT TO app_tenant
  USING (
    app_tenant_id() IS NULL
    AND password_reset_token_hash = NULLIF(current_setting('app.password_reset_token_hash', true), '')
  );

-- withInvitationToken(hash) / withInvitationAccept(hash, ...)（docs/05 §4.4.2）
DROP POLICY IF EXISTS invitations_token_select ON invitations;
CREATE POLICY invitations_token_select ON invitations FOR SELECT TO app_tenant
  USING (
    app_tenant_id() IS NULL
    AND token_hash = NULLIF(current_setting('app.invitation_token_hash', true), '')
  );

-- ============================================================================
-- 13. GRANT（app_tenant。docs/05 §4.2）
-- ============================================================================
-- 🔴 GRANT とポリシーは対で意味を持つ。GRANT だけでは FORCE ROW LEVEL SECURITY 下で 0 件になり、
--    ポリシーだけでは permission denied になる。片方だけを足さない。
GRANT USAGE ON SCHEMA public TO app_tenant;

-- 🔴 tenants は SELECT のみ（lifecycle_state を書けるのは withPlatformWrite 経由だけ。docs/05 §3.3）。
GRANT SELECT ON tenants TO app_tenant;

-- 🔴 announcements は SELECT のみ（書込は app_platform_write。docs/05 §4.4 C1 / §10.4-8）。
GRANT SELECT ON announcements TO app_tenant;

-- 🔴 audit_logs は INSERT / SELECT のみ（docs/05 §4.2。UPDATE / DELETE は 20260903040000 で REVOKE 済み。
--    F-005 AC-3「利用者・運営者のいずれからも編集・削除できない」）。
GRANT SELECT, INSERT ON audit_logs TO app_tenant;

-- 🔴 users は SELECT / INSERT / UPDATE のみ（docs/05 §4.4 C8「書込は INSERT / UPDATE」）。
--    退会は disabled_at の UPDATE であり DELETE を使わない。
GRANT SELECT, INSERT, UPDATE ON users TO app_tenant;

-- 残りの 47 表は docs/05 §4.2 の既定どおり SELECT / INSERT / UPDATE / DELETE。
-- 🔴 impersonation_sessions はここに現れない（C0。app_tenant に権限を与えない。§14 参照）。
GRANT SELECT, INSERT, UPDATE, DELETE ON
  memberships, partner_companies, invitations, two_factor_credentials, tenant_sending_domains,
  engineers, skill_aliases, engineer_skills, skill_sheets, file_scan_results,
  skill_sheet_extractions, projects, project_requirements, project_visibilities, engineer_shares,
  match_candidates, proposal_requests, proposals, engineer_snapshots, proposal_events,
  review_gates, chat_threads, thread_participants, messages, contracts,
  contract_documents, contract_templates, orders, assignments, extension_reviews,
  tasks, notifications, ai_usage, usage_counters, tenant_esign_connections,
  send_attempts, email_dispatches, email_events, webhook_deliveries, data_export_requests,
  tenant_purge_runs, scheduler_runs, tenant_role_approval_modes, tenant_role_models,
  tenant_match_weights, tenant_monthly_costs, billing_meter_submissions
TO app_tenant;

-- ============================================================================
-- 14. 管理平面用の RLS ポリシーと GRANT（docs/05 §5.2 / §5.5）
-- ============================================================================
-- 🔴 本節は 010_rls.sql から移設したものに impersonation_sessions を足しただけである。
--    app_platform の業務テーブルへの列レベル SELECT の全面展開（§5.5 第 1 層）と
--    app_platform_write の残りの書込領域（plans / subscriptions / announcements /
--    usage_counters / invitations / tenant_sending_domains）は **SP-03 T-03-08 の範囲**
--    （docs/sprints/SP-03 T-03-08「運営者に非開示のものは列レベル GRANT で外す」/ Issue #24）。
--    ここで先回りして GRANT を広げない（走査テストの許可リストと同時にしか動かせないため）。
--
-- 🔴 app.platform_user_id / app.target_tenant_id は withPlatformRead / withPlatformWrite（T-03-08）が
--    SET LOCAL する GUC。app.target_tenant_id が空のときだけテナント横断が成立する（§5.2）。

-- --- tenants ------------------------------------------------------------------------------
DROP POLICY IF EXISTS tenants_platform_read ON tenants;
CREATE POLICY tenants_platform_read ON tenants FOR SELECT TO app_platform
  USING (
    current_setting('app.platform_user_id', true) <> ''
    AND (
      current_setting('app.target_tenant_id', true) = ''
      OR id::text = current_setting('app.target_tenant_id', true)
    )
  );

DROP POLICY IF EXISTS tenants_platform_write_insert ON tenants;
CREATE POLICY tenants_platform_write_insert ON tenants FOR INSERT TO app_platform_write
  WITH CHECK (current_setting('app.platform_user_id', true) <> '');

DROP POLICY IF EXISTS tenants_platform_write_update ON tenants;
CREATE POLICY tenants_platform_write_update ON tenants FOR UPDATE TO app_platform_write
  USING (current_setting('app.platform_user_id', true) <> '')
  WITH CHECK (current_setting('app.platform_user_id', true) <> '');

GRANT SELECT ON tenants TO app_platform;
GRANT INSERT ON tenants TO app_platform_write;
-- 🔴 name / environment は開設時にしか書けない（UPDATE の GRANT に含めない。docs/05 §5.2）。
GRANT UPDATE (
  lifecycle_state, lifecycle_changed_at, lifecycle_changed_by,
  suspend_reason, sandbox_expires_at, closing_entered_at
) ON tenants TO app_platform_write;

-- --- engineers（§5.5 第 1 層 = 列を列挙した GRANT の前例）-----------------------------------
DROP POLICY IF EXISTS engineers_platform_read ON engineers;
CREATE POLICY engineers_platform_read ON engineers FOR SELECT TO app_platform
  USING (
    current_setting('app.platform_user_id', true) <> ''
    AND (
      current_setting('app.target_tenant_id', true) = ''
      OR tenant_id::text = current_setting('app.target_tenant_id', true)
    )
  );

-- 🔴 display_name / birth_date / contact_email / contact_phone / affiliation_label / city /
--    preference_note は GRANT しない（docs/05 §5.5 の非開示列一覧 / CLAUDE.md §10.5）。
--    T-02-02 で §5.5 が挙げる開示列が実在するようになったため、列一覧を §5.5 と 1 対 1 にした。
GRANT SELECT (
  id, tenant_id, owner_partner_company_id, availability, available_from,
  prefecture, remote_mode, created_at, updated_at, retention_expires_at, pii_purged_at
) ON engineers TO app_platform;
-- 🔴 engineers は業務テーブル。app_platform_write に INSERT/UPDATE/DELETE を一切 GRANT しない。

-- --- impersonation_sessions（C0。🔴 app_tenant に権限を与えず app_platform* のみ。docs/05 §4.4）---
-- 🔴 これが無いと「app_tenant に権限が無く、app_platform / app_platform_write にも権限が無い」
--    孤児表になる（docs/05 §4.7 テスト #4）。§5.2 は本表を app_platform_write の書込先として
--    明示的に列挙している。
-- 🔴 tenant_id 条件を併用する（docs/05 §5.2 末尾。C0 の他 3 表と違い対象テナントが確定している）。
DROP POLICY IF EXISTS impersonation_sessions_platform_read ON impersonation_sessions;
CREATE POLICY impersonation_sessions_platform_read ON impersonation_sessions FOR SELECT TO app_platform
  USING (
    current_setting('app.platform_user_id', true) <> ''
    AND (
      current_setting('app.target_tenant_id', true) = ''
      OR tenant_id::text = current_setting('app.target_tenant_id', true)
    )
  );

DROP POLICY IF EXISTS impersonation_sessions_platform_write_insert ON impersonation_sessions;
CREATE POLICY impersonation_sessions_platform_write_insert ON impersonation_sessions
  FOR INSERT TO app_platform_write
  WITH CHECK (current_setting('app.platform_user_id', true) <> '');

GRANT SELECT ON impersonation_sessions TO app_platform;
-- 🔴 INSERT のみ（代理閲覧の開始）。終了（ended_at / end_kind）の UPDATE は §5.6 を実装する
--    SP-03 T-03-08 / Phase 2 で、許可列を決めたうえで足す。
GRANT INSERT ON impersonation_sessions TO app_platform_write;
