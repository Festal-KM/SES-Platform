-- T-02-08（docs/sprints/SP-02-schema-isolation.md）: オーナー列 / 当事者列の継承・freeze トリガ。
-- 一次資料: docs/05 §4.4.1（トリガ設計）/ P-A-11 / CLAUDE.md §3.1。
--
-- 🔴 このファイルが継承・freeze の唯一の実装である。アプリに「オーナー列 / 当事者列を計算させる」
--    経路を作らない（呼び出し側の指定値は必ずここで上書きされる。docs/05 §4.4.1）。
--
-- 対象（docs/05 §4.4.1 の一覧そのもの）:
--   オーナー列（owner_partner_company_id）
--     根 4 表（BEFORE UPDATE で不変）: users / engineers / proposals / tasks
--     子 7 表（BEFORE INSERT OR UPDATE で親の値に強制）:
--       engineer_skills / skill_sheets ← engineers(engineer_id)
--       skill_sheet_extractions       ← skill_sheets(skill_sheet_id)
--       engineer_snapshots / proposal_events ← proposals(proposal_id)
--       messages                       ← chat_threads(thread_id)（親列は partner_company_id）
--       review_gates                   ← CASE（target_type による多相継承）
--   当事者列（counterparty_partner_company_id）
--     根 1 表（BEFORE UPDATE で不変）: contracts
--     子 3 表（BEFORE INSERT OR UPDATE で親の値に強制）:
--       assignments        ← engineers(engineer_id).owner_partner_company_id
--       contract_documents ← contracts(contract_id)
--       orders             ← CASE(contract_id IS NOT NULL → contracts / ELSE → assignments)
--
-- 🔴 判断事項 1（programmer 判断。code-reviewer 確認事項）: 第 2 防御（scope-injection.ts）で
--    オーナー列 / 当事者列の偽装 INSERT を事前拒否する経路は追加しない。理由:
--    ① docs/05 §4.1 の第 2 防御は「テナントキー」に対する規律として定義されており
--       （ctx が唯一の正しい値を直接知っている）、オーナー列 / 当事者列は ctx から直接
--       決まらない（親行を引かないと正しい値が分からない。host が proposals.ownerPartnerCompanyId
--       に NULL でない値を書く／読むのが正当なケースが普通にあるため、ctx.partnerCompanyId との
--       単純な不一致判定は false positive を生む）。
--    ② 正しい値を得るには DB 往復（親行の参照）が要り、これを TypeScript 側で複製するのは
--       DB トリガの二重実装になる。
--    ③ 本トリガ（第 1 防御 = RLS の WITH CHECK と組み合わさる）で「呼び出し側の指定値を採用しない」
--       が構造的に保証される。偽装した値を INSERT しても DB が常に親の値で上書きするため、
--       アプリ層に事前拒否ロジックを重ねる実益が薄い。
--    したがって、オーナー列 / 当事者列の完全性は本トリガのみが担う（テナントキーの二重防御とは
--    非対称だが、意図的な非対称である）。
--
-- 🔴 判断事項 2（docs/05 §4.4.1 / P-A-19 として文書化済み）: assignments ←
--    engineers(engineer_id) の継承だけは SECURITY INVOKER の素朴なルックアップでは実装できない。
--    engineers は C3 OWNER_SCOPED であり、ホスト文脈（app_partner_id() IS NULL）から見えるのは
--    owner_partner_company_id IS NULL の行だけ（CLAUDE.md §3.1 経路 2「パートナーのエンジニア
--    台帳全体をホストが読むことはできない」）。しかし assignments は C2 HOST_ONLY（書込はホストの
--    みで、パートナー所属エンジニアを案件に稼働させるのが通常業務）であるため、素の SECURITY
--    INVOKER 実装だと正当なホストの操作（パートナー所属エンジニアの Assignment 作成・更新）が
--    ことごとく「親が見えない」で RAISE してしまう（tests/isolation/route5-counterparty.test.ts の
--    ホスト文脈 UPDATE で実測）。§4.5 の app_share_probe と同型の「専用ロール + SECURITY DEFINER +
--    最小列 GRANT」を踏襲しつつ、engineers.owner_partner_company_id だけを読める
--    app_assignment_owner_probe を新設した（packages/db/prisma/sql/000_roles.sql）。
--    🔴 app_share_probe との相違点（§8 のコメントで詳述）: app_share_probe が SECURITY DEFINER に
--    するのは**通常の SQL 関数**（`app_engineer_is_shared`。GRANT EXECUTE 経由で app_tenant から
--    直接呼び出せる。呼び出し元の限定は ESLint）であるのに対し、本件は**トリガ関数そのもの**
--    （`inherit_assignment_counterparty`）を SECURITY DEFINER にした。トリガ関数は通常の関数呼び出し
--    （`SELECT fn(...)`）の戻り値型として使えないため、app_tenant セッションがこれを直接呼び出して
--    他パートナーの engineers.owner_partner_company_id を探索する経路が型レベルで存在しない
--    （パートナー間相互参照 CLAUDE.md §3.1 の 🔴 に直結するため、ESLint ではなく DB レベルで
--    到達不能にした）。
--    他の 9 relationship はすべて「host が無条件で親を見られる」クラス（C2 / C5 / C6）か、
--    「書き手が常に親の所有者と同一パートナーである」自己完結ケース（C3 の子表）であり、
--    この特別扱いは不要（本ファイル各所のコメントで根拠を示す）。

