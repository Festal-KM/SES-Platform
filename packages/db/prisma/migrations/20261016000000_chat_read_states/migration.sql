-- ============================================================================
-- チャットの既読位置（`chat_read_states`）。2026-10-16、チャットレーン（担当: 紺野）。
-- 設計案: docs/chat-lane/read-state-proposal.md / CLAUDE.md §4.1 `ChatReadState`（紺野の承認で追加）
-- ============================================================================
-- 1 人 × 1 スレッドで 1 行。「どこまで読んだか」だけを持ち、未読の件数は messages の RLS（C6）越しに数える。
--
-- 🔴 判断事項 1: RLS は C7 SELF（docs/05 §4.4。notifications の SELECT と同じ式）
--    読むのも書くのも**本人の行だけ**。同僚の既読位置も相手社の既読位置も 1 行も見えない
--    —— 「既読 n」（相手が読んだか）を作れない形にしておく（#97 の 7 は別の判断）。
-- 🔴 判断事項 2: 読めないスレッドの既読位置は作れない
--    INSERT / UPDATE の WITH CHECK に「そのスレッドが今読める」を AND する。サブクエリは呼び出し側の
--    ロールで評価されるので chat_threads の RLS（C6）が効く —— 参加していないスレッドの ID を
--    指定しても行は入らない（存在の確認にも使えない。INSERT が 0 行 = 失敗で、見える / 見えないを区別しない）。
-- 🔴 判断事項 3: 運営者（app_platform）に GRANT しない
--    既読位置は利用者個人の閲覧の痕跡であり、運営に要るのは「件数・状態・エラー」だけ（CLAUDE.md §10.5）。
-- 🔴 判断事項 4: user_id に FK を張らない
--    利用者が消えるのは PURGED（テナントごと）か論理削除であり、テナントの削除は tenant_id の CASCADE が消す。
--    users への FK を張ると User モデルに逆リレーションが増え、scope-injection の対象が広がる（変更を小さく保つ）。
CREATE TABLE IF NOT EXISTS chat_read_states (
  id                    uuid PRIMARY KEY,
  tenant_id             uuid NOT NULL,
  user_id               uuid NOT NULL,
  thread_id             uuid NOT NULL,
  -- ここまで読んだ発言（並びは (sent_at, id)。会話の並びと同じ）。NULL = まだ 1 件も読んでいない。
  last_read_sent_at     timestamptz(3),
  last_read_message_id  uuid,
  updated_at            timestamptz(3) NOT NULL DEFAULT now(),
  CONSTRAINT chat_read_states_position_check
    CHECK ((last_read_sent_at IS NULL) = (last_read_message_id IS NULL))
);

CREATE UNIQUE INDEX IF NOT EXISTS chat_read_states_tenant_id_user_id_thread_id_key
  ON chat_read_states (tenant_id, user_id, thread_id);

-- 外部キー（Prisma が生成する名前と形に合わせる）。スレッドが消えたら既読位置も消える。
ALTER TABLE "chat_read_states" ADD CONSTRAINT "chat_read_states_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "chat_read_states" ADD CONSTRAINT "chat_read_states_thread_id_fkey" FOREIGN KEY ("thread_id") REFERENCES "chat_threads"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ----------------------------------------------------------------------------
-- RLS と GRANT。🔴 片方だけを足さない（docs/05 §4.2）
-- ----------------------------------------------------------------------------
ALTER TABLE chat_read_states ENABLE ROW LEVEL SECURITY;
ALTER TABLE chat_read_states FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS chat_read_states_c7_select ON chat_read_states;
CREATE POLICY chat_read_states_c7_select ON chat_read_states FOR SELECT TO app_tenant
  USING (tenant_id = app_tenant_id() AND user_id = app_actor_user_id());

DROP POLICY IF EXISTS chat_read_states_c7_insert ON chat_read_states;
CREATE POLICY chat_read_states_c7_insert ON chat_read_states FOR INSERT TO app_tenant
  WITH CHECK (
    tenant_id = app_tenant_id()
    AND user_id = app_actor_user_id()
    AND EXISTS (SELECT 1 FROM chat_threads t WHERE t.id = thread_id AND t.tenant_id = app_tenant_id())
  );

DROP POLICY IF EXISTS chat_read_states_c7_update ON chat_read_states;
CREATE POLICY chat_read_states_c7_update ON chat_read_states FOR UPDATE TO app_tenant
  USING (tenant_id = app_tenant_id() AND user_id = app_actor_user_id())
  WITH CHECK (
    tenant_id = app_tenant_id()
    AND user_id = app_actor_user_id()
    AND EXISTS (SELECT 1 FROM chat_threads t WHERE t.id = thread_id AND t.tenant_id = app_tenant_id())
  );

DROP POLICY IF EXISTS chat_read_states_c7_delete ON chat_read_states;
CREATE POLICY chat_read_states_c7_delete ON chat_read_states FOR DELETE TO app_tenant
  USING (tenant_id = app_tenant_id() AND user_id = app_actor_user_id());

GRANT SELECT, INSERT, UPDATE, DELETE ON chat_read_states TO app_tenant;
