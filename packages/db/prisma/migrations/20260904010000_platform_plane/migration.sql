-- packages/db/prisma/migrations/20260904010000_platform_plane/migration.sql
-- T-03-08（docs/sprints/SP-03-auth-audit-admin0.md）: 管理平面の分離バイパス（docs/05 §5.2 / §5.3 /
-- §5.5）を DB 側で完成させる。`withPlatformRead` / `withPlatformWrite`（packages/db/src/platform.ts）が
-- 使う権限とポリシーはすべてこのファイルにある。
--
-- ============================================================================
-- 🔴 このマイグレーションが足すもの（3 つ）
-- ============================================================================
-- ① `app_platform`（読み取り専用ロール）への **列レベル `GRANT SELECT`** の全面展開（§5.5 第 1 層）と、
--    52 表すべての `platform_read` ポリシー（§5.2）。
--    20260903050000 §14 が「tenants / engineers / impersonation_sessions の 3 表だけ先に置き、
--    全面展開は T-03-08 で行う」と明記していた分の実施である。
-- ② `app_platform` への `audit_logs` の **INSERT**（docs/05 §4.2「`audit_logs` は `INSERT/SELECT`」/
--    §5.2「`audit_logs` の `INSERT` のみ許す」）。§5.3 の「`fn` を実行する**前に**同一トランザクションで
--    `AuditLog` を `INSERT` する」は、読み取り接続そのものが書けなければ成立しない
--    （別接続で書くと「監査は書けたがクエリは別トランザクション」になり、
--     ロールバックで記録だけが残る / 記録だけが消える経路ができる）。
-- ③ `app_platform_write` への追加（§5.2）:
--    - `tenants` の **列レベル `SELECT (id, lifecycle_state)`**（🔴 Issue #24 の決定 = 既定値 A。
--      テナント開設直後の読み戻し〔API-A4 の応答〕に要る 2 列だけ。**行全体・他列に広げない** ——
--      広げると `BR-40`「運営者に見せないもの」の担保が走査テストの除外リスト頼みになる）
--    - `invitations` の **`INSERT` のみ**（API-A5。初期 `OWNER` 招待に `WITH CHECK` で固定）
--    - `tenant_sending_domains` の **`INSERT` のみ**（API-A4 の `sendingDomain`。`state='REGISTERED'` 固定）
--    - `audit_logs` の `app.platform_user_id` 由来 `INSERT` ポリシー（§5.3。T-03-07 が置いた
--      `audit_logs_platform_auth_insert` は認証経路専用の GUC を要求するため、管理平面の通常操作では
--      1 つも真にならない）
--
-- ============================================================================
-- 🔴 「運営者に見せないもの」は列レベル GRANT で外す（§5.5 第 1 層 / `BR-40` / `CLAUDE.md` §10.5）
-- ============================================================================
-- 🔴 **テーブル単位の `GRANT SELECT` を使わない。** 列を列挙する。テーブル単位にすると、
--    後から追加された列が自動的に運営者へ開示される（「書き忘れても漏れない」が成立しなくなる）。
--    このため 20260903050000 が `tenants` / `impersonation_sessions` に置いたテーブル単位の
--    `GRANT SELECT` は本ファイルで **REVOKE してから列レベルで付け直す**。
--
-- 非開示列は docs/05 §5.5 の表を一次資料とし、加えて次を外した（同表への追記を docs/05 に行った。
-- `CLAUDE.md` §10.5「運営者に必要なのは『件数・状態・エラー』であって『内容』ではない」の適用）:
--   - 商流（単価・金額）: `engineers` / `engineer_snapshots` / `projects` の `unit_price_min` /
--     `unit_price_max`、`proposals.offered_unit_price` / `recipient_company_name`
--     （§5.5 の `engineers` の開示列一覧が単価列を含まないことに合わせ、同種の列を横断で揃えた）
--   - 内容（自由文・AI 生成物）: `match_candidates.rationale`、`extension_reviews.facts` / `summary`、
--     `notifications.title` / `body_params`、`send_attempts.failure_detail`
--   - 宛先・生ペイロード: `email_dispatches.recipient_email`、`email_events.payload`、
--     `webhook_deliveries.payload`
--   - オブジェクトキー: `file_scan_results.object_key`、`data_export_requests.object_key`
--     （§5.5 が `skill_sheets` / `contract_documents` / `contract_templates` の `object_key` を
--      外しているのと同じ理由。🔴 S3 側でも管理平面の IAM ロールに `s3:GetObject` を付与しない
--      ——付与しないことがこの列 GRANT を外すことと二重の担保になる。IAM は本リポジトリの
--      管理対象外〔インフラ〕であり、SQL では表現できないため、ここに注記として残す）
--
-- 🔴 射程外の 4 表（`skills` / `platform_users` / `plans` / `subscriptions`。`CLAUDE.md` §3.1）には
--    本ファイルでは触れない。`platform_users` は 20260904000000 が `app_platform_write` の認証経路に
--    限定して開いており、`app_platform` には GRANT しない（運営者コンソールが運営者の
--    パスワードハッシュに到達する経路を作らない）。`plans` / `subscriptions` は `A-004` / `A-010`
--    （Phase 1 / 3）の範囲であり、その画面を実装するスプリントで許可リストと同時に足す。
--
-- 🔴 先回りして GRANT を広げない: §5.2 が `app_platform_write` に許す
--    `plans` / `subscriptions` / `announcements` / `usage_counters` は、それぞれ
--    `SUBSCRIPTION` / `QUOTA` / `ANNOUNCEMENT` / `FEATURE_FLAG` ドメインの画面（Phase 2 / 3）で足す。
--    Phase 0 で配線されるのは `TENANT_PROVISIONING`（`A-014`）だけである。

