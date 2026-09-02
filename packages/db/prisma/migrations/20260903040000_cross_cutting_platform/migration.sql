-- T-02-05（docs/sprints/SP-02-schema-isolation.md）: docs/05 §3.8「横断（タスク・通知・記録・計測）」
-- + §3.9「外部連携・送信・環境」（TenantSendingDomain は T-02-01 で実装済み）
-- + §3.10「管理平面・課金・AI 設定」の 23 表。
--
-- 🔴 このファイルは `prisma migrate diff --from-url <既存 4 migration 適用済み DB>
--    --to-schema-datamodel schema.prisma --script` が出力した素の SQL を手で編集したものである
--    （schema.prisma 冒頭コメント参照）。docs/05 §3.1「列挙」規約に従い、列挙相当の列はすべて
--    TEXT + CHECK に落としてある。TS 側の単一出所は packages/db/src/schema-value-sets.ts であり、
--    CHECK の値集合との一致は tests/static/schema-enum-drift.test.ts が突合する。
--
-- 🔴 AuditLog の月次レンジパーティション（docs/03 §8.3 / T-A-11。Phase 1 から）。Prisma は
--    宣言的パーティショニングを DSL として表現できないため、schema.prisma 側は通常モデルとして
--    宣言し、実体（PARTITION BY / 初期パーティション）はここに手書きする。パーティション境界は
--    UTC の暦月（技術的な保守区分であり、業務判定の Asia/Tokyo 基準とは無関係。docs/03 §4.6）。
--    🔴 実際の主キーは `PRIMARY KEY (id, created_at)`（Postgres の制約でパーティション列を
--    含める必要がある）。`id` 単独の一意性は UUIDv7 の生成規約に拠り、audit_logs は
--    INSERT/SELECT のみ（UPDATE/DELETE は REVOKE）で upsert を行わない運用のため実害はない。
--
-- 🔴 RLS: 新規 23 表のうち 19 表（射程外 4 表 platform_users / plans / subscriptions と
--    C0 SYSTEM_ONLY の一部を除く）は ENABLE + FORCE ROW LEVEL SECURITY のみを
--    packages/db/prisma/sql/010_rls.sql に追加する（T-02-01〜04 と同じ fail-closed 既定。
--    ポリシー本体・GRANT は T-02-06/07）。射程外 4 表のうち platform_users / plans /
--    subscriptions は本タスクで実在するようになるが、`skills` と同じく RLS を一切適用しない
--    （CLAUDE.md §3.1）。C0 SYSTEM_ONLY の 4 表（scheduler_runs / webhook_deliveries /
--    email_events / impersonation_sessions）は ENABLE + FORCE のみを 010_rls.sql に追加する
--    （C0 のポリシー本体〔app_tenant を締め出す `app_tenant_id() IS NULL`〕は T-02-06 の範囲）。
--
-- 適用方法: `app_migrator`（`MIGRATION_DATABASE_URL` 相当）で `prisma migrate deploy` を実行する
-- （docs/05 §4.2）。000_roles.sql と先行 4 migration が適用済みであること。

-- ============================================================================
-- CreateTable: tasks（docs/05 §3.8。root のオーナー列を持つ 4 表の 1 つ）
-- ============================================================================
CREATE TABLE "tasks" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "owner_partner_company_id" UUID,
    -- docs/05 §3.8 TaskKind。TEXT + CHECK。
    "kind" TEXT NOT NULL,
    "target_type" TEXT NOT NULL,
    "target_id" UUID NOT NULL,
    "due_on" DATE NOT NULL,
    "assignee_user_id" UUID NOT NULL,
    -- docs/05 §3.8 TaskState。TEXT + CHECK。
    "state" TEXT NOT NULL DEFAULT 'OPEN',
    "auto_generated" BOOLEAN NOT NULL DEFAULT true,
    "completed_at" TIMESTAMPTZ(3),

    CONSTRAINT "tasks_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "tasks_kind_check" CHECK ("kind" IN ('EXTENSION_REVIEW', 'INTERVIEW', 'CONTRACT_PENDING')),
    CONSTRAINT "tasks_state_check" CHECK ("state" IN ('OPEN', 'DONE'))
);

-- ============================================================================
-- CreateTable: notifications
-- ============================================================================
CREATE TABLE "notifications" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "recipient_user_id" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "target_type" TEXT,
    "target_id" UUID,
    "title" TEXT NOT NULL,
    "body_key" TEXT NOT NULL,
    "body_params" JSONB NOT NULL,
    "read_at" TIMESTAMPTZ(3),
    "email_dispatch_id" UUID,
    "suppressed_by_limit" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- ============================================================================
