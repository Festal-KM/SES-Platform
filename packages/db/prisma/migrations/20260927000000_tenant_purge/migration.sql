-- ============================================================================
-- T-10-09 削除（`CLOSING → PURGED`）の実行に要る 4 点（docs/05 §9.7 / docs/02 F-064 AC-1〜AC-4 / CLAUDE.md §4.2 `Tenant`）
-- ============================================================================
-- 本 migration が置くのは次の 4 つである:
--   ① 原本のオブジェクトキーと本文を **NULL 化できる**ようにする（`skill_sheets.object_key` / `contract_documents.object_key` /
--      `contract_templates.object_key` / `messages.body` の DROP NOT NULL）。docs/05 §9.7 は「①S3 の `DeleteObject` → ②DB の列を
--      NULL 化」と定めているが、当初の DDL はこれらを NOT NULL で作っていた。**空文字やダミーのキーで埋めない** —— キーの列に
--      「実体の無いキー」が残ると、署名 URL の発行（`issueDownloadUrl`）がそれを S3 に署名しに行く経路が残る。NULL なら
--      型（`string | null`）が読み手に「原本が無い」ことを扱わせる。
--   ② `tenants` の CHECK: `CLOSING` の行は必ず `closing_entered_at` を持つ（T-10-12 レビュー申し送り）。`closing_entered_at IS NULL`
--      の `CLOSING` は削除予告にも削除の走査にも載らず**不可視**になる。遷移の書き手（Phase 3 の `F-062` / Phase 2 の
--      `tenant.sandbox-expiry`）が同一 UPDATE で立て忘れたら DB で落とす。
--   ③ 🔴 `CLOSING → PURGED` の遷移を**ジョブ文脈から**行う唯一の経路 `app_complete_tenant_purge()`（SECURITY DEFINER。所有者
--      `app_purge_probe`）。`app_tenant` は `tenants` の `lifecycle_state` を書けない（20260905000000。書けるのは `name` /
--      `auto_approve_enabled` / `pii_retention_years` の 3 列だけ）。この規律は正しい —— テナント側のロールが契約状態を
--      動かせてはならない（`F-004` / docs/05 §6.8「`PATCH /api/tenant/lifecycle` を作らない」）。しかし `PURGED` への遷移は
--      **`system` の自動遷移**であり（docs/02 章 5.4 遷移 7）、運営者の操作（`withPlatformWrite` + `AuditLog`）でもない。
--      したがって `app_scan_probe` / `app_scheduler_probe` と同じ形で、**1 遷移だけ**を行う関数を置く。
--   ④ 🔴 **削除スコープ**（`app.purge_scope = 'on'`）の追加ポリシー。削除はテナント内の**全行**に届かなければならない ——
--      `engineers` / `skill_sheets` / `messages` 等は C3 OWNER_SCOPED であり、ジョブのホスト文脈（`systemTenantCtx`。
--      `partner_company_id = ''`）からは取引先が持ち込んだ行が 1 行も見えない。見えないまま「削除完了」にすると、
--      **`PURGED` 後に取引先エンジニアの連絡先・スキルシート原本が残る**（`F-064 AC-2` の破れ。`app_scan_probe` を置いた
--      のと同じ理由 = スキャン結果は所有者を問わず届く必要がある）。共有スコープ（`app.shared_scope`。20260916000000）と
--      同じ形で、GUC が `'on'` のときだけ **テナント境界のみ**（+ ホスト文脈）で開くポリシーを `PURGE_SPEC.delete` の表に置く。
--      GUC を `'on'` にできるのは `packages/db/src/scope-settings.ts` の `purgeScopeSettingsSql` 1 箇所（呼び出し元は
--      `tenant-purge.ts` の `withPurgeScope` だけ。`tests/static/purge-scope-single-path.test.ts` が `'on'` の書き場所・`'off'` の
--      上書き経路・呼び出し元・非 export を固定する）。他の全経路が毎回 `'off'` で上書きする。
--
-- ============================================================================
-- 🔴 判断事項 1: 関数が行う遷移は `CLOSING → PURGED` の 1 本だけ。引数を取らない
-- ============================================================================
-- 遷移先・遷移元・対象テナントのいずれも引数にしない。対象は `app_tenant_id()`（= 呼び出し側のテナント文脈。ジョブは
-- `systemTenantCtx(tenantId)` で開く）、遷移は `WHERE lifecycle_state = 'CLOSING'` の CAS に固定する。「状態を書ける汎用の口」を
-- テナント側のロールに与えない（`PURGED` は終端であり、`PURGED → ACTIVE` を書く SQL がこの DB には存在しない = `F-064 AC-4`）。
--
-- ============================================================================
-- 🔴 判断事項 2: fail-closed は 3 つ
-- ============================================================================
--   (a) テナント文脈が無ければ例外（`app_tenant_id() IS NULL`）。
--   (b) `app.purge_scope = 'on'` でなければ例外。この GUC を `set_config` する SQL は `packages/db/src/scope-settings.ts` の
--       `purgeScopeSettingsSql` だけ、それを発行するのは `packages/db/src/tenant-purge.ts` の `withPurgeScope` だけであり
--       （`tests/static/purge-scope-single-path.test.ts` が固定する。`apps/**` からの呼び出し元は `tests/static/auth-db-callers.test.ts`）、
--       HTTP リクエストのトランザクションからは（`TenantDb` に生 SQL の口が無いので）到達できない。
--   (c) 🔴 その テナントに `tenant_purge_runs(cause='TENANT_PURGED', status='RUNNING')` の行が無ければ例外。**削除の実行
--       （`TenantPurgeRun`）を経ない遷移を DB で拒む** —— 「状態だけ `PURGED` にして個人情報が残る」を作らない（`F-064 AC-2`）。
--
-- ============================================================================
-- 🔴 判断事項 3: `app_purge_probe` の GRANT は `tenants` の 2 列 SELECT + 3 列 UPDATE と `tenant_purge_runs` の 3 列 SELECT だけ
-- ============================================================================
-- 名前・環境・`closing_entered_at` は書けない。`lifecycle_changed_by` は NULL（`system`）を書く。
-- ポリシーは自テナント（`id = app_tenant_id()`）に限る（FORCE ROW LEVEL SECURITY 下では所有者にもポリシーが要る）。

