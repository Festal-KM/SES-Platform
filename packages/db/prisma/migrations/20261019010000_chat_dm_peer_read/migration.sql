-- ============================================================================
-- 20261019010000_chat_dm_peer_read
-- DM の既読表示（#128 で紺野・宮田が合意。CLAUDE.md §4.1 `ChatReadState`）。
-- `docs/05` §3.7.1「既読を相手に見せる」。
--
-- 🔴 `chat_read_states` の RLS（C7 SELF。本人の行だけ）は**変えない**。相手の既読位置は、
--    専用ロール `app_thread_probe` の SECURITY DEFINER 関数 `app_dm_peer_read` が **1 つの値だけ**返す。
--    行を返さない・既読の日時を返さない・グループ / 会社グループ / スレッドでは NULL。
--    「誰がどこまで読んだか」を他人に見せない（DM の 2 人の間でだけ、相手の位置が分かる）。
-- 🔴 既存の migration は書き換えない。
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. app_thread_probe に chat_read_states の 4 列だけを読ませる（本文・日時・ピン留め等は読めない）
-- ----------------------------------------------------------------------------
GRANT SELECT (tenant_id, user_id, thread_id, last_read_message_id) ON chat_read_states TO app_thread_probe;
DROP POLICY IF EXISTS chat_read_states_thread_probe_select ON chat_read_states;
CREATE POLICY chat_read_states_thread_probe_select ON chat_read_states FOR SELECT TO app_thread_probe
  USING (tenant_id = app_tenant_id());

-- ----------------------------------------------------------------------------
-- 2. app_dm_peer_read(thread) → 相手の last_read_message_id（それ以外は NULL）
-- ----------------------------------------------------------------------------
-- 返すのは次をすべて満たすときだけ:
--   ① 部屋が DM（GROUP / COMPANY / PROJECT は NULL）
--   ② 呼び出し元（app_actor_user_id()）がその DM のメンバー
--   ③ 相手（もう 1 人のメンバー）の既読位置の行がある
-- 🔴 部屋が無い・テナント文脈が無い・利用者が無い・非メンバーは NULL（「読んでいない」と区別しない）。
-- 🔴 SECURITY DEFINER の SQL 関数はインライン展開されないので、内側の chat_threads / chat_read_states は
--    必ず app_thread_probe の権限・ポリシー（tenant_id = app_tenant_id()）で評価される。
GRANT CREATE ON SCHEMA public TO app_thread_probe;
CREATE FUNCTION app_dm_peer_read(th uuid) RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $BODY$
  SELECT s.last_read_message_id
    FROM chat_threads t
    JOIN chat_read_states s
      ON s.tenant_id = t.tenant_id
     AND s.thread_id = t.id
   WHERE t.tenant_id = app_tenant_id()
     AND t.id = th
     AND t."kind" = 'DM'
     AND app_actor_user_id() IS NOT NULL
     AND app_actor_user_id() = ANY (t.member_user_ids)
     AND s.user_id = ANY (t.member_user_ids)
     AND s.user_id <> app_actor_user_id()
   LIMIT 1
$BODY$;
ALTER FUNCTION app_dm_peer_read(uuid) OWNER TO app_thread_probe;
REVOKE CREATE ON SCHEMA public FROM app_thread_probe;

-- 🔴 運営者（app_platform / app_platform_write）には与えない（CLAUDE.md §10.5。閲覧の痕跡に届く経路を増やさない）。
REVOKE ALL ON FUNCTION app_dm_peer_read(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_dm_peer_read(uuid) TO app_tenant;

COMMENT ON FUNCTION app_dm_peer_read(uuid) IS
  '2026-10-19（#128）: DM の既読表示。呼び出し元がメンバーの DM でだけ、もう 1 人のメンバーの last_read_message_id を返す。それ以外は NULL。呼び出し元は @ses/db の readDmPeerReadMessageIds のみ。';
