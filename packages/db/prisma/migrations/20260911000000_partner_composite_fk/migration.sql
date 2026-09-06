-- Issue #33（既定 C） / docs/05 §3.3.1「パートナー FK 列の複合 FK 化」。
--
-- 目的: `partner_companies` を指す FK 列を、**テナントをまたいで成立しない**形にする。
--   単一列 FK（`REFERENCES partner_companies(id)`）は「その ID が実在すること」しか見ないため、
--   ホスト文脈の INSERT（RLS の C5 は `WITH CHECK` が `app_is_host()` で真になる）で
--   **他テナントの取引先 ID** を書けてしまう。複合 FK
--   `(tenant_id, <パートナー列>) REFERENCES partner_companies(tenant_id, id)` にすれば
--   構造的に不可能になる（CLAUDE.md §3.1 第二境界を DB 側で閉じる）。
--
-- 対象は docs/05 §3.3.1 の **A 群 13 列**。うち 12 列は既存 FK の付け替え、
-- `tasks.owner_partner_company_id` だけは FK が 1 本も無かったため **ADD のみ**を行う。
-- B 群（継承の子 10 列）には張らない（値を書くのは §4.4.1 の継承トリガだけであり、
-- トリガは親を `WHERE id = $1 AND tenant_id = NEW.tenant_id` で引くため推移的に正しい）。
--
-- 🔴 `MATCH SIMPLE`（PostgreSQL の既定）のまま使う。`MATCH FULL` と書かない（§3.3.1-4）。
--    パートナー列が `NULL`（= ホスト所有）の行は照合そのものが行われず、そのまま通る。
--    `MATCH FULL` にするとホスト所有行を 1 行も作れなくなる。
-- 🔴 `ON DELETE RESTRICT ON UPDATE CASCADE`（現行と同じ）を維持する（§3.3.1-5）。
-- 🔴 `NOT VALID` で逃げない（§3.3.1）。既存行の全件検査を伴う `ADD CONSTRAINT` をそのまま打つ。
-- 🔴 本移行でインデックスは足さない（§3.3.1-5。削除が起きない以上不要）。
--
-- ============================================================================
-- 🔴 手順 0 の前に FORCE ROW LEVEL SECURITY を一時解除する理由（実測。docs/05 §3.3.1 に追記済み）
-- ============================================================================
-- マイグレーションは `app_migrator`（= テーブル所有者）で流す（docs/05 §4.2）。
-- 全業務テーブルは **FORCE ROW LEVEL SECURITY** であり、所有者にも RLS が適用される。
-- `app_migrator` に適用されるポリシーは 0 件なので、**所有者から見える行も 0 件**になる。
-- これは本移行で 2 つの静かな壊れ方を生む（PostgreSQL 17 で実測）:
--
--   ① 手順 1 の違反行チェックが常に 0 件を返す（= 検査したつもりで何も見ていない）。
--   ② 🔴 `ALTER TABLE ... ADD CONSTRAINT ... FOREIGN KEY` の**検証まで素通りする**。
--      PostgreSQL の `RI_Initial_Check`（高速パスの LEFT JOIN クエリ）は
--      「RLS 有効 **かつ 所有者でない**」ときにだけ行単位トリガへフォールバックする。
--      所有者が実行する場合は高速パスが選ばれ、そのクエリ自体が FORCE RLS で絞られるため、
--      **違反行があっても `convalidated = true` の制約が張れてしまう**
--      （＝「制約はあるが違反行がある」という §3.3.1 が最も避けたい状態を作る）。
--      実行時の INSERT/UPDATE 検査（RI トリガ）は `SECURITY_NOFORCE_RLS` で走るため
--      RLS を素通りする ——「入れるときは弾くが、張るときは見ていない」という非対称が起きる。
--
-- したがって、**この migration の中だけ**関係する 14 表の FORCE を外し、最後に必ず戻す。
-- 🔴 安全性の根拠: ①`prisma migrate deploy` は migration.sql を 1 トランザクションで流すため、
--    途中で失敗すれば FORCE は解除前の状態へロールバックする ②最後に手順 5 で戻し、
--    手順 6 が「`relrowsecurity` なのに `relforcerowsecurity` でない表が 1 つも無い」ことを
--    このファイル自身で検査して失敗させる ③さらに `tests/isolation/rls-enforced.test.ts` #1 が
--    マイグレーション適用後の全業務テーブルについて同じ不変条件を毎回検査する。
-- 🔴 ENABLE ROW LEVEL SECURITY は外さない（`app_tenant` 等の非所有者には常時 RLS が効いたまま）。

