-- ============================================================================
-- 20261016050000_chat_people_rooms
-- 人単位の部屋（DM・グループ）。`CLAUDE.md` §3.1 経路 3 / §4.1（#128 で紺野・宮田が合意、2026-10-16）。
-- `docs/02` F-038 改訂 8 / `docs/04` S-031 改訂 39 / `docs/05` §3.7.1・C10 MEMBER。
--
-- 🔴 境界は会社の段（thread_participants・C6）のまま、その内側に人の段（chat_threads.member_user_ids）を
--    足して**絞る**。人の段は会社の段より広げられない（ポリシーは既存の式に AND で重ねるだけ）。
--
-- 🔴 docs/05 §3.7.1 は人の段を別表（`thread_members`）で書いたが、実装は**部屋の行の配列列**にした:
--    ① 別表にすると、`chat_threads` のポリシーが別表を、別表のポリシーが `chat_threads` を参照し合い、
--       PostgreSQL の「ポリシーの無限再帰」になる（`thread_participants` が C5 で自表しか見ないのと同じ理由）。
--    ② 配列なら `chat_threads` のポリシーは**自分の行だけ**で判定できる。他の表（messages /
--       thread_participants）は、専用ロールの SECURITY DEFINER 関数 `app_thread_member_ok` で問う
--       （§4.5 `app_engineer_is_shared` と同じ型）。
--    「辞めた人の DM は残す・引き継がない」（#128）なので、在籍の履歴を行で持つ必要は無い。
--
-- 🔴 「読める」の判定は**メンバーの有無ではなく `kind`** で行う。メンバーが空になった DM が
--    会社全員に開く壊れ方を作らない（`kind` が DM / GROUP なら、配列に自分が居ない限り読めない）。
-- ============================================================================

-- 🔴 FORCE は外さない: 本 migration にデータの UPDATE は無い（CHECK の検証は RLS を通らずに全行を見る）。

-- ----------------------------------------------------------------------------
-- 1. chat_threads: 種類・取引先なし・メンバー・DM の重複防止
-- ----------------------------------------------------------------------------
-- 🔴 同名 CHECK の再定義。`tests/static/schema-enum-drift.test.ts` の REDEFINED_CHECK_CONSTRAINTS に登録する。
ALTER TABLE chat_threads DROP CONSTRAINT IF EXISTS "chat_threads_kind_check";
ALTER TABLE chat_threads
  ADD CONSTRAINT "chat_threads_kind_check" CHECK ("kind" IN ('PROJECT', 'COMPANY', 'DM', 'GROUP'));

-- 社内だけの部屋（取引先を持たない）は DM / GROUP にだけ許す。
-- 🔴 NULL の部屋は C6 の取引先側の条件（= app_partner_id()）に当たらないので、取引先からは構造的に見えない。
ALTER TABLE chat_threads ALTER COLUMN partner_company_id DROP NOT NULL;
ALTER TABLE chat_threads
  ADD CONSTRAINT "chat_threads_partner_required_check"
  CHECK (partner_company_id IS NOT NULL OR "kind" IN ('DM', 'GROUP'));

-- 🔴 NULL ではなく空の配列で「メンバーを持たない」を表す（Prisma の配列は NULL を持てないため）。
ALTER TABLE chat_threads ADD COLUMN member_user_ids uuid[] NOT NULL DEFAULT '{}';
ALTER TABLE chat_threads ADD COLUMN title text;
ALTER TABLE chat_threads ADD COLUMN dm_key text;
ALTER TABLE chat_threads ADD COLUMN created_by_user_id uuid;

-- メンバーを持つのは DM / GROUP だけ。DM はちょうど 2 人、GROUP は 2 人以上（重複なしはアプリと
-- トリガで保証する。配列の重複を CHECK だけで書くと読みにくいため）。
ALTER TABLE chat_threads
  ADD CONSTRAINT "chat_threads_members_check"
  CHECK (
    ("kind" IN ('DM', 'GROUP')) = (cardinality(member_user_ids) > 0)
    AND ("kind" <> 'DM' OR cardinality(member_user_ids) = 2)
    AND ("kind" <> 'GROUP' OR cardinality(member_user_ids) >= 2)
  );
-- 同じ 2 人の DM は 1 つだけ（dm_key = 2 人の user_id を小さい順に ':' で連結）。
ALTER TABLE chat_threads
  ADD CONSTRAINT "chat_threads_dm_key_check" CHECK (("kind" = 'DM') = (dm_key IS NOT NULL));
