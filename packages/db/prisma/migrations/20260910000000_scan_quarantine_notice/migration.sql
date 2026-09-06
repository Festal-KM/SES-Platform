-- ============================================================================
-- T-05-08 スキャン失敗・隔離の周知（`docs/02` `F-011` 処理④ / docs/05 §8.5 / §9.6 / `A-22`）
-- ============================================================================
-- 本 migration が置くのは 1 つだけである: `app_scan_quarantine_target(text)`。
-- 「隔離になったスキルシートの**所有側**は誰か」を、ジョブのホスト文脈から引くための関数である。
--
-- ============================================================================
-- 🔴 判断事項: なぜ `app_scan_probe` を経由しなければならないのか
-- ============================================================================
-- 周知の宛先は「そのファイルの**所有側**の担当者」である（`F-011` 処理④）。所有側がホストなら
-- 分類 1、パートナーなら分類 2 であり、**分類を取り違えると `sandbox` で取引先の担当者へ実メールが
-- 飛ぶ**（`CLAUDE.md` §11.1）か、逆に**ホスト側の隔離が誰にも届かない**。したがって
-- `skill_sheets.owner_partner_company_id` を読む必要がある。
--
-- ところが `skill_sheets` は **C3 OWNER_SCOPED** であり、ジョブの文脈（`systemTenantCtx` =
-- パートナー列が常に null）からは `owner_partner_company_id IS NULL` の行しか見えない
-- （migration 20260908000000 の判断事項と**同じ問題**）。素の RLS のままでは
-- 「パートナーが上げたファイルの隔離だけ、誰にも周知されない」ことになる ——
-- これは `F-011` の 🔴「パートナーの担当者が隔離に気づけない状態にならない」の直接の違反である。
--
-- 🔴 採った形（20260908000000 と同型。**新しいロールも新しいポリシーも作らない**）:
--   - 既存の `app_scan_probe`（NOLOGIN / NOBYPASSRLS）に**列を 1 つだけ**足す
--     （`owner_partner_company_id`）
--   - ポリシーは既存の `skill_sheets_scan_probe_select`（`tenant_id = app_tenant_id()`）を再利用
--   - 関数の本体でも `app_tenant_id() IS NULL` を拒否する（fail-closed）
--
-- 🔴 **足すのは 1 列だけである。** `engineer_id` も `version` も `note` も `object_key` も
--    足さない —— 周知に要るのは「誰の所有か（＝ どの分類へ送るか）」と「どの版か（＝ 重複を
--    畳む鍵。既存の `id` で足りる）」だけであり、**メールに載せる内容は 1 つも無い**からである
--    （周知メールは「画面で確認してください」の 1 リンクのみ。`CLAUDE.md` §3.5 / §16.2）。
--    版番号やエンジニアの識別子は、**閲覧者自身の RLS（C3）で読める画面側**が出す。
--
-- 🔴 呼び出し元は `packages/db/src/scan-notice.ts` の 1 関数だけであり、
--    `tests/static/auth-db-callers.test.ts` がファイル単位で固定する
--    （`app_apply_scan_status` / `app_engineer_is_shared` と同じ規律）。

-- ----------------------------------------------------------------------------
-- 1. 列レベル GRANT の追加（🔴 ここに列を足すことは越境の範囲を広げることを意味する）
-- ----------------------------------------------------------------------------
GRANT SELECT (owner_partner_company_id) ON skill_sheets TO app_scan_probe;

-- ----------------------------------------------------------------------------
-- 2. app_scan_quarantine_target: 周知の対象（scan.apply-result / scan.poll）
-- ----------------------------------------------------------------------------
-- 🔴 返すのは ID・所有側・状態だけである。
-- 🔴 「隔離かどうか」の判定はここでしない —— それは `packages/domain` の
--    `isQuarantinedScanStatus` が持つ（重篤度の表と同じく、規則を SQL に書き写さない）。
--    ここは「その版の現在値」をそのまま返し、呼び出し側が domain の関数で判断する。
CREATE FUNCTION app_scan_quarantine_target(p_object_key text)
RETURNS TABLE (
  skill_sheet_id           uuid,
  owner_partner_company_id uuid,
  scan_status              text
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $BODY$
BEGIN
  -- 🔴 fail-closed。テナント文脈が無い接続（withSystemScope / migration）から呼ばれても
  --    「全テナントの行が対象」にならない。
  IF app_tenant_id() IS NULL THEN
    RAISE EXCEPTION 'app_scan_quarantine_target: テナント文脈がありません（app.tenant_id が未設定）';
  END IF;

  RETURN QUERY
    SELECT s.id, s.owner_partner_company_id, s.scan_status
      FROM skill_sheets s
     WHERE s.tenant_id = app_tenant_id()
       AND s.object_key = p_object_key;
END;
$BODY$;

-- 🔴 `ALTER FUNCTION ... OWNER TO` は「新オーナーが対象スキーマに CREATE 権限を持つ」ことを
--    要求する（PostgreSQL の仕様）。**実行時にだけ**付与し、直後に剥がす
--    （境界バイパスロールにスキーマ作成権を常置しない。20260908000000 と同じ）。
GRANT CREATE ON SCHEMA public TO app_scan_probe;
ALTER FUNCTION app_scan_quarantine_target(text) OWNER TO app_scan_probe;
REVOKE CREATE ON SCHEMA public FROM app_scan_probe;

-- 🔴 CREATE FUNCTION が既定で PUBLIC に付与する EXECUTE を剥がし、app_tenant にだけ与える。
--    app_platform / app_platform_write には与えない（運営者コンソールはテナントの業務データに
--    触れない。CLAUDE.md §10.5）。
REVOKE ALL ON FUNCTION app_scan_quarantine_target(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_scan_quarantine_target(text) TO app_tenant;

COMMENT ON FUNCTION app_scan_quarantine_target(text) IS
  'T-05-08: 隔離の周知先を決めるための所有側の引き当て（docs/02 F-011 処理④）。呼び出し元は packages/db/src/scan-notice.ts のみ。';
