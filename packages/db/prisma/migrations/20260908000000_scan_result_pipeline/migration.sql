-- ============================================================================
-- T-05-05 ウイルススキャンのコネクタとジョブ（docs/05 §8.5 / §9.6 / docs/03 §3.4）
-- ============================================================================
-- 本 migration が置くのは 2 つである:
--   1. `skill_sheets(object_key)` の UNIQUE INDEX
--      —— スキャン結果はオブジェクトキーでしか対象を引き当てられない（GuardDuty は
--         「バケット + キー + 版」しか教えてくれない。docs/03 §3.4.1）。
--   2. 専用ロール `app_scan_probe` + SECURITY DEFINER 関数 2 本
--      —— ホスト文脈のジョブから**所有者を問わず**スキャン状態を適用・照会するための、
--         列を絞った限定経路（下記「判断事項」）。
--
-- ============================================================================
-- 🔴 判断事項: なぜ専用ロール + SECURITY DEFINER が要るのか（docs/05 §4.4.1 と同型の問題）
-- ============================================================================
-- `skill_sheets` は **C3 OWNER_SCOPED**（docs/05 §4.4）であり、ポリシーは
--   `tenant_id = app_tenant_id() AND owner_partner_company_id IS NOT DISTINCT FROM app_partner_id()`
-- である。ジョブの文脈（`systemTenantCtx`。docs/05 §9.2）は `partner_company_id` を常に null と
-- 定めているため、ホスト文脈からは **`owner_partner_company_id IS NULL` の行しか見えない**。
--
-- ところがウイルススキャンは所有者と無関係に起きる:
--   - パートナー（`PARTNER_ADMIN` / `PARTNER_SALES`）も自社エンジニアのスキルシートを上げる
--     （docs/05 §4.4 の `usage_counters` 例外の理由と同じ。`F-011` の関連ロール）
--   - スキャン結果は S3 のイベントとして届き、**アップロードした利用者のセッションは既に無い**
-- したがって素の RLS のままでは「パートナーが上げたファイルだけ永久に `SCANNING` のまま」に
-- なる。これは `BR-26`（`CLEAN` になるまで共有しない）を**共有できない側に**破るだけでなく、
-- 感染ファイルの隔離（`F-011 AC-3`）も効かないということである。
--
-- 🔴 採った形（§4.4.1 の `assignments ← engineers` / §4.5 の `app_engineer_is_shared` と同型）:
--   - 専用ロール `app_scan_probe`（NOLOGIN / NOBYPASSRLS。`000_roles.sql`）
--   - `skill_sheets` の **スキャン関連の列だけ**を列レベル GRANT
--     （SELECT: id / tenant_id / object_key / scan_status / uploaded_at / is_latest、
--       UPDATE: scan_status / scan_updated_at / is_latest）
--   - `app_scan_probe` 向けの RLS ポリシーは **`tenant_id = app_tenant_id()` のみ**
--     （パートナー境界は課さないが、**テナント境界は課す**）
--   - 関数の本体でも `app_tenant_id() IS NULL` を拒否する（fail-closed）
-- 🔴 これにより緩むのは「同一テナント内で、スキャンの 3 列だけ」であり、
--    氏名・スキル・エンジニア本体・他テナントには 1 列も届かない。
--
-- 🔴 呼び出し元の限定: `TenantDb`（docs/05 §4.3）は `$queryRaw` を型から除いているため、
--    `apps/**` からこの関数を呼ぶ経路は存在しない。実際の呼び出しは
--    `packages/db/src/file-scan.ts` の 2 関数だけであり、
--    `tests/static/auth-db-callers.test.ts` がファイル単位で固定する
--    （`app_engineer_is_shared` と同じ規律）。

-- ============================================================================
-- 1. skill_sheets(object_key) の UNIQUE INDEX
-- ============================================================================
-- 🔴 UNIQUE にする（単なる INDEX にしない）: オブジェクトキーは
--    `t/{tenantId}/skill-sheets/{engineerId}/{version}/{uuid}.{ext}` であり
--    `{uuid}` は発行のたびに新しい（docs/05 §14.1）。同じキーの行が 2 つあるということは
--    「1 つのオブジェクトに 2 つのスキルシート行が紐づく」ことであり、そのときスキャン結果を
--    どちらに適用すべきかが決まらない。**曖昧さを DB で禁止する。**
CREATE UNIQUE INDEX "skill_sheets_object_key_key" ON "skill_sheets"("object_key");

