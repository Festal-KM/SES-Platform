-- T-02-01（docs/sprints/SP-02-schema-isolation.md）: docs/05 §3.3「テナント・利用者・境界」の
-- 7 表（tenants の拡張 + users / memberships / partner_companies / invitations /
-- two_factor_credentials / tenant_sending_domains）+ T-01-04 の engineers（既存）。
--
-- 🔴 このファイルは `prisma migrate diff --from-empty --to-schema-datamodel schema.prisma --script`
--    が出力した素の SQL を手で編集したものである（schema.prisma 冒頭コメント参照）。
--    docs/05 §3.1「列挙」規約（Prisma DSL は `String` で宣言し、DB 側は TEXT + CHECK を
--    マイグレーションで手書きする）に従い、`CREATE TYPE ... AS ENUM` を発行せず、対象列を
--    TEXT + CHECK に変更してある。
--    （列挙値の追加が ALTER TYPE のテーブルロックを起こさないようにするため。）
--
-- 適用方法: `app_migrator`（`MIGRATION_DATABASE_URL` 相当）で `prisma migrate deploy` を実行する
-- （docs/05 §4.2）。000_roles.sql が先に適用済みであること。

-- ============================================================================
-- CreateTable: tenants
-- ============================================================================
CREATE TABLE "tenants" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    -- docs/05 §3.3 AppEnvKind（本番顧客 / sandbox 見込み客 / デモ）。TEXT + CHECK。
    "environment" TEXT NOT NULL,
    -- docs/05 §3.3 TenantLifecycleState（CLAUDE.md §4.2。5 状態がすべて）。TEXT + CHECK。
    "lifecycle_state" TEXT NOT NULL DEFAULT 'ACTIVE',
    "lifecycle_changed_at" TIMESTAMPTZ(3) NOT NULL,
    "lifecycle_changed_by" UUID,
    "suspend_reason" TEXT,
    "sandbox_expires_at" TIMESTAMPTZ(3),
    "closing_entered_at" TIMESTAMPTZ(3),
    "auto_approve_enabled" BOOLEAN NOT NULL DEFAULT false,
    "pii_retention_years" INTEGER NOT NULL DEFAULT 3,
    "timezone" TEXT NOT NULL DEFAULT 'Asia/Tokyo',
    "created_by_platform_user_id" UUID,
    "provisioning_request_id" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tenants_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "tenants_environment_check" CHECK ("environment" IN ('production', 'sandbox', 'demo')),
    CONSTRAINT "tenants_lifecycle_state_check" CHECK ("lifecycle_state" IN ('SANDBOX', 'ACTIVE', 'SUSPENDED', 'CLOSING', 'PURGED'))
);

-- ============================================================================
-- CreateTable: users
-- ============================================================================
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "owner_partner_company_id" UUID,
    "email" TEXT NOT NULL,
    "display_name" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "password_reset_token_hash" TEXT,
    "password_reset_expires_at" TIMESTAMPTZ(3),
    "disabled_at" TIMESTAMPTZ(3),
    "last_login_at" TIMESTAMPTZ(3),

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);
-- 🔴 BR-36（docs/05 §17.2 #13）: platform / is_admin / is_operator を含む列名を作らない。
--    platform-user-no-flag.test.ts がカタログ走査で検証する。

-- ============================================================================
-- CreateTable: memberships
-- ============================================================================
CREATE TABLE "memberships" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    -- docs/05 §3.3 TenantRole。TEXT + CHECK。
    "role" TEXT NOT NULL,
    "partner_company_id" UUID,
    "joined_at" TIMESTAMPTZ(3) NOT NULL,
    "revoked_at" TIMESTAMPTZ(3),

    CONSTRAINT "memberships_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "memberships_role_check" CHECK ("role" IN ('OWNER', 'ADMIN', 'SALES', 'PARTNER_ADMIN', 'PARTNER_SALES', 'VIEWER')),
    -- 🔴 docs/05 §3.3 / F-002 AC-1: パートナーロールなのに所属が無い行、ホストロールなのに
    --    所属がある行を作れない。
    CONSTRAINT "memberships_partner_role_check" CHECK (
        ("role" IN ('PARTNER_ADMIN', 'PARTNER_SALES')) = ("partner_company_id" IS NOT NULL)
    )
);

