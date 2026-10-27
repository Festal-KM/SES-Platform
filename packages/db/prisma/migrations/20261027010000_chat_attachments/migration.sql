-- ============================================================================
-- チャットのファイル（社内だけの部屋から）。2026-10-27、チャットレーン（担当: 紺野。決定は 2026-10-27）。
-- `docs/02` `F-038` 改訂 12 ⑫ / AC-14 / `docs/04` §S-031 改訂 44 / `docs/05` §3.7.1「ファイル（社内だけの部屋）」/ §6.5 #51 #51p〜#51r
-- ============================================================================
-- 既存の列 `messages.attachment_key` / `attachment_scan_status` を使い、種類（MIME）と大きさの 2 列を足す。
-- 🔴 この migration は既存の行を書き換えない（列を足し、制約・トリガ・ポリシー・関数を足すだけ）。
--    したがって FORCE ROW LEVEL SECURITY は外さない（HANDOFF.md §3.1 の罠は「既存行の UPDATE」のとき）。
--    添付の列はこれまでアプリが 1 度も書いていない（`lib/chat/service.ts` が受け付けていなかった）ので、
--    下の CHECK は既存の行（添付の 4 列がすべて NULL）で必ず成り立つ。
--
-- 🔴 判断事項 1: ファイル名を保存しない
--    氏名が入りうる（「山田太郎_職務経歴.pdf」）。スキルシートと同じ扱い（docs/05 §14.1）。列を作らない。
-- 🔴 判断事項 2: 取引先がいる部屋には添付を書かせない（アプリの 400 と、このトリガの二重）
--    取引先がいる部屋へのファイルは CLAUDE.md §3.3 の品質ゲート（チャット添付）と、ファイルの本文を取り出す工程が要る
--    （docs/chat-lane/attachments-proposal.md §3）。それまで DB でも書けないようにする。
-- 🔴 判断事項 3: `CLEAN` でない添付は、送った本人にしか行ごと見えない（RESTRICTIVE ポリシー）
--    AC-14「送った本人以外に行ごと見えず（存在・件数・種類・大きさを含む）」。アプリの読みの経路（一覧・窓・定期取得・
--    保存済み・アナウンス・書き出し・検索・未読の数）を 1 つずつ直すと必ず漏れるので、`messages` の読みそのものに
--    AND で重ねる（既存の C6 / 人の段のポリシーには触らない。RESTRICTIVE は既存の PERMISSIVE と AND で合成される）。
--    リアクション・保存・既読の表は `messages` を EXISTS で読むので、ここが効けばそれらにも見えない。
--    解約の削除スコープ（app_purge_scope_on()）だけは全行に届かなければならないので通す。
-- 🔴 判断事項 4: ウイルス検査の結果を `messages` にも適用する（app_scan_probe の 3 関数を広げる）
--    検査はアップロードした人のセッションと無関係に S3 のイベントで届く。ジョブのホスト文脈（systemTenantCtx。
--    利用者 ID は system）からは、DM / グループの発言が人の段（app_thread_member_ok）で 1 行も見えない。
--    スキルシートと同じ形（専用ロール + SECURITY DEFINER + 列単位 GRANT + テナント境界だけのポリシー）で開く。
--    🔴 緩むのは「同一テナント内の、添付の検査に要る列だけ」であり、本文（body）・送った人・取引先の列には届かない。
--    `messages` の UPDATE は継承トリガ（messages_inherit_owner。SECURITY INVOKER）が親の部屋を読むため、
--    `chat_threads` の 3 列の SELECT も要る（20260908000000 の engineers と同じ理由）。
--    `CLEAN` になったときに部屋の「最終更新」を進めるため、`chat_threads.last_message_at` の UPDATE も与える
--    （送った時点では進めない —— 進めると、相手の一覧の並びが動いて「何か送られた」ことが分かる）。
-- 🔴 判断事項 5: 関数は CREATE OR REPLACE で同じ引数・同じ戻り値の形のまま広げる
--    所有者（app_scan_probe）と EXECUTE の権限（app_tenant だけ）はそのまま残る。戻り値の列名 `skill_sheet_id` は
--    呼び出し側（packages/db/src/file-scan.ts / scan-notice.ts）の互換のため変えない（チャットの添付では発言の ID が入る）。
-- 🔴 判断事項 6: 運営者（app_platform）に新しい列を GRANT しない（CLAUDE.md §10.5。運営に要るのは件数・状態だけ）。
-- 🔴 判断事項 7: ストレージの計測（CLAUDE.md §10.6）。`attachment_storage_counted_at` は「この添付のバイト数が
--    `UsageCounter(STORAGE_BYTES)` に含まれているか」の状態（`skill_sheets.storage_counted_at` と同じ形）。
--    加算・減算は CAS（IS NULL / IS NOT NULL の条件付き UPDATE）が成立したときだけ起きる（packages/db/src/storage-usage.ts）。
-- 🔴 判断事項 8: 検査の状態を書き換えられるのは検査の関数（app_scan_probe）だけ。添付のキー・種類・大きさは
--    作った後に変えられない（解約の削除スコープだけが消せる）。アプリに UPDATE の経路が無くても DB で止める（二重）。

