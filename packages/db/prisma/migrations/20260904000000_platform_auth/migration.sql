-- packages/db/prisma/migrations/20260904000000_platform_auth/migration.sql
-- T-03-07（docs/sprints/SP-03-auth-audit-admin0.md）: 運営者認証（`F-055` / API-A1 / `A-001`）が
-- 触れる 3 表の RLS ポリシーと GRANT。
--
-- ============================================================================
-- 🔴 なぜ `app_platform_write` を使うのか（docs/05 §4.2 / §5.2 への追記が要る点）
-- ============================================================================
-- 運営者の認証経路は、主平面の「行由来コンテキスト」（docs/05 §4.4.2）の管理平面版である。
-- 必要な操作は次の 4 つで、**読みだけでは成立しない**:
--   ① `platform_users` をメールアドレスで 1 行だけ引く（照合）
--   ② `two_factor_credentials`（`subject_type='PLATFORM_USER'` / `tenant_id IS NULL`）の
--      登録・確定・リカバリコード消費（`F-055 AC-3` は全 `PlatformUser` に 2FA を必須とする）
--   ③ `audit_logs` にログイン・ログアウト・2FA の記録を書く（`F-055 AC-4` / `BR-41`）
--   ④ `platform_users.last_login_at` の更新
-- したがって **`app_platform`（SELECT のみ。docs/05 §4.2）では実装できない**。
-- 主平面の `app_tenant` を使う案は採らない —— 主平面の DB ロールに運営者のパスワードハッシュへの
-- 到達経路を与えることになり、`CLAUDE.md` §10.5 の「権限昇格の事故経路を作らない」に反する。
-- 残る選択肢は `app_platform_write`（管理平面の書き込みロール。接続文字列は docs/05 §4.2 が
-- `PLATFORM_WRITE_DATABASE_URL` と定めている）であり、これを使う。
--
-- 🔴 「業務テーブルへの書き込み権限を一切持たない」（docs/05 §5.2）は崩していない:
--   - `two_factor_credentials` への権限は、下記ポリシーにより
--     **`tenant_id IS NULL AND subject_type = 'PLATFORM_USER'` の行にしか適用されない**。
--     テナント利用者（`subject_type='USER'`）の行は 1 行も読めず・書けない。
--   - すべてのポリシーが `app.platform_auth_subject_id`（または `app.platform_auth_email`）の
--     GUC を要求する。この GUC を設定するのは `packages/db/src/platform-auth.ts` だけであり、
--     `withPlatformWrite`（T-03-08）は設定しない ＝ 管理平面の業務操作からは 0 件になる。
--   - 逆に本経路は `app.platform_user_id` を**空で上書きする**ため、
--     `tenants_platform_write_*` / `invitations` 等の provisioning ポリシー（T-03-08）は
--     認証トランザクションの中で 1 つも真にならない。
--
-- 🔴 `platform_users` は「射程外の 4 表」（`CLAUDE.md` §3.1 / docs/05 §4.7）であり
--    テナント分離の対象ではないが、**運営者どうしの資格情報の読み出しを塞ぐため**に
--    本マイグレーションで RLS を有効化する（射程外 ＝ 「`tenant_id` を持たない」の意味であって、
--    「RLS を付けてはならない」ではない。走査テストは射程外 4 表を除外しているだけである）。

-- ============================================================================
-- 1. platform_users（RLS を有効化し、認証経路の GUC でのみ 1 行を可視にする）
-- ============================================================================
ALTER TABLE "platform_users" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "platform_users" FORCE ROW LEVEL SECURITY;

-- 第 1 段: メールアドレスの完全一致（`withPlatformAuthLookup`）。
-- 🔴 主平面の `users_auth_lookup_select`（migration 20260903050000 §12）と**同形**にする:
--    両辺を `lower()` で畳み、GUC は `NULLIF(..., '')` で空を NULL にする。
--    ①片側だけ小文字化すると「呼び出し側が正規化しているか」に正しさが依存し、
--      別の呼び出し元が大文字混じりで渡した瞬間に正規の運営者が常に拒否される。
--    ②`NULLIF` により GUC が空なら述語は NULL ＝ 1 行も返らない（fail-closed）。
--    2 平面で非対称を残さない（片方だけ緩む / 片方だけ壊れるのを避ける）。
DROP POLICY IF EXISTS platform_users_auth_email_select ON "platform_users";
CREATE POLICY platform_users_auth_email_select ON "platform_users" FOR SELECT TO app_platform_write
  USING (
    lower(email) = lower(NULLIF(current_setting('app.platform_auth_email', true), ''))
  );

-- 第 2 段: 読み出した行（またはセッション Cookie）由来の主体 ID で本人 1 行だけを可視にする。
DROP POLICY IF EXISTS platform_users_auth_self_select ON "platform_users";
CREATE POLICY platform_users_auth_self_select ON "platform_users" FOR SELECT TO app_platform_write
  USING (
    current_setting('app.platform_auth_subject_id', true) <> ''
    AND id::text = current_setting('app.platform_auth_subject_id', true)
  );

-- 🔴 更新できるのは `last_login_at` だけである（列レベル GRANT で担保。下記）。
DROP POLICY IF EXISTS platform_users_auth_self_update ON "platform_users";
CREATE POLICY platform_users_auth_self_update ON "platform_users" FOR UPDATE TO app_platform_write
  USING (
    current_setting('app.platform_auth_subject_id', true) <> ''
    AND id::text = current_setting('app.platform_auth_subject_id', true)
  )
  WITH CHECK (
    current_setting('app.platform_auth_subject_id', true) <> ''
    AND id::text = current_setting('app.platform_auth_subject_id', true)
  );

