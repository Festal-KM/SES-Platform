-- ============================================================================
-- 案件に カテゴリ / 案件区分 / 並行可否 を足す。2026-10-16。
-- 一次資料: 人間の明示指示「これちゃんと参考にして、検索部分修正してよ」+ 受領モック
--           `デザインモック/自社案件管理_案件一覧.png` の絞り込みパネル
--           （[Issue #113](https://github.com/Festal-KM/SES-Platform/issues/113)「設計から改訂して」
--            が列を足す承認である）
-- ============================================================================
-- モックの絞り込みは 9 項目ある。このうち **DB 列が無くて実装できていなかった 3 つ**を足す:
--
--   | 絞り込み     | 列                      | 値 |
--   |-------------|-------------------------|----|
--   | カテゴリ     | `projects.category`     | BACKEND / FRONTEND / INFRA / AI / DATA / PM_PMO / HELPDESK |
--   | 案件区分     | `projects.source_kind`  | OWN（自社案件） / PARTNER（パートナー案件） |
--   | 並行可否     | `projects.parallel_ok`  | boolean（null = 未設定） |
--
-- 🔴 **`source_kind` は「どこから来た案件か」の分類であって、所有者ではない。** 行は従来どおり
--    テナント（ホスト）のものであり、**RLS も §3.1 の越境経路も 1 つも変わらない**。
--    パートナーが持ち込んだ案件を別の経路で読ませる話ではない（それは Issue #102 の範囲）。
-- 🔴 **`category` / `parallel_ok` は `null` を許す** —— 既存の案件には値が無く、既定値を入れると
--    「本当は未設定なのに何か入っている」状態を作る（`job_title` と同じ扱い）。画面は「未設定」と出す。
-- 🔴 **`source_kind` だけ `NOT NULL DEFAULT 'OWN'`** —— 既存の行はすべて自社案件であり、
--    「どちらか分からない案件」という状態は業務上存在しない（区分は必ずどちらかに決まる）。
--
-- 🔴 **GRANT を足す必要が無い。** `projects` は列レベルではなく表レベルで `app_tenant` に
--    GRANT されており、PostgreSQL の表レベル GRANT は**後から足した列にも及ぶ**。
-- 🔴 **データの書き換えが無いので FORCE ROW LEVEL SECURITY を触らない**
--    （`20261016010000` で踏んだ罠は「既存行を UPDATE する」ときのものである。
--     `ADD COLUMN` と `ADD CONSTRAINT`〔新しい制約名〕は RLS の影響を受けない）。
--    ⚠️ `source_kind` の `DEFAULT 'OWN'` は既存行にも適用されるが、これは PostgreSQL が
--       カタログの既定値として扱うもので、行を UPDATE しない（11 以降の挙動）。

-- ----------------------------------------------------------------------------
-- ① カテゴリ（null = 未設定）
-- ----------------------------------------------------------------------------
ALTER TABLE projects ADD COLUMN IF NOT EXISTS category text;
ALTER TABLE projects DROP CONSTRAINT IF EXISTS "projects_category_check";
ALTER TABLE projects
  ADD CONSTRAINT "projects_category_check"
  CHECK ("category" IN ('BACKEND', 'FRONTEND', 'INFRA', 'AI', 'DATA', 'PM_PMO', 'HELPDESK'));

COMMENT ON COLUMN projects.category IS
  '案件のカテゴリ（S-010 の絞り込み・一覧の列。2026-10-16。Issue #113）。null = 未設定。単一の出所は packages/db/src/schema-value-sets.ts の PROJECT_CATEGORIES';

-- ----------------------------------------------------------------------------
-- ② 案件区分（自社 / パートナー。既存はすべて自社案件）
-- ----------------------------------------------------------------------------
ALTER TABLE projects ADD COLUMN IF NOT EXISTS source_kind text NOT NULL DEFAULT 'OWN';
ALTER TABLE projects DROP CONSTRAINT IF EXISTS "projects_source_kind_check";
ALTER TABLE projects
  ADD CONSTRAINT "projects_source_kind_check" CHECK ("source_kind" IN ('OWN', 'PARTNER'));

COMMENT ON COLUMN projects.source_kind IS
  '案件区分。OWN（自社案件）/ PARTNER（パートナー案件）。2026-10-16。Issue #113。🔴 どこから来たかの分類であって所有者ではない（行はテナントのもの。RLS も越境経路も変わらない）';

-- ----------------------------------------------------------------------------
-- ③ 並行可否（null = 未設定）
-- ----------------------------------------------------------------------------
ALTER TABLE projects ADD COLUMN IF NOT EXISTS parallel_ok boolean;

COMMENT ON COLUMN projects.parallel_ok IS
  '並行可否（他案件との並行提案を許すか）。null = 未設定。2026-10-16。Issue #113';

-- ----------------------------------------------------------------------------
-- ④ 絞り込みの索引
--    🔴 **母集団は RLS の `tenant_id` 等値が先に絞る**（`free-word.ts` 冒頭の実測）。
--       ここで足すのは「テナントの中をさらに等値で絞る」ための複合索引であり、
--       単独索引を 3 本並べるより選択性が高い。
-- ----------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS "projects_tenant_category_idx" ON projects ("tenant_id", "category");
CREATE INDEX IF NOT EXISTS "projects_tenant_source_kind_idx" ON projects ("tenant_id", "source_kind");
