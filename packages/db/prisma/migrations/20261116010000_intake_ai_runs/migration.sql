-- 登録文の原文ではなく、許可済み技術名だけを一時保存する。
CREATE TABLE intake_ai_runs (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  requested_by uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('PROJECT', 'ENGINEER')),
  status text NOT NULL CHECK (status IN ('PENDING', 'RUNNING', 'COMPLETED', 'FAILED')),
  input jsonb NOT NULL,
  output jsonb,
  created_at timestamptz(3) NOT NULL DEFAULT now(),
  expires_at timestamptz(3) NOT NULL
);
CREATE INDEX intake_ai_runs_tenant_requester_idx ON intake_ai_runs (tenant_id, requested_by);
ALTER TABLE intake_ai_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE intake_ai_runs FORCE ROW LEVEL SECURITY;
CREATE POLICY intake_ai_runs_host ON intake_ai_runs FOR ALL TO app_tenant
  USING (tenant_id = app_tenant_id() AND app_is_host()
    AND (requested_by = app_actor_user_id() OR app_actor_user_id() IS NULL))
  WITH CHECK (tenant_id = app_tenant_id() AND app_is_host()
    AND (requested_by = app_actor_user_id() OR app_actor_user_id() IS NULL));
GRANT SELECT, INSERT, UPDATE, DELETE ON intake_ai_runs TO app_tenant;
CREATE POLICY intake_ai_runs_purge_scope_select ON intake_ai_runs FOR SELECT TO app_tenant
  USING (tenant_id = app_tenant_id() AND app_is_host() AND app_purge_scope_on());
CREATE POLICY intake_ai_runs_purge_scope_update ON intake_ai_runs FOR UPDATE TO app_tenant
  USING (tenant_id = app_tenant_id() AND app_is_host() AND app_purge_scope_on())
  WITH CHECK (tenant_id = app_tenant_id() AND app_is_host() AND app_purge_scope_on());
CREATE POLICY intake_ai_runs_purge_scope_delete ON intake_ai_runs FOR DELETE TO app_tenant
  USING (tenant_id = app_tenant_id() AND app_is_host() AND app_purge_scope_on());