-- ============================================================================
-- 1. 汎用関数（root 4 表 + freeze / 単純な 1 親を持つ子 7 表のうち 6 表分）
-- ============================================================================

-- 🔴 NEW.<target_column> を親の値で必ず上書きする（呼び出し側の指定値を採用しない）。
--    親が見つからない（存在しない、または現在の分離文脈の RLS で見えない）なら RAISE EXCEPTION。
-- 引数（TG_ARGV。すべて trigger 定義時の文字列リテラル。呼び出し側の実行時入力は一切使わない）:
--   [0] parent_table   … 親テーブル名（必須）
--   [1] fk_column      … 子テーブル上の FK 列名（親の id を指す。必須）
--   [2] target_column  … 子テーブル上で上書きする列名（省略時 'owner_partner_company_id'）
--   [3] source_column  … 親テーブル上で読む列名（省略時 target_column と同じ）
CREATE FUNCTION inherit_owner_partner_company() RETURNS trigger
LANGUAGE plpgsql AS $BODY$
DECLARE
  parent_table  text := TG_ARGV[0];
  fk_column     text := TG_ARGV[1];
  target_column text := COALESCE(NULLIF(TG_ARGV[2], ''), 'owner_partner_company_id');
  source_column text := COALESCE(NULLIF(TG_ARGV[3], ''), target_column);
  fk_value      uuid;
  parent_value  uuid;
  matched_rows  int;
BEGIN
  fk_value := (to_jsonb(NEW) ->> fk_column)::uuid;
  IF fk_value IS NULL THEN
    RAISE EXCEPTION 'inherit_owner_partner_company: %.% の継承元 FK 列 % が NULL です（docs/05 §4.4.1）',
      TG_TABLE_NAME, target_column, fk_column;
  END IF;

  -- 🔴 SECURITY INVOKER（既定。属性を明示しない）: 呼び出し元セッションの RLS 文脈のまま親を読む。
  --    親が現在の分離文脈で見えなければ 0 行になり、NOT FOUND で RAISE する（見えない親には
  --    子をぶら下げられない。docs/05 §4.4「WITH CHECK の既定は USING と同じ式」の前提）。
  -- 🔴 動的 SQL の EXECUTE ... INTO は PL/pgSQL の FOUND を更新しない（静的な SELECT INTO だけが
  --    FOUND を更新する。実測で「値は正しく取れるが FOUND が常に偽」を確認した）。
  --    GET DIAGNOSTICS ... ROW_COUNT で件数を明示的に取る。
  EXECUTE format('SELECT %I FROM %I WHERE id = $1 AND tenant_id = $2', source_column, parent_table)
    INTO parent_value
    USING fk_value, NEW.tenant_id;
  GET DIAGNOSTICS matched_rows = ROW_COUNT;

  IF matched_rows = 0 THEN
    RAISE EXCEPTION
      'inherit_owner_partner_company: %（id=%, tenant_id=%）が見つからないか、現在の分離文脈では参照できません（%.% の継承元。docs/05 §4.4.1）',
      parent_table, fk_value, NEW.tenant_id, TG_TABLE_NAME, target_column;
  END IF;

  -- 🔴 NEW の該当列だけを動的に上書きする（他列は base である NEW の値をそのまま保持する。
  --    jsonb_populate_record の「base + 差分」セマンティクス）。
  NEW := jsonb_populate_record(NEW, jsonb_build_object(target_column, parent_value));
  RETURN NEW;
