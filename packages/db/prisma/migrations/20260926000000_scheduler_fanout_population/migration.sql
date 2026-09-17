-- ============================================================================
-- T-10-12 スケジュールジョブのテナントファンアウトに「母集団」の引数を足す（docs/05 §9.1.1 ③ / §4.4.2 / §9.7）
-- ============================================================================
-- 本 migration が置くのは 1 つだけである:
--   `app_list_scheduler_tenants()`（migration 20260915000000）を **`app_list_scheduler_tenants(p_population text
--   DEFAULT 'LIVE')`** に置き換える。既定の `'LIVE'`（= `SANDBOX` / `ACTIVE`。従来どおり）に加えて、
--   `'CLOSING'`（= `CLOSING` だけ）を選べるようにする。
--
-- ============================================================================
-- 🔴 判断事項 1: なぜ引数なのか（新しい関数・新しいロール・新しい GUC を作らない）
-- ============================================================================
-- docs/05 §9.7 の `tenant.closing-notify`（削除予告。`F-064 AC-10`）と `tenant.purge-scan`（T-10-09）は
-- **`lifecycle_state='CLOSING'` のテナント**を対象にする。しかし 20260915000000 の母集団は `SANDBOX` / `ACTIVE`
-- だけであり（判断事項 3。停止・解約・削除済みに AI 原価を使うジョブを配らない）、`CLOSING` のテナントは
-- **どのスケジュールジョブにも配られない**。予告は「解約中のテナントの管理者へ削除予定日を知らせる」ことが
-- 目的であり、ここに配れなければ `F-064 AC-10`（予告なしの削除を成立させない）は**予告が永久に出ない**形で
-- 破れる（削除も進まないので事故にはならないが、解約したテナントのデータが消せない）。
--
-- docs/05 §4.4.2 は「テナント文脈を持たない経路をこれ以外に作らない」と定める。したがって
--   - 別関数（`app_list_closing_tenants()`）を足さない —— 一覧に経路が 1 本増える
--   - `withPlatformRead` を使わない —— 運営者の操作であり `AuditLog` を伴う（判断事項 1 のとおり）
--   - アプリ側で `tenants` を読んで絞らない —— 条件が SQL の外へ漏れる（判断事項 3 の 🔴）
-- のいずれも採らず、**同じ関数・同じ所有者（`app_scheduler_probe`）・同じ 2 列の GRANT・同じ 2 つの fail-closed**
-- のまま、母集団を引数で選ぶ。§4.4.2 の一覧に載る経路は 1 本のままである。
--
-- ============================================================================
-- 🔴 判断事項 2: 母集団は 2 値の列挙であり、状態の配列を受け取らない
-- ============================================================================
-- `p_population` は `'LIVE'` / `'CLOSING'` の 2 値だけを受け付け、それ以外は**例外**にする（0 件で誤魔化さない。
-- 20260915000000 の fail-closed その 2 と同じ理由）。`text[]` で任意の状態集合を渡せる形にすると、
-- 呼び出し側が `SUSPENDED` を含めて配る（= 停止中のテナントで LLM を呼ぶ）コードを書けてしまう。
-- 🔴 母集団の**条件**（どの状態が `LIVE` か）は引き続き **この SQL 1 箇所**にある。
--
-- ============================================================================
-- 🔴 判断事項 3: 既定値 `'LIVE'` を持たせる
-- ============================================================================
-- 既存の呼び出し（`SELECT app_list_scheduler_tenants()`）と既存の結合テストがそのまま従来の母集団を得る。
-- `CLOSING` へ配るジョブ（`tenant.closing-notify` / `tenant.purge-scan`）だけが宣言で母集団を明示する
-- （`apps/worker/src/jobs/index.ts` の `ScheduledJobDeclaration.population`）。

-- 🔴 引数を変えるので DROP → CREATE（`CREATE OR REPLACE` は引数の異なる関数を置き換えられない）。
DROP FUNCTION IF EXISTS app_list_scheduler_tenants();

-- 🔴 ALTER FUNCTION ... OWNER TO は「新オーナーが対象スキーマに CREATE 権限を持つ」ことを要求する
--    （PostgreSQL の仕様）。**実行時にだけ**付与し、直後に剥がす（20260915000000 と同じ）。
GRANT CREATE ON SCHEMA public TO app_scheduler_probe;

CREATE FUNCTION app_list_scheduler_tenants(p_population text DEFAULT 'LIVE') RETURNS SETOF uuid
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $BODY$
BEGIN
  -- 🔴 fail-closed その 1: テナント文脈がある接続（= HTTP リクエスト経路）からは使わせない。
  IF app_tenant_id() IS NOT NULL THEN
    RAISE EXCEPTION 'app_list_scheduler_tenants: テナント文脈からは呼べません（docs/05 §4.4.2）';
  END IF;
  -- 🔴 fail-closed その 2: スケジューラ以外の「テナント文脈なし」経路（Webhook 受信など）から
  --    誤って呼ばれても 0 件ではなく例外にする（0 件だと「テナントが 1 つも無い」と区別できない）。
  IF current_setting('app.scheduler_scope', true) IS DISTINCT FROM 'on' THEN
    RAISE EXCEPTION 'app_list_scheduler_tenants: app.scheduler_scope が on ではありません';
  END IF;

  IF p_population = 'LIVE' THEN
    -- 20260915000000 の判断事項 3。停止・解約・削除済みのテナントには配らない。
    RETURN QUERY
      SELECT t.id FROM tenants t
       WHERE t.lifecycle_state IN ('SANDBOX', 'ACTIVE')
       ORDER BY t.id ASC;
  ELSIF p_population = 'CLOSING' THEN
    -- 🔴 T-10-12（docs/05 §9.7）。解約手続き中のテナント**だけ**。削除予告と削除の走査がここへ配る。
    --    `SUSPENDED` / `PURGED` は含めない（停止中は予告の対象ではなく、削除済みは終端）。
    RETURN QUERY
      SELECT t.id FROM tenants t
       WHERE t.lifecycle_state = 'CLOSING'
       ORDER BY t.id ASC;
  ELSE
    -- 🔴 fail-closed その 3: 未知の母集団は例外（判断事項 2）。
    RAISE EXCEPTION 'app_list_scheduler_tenants: 未知の母集団です（%）', p_population;
  END IF;
END;
$BODY$;
ALTER FUNCTION app_list_scheduler_tenants(text) OWNER TO app_scheduler_probe;

-- 🔴 CREATE は上の ALTER FUNCTION のときにしか要らない。直ちに剥がす。
REVOKE CREATE ON SCHEMA public FROM app_scheduler_probe;

-- 🔴 CREATE FUNCTION が既定で PUBLIC に付与する EXECUTE を剥がし、app_tenant にだけ与える（20260915000000 と同じ）。
REVOKE ALL ON FUNCTION app_list_scheduler_tenants(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_list_scheduler_tenants(text) TO app_tenant;

COMMENT ON FUNCTION app_list_scheduler_tenants(text) IS
  'T-07-11 / T-10-12: スケジュールジョブのテナントファンアウトの母集団（docs/05 §9.1.1 ③）。p_population = LIVE（SANDBOX / ACTIVE。既定）| CLOSING。呼び出し元は packages/db/src/scheduler-fanout.ts のみ。';
