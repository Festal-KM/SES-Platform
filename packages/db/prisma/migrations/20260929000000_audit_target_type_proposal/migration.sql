-- ============================================================================
-- T-12-13 ① `audit_logs.target_type` の表記統一（SP-09 T-09-09 ③-① の申し送り。docs/05 §6.5「#45 / #46 / #47 と `S-019` / `S-023`
-- の実装の決着」の `targetType` の統一 / §16.1 / `CLAUDE.md` §3.5）
-- ============================================================================
-- 🔴 これは**表記の統一であり、監査ログの改変ではない。**
--    提案に対する監査行の `target_type` が `'Proposal'`（#36 / #37 / #41 / #42 / #43 / #44 / #47 / #48）と `'PROPOSAL'`
--    （`gate.run` の `GATE_RESULT`）で揺れていたものを、書き込み側の 1 定数 `PROPOSAL_AUDIT_TARGET_TYPE`（`'Proposal'`。
--    `@ses/db`）に揃える。同じ変更で書き込み側の全経路を定数に寄せた（`tests/static/audit-target-type-literal.test.ts`）。
-- 🔴 触るのは `target_type` の 1 列だけ。`action` / `summary` / `actor_kind` / `actor_id` / `target_id` / `ip_address` /
--    `device_kind` / `created_at`（= 誰が・いつ・何をしたか）は 1 バイトも変えない。行の追加・削除も無い。
-- 🔴 射程は `audit_logs` の `target_type = 'PROPOSAL' AND action LIKE 'proposal.%'` だけ（原文どおり）。
--    `review_gates.target_type` / `ai_usage.target_type` / `send_attempts.entity_type` の `'PROPOSAL'` は**別の列・別の定数**
--    （`GateTargetType` / `PROPOSAL_SEND_ENTITY_TYPE`）であり触らない。`proposal_request.*`（下線）は `LIKE 'proposal.%'` に
--    一致しないので対象外である。
-- 🔴 列の追加・GRANT / REVOKE / ポリシーの変更は無い（`audit_logs` は `app_platform` が読む表〔docs/05 §5.2〕だが、
--    読み取りの契約〔列・権限〕は変わらない）。
--
-- 🔴 FORCE ROW LEVEL SECURITY の一時解除（20260911000000 と同じ理由・同じ手順）
-- ============================================================================
-- `audit_logs` は ENABLE + FORCE で、所有者 `app_migrator`（`NOBYPASSRLS`）にも適用ポリシーが 1 つも無い。素の UPDATE は
-- **0 件で「成功」してしまい**、移行したつもりで何も移っていない状態を作る（docs/05 §4.4「所有者でも 0 件」）。
-- したがって本ファイルの中だけ FORCE を外し、UPDATE → 残存 0 件の検査（🔴 FORCE を戻す**前**に行う。戻した後では所有者にも
-- 0 件に見えて検査にならない）→ FORCE を戻す → カタログ検査、の順で行う。`prisma migrate deploy` は migration.sql を
-- 1 トランザクションで流すため、途中で失敗すれば解除前の状態へロールバックする。ENABLE は外さない（非所有者には常時 RLS）。
-- 再生（既存行あり）は `tests/isolation/audit-log.test.ts`「T-12-13 ①」が superuser → `SET ROLE app_migrator` で本ファイルを
-- 流して確かめる。

-- 0. FORCE の一時解除（手順 3 で必ず戻す）
ALTER TABLE "audit_logs" NO FORCE ROW LEVEL SECURITY;

-- 1. 表記の統一（原文どおり。`target_type` 以外の列に触れない）
UPDATE audit_logs SET target_type = 'Proposal' WHERE target_type = 'PROPOSAL' AND action LIKE 'proposal.%';

-- 2. 残存 0 件の検査（🔴 FORCE を戻す前。所有者に全行が見えている間に数える）
DO $$
DECLARE remaining bigint;
BEGIN
  SELECT count(*) INTO remaining
    FROM audit_logs
   WHERE target_type = 'PROPOSAL' AND action LIKE 'proposal.%';
  IF remaining <> 0 THEN
    RAISE EXCEPTION 'T-12-13 ①: audit_logs.target_type の統一が完了していません（残 % 行）', remaining;
  END IF;
END $$;

-- 3. 🔴 FORCE を必ず戻す（手順 0 の対称）
ALTER TABLE "audit_logs" FORCE ROW LEVEL SECURITY;

-- 4. 🔴 事後検査: 「RLS 有効なのに FORCE でない表が 1 つも無い」をカタログ走査で確かめる（20260911000000 手順 6 と同じ向き）
DO $$
DECLARE unforced text;
BEGIN
  SELECT string_agg(c.relname, ', ' ORDER BY c.relname) INTO unforced
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p')
     AND c.relrowsecurity AND NOT c.relforcerowsecurity;
  IF unforced IS NOT NULL THEN
    RAISE EXCEPTION 'T-12-13 ①: FORCE ROW LEVEL SECURITY が戻っていない表があります: %', unforced;
  END IF;
END $$;