END;
$BODY$;

-- 🔴 根 4 表（users / engineers / proposals / tasks）を BEFORE UPDATE で不変にする。
--    引数省略時は 'owner_partner_company_id' を検査する（既定）。
CREATE FUNCTION freeze_owner_partner_company() RETURNS trigger
LANGUAGE plpgsql AS $BODY$
DECLARE
  target_column text := COALESCE(NULLIF(TG_ARGV[0], ''), 'owner_partner_company_id');
  old_value     uuid;
  new_value     uuid;
BEGIN
  old_value := (to_jsonb(OLD) ->> target_column)::uuid;
  new_value := (to_jsonb(NEW) ->> target_column)::uuid;
  IF new_value IS DISTINCT FROM old_value THEN
    RAISE EXCEPTION
      'freeze_owner_partner_company: % は不変です（%.id=%, old=%, new=%）（docs/05 §4.4.1）',
      target_column, TG_TABLE_NAME, OLD.id, old_value, new_value;
  END IF;
  RETURN NEW;
END;
$BODY$;

-- ============================================================================
-- 2. オーナー列の根 4 表: BEFORE UPDATE で不変
-- ============================================================================
DO $do$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['users', 'engineers', 'proposals', 'tasks'] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS %I ON %I', t || '_freeze_owner', t);
    EXECUTE format(
      'CREATE TRIGGER %I BEFORE UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION freeze_owner_partner_company()',
      t || '_freeze_owner', t
    );
  END LOOP;
END
$do$;

-- ============================================================================
-- 3. オーナー列の子 5 表（単純な 1 親。engineer_skills / skill_sheets / skill_sheet_extractions /
--    engineer_snapshots / proposal_events）: BEFORE INSERT OR UPDATE で親の値に強制
-- ============================================================================
-- 🔴 いずれも「書き手は常に親の所有者（またはホスト所有の親ならホスト）と同一パートナーである」
--    自己完結ケースであり、SECURITY INVOKER のままで正しく機能する:
--      engineer_skills / skill_sheets ← engineers … C3 の WITH CHECK も同じ式のため、
--        他パートナーの engineers に書こうとする操作自体が RLS で拒否される対象であり、
--        「親が見えないので RAISE」で先に落ちても実害（本来できるべき操作が壊れる）は無い。
--      skill_sheet_extractions ← skill_sheets … 同上。
--      engineer_snapshots / proposal_events ← proposals … proposals は C5 PARTY で
--        ホストは全 proposals を無条件に読める（app_is_host() の OR 分岐）ため、
--        ホストが作成する EngineerSnapshot / ProposalEvent でも親が必ず見える。
DO $do$
DECLARE
  r record;
BEGIN
  FOR r IN SELECT * FROM (VALUES
      ('engineer_skills',         'engineers',    'engineer_id'),
      ('skill_sheets',            'engineers',    'engineer_id'),
      ('skill_sheet_extractions', 'skill_sheets', 'skill_sheet_id'),
      ('engineer_snapshots',      'proposals',    'proposal_id'),
      ('proposal_events',         'proposals',    'proposal_id')
    ) AS v(child_table, parent_table, fk_column)
  LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS %I ON %I', r.child_table || '_inherit_owner', r.child_table);
    EXECUTE format(
      'CREATE TRIGGER %I BEFORE INSERT OR UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION inherit_owner_partner_company(%L, %L)',
      r.child_table || '_inherit_owner', r.child_table, r.parent_table, r.fk_column
    );
  END LOOP;
