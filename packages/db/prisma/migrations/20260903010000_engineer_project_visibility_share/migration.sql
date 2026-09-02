-- T-02-02（docs/sprints/SP-02-schema-isolation.md）: docs/05 §3.4「① 集める」
-- （engineers の拡張 + skills / skill_aliases / engineer_skills / skill_sheets /
-- file_scan_results / skill_sheet_extractions）と §3.5「案件・公開範囲・マッチング・匿名共有」
-- （projects / project_requirements / project_visibilities / engineer_shares / match_candidates）。
--
-- 🔴 このファイルは `prisma migrate diff --from-migrations prisma/migrations
--    --to-schema-datamodel schema.prisma --script` が出力した素の SQL を手で編集したものである
--    （schema.prisma 冒頭コメント参照）。docs/05 §3.1「列挙」規約に従い、列挙相当の列はすべて
--    `CREATE TYPE ... AS ENUM` を発行せず TEXT + CHECK に落としてある。
--    TS 側の単一出所は packages/db/src/schema-value-sets.ts であり、CHECK の値集合との一致は
--    tests/static/schema-enum-drift.test.ts が突合する。
--
-- 🔴 RLS: 新規 10 表（skills を除く）は ENABLE + FORCE ROW LEVEL SECURITY のみを
--    packages/db/prisma/sql/010_rls.sql に追加する（T-02-01 と同じ fail-closed 既定。
--    ポリシー本体・GRANT は T-02-06）。`skills` はグローバルマスタ（CLAUDE.md §3.1 射程外の
--    4 表の 1 つ）であり RLS を一切適用しない（docs/05 §4.4「射程外の 4 表」/ §4.7
--    BUSINESS_TABLE_EXCLUSIONS）。
--
-- 適用方法: `app_migrator`（`MIGRATION_DATABASE_URL` 相当）で `prisma migrate deploy` を実行する
-- （docs/05 §4.2）。20260903000000_tenant_users_boundary が先に適用済みであること。

-- ============================================================================
-- AlterTable: engineers（docs/05 §3.4。既存 T-01-04/T-02-01 表を拡張）
-- ============================================================================
DROP INDEX "engineers_tenant_id_owner_partner_company_id_idx";

ALTER TABLE "engineers"
  ADD COLUMN "birth_date" DATE,
  ADD COLUMN "contact_email" TEXT,
  ADD COLUMN "contact_phone" TEXT,
  ADD COLUMN "affiliation_label" TEXT,
  ADD COLUMN "availability" TEXT NOT NULL DEFAULT 'WORKING',
  ADD COLUMN "available_from" DATE,
  ADD COLUMN "unit_price_min" DECIMAL(12,2),
  ADD COLUMN "unit_price_max" DECIMAL(12,2),
  ADD COLUMN "prefecture" TEXT,
  ADD COLUMN "city" TEXT,
  ADD COLUMN "remote_mode" TEXT,
  ADD COLUMN "preference_note" TEXT,
  ADD COLUMN "retention_expires_at" TIMESTAMPTZ(3),
  ADD COLUMN "pii_purged_at" TIMESTAMPTZ(3);

-- docs/05 §3.4 EngineerAvailability / RemoteMode（TEXT + CHECK。単一の出所は
-- packages/db/src/schema-value-sets.ts の ENGINEER_AVAILABILITIES / REMOTE_MODES）。
ALTER TABLE "engineers" ADD CONSTRAINT "engineers_availability_check"
  CHECK ("availability" IN ('WORKING', 'STANDBY_SCHEDULED', 'STANDBY', 'INACTIVE'));
-- 🔴 remote_mode は nullable。PostgreSQL の CHECK は NULL を満たすとみなすため、
--    「IS NULL OR」を書かなくても未設定の行は素通りする（値がある場合のみ許容値集合を強制する）。
ALTER TABLE "engineers" ADD CONSTRAINT "engineers_remote_mode_check"
  CHECK ("remote_mode" IN ('FULL_REMOTE', 'PARTIAL_REMOTE', 'ONSITE_ONLY'));

CREATE INDEX "engineers_tenant_id_owner_partner_company_id_availability_a_idx"
  ON "engineers"("tenant_id", "owner_partner_company_id", "availability", "available_from");
CREATE INDEX "engineers_tenant_id_retention_expires_at_pii_purged_at_idx"
  ON "engineers"("tenant_id", "retention_expires_at", "pii_purged_at"); -- 保持期間ジョブ（§9.7）
CREATE INDEX "engineers_tenant_id_updated_at_idx"
  ON "engineers"("tenant_id", "updated_at"); -- Phase 1 の決定的順序（§4.6）

