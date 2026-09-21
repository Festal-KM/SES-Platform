-- ============================================================================
-- T-12-10 公開後の公開欄の編集と再検査（[Issue #42](https://github.com/Festal-KM/SES-Platform/issues/42) = 回答②。
-- docs/02 `F-014 AC-6`〜`AC-13` / `UC-26` / A-26、docs/04 改訂 14、
-- docs/05 §3.5 / §3.6 / §11.11「T-12-10 の実装の決着」）
-- ============================================================================
-- 🔴 守るべき 1 行: **公開の瞬間に検査を通した内容が、後から商流情報を含む状態で取引先に見え続ける
--    経路を塞ぐ。** 本 migration が増やすのは「再検査を起こす契機を記録する列」と「自動解除であることを
--    記録する列」だけであり、**公開範囲の行を作る / 落とす場所は `settleProjectPublish` の 1 か所のまま**
--    である（`AC-13`）。表は 1 つも増やさず、RLS ポリシー・GRANT も 1 行も変えない。
--
-- 変えるのは 3 表の列である。
--   ① `project_visibilities` … `revoked_reason` / `revoked_review_gate_id`（+ CHECK 3 本 + 索引 1 本）
--   ② `project_publish_requests` … `kind`（+ CHECK 2 本 + `@@unique` の改訂）
--   ③ `review_gates` … `run_trigger`（+ CHECK 2 本）
--
-- ============================================================================
-- 🔴 判断事項 1: なぜ `revoked_by`（誰が）ではなく `revoked_reason`（なぜ）なのか
-- ============================================================================
-- 画面が読み分けたいのは「**人の解除か、再検査による自動解除か**」である（docs/04 §S-010 の 3 値列 /
-- §S-011 の 4 値）。どちらの場合も公開先は 0 社になるため、**件数だけでは「設定し忘れ」と「検査で落ちた」を
-- 区別できない**。区別できないと、営業は `S-010` を見て「設定を忘れた」と読み、原因の欄（`S-011` の帯）に
-- 辿り着かない（`F-014 AC-9` が満たされない）。
-- 🔴 **「公開先が 0 社」という事実だけから画面に推測させない** —— 根拠は列の値に置く。
-- 🔴 `#28`（人の解除）は `revoked_reason='MANUAL'` を**必ず**書く。`revoked_at` だけを入れる書き方は
--    下の CHECK が拒む（アプリ側の書き忘れを DB が落とす）。
--
-- ============================================================================
-- 🔴 判断事項 2: なぜ要求の「種類」を列として持つのか（空配列で代用しないのか）
-- ============================================================================
-- `PUBLISH`（#28 = 相手を増やす）と `RECHECK`（#26 = 公開中の内容を検査し直す）は、**FAIL の意味が違う**:
--   - `PUBLISH` の FAIL … 追加しないだけ。**公開中の行は落とさない**（判定は `audience` に対する
--     相対的なものであり、`{A}` に B を足す要求が「公開文に A 社の社名がある」で FAIL しても、
--     `{A}` だけに対しては同じ本文が適法である。docs/05 §11.11 ⑨）
--   - `RECHECK` の FAIL … `audience` が現在の公開先そのものなので、**公開中の行をすべて落とす**（`AC-7`）
-- したがって 1 つの行に混ぜてはならない。「`partner_company_ids` が空なら再検査」という暗黙の規約にすると、
-- 意味が列に現れず、将来「追加 0 件の PUBLISH」を許した瞬間に**公開中の行が理由なく落ちる**。
-- 種類を列として持ち、対応（`RECHECK` ⇔ 0 件）を CHECK で縛る。
-- 🔴 `@@unique` を `(tenant_id, project_id, kind)` に改めるのは、**2 つの要求が同時に存在しうる**ためである
--    （編集の直後に `S-013` で公開先を足す、など）。消費は従来どおり `(project_id, content_hash)` の CAS で
--    あり、2 つの行のハッシュは必ず異なる（`PUBLISH` の `audience` は真に大きい集合になる）。
--
-- ============================================================================
-- 🔴 判断事項 3: なぜ `run_trigger` が NOT NULL 相当の CHECK を持つのか
-- ============================================================================
-- `S-013` セクション 4 は結果 1 行ごとに実行の契機（`公開の実行` / `公開欄の編集による再検査`）を添える
-- （docs/04 §S-013）。契機が読めないと、`S-011` の帯から辿った利用者が「これは公開しようとしたときの
-- 古い結果では」と迷う。
-- 🔴 **書き忘れを実行時ガードではなく DB 制約で落とす**: `(target_type = 'PROJECT_PUBLISH') = (run_trigger IS NOT NULL)`
--    なので、`holdReviewGate` / `completeReviewGate` が契機を運ばなければ**案件の公開のゲートは 1 行も保存できない**。
--    逆に提案（`PROPOSAL`）の行に契機を書くこともできない（提案に「公開欄の編集」は無い）。
--
-- ============================================================================
-- 🔴 backfill の方針（docs/05 §3.5 / §3.6）
-- ============================================================================
-- **自動解除も再検査も T-12-10 以前には存在しない。** したがって
--   - 既存の解除済みの行はすべて人の操作である → `revoked_reason = 'MANUAL'`
--   - 既存の `PROJECT_PUBLISH` のゲート結果はすべて公開の実行である → `run_trigger = 'PUBLISH'`
--   - 既存の公開要求はすべて `#28` のものである → `kind = 'PUBLISH'`（列の DEFAULT がそのまま効く）
-- 🔴 **backfill を済ませてから CHECK を張る**（順序が逆だと既存行で ALTER が失敗する）。

-- ----------------------------------------------------------------------------
-- ① project_visibilities: 解除の原因（docs/05 §3.5）
-- ----------------------------------------------------------------------------
ALTER TABLE project_visibilities
  ADD COLUMN IF NOT EXISTS revoked_reason          text,
  ADD COLUMN IF NOT EXISTS revoked_review_gate_id  uuid;

COMMENT ON COLUMN project_visibilities.revoked_reason IS
  '🔴 T-12-10: 解除の原因（MANUAL = #28 の人の解除 / GATE_RECHECK = 公開後の再検査による自動解除）';
COMMENT ON COLUMN project_visibilities.revoked_review_gate_id IS
  '🔴 T-12-10: GATE_RECHECK のとき NOT NULL。S-011 の帯「指摘を見る」（S-013 セクション 4）の導線';

-- 🔴 backfill（自動解除は T-12-10 以前に存在しない）。
UPDATE project_visibilities SET revoked_reason = 'MANUAL'
 WHERE revoked_at IS NOT NULL AND revoked_reason IS NULL;

-- 🔴 自動解除の根拠は削除できない（指摘に辿れなくなる）。ON DELETE RESTRICT は review_gate_id と同じ。
ALTER TABLE project_visibilities
  DROP CONSTRAINT IF EXISTS project_visibilities_revoked_review_gate_id_fkey;
ALTER TABLE project_visibilities
  ADD CONSTRAINT project_visibilities_revoked_review_gate_id_fkey
  FOREIGN KEY (revoked_review_gate_id) REFERENCES review_gates(id) ON DELETE RESTRICT;

ALTER TABLE project_visibilities
  DROP CONSTRAINT IF EXISTS "project_visibilities_revoked_reason_paired_check";
ALTER TABLE project_visibilities
  ADD CONSTRAINT "project_visibilities_revoked_reason_paired_check"
  CHECK ((revoked_at IS NULL) = (revoked_reason IS NULL));

ALTER TABLE project_visibilities
  DROP CONSTRAINT IF EXISTS "project_visibilities_revoked_reason_check";
ALTER TABLE project_visibilities
  ADD CONSTRAINT "project_visibilities_revoked_reason_check"
  CHECK ("revoked_reason" IS NULL OR "revoked_reason" IN ('MANUAL', 'GATE_RECHECK'));

ALTER TABLE project_visibilities
  DROP CONSTRAINT IF EXISTS "project_visibilities_revoked_gate_required_check";
ALTER TABLE project_visibilities
  ADD CONSTRAINT "project_visibilities_revoked_gate_required_check"
  CHECK (revoked_reason IS DISTINCT FROM 'GATE_RECHECK' OR revoked_review_gate_id IS NOT NULL);

-- 🔴 「最後に解除された行」（revoked_at DESC → id DESC の 1 行）を引く（docs/05 §11.11「T-12-10 の実装の決着」⑤）。
CREATE INDEX IF NOT EXISTS project_visibilities_tenant_project_revoked_at_idx
  ON project_visibilities (tenant_id, project_id, revoked_at DESC);

-- ----------------------------------------------------------------------------
-- ② project_publish_requests: 要求の種類（docs/05 §3.5）
-- ----------------------------------------------------------------------------
ALTER TABLE project_publish_requests
  ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'PUBLISH';

COMMENT ON COLUMN project_publish_requests.kind IS
  '🔴 T-12-10: 要求の種類（PUBLISH = #28 で相手を増やす / RECHECK = #26 で公開中の内容を検査し直す）。FAIL の意味が違う';

ALTER TABLE project_publish_requests
  DROP CONSTRAINT IF EXISTS "project_publish_requests_kind_check";
ALTER TABLE project_publish_requests
  ADD CONSTRAINT "project_publish_requests_kind_check"
  CHECK ("kind" IN ('PUBLISH', 'RECHECK'));

-- 🔴 種類と公開先の対応を DB で縛る（「空配列なら再検査」という暗黙の規約にしない）。
ALTER TABLE project_publish_requests
  DROP CONSTRAINT IF EXISTS "project_publish_requests_kind_audience_check";
ALTER TABLE project_publish_requests
  ADD CONSTRAINT "project_publish_requests_kind_audience_check"
  CHECK ((kind = 'RECHECK') = (cardinality(partner_company_ids) = 0));

-- 🔴 案件 × 種類ごとに 1 行（旧 (tenant_id, project_id) を置き換える。2 種類が同時に存在しうる）。
DROP INDEX IF EXISTS project_publish_requests_tenant_project_key;
CREATE UNIQUE INDEX IF NOT EXISTS project_publish_requests_tenant_project_kind_key
  ON project_publish_requests (tenant_id, project_id, kind);

-- ----------------------------------------------------------------------------
-- ③ review_gates: 実行の契機（docs/05 §3.6）
-- ----------------------------------------------------------------------------
ALTER TABLE review_gates
  ADD COLUMN IF NOT EXISTS run_trigger text;

COMMENT ON COLUMN review_gates.run_trigger IS
  '🔴 T-12-10: この行を作った実行の契機（PUBLISH = 公開の実行 / RECHECK = 公開欄の編集による再検査）。PROJECT_PUBLISH のみ';

-- 🔴 backfill（再検査は T-12-10 以前に存在しない）。
UPDATE review_gates SET run_trigger = 'PUBLISH'
 WHERE target_type = 'PROJECT_PUBLISH' AND run_trigger IS NULL;

ALTER TABLE review_gates
  DROP CONSTRAINT IF EXISTS "review_gates_run_trigger_paired_check";
ALTER TABLE review_gates
  ADD CONSTRAINT "review_gates_run_trigger_paired_check"
  CHECK ((target_type = 'PROJECT_PUBLISH') = (run_trigger IS NOT NULL));

ALTER TABLE review_gates
  DROP CONSTRAINT IF EXISTS "review_gates_run_trigger_check";
ALTER TABLE review_gates
  ADD CONSTRAINT "review_gates_run_trigger_check"
  CHECK ("run_trigger" IS NULL OR "run_trigger" IN ('PUBLISH', 'RECHECK'));

-- 🔴 GRANT / RLS は 1 行も変えない。
--    `project_visibilities` / `review_gates` は既にテーブル単位の GRANT であり、列を足しても
--    `app_platform` には 1 列も渡らない（`review_gates` の列 GRANT は migration 20260925000000 が
--    状態・時刻・ID の許可リストで固定しており、`run_trigger` はそこに含まれない ＝ 運営者からは読めない）。