-- CreateTable: ai_usage
-- ============================================================================
CREATE TABLE "ai_usage" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    -- docs/05 §3.8 AiRole。🔴 NOT NULL（F-026 AC-2）。TEXT + CHECK。
    "role" TEXT NOT NULL,
    "model_id" TEXT NOT NULL,
    -- 🔴 AiUsagePurpose。値集合はドキュメント上省略記法（'gate'|'sheet_parse'|...）だが、
    --    6 ロールと 1:1 対応することが示された 2 例と docs/03 §7.6.1 のメーター名から
    --    programmer 判断で確定（プログラマ完了報告に記載。schema.prisma 該当コメント参照）。
    "purpose" TEXT NOT NULL,
    "prompt_version" TEXT NOT NULL,
    "target_type" TEXT,
    "target_id" UUID,
    "input_tokens" INTEGER NOT NULL,
    "output_tokens" INTEGER NOT NULL,
    "cache_read_tokens" INTEGER NOT NULL DEFAULT 0,
    "cache_write_tokens" INTEGER NOT NULL DEFAULT 0,
    "estimated_cost_usd" DECIMAL(12,6) NOT NULL,
    "attempt_no" INTEGER NOT NULL DEFAULT 1,
    "succeeded" BOOLEAN NOT NULL,
    -- docs/05 §3.8 AiUsageFailureKind（nullable）。TEXT + CHECK。
    "failure_kind" TEXT,
    "started_at" TIMESTAMPTZ(3) NOT NULL,
    "finished_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "ai_usage_pkey" PRIMARY KEY ("id"),
    -- 🔴 ロール識別子の欠損・誤記が DB に入らない（F-026 AC-2）。
    CONSTRAINT "ai_usage_role_check" CHECK ("role" IN ('sheet-parser', 'skill-normalizer', 'match-explainer', 'gate-inspector', 'proposal-drafter', 'renewal-advisor')),
    CONSTRAINT "ai_usage_purpose_check" CHECK ("purpose" IN ('sheet_parse', 'skill_normalize', 'match_rationale', 'gate', 'proposal_draft', 'renewal_summary')),
    CONSTRAINT "ai_usage_failure_kind_check" CHECK ("failure_kind" IN ('SCHEMA', 'TIMEOUT', 'RATE', 'SPEND_CAP', 'API'))
);

-- ============================================================================
-- CreateTable: audit_logs（🔴 created_at の月次レンジパーティション。上記コメント参照）
-- ============================================================================
CREATE TABLE "audit_logs" (
    "id" UUID NOT NULL,
    "tenant_id" UUID,
    -- docs/05 §3.8 AuditActorKind。TEXT + CHECK。
    "actor_kind" TEXT NOT NULL,
    "actor_id" UUID,
    "action" TEXT NOT NULL, -- §16.1 の一覧（オープンな名前空間。CHECK なし）
    "target_type" TEXT,
    "target_id" UUID,
    "summary" JSONB NOT NULL,
    "impersonation_session_id" UUID,
    "ip_address" TEXT,
    -- docs/05 §3.8 AuditDeviceKind（nullable）。TEXT + CHECK。
    "device_kind" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id", "created_at"),
    CONSTRAINT "audit_logs_actor_kind_check" CHECK ("actor_kind" IN ('USER', 'PLATFORM_USER', 'SYSTEM')),
    CONSTRAINT "audit_logs_device_kind_check" CHECK ("device_kind" IN ('desktop', 'mobile', 'tablet', 'api'))
) PARTITION BY RANGE ("created_at");

-- 🔴 初期パーティション（`audit.create-partitions` 相当。docs/05 §9.9。今月 + 翌々月分まで
--    先回りで作る。運用開始後は毎日 00:30 JST のジョブが継続して先回りする）。
CREATE TABLE "audit_logs_2026_09" PARTITION OF "audit_logs"
    FOR VALUES FROM ('2026-09-01 00:00:00+00') TO ('2026-10-01 00:00:00+00');
CREATE TABLE "audit_logs_2026_10" PARTITION OF "audit_logs"
    FOR VALUES FROM ('2026-10-01 00:00:00+00') TO ('2026-11-01 00:00:00+00');
CREATE TABLE "audit_logs_2026_11" PARTITION OF "audit_logs"
    FOR VALUES FROM ('2026-11-01 00:00:00+00') TO ('2026-12-01 00:00:00+00');
-- 🔴 安全弁。`audit.create-partitions` の失敗・遅延時でも INSERT 自体は失敗させない
--    （fail-safe。滞留は A-005 の運用監視で検知する対象であり、本タスクの範囲外）。
CREATE TABLE "audit_logs_default" PARTITION OF "audit_logs" DEFAULT;

