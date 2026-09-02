-- T-02-04（docs/sprints/SP-02-schema-isolation.md）: docs/05 §3.7「チャット・契約・稼働」
-- （chat_threads / thread_participants / messages / contracts / contract_documents /
-- contract_templates / orders / assignments / extension_reviews）+ 当事者列
-- （counterparty_partner_company_id。CLAUDE.md §3.1-5 の経路 5）。
--
-- 🔴 このファイルは（DB 未接続のため）`prisma migrate diff` の出力ではなく、schema.prisma と
--    docs/05 §3.7 から手で書き起こしたものである（20260903000000/010000/020000 と同じ運用。
--    schema.prisma 冒頭コメント参照）。docs/05 §3.1「列挙」規約に従い、列挙相当の列はすべて
--    `CREATE TYPE ... AS ENUM` を発行せず TEXT + CHECK に落としてある。
--    TS 側の単一出所は state（assignments / contracts）が @ses/domain（ASSIGNMENT_STATES /
--    CONTRACT_STATES。T-01-07 から既存）、それ以外（kind / externalProvider / sentVia /
--    paymentState / decision）が packages/db/src/schema-value-sets.ts。scan_status /
--    attachment_scan_status は §3.4 で定義済みの SCAN_STATUSES を共有する（新規 CHECK 値集合を
--    増やさない）。CHECK の値集合との一致は tests/static/schema-enum-drift.test.ts が突合する。
--
-- 🔴 当事者列（docs/05 §3.1 共通規約 / §4.4 C9）: assignments / contracts / contract_documents /
--    orders の 4 表だけが counterparty_partner_company_id を持つ。extension_reviews には無い
--    （ホスト内部の検討内容は経路 5 の対象外。BR-67）。root（contracts）にのみ partner_companies
--    への FK を張り、子（assignments / contract_documents / orders）には Prisma レベルの FK を
--    張らない（継承トリガ〔T-02-08〕が親の値で確定させるため。owner_partner_company_id と同じ方針）。
--
-- 🔴 RLS: 新規 9 表は ENABLE + FORCE ROW LEVEL SECURITY のみを packages/db/prisma/sql/010_rls.sql
--    に追加する（T-02-01/02/03 と同じ fail-closed 既定。C2/C5/C6/C9 のポリシー本体・GRANT・
--    射影ビュー 4 本は T-02-06/07）。
--
-- 適用方法: `app_migrator`（`MIGRATION_DATABASE_URL` 相当）で `prisma migrate deploy` を実行する
-- （docs/05 §4.2）。20260903020000_proposal_request_gate が先に適用済みであること。

-- ============================================================================
-- CreateTable: chat_threads（🔴 F-038 AC-2「1 スレッドに複数パートナーが同席する構成を作成できない」
-- を partner_company_id をスレッドの列にすることで構造的に不可能にする。RLS ポリシークラスは C6 THREAD）
-- ============================================================================
CREATE TABLE "chat_threads" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "project_id" UUID,
    "partner_company_id" UUID NOT NULL, -- 🔴 ホストと 1 パートナーの組み合わせに限る
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_message_at" TIMESTAMPTZ(3),

    CONSTRAINT "chat_threads_pkey" PRIMARY KEY ("id"),
    -- docs/05 §3.7 ChatThreadKind。単一の出所は packages/db CHAT_THREAD_KINDS。
    CONSTRAINT "chat_threads_kind_check" CHECK ("kind" IN ('PROJECT', 'COMPANY'))
);
CREATE UNIQUE INDEX "chat_threads_tenant_id_kind_project_id_partner_company_id_key" ON "chat_threads"("tenant_id", "kind", "project_id", "partner_company_id");
CREATE INDEX "chat_threads_tenant_id_partner_company_id_last_message_at_idx" ON "chat_threads"("tenant_id", "partner_company_id", "last_message_at");

-- ============================================================================
-- CreateTable: thread_participants（🔴 越境経路 3 の唯一の根拠。RLS ポリシークラスは C5 PARTY）
-- ============================================================================
CREATE TABLE "thread_participants" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "thread_id" UUID NOT NULL,
    "partner_company_id" UUID, -- null = ホスト
    "joined_at" TIMESTAMPTZ(3) NOT NULL,
    "left_at" TIMESTAMPTZ(3),

    CONSTRAINT "thread_participants_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "thread_participants_tenant_id_thread_id_partner_company_id_key" ON "thread_participants"("tenant_id", "thread_id", "partner_company_id");