-- 🔴 docs/05 §3.4: engineers.owner_partner_company_id は partner_companies への FK を持つ
--    （users / memberships と同じ「自分の所属としてしか書けない」規律。T-02-01 からの申し送り）。
ALTER TABLE "engineers" ADD CONSTRAINT "engineers_owner_partner_company_id_fkey"
  FOREIGN KEY ("owner_partner_company_id") REFERENCES "partner_companies"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

-- ============================================================================
-- CreateTable: skills（🔴 グローバル。CLAUDE.md §3.1 射程外の 4 表の 1 つ。tenant_id を持たない）
-- ============================================================================
CREATE TABLE "skills" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "sort_key" INTEGER NOT NULL,

    CONSTRAINT "skills_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "skills_name_key" ON "skills"("name");

-- ============================================================================
-- CreateTable: skill_aliases
-- ============================================================================
CREATE TABLE "skill_aliases" (
    "id" UUID NOT NULL,
    "tenant_id" UUID, -- 🔴 null = グローバル別名（docs/05 §3.4）
    "alias" TEXT NOT NULL,
    "skill_id" UUID,
    "status" TEXT NOT NULL,
    "origin" TEXT NOT NULL,
    "proposed_by" UUID,
    "decided_by" UUID,
    "decided_at" TIMESTAMPTZ(3),

    CONSTRAINT "skill_aliases_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "skill_aliases_status_check" CHECK ("status" IN ('PROPOSED', 'ACCEPTED', 'REJECTED')),
    CONSTRAINT "skill_aliases_origin_check" CHECK ("origin" IN ('HUMAN', 'AI'))
);
CREATE UNIQUE INDEX "skill_aliases_tenant_id_alias_key" ON "skill_aliases"("tenant_id", "alias");
CREATE INDEX "skill_aliases_tenant_id_status_idx" ON "skill_aliases"("tenant_id", "status");

-- ============================================================================
-- CreateTable: engineer_skills
-- ============================================================================
CREATE TABLE "engineer_skills" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "owner_partner_company_id" UUID, -- engineers から継承（§4.4.1）。継承トリガは T-02-08
    "engineer_id" UUID NOT NULL,
    "skill_id" UUID NOT NULL,
    "years_of_experience" DECIMAL(4,1) NOT NULL,
    "level" INTEGER,
    "source" TEXT NOT NULL,
    "original_label" TEXT,
    "normalized_at" TIMESTAMPTZ(3),
    "normalized_role" TEXT,
    "normalized_prompt_version" TEXT,
    "normalized_model_id" TEXT,

    CONSTRAINT "engineer_skills_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "engineer_skills_source_check" CHECK ("source" IN ('MANUAL', 'EXTRACTED'))
);
CREATE UNIQUE INDEX "engineer_skills_tenant_id_engineer_id_skill_id_key" ON "engineer_skills"("tenant_id", "engineer_id", "skill_id");
CREATE INDEX "engineer_skills_tenant_id_skill_id_years_of_experience_idx" ON "engineer_skills"("tenant_id", "skill_id", "years_of_experience"); -- 複合検索（F-009）

-- ============================================================================
-- CreateTable: skill_sheets
-- ============================================================================
CREATE TABLE "skill_sheets" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "owner_partner_company_id" UUID, -- engineers から継承（§4.4.1）。継承トリガは T-02-08
    "engineer_id" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "object_key" TEXT NOT NULL,
    "content_type" TEXT NOT NULL,
    "byte_size" BIGINT NOT NULL,
    "scan_status" TEXT NOT NULL DEFAULT 'SCANNING',
    "scan_updated_at" TIMESTAMPTZ(3),
    "is_latest" BOOLEAN NOT NULL DEFAULT false,
    "uploaded_by" UUID NOT NULL,
    "uploaded_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "purged_at" TIMESTAMPTZ(3),

    CONSTRAINT "skill_sheets_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "skill_sheets_scan_status_check"
      CHECK ("scan_status" IN ('SCANNING', 'CLEAN', 'INFECTED', 'UNSCANNABLE', 'FAILED')),
    -- 🔴 F-011 AC-1: CLEAN 以外は最新版になれない。
    CONSTRAINT "skill_sheets_latest_clean_check" CHECK ("is_latest" = false OR "scan_status" = 'CLEAN')
);
CREATE UNIQUE INDEX "skill_sheets_tenant_id_engineer_id_version_key" ON "skill_sheets"("tenant_id", "engineer_id", "version");
CREATE INDEX "skill_sheets_tenant_id_scan_status_uploaded_at_idx" ON "skill_sheets"("tenant_id", "scan_status", "uploaded_at"); -- SCANNING 滞留の検知（A-005）
-- 🔴 部分 UNIQUE: 1 エンジニアにつき is_latest = true は高々 1 件（docs/05 §3.4）。
CREATE UNIQUE INDEX "skill_sheets_one_latest_per_engineer_key" ON "skill_sheets"("tenant_id", "engineer_id") WHERE "is_latest";