-- ============================================================================
-- 2. app_scan_probe（判断事項参照）
-- ============================================================================
GRANT USAGE ON SCHEMA public TO app_scan_probe;

-- 🔴 列レベル GRANT。ここに列を足すことは「スキャン以外の情報が越境する」ことを意味する。
GRANT SELECT (id, tenant_id, object_key, scan_status, uploaded_at, is_latest)
  ON skill_sheets TO app_scan_probe;
GRANT UPDATE (scan_status, scan_updated_at, is_latest) ON skill_sheets TO app_scan_probe;

-- 🔴 `skill_sheets` の UPDATE は、オーナー列の継承トリガ
--    （`inherit_owner_partner_company('engineers','engineer_id')`。migration 20260903070000 /
--    docs/05 §4.4.1）を必ず起動する。このトリガは **SECURITY INVOKER** で親（`engineers`）を
--    読むため、実行ロール（= SECURITY DEFINER の所有者 `app_scan_probe`）に
--    `engineers` の読み取りが無いと `permission denied for table engineers` で
--    **スキャン結果の適用そのものが失敗する**（実測）。
-- 🔴 `app_assignment_owner_probe` と**まったく同じ 3 列・同じ形のポリシー**を与える
--    （docs/05 §4.4.1）。増やすのはこの 3 列だけであり、氏名・連絡先・スキルには届かない。
GRANT SELECT (tenant_id, id, owner_partner_company_id) ON engineers TO app_scan_probe;
DROP POLICY IF EXISTS engineers_scan_probe_read ON engineers;
CREATE POLICY engineers_scan_probe_read ON engineers FOR SELECT TO app_scan_probe
  USING (tenant_id = app_tenant_id());

-- 🔴 app_scan_probe 向けのポリシー。パートナー境界は課さないが**テナント境界は課す**。
DROP POLICY IF EXISTS skill_sheets_scan_probe_select ON skill_sheets;
CREATE POLICY skill_sheets_scan_probe_select ON skill_sheets FOR SELECT TO app_scan_probe
  USING (tenant_id = app_tenant_id());
DROP POLICY IF EXISTS skill_sheets_scan_probe_update ON skill_sheets;
CREATE POLICY skill_sheets_scan_probe_update ON skill_sheets FOR UPDATE TO app_scan_probe
  USING (tenant_id = app_tenant_id())
  WITH CHECK (tenant_id = app_tenant_id());

-- 🔴 ALTER FUNCTION ... OWNER TO は「新オーナーが対象スキーマに CREATE 権限を持つ」ことを
--    要求する（PostgreSQL の仕様）。**実行時にだけ**付与し、直後に剥がす
--    （境界バイパスロールにスキーマ作成権を常置しない。migration 20260903070000 と同じ）。
GRANT CREATE ON SCHEMA public TO app_scan_probe;

