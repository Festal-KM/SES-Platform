-- ============================================================================
-- チャットのファイル（社内だけの部屋）の追補。2026-10-27、チャットレーン（担当: 紺野）。
-- 20261027010000_chat_attachments（PR #183 で main に入った）の後の変更をここに置く（🔴 マージ済みの migration は書き換えない）。
-- `docs/05` §3.7.1「ファイル（社内だけの部屋）」/ §6.5 #51 #51p〜#51r。
-- ============================================================================
-- 🔴 この migration は既存の行を書き換えない（関数の差し替え・GRANT の追加・関数の追加だけ）。FORCE RLS は外さない。
--
-- 2. 遅れて CLEAN になった発言の位置（Codex レビュー）
--    app_apply_scan_status が CLEAN にした発言の sent_at を公開した時点（適用した実時刻）まで進める（部屋の最終更新も揃える）。
--    そのために app_scan_probe に messages.sent_at の UPDATE を与える（列単位。本文・送った人・取引先には届かない）。
--    CREATE OR REPLACE なので所有者（app_scan_probe）と EXECUTE（app_tenant だけ）はそのまま残る。
-- 3. 放置されたアップロードの片付け（Codex レビュー）
--    usage.storage-reconcile が「このキーを指す発言があるか」を引く関数 app_chat_attachment_keys_in_use を足す
--    （app_scan_probe 所有・SECURITY DEFINER・テナント境界だけ。返すのは渡したキーのうち指されているものだけ）。
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

-- ----------------------------------------------------------------------------
-- 2. 遅れて CLEAN になった発言の位置
-- ----------------------------------------------------------------------------
GRANT UPDATE (sent_at) ON messages TO app_scan_probe;