-- ============================================================================
-- 0. FORCE ROW LEVEL SECURITY の一時解除（本ファイルの手順 5 で必ず戻す）
-- ============================================================================
ALTER TABLE "partner_companies" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "users" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "memberships" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "invitations" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "engineers" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "project_visibilities" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "engineer_shares" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "proposal_requests" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "proposals" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "chat_threads" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "thread_participants" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "messages" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "contracts" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "tasks" NO FORCE ROW LEVEL SECURITY;

-- ============================================================================
-- 1. 🔴 違反行の存在チェック（docs/05 §3.3.1 の手順 0）
--    既存データは全て正のはず（アプリ層照合が守ってきた）だが、「はず」で流さない。
--    1 行でも違反があれば migration ごと失敗させる。
--    ⚠️ この DO ブロックは A の 13 列を明示的に列挙する（制約がまだ無い時点の検査であり、
--       カタログからは導けない）。恒久的な網羅性の担保は §4.7 #14 の走査が受け持つ。
-- ============================================================================
DO $$
DECLARE bad bigint;
BEGIN
  SELECT count(*) INTO bad FROM (
    SELECT 1 FROM users t JOIN partner_companies p ON p.id = t.owner_partner_company_id
      WHERE p.tenant_id IS DISTINCT FROM t.tenant_id
    UNION ALL
    SELECT 1 FROM memberships t JOIN partner_companies p ON p.id = t.partner_company_id
      WHERE p.tenant_id IS DISTINCT FROM t.tenant_id
    UNION ALL
    SELECT 1 FROM invitations t JOIN partner_companies p ON p.id = t.partner_company_id
      WHERE p.tenant_id IS DISTINCT FROM t.tenant_id
    UNION ALL
    SELECT 1 FROM engineers t JOIN partner_companies p ON p.id = t.owner_partner_company_id
      WHERE p.tenant_id IS DISTINCT FROM t.tenant_id
    UNION ALL
    SELECT 1 FROM project_visibilities t JOIN partner_companies p ON p.id = t.partner_company_id
      WHERE p.tenant_id IS DISTINCT FROM t.tenant_id
    UNION ALL
    SELECT 1 FROM engineer_shares t JOIN partner_companies p ON p.id = t.partner_company_id
      WHERE p.tenant_id IS DISTINCT FROM t.tenant_id
    UNION ALL
    SELECT 1 FROM proposal_requests t JOIN partner_companies p ON p.id = t.partner_company_id
      WHERE p.tenant_id IS DISTINCT FROM t.tenant_id
    UNION ALL
    SELECT 1 FROM proposals t JOIN partner_companies p ON p.id = t.owner_partner_company_id
      WHERE p.tenant_id IS DISTINCT FROM t.tenant_id
    UNION ALL
    SELECT 1 FROM chat_threads t JOIN partner_companies p ON p.id = t.partner_company_id
      WHERE p.tenant_id IS DISTINCT FROM t.tenant_id
    UNION ALL
    SELECT 1 FROM thread_participants t JOIN partner_companies p ON p.id = t.partner_company_id
      WHERE p.tenant_id IS DISTINCT FROM t.tenant_id
    UNION ALL
    SELECT 1 FROM messages t JOIN partner_companies p ON p.id = t.sender_partner_company_id
      WHERE p.tenant_id IS DISTINCT FROM t.tenant_id
    UNION ALL
    SELECT 1 FROM contracts t JOIN partner_companies p ON p.id = t.counterparty_partner_company_id
      WHERE p.tenant_id IS DISTINCT FROM t.tenant_id
    UNION ALL
    SELECT 1 FROM tasks t JOIN partner_companies p ON p.id = t.owner_partner_company_id
      WHERE p.tenant_id IS DISTINCT FROM t.tenant_id
  ) x;
  IF bad > 0 THEN
    RAISE EXCEPTION 'Issue #33: 別テナントの partner_company を指す行が % 件あります。移行前に是正が必要です', bad;
  END IF;