-- ============================================================================
-- CreateTable: usage_counters
-- ============================================================================
CREATE TABLE "usage_counters" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    -- docs/05 §3.8 UsageCounterPeriodKind。TEXT + CHECK。
    "period_kind" TEXT NOT NULL,
    "period_key" TEXT NOT NULL,
    -- 🔴 UsageCounterMetric。TEXT + CHECK。AI_UNIT_* は利用者向け件数（docs/03 §7.6.1。MONTH のみ）。
    --    金額と独立に加算し、AiUsage の行数から数え直さない（§7.6）。
    "metric" TEXT NOT NULL,
    "value" DECIMAL(20,6) NOT NULL,
    "reserved_value" DECIMAL(20,6) NOT NULL DEFAULT 0,
    "observed_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "usage_counters_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "usage_counters_period_kind_check" CHECK ("period_kind" IN ('DAY', 'MONTH')),
    CONSTRAINT "usage_counters_metric_check" CHECK ("metric" IN ('AI_COST_USD', 'EMAIL_COUNT', 'STORAGE_BYTES', 'SEAT_COUNT', 'ESIGN_REQUESTS', 'AI_UNIT_SHEET_PARSE', 'AI_UNIT_MATCH_RATIONALE', 'AI_UNIT_PROPOSAL_DRAFT', 'AI_UNIT_RENEWAL_SUMMARY'))
);

-- ============================================================================
-- CreateTable: tenant_esign_connections（docs/03 §3.1.2 / §3.1.2a。決定済み Issue #11）
-- ============================================================================
CREATE TABLE "tenant_esign_connections" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    -- 🔴 EsignProvider。ContractDocument.external_provider と同じ値集合を共有する。TEXT + CHECK。
    "provider" TEXT NOT NULL,
    "credential_encrypted" TEXT NOT NULL, -- 🔴 §8.6。運営者に GRANT しない（§5.5）
    "external_account_id" TEXT NOT NULL,
    "base_uri" TEXT NOT NULL,
    "account_name" TEXT NOT NULL,
    "connect_hmac_keys_encrypted" TEXT[], -- 🔴 運営者に GRANT しない（§5.5）
    "connect_config_id" TEXT,
    "webhook_path_secret_encrypted" TEXT, -- 🔴 運営者に GRANT しない（§5.5）
    -- docs/05 §3.9 EsignSigningOrder。TEXT + CHECK。
    "signing_order_default" TEXT NOT NULL DEFAULT 'HOST_FIRST',
    "connected_at" TIMESTAMPTZ(3) NOT NULL,
    "last_verified_at" TIMESTAMPTZ(3),
    "invalidated_at" TIMESTAMPTZ(3),
    "connected_by" UUID NOT NULL,

    CONSTRAINT "tenant_esign_connections_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "tenant_esign_connections_provider_check" CHECK ("provider" IN ('docusign', 'cloudsign', 'mock')),
    CONSTRAINT "tenant_esign_connections_signing_order_default_check" CHECK ("signing_order_default" IN ('HOST_FIRST', 'PARALLEL'))
);

-- ============================================================================
-- CreateTable: send_attempts（🔴 docs/03 §4.7。K-5 の防御線）
-- ============================================================================
CREATE TABLE "send_attempts" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    -- docs/05 §3.9 SendAttemptEntityType。TEXT + CHECK。
    "entity_type" TEXT NOT NULL,
    "entity_id" UUID NOT NULL,
    "attempt_seq" INTEGER NOT NULL,
    "idempotency_key" TEXT NOT NULL,
    -- docs/05 §3.9 SendAttemptStatus。TEXT + CHECK。
    "status" TEXT NOT NULL,
    "external_id" TEXT,
    "failure_kind" TEXT, -- §15.4 の分類（オープン。CHECK なし）
    "failure_detail" TEXT,
    "started_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "settled_at" TIMESTAMPTZ(3),
    "requested_by" UUID,

    CONSTRAINT "send_attempts_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "send_attempts_entity_type_check" CHECK ("entity_type" IN ('PROPOSAL', 'INTERVIEW', 'CONTRACT')),
    CONSTRAINT "send_attempts_status_check" CHECK ("status" IN ('RESERVED', 'SUCCEEDED', 'FAILED', 'UNKNOWN'))
);

-- ============================================================================
-- CreateTable: email_dispatches（docs/05 §8.2 の分類 1 / 分類外の運用メール）
-- ============================================================================
CREATE TABLE "email_dispatches" (
    "id" UUID NOT NULL,
    "tenant_id" UUID,
    -- docs/05 §3.9 EmailRecipientClass。TEXT + CHECK。
    "recipient_class" TEXT NOT NULL,
    "recipient_email" TEXT NOT NULL,
    "template_key" TEXT NOT NULL,
    "dedupe_key" TEXT NOT NULL,
    -- 🔴 EmailDispatchStatus（7 値）。TEXT + CHECK。HELD_* は「失敗」ではない。
    "status" TEXT NOT NULL,
    "held_at" TIMESTAMPTZ(3),
    "ses_message_id" TEXT,
    "sent_at" TIMESTAMPTZ(3),
    "failure_reason" TEXT,

    CONSTRAINT "email_dispatches_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "email_dispatches_recipient_class_check" CHECK ("recipient_class" IN ('HOST_MEMBER', 'PARTNER_MEMBER', 'CLIENT', 'ENGINEER', 'PLATFORM')),
    CONSTRAINT "email_dispatches_status_check" CHECK ("status" IN ('QUEUED', 'HELD_DOMAIN_UNVERIFIED', 'HELD_PROVIDER_QUOTA', 'SENT', 'MOCKED', 'FAILED', 'SUPPRESSED'))
);

