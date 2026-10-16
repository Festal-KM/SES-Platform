-- ============================================================================
-- 案件の状態を 2 値（募集中 / 終了）にする。2026-10-16。
-- 一次資料: 人間の明示指示（Issue #98 への回答「募集中と終了の二つだけでよい」）
-- ============================================================================
-- 旧: 'OPEN'（募集中） / 'FILLED'（充足） / 'SUCCESSOR_WANTED'（後任募集）
-- 新: 'OPEN'（募集中） / 'CLOSED'（終了）
--
-- 🔴 移送の方針は「まだ募集しているか」の一点で分ける:
--      SUCCESSOR_WANTED → OPEN    … 後任を募集している最中なので募集中である
--      FILLED           → CLOSED  … もう募集していない
--    ⚠️ `充足`（枠は埋まった）と `終了`（案件そのものが終わった）は本来別の事実だが、
--    2 値では「もう募集していない」が 1 つしか無い。営業の判断に要るのは**出せるか出せないか**
--    であり、人間の指示が「二つだけでよい」である。
--
-- 🔴 **`F-045` の還流（CLAUDE.md §1.3 の ⑥ → ①）は 1 行も壊れない。** 還流で起こした案件は
--    `origin_assignment_id`（生成元の稼働）を持ち続け、**後任募集であるという事実は列に残る**。
--    消えたのは「状態として区別して色を付けること」だけである。区別が要る日が来たら
--    `origin_assignment_id` から導出する（状態を 3 つ目に増やして戻さない）。
--
-- 🔴 **順序に意味がある。** CHECK を張り替える前に UPDATE を済ませる（旧値が残っていると
--    ADD CONSTRAINT が失敗する）。UPDATE は冪等である（対象が 0 行でも成功する）。
-- 🔴 **`ORDER BY status DESC` に依存した一覧の並びはそのまま成立する**
--    （'OPEN' > 'CLOSED' なので募集中が先・終了が後。`PROJECT_STATUS_LIST_PRIORITY` と
--    その `assertStatusPriority` が TS 側で照合する）。

-- ----------------------------------------------------------------------------
-- 🔴 2026-10-16 修正（デモ環境で失敗した原因と直し方）
--    ① `app_migrator` は NOBYPASSRLS かつ `projects` は FORCE ROW LEVEL SECURITY のため、テナント文脈の無い
--       マイグレーションでは UPDATE が **0 行** にしか当たらない（CI は空の DB に適用するので気づけない）。
--       旧値の行が移送されないまま ADD CONSTRAINT が走り、`projects_status_check ... violated by some row` で失敗した。
--       → FORCE を一時的に外す（`20260911000000_partner_composite_fk` の手順 0 / 5 と同じ作法。ENABLE は外さない）。
--    ② 旧 CHECK（OPEN / FILLED / SUCCESSOR_WANTED）が残ったまま `CLOSED` に UPDATE すると、旧 CHECK に反して失敗する。
--       → 旧 CHECK を先に外し、移送してから新 CHECK を張る。
--    いずれの手順も冪等（DROP IF EXISTS / 0 行の UPDATE は成功する）なので、途中で失敗した DB にもう一度流してよい。
-- ----------------------------------------------------------------------------
ALTER TABLE projects NO FORCE ROW LEVEL SECURITY;

-- ----------------------------------------------------------------------------
-- ① 旧 CHECK を外す（移送の前に。旧 CHECK は `CLOSED` を許さない）
--    🔴 同名 CHECK の再定義であり、`tests/static/schema-enum-drift.test.ts` の
--       `REDEFINED_CHECK_CONSTRAINTS` に件数と理由を登録してある（最後の定義を採る）。
-- ----------------------------------------------------------------------------
ALTER TABLE projects DROP CONSTRAINT IF EXISTS "projects_status_check";

-- ----------------------------------------------------------------------------
-- ② 既存データの移送
-- ----------------------------------------------------------------------------
UPDATE projects SET status = 'OPEN' WHERE status = 'SUCCESSOR_WANTED';
UPDATE projects SET status = 'CLOSED' WHERE status = 'FILLED';

-- ----------------------------------------------------------------------------
-- ③ CHECK を 2 値に再定義
-- ----------------------------------------------------------------------------
ALTER TABLE projects
  ADD CONSTRAINT "projects_status_check" CHECK ("status" IN ('OPEN', 'CLOSED'));

-- ④ FORCE を戻す（必ず。ここを外すと所有者の接続から RLS が効かなくなる）
ALTER TABLE projects FORCE ROW LEVEL SECURITY;

COMMENT ON COLUMN projects.status IS
  '案件の状態。OPEN（募集中）/ CLOSED（終了）の 2 値（2026-10-16。Issue #98 の回答「募集中と終了の二つだけでよい」）。単一の出所は packages/db/src/schema-value-sets.ts の PROJECT_STATUSES。旧 3 値（FILLED / SUCCESSOR_WANTED）は本 migration で移送済み。後任募集であるという事実は origin_assignment_id に残る';