-- ============================================================================
-- CreateTable: partner_companies
-- ============================================================================
CREATE TABLE "partner_companies" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "contact_name" TEXT,
    "contact_email" TEXT,
    "suspended_at" TIMESTAMPTZ(3),
    "invited_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "partner_companies_pkey" PRIMARY KEY ("id")
);

-- ============================================================================
-- CreateTable: invitations
-- ============================================================================
CREATE TABLE "invitations" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    -- docs/05 §3.3 TenantRole。TEXT + CHECK。
    "role" TEXT NOT NULL,
    "partner_company_id" UUID,
    "token_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "accepted_at" TIMESTAMPTZ(3),
    "accepted_user_id" UUID,
    "revoked_at" TIMESTAMPTZ(3),
    "invited_by" UUID,
    "invited_by_platform_user_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "invitations_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "invitations_role_check" CHECK ("role" IN ('OWNER', 'ADMIN', 'SALES', 'PARTNER_ADMIN', 'PARTNER_SALES', 'VIEWER')),
    -- 🔴 docs/05 §3.3: 招待者は必ずどちらか一方（テナント利用者 か 運営者）。
    CONSTRAINT "invitations_inviter_check" CHECK (num_nonnulls("invited_by", "invited_by_platform_user_id") = 1)
);

-- ============================================================================
-- CreateTable: two_factor_credentials
-- ============================================================================
CREATE TABLE "two_factor_credentials" (
    "id" UUID NOT NULL,
    "subject_type" TEXT NOT NULL,
    "subject_id" UUID NOT NULL,
    "tenant_id" UUID,
    "secret_encrypted" TEXT NOT NULL,
    "recovery_code_hashes" TEXT[],
    "confirmed_at" TIMESTAMPTZ(3),

    CONSTRAINT "two_factor_credentials_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "two_factor_credentials_subject_type_check" CHECK ("subject_type" IN ('USER', 'PLATFORM_USER'))
);

-- ============================================================================
-- CreateTable: tenant_sending_domains
-- ============================================================================
CREATE TABLE "tenant_sending_domains" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "domain" TEXT NOT NULL,
    "state" TEXT NOT NULL DEFAULT 'REGISTERED',
    "ses_identity_arn" TEXT,
    "ses_tenant_name" TEXT,
    "dkim_tokens" JSONB,
    "mail_from_domain" TEXT,
    "verified_at" TIMESTAMPTZ(3),
    "last_checked_at" TIMESTAMPTZ(3),
    "last_failure_reason" TEXT,
    "registered_by_platform_user_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tenant_sending_domains_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "tenant_sending_domains_state_check" CHECK ("state" IN ('REGISTERED', 'PENDING', 'VERIFIED', 'FAILED')),
    -- 🔴 docs/05 §3.3: state='VERIFIED' と verified_at の非 NULL は常に同値。
    CONSTRAINT "tenant_sending_domains_verified_check" CHECK (("state" = 'VERIFIED') = ("verified_at" IS NOT NULL))
);

-- ============================================================================
-- CreateTable: engineers（T-01-04 から変更なし）
-- ============================================================================
CREATE TABLE "engineers" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "owner_partner_company_id" UUID,
    "display_name" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "engineers_pkey" PRIMARY KEY ("id")
);

-- ============================================================================
-- CreateIndex
-- ============================================================================
CREATE UNIQUE INDEX "tenants_provisioning_request_id_key" ON "tenants"("provisioning_request_id");
CREATE INDEX "tenants_lifecycle_state_sandbox_expires_at_idx" ON "tenants"("lifecycle_state", "sandbox_expires_at");
CREATE INDEX "tenants_lifecycle_state_closing_entered_at_idx" ON "tenants"("lifecycle_state", "closing_entered_at");

