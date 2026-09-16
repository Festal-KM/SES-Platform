-- ============================================================================
-- T-10-03 上限到達の判定と停止（docs/02 `F-027` 処理①〜⑤ / 章 7.5 / docs/05 §5.8 / §7.6 / §16.1）
-- ============================================================================
-- 本 migration が置くのは 1 表である:
--   `usage_limit_states` —— テナント × 計測（上限を持つ 7 つ）につき **1 行**の「いまの水準」
--   （`BELOW` / `NEARING` / `REACHED`）。`usage.limit-check`（毎 10 分）が評価して書き、
--   ① 主平面の `S-038`（#69）/ `#70` が「停止しているか」を読む
--   ② 遷移（接近 / 到達 / 解除）の**契機**を決める（通知 = `EmailDispatch` / 記録 = `AuditLog`）
--   ③ 運営者の監視（`F-057` / `A-004`）が接近・到達を読む
--
-- ============================================================================
-- 🔴 判断事項 1: 「いまの水準」を表に持つ（都度計算にしない）
-- ============================================================================
-- 「AI が停止しているか」の定義は **予約と同じ判定式（`probeAiCostHeadroom`）で 1 回ぶんの見積りが
-- 通らないこと**であり、その見積り（`gate-inspector` の下限。`packages/ai`）は主平面から組み立てられない
-- （`apps/web` は `@ses/ai` の実行系を import できない。`tests/static/ai-single-path.test.ts`）。
-- また **パートナー所属の利用者は `usage_counters` の `AI_COST_USD` 行を読めない**（C2）ため、
-- `#70`（停止の事実と理由だけを返す）を都度計算で成立させる経路が無い。
-- 評価はワーカーが行い、結果（金額を含まない水準）だけを表に置く。
--
-- 🔴 判断事項 2: 遷移の記録は「状態が変わったときだけ」。行は消さない
-- ============================================================================
-- 通知（80% / 到達）と監査ログ（到達 / 解除）は **`level` が変わった実行**でだけ出す。
-- 10 分ごとに同じ水準を評価しても行の `evaluated_at` が進むだけで、通知も記録も増えない。
-- `notified_level` / `notified_on` は「その日その水準で通知済みか」の記録であり、
-- 同じ日に水準が往復（ストレージの削除 → 再アップロード）しても **1 日 1 回**に収める。
-- 期間が変われば（日次 = 翌 0 時 JST / 月次 = 翌月）カウンタが新しい行になるため水準は
-- 自然に `BELOW` へ戻り、それが「解除」として記録される。
--
-- 🔴 判断事項 3: RLS —— ホストは全行、パートナーは「AI が停止中」の行だけ（列の値で絞る）
-- ============================================================================
-- 残量・上限値・接近（80%）はテナントの契約情報であり、パートナー所属ロールには見せない
-- （`F-027 AC-1` / `BR-04` の第二境界）。一方で **停止の事実と理由だけは全ロールに示す**
-- （`#70`。黙って劣化させない。`BR-24`）。したがってパートナー文脈の SELECT は
-- `metric = 'AI_COST_USD' AND level = 'REACHED'` の行に限る —— 停止していないときは 0 行であり、
-- 接近（`NEARING`）の行も他の計測の行も 1 行も見えない。
-- 書けるのはホスト文脈（ジョブ = `systemTenantCtx`）だけ。DELETE は開かない（履歴は `resolved` ではなく
-- 上書きだが、行そのものを消す経路を作らない）。
-- 🔴 `usage_counters` の `STORAGE_BYTES` の例外（migration 20260907000000 §2）と同じ「列の値でポリシーを
--    絞る」形であり、テナント境界（`tenant_id = app_tenant_id()`）は変わらない。

CREATE TABLE IF NOT EXISTS usage_limit_states (
  id              uuid PRIMARY KEY,
  tenant_id       uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  metric          text NOT NULL,
  level           text NOT NULL,
  -- その水準になった時刻（表示の「停止中（HH:MM から）」と監視の滞留時間の根拠）。
  level_since     timestamptz(3) NOT NULL,
  -- 評価に使ったカウンタの期間（DAY = 'YYYY-MM-DD' / MONTH = 'YYYY-MM'。Asia/Tokyo）。
  period_kind     text NOT NULL,
  period_key      text NOT NULL,
  -- 🔴 「その日その水準で通知・記録済み」の目印（1 日 1 回）。未通知なら NULL。
  notified_level  text,
  notified_on     text,
  evaluated_at    timestamptz(3) NOT NULL,
  -- 🔴 `USAGE_LIMIT_METRICS`（`packages/domain/src/quota/limits.ts`）と同じ値集合。
  --    `usage_counters_metric_check` の部分集合（席数・電子署名は上限の判定対象ではない）。
  CONSTRAINT "usage_limit_states_metric_check" CHECK ("metric" IN ('AI_COST_USD', 'AI_UNIT_SHEET_PARSE', 'AI_UNIT_MATCH_RATIONALE', 'AI_UNIT_PROPOSAL_DRAFT', 'AI_UNIT_RENEWAL_SUMMARY', 'EMAIL_COUNT', 'STORAGE_BYTES')),
  -- 🔴 `USAGE_LIMIT_LEVELS`（`packages/domain/src/quota/limit-level.ts`）と同じ値集合。
  CONSTRAINT "usage_limit_states_level_check" CHECK ("level" IN ('BELOW', 'NEARING', 'REACHED')),
  CONSTRAINT "usage_limit_states_notified_level_check" CHECK ("notified_level" IS NULL OR "notified_level" IN ('BELOW', 'NEARING', 'REACHED')),
  CONSTRAINT "usage_limit_states_period_kind_check" CHECK ("period_kind" IN ('DAY', 'MONTH')),
  CONSTRAINT "usage_limit_states_notified_pair_check" CHECK (("notified_level" IS NULL) = ("notified_on" IS NULL))
);