CREATE INDEX "thread_participants_tenant_id_partner_company_id_left_at_idx" ON "thread_participants"("tenant_id", "partner_company_id", "left_at");

-- ============================================================================
-- CreateTable: messages（RLS ポリシークラスは C6 THREAD）
-- ============================================================================
CREATE TABLE "messages" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "owner_partner_company_id" UUID NOT NULL, -- chat_threads.partner_company_id から継承（§4.4.1）。継承トリガは T-02-08
    "thread_id" UUID NOT NULL,
    "sender_user_id" UUID NOT NULL,
    "sender_partner_company_id" UUID,
    "body" TEXT NOT NULL, -- 🔴 運営者に GRANT しない（§5.5）
    "attachment_key" TEXT, -- 🔴 運営者に GRANT しない（§5.5）
    "attachment_scan_status" TEXT,
    "review_gate_id" UUID, -- 添付があるときのみ
    "sent_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "purged_at" TIMESTAMPTZ(3), -- PURGED で本文を削除（F-064 AC-2）

    CONSTRAINT "messages_pkey" PRIMARY KEY ("id"),
    -- docs/05 §3.4 ScanStatus（messages / skill_sheets / file_scan_results / contract_documents /
    -- contract_templates で共有。単一の出所は packages/db SCAN_STATUSES）。nullable。
    CONSTRAINT "messages_attachment_scan_status_check" CHECK ("attachment_scan_status" IN ('SCANNING', 'CLEAN', 'INFECTED', 'UNSCANNABLE', 'FAILED'))
);
CREATE INDEX "messages_tenant_id_thread_id_sent_at_idx" ON "messages"("tenant_id", "thread_id", "sent_at");

-- ============================================================================
-- CreateTable: contracts（RLS ポリシークラスは C2 HOST_ONLY〔書込 + ホスト SELECT〕/ C9 COUNTERPARTY_READ〔パートナー SELECT〕）
-- ============================================================================
CREATE TABLE "contracts" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "state" TEXT NOT NULL DEFAULT 'DRAFT',
    "counterparty_name" TEXT NOT NULL,
    "counterparty_partner_company_id" UUID, -- 🔴 当事者列（根。freeze。§4.4 C9）。相手方がパートナーのとき必須
    "project_id" UUID,
    "engineer_id" UUID,
    "assignment_id" UUID,
    "unit_price" DECIMAL(12,2), -- 自社とパートナーの間の契約単価。ホストの販売単価は projects.internal_unit_price（経路 5 に出ない）
    "period_start" DATE,
    "period_end" DATE,
    "payment_terms" TEXT,
    "corrects_contract_id" UUID, -- EXECUTED の訂正で起こした新契約（F-047 AC-5）
    "send_failure_reason" TEXT,
    "send_hold_reason_key" TEXT, -- 🔴 §10.4。保留は状態でなく属性
    "send_hold_since" TIMESTAMPTZ(3), -- 🔴 §10.4
    "withdraw_reason" TEXT,
    "executed_at" TIMESTAMPTZ(3),
    "expired_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "contracts_pkey" PRIMARY KEY ("id"),
    -- docs/05 §3.7 ContractKind。単一の出所は packages/db CONTRACT_KINDS。
    CONSTRAINT "contracts_kind_check" CHECK ("kind" IN ('NDA', 'MASTER', 'INDIVIDUAL')),
    -- docs/05 §3.7 ContractState（7 状態がすべて。CLAUDE.md §4.2 の Contract ステートマシン）。
    -- 単一の出所は @ses/domain の CONTRACT_STATES。
    CONSTRAINT "contracts_state_check" CHECK ("state" IN (
      'DRAFT', 'SENDING', 'SEND_FAILED', 'UNDER_REVIEW', 'EXECUTED', 'WITHDRAWN', 'EXPIRED'
    )),
    -- 🔴 docs/05 §3.7: EXECUTED に到達した契約は executed_at が必ず埋まっている。
    CONSTRAINT "contracts_executed_requires_executed_at_check" CHECK (
      "state" <> 'EXECUTED' OR "executed_at" IS NOT NULL
    )
);
CREATE INDEX "contracts_tenant_id_state_updated_at_idx" ON "contracts"("tenant_id", "state", "updated_at");
CREATE INDEX "contracts_tenant_id_counterparty_partner_company_id_state_idx" ON "contracts"("tenant_id", "counterparty_partner_company_id", "state"); -- C9 の等値比較