-- ============================================================================
-- CreateTable: email_events（🔴 C0 SYSTEM_ONLY。SES のバウンス・苦情。SNS at-least-once）
-- ============================================================================
CREATE TABLE "email_events" (
    "id" UUID NOT NULL,
    "tenant_id" UUID, -- 🔴 C0（宛先解決前に届くため Tenant への FK を張らない。§3.1 共通規約）
    "ses_message_id" TEXT NOT NULL,
    -- docs/05 §3.9 EmailEventType（SES の実値）。TEXT + CHECK。
    "event_type" TEXT NOT NULL,
    "occurred_at" TIMESTAMPTZ(3) NOT NULL,
    "payload" JSONB NOT NULL, -- 🔴 宛先はハッシュ化して保存（§16.2）

    CONSTRAINT "email_events_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "email_events_event_type_check" CHECK ("event_type" IN ('Bounce', 'Complaint', 'Delivery', 'Reject', 'Delay'))
);

-- ============================================================================
-- CreateTable: webhook_deliveries（🔴 C0 SYSTEM_ONLY。テナントキーを持たない表）
-- ============================================================================
CREATE TABLE "webhook_deliveries" (
    "id" UUID NOT NULL,
    -- docs/05 §3.9 WebhookProvider。TEXT + CHECK。
    "provider" TEXT NOT NULL,
    "external_event_id" TEXT,
    "dedupe_key" TEXT NOT NULL,
    "received_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processed_at" TIMESTAMPTZ(3),
    "process_failed_at" TIMESTAMPTZ(3),
    "failure_reason" TEXT,
    "payload" JSONB NOT NULL, -- 🔴 秘匿値は redact 後に保存

    CONSTRAINT "webhook_deliveries_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "webhook_deliveries_provider_check" CHECK ("provider" IN ('ses', 'guardduty', 'docusign', 'cloudsign', 'stripe'))
);

-- ============================================================================
-- CreateTable: data_export_requests（F-064 AC-5 / F-052）
-- ============================================================================
CREATE TABLE "data_export_requests" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    -- docs/05 §3.9 DataExportKind。TEXT + CHECK。
    "kind" TEXT NOT NULL,
    "scope" JSONB NOT NULL,
    -- docs/05 §3.9 DataExportStatus。TEXT + CHECK。
    "status" TEXT NOT NULL,
    "object_key" TEXT,
    "requested_by" UUID NOT NULL,
    "requested_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ready_at" TIMESTAMPTZ(3),
    "expires_at" TIMESTAMPTZ(3),

    CONSTRAINT "data_export_requests_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "data_export_requests_kind_check" CHECK ("kind" IN ('CLOSING_RETURN', 'OPERATIONAL')),
    CONSTRAINT "data_export_requests_status_check" CHECK ("status" IN ('QUEUED', 'RUNNING', 'READY', 'FAILED', 'EXPIRED'))
);

-- ============================================================================
-- CreateTable: tenant_purge_runs（🔴 削除完了の確認の唯一の根拠。F-062 AC-7）
-- ============================================================================
CREATE TABLE "tenant_purge_runs" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    -- docs/05 §3.9 TenantPurgeCause。TEXT + CHECK。
    "cause" TEXT NOT NULL,
    -- docs/05 §3.9 TenantPurgeStatus。TEXT + CHECK。
    "status" TEXT NOT NULL,
    "started_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMPTZ(3),
    "counts" JSONB NOT NULL,
    "failure_reason" TEXT,

    CONSTRAINT "tenant_purge_runs_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "tenant_purge_runs_cause_check" CHECK ("cause" IN ('TENANT_PURGED', 'RETENTION')),
    CONSTRAINT "tenant_purge_runs_status_check" CHECK ("status" IN ('RUNNING', 'COMPLETED', 'FAILED'))
);

-- ============================================================================
-- CreateTable: scheduler_runs（🔴 C0 SYSTEM_ONLY。テナントキーを持たない表）
-- ============================================================================
CREATE TABLE "scheduler_runs" (
    "id" UUID NOT NULL,
    "job_name" TEXT NOT NULL,
    "run_key" TEXT NOT NULL,
    "started_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finished_at" TIMESTAMPTZ(3),
    -- docs/05 §3.9 SchedulerRunStatus。TEXT + CHECK。
    "status" TEXT NOT NULL,
    "detail" JSONB,

    CONSTRAINT "scheduler_runs_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "scheduler_runs_status_check" CHECK ("status" IN ('RUNNING', 'OK', 'FAILED'))
);