-- ============================================================================
-- 1. platform_read ポリシー（52 表。docs/05 §5.2）
-- ============================================================================
-- USING:
--   current_setting('app.platform_user_id') <> ''
--   AND ( current_setting('app.target_tenant_id') = '' OR <T>::text = current_setting('app.target_tenant_id') )
-- 🔴 `app.target_tenant_id` が空のときだけテナント横断が成立する。`withPlatformRead` は
--    `op.targetTenantId` を必ず `set_config` するため、対象を指定した操作は自動的にそのテナントに閉じる。
-- 🔴 `tenant_id` を持たない 4 表（C0 の 3 表 + `announcements`）は tenant 条件を課さない（§5.2 末尾）。
--    業務内容を 1 列も持たないため横断してよい。
DO $do$
DECLARE
  t text;
  -- <T> = tenant_id の表（47）。
  tenant_keyed text[] := ARRAY[
    'users', 'memberships', 'partner_companies', 'invitations',
    'two_factor_credentials', 'tenant_sending_domains',
    'engineers', 'skill_aliases', 'engineer_skills', 'skill_sheets', 'file_scan_results',
    'skill_sheet_extractions',
    'projects', 'project_requirements', 'project_visibilities', 'engineer_shares',
    'match_candidates',
    'proposal_requests', 'proposals', 'engineer_snapshots', 'proposal_events', 'review_gates',
    'chat_threads', 'thread_participants', 'messages', 'contracts', 'contract_documents',
    'contract_templates', 'orders', 'assignments', 'extension_reviews',
    'tasks', 'notifications', 'ai_usage', 'audit_logs', 'usage_counters',
    'tenant_esign_connections', 'send_attempts', 'email_dispatches',
    'data_export_requests', 'tenant_purge_runs',
    'impersonation_sessions', 'tenant_role_approval_modes', 'tenant_role_models',
    'tenant_match_weights', 'tenant_monthly_costs', 'billing_meter_submissions'
  ];
  -- <T> を持たない表（4）。
  unkeyed text[] := ARRAY['scheduler_runs', 'webhook_deliveries', 'email_events', 'announcements'];
