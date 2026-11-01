-- ============================================================================
-- 20261101000000_chat_group_add_members
-- グループに後から人を足す。2026-11-01、チャットレーン（担当: 紺野。決定は 2026-10-29 / 11-01）。
-- `CLAUDE.md` §3.1 経路 3 / `docs/02` F-038 改訂 17 / `docs/04` S-031 改訂 48 / `docs/05` §3.7.1・#51h。
-- ============================================================================
-- 紺野の決定:
--   ・グループ（GROUP）のメンバーなら誰でも人を足せる。DM・会社グループ・案件スレッドには足せない。
--   ・足すときに、足した人が読める過去の範囲を選ぶ: 「これまでの発言をすべて」（既定）/「追加した時から」/「日付を指定」。
--     🔴 これは読み取りの境界であり、画面の出し分けではない（RLS で止める）。
--   ・足した人には、足した時点までの発言を未読として数えない（足した時点まで読んだのと同じ扱い）。
--     🔴 既読位置（chat_read_states）は本人だけが書く（CLAUDE.md §4.1）。足した人の要求で書かない。
--        代わりに「いつ入ったか」（joined_at）を持ち、未読は max(自分の既読位置, joined_at) から数える（アプリ）。
--   ・外す・抜けるはこの migration の範囲外（凍結のまま。足すことだけを開ける）。
--
-- 🔴 判断事項 1: 「入った時刻・読める範囲」は別の表 `chat_thread_member_windows` に置く（chat_threads に列を足さない）
--    chat_threads の行には凍結のトリガがあり、人の段は配列 1 本で判定している（20261016050000 の判断）。範囲は人ごとに違うので
--    配列には載らない。足した人 1 人に 1 行。🔴 最初からのメンバー（作った人と、作ったときに選ばれた人）には行が無い
--    = 部屋ができたときに入り、すべてが読める。
-- 🔴 判断事項 2: 行を作れるのは「そのグループのメンバー」が「まだメンバーでない人」についてだけ（INSERT の WITH CHECK）
--    → 既にいるメンバーの読める範囲を、ほかのメンバーが後から狭められない。
--    行は書き換えも消しもできない（app_tenant に UPDATE / DELETE を与えない）。
--    行だけ作ってメンバーに入れない（孤児の行）ことは、確定時（DEFERRABLE INITIALLY DEFERRED の制約トリガ）で拒否する。
-- 🔴 判断事項 3: chat_threads.member_user_ids の変更は「GROUP・足すだけ・足す人がいまメンバー・上限 50 人・
--    足した人全員に窓の行がある」ときだけ通す（凍結トリガを置き換える）。種類・DM の鍵・作成者・取引先は従来どおり凍結。
--    所属の検査（chat_threads_members_party）はそのまま効く（UPDATE OF member_user_ids で発火する）:
--      社内だけの部屋（partner_company_id IS NULL）にはホストの人だけ、取引先との部屋にはホストの人かその取引先の人だけ。
-- 🔴 判断事項 4: 同時に足しても片方が消えない
--    アプリは `member_user_ids = array_cat(member_user_ids, $足す人)`（Prisma の push）で 1 文で更新する。
--    同じ行の同時更新は PostgreSQL が後の側を待たせ、確定後の行で式を計算し直す（READ COMMITTED の EvalPlanQual）ので、
--    先に確定した追加は消えない。同じ人を同時に足したときの重複は、凍結トリガが並びを保ったまま取り除く
--    （トリガは名前順に動く: chat_threads_freeze_room → chat_threads_members_party の順。重複の検査より先に整える）。
--    窓の行は `ON CONFLICT DO NOTHING`（createMany の skipDuplicates）で、先に入った側の行が残る。
-- 🔴 判断事項 5: 読める範囲は messages の RESTRICTIVE ポリシー（SELECT）で止める
--    `app_thread_history_ok(thread_id, sent_at)` = 自分の窓の行があり、history_from が NULL でなく、発言がそれより前なら false。
--    既存の C6 + 人の段（PERMISSIVE）と AND で合成される（既存の式は書き換えない）。
--    関数は app_thread_probe の SECURITY DEFINER（app_thread_member_ok と同じ型。ポリシーの再帰を作らない）。
--    messages を読む表は、親の発言が読めるときだけ見える作りなので、同じ境界が効く:
--      ・chat_message_reactions（EXISTS messages。20261016010000）
--      ・chat_saved_messages（EXISTS messages。20261022010000）
--      ・添付（messages の列。添付の一覧・開く URL の発行は発言の行を読んでから。lib/chat/attachments.ts）
--      ・検索・書き出し・一覧の最後の発言・@ の印・未読の数（すべて messages 越し）
--    chat_thread_announcements の SELECT は部屋だけを見ていたので、「指した発言が読める」を RESTRICTIVE で足す（下の ⑤）。
--    🔴 受け入れた例外: ほかのメンバーが古い発言を「引用して返信」すると、引用の写しは新しい発言の本文に入る。
--       新しい発言は範囲の内側なので、足した人にも読める（docs/02 F-038 改訂 17 / PR に明記）。
-- 🔴 判断事項 6: 窓の行は本人だけが読める（C7 SELF）。ほかのメンバーには「その人がいつ入り、どこから読めるか」を見せない。
--    凍結トリガ・制約トリガが要る問いは、app_thread_probe の SECURITY DEFINER 関数が真偽だけで答える。
-- 🔴 判断事項 7: 解約（PURGED）では残す（ID と時刻だけ。個人情報・本文を含まない。PURGE_SPEC.retain）。
-- 🔴 判断事項 8: 運営者（app_platform）に GRANT しない（CLAUDE.md §10.5。運営に要るのは件数・状態・エラーだけ）。
-- 🔴 既存の migration は書き換えない（関数は CREATE OR REPLACE、ポリシーは足すだけ）。
-- ============================================================================

