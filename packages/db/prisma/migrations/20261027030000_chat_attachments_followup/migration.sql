-- ============================================================================
-- チャットのファイル（社内だけの部屋）の追補。2026-10-27、チャットレーン（担当: 紺野）。
-- 20261027010000_chat_attachments（PR #183 で main に入った）の後の変更をここに置く（🔴 マージ済みの migration は書き換えない）。
-- `docs/05` §3.7.1「ファイル（社内だけの部屋）」/ §6.5 #51 #51p〜#51r。
-- ============================================================================
-- 🔴 この migration は既存の行を書き換えない（関数の差し替え・GRANT の追加・関数の追加だけ）。FORCE RLS は外さない。
--
-- 1. 本人が発言を削除したら添付も外す（紺野の決定 A）
--    ガードのトリガ関数 messages_guard_attachment_update に狭い例外を足す: 削除済みの発言で、送った本人が、
--    添付の 4 列を**すべて NULL にする**ことだけはできる（packages/db/src/storage-usage.ts の releaseChatAttachmentOnDelete。
--    論理削除と同じトランザクション）。値を入れ直す・書き換えることはできない。トリガ本体（BEFORE UPDATE OF …）はそのまま。

CREATE OR REPLACE FUNCTION messages_guard_attachment_update() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $BODY$
BEGIN
  IF app_purge_scope_on() THEN
    RETURN NEW;
  END IF;
  -- ✅ 2026-10-27（紺野の決定 A）: 送った本人が削除した発言の添付は、本人が**すべて NULL にする**ことだけはできる
  --    （packages/db/src/storage-usage.ts の releaseChatAttachmentOnDelete。論理削除と同じトランザクション）。
  --    🔴 値を入れ直す・書き換えることはできない（外すだけ）。削除していない発言・他人の発言には効かない。
  IF OLD.deleted_at IS NOT NULL
     AND app_actor_user_id() IS NOT NULL AND OLD.sender_user_id = app_actor_user_id()
     AND NEW.attachment_key IS NULL AND NEW.attachment_content_type IS NULL
     AND NEW.attachment_byte_size IS NULL AND NEW.attachment_scan_status IS NULL THEN
    RETURN NEW;
  END IF;
  IF NEW.attachment_key IS DISTINCT FROM OLD.attachment_key
     OR NEW.attachment_content_type IS DISTINCT FROM OLD.attachment_content_type
     OR NEW.attachment_byte_size IS DISTINCT FROM OLD.attachment_byte_size THEN
    RAISE EXCEPTION 'messages_guard_attachment_update: 添付のキー・種類・大きさは後から変えられません（id=%）', OLD.id;
  END IF;
  IF NEW.attachment_scan_status IS DISTINCT FROM OLD.attachment_scan_status AND current_user <> 'app_scan_probe' THEN
    RAISE EXCEPTION 'messages_guard_attachment_update: 検査の状態は検査の関数だけが変えられます（id=%）', OLD.id;
  END IF;
  RETURN NEW;
END;
$BODY$;
