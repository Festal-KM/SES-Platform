-- T-02-03（docs/sprints/SP-02-schema-isolation.md）: docs/05 §3.6「提案・提案依頼・品質ゲート」
-- （proposal_requests / proposals / engineer_snapshots / proposal_events / review_gates）。
-- あわせて T-02-02 が列だけ足していた project_visibilities.review_gate_id の FK を解決する
-- （前方参照の解決。docs/05 §3.5 冒頭の「review_gate_id UUID NOT NULL, -- FK は review_gates
-- 表が生まれる T-02-03 で追加する」コメント参照）。
--
-- 🔴 このファイルは `prisma migrate diff --from-migrations prisma/migrations
--    --to-schema-datamodel schema.prisma --script` が出力した素の SQL を手で編集したものである
--    （schema.prisma 冒頭コメント参照）。docs/05 §3.1「列挙」規約に従い、列挙相当の列はすべて
--    `CREATE TYPE ... AS ENUM` を発行せず TEXT + CHECK に落としてある。
--    TS 側の単一出所は state / requestState が @ses/domain（PROPOSAL_STATES /
--    PROPOSAL_REQUEST_STATES。T-01-07 から既存）、それ以外（execution / verdict / targetType /
--    event kind）が packages/db/src/schema-value-sets.ts。CHECK の値集合との一致は
--    tests/static/schema-enum-drift.test.ts が突合する。
--
-- 🔴 RLS: 新規 5 表は ENABLE + FORCE ROW LEVEL SECURITY のみを
--    packages/db/prisma/sql/010_rls.sql に追加する（T-02-01 / T-02-02 と同じ fail-closed 既定。
--    ポリシー本体・GRANT は T-02-06 / T-02-07）。
--
-- 適用方法: `app_migrator`（`MIGRATION_DATABASE_URL` 相当）で `prisma migrate deploy` を実行する
-- （docs/05 §4.2）。20260903010000_engineer_project_visibility_share が先に適用済みであること。

-- ============================================================================
-- CreateTable: proposal_requests（🔴 越境経路 4 の唯一の実体。RLS ポリシークラスは C5 PARTY）
-- ============================================================================
CREATE TABLE "proposal_requests" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "engineer_id" UUID NOT NULL, -- 🔴 ホスト向け応答に載せない（アプリ層。docs/05 §4.6）
    "partner_company_id" UUID NOT NULL, -- 依頼先
    "state" TEXT NOT NULL DEFAULT 'REQUESTED',
    "message" TEXT NOT NULL, -- 🔴 商流情報を含めない（API で検証。DB は入力値を保持するのみ）
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "decline_reason" TEXT, -- 🔴 パートナー社内限定。ホストに返さない（BR-57）
    "issued_by" UUID NOT NULL,
    "responded_by" UUID,
    "responded_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "proposal_requests_pkey" PRIMARY KEY ("id"),
    -- docs/05 §3.6 ProposalRequestState。単一の出所は @ses/domain の PROPOSAL_REQUEST_STATES。
    CONSTRAINT "proposal_requests_state_check" CHECK ("state" IN (
      'REQUESTED', 'ACCEPTED', 'DECLINED', 'WITHDRAWN_BY_HOST', 'EXPIRED'
    ))
);
CREATE UNIQUE INDEX "proposal_requests_tenant_id_project_id_engineer_id_key" ON "proposal_requests"("tenant_id", "project_id", "engineer_id"); -- 同一案件 × 同一候補への重複依頼を防ぐ
CREATE INDEX "proposal_requests_tenant_id_partner_company_id_state_expir_idx" ON "proposal_requests"("tenant_id", "partner_company_id", "state", "expires_at");
CREATE INDEX "proposal_requests_tenant_id_state_expires_at_idx" ON "proposal_requests"("tenant_id", "state", "expires_at"); -- 期限切れジョブ（§9.5）

