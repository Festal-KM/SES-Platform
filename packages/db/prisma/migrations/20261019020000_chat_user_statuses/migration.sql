-- ============================================================================
-- チャットのひとこと状態（`chat_user_statuses`）。2026-10-19、チャットレーン（担当: 紺野）。
-- 設計案: docs/chat-lane/people-chat-proposal.md §7.1 ①（#128 で紺野・宮田が合意）/ docs/05 §3.7.1 / §6.5 #51j
-- ============================================================================
-- 1 人 1 行。「商談中」「移動中・16 時以降に返信」などの短い自由文（60 文字まで）。空にしたら行を消す。
--
-- 🔴 判断事項 1: `users` に列を足さない
--    `users` は全員が共有する表（認証・名簿・取引先の管理）であり、チャットの都合で列を増やさない。
-- 🔴 判断事項 2: 書き込みは本人の行だけ（C7 SELF の式）
--    INSERT / UPDATE / DELETE は `user_id = app_actor_user_id()`。他人の状態を書き換える経路を作らない。
-- 🔴 判断事項 3: 読み取りは「その利用者が自分から見えるとき」だけ（users の C8 DIRECTORY に連動）
--    `EXISTS (SELECT 1 FROM users u WHERE u.id = user_id AND u.tenant_id = tenant_id)`。サブクエリは
--    呼び出し側のロールで評価されるので users の RLS（C8）が効く —— 取引先からは、別の取引先の人の
--    状態が 1 行も見えない（存在も件数も分からない）。ホストからは全員の状態が見える。
-- 🔴 判断事項 4: 運営者（app_platform）に GRANT しない
--    利用者個人の自由文であり、運営に要るのは「件数・状態・エラー」だけ（CLAUDE.md §10.5）。
-- 🔴 判断事項 5: user_id に FK を張らない（chat_read_states の判断事項 4 と同じ）
--    利用者が消えるのは PURGED（テナントごと）か論理削除であり、テナントの削除は tenant_id の CASCADE が消す。
-- 🔴 判断事項 6: 解約（PURGED）で本文を消す（packages/config/src/retention.ts の PURGE_SPEC.delete）
--    自由文なので個人の事情（「通院のため」等）が書かれうる。削除スコープの SELECT / UPDATE を足す（下の ②）。
CREATE TABLE IF NOT EXISTS chat_user_statuses (
  id          uuid PRIMARY KEY,
  tenant_id   uuid NOT NULL,
  user_id     uuid NOT NULL,
  text        text NOT NULL,
  updated_at  timestamptz(3) NOT NULL DEFAULT now(),
  -- 空の状態は行を消して表す。60 文字はアプリ（Zod）と同じ上限（二重の守り）。
  CONSTRAINT chat_user_statuses_text_length_check CHECK (char_length(text) <= 60)
);

CREATE UNIQUE INDEX IF NOT EXISTS chat_user_statuses_tenant_id_user_id_key
  ON chat_user_statuses (tenant_id, user_id);

ALTER TABLE "chat_user_statuses" ADD CONSTRAINT "chat_user_statuses_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ----------------------------------------------------------------------------
-- ① RLS と GRANT。🔴 片方だけを足さない（docs/05 §4.2）
-- ----------------------------------------------------------------------------
ALTER TABLE chat_user_statuses ENABLE ROW LEVEL SECURITY;
ALTER TABLE chat_user_statuses FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS chat_user_statuses_c8_select ON chat_user_statuses;
CREATE POLICY chat_user_statuses_c8_select ON chat_user_statuses FOR SELECT TO app_tenant
  USING (
    tenant_id = app_tenant_id()
    AND EXISTS (
      SELECT 1 FROM users u
      WHERE u.id = chat_user_statuses.user_id AND u.tenant_id = chat_user_statuses.tenant_id
    )
  );

DROP POLICY IF EXISTS chat_user_statuses_c7_insert ON chat_user_statuses;
CREATE POLICY chat_user_statuses_c7_insert ON chat_user_statuses FOR INSERT TO app_tenant
  WITH CHECK (tenant_id = app_tenant_id() AND user_id = app_actor_user_id());

DROP POLICY IF EXISTS chat_user_statuses_c7_update ON chat_user_statuses;
CREATE POLICY chat_user_statuses_c7_update ON chat_user_statuses FOR UPDATE TO app_tenant
  USING (tenant_id = app_tenant_id() AND user_id = app_actor_user_id())
  WITH CHECK (tenant_id = app_tenant_id() AND user_id = app_actor_user_id());

DROP POLICY IF EXISTS chat_user_statuses_c7_delete ON chat_user_statuses;
CREATE POLICY chat_user_statuses_c7_delete ON chat_user_statuses FOR DELETE TO app_tenant
  USING (tenant_id = app_tenant_id() AND user_id = app_actor_user_id());

GRANT SELECT, INSERT, UPDATE, DELETE ON chat_user_statuses TO app_tenant;

-- ----------------------------------------------------------------------------
-- ② 削除スコープ（`app.purge_scope = 'on'`）の追加ポリシー（migration 20260927000000 ④ と同じ式）
-- ----------------------------------------------------------------------------
-- 🔴 PURGE_SPEC.delete に載る表は `{table}_purge_scope_select` / `_update` を必ず持つ（tests/isolation/tenant-purge.test.ts ⑨ /
--    tests/static/purge-spec-coverage.test.ts ④）。列の消去（UPDATE）だけなので DELETE のポリシーは足さない。
DROP POLICY IF EXISTS chat_user_statuses_purge_scope_select ON chat_user_statuses;
CREATE POLICY chat_user_statuses_purge_scope_select ON chat_user_statuses FOR SELECT TO app_tenant
  USING (tenant_id = app_tenant_id() AND app_is_host() AND app_purge_scope_on());

DROP POLICY IF EXISTS chat_user_statuses_purge_scope_update ON chat_user_statuses;
CREATE POLICY chat_user_statuses_purge_scope_update ON chat_user_statuses FOR UPDATE TO app_tenant
  USING (tenant_id = app_tenant_id() AND app_is_host() AND app_purge_scope_on())
  WITH CHECK (tenant_id = app_tenant_id() AND app_is_host() AND app_purge_scope_on());
