-- ============================================================================
-- T-07-09 案件公開のゲート接続（docs/05 §11.11 / `F-014 AC-3` / `F-020 AC-1`）
-- ============================================================================
-- 本 migration が置くのは 1 表だけである: `project_publish_requests`。
--
-- ============================================================================
-- 🔴 判断事項: なぜ中間テーブルが要るのか（docs/05 §11.9 ⑧-5 の申し送り）
-- ============================================================================
-- `project_visibilities.review_gate_id` は **NOT NULL + FK**（docs/05 §3.5）であり、
-- ゲート結果の行が無ければ公開範囲の行は物理的に作れない。したがって「これから公開する相手」を
-- 置ける場所が `project_visibilities` には無い。
--
-- ところが品質ゲートの商流層は「**その公開範囲で**出してはならない語」を見る（`F-014 AC-3`）。
-- 公開先の一覧が分からなければ「公開先に含まれない取引先の社名」も決まらないので、
-- **新規公開先の社名が公開文に書かれていても他社名として検出されない**。
-- これは `CLAUDE.md` §3.1 の 🔴（パートナー同士の相互参照を 1 経路も作らない）に直結する。
--
-- 🔴 **`gate.run` の payload に載せる案を採らなかった理由**（§11.11 ①）:
--    `gate.hold-release`（AI 上限からの自動復帰。T-07-10）は `review_gates` の**保留行だけ**を
--    材料に「同じ payload・同じ `jobId`」で再 enqueue する（docs/05 §11.9 ⑧-7）。保留行は
--    `(target_type, target_id, content_hash)` しか持たないため、公開先を payload に持たせると
--    **上限で保留された公開要求だけが、復帰後に公開先を復元できない**。
--    復元できないものを「空の公開先」で続行させれば、それは検査していない相手への公開になる。
--
-- ============================================================================
-- 🔴 消費は (project_id, content_hash) の CAS である
-- ============================================================================
-- 行は案件ごとに 1 つ（`@@unique(tenant_id, project_id)`）で、公開要求が差し替わったら
-- **UPDATE で上書きする**（積み上げない）。ワーカーは自分が実行した `content_hash` と一致する
-- 行だけを消費するので、差し替え前の古い実行は**何も公開しないまま終わる**。
--
-- ============================================================================
-- 🔴 RLS は C2 HOST_ONLY（docs/05 §4.4）
-- ============================================================================
-- 公開範囲を決めるのはホストだけであり（`project_visibilities` と同じ）、
-- **公開先の一覧（他社の社名に一意に対応する ID）が出てよいのもホストだけ**である
-- （`CLAUDE.md` §3.1 の 🔴）。パートナー文脈からは 1 行も見えない。
-- オーナー列（`owner_partner_company_id`）を持たない —— 持てば「パートナーが公開範囲を
-- 要求できる」という意味になり、越境経路 1 の向き（ホスト → パートナー）が壊れる。

CREATE TABLE IF NOT EXISTS project_publish_requests (
  id                  uuid PRIMARY KEY,
  tenant_id           uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  project_id          uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  -- 🔴 これから公開する相手だけ（すでに公開中の相手は含まない）。
  --    FK は張れない（配列）。実在の検証は #28（`assertPartnerCompaniesExist`）が行い、
  --    最終的な整合は `project_visibilities` の複合 FK（Issue #33 / §3.3.1 A-5）が担う。
  partner_company_ids uuid[] NOT NULL,
  content_hash        text NOT NULL,
  requested_at        timestamptz(3) NOT NULL,
  requested_by        uuid NOT NULL
);

COMMENT ON TABLE project_publish_requests IS
  'ゲート PASS 待ちの公開要求（T-07-09。docs/05 §11.11）。公開の成立は project_visibilities のみ';
COMMENT ON COLUMN project_publish_requests.partner_company_ids IS
  '🔴 これから公開する相手。GateInput.audience と forbiddenTerms.otherCompanyNames の材料';
COMMENT ON COLUMN project_publish_requests.content_hash IS
  'ReviewGate.contentHash と同じ値。消費（公開の確定）は (project_id, content_hash) の CAS';

-- 🔴 案件ごとに保留中の要求は 1 つ（差し替えは UPDATE。積み上がらない）。
CREATE UNIQUE INDEX IF NOT EXISTS project_publish_requests_tenant_project_key
  ON project_publish_requests (tenant_id, project_id);

-- ----------------------------------------------------------------------------
-- RLS（C2 HOST_ONLY）と GRANT。🔴 片方だけを足さない（docs/05 §4.2）
-- ----------------------------------------------------------------------------
ALTER TABLE project_publish_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE project_publish_requests FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS project_publish_requests_c2_select ON project_publish_requests;
CREATE POLICY project_publish_requests_c2_select ON project_publish_requests FOR SELECT TO app_tenant
  USING (tenant_id = app_tenant_id() AND app_is_host());

DROP POLICY IF EXISTS project_publish_requests_c2_insert ON project_publish_requests;
CREATE POLICY project_publish_requests_c2_insert ON project_publish_requests FOR INSERT TO app_tenant
  WITH CHECK (tenant_id = app_tenant_id() AND app_is_host());

DROP POLICY IF EXISTS project_publish_requests_c2_update ON project_publish_requests;
CREATE POLICY project_publish_requests_c2_update ON project_publish_requests FOR UPDATE TO app_tenant
  USING (tenant_id = app_tenant_id() AND app_is_host())
  WITH CHECK (tenant_id = app_tenant_id() AND app_is_host());

DROP POLICY IF EXISTS project_publish_requests_c2_delete ON project_publish_requests;
CREATE POLICY project_publish_requests_c2_delete ON project_publish_requests FOR DELETE TO app_tenant
  USING (tenant_id = app_tenant_id() AND app_is_host());

GRANT SELECT, INSERT, UPDATE, DELETE ON project_publish_requests TO app_tenant;

-- 🔴 `app_platform` には 1 列も GRANT しない。運営者に必要なのは「件数・状態・エラー」であって
--    「どの取引先に公開しようとしているか」ではない（`CLAUDE.md` §10.5）。
