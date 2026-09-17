-- ============================================================================
-- T-11-02 利用量・クォータ管理（docs/02 `F-057` 処理③〜⑤ / `AC-2`〜`AC-4` / docs/05 §5.2 / §5.8.1 / §6.9 API-A6 /
-- `CLAUDE.md` §10.5「書き込みが許されるのは契約・クォータ・機能フラグ・お知らせ」）
-- ============================================================================
-- 本 migration が置くのは 1 表である:
--   `tenant_quota_overrides` —— テナント個別のクォータ上書き（AI の月次件数 4 単位のみ。`AI_UNIT_METRICS`）。
--   運営者（`PLATFORM_OWNER`）が **INSERT だけ**で積み、「効いている上限」は行の選択で決まる
--   （適用日 ≤ 今日 のうち適用日が最も遅い行。同日なら最後に作られた行。`@ses/domain` の `resolveQuotaLimit`）。
--   🔴 メール日次通数（`EMAIL_COUNT`）とストレージ（`STORAGE_BYTES`）は対象外（`tenant_quota_overrides_metric_check`
--   の判断事項を参照）。執行点の配線が無いまま上書きを許すと「表示と実際の動作が食い違う」事故になるため、
--   配線タスク（SP-12）が完了するまでこの表に書けないようにする。
--
-- ============================================================================
-- 🔴 判断事項 1: UPDATE / DELETE を誰にも与えない（履歴を残し、選択で決める）
-- ============================================================================
-- クォータの変更は契約条件の変更であり、「いつ・誰が・何から何へ・いつから」が後から遡れなければならない
-- （`F-057 AC-4`）。行を書き換える経路を作ると監査ログと表の内容が食い違いうる。行は積むだけにし、
-- 取り消したいときは元の値で新しい行を積む（それ自体が 1 つの変更として記録される）。
--
-- ============================================================================
-- 🔴 判断事項 2: 引き下げの規律を DB のポリシーでも担保する（`F-057 AC-3`）
-- ============================================================================
-- 「引き下げには適用日の指定と対象テナントへの通知が必須であり、即時反映のみの操作が存在しない」。
-- アプリ側は `decideQuotaChange`（`@ses/domain`）が判定するが、`app_platform_write` の INSERT ポリシーでも
--   ① 適用日は今日（Asia/Tokyo）以降
--   ② 引き下げ（`limit < previous_limit`）は**明日以降**
-- を `WITH CHECK` で固定する。型を `as any` で破っても、当日適用の引き下げ行は DB に入らない。
-- 通知は `previous_limit` との比較で導かれる（`limit < previous_limit` の行 = 通知が要る行）。
-- 通知の実行はワーカー（`usage.limit-check`）が `email.dispatch` の単一経路で行い、冪等性は
-- `email_dispatches.dedupe_key`（テンプレート × 上書き行 ID × 宛先）の UNIQUE が担う —— この表に「通知済み」列を
-- 持たせて UPDATE する必要が無い（`app_tenant` は SELECT のみで足りる）。
--
-- ============================================================================
-- 🔴 判断事項 3: `app_platform_write` の INSERT 先が 3 表 → 4 表になる（docs/05 §5.2 の列挙）
-- ============================================================================
-- `CLAUDE.md` §10.5 は「契約・クォータ・機能フラグ・お知らせ」への書き込みを**最初から**運営者に認めている。
-- 本表は「クォータ」そのものであり、§10.5 の列挙の**内側**である（人間の承認事項ではない）。docs/05 §5.2 の
-- 「この 3 表以外へ INSERT を広げる変更は §10.5 の改訂を要する」は provisioning の 3 表についての文であり、
-- 本 migration で同節に「クォータの表は §10.5 の列挙内」と明記した。越境 5 経路の対象表（エンジニア・案件・
-- 提案・チャット・契約）には 1 行も触れない。
--
-- ============================================================================
-- 🔴 判断事項 4: RLS —— ホスト（ジョブ文脈を含む）は自テナントの行を読める。パートナーは読めない
-- ============================================================================
-- 効いている上限はテナントの契約情報であり、パートナー所属ロールには見せない（`F-027 AC-1` / `BR-04`）。
-- 読む側は `usage.limit-check`（`systemTenantCtx` = ホスト）と `GET /api/usage`（ホストロールのみ）だけである。
-- `app_tenant` に INSERT / UPDATE / DELETE は与えない（テナント側から自分の上限を書けない）。