BEGIN
  -- 🔴 47 + 4 + tenants（<T> = id。下で個別に作る）= 52。合計が 52 でなければ取りこぼしがある
  --    （20260903050000 §2 の RLS 対象 52 表と 1 対 1 でなければならない）。
  IF array_length(tenant_keyed, 1) + array_length(unkeyed, 1) + 1 <> 52 THEN
    RAISE EXCEPTION 'platform_read の対象は 52 表のはずが % 表です（docs/05 §4.4 / §5.2）',
      array_length(tenant_keyed, 1) + array_length(unkeyed, 1) + 1;
  END IF;

  FOREACH t IN ARRAY tenant_keyed LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', t || '_platform_read', t);
    EXECUTE format(
      'CREATE POLICY %I ON %I FOR SELECT TO app_platform USING ('
      || 'current_setting(''app.platform_user_id'', true) <> '''''
      || ' AND (current_setting(''app.target_tenant_id'', true) = '''''
      || ' OR tenant_id::text = current_setting(''app.target_tenant_id'', true)))',
      t || '_platform_read', t);
  END LOOP;

  FOREACH t IN ARRAY unkeyed LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', t || '_platform_read', t);
    EXECUTE format(
      'CREATE POLICY %I ON %I FOR SELECT TO app_platform USING ('
      || 'current_setting(''app.platform_user_id'', true) <> '''')',
      t || '_platform_read', t);
  END LOOP;
END
$do$;

-- tenants は <T> = id（docs/05 §4.4 C1 と同じ読み替え）。20260903050000 §14 で作成済みだが、
-- 名前と式を本ファイルに集約するため作り直す（冪等）。
DROP POLICY IF EXISTS tenants_platform_read ON tenants;
CREATE POLICY tenants_platform_read ON tenants FOR SELECT TO app_platform
  USING (
    current_setting('app.platform_user_id', true) <> ''
    AND (
      current_setting('app.target_tenant_id', true) = ''
      OR id::text = current_setting('app.target_tenant_id', true)
    )
  );

-- ============================================================================
-- 2. 列レベル GRANT SELECT（app_platform。docs/05 §5.5 第 1 層）
-- ============================================================================
-- 🔴 20260903050000 §14 が置いたテーブル単位の GRANT を先に外す（列レベルへ寄せる）。
--    PostgreSQL ではテーブル単位の権限と列単位の権限が独立の ACL であり、
--    テーブル単位が残っていると列の列挙が意味を失う。
REVOKE SELECT ON tenants FROM app_platform;
REVOKE SELECT ON impersonation_sessions FROM app_platform;

GRANT SELECT (
  id, name, environment, lifecycle_state, lifecycle_changed_at, lifecycle_changed_by,
  suspend_reason, sandbox_expires_at, closing_entered_at, auto_approve_enabled,
  pii_retention_years, timezone, created_by_platform_user_id, provisioning_request_id,
  created_at
) ON tenants TO app_platform;

-- 🔴 非開示（§5.5）: password_hash
GRANT SELECT (
  id, tenant_id, owner_partner_company_id, email, display_name, password_reset_token_hash,
  password_reset_expires_at, disabled_at, last_login_at
) ON users TO app_platform;

GRANT SELECT (
  id, tenant_id, user_id, role, partner_company_id, joined_at, revoked_at
) ON memberships TO app_platform;

GRANT SELECT (
  id, tenant_id, name, contact_name, contact_email, suspended_at, invited_at
) ON partner_companies TO app_platform;

GRANT SELECT (
  id, tenant_id, email, role, partner_company_id, token_hash, expires_at, accepted_at,
  accepted_user_id, revoked_at, invited_by, invited_by_platform_user_id, created_at
) ON invitations TO app_platform;

-- 🔴 非開示（§5.5）: secret_encrypted / recovery_code_hashes
GRANT SELECT (
  id, subject_type, subject_id, tenant_id, confirmed_at
) ON two_factor_credentials TO app_platform;

GRANT SELECT (
  id, tenant_id, domain, state, ses_identity_arn, ses_tenant_name, dkim_tokens,
  mail_from_domain, verified_at, last_checked_at, last_failure_reason,
  registered_by_platform_user_id, created_at
) ON tenant_sending_domains TO app_platform;

-- 🔴 非開示（§5.5）: display_name / birth_date / contact_email / contact_phone / affiliation_label / city / preference_note / unit_price_min / unit_price_max
GRANT SELECT (
  id, tenant_id, owner_partner_company_id, availability, available_from, prefecture,
  remote_mode, retention_expires_at, pii_purged_at, created_at, updated_at
) ON engineers TO app_platform;

GRANT SELECT (
  id, tenant_id, alias, skill_id, status, origin, proposed_by, decided_by, decided_at
) ON skill_aliases TO app_platform;

GRANT SELECT (
  id, tenant_id, owner_partner_company_id, engineer_id, skill_id, years_of_experience, level,
  source, original_label, normalized_at, normalized_role, normalized_prompt_version,
  normalized_model_id
) ON engineer_skills TO app_platform;

-- 🔴 非開示（§5.5）: object_key
GRANT SELECT (
  id, tenant_id, owner_partner_company_id, engineer_id, version, content_type, byte_size,
  scan_status, scan_updated_at, is_latest, uploaded_by, uploaded_at, purged_at
) ON skill_sheets TO app_platform;

-- 🔴 非開示（§5.5）: object_key
GRANT SELECT (
  id, tenant_id, object_version_id, status, raw_status, received_at
) ON file_scan_results TO app_platform;

-- 🔴 非開示（§5.5）: payload
GRANT SELECT (
  id, tenant_id, owner_partner_company_id, skill_sheet_id, role, prompt_version, model_id,
  ai_usage_id, status, decided_by, decided_at, created_at
) ON skill_sheet_extractions TO app_platform;

-- 🔴 非開示（§5.5）: end_client_name / internal_unit_price / unit_price_min / unit_price_max
GRANT SELECT (
  id, tenant_id, name, public_summary, start_date, prefecture, remote_mode, headcount, status,
  origin_assignment_id, created_at, updated_at
) ON projects TO app_platform;

GRANT SELECT (
  id, tenant_id, project_id, kind, skill_id, free_text, required_years
) ON project_requirements TO app_platform;

GRANT SELECT (
  id, tenant_id, project_id, partner_company_id, published_at, published_by, revoked_at,
  review_gate_id
) ON project_visibilities TO app_platform;

GRANT SELECT (
  id, tenant_id, engineer_id, partner_company_id, shared_at, revoked_at, shared_by
) ON engineer_shares TO app_platform;

-- 🔴 非開示（§5.5）: rationale
GRANT SELECT (
  id, tenant_id, project_id, engineer_id, is_anonymous, score, breakdown, cutoff_reason,
  weights_snapshot, rationale_role, rationale_prompt_version, rationale_model_id,
  rationale_ai_usage_id, computed_at
) ON match_candidates TO app_platform;

-- 🔴 非開示（§5.5）: message / decline_reason
GRANT SELECT (
  id, tenant_id, project_id, engineer_id, partner_company_id, state, expires_at, issued_by,
  responded_by, responded_at, created_at
) ON proposal_requests TO app_platform;

-- 🔴 非開示（§5.5）: subject / body / draft_body / recipient_email / offered_unit_price / recipient_company_name
GRANT SELECT (
  id, tenant_id, owner_partner_company_id, project_id, engineer_id, proposal_request_id, state,
  offered_start_date, work_style, draft_role, draft_prompt_version, draft_model_id,
  draft_ai_usage_id, content_hash, approved_by, approved_by_system, approved_at, submitted_at,
  last_failure_reason, send_hold_reason_key, send_hold_since, created_by, created_at,
  updated_at
) ON proposals TO app_platform;

-- 🔴 非開示（§5.5）: display_name / affiliation_label / skills / careers / unit_price_min / unit_price_max
GRANT SELECT (
  id, tenant_id, owner_partner_company_id, proposal_id, available_from, prefecture,
  remote_mode, skill_sheet_id, frozen_at
) ON engineer_snapshots TO app_platform;

-- 🔴 非開示（§5.5）: note / attachment_key
GRANT SELECT (
  id, tenant_id, owner_partner_company_id, proposal_id, kind, from_state, to_state,
  actor_user_id, occurred_at
) ON proposal_events TO app_platform;

-- 🔴 非開示（§5.5）: findings / ai_warnings
GRANT SELECT (
  id, tenant_id, owner_partner_company_id, target_type, target_id, content_hash, execution,
  held_since, pii_verdict, commerce_verdict, consistency_verdict, role, prompt_version,
  model_id, ai_usage_id, ai_failed, executed_at
) ON review_gates TO app_platform;

GRANT SELECT (
  id, tenant_id, kind, project_id, partner_company_id, created_at, last_message_at
) ON chat_threads TO app_platform;

GRANT SELECT (
  id, tenant_id, thread_id, partner_company_id, joined_at, left_at
) ON thread_participants TO app_platform;

-- 🔴 非開示（§5.5）: body / attachment_key
GRANT SELECT (
  id, tenant_id, owner_partner_company_id, thread_id, sender_user_id,
  sender_partner_company_id, attachment_scan_status, review_gate_id, sent_at, purged_at
) ON messages TO app_platform;

-- 🔴 非開示（§5.5）: unit_price / counterparty_name / payment_terms
GRANT SELECT (
  id, tenant_id, kind, state, counterparty_partner_company_id, project_id, engineer_id,
  assignment_id, period_start, period_end, corrects_contract_id, send_failure_reason,
  send_hold_reason_key, send_hold_since, withdraw_reason, executed_at, expired_at, created_at,
  updated_at
) ON contracts TO app_platform;

-- 🔴 非開示（§5.5）: signers / object_key / merge_result
GRANT SELECT (
  id, tenant_id, counterparty_partner_company_id, contract_id, version, template_id,
  template_version, review_gate_id, scan_status, external_document_id, external_provider,
  sent_via, requested_at, signed_at, normalized_status
) ON contract_documents TO app_platform;

-- 🔴 非開示（§5.5）: object_key / mapping
GRANT SELECT (
  id, tenant_id, name, kind, version, scan_status, placeholders, is_latest, archived_at,
  created_by, created_at
) ON contract_templates TO app_platform;

-- 🔴 非開示（§5.5）: amount
GRANT SELECT (
  id, tenant_id, counterparty_partner_company_id, contract_id, assignment_id, period_start,
  period_end, issued_on, payment_state, created_at
) ON orders TO app_platform;

-- 🔴 非開示（§5.5）: unit_price
GRANT SELECT (
  id, tenant_id, engineer_id, project_id, proposal_id, counterparty_partner_company_id, state,
  start_date, end_date, actual_leave_date, review_opened_at, reminder30_sent_at, owner_user_id
) ON assignments TO app_platform;

-- 🔴 非開示（§5.5）: facts / summary
GRANT SELECT (
  id, tenant_id, assignment_id, opened_at, owner_user_id, role, prompt_version, model_id,
  ai_usage_id, decision, decided_by, decided_at
) ON extension_reviews TO app_platform;

GRANT SELECT (
  id, tenant_id, owner_partner_company_id, kind, target_type, target_id, due_on,
  assignee_user_id, state, auto_generated, completed_at
) ON tasks TO app_platform;

-- 🔴 非開示（§5.5）: title / body_params
GRANT SELECT (
  id, tenant_id, recipient_user_id, kind, target_type, target_id, body_key, read_at,
  email_dispatch_id, suppressed_by_limit, created_at
) ON notifications TO app_platform;

GRANT SELECT (
  id, tenant_id, role, model_id, purpose, prompt_version, target_type, target_id, input_tokens,
  output_tokens, cache_read_tokens, cache_write_tokens, estimated_cost_usd, attempt_no,
  succeeded, failure_kind, started_at, finished_at
) ON ai_usage TO app_platform;

GRANT SELECT (
  id, tenant_id, actor_kind, actor_id, action, target_type, target_id, summary,
  impersonation_session_id, ip_address, device_kind, created_at
) ON audit_logs TO app_platform;

GRANT SELECT (
  id, tenant_id, period_kind, period_key, metric, value, reserved_value, observed_at
) ON usage_counters TO app_platform;

-- 🔴 非開示（§5.5）: credential_encrypted / connect_hmac_keys_encrypted / webhook_path_secret_encrypted
GRANT SELECT (
  id, tenant_id, provider, external_account_id, base_uri, account_name, connect_config_id,
  signing_order_default, connected_at, last_verified_at, invalidated_at, connected_by
) ON tenant_esign_connections TO app_platform;

-- 🔴 非開示（§5.5）: failure_detail
GRANT SELECT (
  id, tenant_id, entity_type, entity_id, attempt_seq, idempotency_key, status, external_id,
  failure_kind, started_at, settled_at, requested_by
) ON send_attempts TO app_platform;

-- 🔴 非開示（§5.5）: recipient_email
GRANT SELECT (
  id, tenant_id, recipient_class, template_key, dedupe_key, status, held_at, ses_message_id,
  sent_at, failure_reason
) ON email_dispatches TO app_platform;

-- 🔴 非開示（§5.5）: payload
GRANT SELECT (
  id, tenant_id, ses_message_id, event_type, occurred_at
) ON email_events TO app_platform;

-- 🔴 非開示（§5.5）: payload
GRANT SELECT (
  id, provider, external_event_id, dedupe_key, received_at, processed_at, process_failed_at,
  failure_reason
) ON webhook_deliveries TO app_platform;

-- 🔴 非開示（§5.5）: object_key
GRANT SELECT (
  id, tenant_id, kind, scope, status, requested_by, requested_at, ready_at, expires_at
) ON data_export_requests TO app_platform;

GRANT SELECT (
  id, tenant_id, cause, status, started_at, completed_at, counts, failure_reason
) ON tenant_purge_runs TO app_platform;

GRANT SELECT (
  id, job_name, run_key, started_at, finished_at, status, detail
) ON scheduler_runs TO app_platform;

GRANT SELECT (
  id, platform_user_id, tenant_id, reason, started_at, expires_at, ended_at, end_kind,
  notified_user_ids, notification_failed
) ON impersonation_sessions TO app_platform;

GRANT SELECT (
  id, kind, target_tenant_ids, feature_key, enabled, title_key, body_key, reason_key,
  visible_from, visible_to, created_by
) ON announcements TO app_platform;

GRANT SELECT (
  tenant_id, role, mode, updated_by, updated_at
) ON tenant_role_approval_modes TO app_platform;

GRANT SELECT (
  tenant_id, role, model_id, updated_by, updated_at
) ON tenant_role_models TO app_platform;

GRANT SELECT (
  tenant_id, factor, weight, updated_by, updated_at
) ON tenant_match_weights TO app_platform;

GRANT SELECT (
  tenant_id, period_month, revenue_seat_jpy, revenue_overage_jpy, cost_ai_usd, cost_ai_by_role,
  cost_email_usd, cost_storage_usd, cost_esign_usd, pricing_ruleset_version,
  storage_bytes_at_month_end, gross_margin_rate, baseline_ratio, quota_consumption_rate,
  meter_diff_jpy, finalized_at, updated_at
) ON tenant_monthly_costs TO app_platform;

GRANT SELECT (
  tenant_id, event_name, period_end, value, submitted_at, stripe_identifier
) ON billing_meter_submissions TO app_platform;
-- ============================================================================
-- 3. audit_logs への INSERT（app_platform / app_platform_write。docs/05 §5.3）
-- ============================================================================
-- 🔴 §5.3 は「`fn` を実行する**前に** `AuditLog` を `INSERT` する。**同一トランザクション**で行い、
--    `INSERT` に失敗したらクエリを実行しない」と定める。読み取り接続（app_platform）自身が
--    書けなければこれは成立しない（別接続で書くと「監査は commit されたがクエリは rollback」
--    「クエリは commit されたが監査は rollback」の両方が起こりうる）。
--    docs/05 §4.2 の表も `app_platform` の権限を「業務テーブルへの `SELECT` のみ。
--    `audit_logs` は `INSERT/SELECT`」と書いている。**業務テーブルへの書き込みは 1 つも開いていない。**
-- 🔴 `UPDATE` / `DELETE` は 20260903040000 で `REVOKE` 済み（`F-005 AC-3`。編集・削除できない）。
--
-- 🔴 書ける行は「自分が主体で、対象テナントに一致する行」だけである:
--    - `actor_kind = 'PLATFORM_USER'` かつ `actor_id = app.platform_user_id`
--      （他人・テナント利用者になりすました記録を書けない）
--    - `app.target_tenant_id` が空なら `tenant_id IS NULL`（横断操作）、
--      指定があれば `tenant_id` がそれと一致（対象テナントの操作）
--      → `withPlatformRead` / `withPlatformWrite` が `set_config` した対象以外を記録できない。
DROP POLICY IF EXISTS audit_logs_platform_insert ON "audit_logs";
CREATE POLICY audit_logs_platform_insert ON "audit_logs" FOR INSERT TO app_platform
  WITH CHECK (
    current_setting('app.platform_user_id', true) <> ''
    AND actor_kind = 'PLATFORM_USER'
    AND actor_id::text = current_setting('app.platform_user_id', true)
    AND (
      CASE
        WHEN current_setting('app.target_tenant_id', true) = '' THEN tenant_id IS NULL
        ELSE tenant_id::text = current_setting('app.target_tenant_id', true)
      END
    )
  );

-- 🔴 `app_platform_write` 版。T-03-07 が置いた `audit_logs_platform_auth_insert` は
--    `app.platform_auth_subject_id`（認証経路専用の GUC）を要求するため、`withPlatformWrite` の
--    トランザクション（その GUC を空で上書きする。§5.3）では 1 つも真にならない。逆に本ポリシーは
--    認証トランザクション（`app.platform_user_id` を空で上書きする）では真にならない。**射程は交わらない。**
DROP POLICY IF EXISTS audit_logs_platform_write_insert ON "audit_logs";
CREATE POLICY audit_logs_platform_write_insert ON "audit_logs" FOR INSERT TO app_platform_write
  WITH CHECK (
    current_setting('app.platform_user_id', true) <> ''
    AND actor_kind = 'PLATFORM_USER'
    AND actor_id::text = current_setting('app.platform_user_id', true)
    AND (
      CASE
        WHEN current_setting('app.target_tenant_id', true) = '' THEN tenant_id IS NULL
        ELSE tenant_id::text = current_setting('app.target_tenant_id', true)
      END
    )
  );

-- 🔴 INSERT のみ（SELECT は §2 の列レベル GRANT で付与済み）。
GRANT INSERT ON "audit_logs" TO app_platform;

-- ============================================================================
-- 4. app_platform_write: tenants の読み戻し 2 列（🔴 Issue #24 の決定 = 既定値 A）
-- ============================================================================
-- 🔴 `INSERT ... RETURNING` には `SELECT` ポリシーと `SELECT` 権限が適用される（PostgreSQL の仕様。
--    20260903050000 冒頭の注記と同じ）。API-A4（テナント開設）が作成直後の
--    `{ id, lifecycleState }` を返すには、この 2 列の `SELECT` が要る。
-- 🔴 **行全体・他列に広げない。** 広げると `BR-40`（運営者に見せないもの）の担保が
--    「走査テストの除外リスト」頼みになり、§5.5 第 1 層の「書き忘れても漏れない」が崩れる。
DROP POLICY IF EXISTS tenants_platform_write_select ON tenants;
CREATE POLICY tenants_platform_write_select ON tenants FOR SELECT TO app_platform_write
  USING (
    current_setting('app.platform_user_id', true) <> ''
    AND (
      current_setting('app.target_tenant_id', true) = ''
      OR id::text = current_setting('app.target_tenant_id', true)
    )
  );

GRANT SELECT (id, lifecycle_state) ON tenants TO app_platform_write;

-- ============================================================================
-- 5. app_platform_write: invitations / tenant_sending_domains の INSERT（docs/05 §5.2）
-- ============================================================================
-- 🔴 いずれも `INSERT` のみ。`SELECT` を与えないため、書き込みは `createMany()`（RETURNING 無し）で
--    行う必要がある（20260903050000 冒頭の `notifications` / `audit_logs` と同じ帰結）。
--    「作った行を運営者が読み返す」経路をそもそも作らない。
--
-- 🔴 invitations: 運営者が発行できるのは**初期 `OWNER` 招待だけ**である（§5.2）。
--    `role = 'OWNER'` / `partner_company_id IS NULL` / `invited_by IS NULL` /
--    `invited_by_platform_user_id = app.platform_user_id` を `WITH CHECK` で固定する。
--    `SALES` やパートナーの招待、既存招待の変更・取消（`UPDATE` / `DELETE`）はできない。
DROP POLICY IF EXISTS invitations_platform_write_insert ON invitations;
CREATE POLICY invitations_platform_write_insert ON invitations FOR INSERT TO app_platform_write
  WITH CHECK (
    current_setting('app.platform_user_id', true) <> ''
    AND tenant_id::text = current_setting('app.target_tenant_id', true)
    AND role = 'OWNER'
    AND partner_company_id IS NULL
    AND invited_by IS NULL
    AND invited_by_platform_user_id::text = current_setting('app.platform_user_id', true)
  );

GRANT INSERT ON invitations TO app_platform_write;

-- 🔴 tenant_sending_domains: 運営者は**登録だけを代行**する（§5.2 / `A-014` 5b）。
--    DNS の設定・検証の実行・`verified_at` の書き込みはできない（`UPDATE` を GRANT しない。
--    検証は `OWNER` が `S-036` から行う）。
DROP POLICY IF EXISTS tenant_sending_domains_platform_write_insert ON tenant_sending_domains;
CREATE POLICY tenant_sending_domains_platform_write_insert ON tenant_sending_domains
  FOR INSERT TO app_platform_write
  WITH CHECK (
    current_setting('app.platform_user_id', true) <> ''
    AND tenant_id::text = current_setting('app.target_tenant_id', true)
    AND state = 'REGISTERED'
    AND verified_at IS NULL
    AND registered_by_platform_user_id::text = current_setting('app.platform_user_id', true)
  );

GRANT INSERT ON tenant_sending_domains TO app_platform_write;