-- ----------------------------------------------------------------------------
-- 1. 列と制約
-- ----------------------------------------------------------------------------
ALTER TABLE "messages" ADD COLUMN "attachment_content_type" TEXT;
ALTER TABLE "messages" ADD COLUMN "attachment_byte_size" BIGINT;
ALTER TABLE "messages" ADD COLUMN "attachment_storage_counted_at" TIMESTAMPTZ(3);

-- 🔴 受け付ける種類は packages/domain の CHAT_ATTACHMENT_CONTENT_TYPES と同じ（tests/static/schema-enum-drift.test.ts が突き合わせる）。
ALTER TABLE "messages" ADD CONSTRAINT "messages_attachment_content_type_check" CHECK ("attachment_content_type" IN ('image/png', 'image/jpeg', 'image/webp', 'application/pdf', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'text/csv', 'text/plain'));
-- 1 ファイル 20 MiB まで（packages/domain の CHAT_ATTACHMENT_MAX_BYTES）。
ALTER TABLE "messages" ADD CONSTRAINT "messages_attachment_byte_size_check" CHECK ("attachment_byte_size" BETWEEN 1 AND 20971520);
-- 🔴 添付の 4 列は「全部ある」か「全部ない」か。名前は既存の messages_attachment_scan_status_check より後ろに並ぶ
--    （CHECK は名前の順に評価される。不正な状態値のときは従来どおり scan_status_check の名前で落ちる）。
ALTER TABLE "messages" ADD CONSTRAINT "messages_attachment_set_check" CHECK (
  ("attachment_key" IS NULL AND "attachment_scan_status" IS NULL AND "attachment_content_type" IS NULL AND "attachment_byte_size" IS NULL)
  OR ("attachment_key" IS NOT NULL AND "attachment_scan_status" IS NOT NULL AND "attachment_content_type" IS NOT NULL AND "attachment_byte_size" IS NOT NULL)
);

-- 計上済みの印は添付があるときだけ立つ（判断事項 7）。
ALTER TABLE "messages" ADD CONSTRAINT "messages_attachment_storage_counted_check" CHECK ("attachment_storage_counted_at" IS NULL OR "attachment_key" IS NOT NULL);

-- 検査の結果はオブジェクトキーでしか対象を引き当てられない（skill_sheets_object_key_key と同じ理由）。NULL は何件でもよい。
CREATE UNIQUE INDEX "messages_attachment_key_key" ON "messages"("attachment_key");

-- ----------------------------------------------------------------------------
-- 2. 取引先がいる部屋には添付を書かせない（判断事項 2）
-- ----------------------------------------------------------------------------
-- 🔴 SECURITY INVOKER（既定）: 書く人の RLS のまま部屋を読む。読めなければ（＝ 確かめられなければ）拒む（fail-closed）。
-- 🔴 名前は messages_inherit_owner より後ろ（BEFORE トリガは名前の順に動く）。継承トリガが確定させた
--    owner_partner_company_id も併せて見る（二重）。
CREATE FUNCTION messages_reject_partner_room_attachment() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $BODY$
DECLARE
  v_partner uuid;