-- ============================================================================
-- CreateTable: contract_documents（RLS ポリシークラスは C2 HOST_ONLY / C9 COUNTERPARTY_READ〔署名済み最終版のみ〕）
-- ============================================================================
CREATE TABLE "contract_documents" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "counterparty_partner_company_id" UUID, -- contracts から継承（§4.4.1）。継承トリガは T-02-08
    "contract_id" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "object_key" TEXT NOT NULL, -- 🔴 運営者に GRANT しない（§5.5）
    "template_id" UUID, -- 🔴 F-048 由来の版（手動アップロードは null）
    "template_version" INTEGER, -- 🔴 生成時のテンプレート版を固定（F-048 AC-1）
    "merge_result" JSONB, -- { filled: {...}, unfilled: string[] }（F-048 AC-2）
    "review_gate_id" UUID, -- 🔴 F-047 処理⑥ / F-048 AC-3
    "scan_status" TEXT NOT NULL DEFAULT 'SCANNING',
    "external_document_id" TEXT, -- 電子署名サービスの書類 ID（DocuSign = envelopeId。正規化済み）
    "external_provider" TEXT,
    "sent_via" TEXT,
    "requested_at" TIMESTAMPTZ(3),
    "signed_at" TIMESTAMPTZ(3), -- 🔴 全署名者の完了時刻。C9 は signed_at IS NOT NULL の版しか見せない
    "signers" JSONB, -- 🔴 NormalizedSigner[]。運営者に GRANT しない（§5.5）
    "normalized_status" JSONB, -- 🔴 生応答は保存しない（F-049 AC-6）

    CONSTRAINT "contract_documents_pkey" PRIMARY KEY ("id"),
    -- docs/05 §3.4 ScanStatus（上記参照。単一の出所は packages/db SCAN_STATUSES）。
    CONSTRAINT "contract_documents_scan_status_check" CHECK ("scan_status" IN ('SCANNING', 'CLEAN', 'INFECTED', 'UNSCANNABLE', 'FAILED')),
    -- docs/05 §3.7 ContractDocumentExternalProvider（決定済み。Issue #11。BYO 接続）。単一の出所は
    -- packages/db CONTRACT_DOCUMENT_EXTERNAL_PROVIDERS。
    CONSTRAINT "contract_documents_external_provider_check" CHECK ("external_provider" IN ('docusign', 'cloudsign', 'mock')),
    -- docs/05 §3.7 ContractDocumentSentVia（F-047 処理⑧）。単一の出所は packages/db CONTRACT_DOCUMENT_SENT_VIAS。
    CONSTRAINT "contract_documents_sent_via_check" CHECK ("sent_via" IN ('ESIGN', 'EMAIL')),
    -- 🔴 docs/05 §3.7: ゲート結果を持たない版に署名依頼日時が入らない（F-047 処理⑥ / F-048 AC-3）。
    CONSTRAINT "contract_documents_requested_at_requires_gate_check" CHECK (
      "requested_at" IS NULL OR "review_gate_id" IS NOT NULL
    )
);
CREATE UNIQUE INDEX "contract_documents_tenant_id_contract_id_version_key" ON "contract_documents"("tenant_id", "contract_id", "version");
CREATE UNIQUE INDEX "contract_documents_external_provider_external_document_id_key" ON "contract_documents"("external_provider", "external_document_id"); -- Webhook からの逆引き