-- ============================================================================
-- CreateTable: proposals（RLS ポリシークラスは C5 PARTY）
-- ============================================================================
CREATE TABLE "proposals" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "owner_partner_company_id" UUID, -- 作成した会社（null = ホスト）。owner-column: root（COMMENT/トリガは T-02-08）
    "project_id" UUID NOT NULL,
    "engineer_id" UUID NOT NULL,
    "proposal_request_id" UUID, -- 経路 4 由来
    "state" TEXT NOT NULL DEFAULT 'DRAFT',
    "recipient_company_name" TEXT NOT NULL, -- 提案先（テナント外の企業）
    "recipient_email" TEXT NOT NULL,
    "offered_unit_price" DECIMAL(12,2),
    "offered_start_date" DATE,
    "work_style" TEXT,
    "subject" TEXT,
    "body" TEXT, -- 送信本文（外部共有物）
    "draft_body" TEXT, -- proposal-drafter の出力
    "draft_role" TEXT,
    "draft_prompt_version" TEXT,
    "draft_model_id" TEXT,
    "draft_ai_usage_id" UUID, -- FK は ai_usage 表が生まれる T-02-05 で追加する
    "content_hash" TEXT, -- 🔴 §11.5。ゲート対象の内容のハッシュ
    "approved_by" UUID, -- null かつ approved_by_system=true なら system
    "approved_by_system" BOOLEAN NOT NULL DEFAULT false,
    "approved_at" TIMESTAMPTZ(3),
    "submitted_at" TIMESTAMPTZ(3),
    "last_failure_reason" TEXT,
    "send_hold_reason_key" TEXT, -- 🔴 §10.4。保留は状態でなく属性
    "send_hold_since" TIMESTAMPTZ(3),
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "proposals_pkey" PRIMARY KEY ("id"),
    -- docs/05 §3.6 ProposalState（14 状態がすべて。CLAUDE.md §4.2 の Proposal ステートマシン）。
    -- 単一の出所は @ses/domain の PROPOSAL_STATES。
    CONSTRAINT "proposals_state_check" CHECK ("state" IN (
      'DRAFT', 'GATE_RUNNING', 'GATE_FAILED', 'APPROVAL_PENDING', 'APPROVED',
      'SUBMITTING', 'SUBMITTED', 'SUBMIT_FAILED',
      'INTERVIEW_SCHEDULED', 'INTERVIEWED', 'RESULT_PENDING', 'WON', 'LOST', 'WITHDRAWN'
    )),
    -- 🔴 docs/05 §10.3 / §11.5: 承認記録が無い行が APPROVED / SUBMITTING に入っていることが
    --    DB レベルで起こり得ない。
    CONSTRAINT "proposals_approved_requires_hash_check" CHECK (
      "state" <> 'APPROVED' OR ("approved_at" IS NOT NULL AND "content_hash" IS NOT NULL)
    ),
    CONSTRAINT "proposals_submitting_requires_approval_check" CHECK (
      "state" <> 'SUBMITTING' OR "approved_at" IS NOT NULL
    )
);
CREATE INDEX "proposals_tenant_id_state_updated_at_idx" ON "proposals"("tenant_id", "state", "updated_at"); -- 一覧・フィルタ（F-024）
CREATE INDEX "proposals_tenant_id_owner_partner_company_id_state_idx" ON "proposals"("tenant_id", "owner_partner_company_id", "state");
CREATE INDEX "proposals_tenant_id_project_id_state_idx" ON "proposals"("tenant_id", "project_id", "state");
CREATE INDEX "proposals_tenant_id_state_submitted_at_idx" ON "proposals"("tenant_id", "state", "submitted_at"); -- KPI（F-051）
-- 🔴 部分 UNIQUE（滞留の一意性。docs/05 §3.6）。id は PK のため実効的な一意化の効果は無いが、
--    SUBMITTING の行を数える部分インデックスとして A-005 が使う。
CREATE UNIQUE INDEX "proposals_one_submitting" ON "proposals"("id") WHERE "state" = 'SUBMITTING';

-- ============================================================================
-- CreateTable: engineer_snapshots（🔴 越境経路 2 でホストが読める唯一の実体。提案時点の凍結コピー）
-- ============================================================================
CREATE TABLE "engineer_snapshots" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "owner_partner_company_id" UUID, -- proposals から継承（§4.4.1）。継承トリガは T-02-08
    "proposal_id" UUID NOT NULL,
    "display_name" TEXT NOT NULL,
    "affiliation_label" TEXT,
    "skills" JSONB NOT NULL, -- [{ skillId, name, years, level }]
    "careers" JSONB NOT NULL,
    "unit_price_min" DECIMAL(12,2),
    "unit_price_max" DECIMAL(12,2),
    "available_from" DATE,
    "prefecture" TEXT,
    "remote_mode" TEXT,
    "skill_sheet_id" UUID, -- 参照した版（CLEAN のみ）
    "frozen_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "engineer_snapshots_pkey" PRIMARY KEY ("id"),
    -- docs/05 §3.4 RemoteMode（engineers / projects と同じ値集合を共有。単一の出所は REMOTE_MODES）。
    CONSTRAINT "engineer_snapshots_remote_mode_check" CHECK ("remote_mode" IN ('FULL_REMOTE', 'PARTIAL_REMOTE', 'ONSITE_ONLY'))
);
CREATE UNIQUE INDEX "engineer_snapshots_proposal_id_key" ON "engineer_snapshots"("proposal_id");