-- ============================================================================
-- CreateTable: platform_users（🔴 射程外 4 表の 1 つ。CLAUDE.md §3.1。RLS は適用しない）
-- ============================================================================
CREATE TABLE "platform_users" (
    "id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "display_name" TEXT NOT NULL,
    -- docs/05 §3.3 冒頭 PlatformRole。TEXT + CHECK。
    "role" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "disabled_at" TIMESTAMPTZ(3),
    "last_login_at" TIMESTAMPTZ(3),

    CONSTRAINT "platform_users_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "platform_users_role_check" CHECK ("role" IN ('PLATFORM_OWNER', 'PLATFORM_SUPPORT'))
);

-- ============================================================================
-- CreateTable: plans（🔴 射程外 4 表の 1 つ。RLS は適用しない）
-- ============================================================================
CREATE TABLE "plans" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL, -- 'starter'|'standard'|'business'。業務データのため CHECK なし
    "name" TEXT NOT NULL,
    "seat_limit" INTEGER NOT NULL,
    "ai_cost_cap_usd" DECIMAL(10,2) NOT NULL,
    "ai_daily_cost_limit_usd" DECIMAL(10,2) NOT NULL,
    "unit_quota_sheet_parse" INTEGER NOT NULL,
    "unit_quota_match_rationale" INTEGER NOT NULL,
    "unit_quota_proposal_draft" INTEGER NOT NULL,
    "unit_quota_renewal_summary" INTEGER NOT NULL,
    "email_daily_limit" INTEGER NOT NULL DEFAULT 500,
    "email_minute_limit" INTEGER NOT NULL DEFAULT 30,
    "storage_limit_bytes" BIGINT NOT NULL,
    "gross_margin_threshold" DECIMAL(5,4) NOT NULL,
    "monthly_seat_price_jpy" DECIMAL(12,2) NOT NULL,
    "overage_unit_prices_jpy" JSONB NOT NULL,
    "feature_flag_defaults" JSONB NOT NULL,

    CONSTRAINT "plans_pkey" PRIMARY KEY ("id"),
    -- 🔴 docs/03 §7.6.2「各単位の下限は 10 件」（0 件になる単位を作らない）。
    CONSTRAINT "plans_unit_quota_check" CHECK (
        "unit_quota_sheet_parse" >= 10
        AND "unit_quota_match_rationale" >= 10
        AND "unit_quota_proposal_draft" >= 10
        AND "unit_quota_renewal_summary" >= 10
    )
);

-- ============================================================================
-- CreateTable: subscriptions（tenant_id 列は持つが RLS の射程外。docs/05 §3.10 末尾）
-- ============================================================================
CREATE TABLE "subscriptions" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "plan_id" UUID NOT NULL,
    -- docs/05 §3.10 SubscriptionBillingState。TEXT + CHECK。
    "billing_state" TEXT NOT NULL,
    "seat_count" INTEGER NOT NULL,
    "quota_override_usd" DECIMAL(10,2),
    "unit_quota_override" JSONB,
    "quota_override_effective_from" DATE,
    "started_on" DATE NOT NULL,
    "next_billing_on" DATE,
    "stripe_customer_id" TEXT,
    "stripe_subscription_id" TEXT,

    CONSTRAINT "subscriptions_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "subscriptions_billing_state_check" CHECK ("billing_state" IN ('TRIAL', 'ACTIVE', 'SUSPENDED', 'CANCELED'))
);

-- ============================================================================
-- CreateTable: impersonation_sessions（🔴 C0 SYSTEM_ONLY。app_tenant に一切の権限を与えない）
-- ============================================================================
CREATE TABLE "impersonation_sessions" (
    "id" UUID NOT NULL,
    "platform_user_id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL, -- 🔴 C0（対象テナントの参照。Tenant への FK は張らない。§3.1 共通規約）
    "reason" TEXT NOT NULL,
    "started_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "ended_at" TIMESTAMPTZ(3),
    -- docs/05 §3.10 ImpersonationEndKind（nullable）。TEXT + CHECK。
    "end_kind" TEXT,
    "notified_user_ids" UUID[],
    "notification_failed" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "impersonation_sessions_pkey" PRIMARY KEY ("id"),
    -- 🔴 F-060 AC-1（空白・空文字を許容しない）。
    CONSTRAINT "impersonation_sessions_reason_check" CHECK (btrim("reason") <> ''),
    CONSTRAINT "impersonation_sessions_end_kind_check" CHECK ("end_kind" IN ('MANUAL', 'TIMEOUT', 'FORCED'))
);