-- ============================================================================
-- CreateTable: file_scan_results
-- ============================================================================
CREATE TABLE "file_scan_results" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "object_key" TEXT NOT NULL,
    "object_version_id" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "raw_status" TEXT NOT NULL, -- GuardDuty の生値（正規化前）
    "received_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "file_scan_results_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "file_scan_results_status_check"
      CHECK ("status" IN ('SCANNING', 'CLEAN', 'INFECTED', 'UNSCANNABLE', 'FAILED'))
);
-- 🔴 at-least-once の重複結果を弾く（docs/03 §3.4.3-2）。
CREATE UNIQUE INDEX "file_scan_results_object_key_object_version_id_key" ON "file_scan_results"("object_key", "object_version_id");

-- ============================================================================
-- CreateTable: skill_sheet_extractions
-- ============================================================================
CREATE TABLE "skill_sheet_extractions" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "owner_partner_company_id" UUID, -- skill_sheets から継承（§4.4.1）。継承トリガは T-02-08
    "skill_sheet_id" UUID NOT NULL,
    "payload" JSONB NOT NULL,
    "role" TEXT NOT NULL,
    "prompt_version" TEXT NOT NULL,
    "model_id" TEXT NOT NULL,
    "ai_usage_id" UUID NOT NULL, -- FK は ai_usage 表が生まれる T-02-05 で追加する
    "status" TEXT NOT NULL,
    "decided_by" UUID,
    "decided_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "skill_sheet_extractions_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "skill_sheet_extractions_status_check"
      CHECK ("status" IN ('PENDING_REVIEW', 'APPLIED', 'REJECTED', 'FAILED'))
);
CREATE INDEX "skill_sheet_extractions_tenant_id_skill_sheet_id_created_at_idx" ON "skill_sheet_extractions"("tenant_id", "skill_sheet_id", "created_at");

-- ============================================================================
-- CreateTable: projects
-- ============================================================================
CREATE TABLE "projects" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "end_client_name" TEXT, -- 🔴 内部限定。公開表示・LLM・運営者に出さない
    "internal_unit_price" DECIMAL(12,2), -- 🔴 内部限定（同上）
    "public_summary" TEXT,
    "unit_price_min" DECIMAL(12,2),
    "unit_price_max" DECIMAL(12,2),
    "start_date" DATE,
    "prefecture" TEXT,
    "remote_mode" TEXT,
    "headcount" INTEGER NOT NULL DEFAULT 1,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "origin_assignment_id" UUID, -- F-045 の後任募集の生成元。FK は assignments 表が生まれる T-02-04 で追加する
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "projects_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "projects_status_check" CHECK ("status" IN ('OPEN', 'FILLED', 'SUCCESSOR_WANTED')),
    CONSTRAINT "projects_remote_mode_check" CHECK ("remote_mode" IN ('FULL_REMOTE', 'PARTIAL_REMOTE', 'ONSITE_ONLY'))
);
CREATE INDEX "projects_tenant_id_status_updated_at_idx" ON "projects"("tenant_id", "status", "updated_at");
CREATE INDEX "projects_tenant_id_start_date_idx" ON "projects"("tenant_id", "start_date");

-- ============================================================================
-- CreateTable: project_requirements
-- ============================================================================
CREATE TABLE "project_requirements" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "kind" TEXT NOT NULL, -- 🔴 MUST は F-029 の足切り、F-020 整合層の照合対象
    "skill_id" UUID,
    "free_text" TEXT,
    "required_years" DECIMAL(4,1),

    CONSTRAINT "project_requirements_pkey" PRIMARY KEY ("id"),
    -- 🔴 F-013 AC-1: 必須 / 尚可を別区分として保持する（完了判定の核）。
    CONSTRAINT "project_requirements_kind_check" CHECK ("kind" IN ('MUST', 'NICE'))
);
CREATE INDEX "project_requirements_tenant_id_project_id_kind_idx" ON "project_requirements"("tenant_id", "project_id", "kind");

-- ============================================================================
-- CreateTable: project_visibilities（🔴 越境経路 1 の唯一の根拠）
-- ============================================================================
CREATE TABLE "project_visibilities" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "partner_company_id" UUID NOT NULL,
    "published_at" TIMESTAMPTZ(3) NOT NULL,
    "published_by" UUID NOT NULL,
    "revoked_at" TIMESTAMPTZ(3),
    "review_gate_id" UUID NOT NULL, -- 公開時のゲート結果。FK は review_gates 表が生まれる T-02-03 で追加する

    CONSTRAINT "project_visibilities_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "project_visibilities_tenant_id_project_id_partner_company_i_key" ON "project_visibilities"("tenant_id", "project_id", "partner_company_id");
