-- ============================================================================
-- チャットのファイル: 取引先がいる部屋でも送れるようにする。2026-10-27、チャットレーン（担当: 紺野）。
-- `CLAUDE.md` §3.3 の改訂（チャット添付を ReviewGate の対象から外した。紺野の決定・宮田の承認。#182 /
-- `docs/chat-lane/external-attachments-proposal.md`）に合わせる。`docs/05` §3.7.1 / §6.5 #51p #51q。
-- ============================================================================
-- 🔴 この migration は既存の行を書き換えない（トリガと、その関数を外すだけ）。FORCE RLS は外さない。
-- 🔴 マージ済みの 20261027010000 / 20261027030000 は書き換えない。
--
-- 外すもの: 取引先がいる部屋（chat_threads.partner_company_id IS NOT NULL）への添付を拒んでいたトリガ
--    messages_internal_only_attachment と、その関数 messages_reject_partner_room_attachment（20261027010000 の 2.）。
-- 残すもの（変えない）:
--   - 誰がどの部屋の発言を読めるか = RLS（越境経路 3。ThreadParticipant + ThreadMember。1 部屋に取引先は最大 1 社）
--   - CLEAN でない添付は送った本人にしか見えない（RESTRICTIVE ポリシー messages_attachment_sender_only）
--   - 検査の状態は検査の関数だけが変えられ、添付のキー・種類・大きさは後から変えられない（messages_guard_attachment_update）
--   - 添付の 4 列の CHECK・種類と大きさの CHECK・attachment_key の UNIQUE
DROP TRIGGER IF EXISTS messages_internal_only_attachment ON messages;
DROP FUNCTION IF EXISTS messages_reject_partner_room_attachment();