END $$;

-- ============================================================================
-- 2. 参照先の一意制約（複合 FK の参照先には一意制約が要る。`id` 単独の主キーは残す）
-- ============================================================================
ALTER TABLE "partner_companies"
  ADD CONSTRAINT "partner_companies_tenant_id_id_key" UNIQUE ("tenant_id", "id");

-- ============================================================================
-- 3. 既存 FK の付け替え（12 列。DROP → ADD を同一トランザクションで）
--    🔴 制約名は Prisma の既定規約（`{表}_{列1}_{列2}_fkey`）に合わせる。
--       現行の名前（`invitations_partner_company_id_fkey`）は使い回さない ——
--       名前だけ同じで定義が違う制約は、あとから migration.sql を検索したときに誤読を生む。
-- ============================================================================
ALTER TABLE "users" DROP CONSTRAINT "users_owner_partner_company_id_fkey";
ALTER TABLE "users" ADD CONSTRAINT "users_tenant_id_owner_partner_company_id_fkey"
  FOREIGN KEY ("tenant_id", "owner_partner_company_id")
  REFERENCES "partner_companies"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "memberships" DROP CONSTRAINT "memberships_partner_company_id_fkey";
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_tenant_id_partner_company_id_fkey"
  FOREIGN KEY ("tenant_id", "partner_company_id")
  REFERENCES "partner_companies"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "invitations" DROP CONSTRAINT "invitations_partner_company_id_fkey";
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_tenant_id_partner_company_id_fkey"
  FOREIGN KEY ("tenant_id", "partner_company_id")
  REFERENCES "partner_companies"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "engineers" DROP CONSTRAINT "engineers_owner_partner_company_id_fkey";
ALTER TABLE "engineers" ADD CONSTRAINT "engineers_tenant_id_owner_partner_company_id_fkey"
  FOREIGN KEY ("tenant_id", "owner_partner_company_id")
  REFERENCES "partner_companies"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "project_visibilities" DROP CONSTRAINT "project_visibilities_partner_company_id_fkey";
ALTER TABLE "project_visibilities" ADD CONSTRAINT "project_visibilities_tenant_id_partner_company_id_fkey"
  FOREIGN KEY ("tenant_id", "partner_company_id")
  REFERENCES "partner_companies"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "engineer_shares" DROP CONSTRAINT "engineer_shares_partner_company_id_fkey";
ALTER TABLE "engineer_shares" ADD CONSTRAINT "engineer_shares_tenant_id_partner_company_id_fkey"
  FOREIGN KEY ("tenant_id", "partner_company_id")
  REFERENCES "partner_companies"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "proposal_requests" DROP CONSTRAINT "proposal_requests_partner_company_id_fkey";
ALTER TABLE "proposal_requests" ADD CONSTRAINT "proposal_requests_tenant_id_partner_company_id_fkey"
  FOREIGN KEY ("tenant_id", "partner_company_id")
  REFERENCES "partner_companies"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "proposals" DROP CONSTRAINT "proposals_owner_partner_company_id_fkey";
ALTER TABLE "proposals" ADD CONSTRAINT "proposals_tenant_id_owner_partner_company_id_fkey"
  FOREIGN KEY ("tenant_id", "owner_partner_company_id")
  REFERENCES "partner_companies"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "chat_threads" DROP CONSTRAINT "chat_threads_partner_company_id_fkey";