-- ============================================================================
-- CreateTable: proposal_events
-- ============================================================================
CREATE TABLE "proposal_events" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "owner_partner_company_id" UUID, -- proposals から継承（§4.4.1）。継承トリガは T-02-08
    "proposal_id" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "from_state" TEXT,
    "to_state" TEXT,
    "actor_user_id" UUID, -- null = system
    "note" TEXT,
    "attachment_key" TEXT,
    "occurred_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "proposal_events_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "proposal_events_kind_check" CHECK ("kind" IN ('STATE', 'NOTE', 'ATTACHMENT')),
    -- 🔴 from_state / to_state は ProposalState（nullable。PostgreSQL の CHECK は NULL を満たす
    --    とみなすため、未設定の行は素通りする）。単一の出所は @ses/domain の PROPOSAL_STATES。
    CONSTRAINT "proposal_events_from_state_check" CHECK ("from_state" IN (
      'DRAFT', 'GATE_RUNNING', 'GATE_FAILED', 'APPROVAL_PENDING', 'APPROVED',
      'SUBMITTING', 'SUBMITTED', 'SUBMIT_FAILED',
      'INTERVIEW_SCHEDULED', 'INTERVIEWED', 'RESULT_PENDING', 'WON', 'LOST', 'WITHDRAWN'
    )),
    CONSTRAINT "proposal_events_to_state_check" CHECK ("to_state" IN (
      'DRAFT', 'GATE_RUNNING', 'GATE_FAILED', 'APPROVAL_PENDING', 'APPROVED',
      'SUBMITTING', 'SUBMITTED', 'SUBMIT_FAILED',
      'INTERVIEW_SCHEDULED', 'INTERVIEWED', 'RESULT_PENDING', 'WON', 'LOST', 'WITHDRAWN'
    ))
);
CREATE INDEX "proposal_events_tenant_id_proposal_id_occurred_at_idx" ON "proposal_events"("tenant_id", "proposal_id", "occurred_at");

-- ============================================================================
-- CreateTable: review_gates
-- ============================================================================
CREATE TABLE "review_gates" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "owner_partner_company_id" UUID, -- 対象から継承（§4.4.1 の CASE）。継承トリガは T-02-08
    "target_type" TEXT NOT NULL,
    "target_id" UUID NOT NULL, -- 🔴 多相のため FK は張らない
    "content_hash" TEXT NOT NULL, -- 🔴 §11.5 / F-020 AC-3。検査した内容のハッシュ
    "execution" TEXT NOT NULL DEFAULT 'DONE', -- 🔴 実行の属性であり状態機械ではない（P-A-16）
    "held_since" TIMESTAMPTZ(3), -- HELD のとき NOT NULL
    "pii_verdict" TEXT, -- 🔴 HELD のときのみ NULL（未判定）
    "commerce_verdict" TEXT,
    "consistency_verdict" TEXT NOT NULL, -- 🔴 機械的照合のみで決まる。HELD でも保持する（F-027 AC-5）
    "findings" JSONB NOT NULL,
    "ai_warnings" JSONB NOT NULL, -- 🔴 合否に影響しない。別フィールド
    "role" TEXT, -- 'gate-inspector'。AI 失敗時は null
    "prompt_version" TEXT,
    "model_id" TEXT,
    "ai_usage_id" UUID, -- FK は ai_usage 表が生まれる T-02-05 で追加する
    "ai_failed" BOOLEAN NOT NULL DEFAULT false, -- true なら PII/商流は FAIL 扱い（LLM 失敗）
    "executed_at" TIMESTAMPTZ(3), -- DONE のとき NOT NULL

    CONSTRAINT "review_gates_pkey" PRIMARY KEY ("id"),
    -- docs/05 §3.6 ReviewGateTargetType（5 種。🔴 CONTRACT_DOCUMENT を含む。決定済み。Issue #15）。
    CONSTRAINT "review_gates_target_type_check" CHECK ("target_type" IN (
      'PROPOSAL', 'SKILL_SHEET_SHARE', 'PROJECT_PUBLISH', 'CHAT_ATTACHMENT', 'CONTRACT_DOCUMENT'
    )),
    CONSTRAINT "review_gates_execution_check" CHECK ("execution" IN ('DONE', 'HELD_AI_COST_LIMIT')),
    CONSTRAINT "review_gates_pii_verdict_check" CHECK ("pii_verdict" IN ('PASS', 'FAIL')),
    CONSTRAINT "review_gates_commerce_verdict_check" CHECK ("commerce_verdict" IN ('PASS', 'FAIL')),
    CONSTRAINT "review_gates_consistency_verdict_check" CHECK ("consistency_verdict" IN ('PASS', 'FAIL')),
    -- 🔴 docs/05 §3.6: execution='DONE' のときのみ、pii/commerce の判定と executed_at が確定する
    --    （HELD 行は pii_verdict IS NULL = 未判定のまま）。
    CONSTRAINT "review_gates_done_requires_verdicts_check" CHECK (
      ("execution" = 'DONE') = ("pii_verdict" IS NOT NULL AND "commerce_verdict" IS NOT NULL AND "executed_at" IS NOT NULL)
    ),
    -- 🔴 docs/05 §3.6: HELD_AI_COST_LIMIT のときのみ held_since が立つ。
    CONSTRAINT "review_gates_held_requires_since_check" CHECK (
      ("execution" = 'HELD_AI_COST_LIMIT') = ("held_since" IS NOT NULL)
    )
);
CREATE INDEX "review_gates_tenant_id_target_type_target_id_executed_at_idx" ON "review_gates"("tenant_id", "target_type", "target_id", "executed_at");
CREATE INDEX "review_gates_tenant_id_execution_executed_at_idx" ON "review_gates"("tenant_id", "execution", "executed_at"); -- ゲート FAIL 率の集計（A-005。execution='DONE' のみを分母にする）
-- 🔴 部分 UNIQUE: 保留は対象ごとに 1 行（docs/05 §3.6 / §9.3）。再実行（gate.hold-release）は
--    同じ行を DONE に完了させる（新しい行を足さない）。
CREATE UNIQUE INDEX "review_gates_one_pending_per_target" ON "review_gates"("tenant_id", "target_type", "target_id") WHERE "execution" <> 'DONE';

