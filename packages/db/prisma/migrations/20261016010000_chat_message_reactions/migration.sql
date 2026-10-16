-- ============================================================================
-- チャットの発言へのリアクション（`chat_message_reactions`）。2026-10-16、チャットレーン（担当: 紺野）。
-- docs/chat-lane/roadmap.md の 9。紺野の判断でマージ（チャット専用の表）。
-- ============================================================================
-- 🔴 判断事項 1: 絵文字ではなく業務の短い語 4 つ（UI_GUIDELINES §1「絵文字を使わない」）
--    OK = 了解 / THANKS = ありがとう / CHECKING = 確認します / DONE = 対応済み。自由入力を受けない。
-- 🔴 判断事項 2: 読みは「その発言が読める」ときだけ
--    SELECT の USING に `EXISTS (SELECT 1 FROM messages m WHERE m.id = message_id)` を置く。サブクエリは
--    呼び出し側のロールで評価されるので messages の RLS（C6）が効く —— 参加していないスレッドの
--    リアクションは 1 行も見えない（件数も含めて）。
-- 🔴 判断事項 3: 書きは本人の行だけ（INSERT / DELETE）。UPDATE は与えない（付け外しで表す）
-- 🔴 判断事項 4: 運営者（app_platform）に GRANT しない。user_id に FK を張らない（chat_read_states と同じ）
CREATE TABLE IF NOT EXISTS chat_message_reactions (
  id          uuid PRIMARY KEY,
  tenant_id   uuid NOT NULL,
  message_id  uuid NOT NULL,
  user_id     uuid NOT NULL,
  reaction    text NOT NULL,
  created_at  timestamptz(3) NOT NULL DEFAULT now(),
  CONSTRAINT chat_message_reactions_reaction_check CHECK (reaction IN ('OK', 'THANKS', 'CHECKING', 'DONE'))
);

CREATE UNIQUE INDEX IF NOT EXISTS chat_message_reactions_tenant_id_message_id_user_id_reaction_key
  ON chat_message_reactions (tenant_id, message_id, user_id, reaction);
CREATE INDEX IF NOT EXISTS chat_message_reactions_tenant_id_message_id_idx
  ON chat_message_reactions (tenant_id, message_id);

ALTER TABLE "chat_message_reactions" ADD CONSTRAINT "chat_message_reactions_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "chat_message_reactions" ADD CONSTRAINT "chat_message_reactions_message_id_fkey" FOREIGN KEY ("message_id") REFERENCES "messages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ----------------------------------------------------------------------------
-- RLS と GRANT。🔴 片方だけを足さない（docs/05 §4.2）
-- ----------------------------------------------------------------------------
ALTER TABLE chat_message_reactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE chat_message_reactions FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS chat_message_reactions_select ON chat_message_reactions;
CREATE POLICY chat_message_reactions_select ON chat_message_reactions FOR SELECT TO app_tenant
  USING (
    tenant_id = app_tenant_id()
    AND EXISTS (SELECT 1 FROM messages m WHERE m.id = message_id AND m.tenant_id = app_tenant_id())
  );

DROP POLICY IF EXISTS chat_message_reactions_c7_insert ON chat_message_reactions;
CREATE POLICY chat_message_reactions_c7_insert ON chat_message_reactions FOR INSERT TO app_tenant
  WITH CHECK (
    tenant_id = app_tenant_id()
    AND user_id = app_actor_user_id()
    AND EXISTS (SELECT 1 FROM messages m WHERE m.id = message_id AND m.tenant_id = app_tenant_id())
  );

DROP POLICY IF EXISTS chat_message_reactions_c7_delete ON chat_message_reactions;
CREATE POLICY chat_message_reactions_c7_delete ON chat_message_reactions FOR DELETE TO app_tenant
  USING (tenant_id = app_tenant_id() AND user_id = app_actor_user_id());

GRANT SELECT, INSERT, DELETE ON chat_message_reactions TO app_tenant;