CREATE INDEX "users_tenant_id_disabled_at_idx" ON "users"("tenant_id", "disabled_at");
CREATE UNIQUE INDEX "users_tenant_id_email_key" ON "users"("tenant_id", "email");

CREATE INDEX "memberships_tenant_id_role_revoked_at_idx" ON "memberships"("tenant_id", "role", "revoked_at");
CREATE INDEX "memberships_tenant_id_partner_company_id_idx" ON "memberships"("tenant_id", "partner_company_id");
CREATE UNIQUE INDEX "memberships_tenant_id_user_id_key" ON "memberships"("tenant_id", "user_id");

CREATE INDEX "partner_companies_tenant_id_suspended_at_idx" ON "partner_companies"("tenant_id", "suspended_at");

CREATE INDEX "invitations_tenant_id_email_accepted_at_idx" ON "invitations"("tenant_id", "email", "accepted_at");
CREATE UNIQUE INDEX "invitations_token_hash_key" ON "invitations"("token_hash");

CREATE UNIQUE INDEX "two_factor_credentials_subject_type_subject_id_key" ON "two_factor_credentials"("subject_type", "subject_id");

CREATE INDEX "tenant_sending_domains_tenant_id_verified_at_idx" ON "tenant_sending_domains"("tenant_id", "verified_at");
CREATE UNIQUE INDEX "tenant_sending_domains_tenant_id_domain_key" ON "tenant_sending_domains"("tenant_id", "domain");
-- 🔴 docs/05 §3.3: 送信元は 1 テナント 1 検証済みドメイン（部分 UNIQUE）。
CREATE UNIQUE INDEX "tenant_sending_domains_one_verified_per_tenant_key" ON "tenant_sending_domains"("tenant_id") WHERE "state" = 'VERIFIED';

CREATE INDEX "engineers_tenant_id_owner_partner_company_id_idx" ON "engineers"("tenant_id", "owner_partner_company_id");

-- ============================================================================
-- AddForeignKey
-- ============================================================================
ALTER TABLE "users" ADD CONSTRAINT "users_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "users" ADD CONSTRAINT "users_owner_partner_company_id_fkey" FOREIGN KEY ("owner_partner_company_id") REFERENCES "partner_companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "memberships" ADD CONSTRAINT "memberships_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_partner_company_id_fkey" FOREIGN KEY ("partner_company_id") REFERENCES "partner_companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "partner_companies" ADD CONSTRAINT "partner_companies_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "invitations" ADD CONSTRAINT "invitations_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_partner_company_id_fkey" FOREIGN KEY ("partner_company_id") REFERENCES "partner_companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "tenant_sending_domains" ADD CONSTRAINT "tenant_sending_domains_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "engineers" ADD CONSTRAINT "engineers_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ============================================================================
-- 🔴 docs/05 §3.3: users.owner_partner_company_id と memberships.partner_company_id の
--    整合トリガ（AFTER INSERT OR UPDATE ON memberships）。
--    users.owner_partner_company_id 自体の継承・freeze トリガ（docs/05 §4.4.1）は T-02-08 の範囲。
--    本トリガは「今ある値との整合」だけを見るため、T-02-08 を待たずに成立する。
-- ============================================================================
CREATE FUNCTION assert_user_owner_matches_membership() RETURNS trigger
LANGUAGE plpgsql AS $BODY$
DECLARE
    v_owner_partner_company_id UUID;
BEGIN
    SELECT "owner_partner_company_id" INTO v_owner_partner_company_id
    FROM "users" WHERE "id" = NEW."user_id";

    IF v_owner_partner_company_id IS DISTINCT FROM NEW."partner_company_id" THEN
        RAISE EXCEPTION
            'memberships.partner_company_id (%) は users.owner_partner_company_id (%) と一致しません（docs/05 §3.3）',
            NEW."partner_company_id", v_owner_partner_company_id;
    END IF;

    RETURN NEW;
END;
$BODY$;

CREATE TRIGGER memberships_assert_user_owner
    AFTER INSERT OR UPDATE ON "memberships"
    FOR EACH ROW EXECUTE FUNCTION assert_user_owner_matches_membership();