END
$do$;

-- 🔴 messages ← chat_threads(thread_id): 親の列名が owner_partner_company_id ではなく
--    partner_company_id（chat_threads 自体の <O>。docs/05 §4.4 C6）であるため、
--    target_column / source_column を明示する。chat_threads は C6 THREAD で
--    ホストは無条件に全 chat_threads を読めるため（app_is_host() の OR 分岐）、
--    ホストが送るメッセージでも親が必ず見える。
DROP TRIGGER IF EXISTS messages_inherit_owner ON messages;
CREATE TRIGGER messages_inherit_owner BEFORE INSERT OR UPDATE ON messages
  FOR EACH ROW EXECUTE FUNCTION inherit_owner_partner_company(
    'chat_threads', 'thread_id', 'owner_partner_company_id', 'partner_company_id'
  );

-- ============================================================================
-- 4. review_gates ← CASE（target_type による多相継承。docs/05 §4.4.1）
-- ============================================================================
-- PROPOSAL → proposals / SKILL_SHEET_SHARE → skill_sheets / CHAT_ATTACHMENT → messages /
-- PROJECT_PUBLISH・CONTRACT_DOCUMENT → NULL（越境の根拠を持たない対象） / ELSE → RAISE。
-- 🔴 新しい target_type を REVIEW_GATE_TARGET_TYPES に足すとこの CASE の ELSE で必ず落ちる
--    （境界の割り当てを取りこぼせない。docs/05 §4.4.1）。
-- 🔴 proposals / messages はいずれもホストが無条件に読めるクラス（C5 / C6）のため
--    SECURITY INVOKER で問題ない。skill_sheets（C3）は「書き手 = 対象スキルシートの所有者」の
--    自己完結ケース（現時点でホストが他パートナーの skill_sheets に対して SKILL_SHEET_SHARE の
--    ReviewGate を起票する経路は存在しない。§3-③ の運用シーケンスが確定した際に要再確認）。
CREATE FUNCTION inherit_review_gate_owner() RETURNS trigger
LANGUAGE plpgsql AS $BODY$
DECLARE
  v_owner uuid;
BEGIN
  CASE NEW.target_type
    WHEN 'PROPOSAL' THEN
      SELECT owner_partner_company_id INTO v_owner
        FROM proposals WHERE id = NEW.target_id AND tenant_id = NEW.tenant_id;
      IF NOT FOUND THEN
        RAISE EXCEPTION
          'inherit_review_gate_owner: proposals（id=%）が見つからないか参照できません（review_gates.owner_partner_company_id の継承元。docs/05 §4.4.1）',
          NEW.target_id;
      END IF;
    WHEN 'SKILL_SHEET_SHARE' THEN
      SELECT owner_partner_company_id INTO v_owner
        FROM skill_sheets WHERE id = NEW.target_id AND tenant_id = NEW.tenant_id;
      IF NOT FOUND THEN
        RAISE EXCEPTION
          'inherit_review_gate_owner: skill_sheets（id=%）が見つからないか参照できません（review_gates.owner_partner_company_id の継承元。docs/05 §4.4.1）',
          NEW.target_id;
      END IF;
    WHEN 'CHAT_ATTACHMENT' THEN
      SELECT owner_partner_company_id INTO v_owner
        FROM messages WHERE id = NEW.target_id AND tenant_id = NEW.tenant_id;
      IF NOT FOUND THEN
        RAISE EXCEPTION
          'inherit_review_gate_owner: messages（id=%）が見つからないか参照できません（review_gates.owner_partner_company_id の継承元。docs/05 §4.4.1）',
          NEW.target_id;
      END IF;
    WHEN 'PROJECT_PUBLISH', 'CONTRACT_DOCUMENT' THEN
      v_owner := NULL;
    ELSE
      RAISE EXCEPTION
        'inherit_review_gate_owner: 未対応の target_type です: %（docs/05 §4.4.1。REVIEW_GATE_TARGET_TYPES に新しい値を足す場合はこの CASE にも追加すること）',
        NEW.target_type;
  END CASE;

  NEW.owner_partner_company_id := v_owner;
  RETURN NEW;
