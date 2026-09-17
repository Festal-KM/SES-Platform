-- ============================================================================
-- T-12-12 メール / ストレージのクォータ上書きの執行点配線（T-11-02 NG-1 の後続。docs/02 `F-027` / `F-057` /
-- docs/05 §5.2 / §5.8.1 ⑧ / §6.9 API-A6 / `CLAUDE.md` §3.1 第二境界 / §3.4 / §10.5）
-- ============================================================================
-- 本 migration が変えるのは `tenant_quota_overrides`（migration 20260924000000）の 3 点である。表・列・索引は変えない。
--   ① `metric` の CHECK を AI の月次件数 4 単位 → **6 計測**（+ `EMAIL_COUNT` / `STORAGE_BYTES`）に再定義する
--   ② `app_tenant` の SELECT ポリシーを C2 HOST_ONLY のまま **`STORAGE_BYTES` の行だけパートナー文脈にも開く**形に置き換える
--   ③ `app_tenant` の SELECT を**テーブル単位 → 列単位**に切り替え、`reason` / `set_by_platform_user_id` を読めなくする
--
-- ============================================================================
-- 🔴 判断事項 1: `EMAIL_COUNT` / `STORAGE_BYTES` を戻せる条件（T-11-02 NG-1 の解消）
-- ============================================================================
-- T-11-02 NG-1 は「上書きが表示（`A-004`）と判定（`usage.limit-check`）にだけ効き、執行点は既定値を読んでいた」ことである。
-- T-12-12 で執行点 4 か所（`apps/worker/src/jobs/email-send.ts` の `decideEmailRate` / `reserveEmailDailyQuota`、
-- `send-proposal.ts` の同じ 2 手順、`send-hold-release.ts` の `RATE_LIMIT` の解消判定、`apps/web/lib/skill-sheets/service.ts` の
-- `decideStorageUpload`）が **`resolveTenantQuotas`（`packages/db/src/quota-overrides.ts`。判定・表示と同じ 1 関数）**から
-- 上限を受けるようになった。deps に固定値（`dailyLimit: number` / `storageLimitBytes: bigint`）を渡す口は型から消した。
-- これで「上げたのに執行が変わらない」「停止と表示されているのに送られる」経路が無くなったため、2 計測を CHECK に戻す。
-- 分次上限（`EMAIL_MINUTE_LIMIT_PER_TENANT`）は対象外のまま（`packages/config` の値。docs/05 §5.8.1 ⑧）。
--
-- ============================================================================
-- 🔴 判断事項 2: パートナー文脈に開くのは `STORAGE_BYTES` の行だけ（`usage_counters_storage_select` と同じ判断）
-- ============================================================================
-- `F-027 AC-1`「残量・上限値はテナントの契約情報としてホスト所属ロールに表示され、パートナー所属ロールには表示されない」。
-- したがって基本は C2 HOST_ONLY のまま（AI 4 単位 / `EMAIL_COUNT` の上限値はパートナー文脈から 1 行も見えない。メールの
-- 3 執行点〔`email-send.ts` / `send-proposal.ts` / `send-hold-release.ts`〕はいずれも `SystemTenantCtx` = ホスト文脈で読む）。
-- 🔴 例外は **自社も消費する `STORAGE_BYTES` の行**である。ストレージ上限はテナント単位の枠であり、パートナーのアップロード
--    （`F-011` の関連ロールに `PARTNER_ADMIN` / `PARTNER_SALES` を含む）も同じ枠を消費する。パートナー文脈で上書き行が 0 行に
--    見えると `issueSkillSheetUploadUrl` は常に既定値で判定し、運営者が上限を上げても取引先のアップロードだけ止まり続ける
--    （逆に下げても取引先だけ通る）。migration 20260907000000 §2 が `usage_counters` の `STORAGE_BYTES` 行だけをパートナーに
--    開いたのと同じ理由・同じ粒度（列の値でポリシーを絞る。`usage_limit_states` ③〔`AI_COST_USD AND REACHED` 限定〕も同型）。
-- 🔴 開くのは **自テナントの行**（`tenant_id = app_tenant_id()`）だけである。第 1 境界は変わらず、他社の存在・件数を示唆する
--    列は無い（行はテナント × 計測の上限値と適用日だけ）。`CLAUDE.md` §3.1 の 🔴（パートナー同士の相互参照）には触れない。
-- 🔴 型の側でも同じ線を引く: `resolveTenantQuotas`（6 計測）は `HostTenantCtx` のまま、パートナー文脈から呼べるのは
--    `resolveTenantStorageQuota`（`STORAGE_BYTES` 1 計測。`packages/db/src/quota-overrides.ts`）だけ。「読めたように見えて
--    既定値が返る」（パートナー文脈で 6 計測を解くと AI / メールが常に既定値になる）をコンパイル時に防ぐ（T-11-02 の規律）。
--
-- ============================================================================
-- 🔴 判断事項 3: `reason` / `set_by_platform_user_id` を業務ロール（`app_tenant`）から読めなくする（列 GRANT）
-- ============================================================================
-- `reason` は運営者の自由記述（顧客との交渉内容が書かれうる。docs/05 §5.5 で `app_platform` からも REVOKE 済み）、
-- `set_by_platform_user_id` は運営者の識別子である。どちらもテナント利用者（ホスト / パートナーを問わず）に見せる
-- 理由が無く、パートナー文脈に `STORAGE_BYTES` の行を開く以上、列で閉じる（`CLAUDE.md` §3.1 第二境界 / §10.5「運営者の記述は内容ではなく
-- 件数・状態」の裏返し）。GRANT はロール単位（ホスト文脈とパートナー文脈で分けられない）ため、**ホスト文脈も同じく読めない**。
-- 読めるのは `id`（`resolveQuotaLimit` の同順位の決定と `QUOTA_LOWERED` 通知の `dedupeKey`）/ `tenant_id`（生 SQL の
-- 第 2 防御の述語）/ `metric` / `limit` / `previous_limit`（`listPendingQuotaLoweringNotices` の「引き下げか」の判定。
-- ジョブ文脈 = ホスト）/ `effective_from` / `created_at` の 7 列。
-- 🔴 `app_tenant` への列単位 GRANT は本表が最初の例である（これまでは表単位）。`has_table_privilege('app_tenant', …, 'SELECT')`
--    は false になるため、走査テスト（`tests/isolation/rls-enforced.test.ts` #3 / #4）は列単位の権限も母集団に含める形に改めた。
-- `app_platform`（列単位。`reason` は T-11-07 で REVOKE 済み）/ `app_platform_write`（INSERT のみ）は不変。