CREATE OR REPLACE FUNCTION app_apply_scan_status(
  p_object_key  text,
  p_status      text,
  p_replaceable text[],
  p_observed_at timestamptz
) RETURNS TABLE (outcome text, previous_status text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $BODY$
DECLARE
  v_id      uuid;
  v_prev    text;
  v_thread  uuid;
  v_sent    timestamptz;
  v_updated integer;
BEGIN
  IF app_tenant_id() IS NULL THEN
    RAISE EXCEPTION 'app_apply_scan_status: テナント文脈がありません（app.tenant_id が未設定）';
  END IF;
  IF p_status = 'SCANNING' THEN
    RAISE EXCEPTION 'app_apply_scan_status: SCANNING は適用できません（docs/05 §8.5）';
  END IF;
  IF p_replaceable IS NULL OR cardinality(p_replaceable) = 0 THEN
    RAISE EXCEPTION 'app_apply_scan_status: 置き換え可能な現在値が空です';
  END IF;

  SELECT s.id, s.scan_status INTO v_id, v_prev
    FROM skill_sheets s
   WHERE s.tenant_id = app_tenant_id()
     AND s.object_key = p_object_key;

  IF FOUND THEN
    UPDATE skill_sheets
       SET scan_status    = p_status,
           scan_updated_at = p_observed_at,
           is_latest      = (is_latest AND p_status = 'CLEAN')
     WHERE id = v_id
       AND tenant_id = app_tenant_id()
       AND scan_status = ANY(p_replaceable);
    GET DIAGNOSTICS v_updated = ROW_COUNT;
    RETURN QUERY SELECT CASE WHEN v_updated = 1 THEN 'APPLIED' ELSE 'KEPT' END, v_prev;
    RETURN;
  END IF;

  -- ✅ 2026-10-27: チャットの添付（社内だけの部屋）。
  SELECT m.id, m.attachment_scan_status, m.thread_id, m.sent_at INTO v_id, v_prev, v_thread, v_sent
    FROM messages m
   WHERE m.tenant_id = app_tenant_id()
     AND m.attachment_key = p_object_key;

  IF NOT FOUND THEN
    -- 🔴 「見つからない」を 0 件更新（＝成功）に畳まない。呼び出し側が A-005 に出す。
    RETURN QUERY SELECT 'NOT_FOUND'::text, NULL::text;
    RETURN;
  END IF;

  -- ✅ 2026-10-27（レビュー）: 🔴 CLEAN になった発言は**公開した時点の位置**に置き直す（sent_at を適用した時刻まで進める）。
  --    🔴 検査の発生時刻（p_observed_at）ではなく**適用した実時刻**（clock_timestamp()）を使う。発生時刻は遅れて届くことがあり、
  --    その間に相手が読み進めていると、また既読より前に置かれてしまう。p_observed_at は検査の記録（skill_sheets.scan_updated_at 等）にだけ使う。
  --    送った時点の位置のままだと、検査中に相手が後ろの発言まで読んでいた場合に「既読より前」に現れ、未読にも数えられず、
  --    定期取得（after）でも拾われない。並び（sent_at, id）は会話・既読・未読で共通なので、ここを動かせば全部が揃う。
  --    送った本人の画面では自分の発言が下へ移る（受け入れる）。
  UPDATE messages
     SET attachment_scan_status = p_status,
         sent_at = CASE WHEN p_status = 'CLEAN' THEN GREATEST(sent_at, clock_timestamp()) ELSE sent_at END
   WHERE id = v_id
     AND tenant_id = app_tenant_id()
     AND attachment_scan_status = ANY(p_replaceable)
  RETURNING sent_at INTO v_sent;
  GET DIAGNOSTICS v_updated = ROW_COUNT;

  -- 🔴 相手に見えるようになった時点で、部屋の最終更新を進める（送った時点では進めていない。判断事項 4）。
  IF v_updated = 1 AND p_status = 'CLEAN' THEN
    UPDATE chat_threads
       SET last_message_at = GREATEST(last_message_at, v_sent)
     WHERE id = v_thread
       AND tenant_id = app_tenant_id();
  END IF;

  RETURN QUERY SELECT CASE WHEN v_updated = 1 THEN 'APPLIED' ELSE 'KEPT' END, v_prev;
END;
$BODY$;

-- ----------------------------------------------------------------------------
-- 3. 放置されたアップロードの片付け
-- ----------------------------------------------------------------------------
-- ✅ 2026-10-27（レビュー）: 放置されたアップロードの片付け（usage.storage-reconcile）が「このキーを指す発言があるか」を引く。
-- 🔴 返すのは渡したキーのうち発言が指しているものだけ（本文・送った人・部屋には触れない）。テナント文脈の fail-closed。
CREATE FUNCTION app_chat_attachment_keys_in_use(p_keys text[])
RETURNS TABLE (object_key text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $BODY$
BEGIN
  IF app_tenant_id() IS NULL THEN
    RAISE EXCEPTION 'app_chat_attachment_keys_in_use: テナント文脈がありません（app.tenant_id が未設定）';
  END IF;
  RETURN QUERY
    SELECT m.attachment_key
      FROM messages m
     WHERE m.tenant_id = app_tenant_id()
       AND m.attachment_key = ANY(p_keys);
END;
$BODY$;
GRANT CREATE ON SCHEMA public TO app_scan_probe;
ALTER FUNCTION app_chat_attachment_keys_in_use(text[]) OWNER TO app_scan_probe;
REVOKE CREATE ON SCHEMA public FROM app_scan_probe;
REVOKE ALL ON FUNCTION app_chat_attachment_keys_in_use(text[]) FROM PUBLIC;
-- 🔴 EXECUTE は app_tenant にだけ与える。ジョブ（apps/worker）も主平面と同じ app_tenant で接続する（LOGIN のロールは
--    app_migrator / app_tenant / app_platform / app_platform_write の 4 つだけで、ジョブ専用のロールは無い。app_scan_probe は
--    NOLOGIN の所有者）。app_apply_scan_status と同じ扱い。apps/** の業務コードからは呼べない（TenantDb に生 SQL が無く、
--    呼び出し元は packages/db/src/file-scan.ts の listChatAttachmentKeysInUse だけ。tests/static/auth-db-callers.test.ts）。
--    返すのは渡したキーのうち指されているものだけで、テナント文脈が無ければ拒む。
GRANT EXECUTE ON FUNCTION app_chat_attachment_keys_in_use(text[]) TO app_tenant;
COMMENT ON FUNCTION app_chat_attachment_keys_in_use(text[]) IS
  '2026-10-27: 放置されたチャットの添付の片付け（usage.storage-reconcile）。呼び出し元は packages/db/src/file-scan.ts のみ。';
