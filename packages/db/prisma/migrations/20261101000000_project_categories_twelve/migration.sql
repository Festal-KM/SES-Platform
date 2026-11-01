-- ============================================================================
-- 案件のカテゴリを 12 値にする。2026-11-01。
-- 一次資料: 人間の明示指示（案件管理の検索バー「カテゴリのリスト値を下記に変更」）
-- ============================================================================
-- 旧（7 値）: BACKEND / FRONTEND / INFRA / AI / DATA / PM_PMO / HELPDESK
-- 新（12 値。画面の並び順）:
--   PM_PMO       PM/PMO/コンサルティング系   … 旧 PM_PMO の意味を広げた（コードは据え置き）
--   BACKEND      バックエンド系                … 据え置き
--   FRONTEND     フロントエンド系              … 据え置き
--   CLOUD        クラウド系                    … 新設（旧 INFRA の移送先）
--   NETWORK      ネットワーク系                … 新設
--   ON_PREMISES  オンプレミス系                … 新設
--   DATA_AI      データサイエンス/AI系         … 新設（旧 AI / DATA の移送先）
--   SECURITY     セキュリティ系                … 新設
--   OPERATIONS   運用保守系                    … 新設
--   HELPDESK     ヘルプデスク                  … 据え置き
--   SALES        営業系                        … 新設
--   OTHER        その他                        … 新設
--
-- 🔴 移送: INFRA → CLOUD / AI → DATA_AI / DATA → DATA_AI。
--    ⚠️ INFRA は クラウド / ネットワーク / オンプレミス のどれにも割れるが、行の中身から機械的には
--    決められない。既定でクラウド系に寄せる（案件の大半がクラウドであるため）。違う案件は編集画面で直す。
--    🔴 null（未設定）は null のまま（埋めない）。
--
-- 🔴 手順は `20261016010000_project_status_two_values` と同じ（HANDOFF §3.1 の 🔴🔴）:
--    FORCE 解除 → 旧 CHECK を外す → 移送 → 残存 0 件の検査（FORCE を戻す前）→ 新 CHECK → FORCE 復帰 → カタログ検査。
--    `app_migrator` は NOBYPASSRLS で `projects` は FORCE なので、FORCE を外さないと UPDATE が 0 行で「成功」する。
--    いずれも冪等（DROP IF EXISTS / 0 行の UPDATE は成功する）。
-- ============================================================================
ALTER TABLE projects NO FORCE ROW LEVEL SECURITY;

-- ① 旧 CHECK を外す（旧 CHECK は CLOUD / DATA_AI を許さない）
ALTER TABLE projects DROP CONSTRAINT IF EXISTS "projects_category_check";

-- ② 既存データの移送
UPDATE projects SET category = 'CLOUD' WHERE category = 'INFRA';
UPDATE projects SET category = 'DATA_AI' WHERE category IN ('AI', 'DATA');

-- ②' 🔴 残存 0 件の検査（FORCE を戻す前。戻した後では所有者にも 0 件に見える）
DO $$
DECLARE remaining bigint;
BEGIN
  SELECT count(*) INTO remaining FROM projects
   WHERE category IS NOT NULL
     AND category NOT IN ('PM_PMO', 'BACKEND', 'FRONTEND', 'CLOUD', 'NETWORK', 'ON_PREMISES', 'DATA_AI', 'SECURITY', 'OPERATIONS', 'HELPDESK', 'SALES', 'OTHER');
  IF remaining <> 0 THEN
    RAISE EXCEPTION 'projects.category の 12 値への移送が完了していません（残 % 行）', remaining;
  END IF;
END $$;

-- ③ CHECK を 12 値に再定義（null = 未設定は従来どおり許す）
ALTER TABLE projects
  ADD CONSTRAINT "projects_category_check"
  CHECK ("category" IN ('PM_PMO', 'BACKEND', 'FRONTEND', 'CLOUD', 'NETWORK', 'ON_PREMISES', 'DATA_AI', 'SECURITY', 'OPERATIONS', 'HELPDESK', 'SALES', 'OTHER'));

-- ④ FORCE を戻す（必ず。外したままだと所有者の接続から RLS が効かない）
ALTER TABLE projects FORCE ROW LEVEL SECURITY;

-- ⑤ 🔴 事後検査: RLS 有効なのに FORCE でない表が 1 つも無いこと
DO $$
DECLARE unforced text;
BEGIN
  SELECT string_agg(c.relname, ', ' ORDER BY c.relname) INTO unforced
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p')
     AND c.relrowsecurity AND NOT c.relforcerowsecurity;
  IF unforced IS NOT NULL THEN
    RAISE EXCEPTION 'FORCE ROW LEVEL SECURITY が戻っていない表があります: %', unforced;
  END IF;
END $$;

COMMENT ON COLUMN projects.category IS
  '案件のカテゴリ（S-010 の絞り込み・一覧の列）。null = 未設定。12 値（2026-11-01 の人間の指示。旧 INFRA → CLOUD / AI・DATA → DATA_AI に移送済み）。単一の出所は packages/db/src/schema-value-sets.ts の PROJECT_CATEGORIES';
