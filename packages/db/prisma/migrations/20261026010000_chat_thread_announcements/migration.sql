-- ============================================================================
-- チャットのアナウンス（`chat_thread_announcements`）。2026-10-26、チャットレーン（担当: 紺野。決定は 2026-10-22）。
-- LINE のアナウンスと同じ: 部屋の上部に大事な発言を 1 件固定して出す。docs/05 §3.7.1 / §6.5 #51n
-- ============================================================================
-- 1 部屋 = 1 行（thread_id で一意）。新しくアナウンスにすると置き換わる（UPDATE）。外したら行を消す。
--
-- 🔴 判断事項 1: `chat_threads` に列を足さない
--    `chat_threads` には凍結のトリガ（chat_threads_freeze_room）があり、部屋の形を後から変えさせない。
--    アナウンスは部屋の形ではなく「その部屋の中の 1 つの状態」なので、別の表に置く（凍結の守りに穴を開けない）。
-- 🔴 判断事項 2: 読み取りは「その部屋が自分から読める」ときだけ
--    `EXISTS (SELECT 1 FROM chat_threads t WHERE t.id = thread_id ...)`。サブクエリは呼び出し側のロールで評価されるので
--    chat_threads の RLS（C6 と人の段 = C10 MEMBER）が効く —— 別の取引先・別のテナント・メンバーでない DM / グループからは、
--    アナウンスの行が 1 行も見えない（存在も件数も分からない）。部屋から外れたら見えなくなる。
-- 🔴 判断事項 3: 設定（INSERT / UPDATE）は、部屋が読めて、かつ指した発言が「その部屋の、消えていない発言」のときだけ
--    `EXISTS (SELECT 1 FROM messages m WHERE m.id = message_id AND m.thread_id = thread_id AND m.deleted_at IS NULL AND m.purged_at IS NULL)`。
--    messages の RLS も呼び出し側で効く —— 別の部屋の発言 ID・見えない発言・削除済みの発言はアナウンスにできない。
--    設定した人は本人として記録する（`set_by_user_id = app_actor_user_id()`。他人の名前で設定させない）。
-- 🔴 判断事項 4: 外す（DELETE）は、部屋が読める人なら誰でも（紺野の決定「部屋のメンバーなら誰でも」）
--    投稿できるロールか（閲覧専用は不可）はアプリの guards が見る（CHAT_POST_ROLES / requireNotViewer / requireExecutable）。
-- 🔴 判断事項 5: 運営者（app_platform）に GRANT しない（発言の中身に届く表であり、運営に要るのは件数・状態・エラーだけ。CLAUDE.md §10.5）。
-- 🔴 判断事項 6: set_by_user_id に FK を張らない（chat_read_states の判断事項 4 と同じ）。部屋・発言の行が消えたら行も消える（CASCADE）。
-- 🔴 判断事項 7: 解約（PURGED）で行ごと消す（packages/config/src/retention.ts の PURGE_SPEC.delete の rows: 'ALL'）。
--    消す列が無く（ID と時刻だけ）、この表を参照する表も無い末端の表。削除スコープの SELECT / UPDATE / DELETE を足す（下の ②）。
-- 🔴 判断事項 8: 設定・外すは監査ログに残す（ほかの人に見える変更のため。本文は載せず、部屋 ID・発言 ID だけ。アプリ側）。
CREATE TABLE IF NOT EXISTS chat_thread_announcements (
  id              uuid PRIMARY KEY,
  tenant_id       uuid NOT NULL,
  thread_id       uuid NOT NULL,
  message_id      uuid NOT NULL,
  set_by_user_id  uuid NOT NULL,
  set_at          timestamptz(3) NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS chat_thread_announcements_tenant_id_thread_id_key
  ON chat_thread_announcements (tenant_id, thread_id);

ALTER TABLE "chat_thread_announcements" ADD CONSTRAINT "chat_thread_announcements_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "chat_thread_announcements" ADD CONSTRAINT "chat_thread_announcements_thread_id_fkey" FOREIGN KEY ("thread_id") REFERENCES "chat_threads"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "chat_thread_announcements" ADD CONSTRAINT "chat_thread_announcements_message_id_fkey" FOREIGN KEY ("message_id") REFERENCES "messages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ----------------------------------------------------------------------------
-- ① RLS と GRANT。🔴 片方だけを足さない（docs/05 §4.2）
-- ----------------------------------------------------------------------------
ALTER TABLE chat_thread_announcements ENABLE ROW LEVEL SECURITY;
ALTER TABLE chat_thread_announcements FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS chat_thread_announcements_c6_select ON chat_thread_announcements;
CREATE POLICY chat_thread_announcements_c6_select ON chat_thread_announcements FOR SELECT TO app_tenant
  USING (
    tenant_id = app_tenant_id()
    AND EXISTS (
      SELECT 1 FROM chat_threads t
      WHERE t.id = chat_thread_announcements.thread_id AND t.tenant_id = app_tenant_id()
    )
  );

DROP POLICY IF EXISTS chat_thread_announcements_c6_insert ON chat_thread_announcements;
CREATE POLICY chat_thread_announcements_c6_insert ON chat_thread_announcements FOR INSERT TO app_tenant
  WITH CHECK (
    tenant_id = app_tenant_id()
    AND set_by_user_id = app_actor_user_id()
    AND EXISTS (
      SELECT 1 FROM chat_threads t
      WHERE t.id = chat_thread_announcements.thread_id AND t.tenant_id = app_tenant_id()
    )
    AND EXISTS (
      SELECT 1 FROM messages m
      WHERE m.id = chat_thread_announcements.message_id
        AND m.thread_id = chat_thread_announcements.thread_id
        AND m.tenant_id = app_tenant_id()
        AND m.deleted_at IS NULL
        AND m.purged_at IS NULL
    )
  );

DROP POLICY IF EXISTS chat_thread_announcements_c6_update ON chat_thread_announcements;
CREATE POLICY chat_thread_announcements_c6_update ON chat_thread_announcements FOR UPDATE TO app_tenant
  USING (
    tenant_id = app_tenant_id()
    AND EXISTS (
      SELECT 1 FROM chat_threads t
      WHERE t.id = chat_thread_announcements.thread_id AND t.tenant_id = app_tenant_id()
    )
  )
  WITH CHECK (
    tenant_id = app_tenant_id()
    AND set_by_user_id = app_actor_user_id()
    AND EXISTS (
      SELECT 1 FROM chat_threads t
      WHERE t.id = chat_thread_announcements.thread_id AND t.tenant_id = app_tenant_id()
    )
    AND EXISTS (
      SELECT 1 FROM messages m
      WHERE m.id = chat_thread_announcements.message_id
        AND m.thread_id = chat_thread_announcements.thread_id
        AND m.tenant_id = app_tenant_id()
        AND m.deleted_at IS NULL
        AND m.purged_at IS NULL
    )
  );

DROP POLICY IF EXISTS chat_thread_announcements_c6_delete ON chat_thread_announcements;
CREATE POLICY chat_thread_announcements_c6_delete ON chat_thread_announcements FOR DELETE TO app_tenant
  USING (
    tenant_id = app_tenant_id()
    AND EXISTS (
      SELECT 1 FROM chat_threads t
      WHERE t.id = chat_thread_announcements.thread_id AND t.tenant_id = app_tenant_id()
    )
  );

GRANT SELECT, INSERT, UPDATE, DELETE ON chat_thread_announcements TO app_tenant;

-- ----------------------------------------------------------------------------
-- ② 削除スコープ（`app.purge_scope = 'on'`）の追加ポリシー（migration 20261022010000 ② と同じ式）
-- ----------------------------------------------------------------------------
-- 🔴 PURGE_SPEC.delete に載る表は `{table}_purge_scope_select` / `_update` を必ず持つ（tests/isolation/tenant-purge.test.ts ⑨ /
--    tests/static/purge-spec-coverage.test.ts ④）。行ごと消す（rows: 'ALL'）ので `_delete` も足す（chat_saved_messages と同じ）。
DROP POLICY IF EXISTS chat_thread_announcements_purge_scope_select ON chat_thread_announcements;
CREATE POLICY chat_thread_announcements_purge_scope_select ON chat_thread_announcements FOR SELECT TO app_tenant
  USING (tenant_id = app_tenant_id() AND app_is_host() AND app_purge_scope_on());

DROP POLICY IF EXISTS chat_thread_announcements_purge_scope_update ON chat_thread_announcements;
CREATE POLICY chat_thread_announcements_purge_scope_update ON chat_thread_announcements FOR UPDATE TO app_tenant
  USING (tenant_id = app_tenant_id() AND app_is_host() AND app_purge_scope_on())
  WITH CHECK (tenant_id = app_tenant_id() AND app_is_host() AND app_purge_scope_on());

DROP POLICY IF EXISTS chat_thread_announcements_purge_scope_delete ON chat_thread_announcements;
CREATE POLICY chat_thread_announcements_purge_scope_delete ON chat_thread_announcements FOR DELETE TO app_tenant
  USING (tenant_id = app_tenant_id() AND app_is_host() AND app_purge_scope_on());