-- ============================================================================
-- CreateTable: contract_templates（🔴 F-048 / S-027。Phase 3。RLS ポリシークラスは C2 HOST_ONLY）
-- ============================================================================
CREATE TABLE "contract_templates" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "version" INTEGER NOT NULL, -- 🔴 上書きしない。差し替えは新しい版を起こす
    "object_key" TEXT NOT NULL, -- docx 原本（§14.1）。🔴 運営者に GRANT しない（§5.5）
    "scan_status" TEXT NOT NULL DEFAULT 'SCANNING',
    "placeholders" TEXT[],
    "mapping" JSONB NOT NULL, -- MergeMapping[]。🔴 版ごとに固定。運営者に GRANT しない（§5.5）
    "is_latest" BOOLEAN NOT NULL DEFAULT false,
    "archived_at" TIMESTAMPTZ(3),
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "contract_templates_pkey" PRIMARY KEY ("id"),
    -- docs/05 §3.7 ContractKind（contracts と同じ値集合を共有）。
    CONSTRAINT "contract_templates_kind_check" CHECK ("kind" IN ('NDA', 'MASTER', 'INDIVIDUAL')),
    CONSTRAINT "contract_templates_scan_status_check" CHECK ("scan_status" IN ('SCANNING', 'CLEAN', 'INFECTED', 'UNSCANNABLE', 'FAILED')),
    -- 🔴 docs/05 §3.7（BR-26）: is_latest = true になれるのは CLEAN のみ。
    CONSTRAINT "contract_templates_latest_requires_clean_check" CHECK (
      "is_latest" = false OR "scan_status" = 'CLEAN'
    )
);
CREATE UNIQUE INDEX "contract_templates_tenant_id_name_version_key" ON "contract_templates"("tenant_id", "name", "version");
CREATE INDEX "contract_templates_tenant_id_kind_is_latest_idx" ON "contract_templates"("tenant_id", "kind", "is_latest");
-- 🔴 部分 UNIQUE: 1 テナント・1 テンプレート名につき is_latest = true（かつ未アーカイブ）は高々 1 件（docs/05 §3.7）。
CREATE UNIQUE INDEX "contract_templates_one_latest_per_name_key" ON "contract_templates"("tenant_id", "name") WHERE "is_latest" AND "archived_at" IS NULL;

-- ============================================================================
-- CreateTable: assignments（RLS ポリシークラスは C2 HOST_ONLY / C9 COUNTERPARTY_READ）
-- ============================================================================
CREATE TABLE "assignments" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "engineer_id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "proposal_id" UUID NOT NULL, -- WON からのみ生成（F-042 AC-1）
    "counterparty_partner_company_id" UUID, -- 🔴 当事者列（engineers.owner_partner_company_id から継承。§4.4.1）。null = 自社エンジニア。C9
    "state" TEXT NOT NULL DEFAULT 'SCHEDULED',
    "start_date" DATE NOT NULL,
    "end_date" DATE NOT NULL, -- 🔴 NOT NULL（F-042 AC-3）
    "actual_leave_date" DATE, -- 緊急離任の実離任日（F-045 処理①）
    "unit_price" DECIMAL(12,2),
    "review_opened_at" TIMESTAMPTZ(3), -- 60 日前起票済み（フラグではなく日時）
    "reminder30_sent_at" TIMESTAMPTZ(3), -- 30 日前再通知済み（状態ではない。A-06）
    "owner_user_id" UUID NOT NULL, -- 担当者

    CONSTRAINT "assignments_pkey" PRIMARY KEY ("id"),
    -- docs/05 §3.7 AssignmentState（5 状態がすべて。CLAUDE.md §4.2 の Assignment ステートマシン）。
    -- 単一の出所は @ses/domain の ASSIGNMENT_STATES。
    CONSTRAINT "assignments_state_check" CHECK ("state" IN (
      'SCHEDULED', 'ACTIVE', 'EXTENSION_REVIEW', 'ENDING', 'ENDED'
    ))
);
CREATE UNIQUE INDEX "assignments_proposal_id_key" ON "assignments"("proposal_id");
CREATE INDEX "assignments_tenant_id_state_end_date_idx" ON "assignments"("tenant_id", "state", "end_date"); -- 🔴 満了アラートの走査（§9.4）
CREATE INDEX "assignments_tenant_id_state_start_date_idx" ON "assignments"("tenant_id", "state", "start_date");
CREATE INDEX "assignments_tenant_id_counterparty_partner_company_id_end_d_idx" ON "assignments"("tenant_id", "counterparty_partner_company_id", "end_date"); -- C9 + S-044 の満了日昇順
-- 🔴 部分インデックス（起票条件「60 日前を過ぎ、かつ未起票」を索引で表現する。F-043 AC-4）。
CREATE INDEX "assignments_pending_review_idx" ON "assignments"("tenant_id", "end_date") WHERE "state" = 'ACTIVE' AND "review_opened_at" IS NULL;