-- 🔴 列レベル GRANT。`platform_users` に運営者コンソールが触れる経路は無い（T-03-08 の
--    `app_platform` には GRANT しない）。認証に要る列だけを `app_platform_write` に与える。
GRANT SELECT (id, email, display_name, role, password_hash, disabled_at, last_login_at)
  ON "platform_users" TO app_platform_write;
GRANT UPDATE (last_login_at) ON "platform_users" TO app_platform_write;

-- ============================================================================
-- 2. two_factor_credentials（🔴 PLATFORM_USER 行だけ。tenant_id IS NULL）
-- ============================================================================
-- 🔴 主平面（`app_tenant`）の C7 SELF ポリシーは `subject_type = 'USER'` を AND しており、
--    PLATFORM_USER 行は 1 行も見えない（migration 20260903050000 §10）。ここはその鏡写しで、
--    `app_platform_write` からは PLATFORM_USER 行しか見えない。**両者の射程は交わらない。**
DROP POLICY IF EXISTS two_factor_credentials_platform_auth_select ON "two_factor_credentials";
CREATE POLICY two_factor_credentials_platform_auth_select ON "two_factor_credentials"
  FOR SELECT TO app_platform_write
  USING (
    tenant_id IS NULL
    AND subject_type = 'PLATFORM_USER'
    AND current_setting('app.platform_auth_subject_id', true) <> ''
    AND subject_id::text = current_setting('app.platform_auth_subject_id', true)
  );

DROP POLICY IF EXISTS two_factor_credentials_platform_auth_insert ON "two_factor_credentials";
CREATE POLICY two_factor_credentials_platform_auth_insert ON "two_factor_credentials"
  FOR INSERT TO app_platform_write
  WITH CHECK (
    tenant_id IS NULL
    AND subject_type = 'PLATFORM_USER'
    AND current_setting('app.platform_auth_subject_id', true) <> ''
    AND subject_id::text = current_setting('app.platform_auth_subject_id', true)
  );

-- 🔴 UPDATE の用途は 3 つだけ: ①未確認の登録のやり直し（secret / recovery を差し替える）
--    ②登録の確定（`confirmed_at` の CAS）③リカバリコードの消費。
--    いずれも「本人の PLATFORM_USER 行」に閉じる。DELETE は GRANT しない
--    （やり直しは UPDATE で表現する。削除経路を持たない）。
DROP POLICY IF EXISTS two_factor_credentials_platform_auth_update ON "two_factor_credentials";
CREATE POLICY two_factor_credentials_platform_auth_update ON "two_factor_credentials"
  FOR UPDATE TO app_platform_write
  USING (
    tenant_id IS NULL
    AND subject_type = 'PLATFORM_USER'
    AND current_setting('app.platform_auth_subject_id', true) <> ''
    AND subject_id::text = current_setting('app.platform_auth_subject_id', true)
  )
  WITH CHECK (
    tenant_id IS NULL
    AND subject_type = 'PLATFORM_USER'
    AND current_setting('app.platform_auth_subject_id', true) <> ''
    AND subject_id::text = current_setting('app.platform_auth_subject_id', true)
  );

GRANT SELECT (id, subject_type, subject_id, tenant_id, secret_encrypted, recovery_code_hashes, confirmed_at)
  ON "two_factor_credentials" TO app_platform_write;
GRANT INSERT ON "two_factor_credentials" TO app_platform_write;
GRANT UPDATE (secret_encrypted, recovery_code_hashes, confirmed_at)
  ON "two_factor_credentials" TO app_platform_write;

-- ============================================================================
-- 3. audit_logs（🔴 運営者の記録。tenant_id IS NULL / actor_kind = 'PLATFORM_USER'）
-- ============================================================================
-- 🔴 `F-005 AC-3`（編集・削除できない）は 20260903040000 の
--    `REVOKE UPDATE, DELETE ON audit_logs FROM app_tenant, app_platform, app_platform_write` が担保する。
--    ここでは SELECT / INSERT だけを与える。
DROP POLICY IF EXISTS audit_logs_platform_auth_insert ON "audit_logs";
CREATE POLICY audit_logs_platform_auth_insert ON "audit_logs" FOR INSERT TO app_platform_write
  WITH CHECK (
    tenant_id IS NULL
    AND actor_kind = 'PLATFORM_USER'
    AND current_setting('app.platform_auth_subject_id', true) <> ''
    AND actor_id::text = current_setting('app.platform_auth_subject_id', true)
  );

-- 🔴 SELECT は「本人の 2FA 失敗の時刻を数える」（試行スロットル）ためだけに要る。
--    他人・他テナントの行は式の上で 1 行も到達できない。
DROP POLICY IF EXISTS audit_logs_platform_auth_select ON "audit_logs";
CREATE POLICY audit_logs_platform_auth_select ON "audit_logs" FOR SELECT TO app_platform_write
  USING (
    tenant_id IS NULL
    AND actor_kind = 'PLATFORM_USER'
    AND current_setting('app.platform_auth_subject_id', true) <> ''
    AND actor_id::text = current_setting('app.platform_auth_subject_id', true)
  );

GRANT SELECT, INSERT ON "audit_logs" TO app_platform_write;
