-- ============================================================================
-- T-10-02 メール・ストレージの計測と日次ジョブ（docs/05 §9.8 / §5.9 / §16.5 / `F-026 AC-3`〜`AC-5`）
-- ============================================================================
-- 本 migration が置くのは 2 つである:
--   1. `usage_measurement_findings` —— `usage.gap-check`（欠測）と `usage.storage-reconcile`（検算の乖離）が
--      書く**検知結果**。`A-005`（docs/05 §16.5「計測欠測」）の材料であり、可視化は SP-11。
--   2. `tenant_monthly_costs` の**確定後の書き換え禁止**（トリガ）。docs/05 §9.8「月末を過ぎた期間は
--      `finalizedAt` を立てて以後書き換えない」を、アプリの `WHERE finalized_at IS NULL` に加えて DB で担保する。
--
-- ============================================================================
-- 🔴 判断事項 1: 検知結果を表に持つ（`SchedulerRun.detail` に件数だけ残す案を採らない）
-- ============================================================================
-- `A-005` は「どのテナントの・どの日の・どの計測が欠けているか」を出す必要がある（`F-026 AC-4` /
-- `F-059` 処理①「種別ごとに一覧化し、滞留時間と件数を表示」）。件数だけでは運営者が対処できない。
-- 一方で本文・宛先・PII は 1 列も持たない（`BR-40`。列は種別・期間・数値・時刻だけ）。
--
-- 🔴 判断事項 2: 行は (tenant, kind, metric, period) につき 1 つ。**消さずに `resolved_at` で閉じる**
-- ============================================================================
-- 同じ欠測を毎日検知しても行が積み上がらない（UNIQUE + upsert）。次回の検査で見つからなければ
-- `resolved_at` を立てる。消してしまうと「いつ検知され、いつ解消したか」が追えなくなる
-- （欠測 0 件という目標〔docs/02 章 7.10〕の達成を後から示せない）。
--
-- 🔴 判断事項 3: カウンタ（`usage_counters`）を**自動補正しない**（docs/03 §4.5）
-- ============================================================================
-- 本表は検知の記録であり、`usage_counters` への書き込みを一切伴わない。`AI_COST_USD` の突き合わせ
-- （`usage.daily-rollup`）だけが `AiUsage` を正として `value` を上書きするが、それは本表ではなく
-- `packages/db/src/usage-rollup.ts` の責務である。
--
-- ============================================================================
-- 🔴 RLS は C2 HOST_ONLY（docs/05 §4.4）
-- ============================================================================
-- 書き手はジョブ文脈（`systemTenantCtx` = ホスト相当）だけであり、パートナー文脈から見える理由が無い
-- （計測はテナント単位であり、取引先ごとの内訳を持たない）。

CREATE TABLE IF NOT EXISTS usage_measurement_findings (
  id           uuid PRIMARY KEY,
  tenant_id    uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  kind         text NOT NULL,
  metric       text NOT NULL,
  period_kind  text NOT NULL,
  period_key   text NOT NULL,
  expected     numeric(20, 6),
  observed     numeric(20, 6),
  detected_at  timestamptz(3) NOT NULL,
  last_seen_at timestamptz(3) NOT NULL,
  resolved_at  timestamptz(3),
  CONSTRAINT "usage_measurement_findings_kind_check" CHECK ("kind" IN ('GAP_MISSING', 'GAP_MISMATCH', 'STORAGE_DIVERGENCE')),
  -- 🔴 `usage_counters_metric_check` と同じ値集合（`tests/static/schema-enum-drift.test.ts` が突合する）。
  CONSTRAINT "usage_measurement_findings_metric_check" CHECK ("metric" IN ('AI_COST_USD', 'EMAIL_COUNT', 'STORAGE_BYTES', 'SEAT_COUNT', 'ESIGN_REQUESTS', 'AI_UNIT_SHEET_PARSE', 'AI_UNIT_MATCH_RATIONALE', 'AI_UNIT_PROPOSAL_DRAFT', 'AI_UNIT_RENEWAL_SUMMARY')),
  CONSTRAINT "usage_measurement_findings_period_kind_check" CHECK ("period_kind" IN ('DAY', 'MONTH')),
  -- 解消は検知より後である。
  CONSTRAINT "usage_measurement_findings_resolved_after_detected_check" CHECK (resolved_at IS NULL OR resolved_at >= detected_at)
);

COMMENT ON TABLE usage_measurement_findings IS
  '計測の欠測・検算の乖離（T-10-02。docs/05 §9.8 / §16.5）。A-005 の材料。usage_counters を自動補正しない';
COMMENT ON COLUMN usage_measurement_findings.expected IS
  '正の値（AI_COST_USD = AiUsage の合計 USD / STORAGE_BYTES = オブジェクトストアの実測バイト数）。正を持たない検知は NULL';
COMMENT ON COLUMN usage_measurement_findings.observed IS
  'usage_counters.value。行が無い（欠測）なら NULL';
COMMENT ON COLUMN usage_measurement_findings.resolved_at IS
  '次回の検査で見つからなかった時刻。行は消さない（検知と解消の履歴を残す）';

-- 🔴 同じ検知は 1 行（再検知は UPDATE）。
CREATE UNIQUE INDEX IF NOT EXISTS usage_measurement_findings_tenant_kind_metric_period_key
  ON usage_measurement_findings (tenant_id, kind, metric, period_kind, period_key);