-- ----------------------------------------------------------------------------
-- 2-a. app_apply_scan_status: スキャン結果の適用（scan.apply-result / scan.poll）
-- ----------------------------------------------------------------------------
-- 🔴 遷移の判断（重篤度の単調増加。「`CLEAN` へ戻さない」）は **`packages/domain` の
--    `scanStatusesReplaceableBy()`** が持ち、ここへは「置き換えてよい現在値の一覧」
--    （`p_replaceable`）として渡ってくる。重篤度の表を SQL に書き写さない ——
--    2 実装になり、片方だけが更新されるためである。
-- 🔴 ここが担うのは **CAS** である: `scan_status = ANY(p_replaceable)` を条件に 1 行だけ更新する。
--    読んでから書くまでの間に他の実行が先に書いても、条件に合わなければ 0 件になる
--    （`KEPT`）。並行実行で重篤度の低い結果が高い結果を上書きすることはない。
-- 🔴 `is_latest` を落とす理由: `skill_sheets_latest_clean_check`（`is_latest = false OR
--    scan_status = 'CLEAN'`）があるため、最新版が `CLEAN` から非 `CLEAN` へ動くときに
--    フラグを残すと CHECK 違反で更新そのものが失敗する。**フラグを落とすのが正しい**
--    （`F-011 AC-1`「`CLEAN` になった版のみ最新版フラグを持てる」）。
CREATE FUNCTION app_apply_scan_status(
  p_object_key  text,
  p_status      text,
  p_replaceable text[],
  p_observed_at timestamptz
) RETURNS TABLE (outcome text, previous_status text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $BODY$
DECLARE
  v_id      uuid;
  v_prev    text;
  v_updated integer;
BEGIN
  -- 🔴 fail-closed。テナント文脈が無い接続（withSystemScope / migration）から呼ばれても
  --    「全テナントの行が対象」にならない。
  IF app_tenant_id() IS NULL THEN
    RAISE EXCEPTION 'app_apply_scan_status: テナント文脈がありません（app.tenant_id が未設定）';
  END IF;
  -- 🔴 確定 → 未確定の巻き戻しを DB でも拒む（domain 側でも例外にしている。二重）。
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

  IF NOT FOUND THEN
    -- 🔴 「見つからない」を 0 件更新（＝成功）に畳まない。呼び出し側が A-005 に出す。
    RETURN QUERY SELECT 'NOT_FOUND'::text, NULL::text;
    RETURN;
  END IF;

  UPDATE skill_sheets
     SET scan_status    = p_status,
         scan_updated_at = p_observed_at,
         is_latest      = (is_latest AND p_status = 'CLEAN')
   WHERE id = v_id
     AND tenant_id = app_tenant_id()
     AND scan_status = ANY(p_replaceable);
  GET DIAGNOSTICS v_updated = ROW_COUNT;

  RETURN QUERY SELECT CASE WHEN v_updated = 1 THEN 'APPLIED' ELSE 'KEPT' END, v_prev;
END;
$BODY$;
ALTER FUNCTION app_apply_scan_status(text, text, text[], timestamptz) OWNER TO app_scan_probe;

-- ----------------------------------------------------------------------------
-- 2-b. app_list_stalled_scan_targets: 滞留の照会（scan.poll）
-- ----------------------------------------------------------------------------
-- 🔴 返すのは `id` と `object_key` だけである（氏名・スキル・エンジニア本体には触れない）。
-- 🔴 `p_limit` は上限を SQL 側でも締める（呼び出し側が巨大な値を渡してもテナント全件を
--    1 回のジョブで舐めない）。残りは 5 分後の実行が古い順に拾う。
CREATE FUNCTION app_list_stalled_scan_targets(
  p_before timestamptz,
  p_limit  integer
) RETURNS TABLE (skill_sheet_id uuid, object_key text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $BODY$
BEGIN
  IF app_tenant_id() IS NULL THEN
    RAISE EXCEPTION 'app_list_stalled_scan_targets: テナント文脈がありません（app.tenant_id が未設定）';
  END IF;

  RETURN QUERY
    SELECT s.id, s.object_key
      FROM skill_sheets s
     WHERE s.tenant_id = app_tenant_id()
       AND s.scan_status = 'SCANNING'
       AND s.uploaded_at <= p_before
     ORDER BY s.uploaded_at ASC
     LIMIT LEAST(GREATEST(COALESCE(p_limit, 1), 1), 500);
END;
$BODY$;
ALTER FUNCTION app_list_stalled_scan_targets(timestamptz, integer) OWNER TO app_scan_probe;

-- 🔴 CREATE は上の 2 つの ALTER FUNCTION のときにしか要らない。直ちに剥がす。
REVOKE CREATE ON SCHEMA public FROM app_scan_probe;

-- 🔴 CREATE FUNCTION が既定で PUBLIC に付与する EXECUTE を剥がし、app_tenant にだけ与える
--    （§4.5 の `app_engineer_is_shared` と同じ規律）。app_platform / app_platform_write には
--    与えない —— 運営者コンソールはテナントの業務データを書き換えない（CLAUDE.md §10.5）。
REVOKE ALL ON FUNCTION app_apply_scan_status(text, text, text[], timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION app_list_stalled_scan_targets(timestamptz, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_apply_scan_status(text, text, text[], timestamptz) TO app_tenant;
GRANT EXECUTE ON FUNCTION app_list_stalled_scan_targets(timestamptz, integer) TO app_tenant;

COMMENT ON FUNCTION app_apply_scan_status(text, text, text[], timestamptz) IS
  'T-05-05: スキャン結果の適用（docs/05 §8.5 / §9.6）。呼び出し元は packages/db/src/file-scan.ts のみ。';
COMMENT ON FUNCTION app_list_stalled_scan_targets(timestamptz, integer) IS
  'T-05-05: SCANNING 滞留の照会（docs/05 §8.5 の保険）。呼び出し元は packages/db/src/file-scan.ts のみ。';