-- ============================================================================
-- CreateTable: orders（RLS ポリシークラスは C2 HOST_ONLY / C9 COUNTERPARTY_READ）
-- ============================================================================
CREATE TABLE "orders" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "counterparty_partner_company_id" UUID, -- 🔴 当事者列（contracts / assignments から継承。§4.4.1 の CASE）
    "contract_id" UUID,
    "assignment_id" UUID,
    "amount" DECIMAL(12,2) NOT NULL,
    "period_start" DATE NOT NULL,
    "period_end" DATE NOT NULL,
    "issued_on" DATE,
    "payment_state" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "orders_pkey" PRIMARY KEY ("id"),
    -- docs/05 §3.7 OrderPaymentState。単一の出所は packages/db ORDER_PAYMENT_STATES。
    CONSTRAINT "orders_payment_state_check" CHECK ("payment_state" IN ('UNPAID', 'PAID')),
    -- 🔴 docs/05 §3.7（F-050 AC-1）: contract_id / assignment_id の少なくとも一方が必須。
    CONSTRAINT "orders_contract_or_assignment_check" CHECK (
      "contract_id" IS NOT NULL OR "assignment_id" IS NOT NULL
    )
);
CREATE INDEX "orders_tenant_id_period_end_idx" ON "orders"("tenant_id", "period_end");

-- ============================================================================
-- CreateTable: extension_reviews（🔴 当事者列を持たない。ホスト内部の検討内容は経路 5 の対象外。BR-67。
-- RLS ポリシークラスは C2 HOST_ONLY〔SELECT も含めホストのみ〕）
-- ============================================================================
CREATE TABLE "extension_reviews" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "assignment_id" UUID NOT NULL,
    "opened_at" TIMESTAMPTZ(3) NOT NULL,
    "owner_user_id" UUID NOT NULL,
    "facts" JSONB NOT NULL, -- 🔴 機械収集の根拠データ（AI と独立。docs/04 申し送り 12）
    "summary" JSONB, -- renewal-advisor の出力
    "role" TEXT,
    "prompt_version" TEXT,
    "model_id" TEXT,
    "ai_usage_id" UUID, -- FK は ai_usage 表が生まれる T-02-05 で追加する
    "decision" TEXT,
    "decided_by" UUID,
    "decided_at" TIMESTAMPTZ(3),

    CONSTRAINT "extension_reviews_pkey" PRIMARY KEY ("id"),
    -- docs/05 §3.7 ExtensionReviewDecision。単一の出所は packages/db EXTENSION_REVIEW_DECISIONS。
    CONSTRAINT "extension_reviews_decision_check" CHECK ("decision" IN ('EXTEND', 'END', 'REPRICE'))
);
CREATE UNIQUE INDEX "extension_reviews_tenant_id_assignment_id_opened_at_key" ON "extension_reviews"("tenant_id", "assignment_id", "opened_at"); -- 同一稼働で複数回の起票を許す（延長 → 再起票）