CREATE UNIQUE INDEX "chat_threads_tenant_id_dm_key_key" ON chat_threads (tenant_id, dm_key);
-- グループの名前（100 文字まで。DM は相手の名前を出すので持たない）。
ALTER TABLE chat_threads
  ADD CONSTRAINT "chat_threads_title_check"
  CHECK (title IS NULL OR ("kind" = 'GROUP' AND char_length(title) BETWEEN 1 AND 100));
-- 自分の参加している部屋を引く（一覧）。
CREATE INDEX "chat_threads_member_user_ids_idx" ON chat_threads USING gin (member_user_ids);

COMMENT ON COLUMN chat_threads.member_user_ids IS
  '人の段（CLAUDE.md §3.1 経路 3）。DM / GROUP の読み手。参加会社の所属者に限る（chat_threads_members_party トリガ）。会社グループ・スレッドは空の配列';

-- messages は chat_threads.partner_company_id を継承する（inherit_owner_partner_company）。社内の部屋は NULL。
ALTER TABLE messages ALTER COLUMN owner_partner_company_id DROP NOT NULL;

-- ----------------------------------------------------------------------------
-- 2. メンバーの所属の検査（トリガ。アプリの検査と二重）
-- ----------------------------------------------------------------------------
-- 🔴 SECURITY INVOKER（既定）: 呼び出し元の RLS（users は C8 DIRECTORY）のまま利用者を読む。
--    取引先の文脈からは、別の取引先の利用者は見えない → 見つからない → 拒否（fail-closed）。
-- 規則:
--   ① メンバーに重複が無い・作成者（app_actor_user_id()）がメンバーに居る（INSERT のとき）
--   ② メンバーは全員このテナントの利用者で、所属が「ホスト（NULL）」か「この部屋の取引先」
--   ③ 社内の部屋（partner_company_id IS NULL）は全員ホスト
--   ④ 取引先との部屋には、ホストの人が 1 人以上居る（取引先の人どうしだけの部屋は作らない。#128）
CREATE FUNCTION chat_threads_check_members() RETURNS trigger
LANGUAGE plpgsql AS $BODY$
DECLARE
  member_count int;
  found_count  int;
  host_count   int;
BEGIN
  IF NEW."kind" NOT IN ('DM', 'GROUP') THEN
    RETURN NEW;
  END IF;
  member_count := cardinality(NEW.member_user_ids);
  IF member_count <> (SELECT count(DISTINCT m) FROM unnest(NEW.member_user_ids) AS m) THEN
    RAISE EXCEPTION 'chat_threads_check_members: メンバーに重複があります';
  END IF;
  IF TG_OP = 'INSERT' AND NOT (app_actor_user_id() = ANY (NEW.member_user_ids)) THEN
    RAISE EXCEPTION 'chat_threads_check_members: 作成者がメンバーに含まれていません';
  END IF;
  SELECT count(*), count(*) FILTER (WHERE u.owner_partner_company_id IS NULL)
    INTO found_count, host_count
    FROM users u
   WHERE u.tenant_id = NEW.tenant_id
     AND u.id = ANY (NEW.member_user_ids)
     AND (u.owner_partner_company_id IS NULL
          OR u.owner_partner_company_id IS NOT DISTINCT FROM NEW.partner_company_id);
  IF found_count <> member_count THEN
    RAISE EXCEPTION 'chat_threads_check_members: この部屋に入れない利用者が含まれています（所属の不一致、または参照できない利用者）';
  END IF;
  IF NEW.partner_company_id IS NOT NULL AND host_count = 0 THEN
    RAISE EXCEPTION 'chat_threads_check_members: 取引先との部屋には自社（ホスト）の人が 1 人以上必要です';
  END IF;
  RETURN NEW;
END;
$BODY$;

CREATE TRIGGER chat_threads_members_party BEFORE INSERT OR UPDATE OF member_user_ids, partner_company_id, "kind"
  ON chat_threads FOR EACH ROW EXECUTE FUNCTION chat_threads_check_members();

-- ----------------------------------------------------------------------------
-- 3. 専用ロール app_thread_probe と app_thread_member_ok（§4.5 app_engineer_is_shared と同じ型）
-- ----------------------------------------------------------------------------
-- 🔴 ロールの作成は packages/db/prisma/sql/000_roles.sql（NOLOGIN NOBYPASSRLS）。
GRANT USAGE ON SCHEMA public TO app_thread_probe;
-- 🔴 4 列だけ。本文・取引先・名前は読めない（真偽を答えるのに要る列だけ）。
GRANT SELECT (tenant_id, id, "kind", member_user_ids) ON chat_threads TO app_thread_probe;
DROP POLICY IF EXISTS chat_threads_thread_probe_select ON chat_threads;
CREATE POLICY chat_threads_thread_probe_select ON chat_threads FOR SELECT TO app_thread_probe
  USING (tenant_id = app_tenant_id());