-- ============================================================================
-- AddForeignKey
-- ============================================================================
ALTER TABLE "proposal_requests" ADD CONSTRAINT "proposal_requests_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "proposal_requests" ADD CONSTRAINT "proposal_requests_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "proposal_requests" ADD CONSTRAINT "proposal_requests_engineer_id_fkey" FOREIGN KEY ("engineer_id") REFERENCES "engineers"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "proposal_requests" ADD CONSTRAINT "proposal_requests_partner_company_id_fkey" FOREIGN KEY ("partner_company_id") REFERENCES "partner_companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "proposals" ADD CONSTRAINT "proposals_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
-- 🔴 root のオーナー列（docs/05 §4.4.1）。engineers / users と同じく partner_companies への FK を持つ
--    （子の owner_partner_company_id には FK を張らない。継承トリガ〔T-02-08〕が親の値で確定させるため）。
ALTER TABLE "proposals" ADD CONSTRAINT "proposals_owner_partner_company_id_fkey" FOREIGN KEY ("owner_partner_company_id") REFERENCES "partner_companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "proposals" ADD CONSTRAINT "proposals_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "proposals" ADD CONSTRAINT "proposals_engineer_id_fkey" FOREIGN KEY ("engineer_id") REFERENCES "engineers"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "proposals" ADD CONSTRAINT "proposals_proposal_request_id_fkey" FOREIGN KEY ("proposal_request_id") REFERENCES "proposal_requests"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "engineer_snapshots" ADD CONSTRAINT "engineer_snapshots_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "engineer_snapshots" ADD CONSTRAINT "engineer_snapshots_proposal_id_fkey" FOREIGN KEY ("proposal_id") REFERENCES "proposals"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "engineer_snapshots" ADD CONSTRAINT "engineer_snapshots_skill_sheet_id_fkey" FOREIGN KEY ("skill_sheet_id") REFERENCES "skill_sheets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "proposal_events" ADD CONSTRAINT "proposal_events_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "proposal_events" ADD CONSTRAINT "proposal_events_proposal_id_fkey" FOREIGN KEY ("proposal_id") REFERENCES "proposals"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "review_gates" ADD CONSTRAINT "review_gates_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- 🔴 前方参照の解決: T-02-02 では project_visibilities.review_gate_id は列だけを持っていた
--    （review_gates 表がまだ存在しなかったため）。ここで FK を追加する。
ALTER TABLE "project_visibilities" ADD CONSTRAINT "project_visibilities_review_gate_id_fkey" FOREIGN KEY ("review_gate_id") REFERENCES "review_gates"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
