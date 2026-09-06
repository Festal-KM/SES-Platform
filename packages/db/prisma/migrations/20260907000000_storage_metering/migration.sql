-- T-05-04（docs/sprints/SP-05-engineer-ledger.md）: S3 直接アップロードとストレージ計測。
-- 一次資料: docs/05 §8.7（レート制限ガード）/ §14.1（オブジェクトキー）/ §14.2（pre-signed URL）/
--           §4.4（RLS ポリシークラス）/ docs/03 §4.5（ストレージは加算方式。UsageCounter が正）。
--
-- ============================================================================
-- 1. `skill_sheets.storage_counted_at` —— 🔴 加算・減算の**冪等性のアンカー**
-- ============================================================================
-- docs/03 §4.5 は「アップロード完了の確定時に加算、削除成功時に減算」と定めるが、加算と減算は
-- どちらも**再実行されうる**（#19 の二重送信、削除ジョブの再試行、ワーカーの重複起動）。
-- 差分を素直に足し引きするだけの実装は、1 回の再実行で恒久的にずれる。ずれた `UsageCounter` は
-- ①アップロードの停止判定（`F-027`）②月末の原価固定（`TenantMonthlyCost`）の両方の根拠を失う。
--
-- 🔴 そこで「**この版のバイト数が現在カウンタに含まれているか**」を行の状態として持ち、
--    状態遷移（NULL → 時刻 / 時刻 → NULL）が**成立したときだけ**カウンタを動かす。
--    条件付き UPDATE（CAS）なので、二重実行の 2 回目は 0 件更新になり加算も減算も起きない。
--    `usage.storage-reconcile`（SP-10 / SP-11）の突き合わせ対象もこの列である
--    （`SUM(byte_size) WHERE storage_counted_at IS NOT NULL` = カウンタの値）。
--
-- 🔴 `purged_at` で代用しない。あちらは「原本を削除した」という業務上の事実であり、
--    こちらは「計上に含まれているか」という会計上の事実である。片方から他方を導出すると、
--    S3 の削除に失敗した（=まだ課金されている）ファイルが計上から外れる。
ALTER TABLE skill_sheets ADD COLUMN IF NOT EXISTS storage_counted_at timestamptz(3);

COMMENT ON COLUMN skill_sheets.storage_counted_at IS
  'UsageCounter(STORAGE_BYTES) に byte_size を計上済みの時刻。NULL = 未計上（T-05-04）';

-- 🔴 部分インデックス（Prisma スキーマでは表現できないため手書き。`skill_sheets` の
--    部分 UNIQUE（is_latest）と同じ扱い）。突き合わせジョブの母集団を引くためのもの。
CREATE INDEX IF NOT EXISTS skill_sheets_storage_counted_idx
  ON skill_sheets (tenant_id) INCLUDE (byte_size)
  WHERE storage_counted_at IS NOT NULL;

-- ============================================================================
-- 2. 🔴 `usage_counters` の C2（HOST_ONLY）に対する **metric 限定の例外**
-- ============================================================================
-- 20260903050000 §7 は `usage_counters` を C2 HOST_ONLY（`tenant_id = app_tenant_id()
-- AND app_is_host()`）に置いた。運営指標（AI 原価・メール通数・席数）はホストの数字であり、
-- 取引先に見せるものではないためである。この判断は維持する。
--
-- 🔴 しかし **ストレージだけは取引先も消費する**。`F-011` の関連ロールには `PARTNER_ADMIN` /
--    `PARTNER_SALES` が含まれ（自社エンジニア分のスキルシート）、docs/05 §14.2 は
--    「上限に達していたら署名付き URL を発行しない」ことを**発行前の必須条件**としている。
--    C2 のままだと、パートナー文脈では現在使用量を読むことも計上することもできない ——
--    ①判定できない（＝上限が実質的に効かないアップロード経路が残る）
--    ②計上できない（＝取引先が置いたバイト数が原価に載らない）
--    のどちらも `CLAUDE.md` §3.4 / §10.6 に反する。
--
-- 🔴 例外は **`metric = 'STORAGE_BYTES'` の行に限る**（列の値でポリシーを絞る）。
--    `AI_COST_USD` / `EMAIL_COUNT` / `SEAT_COUNT` / `AI_UNIT_*` は C2 のままであり、
--    パートナー文脈からは 1 行も見えない。開くのは「自テナントの総保管バイト数」だけで、
--    そこには他社の名前も件数も業務データも含まれない（`CLAUDE.md` §3.1 の 🔴 に抵触しない）。
--    パートナーは上限に達したことをどのみち知る（`F-027 AC-1` の `blocked-notice` は
--    全ロール向けである。docs/05 §6.6 #70）。
--
-- 🔴 DELETE は開かない（計測行を消せる経路を作らない）。テナントをまたぐ読み書きは
--    `tenant_id = app_tenant_id()` が引き続き閉じている（第 1 境界は変わらない）。
DROP POLICY IF EXISTS usage_counters_storage_select ON usage_counters;
CREATE POLICY usage_counters_storage_select ON usage_counters FOR SELECT TO app_tenant
  USING (tenant_id = app_tenant_id() AND metric = 'STORAGE_BYTES');

DROP POLICY IF EXISTS usage_counters_storage_insert ON usage_counters;
CREATE POLICY usage_counters_storage_insert ON usage_counters FOR INSERT TO app_tenant
  WITH CHECK (tenant_id = app_tenant_id() AND metric = 'STORAGE_BYTES');

DROP POLICY IF EXISTS usage_counters_storage_update ON usage_counters;
CREATE POLICY usage_counters_storage_update ON usage_counters FOR UPDATE TO app_tenant
  USING (tenant_id = app_tenant_id() AND metric = 'STORAGE_BYTES')
  WITH CHECK (tenant_id = app_tenant_id() AND metric = 'STORAGE_BYTES');