-- ----------------------------------------------------------------------------
-- ① 原本の列を NULL 化できるようにする
-- ----------------------------------------------------------------------------
ALTER TABLE "skill_sheets" ALTER COLUMN "object_key" DROP NOT NULL;
ALTER TABLE "contract_documents" ALTER COLUMN "object_key" DROP NOT NULL;
ALTER TABLE "contract_templates" ALTER COLUMN "object_key" DROP NOT NULL;
ALTER TABLE "messages" ALTER COLUMN "body" DROP NOT NULL;

-- 🔴 NULL になれるのは「削除済み（`purged_at` が立っている）」ときだけ。アップロードの確定（#19）や投稿でキー無し・本文無しの行を
--    作れないことを DB でも固定する（`purged_at` を持つ 2 表）。
ALTER TABLE "skill_sheets"
  ADD CONSTRAINT "skill_sheets_object_key_purged_check" CHECK ("object_key" IS NOT NULL OR "purged_at" IS NOT NULL);
ALTER TABLE "messages"
  ADD CONSTRAINT "messages_body_purged_check" CHECK ("body" IS NOT NULL OR "purged_at" IS NOT NULL);

-- ----------------------------------------------------------------------------
-- ② `CLOSING` の行は必ず `closing_entered_at` を持つ
-- ----------------------------------------------------------------------------
-- 🔴 既存行に違反があれば本 migration はここで失敗する（黙って NOT VALID にしない。違反行は予告も削除も届かない行であり、
--    見つけた時点で直すべきもの）。
ALTER TABLE "tenants"
  ADD CONSTRAINT "tenants_closing_entered_at_check" CHECK ("lifecycle_state" <> 'CLOSING' OR "closing_entered_at" IS NOT NULL);

