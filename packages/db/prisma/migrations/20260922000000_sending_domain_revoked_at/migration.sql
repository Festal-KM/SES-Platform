-- ============================================================================
-- T-11-06 送信ドメイン未検証テナントの検知（docs/02 `F-059 AC-5` / `BR-71` / docs/05 §8.3 / §16.5 項目 11）
-- ============================================================================
-- 本 migration が足すのは `tenant_sending_domains.revoked_at`（nullable）1 列と、その不変条件・GRANT である。
--
-- 🔴 判断事項 1: 「一度も検証されていない」と「失効した」を区別する列が無かった
-- ============================================================================
-- `domain.verify` の不成立と `domain.recheck` の失効は、どちらも `expireSendingDomain`
-- （`state='FAILED', verified_at=NULL`）に合流し、行の形が同じになる（docs/05 §8.3「検証」）。
-- `F-059 AC-5` は「未完了・**失効**のテナント」を運営者に示すことを求めており、失効は
-- 「送れていたものが送れなくなった」事故の前兆であって、DNS 反映待ちの `FAILED` とは対処が異なる。
-- `sending_domain.state_change` の監査行（docs/05 §11）は未実装であり、履歴から復元する経路も無い。
-- したがって**降格した時刻**を列として持つ。
--
-- 🔴 判断事項 2: 書き込みは `expireSendingDomain` / `markSendingDomainVerified` の 2 関数だけ
-- ============================================================================
-- `expireSendingDomain` は **`state='VERIFIED'` からの降格のときだけ** `revoked_at = checked_at` を置き、
-- それ以外（`PENDING` / `FAILED` からの不成立）は既存値を保つ。`markSendingDomainVerified` は NULL に戻す。
-- `applySendingDomainProvision`（再設定で `PENDING` に置く）は触らない —— 失効した事実は再検証まで残る。
-- 🔴 利用者の入力から書かれることは無い（`packages/db/src/tenant-sending-domain.ts` の冒頭コメント）。
--
-- 🔴 判断事項 3: 検証済みの行に失効時刻が残らない（CHECK）
-- ============================================================================
-- `revoked_at IS NOT NULL` ⇒ `verified_at IS NULL`。片方だけ動かす更新を DB が拒む
--（`tenant_sending_domains_verified_check` と同じ考え方）。
ALTER TABLE "tenant_sending_domains"
  ADD COLUMN "revoked_at" timestamptz(3);

ALTER TABLE "tenant_sending_domains"
  ADD CONSTRAINT "tenant_sending_domains_revoked_check"
  CHECK ("revoked_at" IS NULL OR "verified_at" IS NULL);

COMMENT ON COLUMN "tenant_sending_domains"."revoked_at" IS
  'domain.recheck が VERIFIED → FAILED に降格させた（失効した）時刻（T-11-06。docs/05 §8.3）。一度も検証されていない FAILED は NULL。再検証で NULL に戻る';

-- ----------------------------------------------------------------------------
-- 管理平面（app_platform。docs/05 §5.5 第 1 層）—— `A-005` 項目 11「失効」の材料。時刻であり非開示列ではない
-- ----------------------------------------------------------------------------
-- 🔴 `app_tenant` は表単位の GRANT（migration 20260903050000 §13）を持つため列の追加で自動的に読み書きできる。
--    `app_platform` は列を列挙して GRANT する（§5.5「テーブル単位の GRANT SELECT を使わない」）ため、ここで足す。
GRANT SELECT ("revoked_at") ON "tenant_sending_domains" TO app_platform;

-- ----------------------------------------------------------------------------
-- 🔴 `app_platform_write` の INSERT は登録の代行だけ（docs/05 §5.2 / `A-014` 5b）。失効時刻を持つ行を作れない
-- ----------------------------------------------------------------------------
-- migration 20260904010000 のポリシーに `revoked_at IS NULL` を 1 条件足して置き直す（他の条件は同一）。
DROP POLICY IF EXISTS tenant_sending_domains_platform_write_insert ON tenant_sending_domains;
CREATE POLICY tenant_sending_domains_platform_write_insert ON tenant_sending_domains
  FOR INSERT TO app_platform_write
  WITH CHECK (
    current_setting('app.platform_user_id', true) <> ''
    AND tenant_id::text = current_setting('app.target_tenant_id', true)
    AND state = 'REGISTERED'
    AND verified_at IS NULL
    AND revoked_at IS NULL
    AND registered_by_platform_user_id::text = current_setting('app.platform_user_id', true)
  );
