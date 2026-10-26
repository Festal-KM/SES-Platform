-- ============================================================================
-- 解約（PURGED）でグループ名（`chat_threads.title`）も消す。2026-10-26、チャットレーン（担当: 紺野）。
-- 出典: Issue #166 の 2（Codex による見直し）。docs/05 §3.7.1 / §9.7
-- ============================================================================
-- 何が起きていたか: `chat_threads` は「スレッドの構造」として PURGE_SPEC.retain に丸ごと置かれていた。
--    #128 で DM・グループを足したときに、グループ名（自由文。「山田さんの休職相談」などが書ける）が
--    この表に入ったが、retain の理由（構造）では自由文を扱えておらず、解約後も名前が残っていた。
--
-- 🔴 判断事項 1: 部屋の構造（種類・メンバー・取引先・作成者）は残し、自由文の `title` だけを NULL にする
--    （PURGE_SPEC.delete の「列の消去」。行は消さない —— 発言・既読・参加会社が部屋を参照しているため）。
-- 🔴 判断事項 2: 削除スコープ（`app.purge_scope = 'on'`）の SELECT / UPDATE を足す（20260927000000 ④ と同じ式）。
--    削除スコープの文脈は利用者を持たないので、DM・グループは通常のポリシー（C6 + 人の段）では見えず、
--    このポリシーが無いと UPDATE が 0 件で「成功」して名前が残る。
-- 🔴 判断事項 3: 凍結トリガ `chat_threads_freeze_room` は種類・メンバー・dm_key・作成者・取引先だけを見るので
--    `title` の更新を止めない。所属検査のトリガ `chat_threads_members_party` も `UPDATE OF member_user_ids,
--    partner_company_id, kind` にしか反応しない。トリガは変えない。
-- 🔴 判断事項 4: 20261016050000 ⑥ の「読むだけ」のポリシー（`chat_threads_purge_scope_parent_read`）は、
--    下の `_purge_scope_select` と同じ式になるので外す（同じものを 2 つ持たない）。
--
-- 🔴 FORCE は外さない: この migration は既存の行を書き換えない（ポリシーを足すだけ）。
--    名前を消すのは解約の実行時（tenant.purge）であり、そのときは削除スコープのポリシーを通る。

DROP POLICY IF EXISTS chat_threads_purge_scope_parent_read ON chat_threads;

DROP POLICY IF EXISTS chat_threads_purge_scope_select ON chat_threads;
CREATE POLICY chat_threads_purge_scope_select ON chat_threads FOR SELECT TO app_tenant
  USING (tenant_id = app_tenant_id() AND app_is_host() AND app_purge_scope_on());

DROP POLICY IF EXISTS chat_threads_purge_scope_update ON chat_threads;
CREATE POLICY chat_threads_purge_scope_update ON chat_threads FOR UPDATE TO app_tenant
  USING (tenant_id = app_tenant_id() AND app_is_host() AND app_purge_scope_on())
  WITH CHECK (tenant_id = app_tenant_id() AND app_is_host() AND app_purge_scope_on());