END;
$BODY$;

DROP TRIGGER IF EXISTS review_gates_inherit_owner ON review_gates;
CREATE TRIGGER review_gates_inherit_owner BEFORE INSERT OR UPDATE ON review_gates
  FOR EACH ROW EXECUTE FUNCTION inherit_review_gate_owner();

-- ============================================================================
-- 5. 当事者列の根 1 表（contracts）: BEFORE UPDATE で不変
-- ============================================================================
DROP TRIGGER IF EXISTS contracts_freeze_counterparty ON contracts;
CREATE TRIGGER contracts_freeze_counterparty BEFORE UPDATE ON contracts
  FOR EACH ROW EXECUTE FUNCTION freeze_owner_partner_company('counterparty_partner_company_id');

-- ============================================================================
-- 6. 当事者列の子: contract_documents ← contracts(contract_id)
-- ============================================================================
-- 🔴 contracts は C2 HOST_ONLY（書込 + ホストの SELECT）であり、ホストは counterparty を問わず
--    全 contracts を無条件に読めるため SECURITY INVOKER で問題ない。
DROP TRIGGER IF EXISTS contract_documents_inherit_counterparty ON contract_documents;
CREATE TRIGGER contract_documents_inherit_counterparty BEFORE INSERT OR UPDATE ON contract_documents
  FOR EACH ROW EXECUTE FUNCTION inherit_owner_partner_company(
    'contracts', 'contract_id', 'counterparty_partner_company_id'
  );

-- ============================================================================
-- 7. 当事者列の子: orders ← CASE(contract_id IS NOT NULL → contracts / ELSE → assignments)
-- ============================================================================
-- 🔴 contracts / assignments はいずれも C2 HOST_ONLY（ホストは counterparty を問わず無条件に
--    全行を読める）ため SECURITY INVOKER で問題ない。
-- 🔴 contract_id / assignment_id が両方 NULL の場合はここでは RAISE せず、NEW の当事者列に
--    手を触れずに素通しする。「どちらかが必須」の判定は既存の CHECK
--    （orders_contract_or_assignment_check。F-050 AC-1）に譲る。このトリガが先に RAISE すると、
--    CHECK 違反として設計・テストされているエラーメッセージを奪ってしまうため
--    （tests/isolation/chat-contract-assignment-constraints.test.ts の申し送り）。
CREATE FUNCTION inherit_order_counterparty() RETURNS trigger
LANGUAGE plpgsql AS $BODY$
DECLARE
  v_counterparty uuid;
BEGIN
  IF NEW.contract_id IS NOT NULL THEN
    SELECT counterparty_partner_company_id INTO v_counterparty
      FROM contracts WHERE id = NEW.contract_id AND tenant_id = NEW.tenant_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION
        'inherit_order_counterparty: contracts（id=%）が見つからないか参照できません（orders.counterparty_partner_company_id の継承元。docs/05 §4.4.1）',
        NEW.contract_id;
    END IF;
    NEW.counterparty_partner_company_id := v_counterparty;
  ELSIF NEW.assignment_id IS NOT NULL THEN
    SELECT counterparty_partner_company_id INTO v_counterparty
      FROM assignments WHERE id = NEW.assignment_id AND tenant_id = NEW.tenant_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION
        'inherit_order_counterparty: assignments（id=%）が見つからないか参照できません（orders.counterparty_partner_company_id の継承元。docs/05 §4.4.1）',
        NEW.assignment_id;
    END IF;
    NEW.counterparty_partner_company_id := v_counterparty;
  END IF;
  -- 両方 NULL: 上記コメントのとおり素通しする（orders_contract_or_assignment_check に譲る）。
  RETURN NEW;
END;
$BODY$;

DROP TRIGGER IF EXISTS orders_inherit_counterparty ON orders;
CREATE TRIGGER orders_inherit_counterparty BEFORE INSERT OR UPDATE ON orders
  FOR EACH ROW EXECUTE FUNCTION inherit_order_counterparty();