ALTER TABLE "chat_threads" ADD CONSTRAINT "chat_threads_tenant_id_partner_company_id_fkey"
  FOREIGN KEY ("tenant_id", "partner_company_id")
  REFERENCES "partner_companies"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "thread_participants" DROP CONSTRAINT "thread_participants_partner_company_id_fkey";
ALTER TABLE "thread_participants" ADD CONSTRAINT "thread_participants_tenant_id_partner_company_id_fkey"
  FOREIGN KEY ("tenant_id", "partner_company_id")
  REFERENCES "partner_companies"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "messages" DROP CONSTRAINT "messages_sender_partner_company_id_fkey";
ALTER TABLE "messages" ADD CONSTRAINT "messages_tenant_id_sender_partner_company_id_fkey"
  FOREIGN KEY ("tenant_id", "sender_partner_company_id")
  REFERENCES "partner_companies"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "contracts" DROP CONSTRAINT "contracts_counterparty_partner_company_id_fkey";
ALTER TABLE "contracts" ADD CONSTRAINT "contracts_tenant_id_counterparty_partner_company_id_fkey"
  FOREIGN KEY ("tenant_id", "counterparty_partner_company_id")
  REFERENCES "partner_companies"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ============================================================================
-- 4. 🔴 tasks は既存 FK が無いので ADD のみ（DROP を書かない）。
--    §4.4.1 の根 4 表（users / engineers / proposals / tasks）のうち、tasks だけが
--    「根のオーナー列なのに FK が 1 本も無い」既存の穴だった。
-- ============================================================================
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_tenant_id_owner_partner_company_id_fkey"
  FOREIGN KEY ("tenant_id", "owner_partner_company_id")
  REFERENCES "partner_companies"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ============================================================================
-- 5. 🔴 FORCE ROW LEVEL SECURITY を必ず戻す（手順 0 の対称）
-- ============================================================================
ALTER TABLE "partner_companies" FORCE ROW LEVEL SECURITY;
ALTER TABLE "users" FORCE ROW LEVEL SECURITY;
ALTER TABLE "memberships" FORCE ROW LEVEL SECURITY;
ALTER TABLE "invitations" FORCE ROW LEVEL SECURITY;
ALTER TABLE "engineers" FORCE ROW LEVEL SECURITY;
ALTER TABLE "project_visibilities" FORCE ROW LEVEL SECURITY;
ALTER TABLE "engineer_shares" FORCE ROW LEVEL SECURITY;
ALTER TABLE "proposal_requests" FORCE ROW LEVEL SECURITY;
ALTER TABLE "proposals" FORCE ROW LEVEL SECURITY;
ALTER TABLE "chat_threads" FORCE ROW LEVEL SECURITY;
ALTER TABLE "thread_participants" FORCE ROW LEVEL SECURITY;
ALTER TABLE "messages" FORCE ROW LEVEL SECURITY;
ALTER TABLE "contracts" FORCE ROW LEVEL SECURITY;
ALTER TABLE "tasks" FORCE ROW LEVEL SECURITY;

-- ============================================================================
-- 6. 🔴 事後検査: 手順 5 の書き漏れをこのファイル自身で落とす。
--    14 表を再列挙せず、「RLS 有効なのに FORCE でない実表が 1 つも無い」という
--    不変条件をカタログ走査で確かめる（docs/05 §4.7 #1 と同じ向き）。
-- ============================================================================
DO $$
DECLARE unforced text;
BEGIN
  SELECT string_agg(c.relname, ', ' ORDER BY c.relname) INTO unforced
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p')
     AND c.relrowsecurity AND NOT c.relforcerowsecurity;
  IF unforced IS NOT NULL THEN
    RAISE EXCEPTION 'Issue #33: FORCE ROW LEVEL SECURITY が戻っていない表があります: %', unforced;
  END IF;
END $$;