CREATE TABLE IF NOT EXISTS tenant_quota_overrides (
  id                       uuid PRIMARY KEY,
  tenant_id                uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  metric                   text NOT NULL,
  -- 上限（件数 / 通数 / バイト数）。🔴 1 以上（0 は判定関数が成立しない値であり、停止の手段としても使わない）。
  "limit"                  bigint NOT NULL,
  -- この行を積んだ時点で、適用日に効いていたはずの上限（既定値または前の上書き）。引き下げの判定と監査の `from`。
  previous_limit           bigint NOT NULL,
  -- 適用日（Asia/Tokyo の暦日）。この日の 0 時からこの上限になる。
  effective_from           date NOT NULL,
  -- 操作した運営者（`platform_users.id`。他の *_by_platform_user_id 列と同じく FK は張らない）。
  set_by_platform_user_id  uuid NOT NULL,
  -- 変更理由（運営者の自由記述。監査ログには載せず、長さだけを載せる）。
  reason                   text NOT NULL,
  created_at               timestamptz(3) NOT NULL DEFAULT now(),
  -- 🔴 `QUOTA_OVERRIDE_METRICS`（`packages/domain/src/quota/override.ts`）と同じ値集合 = `AI_UNIT_METRICS`（AI の
  --    月次件数 4 単位）。`EMAIL_COUNT` / `STORAGE_BYTES` は含まない —— 執行点（`apps/worker/src/jobs/email-send.ts` の
  --    `decideEmailRate` / `reserveEmailDailyQuota`、`send-hold-release.ts`、`apps/web/lib/skill-sheets/service.ts` の
  --    `decideStorageUpload`）が既定値しか読まないため、この 2 metric の行を許すと「上限を上げたのに執行が変わらない」
  --    事故になる（配線タスクは SP-12 に申し送り）。`AI_COST_USD`（金額。運営者の内部指標）も対象外。
  CONSTRAINT "tenant_quota_overrides_metric_check" CHECK ("metric" IN ('AI_UNIT_SHEET_PARSE', 'AI_UNIT_MATCH_RATIONALE', 'AI_UNIT_PROPOSAL_DRAFT', 'AI_UNIT_RENEWAL_SUMMARY')),
  CONSTRAINT "tenant_quota_overrides_limit_check" CHECK ("limit" >= 1),
  CONSTRAINT "tenant_quota_overrides_previous_limit_check" CHECK ("previous_limit" >= 1),
  CONSTRAINT "tenant_quota_overrides_reason_check" CHECK (char_length("reason") BETWEEN 1 AND 500)
);

COMMENT ON TABLE tenant_quota_overrides IS
  'テナント個別のクォータ上書き（T-11-02。docs/02 F-057 / docs/05 §6.9 API-A6）。INSERT のみ。効く行は適用日 ≤ 今日 の最新行';
COMMENT ON COLUMN tenant_quota_overrides.effective_from IS
  '適用日（Asia/Tokyo）。引き下げ（limit < previous_limit）は翌日以降しか積めない（F-057 AC-3）';
COMMENT ON COLUMN tenant_quota_overrides.previous_limit IS
  '積んだ時点で適用日に効いていたはずの上限。limit < previous_limit の行が「引き下げ = テナント管理者へ通知が要る行」';

