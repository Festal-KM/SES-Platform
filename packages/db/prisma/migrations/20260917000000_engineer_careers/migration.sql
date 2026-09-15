-- ============================================================================
-- T-09-12 `EngineerCareer`（経験内容と従事期間）の新設（Issue #35 = 人間の回答「A」。2026-09-10）
-- docs/05 §3.4 / §3.4.1 / §3.6 / §4.4 C3 / §4.4.1 / §4.5 / §4.7 #15 / §5.5 / §9.7
-- ============================================================================
-- 本 migration が置くのは 1 表（`engineer_careers`）と、その複合 FK の参照先となる
-- `engineers` の `UNIQUE(tenant_id, id)` だけである。
--
-- 🔴 なぜ提案フロー（SP-09 T-09-01）より前か: 凍結は遡れない。`EngineerSnapshot.careers` は提案作成
--    時点の台帳を値ごと写すものであり（`F-019 AC-5`）、表を後から足しても、それ以前に作られた
--    スナップショットに経歴は入らない（docs/dev-plan.md §9 / docs/sprints/SP-09 §4）。
--
-- ============================================================================
-- 🔴 設計上の決定（docs/05 §3.4.1。ここに写しておく）
-- ============================================================================
-- ① 期間は `YYYY-MM` の VarChar(7)。`DATE` にしない（月精度の経歴に「日」を捏造しない。辞書順 =
--    時系列順なので `period_from DESC` がそのまま期間降順になる）。CHAR(7) にしないのは bpchar の
--    空白詰め比較セマンティクスを持ち込まないため。
-- ② `period_to IS NULL` = 継続中。空文字は正規表現 CHECK で弾く（「未入力」と「継続中」を同じ値にしない）。
-- ③ 表示順はサーバ側で確定する: `period_from DESC → created_at ASC → id ASC`。索引がそのまま供給する。
--    `period_to` を並びに使わない（NULLS FIRST/LAST に依存すると実装ごとにずれる）。
-- ④ `technologies` は Skill 辞書に正規化しない自由入力（検索・スコアの入力にしない）。
-- ⑤ 🔴 複合 FK `(tenant_id, engineer_id) → engineers(tenant_id, id)`（Issue #33 の決着に従う。
--    単一列 FK にしない）。別テナントのエンジニアを指す行を DB が拒む。参照先の UNIQUE をここで足す。
-- ⑥ 🔴 RLS は親（engineers）と同じ **C3 OWNER_SCOPED**。新しいクラスを作らない（docs/05 §4.4 の 🔴）。
--    `owner_partner_company_id` は `inherit_owner_partner_company('engineers','engineer_id')` が
--    親の値で必ず上書きし、行から直接は変えられない（§4.4.1。engineer_skills と同型）。
-- ⑦ 🔴 経路 4（共有スコープ）の追加 SELECT ポリシーを**書かない**（`F-008 AC-7` / `BR-55`）。
--    匿名候補の生成に経歴は 1 項目も要らないため、ホストからは 0 件でよい。§4.7 #15 の走査が
--    「`app_engineer_is_shared` / `shared_scope` を参照するポリシーは engineers / engineer_skills の
--    2 表だけ」を固定しており、ここに 1 本足した時点で落ちる。
-- ⑧ 🔴 運営者（app_platform）には `role` / `description` / `technologies` を GRANT しない（§5.5。
--    業務内容にはエンド企業名・現場名が書かれる）。件数・期間・出所だけを読める。
-- ⑨ ON DELETE CASCADE: 業務データは論理削除しない規約（§3.1）のため、実際に働くのは PURGED と
--    保持期間削除（§9.7。暫定 = Issue #48）だけである。`EngineerSnapshot` は engineers を参照しない
--    ので、台帳を消しても凍結は残る（それが凍結の意味）。

-- ============================================================================
-- 1. 複合 FK の参照先（engineers に UNIQUE(tenant_id, id)。PK は id 単独のまま）
-- ============================================================================
-- 🔴 partner_companies_tenant_id_id_key（migration 20260911000000）と同型。
--    Prisma の `@@unique([tenantId, id])` に対応する名前で作る（後続の `prisma migrate diff` で
--    差分が出ないようにする）。
CREATE UNIQUE INDEX IF NOT EXISTS "engineers_tenant_id_id_key" ON "engineers"("tenant_id", "id");