-- ============================================================================
-- CreateTable: announcements（F-061。お知らせと機能フラグを 1 表で扱う）
-- ============================================================================
CREATE TABLE "announcements" (
    "id" UUID NOT NULL,
    -- docs/05 §3.10 AnnouncementKind。TEXT + CHECK。
    "kind" TEXT NOT NULL,
    "target_tenant_ids" UUID[], -- 🔴 テナントキーの 2 例外の 1 つ（docs/05 §3.1）。空 = 全テナント
    "feature_key" TEXT,
    "enabled" BOOLEAN,
    "title_key" TEXT,
    "body_key" TEXT,
    "reason_key" TEXT,
    "visible_from" TIMESTAMPTZ(3),
    "visible_to" TIMESTAMPTZ(3),
    "created_by" UUID NOT NULL,

    CONSTRAINT "announcements_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "announcements_kind_check" CHECK ("kind" IN ('NOTICE', 'FEATURE_FLAG')),
    -- 🔴 F-061 AC-4（統制を落とすフラグを作らせない）。
    CONSTRAINT "announcements_feature_key_check" CHECK (
        "feature_key" IS NULL OR "feature_key" NOT IN ('review_gate', 'tenant_isolation', 'audit_log', 'partner_scope')
    )
);

-- ============================================================================
-- CreateTable: tenant_role_approval_modes（docs/03 §4.20）
-- ============================================================================
CREATE TABLE "tenant_role_approval_modes" (
    "tenant_id" UUID NOT NULL,
    -- docs/05 §3.10 ApprovalModeConfigurableRole（5 値。gate-inspector を含まない）。TEXT + CHECK。
    "role" TEXT NOT NULL,
    -- docs/05 §3.10 TenantRoleApprovalModeValue。TEXT + CHECK。
    "mode" TEXT NOT NULL,
    "updated_by" UUID NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "tenant_role_approval_modes_pkey" PRIMARY KEY ("tenant_id","role"),
    CONSTRAINT "tenant_role_approval_modes_role_check" CHECK ("role" IN ('sheet-parser', 'skill-normalizer', 'match-explainer', 'proposal-drafter', 'renewal-advisor')),
    -- 🔴 CLAUDE.md §12.4「gate-inspector に承認モードは存在しない」。上の IN リストで既に排他だが
    --    意図を DDL に明示的に残す（docs/03 §4.20.1-③）。
    CONSTRAINT "tenant_role_approval_modes_not_gate_inspector_check" CHECK ("role" <> 'gate-inspector'),
    CONSTRAINT "tenant_role_approval_modes_mode_check" CHECK ("mode" IN ('PER_ITEM', 'AUTO'))
);

-- ============================================================================
-- CreateTable: tenant_role_models（docs/03 §4.20）
-- ============================================================================
CREATE TABLE "tenant_role_models" (
    "tenant_id" UUID NOT NULL,
    -- docs/05 §3.10 AiRole（6 ロールすべて設定可。gate-inspector を含む）。TEXT + CHECK。
    "role" TEXT NOT NULL,
    "model_id" TEXT NOT NULL,
    "updated_by" UUID NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "tenant_role_models_pkey" PRIMARY KEY ("tenant_id","role"),
    CONSTRAINT "tenant_role_models_role_check" CHECK ("role" IN ('sheet-parser', 'skill-normalizer', 'match-explainer', 'gate-inspector', 'proposal-drafter', 'renewal-advisor'))
);