BEGIN
  IF NEW.attachment_key IS NULL THEN
    RETURN NEW;
  END IF;
  SELECT t.partner_company_id INTO v_partner
    FROM chat_threads t
   WHERE t.id = NEW.thread_id
     AND t.tenant_id = NEW.tenant_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'messages_reject_partner_room_attachment: 部屋を確かめられないため添付を書けません（docs/05 §3.7.1）';
  END IF;
  IF v_partner IS NOT NULL OR NEW.owner_partner_company_id IS NOT NULL THEN
    RAISE EXCEPTION 'messages_reject_partner_room_attachment: 取引先がいる部屋には添付を書けません（docs/05 §3.7.1）';
  END IF;
  RETURN NEW;
END;
$BODY$;

CREATE TRIGGER messages_internal_only_attachment
  BEFORE INSERT OR UPDATE OF attachment_key, thread_id ON messages
  FOR EACH ROW EXECUTE FUNCTION messages_reject_partner_room_attachment();

-- ----------------------------------------------------------------------------
-- 2b. 検査の状態は検査の関数だけが変えられる・添付は作った後に変えられない（判断事項 8）
-- ----------------------------------------------------------------------------
-- 🔴 current_user は SECURITY DEFINER の関数の中では所有者（app_scan_probe）になる。トリガはそのロールで動く。
CREATE FUNCTION messages_guard_attachment_update() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $BODY$
BEGIN
  IF app_purge_scope_on() THEN
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

CREATE TRIGGER messages_guard_attachment_update
  BEFORE UPDATE OF attachment_key, attachment_scan_status, attachment_content_type, attachment_byte_size ON messages
  FOR EACH ROW EXECUTE FUNCTION messages_guard_attachment_update();

-- ----------------------------------------------------------------------------
-- 3. CLEAN でない添付は送った本人にだけ見える（判断事項 3）
-- ----------------------------------------------------------------------------
DROP POLICY IF EXISTS messages_attachment_sender_only ON messages;
CREATE POLICY messages_attachment_sender_only ON messages AS RESTRICTIVE FOR SELECT TO app_tenant
  USING (
    tenant_id = app_tenant_id()
    AND (
      attachment_key IS NULL
      OR attachment_scan_status = 'CLEAN'
      OR (app_actor_user_id() IS NOT NULL AND sender_user_id = app_actor_user_id())
      OR (app_is_host() AND app_purge_scope_on())
    )
  );

-- ----------------------------------------------------------------------------
-- 4. app_scan_probe に添付の検査に要る列だけを開く（判断事項 4）
-- ----------------------------------------------------------------------------
-- 🔴 列単位 GRANT。ここに列を足すことは「検査以外の情報が人の段・取引先の境界を越える」ことを意味する。
GRANT SELECT (id, tenant_id, thread_id, attachment_key, attachment_scan_status, sent_at) ON messages TO app_scan_probe;
GRANT UPDATE (attachment_scan_status) ON messages TO app_scan_probe;
GRANT SELECT (id, tenant_id, partner_company_id, last_message_at) ON chat_threads TO app_scan_probe;
GRANT UPDATE (last_message_at) ON chat_threads TO app_scan_probe;

-- 🔴 パートナー境界・人の段は課さないが、テナント境界は課す（skill_sheets_scan_probe_* と同じ形）。
DROP POLICY IF EXISTS messages_scan_probe_select ON messages;
CREATE POLICY messages_scan_probe_select ON messages FOR SELECT TO app_scan_probe
  USING (tenant_id = app_tenant_id());
DROP POLICY IF EXISTS messages_scan_probe_update ON messages;
CREATE POLICY messages_scan_probe_update ON messages FOR UPDATE TO app_scan_probe
  USING (tenant_id = app_tenant_id())
  WITH CHECK (tenant_id = app_tenant_id());
DROP POLICY IF EXISTS chat_threads_scan_probe_select ON chat_threads;
CREATE POLICY chat_threads_scan_probe_select ON chat_threads FOR SELECT TO app_scan_probe
  USING (tenant_id = app_tenant_id());
DROP POLICY IF EXISTS chat_threads_scan_probe_update ON chat_threads;
CREATE POLICY chat_threads_scan_probe_update ON chat_threads FOR UPDATE TO app_scan_probe
  USING (tenant_id = app_tenant_id())
  WITH CHECK (tenant_id = app_tenant_id());

