-- ============================================================================
-- T-07-11 スケジュールジョブのテナントファンアウト（docs/05 §9.1 / §4.2 / §4.4.2）
-- ============================================================================
-- 本 migration が置くのは 1 つだけである:
--   専用ロール `app_scheduler_probe` + SECURITY DEFINER 関数 `app_list_scheduler_tenants()`
--   —— スケジュールジョブが「どのテナントへ配るか」を決めるための、**テナント ID 1 列だけ**の
--   限定経路。
--
-- ============================================================================
-- 🔴 判断事項 1: なぜ限定経路が要るのか
-- ============================================================================
-- docs/05 §9.1 は「payload に `tenantId` を必ず含め、ハンドラ冒頭で `withTenant` の ctx を
-- 組み立てる」と定める。ジョブ本体はテナント文脈（`systemTenantCtx`）に閉じるので RLS は効くが、
-- **その手前の「テナントの列挙」だけはテナント文脈を持てない**（どのテナントかを決める処理で
-- あるため）。既存のテナント文脈なし経路（§4.4.2）はどれも使えない:
--   - `withSystemScope()` … C0 SYSTEM_ONLY の 4 表だけで `tenants` を含まない
--   - `withPlatformRead()` … 運営者の操作であり `AuthenticatedPlatformCtx` と
--     `AuditLog` の記録を伴う（10 分ごとのジョブが運営者の監査ログを埋める形になる）
--   - 行由来コンテキスト … 資格情報（トークン / メール）から 1 行を引く経路であり列挙ではない
--
-- ============================================================================
-- 🔴 判断事項 2: なぜ「専用ロール + SECURITY DEFINER」なのか（§4.5 / §4.4.1 / §8.5 と同型）
-- ============================================================================
-- `CLAUDE.md` §10.5 は「分離のバイパスは専用の DB ロール経由に限定し、汎用のエスケープハッチを
-- 作らない」と定める。本リポジトリには同型の先例が 3 つある（`app_share_probe` /
-- `app_assignment_owner_probe` / `app_scan_probe`）。同じ形を採る:
--   - 専用ロール `app_scheduler_probe`（NOLOGIN / NOBYPASSRLS。`000_roles.sql`）
--   - `tenants` の **`id` / `lifecycle_state` の 2 列だけ**を列レベル GRANT
--   - 返すのは **`setof uuid`（テナント ID の集合）だけ**である。テナント名も環境も返さない
--   - 🔴 本体で **`app_tenant_id() IS NOT NULL` を拒否**する（fail-closed）。通常の
--     `withTenant` 文脈（= HTTP リクエスト経路）からは 1 行も返らない
--   - 🔴 加えて `app.scheduler_scope = 'on'` を要求する。この GUC を立てるのは
--     `packages/db/src/scheduler-fanout.ts` の 1 関数だけである
--
-- ============================================================================
-- 🔴 判断事項 3: 母集団から `SUSPENDED` / `CLOSING` / `PURGED` を外す
-- ============================================================================
-- （SP-07 §4 T-07-11 / docs/05 §11.12 ⑩-1 の申し送り 1 への回答。理由は docs/05 §9.1 に記録）
--   - `CLAUDE.md` §4.2: **`SUSPENDED` では実行系（提案の送信・承認・契約書の送付）が一切できない。**
--     保留ゲートの自動復帰（`gate.hold-release` → `gate.run`）は LLM を呼び AI 原価を消費する
--     ため、停止中のテナントで走らせるのは §3.4 のコスト上限の趣旨に反する
--   - `CLOSING` は新規作成ができずエクスポートのみ。`PURGED` は終端（個人情報は削除済み）
--   - 🔴 `SANDBOX` は**含める**。試用中のテナントは実データで本番同等に動く環境であり
--     （`CLAUDE.md` §11 / §4.2）、ここを外すと「試用中だけ満了アラートもゲート復帰も来ない」
--     という、試用の目的そのものを損なう差分が生まれる
-- 🔴 母集団の条件は**この SQL 1 箇所**にある（アプリ側に `where` を書かない）。2 箇所に書くと、
--    片方だけが更新されて「停止中テナントに配り続ける」状態が静かに残る。

-- ============================================================================
-- 1. app_scheduler_probe への最小 GRANT
-- ============================================================================
GRANT USAGE ON SCHEMA public TO app_scheduler_probe;

-- 🔴 2 列だけ。ここに列を足すことは「テナントの属性がジョブ経路から読める」ことを意味する。
GRANT SELECT (id, lifecycle_state) ON tenants TO app_scheduler_probe;

-- 🔴 ポリシーも fail-closed にする（関数本体の判定と二重）。
--    通常の `withTenant` 文脈は `app.tenant_id` を必ず立てるため、`app_tenant_id() IS NULL` は偽になる。
DROP POLICY IF EXISTS tenants_scheduler_probe_select ON tenants;
CREATE POLICY tenants_scheduler_probe_select ON tenants FOR SELECT TO app_scheduler_probe
  USING (
    app_tenant_id() IS NULL
    AND current_setting('app.scheduler_scope', true) = 'on'
  );

-- 🔴 ALTER FUNCTION ... OWNER TO は「新オーナーが対象スキーマに CREATE 権限を持つ」ことを
--    要求する（PostgreSQL の仕様）。**実行時にだけ**付与し、直後に剥がす
--    （境界バイパスロールにスキーマ作成権を常置しない。migration 20260908000000 と同じ）。
GRANT CREATE ON SCHEMA public TO app_scheduler_probe;

-- ============================================================================
-- 2. app_list_scheduler_tenants: ファンアウトの母集団
-- ============================================================================
CREATE FUNCTION app_list_scheduler_tenants() RETURNS SETOF uuid
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $BODY$
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

  RETURN QUERY
    SELECT t.id
      FROM tenants t
     -- 🔴 判断事項 3。停止・解約・削除済みのテナントには配らない。
     WHERE t.lifecycle_state IN ('SANDBOX', 'ACTIVE')
     ORDER BY t.id ASC;
END;
$BODY$;
ALTER FUNCTION app_list_scheduler_tenants() OWNER TO app_scheduler_probe;

-- 🔴 CREATE は上の ALTER FUNCTION のときにしか要らない。直ちに剥がす。
REVOKE CREATE ON SCHEMA public FROM app_scheduler_probe;

-- 🔴 CREATE FUNCTION が既定で PUBLIC に付与する EXECUTE を剥がし、app_tenant にだけ与える
--    （§4.5 の `app_engineer_is_shared` / §8.5 の `app_apply_scan_status` と同じ規律）。
--    app_platform / app_platform_write には与えない（運営者コンソールはジョブを起動しない）。
REVOKE ALL ON FUNCTION app_list_scheduler_tenants() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_list_scheduler_tenants() TO app_tenant;

COMMENT ON FUNCTION app_list_scheduler_tenants() IS
  'T-07-11: スケジュールジョブのテナントファンアウトの母集団（docs/05 §9.1）。呼び出し元は packages/db/src/scheduler-fanout.ts のみ。';
