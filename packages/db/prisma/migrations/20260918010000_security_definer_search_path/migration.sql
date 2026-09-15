-- ============================================================================
-- T-09-13 レビュー是正: 既存の SECURITY DEFINER 関数の `search_path` に `pg_temp` を末尾明示する
-- （docs/05 §4.4.1 / §4.5 / §8.5.1 / §9.1.1 / §11.14 ⑩。2026-09-15 に横断適用）
-- ============================================================================
-- 🔴 事象: `SET search_path = public` だけの SECURITY DEFINER 関数は、リレーション名の解決で
--    **呼び出し側セッションの一時スキーマを最初に**探す（PostgreSQL は `pg_temp` を明示しない限り
--    暗黙に search_path の先頭へ入れる）。したがって呼び出し側（`app_tenant`）が
--      CREATE TEMP TABLE <本体と同名の表>(...);  GRANT SELECT ON pg_temp.<表> TO <所有者ロール>;
--    と仕込むと、関数本体の `FROM <表>` がその一時表を読む。**関数の中の `WHERE` / 権限 / ポリシーが
--    課している条件を、呼び出し側が用意した行で満たせる**ということであり、二重防御の「片方が静かに
--    無効化されてももう片方が止める」（`CLAUDE.md` §3.1）が DB 単独では成立しない。
--    T-09-13 の `app_gate_proposal_engineer_*` で code-reviewer が実 DB で再現し（migration 20260918000000
--    の判断事項 4）、同じ形の既存関数を洗い出したところ **6 本すべて**が同じ書き方だった。
--
-- 🔴 影響が最も大きいのは `app_engineer_is_shared`（RLS ポリシー `engineers_shared_candidate_read` /
--    `engineer_skills_shared_candidate_read` から呼ばれる）: 一時表 `engineer_shares` に非共有の
--    エンジニアの行を仕込むと `true` に化け、`app.shared_scope='on'` 下で**非共有のパートナーエンジニアが
--    匿名 5 項目に現れる**（経路 4 の違反。`CLAUDE.md` §3.1 経路 4 / `BR-56`）。
--    回帰は `tests/isolation/shared-candidate-scope.test.ts` ⑤ が固定する（修正前に赤・修正後に緑を実測）。
--
-- 🔴 修正: `ALTER FUNCTION ... SET search_path = public, pg_temp`（公式「Writing SECURITY DEFINER
--    Functions Safely」の形）。`pg_temp` を末尾に置くと、本体の表は常に `public` で先に解決され、
--    一時表は関数の中から見えない。関数本体・所有者・EXECUTE 権限は変えない（`ALTER FUNCTION ... SET`
--    は所有者だけが実行でき、`app_migrator` は各 probe ロールのメンバー〔000_roles.sql〕なので通る）。
--
-- 🔴 今後 SECURITY DEFINER 関数を足すときは**必ず `SET search_path = public, pg_temp`** と書くこと。
--    忘れると `tests/isolation/rls-enforced.test.ts` の横断検査（「SECURITY DEFINER の全関数と
--    `app_*_probe` 所有の全関数の proconfig が `search_path=public, pg_temp` を含む」）が落ちる。

-- app_assignment_owner_probe（migration 20260903070000。トリガ関数。直接呼べないため影響は限定的だが、規律を揃える）
ALTER FUNCTION inherit_assignment_counterparty() SET search_path = public, pg_temp;

-- app_scan_probe（migration 20260908000000 / 20260910000000）
ALTER FUNCTION app_apply_scan_status(text, text, text[], timestamptz) SET search_path = public, pg_temp;
ALTER FUNCTION app_list_stalled_scan_targets(timestamptz, integer)     SET search_path = public, pg_temp;
ALTER FUNCTION app_scan_quarantine_target(text)                        SET search_path = public, pg_temp;

-- app_scheduler_probe（migration 20260915000000）
ALTER FUNCTION app_list_scheduler_tenants() SET search_path = public, pg_temp;

-- 🔴 app_share_probe（migration 20260916000000。RLS ポリシーから呼ばれる。上記の 🔴）
ALTER FUNCTION app_engineer_is_shared(uuid, uuid) SET search_path = public, pg_temp;