COMMENT ON TABLE usage_limit_states IS
  '上限に対するいまの水準（T-10-03。docs/02 F-027 / docs/05 §5.8）。テナント × 計測に 1 行。金額の列は無い';
COMMENT ON COLUMN usage_limit_states.level IS
  'BELOW / NEARING（80%）/ REACHED（到達。AI_COST_USD は停止、AI_UNIT_* は従量へ移行、STORAGE_BYTES はアップロード停止、EMAIL_COUNT は日次停止）';
COMMENT ON COLUMN usage_limit_states.notified_on IS
  'notified_level の水準で通知・記録した暦日（Asia/Tokyo。YYYY-MM-DD）。同じ日・同じ水準では再送しない';

-- 🔴 テナント × 計測に 1 行（`ON CONFLICT` の対象）。
CREATE UNIQUE INDEX IF NOT EXISTS usage_limit_states_tenant_metric_key
  ON usage_limit_states (tenant_id, metric);
-- 運営者の監視: 到達・接近中のテナントを引く。
CREATE INDEX IF NOT EXISTS usage_limit_states_level_since_idx
  ON usage_limit_states (level, level_since);

-- ----------------------------------------------------------------------------
-- RLS と GRANT。🔴 片方だけを足さない（docs/05 §4.2）
-- ----------------------------------------------------------------------------
ALTER TABLE usage_limit_states ENABLE ROW LEVEL SECURITY;
ALTER TABLE usage_limit_states FORCE ROW LEVEL SECURITY;

-- 🔴 SELECT: ホストは自テナントの全行。パートナーは「AI が停止中（AI_COST_USD かつ REACHED）」の行だけ。
DROP POLICY IF EXISTS usage_limit_states_select ON usage_limit_states;
CREATE POLICY usage_limit_states_select ON usage_limit_states FOR SELECT TO app_tenant
  USING (
    tenant_id = app_tenant_id()
    AND (app_is_host() OR (metric = 'AI_COST_USD' AND level = 'REACHED'))
  );

-- 書き込みは C2 HOST_ONLY（ジョブ文脈）。
DROP POLICY IF EXISTS usage_limit_states_c2_insert ON usage_limit_states;
CREATE POLICY usage_limit_states_c2_insert ON usage_limit_states FOR INSERT TO app_tenant
  WITH CHECK (tenant_id = app_tenant_id() AND app_is_host());

DROP POLICY IF EXISTS usage_limit_states_c2_update ON usage_limit_states;
CREATE POLICY usage_limit_states_c2_update ON usage_limit_states FOR UPDATE TO app_tenant
  USING (tenant_id = app_tenant_id() AND app_is_host())
  WITH CHECK (tenant_id = app_tenant_id() AND app_is_host());

-- 🔴 DELETE は開かない（行を消す経路を作らない）。
GRANT SELECT, INSERT, UPDATE ON usage_limit_states TO app_tenant;

-- ----------------------------------------------------------------------------
-- 管理平面（app_platform。docs/05 §5.5）—— `F-057` / `A-004` の材料。全列が状態・期間・時刻で非開示列は無い
-- ----------------------------------------------------------------------------
GRANT SELECT (
  id, tenant_id, metric, level, level_since, period_kind, period_key,
  notified_level, notified_on, evaluated_at
) ON usage_limit_states TO app_platform;

-- 🔴 platform_read ポリシー（migration 20260904010000 §1 の `tenant_keyed` ループと同じ式・同じ命名）。
DROP POLICY IF EXISTS usage_limit_states_platform_read ON usage_limit_states;
CREATE POLICY usage_limit_states_platform_read ON usage_limit_states FOR SELECT TO app_platform
  USING (
    current_setting('app.platform_user_id', true) <> ''
    AND (
      current_setting('app.target_tenant_id', true) = ''
      OR tenant_id::text = current_setting('app.target_tenant_id', true)
    )
  );