-- ============================================================================
-- AddForeignKey
-- ============================================================================
ALTER TABLE "chat_threads" ADD CONSTRAINT "chat_threads_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "chat_threads" ADD CONSTRAINT "chat_threads_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "chat_threads" ADD CONSTRAINT "chat_threads_partner_company_id_fkey" FOREIGN KEY ("partner_company_id") REFERENCES "partner_companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "thread_participants" ADD CONSTRAINT "thread_participants_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "thread_participants" ADD CONSTRAINT "thread_participants_thread_id_fkey" FOREIGN KEY ("thread_id") REFERENCES "chat_threads"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "thread_participants" ADD CONSTRAINT "thread_participants_partner_company_id_fkey" FOREIGN KEY ("partner_company_id") REFERENCES "partner_companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "messages" ADD CONSTRAINT "messages_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
-- 🔴 owner_partner_company_id は子（chat_threads から継承）のため partner_companies への FK を張らない
--    （継承トリガ〔T-02-08〕が親の値で確定させるため。docs/05 §4.4.1）。
ALTER TABLE "messages" ADD CONSTRAINT "messages_thread_id_fkey" FOREIGN KEY ("thread_id") REFERENCES "chat_threads"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "messages" ADD CONSTRAINT "messages_sender_partner_company_id_fkey" FOREIGN KEY ("sender_partner_company_id") REFERENCES "partner_companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "messages" ADD CONSTRAINT "messages_review_gate_id_fkey" FOREIGN KEY ("review_gate_id") REFERENCES "review_gates"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "contracts" ADD CONSTRAINT "contracts_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
-- 🔴 root の当事者列（docs/05 §4.4.1）。engineers / proposals の owner_partner_company_id と同じく
--    partner_companies への FK を持つ（子の counterparty_partner_company_id には FK を張らない）。
ALTER TABLE "contracts" ADD CONSTRAINT "contracts_counterparty_partner_company_id_fkey" FOREIGN KEY ("counterparty_partner_company_id") REFERENCES "partner_companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "contracts" ADD CONSTRAINT "contracts_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "contracts" ADD CONSTRAINT "contracts_engineer_id_fkey" FOREIGN KEY ("engineer_id") REFERENCES "engineers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "contracts" ADD CONSTRAINT "contracts_assignment_id_fkey" FOREIGN KEY ("assignment_id") REFERENCES "assignments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "contracts" ADD CONSTRAINT "contracts_corrects_contract_id_fkey" FOREIGN KEY ("corrects_contract_id") REFERENCES "contracts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "contract_documents" ADD CONSTRAINT "contract_documents_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
-- 🔴 counterparty_partner_company_id は子（contracts から継承）のため partner_companies への FK を張らない。
ALTER TABLE "contract_documents" ADD CONSTRAINT "contract_documents_contract_id_fkey" FOREIGN KEY ("contract_id") REFERENCES "contracts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "contract_documents" ADD CONSTRAINT "contract_documents_template_id_fkey" FOREIGN KEY ("template_id") REFERENCES "contract_templates"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "contract_documents" ADD CONSTRAINT "contract_documents_review_gate_id_fkey" FOREIGN KEY ("review_gate_id") REFERENCES "review_gates"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "contract_templates" ADD CONSTRAINT "contract_templates_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "assignments" ADD CONSTRAINT "assignments_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "assignments" ADD CONSTRAINT "assignments_engineer_id_fkey" FOREIGN KEY ("engineer_id") REFERENCES "engineers"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "assignments" ADD CONSTRAINT "assignments_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "assignments" ADD CONSTRAINT "assignments_proposal_id_fkey" FOREIGN KEY ("proposal_id") REFERENCES "proposals"("id") ON DELETE CASCADE ON UPDATE CASCADE;
-- 🔴 counterparty_partner_company_id は子（engineers.owner_partner_company_id から継承）のため
--    partner_companies への FK を張らない（docs/05 §4.4.1）。

ALTER TABLE "orders" ADD CONSTRAINT "orders_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "orders" ADD CONSTRAINT "orders_contract_id_fkey" FOREIGN KEY ("contract_id") REFERENCES "contracts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "orders" ADD CONSTRAINT "orders_assignment_id_fkey" FOREIGN KEY ("assignment_id") REFERENCES "assignments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
-- 🔴 counterparty_partner_company_id は子（CASE で contracts / assignments から継承）のため
--    partner_companies への FK を張らない（docs/05 §4.4.1）。

ALTER TABLE "extension_reviews" ADD CONSTRAINT "extension_reviews_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "extension_reviews" ADD CONSTRAINT "extension_reviews_assignment_id_fkey" FOREIGN KEY ("assignment_id") REFERENCES "assignments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ============================================================================
-- 🔴 docs/05 §3.7 / F-047 AC-5: EXECUTED に到達した契約は内容を書き換えられない。訂正は新しい
--    Contract を起こす（state / expired_at / updated_at 以外の列変更を BEFORE UPDATE で拒否する）。
--    アプリの分岐に頼らない（アプリを迂回しても書き換わらない）。
-- ============================================================================
CREATE FUNCTION assert_contract_executed_immutable() RETURNS trigger
LANGUAGE plpgsql AS $BODY$
DECLARE
    v_old_rest JSONB;
    v_new_rest JSONB;
BEGIN
    IF OLD."state" = 'EXECUTED' THEN
        v_old_rest := to_jsonb(OLD) - 'state' - 'expired_at' - 'updated_at';
        v_new_rest := to_jsonb(NEW) - 'state' - 'expired_at' - 'updated_at';
        IF v_old_rest IS DISTINCT FROM v_new_rest THEN
            RAISE EXCEPTION
                'contracts: EXECUTED な契約は state / expired_at / updated_at 以外を変更できません（id=%）（docs/05 §3.7 / F-047 AC-5）',
                OLD."id";
        END IF;
    END IF;

    RETURN NEW;
END;
$BODY$;

CREATE TRIGGER contracts_assert_executed_immutable
    BEFORE UPDATE ON "contracts"
    FOR EACH ROW EXECUTE FUNCTION assert_contract_executed_immutable();