CREATE INDEX "project_visibilities_tenant_id_partner_company_id_revoked_a_idx" ON "project_visibilities"("tenant_id", "partner_company_id", "revoked_at"); -- RLS ポリシーの EXISTS が使う（T-02-06）

-- ============================================================================
-- CreateTable: engineer_shares（🔴 越境経路 4 の唯一の根拠。既定オフ = 行の非存在）
-- ============================================================================
CREATE TABLE "engineer_shares" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "engineer_id" UUID NOT NULL,
    "partner_company_id" UUID NOT NULL, -- 共有元（= engineers.owner_partner_company_id）
    "shared_at" TIMESTAMPTZ(3) NOT NULL,
    "revoked_at" TIMESTAMPTZ(3), -- 🔴 解除で即時に候補から消える（F-016 AC-2）
    "shared_by" UUID NOT NULL,

    CONSTRAINT "engineer_shares_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "engineer_shares_tenant_id_engineer_id_key" ON "engineer_shares"("tenant_id", "engineer_id");
CREATE INDEX "engineer_shares_tenant_id_revoked_at_idx" ON "engineer_shares"("tenant_id", "revoked_at");

-- ============================================================================
-- CreateTable: match_candidates
-- ============================================================================
CREATE TABLE "match_candidates" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "engineer_id" UUID NOT NULL, -- 🔴 API 応答には載せない（§4.6）
    "is_anonymous" BOOLEAN NOT NULL,
    "score" INTEGER,
    "breakdown" JSONB,
    "cutoff_reason" TEXT,
    "weights_snapshot" JSONB,
    "rationale" TEXT,
    "rationale_role" TEXT,
    "rationale_prompt_version" TEXT,
    "rationale_model_id" TEXT,
    "rationale_ai_usage_id" UUID, -- FK は ai_usage 表が生まれる T-02-05 で追加する
    "computed_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "match_candidates_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "match_candidates_tenant_id_project_id_engineer_id_key" ON "match_candidates"("tenant_id", "project_id", "engineer_id");
CREATE INDEX "match_candidates_tenant_id_project_id_score_idx" ON "match_candidates"("tenant_id", "project_id", "score");

-- ============================================================================
-- AddForeignKey
-- ============================================================================
ALTER TABLE "skill_aliases" ADD CONSTRAINT "skill_aliases_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "skill_aliases" ADD CONSTRAINT "skill_aliases_skill_id_fkey" FOREIGN KEY ("skill_id") REFERENCES "skills"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "engineer_skills" ADD CONSTRAINT "engineer_skills_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "engineer_skills" ADD CONSTRAINT "engineer_skills_engineer_id_fkey" FOREIGN KEY ("engineer_id") REFERENCES "engineers"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "engineer_skills" ADD CONSTRAINT "engineer_skills_skill_id_fkey" FOREIGN KEY ("skill_id") REFERENCES "skills"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "skill_sheets" ADD CONSTRAINT "skill_sheets_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "skill_sheets" ADD CONSTRAINT "skill_sheets_engineer_id_fkey" FOREIGN KEY ("engineer_id") REFERENCES "engineers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "file_scan_results" ADD CONSTRAINT "file_scan_results_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "skill_sheet_extractions" ADD CONSTRAINT "skill_sheet_extractions_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "skill_sheet_extractions" ADD CONSTRAINT "skill_sheet_extractions_skill_sheet_id_fkey" FOREIGN KEY ("skill_sheet_id") REFERENCES "skill_sheets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "projects" ADD CONSTRAINT "projects_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "project_requirements" ADD CONSTRAINT "project_requirements_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "project_requirements" ADD CONSTRAINT "project_requirements_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "project_requirements" ADD CONSTRAINT "project_requirements_skill_id_fkey" FOREIGN KEY ("skill_id") REFERENCES "skills"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "project_visibilities" ADD CONSTRAINT "project_visibilities_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "project_visibilities" ADD CONSTRAINT "project_visibilities_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "project_visibilities" ADD CONSTRAINT "project_visibilities_partner_company_id_fkey" FOREIGN KEY ("partner_company_id") REFERENCES "partner_companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "engineer_shares" ADD CONSTRAINT "engineer_shares_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "engineer_shares" ADD CONSTRAINT "engineer_shares_engineer_id_fkey" FOREIGN KEY ("engineer_id") REFERENCES "engineers"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "engineer_shares" ADD CONSTRAINT "engineer_shares_partner_company_id_fkey" FOREIGN KEY ("partner_company_id") REFERENCES "partner_companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "match_candidates" ADD CONSTRAINT "match_candidates_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "match_candidates" ADD CONSTRAINT "match_candidates_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "match_candidates" ADD CONSTRAINT "match_candidates_engineer_id_fkey" FOREIGN KEY ("engineer_id") REFERENCES "engineers"("id") ON DELETE CASCADE ON UPDATE CASCADE;