-- ----------------------------------------------------------------------------
-- ③ `app_purge_probe` + `app_complete_tenant_purge()`
-- ----------------------------------------------------------------------------
GRANT USAGE ON SCHEMA public TO app_purge_probe;
GRANT SELECT (id, lifecycle_state) ON tenants TO app_purge_probe;
GRANT UPDATE (lifecycle_state, lifecycle_changed_at, lifecycle_changed_by) ON tenants TO app_purge_probe;
GRANT SELECT (tenant_id, cause, status) ON tenant_purge_runs TO app_purge_probe;

DROP POLICY IF EXISTS tenants_purge_probe_select ON tenants;
CREATE POLICY tenants_purge_probe_select ON tenants FOR SELECT TO app_purge_probe
  USING (id = app_tenant_id());
DROP POLICY IF EXISTS tenants_purge_probe_update ON tenants;
CREATE POLICY tenants_purge_probe_update ON tenants FOR UPDATE TO app_purge_probe
  USING (id = app_tenant_id())
  WITH CHECK (id = app_tenant_id());
DROP POLICY IF EXISTS tenant_purge_runs_purge_probe_select ON tenant_purge_runs;
CREATE POLICY tenant_purge_runs_purge_probe_select ON tenant_purge_runs FOR SELECT TO app_purge_probe
  USING (tenant_id = app_tenant_id());

-- 🔴 ALTER FUNCTION ... OWNER TO は「新オーナーが対象スキーマに CREATE 権限を持つ」ことを要求する（PostgreSQL の仕様）。
--    **実行時にだけ**付与し、直後に剥がす（20260915000000 / 20260926000000 と同じ）。
GRANT CREATE ON SCHEMA public TO app_purge_probe;

CREATE FUNCTION app_complete_tenant_purge() RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $BODY$
DECLARE
  v_tenant uuid := app_tenant_id();
  v_count integer;
BEGIN
  -- fail-closed (a): テナント文脈が無い。
  IF v_tenant IS NULL THEN
    RAISE EXCEPTION 'app_complete_tenant_purge: テナント文脈がありません（docs/05 §9.7）';
  END IF;
  -- fail-closed (b): 削除ジョブの文脈以外から呼ばれた。
  IF current_setting('app.purge_scope', true) IS DISTINCT FROM 'on' THEN
    RAISE EXCEPTION 'app_complete_tenant_purge: app.purge_scope が on ではありません';
  END IF;
  -- fail-closed (c): 実行中の削除（TenantPurgeRun）を経ていない。
  IF NOT EXISTS (
    SELECT 1 FROM tenant_purge_runs r
     WHERE r.tenant_id = v_tenant AND r.cause = 'TENANT_PURGED' AND r.status = 'RUNNING'
  ) THEN
    RAISE EXCEPTION 'app_complete_tenant_purge: 実行中の TenantPurgeRun がありません（F-064 AC-2）';
  END IF;

  -- 🔴 CAS。`CLOSING` 以外（すでに `PURGED` / 途中で `ACTIVE` に戻っていた等）は 0 件 = false を返す。
  --    遷移表（`@ses/domain` の `TENANT_LIFECYCLE_TRANSITIONS`）の検査は呼び出し側（`transition()`）が先に行う。
  UPDATE tenants
     SET lifecycle_state = 'PURGED',
         lifecycle_changed_at = now(),
         lifecycle_changed_by = NULL
   WHERE id = v_tenant AND lifecycle_state = 'CLOSING';
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count = 1;
END;
$BODY$;
ALTER FUNCTION app_complete_tenant_purge() OWNER TO app_purge_probe;

REVOKE CREATE ON SCHEMA public FROM app_purge_probe;

-- 🔴 CREATE FUNCTION が既定で PUBLIC に付与する EXECUTE を剥がし、app_tenant にだけ与える。
REVOKE ALL ON FUNCTION app_complete_tenant_purge() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_complete_tenant_purge() TO app_tenant;