-- ============================================================================
-- 2. CreateTable: engineer_careers
-- ============================================================================
CREATE TABLE "engineer_careers" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "owner_partner_company_id" UUID, -- engineers から継承（§4.4.1）。継承トリガは下記 5.
    "engineer_id" UUID NOT NULL,
    "period_from" VARCHAR(7) NOT NULL,
    "period_to" VARCHAR(7),
    "role" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "technologies" TEXT NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'MANUAL',
    "skill_sheet_extraction_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "engineer_careers_pkey" PRIMARY KEY ("id"),
    -- 🔴 値集合の TS 側は packages/db/src/schema-value-sets.ts の ENGINEER_CAREER_SOURCES
    --    （tests/static/schema-enum-drift.test.ts が突合する）。
    CONSTRAINT "engineer_careers_source_check" CHECK ("source" IN ('MANUAL', 'EXTRACTED')),
    -- 🔴 YYYY-MM。TS 側は @ses/domain の YEAR_MONTH_PATTERN（tests/static/career-year-month-mirror.test.ts）。
    CONSTRAINT "engineer_careers_period_from_format_check" CHECK ("period_from" ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
    CONSTRAINT "engineer_careers_period_to_format_check" CHECK ("period_to" IS NULL OR "period_to" ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
    -- 🔴 逆転した期間を DB で拒む（辞書順 = 時系列順）。
    CONSTRAINT "engineer_careers_period_order_check" CHECK ("period_to" IS NULL OR "period_to" >= "period_from"),
    -- 🔴 手入力の行に抽出の出所を付けられない（source と出所がずれた行を作らせない）。
    CONSTRAINT "engineer_careers_extraction_source_check" CHECK ("source" = 'EXTRACTED' OR "skill_sheet_extraction_id" IS NULL)
);

COMMENT ON TABLE "engineer_careers" IS
  '経験内容と従事期間の 1 行（T-09-12。docs/05 §3.4.1）。RLS は engineers と同じ C3。凍結は engineer_snapshots.careers への値の複製であり、この表を参照しない';
COMMENT ON COLUMN "engineer_careers"."period_from" IS 'YYYY-MM（月精度。DATE にしない）';
COMMENT ON COLUMN "engineer_careers"."period_to" IS 'YYYY-MM。NULL = 継続中（空文字にしない）';
COMMENT ON COLUMN "engineer_careers"."technologies" IS '使用技術（自由入力。Skill 辞書に正規化しない。検索・スコアの入力にしない）';

-- 🔴 表示順（period_from DESC → created_at ASC → id ASC）をそのまま供給する索引（docs/05 §3.4.1）。
CREATE INDEX "engineer_careers_tenant_id_engineer_id_period_from_created_at_id_idx"
  ON "engineer_careers"("tenant_id", "engineer_id", "period_from" DESC, "created_at", "id");

-- ============================================================================
-- 3. FK
-- ============================================================================
ALTER TABLE "engineer_careers" ADD CONSTRAINT "engineer_careers_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
-- 🔴 複合 FK（Issue #33 / docs/05 §3.3.1 と同じ向き）。MATCH SIMPLE（既定）のまま。
ALTER TABLE "engineer_careers" ADD CONSTRAINT "engineer_careers_tenant_id_engineer_id_fkey"
  FOREIGN KEY ("tenant_id", "engineer_id") REFERENCES "engineers"("tenant_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;
-- 抽出の記録が消えても台帳の行は残る（出所が失われるだけ。台帳の値は台帳が持つ）。
ALTER TABLE "engineer_careers" ADD CONSTRAINT "engineer_careers_skill_sheet_extraction_id_fkey"
  FOREIGN KEY ("skill_sheet_extraction_id") REFERENCES "skill_sheet_extractions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ============================================================================
-- 4. RLS（C3 OWNER_SCOPED。docs/05 §4.4）+ FORCE。🔴 GRANT と対で足す（§4.2）
-- ============================================================================
ALTER TABLE "engineer_careers" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "engineer_careers" FORCE ROW LEVEL SECURITY;

-- USING / WITH CHECK = `tenant_id = app_tenant_id() AND owner_partner_company_id IS NOT DISTINCT FROM app_partner_id()`
-- （migration 20260903050000 §6 の C3 ループと同じ式・同じ命名）。
DROP POLICY IF EXISTS engineer_careers_c3_select ON engineer_careers;
CREATE POLICY engineer_careers_c3_select ON engineer_careers FOR SELECT TO app_tenant
  USING (tenant_id = app_tenant_id() AND owner_partner_company_id IS NOT DISTINCT FROM app_partner_id());
DROP POLICY IF EXISTS engineer_careers_c3_insert ON engineer_careers;
CREATE POLICY engineer_careers_c3_insert ON engineer_careers FOR INSERT TO app_tenant
  WITH CHECK (tenant_id = app_tenant_id() AND owner_partner_company_id IS NOT DISTINCT FROM app_partner_id());
DROP POLICY IF EXISTS engineer_careers_c3_update ON engineer_careers;
CREATE POLICY engineer_careers_c3_update ON engineer_careers FOR UPDATE TO app_tenant
  USING (tenant_id = app_tenant_id() AND owner_partner_company_id IS NOT DISTINCT FROM app_partner_id())
  WITH CHECK (tenant_id = app_tenant_id() AND owner_partner_company_id IS NOT DISTINCT FROM app_partner_id());
DROP POLICY IF EXISTS engineer_careers_c3_delete ON engineer_careers;
CREATE POLICY engineer_careers_c3_delete ON engineer_careers FOR DELETE TO app_tenant
  USING (tenant_id = app_tenant_id() AND owner_partner_company_id IS NOT DISTINCT FROM app_partner_id());

-- 🔴 経路 4（`engineers_shared_candidate_read` / `engineer_skills_shared_candidate_read` 相当）の
--    追加 SELECT ポリシーは**作らない**（本ファイル冒頭 ⑦）。

GRANT SELECT, INSERT, UPDATE, DELETE ON "engineer_careers" TO app_tenant;

-- ============================================================================
-- 5. オーナー列の継承（docs/05 §4.4.1。engineer_skills ← engineers と同型）
-- ============================================================================
-- 🔴 SECURITY INVOKER のまま: 経歴を書けるのは、そのエンジニアを所有する側だけである
--    （C3 の WITH CHECK も同じ式のため、他パートナーの engineers に書こうとする操作自体が
--    RLS で拒否される対象であり、「親が見えないので RAISE」で先に落ちても実害は無い）。
DROP TRIGGER IF EXISTS engineer_careers_inherit_owner ON engineer_careers;
CREATE TRIGGER engineer_careers_inherit_owner BEFORE INSERT OR UPDATE ON engineer_careers
  FOR EACH ROW EXECUTE FUNCTION inherit_owner_partner_company('engineers', 'engineer_id');

-- 🔴 §4.7 #9 / #14 ② の走査が要求する宣言（列挙リストを持たない検査の述語）。
COMMENT ON COLUMN engineer_careers.owner_partner_company_id
  IS 'owner-column: child of engineers(engineer_id)';

-- ============================================================================
-- 6. 管理平面（app_platform。docs/05 §5.5）—— 列を列挙して GRANT する
-- ============================================================================
-- 🔴 非開示: role / description / technologies（業務内容にはエンド企業名・現場名・商流が書かれる。
--    `CLAUDE.md` §10.5「運営者に必要なのは件数・状態・エラーであって内容ではない」）。
--    `A-005` / `A-011` に必要な件数・抽出由来の割合はこの列だけで数えられる。
GRANT SELECT (
  id, tenant_id, owner_partner_company_id, engineer_id, period_from, period_to, source,
  skill_sheet_extraction_id, created_at, updated_at
) ON engineer_careers TO app_platform;

-- 🔴 platform_read ポリシー（migration 20260904010000 §1 の `tenant_keyed` ループと同じ式・同じ命名）。
--    GRANT だけでは FORCE ROW LEVEL SECURITY 下で 0 件になる（§4.2「GRANT とポリシーは対」）。
DROP POLICY IF EXISTS engineer_careers_platform_read ON engineer_careers;
CREATE POLICY engineer_careers_platform_read ON engineer_careers FOR SELECT TO app_platform
  USING (
    current_setting('app.platform_user_id', true) <> ''
    AND (
      current_setting('app.target_tenant_id', true) = ''
      OR tenant_id::text = current_setting('app.target_tenant_id', true)
    )
  );