-- ============================================================================
-- 8. 当事者列の子: assignments ← engineers(engineer_id).owner_partner_company_id
-- ============================================================================
-- 🔴 判断事項 2（ファイル冒頭）: engineers は C3 のためホストから他パートナーの行が
--    見えない。専用ロール app_assignment_owner_probe（000_roles.sql）+ SECURITY DEFINER の
--    トリガ関数でテナント境界のみを課した読み取りに限定する（§4.5 app_share_probe と同型）。
--
-- 🔴 §4.5 の app_share_probe との違い: app_engineer_is_shared() は**通常の SQL 関数**であり
--    `GRANT EXECUTE ... TO app_tenant` を経て app_tenant セッションから直接呼び出せる
--    （呼び出し元の限定は ESLint による静的検査。§4.5）。本トリガはそれとは異なる形にした:
--    トリガ関数（RETURNS trigger）は通常の関数呼び出し（SELECT fn(...)）の戻り値型として使えず、
--    実際の INSERT/UPDATE イベント経由でしか実行されない（PostgreSQL の仕様）。したがって
--    この関数を SECURITY DEFINER にしても、「app_tenant セッションが直接呼び出して他パートナーの
--    engineers.owner_partner_company_id を探索する」経路が type レベルで存在しない
--    （app_share_probe 方式で素朴に GRANT EXECUTE すると、この探索経路が生まれてしまう。
--    §4.5 は ESLint だけで塞いでいるが、本件はパートナー間相互参照〔CLAUDE.md §3.1 の 🔴〕に
--    直結するため、DB レベルで到達不能にした）。
GRANT SELECT (tenant_id, id, owner_partner_company_id) ON engineers TO app_assignment_owner_probe;

-- 🔴 上記の理由により、探索用の直接呼び出し経路が存在しない前提で、テナント境界チェックは
--    「セッションの app.tenant_id が未設定（migration / seed など GUC を張らない文脈）なら許可、
--    設定されていれば一致を要求」という形にする。未設定を許可しても、この関数を直接呼べる経路が
--    無いため探索には使えず、実際のテナント一致は関数本体の `WHERE tenant_id = NEW.tenant_id`
--    （呼び出し元の行そのものの値。assignments 自身の RLS で既に境界確定済み）が担保する。
DROP POLICY IF EXISTS assignment_owner_probe_read ON engineers;
CREATE POLICY assignment_owner_probe_read ON engineers FOR SELECT TO app_assignment_owner_probe
  USING (app_tenant_id() IS NULL OR tenant_id = app_tenant_id());

-- 🔴 PostgreSQL の仕様: ALTER FUNCTION ... OWNER TO は「実行者が新オーナーへ SET ROLE できる」
--    （000_roles.sql の GRANT app_assignment_owner_probe TO app_migrator で満たす）ことに加えて
--    「新オーナーが対象オブジェクトのスキーマに CREATE 権限を持つ」ことを要求する。
-- 🔴 CREATE が要るのは直後の ALTER FUNCTION 実行時だけである。境界バイパスロールに CREATE を
--    恒久的に持たせない（code-reviewer 指摘。ALTER FUNCTION の直後で REVOKE する）。
GRANT CREATE ON SCHEMA public TO app_assignment_owner_probe;

CREATE FUNCTION inherit_assignment_counterparty() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $BODY$
DECLARE
  v_engineer_id uuid;
  v_owner       uuid;
BEGIN
  v_engineer_id := (to_jsonb(NEW) ->> 'engineer_id')::uuid;
  IF v_engineer_id IS NULL THEN
    RAISE EXCEPTION 'inherit_assignment_counterparty: assignments.engineer_id が NULL です（docs/05 §4.4.1）';
  END IF;

  -- 🔴 静的な SELECT INTO（動的 EXECUTE ではない）。FOUND が正しく更新される。
  SELECT owner_partner_company_id INTO v_owner
    FROM engineers WHERE id = v_engineer_id AND tenant_id = NEW.tenant_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION
      'inherit_assignment_counterparty: engineers（id=%, tenant_id=%）が見つかりません（assignments.counterparty_partner_company_id の継承元。docs/05 §4.4.1）',
      v_engineer_id, NEW.tenant_id;
  END IF;

  NEW.counterparty_partner_company_id := v_owner;
  RETURN NEW;
