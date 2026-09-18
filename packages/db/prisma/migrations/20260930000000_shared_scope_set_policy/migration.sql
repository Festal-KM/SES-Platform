-- ============================================================================
-- T-12-19 共有スコープ RLS の集合化（越境経路 4 の読み取り側の性能是正）。
-- docs/05 §4.5 / §17.3「T-12-02 の実測の決着」(a) / SP-12 T-12-19 / Issue #71（既定 A）
-- ============================================================================
-- 🔴 本 migration は **開示範囲を 1 ミリも変えない。** 変えるのは「共有中か」の判定の**評価方法**
--    （1 行ごとの関数呼び出し → 1 文 1 回の集合評価）だけであり、**誰が・いつ・何を読めるか**は
--    migration 20260916000000 のままである:
--      - 読めるのはホスト（`app_is_host()`）だけ、`app.shared_scope = 'on'` のときだけ
--      - 共有中（`revoked_at IS NULL`）の行だけ（Issue #49 の暫定 = 既定 A も不変）
--      - `app_share_probe` が読めるのは `engineer_shares` の 3 列（tenant_id / engineer_id / revoked_at）だけ
--      - 共有スコープの追加ポリシーは `engineers` / `engineer_skills` の 2 表だけ
--    回帰は `tests/isolation/rls-enforced.test.ts` #10 / #15 / #17、`double-defense-matrix` #6 / #7、
--    `engineer-shares`（解除の即時反映）、`anonymous-candidate-view`（匿名 5 項目のみ）、
--    `shared-candidate-scope`（一時表で本体を隠せない / GUC・文脈の 3 条件）が**無改変のまま**固定する。
--
-- ============================================================================
-- 🔴 なぜ集合化するか（T-12-02 の実測。docs/05 §17.3）
-- ============================================================================
-- `engineers_shared_candidate_read` / `engineer_skills_shared_candidate_read` は述語に
-- `app_engineer_is_shared(id, tenant_id)` を持ち、SECURITY DEFINER の SQL 関数は PostgreSQL が
-- インライン展開しないため **1 行ごとに関数を呼ぶ**（`engineer_skills` 10,928 行で
-- `Buffers: shared hit=33113`、DB 時間 0.24〜0.57 秒）。索引は既に効いており、時間は関数呼び出しに消えている。
-- 述語を `id IN (SELECT unnest(app_shared_engineer_ids(app_tenant_id())))` にすると、副問い合わせが
-- 行に相関しないため実行計画が **hashed SubPlan** になり、関数は 1 文につき 1 回だけ評価される
-- （使い捨て実験: `engineers` 126 → 6 ms / `engineer_skills` 243 → 18 ms、`Buffers` 33,113 → 358）。
--
-- ============================================================================
-- 🔴 判断事項 1: 新関数が返すのは「共有中エンジニアの ID の配列」だけである
-- ============================================================================
-- `app_shared_engineer_ids(t)` は `engineer_shares` の `engineer_id` だけを配列にして返す。
-- 共有元（`partner_company_id` / `shared_by`）は**読まない**（`app_share_probe` の列 GRANT は
-- 20260916000000 の 3 列のまま。本 migration は GRANT に触れない）。配列で返しても「共有元でフィルタする
-- 述語」は書けない —— 共有元の列そのものを読めないためである（`BR-06`）。
-- 返る ID は、`app.shared_scope = 'on'` のホストが `engineers` のポリシー越しに既に読める行の ID であり、
-- 新しい情報を 1 つも加えない。
--
-- ============================================================================
-- 🔴 判断事項 2: `app_engineer_is_shared(uuid, uuid)` は DROP せず、本体を新関数へ寄せる
-- ============================================================================
-- 結合テスト（`rls-enforced` #15 / #17、`shared-candidate-scope`）は関数の存在・EXECUTE 権限・所有者・
-- `search_path` と、関数を直接呼んだときの真偽を固定している。**同じ意味を 2 つの実装で持たない**ために、
-- 本体を `eng = ANY(app_shared_engineer_ids(t))` に書き換えて 1 実装に寄せる（`CREATE OR REPLACE` は
-- 所有者と権限を変えない。`SET search_path = public, pg_temp` は定義に含めないと消えるので**再指定する**）。
--
-- ============================================================================
-- 🔴 判断事項 3: GUC の guard をポリシー本文にも明示する
-- ============================================================================
-- 関数本体が `'on'` を要求するので意味上は不要だが、①`rls-enforced` #15 は「式に `app_engineer_is_shared`
-- か `shared_scope` を含むポリシー」を走査して 2 本ちょうどを要求する（明示しないと集合が空になり落ちる）
-- ②`'off'` の通常経路（`withTenant` の全リクエスト）では関数を呼ぶ前に短絡でき、hashed SubPlan の
-- 初期化すら起きない —— の 2 点から本文に置く。
-- 🔴 `unnest(app_shared_engineer_ids(app_tenant_id()))` の引数を行に相関させない
--    （`engineers.tenant_id` を渡すと行ごとの再評価に戻る。同じ述語に `tenant_id = app_tenant_id()` が
--     あるので意味は同一である）。
--
-- ============================================================================
-- 🔴 判断事項 4: fail-closed（20260916000000 の判断事項 3 と同型）
-- ============================================================================
--   ①関数本体が `app.shared_scope = 'on'` と `app_is_host()` の**両方**を要求する。どちらか一方でも欠けたら
--     `'{}'::uuid[]`（空配列。**NULL を返さない** —— `IN (SELECT unnest(NULL))` は 0 行で偽になるが、
--     関数の契約としても「共有されている」に化ける余地を残さない）
--   ②`app_share_probe` 側のポリシー `engineer_shares_share_probe_select`（`tenant_id = app_tenant_id()
--     AND revoked_at IS NULL`）は不変。関数本体の `WHERE` と二重
--   ③`SET search_path = public, pg_temp`（migration 20260918010000 の規律。`rls-enforced` #17 が走査）

