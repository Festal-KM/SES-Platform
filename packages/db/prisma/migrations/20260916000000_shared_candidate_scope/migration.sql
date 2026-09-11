-- ============================================================================
-- T-08-03 共有スコープ読み取り（越境経路 4 の DB 側実装）。docs/05 §4.5 / P-A-14
-- ============================================================================
-- 本 migration が置くのは 1 つだけである:
--   専用ロール `app_share_probe` + SECURITY DEFINER 関数 `app_engineer_is_shared()` と、
--   それを述語に使う `engineers` / `engineer_skills` の**追加 SELECT ポリシー 2 本**。
--
-- 🔴 **越境経路は増えていない。** `CLAUDE.md` §3.1 の経路 4（匿名共有）は SP-02 の時点で
--    `engineer_shares`（C3）として存在しており、本 migration はその**読み取り側の実装を
--    確定させただけ**である（P-A-14）。
--
-- ============================================================================
-- 🔴 判断事項 1: なぜ `engineer_shares` にホスト向けの SELECT ポリシーを足さないのか
-- ============================================================================
-- 代替案（`engineer_shares` に `FOR SELECT TO app_tenant USING (tenant_id = app_tenant_id()
-- AND app_is_host())` を足す）は **`BR-06` に抵触するため退けた**（docs/05 `P-A-14`）:
-- 行が読めるということは `partner_company_id`（どの取引先が共有しているか）と `shared_by`
-- （誰が共有したか）がホストに見えるということであり、**匿名候補の身元がその場で割れる**。
-- 🔴 ホストが得てよいのは**存在の真偽だけ**である。したがって存在判定を SECURITY DEFINER
--    関数に閉じ、ホストのセッションには boolean しか返らない形にする。
--
-- ============================================================================
-- 🔴 判断事項 2: なぜ `EXISTS (SELECT … FROM engineer_shares)` をポリシー式に直接書けないのか
-- ============================================================================
-- `engineer_shares` は **C3 OWNER_SCOPED**（`tenant_id = app_tenant_id() AND
-- partner_company_id IS NOT DISTINCT FROM app_partner_id()`）であり、ホスト文脈では
-- `app_partner_id()` が NULL なので `partner_company_id IS NOT DISTINCT FROM NULL` が常に偽になる。
-- **副問い合わせの内側の表にも RLS が効く**ため（docs/03 §4.3.2）、素直に書くと EXISTS が
-- 必ず 0 件になり、共有スコープが「常に何も見えない」機能になる。
-- SECURITY DEFINER（所有者 = `app_share_probe`）にすることで、内側の `engineer_shares` の
-- 読み取りだけが専用ロールのポリシー（下記 `engineer_shares_share_probe_select`）で評価される。
--
-- ============================================================================
-- 🔴 判断事項 3: 二重の fail-closed（`app_share_probe` / `app_scan_probe` / `app_scheduler_probe` と同型）
-- ============================================================================
--   ①関数本体が `app.shared_scope = 'on'` と `app_is_host()` の**両方**を要求する
--     （どちらか一方でも欠けたら false。`withTenant` は毎回 `app.shared_scope = 'off'` を
--      発行するので、通常のリクエスト経路からは 1 行も増えない。docs/05 §4.7 #6）
--   ②`app_share_probe` 側のポリシーも `tenant_id = app_tenant_id() AND revoked_at IS NULL`
--     で絞る（関数本体の `WHERE` と二重。片方が消えてももう片方が止める）
--   ③ロールの権限は **`engineer_shares` の 3 列の SELECT だけ**である（列レベル GRANT。
--     docs/05 §4.7 #10。他表には USAGE 以外の権限を 1 つも持たない）
--
-- ============================================================================
-- 🔴 判断事項 4: 述語は `revoked_at IS NULL` だけである（Issue #49。暫定 = 既定 A）
-- ============================================================================
-- **停止中（`SUSPENDED` / `CLOSING`）のテナントに属するパートナーは共有を解除できない**
-- （`PUT /api/engineers/{id}/share` が `requireExecutable()` を通すため。docs/05 §17.2 #7）。
-- したがって「停止中のパートナーの候補がホストに出続け、かつ本人は下ろせない」組み合わせが
-- 実在しうる。**暫定。[Issue #49](https://github.com/Festal-KM/SES-Platform/issues/49) で確認中**
-- であり、既定 A（現状維持 = docs/05 §4.5 の述語どおり）で実装している。
-- 🔴 回答が C（停止中は自動的に無効化）になった場合、**変更点はこの関数の述語 1 箇所だけ**である
--    （`AND EXISTS (SELECT 1 FROM tenants … lifecycle_state IN ('SANDBOX','ACTIVE'))` を足す）。
--    呼び出し側・ポリシー・型は変わらない。**判定を関数の外（アプリの `if`）へ持ち出さないこと。**

-- ============================================================================
-- 1. app_share_probe への最小 GRANT（docs/05 §4.2 / §4.7 #10）
-- ============================================================================
GRANT USAGE ON SCHEMA public TO app_share_probe;

-- 🔴 3 列だけ。ここに列を足すことは「共有元（partner_company_id / shared_by）が
--    SECURITY DEFINER 関数から読める」ことを意味し、判断事項 1 の前提が崩れる。
GRANT SELECT (tenant_id, engineer_id, revoked_at) ON engineer_shares TO app_share_probe;

-- 🔴 app_tenant_id() を参照する（docs/05 §4.7 テスト #3 と同じ規律）。
DROP POLICY IF EXISTS engineer_shares_share_probe_select ON engineer_shares;
CREATE POLICY engineer_shares_share_probe_select ON engineer_shares FOR SELECT TO app_share_probe
  USING (tenant_id = app_tenant_id() AND revoked_at IS NULL);

-- 🔴 `ALTER FUNCTION ... OWNER TO` は「新オーナーが対象スキーマに CREATE 権限を持つ」ことを
--    要求する（PostgreSQL の仕様）。**実行時にだけ**付与し、直後に剥がす
--    （境界バイパスロールにスキーマ作成権を常置しない。migration 20260908000000 / 20260915000000 と同じ）。
GRANT CREATE ON SCHEMA public TO app_share_probe;

-- ============================================================================
-- 2. app_engineer_is_shared: 存在の真偽だけを返す（行は 1 つも返らない）
-- ============================================================================
-- 🔴 引数は `(engineer_id, tenant_id)` の 2 つだけであり、表名・列名を受け取らない。
--    「ホストが読みたいものを読める関数」ではなく、**1 つの問いに boolean で答える関数**である
--    （`CLAUDE.md` §10.5「汎用のエスケープハッチを作らない」）。
-- 🔴 SECURITY DEFINER の SQL 関数は PostgreSQL がインライン展開しない。したがって内側の
--    `engineer_shares` は必ず app_share_probe の権限・ポリシーで評価される。
CREATE FUNCTION app_engineer_is_shared(eng uuid, t uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $BODY$
  -- 🔴 COALESCE で NULL（GUC 未設定）を 'off' に畳む。ポリシーの USING では NULL も偽として
  --    扱われるが、関数の戻り値としても NULL を出さない（呼び出し側が `IS TRUE` を書き忘れても
  --    「共有されている」に化けない）。
  SELECT COALESCE(current_setting('app.shared_scope', true), 'off') = 'on'
     AND app_is_host()
     AND EXISTS (
           SELECT 1
             FROM engineer_shares s
            WHERE s.tenant_id = t
              AND s.engineer_id = eng
              AND s.revoked_at IS NULL)   -- 🔴 判断事項 4（Issue #49。暫定 = 既定 A）
$BODY$;
ALTER FUNCTION app_engineer_is_shared(uuid, uuid) OWNER TO app_share_probe;

-- 🔴 CREATE は上の ALTER FUNCTION のときにしか要らない。直ちに剥がす。
REVOKE CREATE ON SCHEMA public FROM app_share_probe;

-- 🔴 CREATE FUNCTION が既定で PUBLIC に付与する EXECUTE を剥がし、app_tenant にだけ与える。
--    app_platform / app_platform_write には与えない —— 運営者はエンジニアの台帳を読まない
--    （`CLAUDE.md` §10.5「運営者にも見せないもの」）。
REVOKE ALL ON FUNCTION app_engineer_is_shared(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_engineer_is_shared(uuid, uuid) TO app_tenant;

COMMENT ON FUNCTION app_engineer_is_shared(uuid, uuid) IS
  'T-08-03: 越境経路 4 の存在判定（docs/05 §4.5 / P-A-14）。行ではなく真偽だけを返す。呼び出し元は engineers / engineer_skills の shared_candidate_read ポリシーのみ。';

-- ============================================================================
-- 3. 共有スコープの追加 SELECT ポリシー（🔴 2 表だけ。docs/05 §4.7 テスト #15）
-- ============================================================================
-- 🔴 C3 のポリシーと **OR** で結合される（PostgreSQL は同一コマンドの複数 PERMISSIVE ポリシーを
--    OR で合成する）。したがって `app.shared_scope = 'off'` の通常経路では C3 のままである。
-- 🔴 **この 2 表以外に同型のポリシーを書かない。** `engineer_careers`（T-09-12）を含め、
--    1 表足した瞬間に「経路 4 の開示項目を増やした」ことになる（`CLAUDE.md` §8.6 = 人間の承認事項）。
--    回帰は `tests/isolation/rls-enforced.test.ts` の #15（カタログ走査）が固定する。
DROP POLICY IF EXISTS engineers_shared_candidate_read ON engineers;
CREATE POLICY engineers_shared_candidate_read ON engineers FOR SELECT TO app_tenant
  USING (
    tenant_id = app_tenant_id()
    AND app_engineer_is_shared(engineers.id, engineers.tenant_id)
  );

-- 🔴 親（engineers）と同じ述語を、子の `engineer_id` で引く。
--    スキルは匿名 5 項目の 1 つ（辞書の正規化済み名称。A-04 ①）であり、候補の生成に要る。
DROP POLICY IF EXISTS engineer_skills_shared_candidate_read ON engineer_skills;
CREATE POLICY engineer_skills_shared_candidate_read ON engineer_skills FOR SELECT TO app_tenant
  USING (
    tenant_id = app_tenant_id()
    AND app_engineer_is_shared(engineer_skills.engineer_id, engineer_skills.tenant_id)
  );