-- ----------------------------------------------------------------------------
-- ① `metric` の CHECK を 6 計測に再定義（`QUOTA_OVERRIDE_METRICS` = `AI_UNIT_METRICS` + `EMAIL_COUNT` + `STORAGE_BYTES`。
--    `tests/static/schema-enum-drift.test.ts` は同名 CHECK の再定義を「最後の定義を採る」で突合する）
-- ----------------------------------------------------------------------------
ALTER TABLE tenant_quota_overrides DROP CONSTRAINT IF EXISTS "tenant_quota_overrides_metric_check";
ALTER TABLE tenant_quota_overrides
  ADD CONSTRAINT "tenant_quota_overrides_metric_check" CHECK ("metric" IN ('AI_UNIT_SHEET_PARSE', 'AI_UNIT_MATCH_RATIONALE', 'AI_UNIT_PROPOSAL_DRAFT', 'AI_UNIT_RENEWAL_SUMMARY', 'EMAIL_COUNT', 'STORAGE_BYTES'));

COMMENT ON TABLE tenant_quota_overrides IS
  'テナント個別のクォータ上書き（T-11-02 / T-12-12。docs/02 F-057 / docs/05 §5.8.1 / §6.9 API-A6）。INSERT のみ。効く行は適用日 ≤ 今日 の最新行。6 計測（AI 4 単位 + EMAIL_COUNT + STORAGE_BYTES）。執行点は resolveTenantQuotas（ホスト文脈）/ resolveTenantStorageQuota（STORAGE_BYTES のみ。パートナー文脈可）経由で読む';

-- ----------------------------------------------------------------------------
-- ② SELECT ポリシー: C2 HOST_ONLY + `STORAGE_BYTES` 例外（判断事項 2。`usage_limit_states_select` と同じ書き方 = 1 本のポリシーに
--    `app_is_host() OR <列の値>` を置く）。書込ポリシーは変えない（`app_tenant` に INSERT / UPDATE / DELETE は無い）
-- ----------------------------------------------------------------------------
DROP POLICY IF EXISTS tenant_quota_overrides_c2_select ON tenant_quota_overrides;
DROP POLICY IF EXISTS tenant_quota_overrides_select ON tenant_quota_overrides;
CREATE POLICY tenant_quota_overrides_select ON tenant_quota_overrides FOR SELECT TO app_tenant
  USING (tenant_id = app_tenant_id() AND (app_is_host() OR metric = 'STORAGE_BYTES'));

-- ----------------------------------------------------------------------------
-- ③ `app_tenant` の SELECT を列単位に（判断事項 3）。表単位の GRANT を外してから 7 列だけを GRANT する。
--    🔴 `reason` / `set_by_platform_user_id` は GRANT しない（SELECT すると permission denied）。
-- ----------------------------------------------------------------------------
REVOKE SELECT ON tenant_quota_overrides FROM app_tenant;
GRANT SELECT (id, tenant_id, metric, "limit", previous_limit, effective_from, created_at)
  ON tenant_quota_overrides TO app_tenant;