-- ----------------------------------------------------------------------------
-- 5. 3 関数を messages.attachment_key にも広げる（判断事項 5）
-- ----------------------------------------------------------------------------
-- 🔴 skill_sheets で見つからなければ messages を引く。テナント文脈の fail-closed・SCANNING への巻き戻し禁止はそのまま。
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

  UPDATE messages
     SET attachment_scan_status = p_status
   WHERE id = v_id
     AND tenant_id = app_tenant_id()
     AND attachment_scan_status = ANY(p_replaceable);
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

-- 🔴 返すのは ID とキーだけ（チャットの添付では skill_sheet_id の列に発言の ID が入る。判断事項 5）。
CREATE OR REPLACE FUNCTION app_list_stalled_scan_targets(
  p_before timestamptz,
  p_limit  integer
) RETURNS TABLE (skill_sheet_id uuid, object_key text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $BODY$
BEGIN
  IF app_tenant_id() IS NULL THEN
    RAISE EXCEPTION 'app_list_stalled_scan_targets: テナント文脈がありません（app.tenant_id が未設定）';
  END IF;

  RETURN QUERY
    SELECT x.target_id, x.target_key
      FROM (
        SELECT s.id AS target_id, s.object_key AS target_key, s.uploaded_at AS target_at
          FROM skill_sheets s
         WHERE s.tenant_id = app_tenant_id()
           AND s.scan_status = 'SCANNING'
           AND s.uploaded_at <= p_before
        UNION ALL
        SELECT m.id, m.attachment_key, m.sent_at
          FROM messages m
         WHERE m.tenant_id = app_tenant_id()
           AND m.attachment_key IS NOT NULL
           AND m.attachment_scan_status = 'SCANNING'
           AND m.sent_at <= p_before
      ) x
     ORDER BY x.target_at ASC
     LIMIT LEAST(GREATEST(COALESCE(p_limit, 1), 1), 500);
END;
$BODY$;

-- 🔴 チャットの添付は所有側の列を返さない（NULL）。周知は送った本人への画面の表示だけで行い、メールを送らない
--    （packages/db/src/scan-notice.ts がキーの形で見分けて宛先を空にする）。
CREATE OR REPLACE FUNCTION app_scan_quarantine_target(p_object_key text)
RETURNS TABLE (
  skill_sheet_id           uuid,
  owner_partner_company_id uuid,
  scan_status              text
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $BODY$
BEGIN
  IF app_tenant_id() IS NULL THEN
    RAISE EXCEPTION 'app_scan_quarantine_target: テナント文脈がありません（app.tenant_id が未設定）';
  END IF;

  RETURN QUERY
    SELECT s.id, s.owner_partner_company_id, s.scan_status
      FROM skill_sheets s
     WHERE s.tenant_id = app_tenant_id()
       AND s.object_key = p_object_key;
  IF FOUND THEN
    RETURN;
  END IF;

  RETURN QUERY
    SELECT m.id, NULL::uuid, m.attachment_scan_status
      FROM messages m
     WHERE m.tenant_id = app_tenant_id()
       AND m.attachment_key = p_object_key;
END;
$BODY$;

COMMENT ON FUNCTION app_apply_scan_status(text, text, text[], timestamptz) IS
  'T-05-05 / 2026-10-27: スキャン結果の適用（skill_sheets / messages.attachment_key。docs/05 §8.5 / §9.6 / §3.7.1）。呼び出し元は packages/db/src/file-scan.ts のみ。';
COMMENT ON FUNCTION app_list_stalled_scan_targets(timestamptz, integer) IS
  'T-05-05 / 2026-10-27: SCANNING 滞留の照会（skill_sheets / messages.attachment_key。docs/05 §8.5 の保険）。呼び出し元は packages/db/src/file-scan.ts のみ。';
COMMENT ON FUNCTION app_scan_quarantine_target(text) IS
  'T-05-08 / 2026-10-27: 隔離の周知先を決めるための所有側の引き当て（チャットの添付は所有側を返さない）。呼び出し元は packages/db/src/scan-notice.ts のみ。';
