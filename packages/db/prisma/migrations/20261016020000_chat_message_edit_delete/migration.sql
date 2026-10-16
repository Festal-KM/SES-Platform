-- ============================================================================
-- チャットの発言の編集・削除（`messages.edited_at` / `deleted_at`）。2026-10-16、チャットレーン（担当: 紺野）。
-- docs/chat-lane/roadmap.md の 8。紺野の判断でマージ（チャットの表）。
-- ============================================================================
-- 🔴 判断事項 1: 削除は論理削除（行は残し、本文を NULL にして deleted_at を入れる）
--    取引先とのやり取りの記録であり、「何かが送られて消された」ことは残す（画面は「削除されました」）。
--    保持期限による削除（purged_at）とは別の列で書き分ける。
-- 🔴 判断事項 2: 本文の NULL を「保持期限の削除」か「本人の削除」のときだけ許す（CHECK を広げる）
-- 🔴 判断事項 3: 誰が編集・削除できるか（送った本人だけ）はアプリ（`apps/web/lib/chat/service.ts`）が決める。
--    既存の `messages_c6_update` は「スレッドの参加者」に UPDATE を開けているが、これまでアプリが発言を
--    書き換える経路は無かった。ポリシーを狭める（`sender_user_id = app_actor_user_id()` を AND する）と
--    保持期限の削除ジョブなど他の経路に効くため、本 migration では変えない —— PR で提案する。
-- 🔴 監査: 編集・削除は監査ログに記録する（CLAUDE.md §3.5「作成・更新・削除」）。本文は載せない。
ALTER TABLE messages ADD COLUMN IF NOT EXISTS edited_at timestamptz(3);
ALTER TABLE messages ADD COLUMN IF NOT EXISTS deleted_at timestamptz(3);

ALTER TABLE messages DROP CONSTRAINT IF EXISTS messages_body_purged_check;
ALTER TABLE messages
  ADD CONSTRAINT "messages_body_purged_check"
  CHECK ("body" IS NOT NULL OR "purged_at" IS NOT NULL OR "deleted_at" IS NOT NULL);