GRANT CREATE ON SCHEMA public TO app_thread_probe;

-- 🔴 1 つの問い（この部屋の人の段を、いまの利用者が通れるか）に boolean で答える。行は返さない。
--    部屋が無い・テナント文脈が無い・利用者が無いときは false（COALESCE。fail-closed）。
-- 🔴 SECURITY DEFINER の SQL 関数はインライン展開されないので、内側の chat_threads は必ず
--    app_thread_probe の権限・ポリシーで評価される（呼び出し元のポリシーと再帰しない）。
CREATE FUNCTION app_thread_member_ok(th uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $BODY$
  SELECT COALESCE((
    SELECT t."kind" NOT IN ('DM', 'GROUP')
           OR (app_actor_user_id() IS NOT NULL AND app_actor_user_id() = ANY (t.member_user_ids))
      FROM chat_threads t
     WHERE t.tenant_id = app_tenant_id()
       AND t.id = th
  ), false)
$BODY$;
ALTER FUNCTION app_thread_member_ok(uuid) OWNER TO app_thread_probe;
REVOKE CREATE ON SCHEMA public FROM app_thread_probe;

-- 🔴 運営者（app_platform / app_platform_write）には与えない（チャットの中身に届く問いではないが、
--    運営者の経路に新しい関数を増やさない）。
REVOKE ALL ON FUNCTION app_thread_member_ok(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_thread_member_ok(uuid) TO app_tenant;

-- 🔴 「自分がメンバーの DM / GROUP か」（参加会社の行を作るときにだけ使う。§4-3）。
CREATE FUNCTION app_thread_is_my_room(th uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $BODY$
  SELECT COALESCE((
    SELECT t."kind" IN ('DM', 'GROUP')
           AND app_actor_user_id() IS NOT NULL AND app_actor_user_id() = ANY (t.member_user_ids)
      FROM chat_threads t
     WHERE t.tenant_id = app_tenant_id()
       AND t.id = th
  ), false)
$BODY$;
GRANT CREATE ON SCHEMA public TO app_thread_probe;
ALTER FUNCTION app_thread_is_my_room(uuid) OWNER TO app_thread_probe;
REVOKE CREATE ON SCHEMA public FROM app_thread_probe;
REVOKE ALL ON FUNCTION app_thread_is_my_room(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_thread_is_my_room(uuid) TO app_tenant;

COMMENT ON FUNCTION app_thread_member_ok(uuid) IS
  '2026-10-16（#128）: 越境経路 3 の人の段。部屋が DM / GROUP でないか、いまの利用者がメンバーなら true。呼び出し元は messages / thread_participants の C6 / C5 ポリシーのみ。';

-- ----------------------------------------------------------------------------
-- 4. ポリシー: 既存の式に人の段を AND で重ねる
-- ----------------------------------------------------------------------------
-- 4-1. chat_threads（自分の行の配列で判定する。関数を使わない）
-- 🔴 DM / GROUP は「参加会社の行」ではなく**メンバーかどうか**と「自社の部屋か」で決める:
--    ① 部屋 → 参加会社の順に作るので、参加会社の行で判定すると、作った直後の部屋が作成者（取引先）に
--       見えず、INSERT ... RETURNING が通らない。
--    ② メンバーはトリガで「ホスト or この部屋の取引先」の所属に限っているので、会社の段は
--       「ホスト、または partner_company_id が自社」で足りる（別の取引先の部屋は partner_company_id が違う）。
--    会社グループ・スレッドは従来の C6 のまま（人の段は掛からない）。
DO $do$
DECLARE
  company text := $$(
    app_is_host()
    OR (
      partner_company_id = app_partner_id()
      AND EXISTS (
        SELECT 1 FROM thread_participants p
        WHERE p.tenant_id = chat_threads.tenant_id
          AND p.thread_id = chat_threads.id
          AND p.partner_company_id = app_partner_id()
          AND p.left_at IS NULL
      )
    )
  )$$;
  expr text;
BEGIN
  expr := format(
    '(tenant_id = app_tenant_id() AND ('
    || '("kind" NOT IN (''DM'', ''GROUP'') AND %s)'
    || ' OR ("kind" IN (''DM'', ''GROUP'')'
    || ' AND app_actor_user_id() IS NOT NULL AND app_actor_user_id() = ANY (member_user_ids)'
    || ' AND (app_is_host() OR partner_company_id = app_partner_id()))))',
    company);
  EXECUTE 'DROP POLICY IF EXISTS chat_threads_c6_select ON chat_threads';
  EXECUTE 'DROP POLICY IF EXISTS chat_threads_c6_insert ON chat_threads';
  EXECUTE 'DROP POLICY IF EXISTS chat_threads_c6_update ON chat_threads';
  EXECUTE 'DROP POLICY IF EXISTS chat_threads_c6_delete ON chat_threads';
  EXECUTE format('CREATE POLICY chat_threads_c6_select ON chat_threads FOR SELECT TO app_tenant USING %s', expr);
  EXECUTE format('CREATE POLICY chat_threads_c6_insert ON chat_threads FOR INSERT TO app_tenant WITH CHECK %s', expr);
  EXECUTE format('CREATE POLICY chat_threads_c6_update ON chat_threads FOR UPDATE TO app_tenant USING %s WITH CHECK %s', expr, expr);
  EXECUTE format('CREATE POLICY chat_threads_c6_delete ON chat_threads FOR DELETE TO app_tenant USING %s', expr);
END
$do$;

-- 4-2. messages（C6 + 人の段）
DO $do$
DECLARE
  expr text := $$(
    tenant_id = app_tenant_id()
    AND (
      app_is_host()
      OR (
        owner_partner_company_id = app_partner_id()
        AND EXISTS (
          SELECT 1 FROM thread_participants p
          WHERE p.tenant_id = messages.tenant_id
            AND p.thread_id = messages.thread_id
            AND p.partner_company_id = app_partner_id()
            AND p.left_at IS NULL
        )
      )
    )
    AND app_thread_member_ok(thread_id)
  )$$;
BEGIN
  EXECUTE 'DROP POLICY IF EXISTS messages_c6_select ON messages';
  EXECUTE 'DROP POLICY IF EXISTS messages_c6_insert ON messages';
  EXECUTE 'DROP POLICY IF EXISTS messages_c6_update ON messages';
  EXECUTE 'DROP POLICY IF EXISTS messages_c6_delete ON messages';
  EXECUTE format('CREATE POLICY messages_c6_select ON messages FOR SELECT TO app_tenant USING %s', expr);
  EXECUTE format('CREATE POLICY messages_c6_insert ON messages FOR INSERT TO app_tenant WITH CHECK %s', expr);
  EXECUTE format('CREATE POLICY messages_c6_update ON messages FOR UPDATE TO app_tenant USING %s WITH CHECK %s', expr, expr);
  EXECUTE format('CREATE POLICY messages_c6_delete ON messages FOR DELETE TO app_tenant USING %s', expr);
END
$do$;

-- 4-3. thread_participants（C5 + 人の段）。🔴 部屋の存在（どの会社と DM があるか）も、メンバー以外に見せない。
DO $do$
DECLARE
  expr text := '(tenant_id = app_tenant_id() AND (app_is_host() OR partner_company_id = app_partner_id()) AND app_thread_member_ok(thread_id))';
BEGIN
  EXECUTE 'DROP POLICY IF EXISTS thread_participants_c5_select ON thread_participants';
  EXECUTE 'DROP POLICY IF EXISTS thread_participants_c5_insert ON thread_participants';
  EXECUTE 'DROP POLICY IF EXISTS thread_participants_c5_update ON thread_participants';
  EXECUTE 'DROP POLICY IF EXISTS thread_participants_c5_delete ON thread_participants';
  EXECUTE format('CREATE POLICY thread_participants_c5_select ON thread_participants FOR SELECT TO app_tenant USING %s', expr);
  -- 🔴 INSERT だけ: 自分がメンバーの DM / GROUP には、取引先の文脈からでもホストの行（NULL）を作れる
  --    （取引先の人が DM を開いたときに、会社の段をホスト側まで揃えるため）。別の取引先の行は作れない。
  EXECUTE 'CREATE POLICY thread_participants_c5_insert ON thread_participants FOR INSERT TO app_tenant WITH CHECK '
    || '(tenant_id = app_tenant_id() AND app_thread_member_ok(thread_id) AND ('
    || 'app_is_host() OR partner_company_id = app_partner_id()'
    || ' OR (partner_company_id IS NULL AND app_thread_is_my_room(thread_id))))';
  EXECUTE format('CREATE POLICY thread_participants_c5_update ON thread_participants FOR UPDATE TO app_tenant USING %s WITH CHECK %s', expr, expr);
  EXECUTE format('CREATE POLICY thread_participants_c5_delete ON thread_participants FOR DELETE TO app_tenant USING %s', expr);
END
$do$;

-- chat_read_states / chat_message_reactions は chat_threads / messages の可視性に連動している
-- （EXISTS で親を読む。20261016000000 / 20261016010000）ので、ここで変えなくても人の段が効く。