-- ============================================================================
-- 1. app_shared_engineer_ids: 共有中エンジニアの ID の配列（行は 1 つも返らない）
-- ============================================================================
-- 🔴 `ALTER FUNCTION ... OWNER TO` は「新オーナーが対象スキーマに CREATE 権限を持つ」ことを要求する。
--    **実行時にだけ**付与し、直後に剥がす（20260916000000 と同じ手順）。
GRANT CREATE ON SCHEMA public TO app_share_probe;

CREATE FUNCTION app_shared_engineer_ids(t uuid) RETURNS uuid[]
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $BODY$
  -- 🔴 CASE で guard を先に評価する（偽なら `engineer_shares` に触れない）。
  --    COALESCE で NULL（GUC 未設定）を 'off' に畳む（20260916000000 と同じ）。
  SELECT CASE
           WHEN COALESCE(current_setting('app.shared_scope', true), 'off') = 'on'
                AND app_is_host()
           THEN ARRAY(SELECT s.engineer_id
                        FROM engineer_shares s
                       WHERE s.tenant_id = t
                         AND s.revoked_at IS NULL)   -- 🔴 20260916000000 判断事項 4（Issue #49。暫定 = 既定 A）
           ELSE '{}'::uuid[]
         END
$BODY$;
ALTER FUNCTION app_shared_engineer_ids(uuid) OWNER TO app_share_probe;

-- ============================================================================
-- 2. app_engineer_is_shared: 本体を新関数へ寄せる（判断事項 2。所有者・権限は変わらない）
-- ============================================================================
-- 🔴 `eng` が NULL のとき `NULL = ANY(非空配列)` は NULL になるので COALESCE で false に畳む
--    （旧本体の `EXISTS` と同じく、戻り値に NULL を出さない）。
CREATE OR REPLACE FUNCTION app_engineer_is_shared(eng uuid, t uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $BODY$
  SELECT COALESCE(eng = ANY (app_shared_engineer_ids(t)), false)
$BODY$;

-- 🔴 CREATE は上の ALTER FUNCTION のときにしか要らない。直ちに剥がす。
REVOKE CREATE ON SCHEMA public FROM app_share_probe;

-- 🔴 CREATE FUNCTION が既定で PUBLIC に付与する EXECUTE を剥がし、app_tenant にだけ与える
--    （`app_engineer_is_shared` と同じ。運営者ロールには与えない —— `CLAUDE.md` §10.5）。
REVOKE ALL ON FUNCTION app_shared_engineer_ids(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_shared_engineer_ids(uuid) TO app_tenant;

COMMENT ON FUNCTION app_shared_engineer_ids(uuid) IS
  'T-12-19: 越境経路 4 の共有中エンジニア ID の集合（docs/05 §4.5 / §17.3 (a)）。共有元は返さない。呼び出し元は engineers / engineer_skills の shared_candidate_read ポリシーと app_engineer_is_shared() のみ。';
COMMENT ON FUNCTION app_engineer_is_shared(uuid, uuid) IS
  'T-08-03: 越境経路 4 の存在判定（docs/05 §4.5 / P-A-14）。行ではなく真偽だけを返す。T-12-19 で本体を app_shared_engineer_ids() に寄せた（1 実装）。';

-- ============================================================================
-- 3. 共有スコープの追加 SELECT ポリシー 2 本を集合化する（🔴 2 表だけ。増やさない）
-- ============================================================================
-- 🔴 射程（`app.shared_scope = 'on'` の guard / `tenant_id = app_tenant_id()` / SELECT 専用 / `TO app_tenant`）
--    は 20260916000000 と同一。変わるのは `app_engineer_is_shared(id, tenant_id)` の行ごとの呼び出しが
--    `id IN (SELECT unnest(…))` の hashed SubPlan になることだけである。
DROP POLICY IF EXISTS engineers_shared_candidate_read ON engineers;
CREATE POLICY engineers_shared_candidate_read ON engineers FOR SELECT TO app_tenant
  USING (
    tenant_id = app_tenant_id()
    AND COALESCE(current_setting('app.shared_scope', true), 'off') = 'on'
    AND id IN (SELECT unnest(app_shared_engineer_ids(app_tenant_id())))
  );

-- 🔴 親（engineers）と同じ述語を、子の `engineer_id` で引く。
DROP POLICY IF EXISTS engineer_skills_shared_candidate_read ON engineer_skills;
CREATE POLICY engineer_skills_shared_candidate_read ON engineer_skills FOR SELECT TO app_tenant
  USING (
    tenant_id = app_tenant_id()
    AND COALESCE(current_setting('app.shared_scope', true), 'off') = 'on'
    AND engineer_id IN (SELECT unnest(app_shared_engineer_ids(app_tenant_id())))
  );