-- ----------------------------------------------------------------------------
-- ① 表
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS chat_thread_member_windows (
  id                uuid PRIMARY KEY,
  tenant_id         uuid NOT NULL,
  thread_id         uuid NOT NULL,
  user_id           uuid NOT NULL,
  -- 入った時刻。🔴 トリガが DB の now() で上書きする（足す人が入力で過去・未来にずらせない）。
  joined_at         timestamptz(3) NOT NULL DEFAULT now(),
  -- 読める範囲の始まり。NULL = これまでの発言をすべて読める。🔴 joined_at より後ろにはしない（トリガが丸める）。
  history_from      timestamptz(3),
  added_by_user_id  uuid NOT NULL,
  CONSTRAINT chat_thread_member_windows_history_check CHECK (history_from IS NULL OR history_from <= joined_at)
);

CREATE UNIQUE INDEX IF NOT EXISTS chat_thread_member_windows_tenant_id_thread_id_user_id_key
  ON chat_thread_member_windows (tenant_id, thread_id, user_id);

ALTER TABLE "chat_thread_member_windows" ADD CONSTRAINT "chat_thread_member_windows_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "chat_thread_member_windows" ADD CONSTRAINT "chat_thread_member_windows_thread_id_fkey" FOREIGN KEY ("thread_id") REFERENCES "chat_threads"("id") ON DELETE CASCADE ON UPDATE CASCADE;

COMMENT ON TABLE chat_thread_member_windows IS
  '2026-11-01 チャットレーン: グループに後から足した人の「入った時刻」と「読める範囲の始まり」。1 人 1 行。最初からのメンバーには行が無い（すべて読める）。本人だけが読む。書き換え・削除はできない。';

