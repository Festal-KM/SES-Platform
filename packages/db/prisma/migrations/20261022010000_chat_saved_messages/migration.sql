-- ============================================================================
-- チャットの「保存済み」（`chat_saved_messages`）。2026-10-22、チャットレーン（担当: 紺野）。
-- Teams の「保存済み」/ Slack の「後で」にあたる、本人だけの栞。docs/05 §3.7.1 / §6.5 #51l
-- ============================================================================
-- 1 人 × 1 発言 = 1 行。保存を外したら行を消す（UPDATE は無い）。
--
-- 🔴 判断事項 1: 読み取りは「本人の行」かつ「その発言が今も自分から読める」とき（C7 SELF + messages の可視性）
--    `EXISTS (SELECT 1 FROM messages m WHERE m.id = message_id ...)`。サブクエリは呼び出し側のロールで評価されるので
--    messages の RLS（C6 と人の段 = app_thread_member_ok）が効く —— 部屋から外れた・取引先の関係が切れた後は、
--    保存した行そのものが見えなくなる（本文に届く経路を残さない）。行は消さないので、戻ればまた見える。
-- 🔴 判断事項 2: 保存（INSERT）は本人の行で、かつその発言が読めるときだけ
--    取引先から、別の取引先の発言（見えない発言）の ID を指定しても保存できない。
-- 🔴 判断事項 3: 外す（DELETE）は本人の行だけ。UPDATE は与えない。
-- 🔴 判断事項 4: 運営者（app_platform）に GRANT しない（本人だけの栞であり、運営に要るのは件数・状態・エラーだけ）。
-- 🔴 判断事項 5: user_id に FK を張らない（chat_read_states の判断事項 4 と同じ）。発言の行が消えたら栞も消える（message_id の CASCADE）。
-- 🔴 判断事項 6: 解約（PURGED）で行ごと消す（packages/config/src/retention.ts の PURGE_SPEC.delete の rows: 'ALL'）。
--    削除スコープの SELECT / UPDATE / DELETE を足す（下の ②）。
-- 🔴 判断事項 7: 監査ログに書かない（本人だけの栞で、ほかの人には何も見えず、本文も増えない。リアクションより閉じている）。
CREATE TABLE IF NOT EXISTS chat_saved_messages (
  id          uuid PRIMARY KEY,
  tenant_id   uuid NOT NULL,
  user_id     uuid NOT NULL,
  message_id  uuid NOT NULL,
  created_at  timestamptz(3) NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS chat_saved_messages_tenant_id_user_id_message_id_key
  ON chat_saved_messages (tenant_id, user_id, message_id);
CREATE INDEX IF NOT EXISTS chat_saved_messages_tenant_id_user_id_created_at_idx
  ON chat_saved_messages (tenant_id, user_id, created_at);

ALTER TABLE "chat_saved_messages" ADD CONSTRAINT "chat_saved_messages_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "chat_saved_messages" ADD CONSTRAINT "chat_saved_messages_message_id_fkey" FOREIGN KEY ("message_id") REFERENCES "messages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ----------------------------------------------------------------------------
-- ① RLS と GRANT。🔴 片方だけを足さない（docs/05 §4.2）
-- ----------------------------------------------------------------------------
ALTER TABLE chat_saved_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE chat_saved_messages FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS chat_saved_messages_c7_select ON chat_saved_messages;
CREATE POLICY chat_saved_messages_c7_select ON chat_saved_messages FOR SELECT TO app_tenant
  USING (
    tenant_id = app_tenant_id()
    AND user_id = app_actor_user_id()
    AND EXISTS (
      SELECT 1 FROM messages m
      WHERE m.id = chat_saved_messages.message_id AND m.tenant_id = app_tenant_id()
    )
  );

DROP POLICY IF EXISTS chat_saved_messages_c7_insert ON chat_saved_messages;
CREATE POLICY chat_saved_messages_c7_insert ON chat_saved_messages FOR INSERT TO app_tenant
  WITH CHECK (
    tenant_id = app_tenant_id()
    AND user_id = app_actor_user_id()
    AND EXISTS (
      SELECT 1 FROM messages m
      WHERE m.id = chat_saved_messages.message_id AND m.tenant_id = app_tenant_id()
    )
  );

DROP POLICY IF EXISTS chat_saved_messages_c7_delete ON chat_saved_messages;
CREATE POLICY chat_saved_messages_c7_delete ON chat_saved_messages FOR DELETE TO app_tenant
  USING (tenant_id = app_tenant_id() AND user_id = app_actor_user_id());

GRANT SELECT, INSERT, DELETE ON chat_saved_messages TO app_tenant;

-- ----------------------------------------------------------------------------
-- ② 削除スコープ（`app.purge_scope = 'on'`）の追加ポリシー（migration 20260927000000 ④ と同じ式）
-- ----------------------------------------------------------------------------
-- 🔴 PURGE_SPEC.delete に載る表は `{table}_purge_scope_select` / `_update` を必ず持つ（tests/isolation/tenant-purge.test.ts ⑨ /
--    tests/static/purge-spec-coverage.test.ts ④）。行ごと消す（rows: 'ALL'）ので `_delete` も足す（engineer_careers と同じ）。
DROP POLICY IF EXISTS chat_saved_messages_purge_scope_select ON chat_saved_messages;
CREATE POLICY chat_saved_messages_purge_scope_select ON chat_saved_messages FOR SELECT TO app_tenant
  USING (tenant_id = app_tenant_id() AND app_is_host() AND app_purge_scope_on());

DROP POLICY IF EXISTS chat_saved_messages_purge_scope_update ON chat_saved_messages;
CREATE POLICY chat_saved_messages_purge_scope_update ON chat_saved_messages FOR UPDATE TO app_tenant
  USING (tenant_id = app_tenant_id() AND app_is_host() AND app_purge_scope_on())
  WITH CHECK (tenant_id = app_tenant_id() AND app_is_host() AND app_purge_scope_on());

DROP POLICY IF EXISTS chat_saved_messages_purge_scope_delete ON chat_saved_messages;
CREATE POLICY chat_saved_messages_purge_scope_delete ON chat_saved_messages FOR DELETE TO app_tenant
  USING (tenant_id = app_tenant_id() AND app_is_host() AND app_purge_scope_on());
