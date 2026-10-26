-- ============================================================================
-- チャットの「自分の定型文」（`chat_message_templates`）。2026-10-22、チャットレーン（担当: 紺野）。
-- 紺野の決定: 自分だけ（会社共通の定型文は作らない）。docs/05 §3.7.1 / §6.5 #51m
-- ============================================================================
-- 見出し（30 文字まで）と本文（1000 文字まで）。1 人 50 件まで（アプリで数えて止める）。
--
-- 🔴 判断事項 1: SELECT / INSERT / UPDATE / DELETE すべて本人の行だけ（C7 SELF の式 `user_id = app_actor_user_id()`）
--    ほかの人（同じ会社の人・管理者を含む）からは存在も件数も見えない。
-- 🔴 判断事項 2: 運営者（app_platform）に GRANT しない（利用者個人の自由文。CLAUDE.md §10.5）。
-- 🔴 判断事項 3: user_id に FK を張らない（chat_read_states の判断事項 4 と同じ）。
-- 🔴 判断事項 4: 解約（PURGED）で見出しと本文を空文字にする（PURGE_SPEC.delete。自由文に個人の事情・取引先の名前が書かれうる）。
--    ひとこと状態と同じ列の消去。削除スコープの SELECT / UPDATE を足す（下の ②）。
-- 🔴 判断事項 5: 長さの上限は CHECK でも止める（アプリの Zod と二重）。下限（空にしない）はアプリだけが持つ
--    —— 解約の消去が空文字を書くため（chat_user_statuses の CHECK と同じ形）。
CREATE TABLE IF NOT EXISTS chat_message_templates (
  id          uuid PRIMARY KEY,
  tenant_id   uuid NOT NULL,
  user_id     uuid NOT NULL,
  label       text NOT NULL,
  body        text NOT NULL,
  created_at  timestamptz(3) NOT NULL DEFAULT now(),
  updated_at  timestamptz(3) NOT NULL DEFAULT now(),
  CONSTRAINT chat_message_templates_label_length_check CHECK (char_length(label) <= 30),
  CONSTRAINT chat_message_templates_body_length_check CHECK (char_length(body) <= 1000)
);

CREATE INDEX IF NOT EXISTS chat_message_templates_tenant_id_user_id_created_at_idx
  ON chat_message_templates (tenant_id, user_id, created_at);

ALTER TABLE "chat_message_templates" ADD CONSTRAINT "chat_message_templates_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ----------------------------------------------------------------------------
-- ① RLS と GRANT。🔴 片方だけを足さない（docs/05 §4.2）
-- ----------------------------------------------------------------------------
ALTER TABLE chat_message_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE chat_message_templates FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS chat_message_templates_c7_select ON chat_message_templates;
CREATE POLICY chat_message_templates_c7_select ON chat_message_templates FOR SELECT TO app_tenant
  USING (tenant_id = app_tenant_id() AND user_id = app_actor_user_id());

DROP POLICY IF EXISTS chat_message_templates_c7_insert ON chat_message_templates;
CREATE POLICY chat_message_templates_c7_insert ON chat_message_templates FOR INSERT TO app_tenant
  WITH CHECK (tenant_id = app_tenant_id() AND user_id = app_actor_user_id());

DROP POLICY IF EXISTS chat_message_templates_c7_update ON chat_message_templates;
CREATE POLICY chat_message_templates_c7_update ON chat_message_templates FOR UPDATE TO app_tenant
  USING (tenant_id = app_tenant_id() AND user_id = app_actor_user_id())
  WITH CHECK (tenant_id = app_tenant_id() AND user_id = app_actor_user_id());

DROP POLICY IF EXISTS chat_message_templates_c7_delete ON chat_message_templates;
CREATE POLICY chat_message_templates_c7_delete ON chat_message_templates FOR DELETE TO app_tenant
  USING (tenant_id = app_tenant_id() AND user_id = app_actor_user_id());

GRANT SELECT, INSERT, UPDATE, DELETE ON chat_message_templates TO app_tenant;

-- ----------------------------------------------------------------------------
-- ② 削除スコープ（`app.purge_scope = 'on'`）の追加ポリシー（migration 20260927000000 ④ と同じ式）
-- ----------------------------------------------------------------------------
-- 🔴 PURGE_SPEC.delete に載る表は `{table}_purge_scope_select` / `_update` を必ず持つ。列の消去（UPDATE）だけなので DELETE は足さない。
DROP POLICY IF EXISTS chat_message_templates_purge_scope_select ON chat_message_templates;
CREATE POLICY chat_message_templates_purge_scope_select ON chat_message_templates FOR SELECT TO app_tenant
  USING (tenant_id = app_tenant_id() AND app_is_host() AND app_purge_scope_on());

DROP POLICY IF EXISTS chat_message_templates_purge_scope_update ON chat_message_templates;
CREATE POLICY chat_message_templates_purge_scope_update ON chat_message_templates FOR UPDATE TO app_tenant
  USING (tenant_id = app_tenant_id() AND app_is_host() AND app_purge_scope_on())
  WITH CHECK (tenant_id = app_tenant_id() AND app_is_host() AND app_purge_scope_on());