-- ----------------------------------------------------------------------------
-- ② app_thread_probe に要る列だけを開く（列単位の GRANT。表単位は与えない。rls-enforced #10）
-- ----------------------------------------------------------------------------
GRANT SELECT (tenant_id, thread_id, user_id, history_from) ON chat_thread_member_windows TO app_thread_probe;
DROP POLICY IF EXISTS chat_thread_member_windows_thread_probe_select ON chat_thread_member_windows;
CREATE POLICY chat_thread_member_windows_thread_probe_select ON chat_thread_member_windows FOR SELECT TO app_thread_probe
  USING (tenant_id = app_tenant_id());

GRANT CREATE ON SCHEMA public TO app_thread_probe;

-- 「この人を、このグループに足せるか」: 部屋が GROUP・呼び出し元がいまメンバー・その人はまだメンバーでない。
CREATE FUNCTION app_thread_can_add_member(th uuid, member uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $BODY$
  SELECT COALESCE((
    SELECT t."kind" = 'GROUP'
           AND app_actor_user_id() IS NOT NULL
           AND app_actor_user_id() = ANY (t.member_user_ids)
           AND NOT (member = ANY (t.member_user_ids))
      FROM chat_threads t
     WHERE t.tenant_id = app_tenant_id()
       AND t.id = th
  ), false)
$BODY$;
ALTER FUNCTION app_thread_can_add_member(uuid, uuid) OWNER TO app_thread_probe;

-- 「この人は、いまこの部屋のメンバーか」（窓の行の確定時の検査）。
CREATE FUNCTION app_thread_has_member(th uuid, member uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $BODY$
  SELECT COALESCE((
    SELECT member = ANY (t.member_user_ids)
      FROM chat_threads t
     WHERE t.tenant_id = app_tenant_id()
       AND t.id = th
  ), false)
$BODY$;
ALTER FUNCTION app_thread_has_member(uuid, uuid) OWNER TO app_thread_probe;

-- 「足した人全員に窓の行があるか」（凍結トリガの検査）。空の配列なら true。
CREATE FUNCTION app_thread_windows_ready(th uuid, members uuid[]) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $BODY$
  SELECT NOT EXISTS (
    SELECT 1
      FROM unnest(members) AS m(id)
     WHERE NOT EXISTS (
       SELECT 1 FROM chat_thread_member_windows w
        WHERE w.tenant_id = app_tenant_id()
          AND w.thread_id = th
          AND w.user_id = m.id
     )
  )
$BODY$;
ALTER FUNCTION app_thread_windows_ready(uuid, uuid[]) OWNER TO app_thread_probe;

-- 🔴 読める範囲: 呼び出し元の窓の行があり、範囲の始まりより前の発言なら false。行が無い（最初からのメンバー・
--    会社グループ・案件スレッド・利用者の無い文脈）なら true（ほかのポリシーが決める）。
CREATE FUNCTION app_thread_history_ok(th uuid, sent timestamptz) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $BODY$
  SELECT COALESCE((
    SELECT sent >= w.history_from
      FROM chat_thread_member_windows w
     WHERE w.tenant_id = app_tenant_id()
       AND w.thread_id = th
       AND w.user_id = app_actor_user_id()
       AND w.history_from IS NOT NULL
  ), true)
$BODY$;
ALTER FUNCTION app_thread_history_ok(uuid, timestamptz) OWNER TO app_thread_probe;
REVOKE CREATE ON SCHEMA public FROM app_thread_probe;

-- 🔴 運営者（app_platform / app_platform_write）には与えない。
REVOKE ALL ON FUNCTION app_thread_can_add_member(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION app_thread_has_member(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION app_thread_windows_ready(uuid, uuid[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION app_thread_history_ok(uuid, timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_thread_can_add_member(uuid, uuid) TO app_tenant;
GRANT EXECUTE ON FUNCTION app_thread_has_member(uuid, uuid) TO app_tenant;
GRANT EXECUTE ON FUNCTION app_thread_windows_ready(uuid, uuid[]) TO app_tenant;
GRANT EXECUTE ON FUNCTION app_thread_history_ok(uuid, timestamptz) TO app_tenant;

COMMENT ON FUNCTION app_thread_history_ok(uuid, timestamptz) IS
  '2026-11-01: グループに後から足した人の読める範囲。呼び出し元の窓の行の history_from より前の発言なら false。呼び出し元は messages の RESTRICTIVE ポリシー messages_member_history_window のみ。';

-- ----------------------------------------------------------------------------
-- ③ 窓の表の RLS（本人だけが読む・メンバーが「まだいない人」について作る・書き換え / 削除は無い）
-- ----------------------------------------------------------------------------
ALTER TABLE chat_thread_member_windows ENABLE ROW LEVEL SECURITY;
ALTER TABLE chat_thread_member_windows FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS chat_thread_member_windows_c7_select ON chat_thread_member_windows;
CREATE POLICY chat_thread_member_windows_c7_select ON chat_thread_member_windows FOR SELECT TO app_tenant
  USING (tenant_id = app_tenant_id() AND app_actor_user_id() IS NOT NULL AND user_id = app_actor_user_id());

DROP POLICY IF EXISTS chat_thread_member_windows_member_insert ON chat_thread_member_windows;
CREATE POLICY chat_thread_member_windows_member_insert ON chat_thread_member_windows FOR INSERT TO app_tenant
  WITH CHECK (
    tenant_id = app_tenant_id()
    AND app_actor_user_id() IS NOT NULL
    AND added_by_user_id = app_actor_user_id()
    AND app_thread_can_add_member(thread_id, user_id)
  );

-- 🔴 SELECT と INSERT だけ（UPDATE / DELETE を与えない = 範囲を後から変えられない）。
GRANT SELECT, INSERT ON chat_thread_member_windows TO app_tenant;

-- 入った時刻は DB の時刻。範囲の始まりは入った時刻より後ろにしない（「追加した時から」でアプリの時計が進んでいても丸める）。
CREATE FUNCTION chat_thread_member_windows_stamp() RETURNS trigger
LANGUAGE plpgsql AS $BODY$
BEGIN
  NEW.joined_at := now();
  IF NEW.history_from IS NOT NULL AND NEW.history_from > NEW.joined_at THEN
    NEW.history_from := NEW.joined_at;
  END IF;
  RETURN NEW;
END;
$BODY$;

CREATE TRIGGER chat_thread_member_windows_stamp BEFORE INSERT ON chat_thread_member_windows
  FOR EACH ROW EXECUTE FUNCTION chat_thread_member_windows_stamp();

-- 🔴 確定時に、窓の行の人が部屋のメンバーになっているか（行だけ作って入れない孤児の行を残さない）。
CREATE FUNCTION chat_thread_member_windows_require_member() RETURNS trigger
LANGUAGE plpgsql AS $BODY$
BEGIN
  IF NOT app_thread_has_member(NEW.thread_id, NEW.user_id) THEN
    RAISE EXCEPTION 'chat_thread_member_windows_require_member: 窓の行の人が部屋のメンバーになっていません（thread=%）', NEW.thread_id;
  END IF;
  RETURN NULL;
END;
$BODY$;

CREATE CONSTRAINT TRIGGER chat_thread_member_windows_require_member
  AFTER INSERT ON chat_thread_member_windows
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION chat_thread_member_windows_require_member();

-- ----------------------------------------------------------------------------
-- ④ 凍結トリガの置き換え: グループに「足す」ことだけを開ける
-- ----------------------------------------------------------------------------
-- 🔴 利用者の無い文脈（削除スコープ・superuser）からはメンバーを変えられない（fail-closed）。
CREATE OR REPLACE FUNCTION chat_threads_freeze_room() RETURNS trigger
LANGUAGE plpgsql AS $BODY$
DECLARE
  added uuid[];
BEGIN
  IF NEW."kind" IS DISTINCT FROM OLD."kind"
     OR NEW.dm_key IS DISTINCT FROM OLD.dm_key
     OR NEW.created_by_user_id IS DISTINCT FROM OLD.created_by_user_id
     OR NEW.partner_company_id IS DISTINCT FROM OLD.partner_company_id THEN
    RAISE EXCEPTION 'chat_threads_freeze_room: 部屋の種類・メンバー・取引先は後から変えられません（id=%）', OLD.id;
  END IF;
  IF NEW.member_user_ids IS DISTINCT FROM OLD.member_user_ids THEN
    IF OLD."kind" <> 'GROUP' THEN
      RAISE EXCEPTION 'chat_threads_freeze_room: グループ以外の部屋のメンバーは変えられません（id=%）', OLD.id;
    END IF;
    IF app_actor_user_id() IS NULL OR NOT (app_actor_user_id() = ANY (OLD.member_user_ids)) THEN
      RAISE EXCEPTION 'chat_threads_freeze_room: メンバーを足せるのはそのグループのメンバーだけです（id=%）', OLD.id;
    END IF;
    -- 同時に同じ人を足したときの重複を、最初に現れた順を保って取り除く（判断事項 4）。
    NEW.member_user_ids := ARRAY(
      SELECT u.m FROM unnest(NEW.member_user_ids) WITH ORDINALITY AS u(m, o) GROUP BY u.m ORDER BY min(u.o)
    );
    IF NOT (OLD.member_user_ids <@ NEW.member_user_ids) THEN
      RAISE EXCEPTION 'chat_threads_freeze_room: メンバーを外すことはできません（id=%）', OLD.id;
    END IF;
    -- 🔴 apps/web/lib/chat/rooms.ts の CHAT_GROUP_MAX_MEMBERS と同じ値。
    IF cardinality(NEW.member_user_ids) > 50 THEN
      RAISE EXCEPTION 'chat_threads_freeze_room: グループの人数の上限（50 人）を超えます（id=%）', OLD.id;
    END IF;
    added := ARRAY(SELECT m FROM unnest(NEW.member_user_ids) AS m WHERE NOT (m = ANY (OLD.member_user_ids)));
    IF NOT app_thread_windows_ready(OLD.id, added) THEN
      RAISE EXCEPTION 'chat_threads_freeze_room: 足した人の読める範囲の行がありません（id=%）', OLD.id;
    END IF;
  END IF;
  RETURN NEW;
END;
$BODY$;

-- ----------------------------------------------------------------------------
-- ⑤ 読める範囲（RESTRICTIVE。既存の PERMISSIVE と AND で合成される）
-- ----------------------------------------------------------------------------
DROP POLICY IF EXISTS messages_member_history_window ON messages;
CREATE POLICY messages_member_history_window ON messages AS RESTRICTIVE FOR SELECT TO app_tenant
  USING (tenant_id = app_tenant_id() AND (app_thread_history_ok(thread_id, sent_at) OR (app_is_host() AND app_purge_scope_on())));

-- アナウンスは「指した発言が読める」ときだけ（範囲の外の発言を指すアナウンスを、足した人に見せない）。
-- 🔴 サブクエリは呼び出し側のロールで評価される = messages の RLS（C6・人の段・添付・上の範囲）がすべて効く。
DROP POLICY IF EXISTS chat_thread_announcements_message_visible ON chat_thread_announcements;
CREATE POLICY chat_thread_announcements_message_visible ON chat_thread_announcements AS RESTRICTIVE FOR SELECT TO app_tenant
  USING (
    tenant_id = app_tenant_id()
    AND (
      EXISTS (
        SELECT 1 FROM messages m
        WHERE m.id = chat_thread_announcements.message_id AND m.tenant_id = app_tenant_id()
      )
      OR (app_is_host() AND app_purge_scope_on())
    )
  );