END;
$BODY$;
ALTER FUNCTION inherit_assignment_counterparty() OWNER TO app_assignment_owner_probe;

-- 🔴 CREATE は上の ALTER FUNCTION の所有者変更時にしか要らない（PostgreSQL の仕様。冒頭コメント
--    参照）。実行し終えたら直ちに剥がす。境界バイパスロールにスキーマ作成権を常置しない
--    （code-reviewer 指摘）。
REVOKE CREATE ON SCHEMA public FROM app_assignment_owner_probe;

-- 🔴 §4.5 の app_engineer_is_shared と同じ規律: CREATE FUNCTION が既定で PUBLIC に付与する
--    EXECUTE を明示的に剥がす。本関数はトリガ関数（RETURNS trigger）であり、通常の SQL 呼び出し
--    （SELECT fn(...)）の戻り値型として使えないため直接呼び出し経路はそもそも存在しない
--    （判断事項 2）が、この REVOKE はその事実に依存しない防御の重ね掛けである。
--    🔴 app_engineer_is_shared と異なり、GRANT EXECUTE を誰にも与えない（app_tenant にも）。
--    トリガ経由（実際の INSERT/UPDATE イベント）でのみ実行される想定のため、直接呼び出させる
--    正当な用途が無い。
REVOKE ALL ON FUNCTION inherit_assignment_counterparty() FROM PUBLIC;

DROP TRIGGER IF EXISTS assignments_inherit_counterparty ON assignments;
CREATE TRIGGER assignments_inherit_counterparty BEFORE INSERT OR UPDATE ON assignments
  FOR EACH ROW EXECUTE FUNCTION inherit_assignment_counterparty();

-- ============================================================================
-- 9. COMMENT 宣言（docs/05 §4.4.1。T-02-09 のカタログ走査が宣言と実体の一致だけを見る）
-- ============================================================================
-- 🔴 表を列挙しない検査の土台。'owner-column: root' / 'owner-column: child of <親>(<FK>)' /
--    'counterparty-column: root' / 'counterparty-column: child of <親>(<FK>)' の 4 形。
--    多相継承（review_gates / orders）は「CASE(...)」を親表記の位置に置く
--    （T-02-09 実装時にこの表記の走査規則を決めること。programmer からの申し送り）。
COMMENT ON COLUMN users.owner_partner_company_id      IS 'owner-column: root';
COMMENT ON COLUMN engineers.owner_partner_company_id  IS 'owner-column: root';
COMMENT ON COLUMN proposals.owner_partner_company_id  IS 'owner-column: root';
COMMENT ON COLUMN tasks.owner_partner_company_id      IS 'owner-column: root';

COMMENT ON COLUMN engineer_skills.owner_partner_company_id
  IS 'owner-column: child of engineers(engineer_id)';
COMMENT ON COLUMN skill_sheets.owner_partner_company_id
  IS 'owner-column: child of engineers(engineer_id)';
COMMENT ON COLUMN skill_sheet_extractions.owner_partner_company_id
  IS 'owner-column: child of skill_sheets(skill_sheet_id)';
COMMENT ON COLUMN engineer_snapshots.owner_partner_company_id
  IS 'owner-column: child of proposals(proposal_id)';
COMMENT ON COLUMN proposal_events.owner_partner_company_id
  IS 'owner-column: child of proposals(proposal_id)';
COMMENT ON COLUMN messages.owner_partner_company_id
  IS 'owner-column: child of chat_threads(thread_id)';
COMMENT ON COLUMN review_gates.owner_partner_company_id
  IS 'owner-column: child of CASE(target_type)';

COMMENT ON COLUMN contracts.counterparty_partner_company_id IS 'counterparty-column: root';
COMMENT ON COLUMN assignments.counterparty_partner_company_id
  IS 'counterparty-column: child of engineers(engineer_id)';
COMMENT ON COLUMN contract_documents.counterparty_partner_company_id
  IS 'counterparty-column: child of contracts(contract_id)';
COMMENT ON COLUMN orders.counterparty_partner_company_id
  IS 'counterparty-column: child of CASE(contract_id, assignment_id)';
