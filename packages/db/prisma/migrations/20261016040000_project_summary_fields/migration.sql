-- ============================================================================
-- 案件サマリ（`S-010` の副カラム）の「基本情報」に要る列を足す。2026-10-16。
-- 一次資料: 人間の明示指示（画像つき）
--   「・基本情報は、案件名、ステータス、エンド顧客、上位会社、カテゴリ、案件概要、
--     必須スキル（リスト）、尚可スキル（リスト）、単価（卸単価と公開単価）、
--     稼働形態（常駐、ハイブリッド、フルリモート、その他）、開始時期、終了時期、
--     募集人数、精算幅（140~180h など）、支払いサイト、商流、商流制限、担当者、更新日。
--    ・コピペ用サマリは、LINE やメールとかにそのままコピペできる形式のテキストにする。
--     案件登録時に生成されるが、情報がアップデート都度生成される。人が書き換えて保存も可能。」
--   承認: [Issue #113](https://github.com/Festal-KM/SES-Platform/issues/113)「設計から改訂して」
-- ============================================================================
-- 指示の 19 項目のうち、**DB 列が無くて描けなかった 8 つ**（精算幅は上下 2 列なので 9 列）を足す。
--
--   | 指示の項目        | 列                                              | 型 |
--   |------------------|-------------------------------------------------|----|
--   | 上位会社          | `projects.upper_company_name`                   | text |
--   | 終了時期          | `projects.end_date`                             | date |
--   | 精算幅（140〜180h）| `projects.settlement_min_hours` / `_max_hours`  | int |
--   | 支払いサイト       | `projects.payment_site_days`                    | int |
--   | 商流             | `projects.distribution`                          | text |
--   | 商流制限          | `projects.distribution_limit`                   | text |
--   | 担当者            | `projects.assignee_user_id`                     | uuid（FK users） |
--   | コピペ用サマリ本文 | `projects.copy_summary`                          | text |
--
-- 🔴🔴 **公開範囲の相手（取引先）に出してよいかは列ごとに違う**（`CLAUDE.md` §3.1 経路 1 /
--    `F-013 AC-2` / `BR-07`）。**出し分けはアプリ側の `select` を 2 本に分けることで行う**
--    （`apps/web/lib/projects/service.ts` の `HOST_PROJECT_DETAIL_SELECT` /
--     `PARTNER_PROJECT_DETAIL_SELECT`。取得後に隠す実装にしない）。
--    既定の割り当ては次のとおりで、**人間の判断を仰いでいる**（Issue を起票済み）:
--      - ホスト限定 … `upper_company_name` / `distribution` / `assignee_user_id` / `copy_summary`
--        （いずれも商流そのもの、またはホスト内部の作文である）
--      - 双方に出す  … `end_date` / `settlement_*` / `payment_site_days` / `distribution_limit`
--        （取引先が「提案してよいか」を判断するための条件そのものであり、隠すと判断できない）
-- 🔴 **すべて null 許容**（既存の案件には値が無い）。既定値を入れると「本当は未設定なのに
--    何か入っている」状態を作る（`category` / `job_title` と同じ扱い）。画面は「未設定」と出す。
--
-- 🔴 **GRANT を足す必要が無い。** `projects` は列レベルではなく表レベルで `app_tenant` に
--    GRANT されており、PostgreSQL の表レベル GRANT は**後から足した列にも及ぶ**。
-- 🔴 **データの書き換えが無いので FORCE ROW LEVEL SECURITY を触らない**
--    （`20261016010000` で踏んだ罠は「既存行を UPDATE する」ときのものである。
--     `ADD COLUMN` と新しい名前の `ADD CONSTRAINT` は RLS の影響を受けない）。

-- ----------------------------------------------------------------------------
-- ① 上位会社（🔴 ホスト限定。商流の一部である）
-- ----------------------------------------------------------------------------
ALTER TABLE projects ADD COLUMN IF NOT EXISTS upper_company_name text;

COMMENT ON COLUMN projects.upper_company_name IS
  '上位会社名（自社の 1 つ上の会社）。null = 未設定。2026-10-16。🔴 内部限定: 公開範囲の相手・LLM・運営者に出さない（CLAUDE.md §3.2 / §3.1 経路 1）';

-- ----------------------------------------------------------------------------
-- ② 終了時期（双方に出す。開始日と対になる条件である）
-- ----------------------------------------------------------------------------
ALTER TABLE projects ADD COLUMN IF NOT EXISTS end_date date;

COMMENT ON COLUMN projects.end_date IS
  '終了時期（稼働の終わりの目安）。null = 未定。2026-10-16。🔴 start_date との前後は service 層が検証する（境界の Zod は項目をまたいで判定しない）';

-- ----------------------------------------------------------------------------
-- ③ 精算幅（`140〜180h` の上下。双方に出す）
--    🔴 **2 列に分ける。** `'140~180h'` の 1 文字列にすると、検索も比較もできず、
--       表記ゆれ（`〜` / `~` / `-`）がそのまま蓄積する（単価レンジを 2 列にしたのと同じ理由）。
-- ----------------------------------------------------------------------------
ALTER TABLE projects ADD COLUMN IF NOT EXISTS settlement_min_hours integer;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS settlement_max_hours integer;

ALTER TABLE projects DROP CONSTRAINT IF EXISTS "projects_settlement_min_hours_check";
ALTER TABLE projects
  ADD CONSTRAINT "projects_settlement_min_hours_check"
  CHECK ("settlement_min_hours" IS NULL OR ("settlement_min_hours" >= 0 AND "settlement_min_hours" <= 744));

ALTER TABLE projects DROP CONSTRAINT IF EXISTS "projects_settlement_max_hours_check";
ALTER TABLE projects
  ADD CONSTRAINT "projects_settlement_max_hours_check"
  CHECK ("settlement_max_hours" IS NULL OR ("settlement_max_hours" >= 0 AND "settlement_max_hours" <= 744));

COMMENT ON COLUMN projects.settlement_min_hours IS
  '精算幅の下限（時間/月。例 140）。null = 未設定。2026-10-16。🔴 上限は 744（31 日 × 24h）= 1 か月の物理的な上限';
COMMENT ON COLUMN projects.settlement_max_hours IS
  '精算幅の上限（時間/月。例 180）。null = 未設定。2026-10-16';

-- ----------------------------------------------------------------------------
-- ④ 支払いサイト（日数。双方に出す）
--    🔴 **日数の整数にする。** `'月末締め翌月末払い'` の自由文にすると、締め日と支払日が
--       混ざって比較できない。表示の語は画面が組む（`30 日` / `60 日`）。
-- ----------------------------------------------------------------------------
ALTER TABLE projects ADD COLUMN IF NOT EXISTS payment_site_days integer;

ALTER TABLE projects DROP CONSTRAINT IF EXISTS "projects_payment_site_days_check";
ALTER TABLE projects
  ADD CONSTRAINT "projects_payment_site_days_check"
  CHECK ("payment_site_days" IS NULL OR ("payment_site_days" >= 0 AND "payment_site_days" <= 365));

COMMENT ON COLUMN projects.payment_site_days IS
  '支払いサイト（日数。例 30 / 45 / 60）。null = 未設定。2026-10-16';

-- ----------------------------------------------------------------------------
-- ⑤ 商流（🔴 ホスト限定）と商流制限（双方に出す）
--    🔴 **2 つは別物である。** `distribution` は「いま何次請けか」= 商流そのもの、
--       `distribution_limit` は「何次請けまで許すか」= 取引先が提案の可否を判断する条件である。
--       前者を取引先に出すと上流の構造が割れる（§3.1 経路 5 の 🔴 と同じ理由）。
-- ----------------------------------------------------------------------------
ALTER TABLE projects ADD COLUMN IF NOT EXISTS distribution text;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS distribution_limit text;

COMMENT ON COLUMN projects.distribution IS
  '商流（エンド → 元請 → … の実際の並び）。null = 未設定。2026-10-16。🔴 内部限定: 公開範囲の相手・LLM・運営者に出さない';
COMMENT ON COLUMN projects.distribution_limit IS
  '商流制限（何次請けまで許すか）。null = 未設定。2026-10-16。🔴 これは取引先に出す（提案してよいかの判断そのものであり、隠すと判断できない）';

-- ----------------------------------------------------------------------------
-- ⑥ 担当者（🔴 ホスト限定。ホスト社員の氏名に繋がる）
--    🔴 **FK を張る。** 自由文の氏名にすると、退職・改名のたびに案件側が古い名前を持ち続ける。
--    🔴 **`ON DELETE SET NULL`** —— 担当者のアカウントが消えても案件は残る（業務上、案件の
--       実体は担当者に依存しない）。`RESTRICT` にすると退職処理が案件の数だけ止まる。
--    ⚠️ **テナントをまたぐ指定は、書き込み時にアプリが母集団へ照合して防ぐ**
--       （docs/05 §6.4 #14 の条件②。`users` の RLS が `withTenant` の内側で効く）。
-- ----------------------------------------------------------------------------
ALTER TABLE projects ADD COLUMN IF NOT EXISTS assignee_user_id uuid;

ALTER TABLE projects DROP CONSTRAINT IF EXISTS "projects_assignee_user_id_fkey";
ALTER TABLE projects
  ADD CONSTRAINT "projects_assignee_user_id_fkey"
  FOREIGN KEY ("assignee_user_id") REFERENCES users("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX IF NOT EXISTS "projects_tenant_assignee_idx"
  ON projects ("tenant_id", "assignee_user_id");

COMMENT ON COLUMN projects.assignee_user_id IS
  '担当者（自社の営業）。null = 未設定。2026-10-16。🔴 内部限定: 公開範囲の相手に出さない（ホスト社員の氏名に繋がる）';

-- ----------------------------------------------------------------------------
-- ⑦ コピペ用サマリ本文（🔴 ホスト限定）
--    人間の指示「案件登録時に生成されるが、情報がアップデート都度生成される。
--    人が書き換えて保存も可能」。
--    🔴 **null は「まだ人が書き換えていない」を意味する。** そのときは画面が案件の値から
--       組んだ既定の文面を出す（`apps/web/lib/projects/copy-summary.ts`）——
--       **登録のたびに同じ文面を行に焼き付けない**（焼き付けると、案件を直しても
--       サマリだけ古いまま残り、どちらが正しいか誰も判断できなくなる）。
--    🔴 **ホスト限定である。** 中身は商流情報（エンド顧客・卸単価・上位会社）を含みうる
--       ホストの作文であり、取引先に出す面に載せない。
-- ----------------------------------------------------------------------------
ALTER TABLE projects ADD COLUMN IF NOT EXISTS copy_summary text;

COMMENT ON COLUMN projects.copy_summary IS
  'コピペ用サマリの本文（人が書き換えたときだけ入る）。null = 未編集（画面が案件の値から組む）。2026-10-16。🔴 内部限定: 公開範囲の相手・LLM・運営者に出さない';