COMMENT ON FUNCTION app_complete_tenant_purge() IS
  'T-10-09: CLOSING → PURGED の CAS（docs/05 §9.7 tenant.purge）。対象は app_tenant_id()、前提は app.purge_scope=on と RUNNING の TenantPurgeRun。呼び出し元は packages/db/src/tenant-purge.ts のみ。';

-- ----------------------------------------------------------------------------
-- ④ 削除スコープ（`app.purge_scope = 'on'`）の追加ポリシー
-- ----------------------------------------------------------------------------
-- 🔴 述語は 3 つの AND: テナント境界（`tenant_id = app_tenant_id()`）/ ホスト文脈（`app_is_host()`。ジョブは常にホスト）/
--    削除スコープ（`app_purge_scope_on()`）。C3 の既存ポリシーと **OR** で合成されるため、`'off'` の通常経路では何も変わらない。
-- 🔴 対象の表は `packages/config/src/retention.ts` の `PURGE_SPEC.delete` と **1 対 1** である（`tests/isolation/tenant-purge.test.ts`
--    が `pg_policy` を走査して突合する。表が spec に増えたらここにも足す = 足さないと削除がその表の取引先の行に届かず、テストが落ちる）。
-- 🔴 DELETE のポリシーは `rows: 'ALL'` の表（`engineer_careers`）だけ。他の表は UPDATE（列の消去）しかしない。
-- 🔴 SELECT のポリシーも置く理由: PostgreSQL は UPDATE / DELETE の WHERE（既存行の参照）にも SELECT ポリシーを適用するため、
--    SELECT が無いと取引先所有の行が UPDATE の対象に入らない。加えて `listPurgeObjectKeys` の S3 キー列挙（SELECT）にも要る。
-- 🔴 INSERT のポリシーは置かない（削除スコープで行を作ることは無い）。
CREATE OR REPLACE FUNCTION app_purge_scope_on() RETURNS boolean LANGUAGE sql STABLE AS
  $$ SELECT COALESCE(current_setting('app.purge_scope', true), 'off') = 'on' $$;

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'engineers', 'skill_sheets', 'skill_sheet_extractions', 'engineer_careers',
    'users', 'invitations', 'partner_companies',
    'engineer_snapshots', 'proposals', 'proposal_events', 'proposal_requests', 'review_gates', 'match_candidates',
    'messages',
    'contract_documents', 'contract_templates', 'contracts', 'extension_reviews',
    'notifications', 'email_dispatches', 'send_attempts', 'data_export_requests'
  ] LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', t || '_purge_scope_select', t);
    EXECUTE format(
      'CREATE POLICY %I ON %I FOR SELECT TO app_tenant USING (tenant_id = app_tenant_id() AND app_is_host() AND app_purge_scope_on())',
      t || '_purge_scope_select', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', t || '_purge_scope_update', t);
    EXECUTE format(
      'CREATE POLICY %I ON %I FOR UPDATE TO app_tenant USING (tenant_id = app_tenant_id() AND app_is_host() AND app_purge_scope_on()) WITH CHECK (tenant_id = app_tenant_id() AND app_is_host() AND app_purge_scope_on())',
      t || '_purge_scope_update', t);
  END LOOP;
END $$;

DROP POLICY IF EXISTS engineer_careers_purge_scope_delete ON engineer_careers;
CREATE POLICY engineer_careers_purge_scope_delete ON engineer_careers FOR DELETE TO app_tenant
  USING (tenant_id = app_tenant_id() AND app_is_host() AND app_purge_scope_on());

-- 🔴 同時に 2 本の `RUNNING` を持たない（`tenant.purge` の CAS の DB 側の担保。BullMQ の `jobId` は補助）。
CREATE UNIQUE INDEX IF NOT EXISTS "tenant_purge_runs_one_running_idx"
  ON "tenant_purge_runs" ("tenant_id", "cause") WHERE "status" = 'RUNNING';