-- `A-005`: 未解消の検知を新しい順に。
CREATE INDEX IF NOT EXISTS usage_measurement_findings_resolved_at_last_seen_at_idx
  ON usage_measurement_findings (resolved_at, last_seen_at);

-- ----------------------------------------------------------------------------
-- RLS（C2 HOST_ONLY）と GRANT。🔴 片方だけを足さない（docs/05 §4.2）
-- ----------------------------------------------------------------------------
ALTER TABLE usage_measurement_findings ENABLE ROW LEVEL SECURITY;
ALTER TABLE usage_measurement_findings FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS usage_measurement_findings_c2_select ON usage_measurement_findings;
CREATE POLICY usage_measurement_findings_c2_select ON usage_measurement_findings FOR SELECT TO app_tenant
  USING (tenant_id = app_tenant_id() AND app_is_host());

DROP POLICY IF EXISTS usage_measurement_findings_c2_insert ON usage_measurement_findings;
CREATE POLICY usage_measurement_findings_c2_insert ON usage_measurement_findings FOR INSERT TO app_tenant
  WITH CHECK (tenant_id = app_tenant_id() AND app_is_host());

DROP POLICY IF EXISTS usage_measurement_findings_c2_update ON usage_measurement_findings;
CREATE POLICY usage_measurement_findings_c2_update ON usage_measurement_findings FOR UPDATE TO app_tenant
  USING (tenant_id = app_tenant_id() AND app_is_host())
  WITH CHECK (tenant_id = app_tenant_id() AND app_is_host());

DROP POLICY IF EXISTS usage_measurement_findings_c2_delete ON usage_measurement_findings;
CREATE POLICY usage_measurement_findings_c2_delete ON usage_measurement_findings FOR DELETE TO app_tenant
  USING (tenant_id = app_tenant_id() AND app_is_host());

GRANT SELECT, INSERT, UPDATE, DELETE ON usage_measurement_findings TO app_tenant;

-- ----------------------------------------------------------------------------
-- 管理平面（app_platform。docs/05 §5.5）—— `A-005` の材料は全列が「件数・状態・数値」であり非開示列は無い
-- ----------------------------------------------------------------------------
GRANT SELECT (
  id, tenant_id, kind, metric, period_kind, period_key, expected, observed,
  detected_at, last_seen_at, resolved_at
) ON usage_measurement_findings TO app_platform;

-- 🔴 platform_read ポリシー（migration 20260904010000 §1 の `tenant_keyed` ループと同じ式・同じ命名）。
DROP POLICY IF EXISTS usage_measurement_findings_platform_read ON usage_measurement_findings;
CREATE POLICY usage_measurement_findings_platform_read ON usage_measurement_findings FOR SELECT TO app_platform
  USING (
    current_setting('app.platform_user_id', true) <> ''
    AND (
      current_setting('app.target_tenant_id', true) = ''
      OR tenant_id::text = current_setting('app.target_tenant_id', true)
    )
  );

-- ============================================================================
-- 2. `tenant_monthly_costs` の確定後の書き換え禁止（docs/05 §9.8 / §5.9 / docs/03 §4.15）
-- ============================================================================
-- 🔴 判断事項 4: 確定行で変えてよい列は `meter_diff_jpy` と `updated_at` だけ
-- ============================================================================
-- メータリング差異（`BillingMeterSubmission.value` と Stripe の請求額の差。docs/05 §5.9）は
-- 月次締めの**後**（`billing.meter-submit` = 翌月 1 日）に確定するため、確定行にも書けなければ
-- ならない。それ以外の列（売上・原価・粗利・月末ストレージ・版）は確定後に 1 列も動かさない。
-- 🔴 削除は**権限で**禁じる（DELETE → 再 INSERT で「書き換え」を作れてしまう）。行トリガで DELETE を
--    拒むと `tenants` からの `ON DELETE CASCADE`（テナントの物理削除）まで止めてしまうため、
--    `app_tenant` から DELETE を REVOKE する形にする（アプリ経路に削除は存在しない）。
-- 🔴 `app_migrator` 所有の通常のトリガ関数（SECURITY DEFINER ではない）。RLS を迂回する必要が無い。
REVOKE DELETE ON tenant_monthly_costs FROM app_tenant;

CREATE OR REPLACE FUNCTION tenant_monthly_costs_guard_finalized()
RETURNS trigger
LANGUAGE plpgsql
AS $fn$
BEGIN
  IF OLD.finalized_at IS NOT NULL
     AND (to_jsonb(OLD) - 'meter_diff_jpy' - 'updated_at') IS DISTINCT FROM (to_jsonb(NEW) - 'meter_diff_jpy' - 'updated_at') THEN
    RAISE EXCEPTION 'tenant_monthly_costs: 確定済み（finalized_at IS NOT NULL）の行は meter_diff_jpy 以外を書き換えられません（docs/05 §9.8）'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$fn$;

DROP TRIGGER IF EXISTS tenant_monthly_costs_guard_finalized ON tenant_monthly_costs;
CREATE TRIGGER tenant_monthly_costs_guard_finalized
  BEFORE UPDATE ON tenant_monthly_costs
  FOR EACH ROW EXECUTE FUNCTION tenant_monthly_costs_guard_finalized();