-- ============================================================================
-- CreateTable: tenant_match_weights（[Issue #3] 事業判断で重みを外出しし、ハードコードしない）
-- ============================================================================
CREATE TABLE "tenant_match_weights" (
    "tenant_id" UUID NOT NULL,
    -- docs/05 §3.10 MatchWeightFactor。TEXT + CHECK。
    "factor" TEXT NOT NULL,
    "weight" INTEGER NOT NULL,
    "updated_by" UUID NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "tenant_match_weights_pkey" PRIMARY KEY ("tenant_id","factor"),
    CONSTRAINT "tenant_match_weights_factor_check" CHECK ("factor" IN ('MUST', 'START_DATE', 'NICE', 'LOCATION', 'PRICE', 'YEARS'))
);

-- ============================================================================
-- CreateTable: tenant_monthly_costs（A-011。日次更新、月末で固定。docs/03 §4.15）
-- ============================================================================
CREATE TABLE "tenant_monthly_costs" (
    "tenant_id" UUID NOT NULL,
    "period_month" TEXT NOT NULL,
    "revenue_seat_jpy" DECIMAL(14,2) NOT NULL,
    "revenue_overage_jpy" DECIMAL(14,2) NOT NULL,
    "cost_ai_usd" DECIMAL(14,6) NOT NULL,
    "cost_ai_by_role" JSONB NOT NULL,
    "cost_email_usd" DECIMAL(14,6) NOT NULL,
    "cost_storage_usd" DECIMAL(14,6) NOT NULL,
    "cost_esign_usd" DECIMAL(14,6) NOT NULL DEFAULT 0,
    "pricing_ruleset_version" TEXT NOT NULL,
    "storage_bytes_at_month_end" BIGINT,
    "gross_margin_rate" DECIMAL(6,4),
    "baseline_ratio" DECIMAL(8,4),
    "quota_consumption_rate" DECIMAL(6,4),
    "meter_diff_jpy" DECIMAL(14,2),
    "finalized_at" TIMESTAMPTZ(3),
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "tenant_monthly_costs_pkey" PRIMARY KEY ("tenant_id","period_month")
);

-- ============================================================================
-- CreateTable: billing_meter_submissions（docs/03 §3.8.3）
-- ============================================================================
CREATE TABLE "billing_meter_submissions" (
    "tenant_id" UUID NOT NULL,
    "event_name" TEXT NOT NULL,
    "period_end" TIMESTAMPTZ(3) NOT NULL,
    "value" DECIMAL(14,6) NOT NULL,
    "submitted_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "stripe_identifier" TEXT NOT NULL,

    -- 🔴 UNIQUE（Stripe の重複排除は 24h しか効かない）。
    CONSTRAINT "billing_meter_submissions_pkey" PRIMARY KEY ("tenant_id","event_name","period_end")
);

-- ============================================================================
-- CreateIndex
-- ============================================================================
CREATE INDEX "tasks_tenant_id_assignee_user_id_state_due_on_idx" ON "tasks"("tenant_id", "assignee_user_id", "state", "due_on");
CREATE UNIQUE INDEX "tasks_tenant_id_kind_target_type_target_id_key" ON "tasks"("tenant_id", "kind", "target_type", "target_id");

CREATE INDEX "notifications_tenant_id_recipient_user_id_read_at_created_a_idx" ON "notifications"("tenant_id", "recipient_user_id", "read_at", "created_at");

CREATE INDEX "ai_usage_tenant_id_started_at_idx" ON "ai_usage"("tenant_id", "started_at");
CREATE INDEX "ai_usage_tenant_id_role_started_at_idx" ON "ai_usage"("tenant_id", "role", "started_at"); -- 🔴 ロール別原価の分解（§10.2 / A-011）

-- 🔴 audit_logs は PARTITION BY RANGE (created_at) のため、非 UNIQUE インデックスに
--    created_at を含める必要は無い（Postgres がパーティションへ自動伝播する）。
CREATE INDEX "audit_logs_tenant_id_created_at_action_idx" ON "audit_logs"("tenant_id", "created_at", "action");
CREATE INDEX "audit_logs_actor_kind_actor_id_created_at_idx" ON "audit_logs"("actor_kind", "actor_id", "created_at");

CREATE INDEX "usage_counters_tenant_id_metric_period_key_idx" ON "usage_counters"("tenant_id", "metric", "period_key");
CREATE UNIQUE INDEX "usage_counters_tenant_id_period_kind_period_key_metric_key" ON "usage_counters"("tenant_id", "period_kind", "period_key", "metric"); -- 🔴 ON CONFLICT の対象

CREATE UNIQUE INDEX "tenant_esign_connections_tenant_id_key" ON "tenant_esign_connections"("tenant_id"); -- 🔴 1 テナント 1 接続

CREATE INDEX "send_attempts_tenant_id_status_started_at_idx" ON "send_attempts"("tenant_id", "status", "started_at");
CREATE UNIQUE INDEX "send_attempts_entity_type_entity_id_attempt_seq_key" ON "send_attempts"("entity_type", "entity_id", "attempt_seq"); -- 🔴 K-5 防御線 1/2
CREATE UNIQUE INDEX "send_attempts_idempotency_key_key" ON "send_attempts"("idempotency_key"); -- 🔴 K-5 防御線 2/2

CREATE INDEX "email_dispatches_tenant_id_status_sent_at_idx" ON "email_dispatches"("tenant_id", "status", "sent_at");
CREATE INDEX "email_dispatches_status_held_at_idx" ON "email_dispatches"("status", "held_at"); -- send.hold-release の走査 + A-005 項目 13
CREATE UNIQUE INDEX "email_dispatches_dedupe_key_key" ON "email_dispatches"("dedupe_key"); -- 🔴 再試行しても 1 通

CREATE UNIQUE INDEX "email_events_ses_message_id_event_type_occurred_at_key" ON "email_events"("ses_message_id", "event_type", "occurred_at");

CREATE INDEX "webhook_deliveries_provider_processed_at_received_at_idx" ON "webhook_deliveries"("provider", "processed_at", "received_at");
CREATE UNIQUE INDEX "webhook_deliveries_dedupe_key_key" ON "webhook_deliveries"("dedupe_key");

CREATE INDEX "data_export_requests_tenant_id_status_requested_at_idx" ON "data_export_requests"("tenant_id", "status", "requested_at");

CREATE INDEX "tenant_purge_runs_tenant_id_cause_started_at_idx" ON "tenant_purge_runs"("tenant_id", "cause", "started_at");

CREATE INDEX "scheduler_runs_job_name_started_at_idx" ON "scheduler_runs"("job_name", "started_at");
CREATE UNIQUE INDEX "scheduler_runs_run_key_key" ON "scheduler_runs"("run_key"); -- 🔴 同じ slot に 2 回起票されても 1 回だけ走る

CREATE UNIQUE INDEX "platform_users_email_key" ON "platform_users"("email");

CREATE UNIQUE INDEX "plans_code_key" ON "plans"("code");

CREATE UNIQUE INDEX "subscriptions_tenant_id_key" ON "subscriptions"("tenant_id");

CREATE INDEX "impersonation_sessions_tenant_id_started_at_idx" ON "impersonation_sessions"("tenant_id", "started_at");
CREATE INDEX "impersonation_sessions_platform_user_id_started_at_idx" ON "impersonation_sessions"("platform_user_id", "started_at");

CREATE INDEX "announcements_kind_feature_key_idx" ON "announcements"("kind", "feature_key");

CREATE INDEX "tenant_monthly_costs_period_month_gross_margin_rate_idx" ON "tenant_monthly_costs"("period_month", "gross_margin_rate");

-- ============================================================================
-- AddForeignKey: 前方参照の解決（T-02-02〜04 で列のみだった 5 列。ai_usage 表が実在するようになった）
-- ============================================================================
ALTER TABLE "skill_sheet_extractions" ADD CONSTRAINT "skill_sheet_extractions_ai_usage_id_fkey" FOREIGN KEY ("ai_usage_id") REFERENCES "ai_usage"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "match_candidates" ADD CONSTRAINT "match_candidates_rationale_ai_usage_id_fkey" FOREIGN KEY ("rationale_ai_usage_id") REFERENCES "ai_usage"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "proposals" ADD CONSTRAINT "proposals_draft_ai_usage_id_fkey" FOREIGN KEY ("draft_ai_usage_id") REFERENCES "ai_usage"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "review_gates" ADD CONSTRAINT "review_gates_ai_usage_id_fkey" FOREIGN KEY ("ai_usage_id") REFERENCES "ai_usage"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "extension_reviews" ADD CONSTRAINT "extension_reviews_ai_usage_id_fkey" FOREIGN KEY ("ai_usage_id") REFERENCES "ai_usage"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ============================================================================
-- AddForeignKey: 新規表
-- ============================================================================
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "notifications" ADD CONSTRAINT "notifications_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_email_dispatch_id_fkey" FOREIGN KEY ("email_dispatch_id") REFERENCES "email_dispatches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "ai_usage" ADD CONSTRAINT "ai_usage_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_impersonation_session_id_fkey" FOREIGN KEY ("impersonation_session_id") REFERENCES "impersonation_sessions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "usage_counters" ADD CONSTRAINT "usage_counters_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "tenant_esign_connections" ADD CONSTRAINT "tenant_esign_connections_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "send_attempts" ADD CONSTRAINT "send_attempts_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "email_dispatches" ADD CONSTRAINT "email_dispatches_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "data_export_requests" ADD CONSTRAINT "data_export_requests_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "tenant_purge_runs" ADD CONSTRAINT "tenant_purge_runs_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_plan_id_fkey" FOREIGN KEY ("plan_id") REFERENCES "plans"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "impersonation_sessions" ADD CONSTRAINT "impersonation_sessions_platform_user_id_fkey" FOREIGN KEY ("platform_user_id") REFERENCES "platform_users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "tenant_role_approval_modes" ADD CONSTRAINT "tenant_role_approval_modes_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "tenant_role_models" ADD CONSTRAINT "tenant_role_models_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "tenant_match_weights" ADD CONSTRAINT "tenant_match_weights_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "tenant_monthly_costs" ADD CONSTRAINT "tenant_monthly_costs_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "billing_meter_submissions" ADD CONSTRAINT "billing_meter_submissions_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ============================================================================
-- 🔴 F-005 AC-3: audit_logs は利用者・運営者のいずれからも編集・削除できない（DB 権限で担保）。
--    現時点でこれら 3 ロールに GRANT は無い（T-02-06 で INSERT/SELECT のみを付与する）ため
--    このタイミングでは実質的に no-op だが、意図を DDL として残す（docs/05 §3.8 の必須コメント）。
-- ============================================================================
REVOKE UPDATE, DELETE ON "audit_logs" FROM app_tenant, app_platform, app_platform_write;

-- ============================================================================
-- RenameIndex（T-02-03 の 63 文字切り詰めによる index 名 drift の解消。申し送り対応）
-- ============================================================================
ALTER INDEX "proposal_requests_tenant_id_partner_company_id_state_expir_idx" RENAME TO "proposal_requests_tenant_id_partner_company_id_state_expire_idx";
