-- ============================================================================
-- チャットのスレッドのピン留め・ミュート（`chat_read_states.pinned` / `muted`）。2026-10-16、チャットレーン。
-- docs/chat-lane/roadmap.md の 26。紺野の判断でマージ（チャットの表）。
-- ============================================================================
-- 🔴 判断事項: 新しい表を作らず、既読位置の表（1 人 × 1 スレッド・C7 SELF）に列を足す
--    ピン留め・ミュートも「自分の表示の設定」であり、鍵（tenant × user × thread）も RLS（本人の行だけ・
--    スレッドが読めるときだけ書ける）も既読位置と同じ。表を分けると同じポリシーを 2 回書くことになる。
--    相手にも同僚にも見えない（C7）。
ALTER TABLE chat_read_states ADD COLUMN IF NOT EXISTS pinned boolean NOT NULL DEFAULT false;
ALTER TABLE chat_read_states ADD COLUMN IF NOT EXISTS muted  boolean NOT NULL DEFAULT false;
