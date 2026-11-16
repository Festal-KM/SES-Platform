-- 案件起点の AI 候補選出をテナント内で一時的に受け渡す。
CREATE TABLE project_candidate_ai_runs (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  requested_by uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status text NOT NULL CHECK (status IN ('PENDING', 'RUNNING', 'COMPLETED', 'FAILED')),
  input jsonb NOT NULL,
  output jsonb,
  created_at timestamptz(3) NOT NULL DEFAULT now(),
  expires_at timestamptz(3) NOT NULL
);
CREATE INDEX project_candidate_ai_runs_tenant_project_requester_idx
  ON project_candidate_ai_runs (tenant_id, project_id, requested_by);
ALTER TABLE project_candidate_ai_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE project_candidate_ai_runs FORCE ROW LEVEL SECURITY;
CREATE POLICY project_candidate_ai_runs_host ON project_candidate_ai_runs
  FOR ALL TO app_tenant
  USING (tenant_id = app_tenant_id() AND app_is_host()
    AND (requested_by = app_actor_user_id() OR app_actor_user_id() IS NULL))
  WITH CHECK (tenant_id = app_tenant_id() AND app_is_host()
    AND (requested_by = app_actor_user_id() OR app_actor_user_id() IS NULL));
GRANT SELECT, INSERT, UPDATE, DELETE ON project_candidate_ai_runs TO app_tenant;
CREATE POLICY project_candidate_ai_runs_purge_scope_select ON project_candidate_ai_runs FOR SELECT TO app_tenant
  USING (tenant_id = app_tenant_id() AND app_is_host() AND app_purge_scope_on());
CREATE POLICY project_candidate_ai_runs_purge_scope_update ON project_candidate_ai_runs FOR UPDATE TO app_tenant
  USING (tenant_id = app_tenant_id() AND app_is_host() AND app_purge_scope_on())
  WITH CHECK (tenant_id = app_tenant_id() AND app_is_host() AND app_purge_scope_on());
CREATE POLICY project_candidate_ai_runs_purge_scope_delete ON project_candidate_ai_runs FOR DELETE TO app_tenant
  USING (tenant_id = app_tenant_id() AND app_is_host() AND app_purge_scope_on());