-- 効いている行の選択（tenant × metric で適用日の降順）。
CREATE INDEX IF NOT EXISTS tenant_quota_overrides_effective_idx
  ON tenant_quota_overrides (tenant_id, metric, effective_from DESC, created_at DESC);

-- ----------------------------------------------------------------------------
-- RLS と GRANT。🔴 片方だけを足さない（docs/05 §4.2）
-- ----------------------------------------------------------------------------
ALTER TABLE tenant_quota_overrides ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_quota_overrides FORCE ROW LEVEL SECURITY;

-- 🔴 SELECT: ホスト文脈（ジョブ = systemTenantCtx を含む）だけ。パートナーは 0 行（C2 HOST_ONLY）。
DROP POLICY IF EXISTS tenant_quota_overrides_c2_select ON tenant_quota_overrides;
CREATE POLICY tenant_quota_overrides_c2_select ON tenant_quota_overrides FOR SELECT TO app_tenant
  USING (tenant_id = app_tenant_id() AND app_is_host());

-- 🔴 app_tenant は SELECT のみ（テナント側から自分の上限を書けない。書き手は app_platform_write だけ）。
GRANT SELECT ON tenant_quota_overrides TO app_tenant;

-- ----------------------------------------------------------------------------
-- 管理平面（app_platform。docs/05 §5.5）—— `A-004` の材料。全列が計測・数値・日付・ID・運営者の記述で、テナントの
-- 業務内容も PII も無い（`reason` は運営者自身の記述）。
-- ----------------------------------------------------------------------------
GRANT SELECT (
  id, tenant_id, metric, "limit", previous_limit, effective_from, set_by_platform_user_id, reason, created_at
) ON tenant_quota_overrides TO app_platform;

-- 🔴 platform_read ポリシー（migration 20260904010000 §1 の `tenant_keyed` ループと同じ式・同じ命名）。
DROP POLICY IF EXISTS tenant_quota_overrides_platform_read ON tenant_quota_overrides;
CREATE POLICY tenant_quota_overrides_platform_read ON tenant_quota_overrides FOR SELECT TO app_platform
  USING (
    current_setting('app.platform_user_id', true) <> ''
    AND (
      current_setting('app.target_tenant_id', true) = ''
      OR tenant_id::text = current_setting('app.target_tenant_id', true)
    )
  );

-- ----------------------------------------------------------------------------
-- 🔴 app_platform_write: INSERT のみ（`QUOTA` ドメイン。docs/05 §5.2 の 4 表目）。
--    SELECT を与えない（`createMany()`〔RETURNING 無し〕で書く。読み返すのは app_platform 側の一覧）。
--    UPDATE / DELETE を与えない（判断事項 1）。
-- ----------------------------------------------------------------------------
DROP POLICY IF EXISTS tenant_quota_overrides_platform_write_insert ON tenant_quota_overrides;
CREATE POLICY tenant_quota_overrides_platform_write_insert ON tenant_quota_overrides
  FOR INSERT TO app_platform_write
  WITH CHECK (
    current_setting('app.platform_user_id', true) <> ''
    -- 対象テナントは `withPlatformWrite` が SET LOCAL した値と一致（横断の INSERT は無い）。
    AND tenant_id::text = current_setting('app.target_tenant_id', true)
    -- 操作者は自分（他の運営者の名義で積めない）。
    AND set_by_platform_user_id::text = current_setting('app.platform_user_id', true)
    -- ① 適用日は今日（Asia/Tokyo）以降（遡って上限を変えない）。
    AND effective_from >= (now() AT TIME ZONE 'Asia/Tokyo')::date
    -- ② 🔴 引き下げは明日以降（即時反映のみの操作が存在しない。F-057 AC-3）。
    AND ("limit" >= previous_limit OR effective_from > (now() AT TIME ZONE 'Asia/Tokyo')::date)
  );

GRANT INSERT ON tenant_quota_overrides TO app_platform_write;
