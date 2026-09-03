-- packages/db/prisma/sql/000_roles.sql
-- T-01-05（docs/sprints/SP-01-bootstrap.md）: docs/05 §4.2（DB ロールと接続）/ §5.2（分離バイパスの
-- 設計）の 5 ロールを作る唯一の定義（single source of truth）。
--
-- 🔴 ローカル docker-compose（docker/postgres/initdb/000-roles.sh）と Testcontainers
--    （tests/isolation/support/postgres.ts）の両方がこのファイルをそのまま実行する。
--    ロール名・属性を 2 箇所に書き分けない。
--
-- 🔴 CREATE ROLE は「PostgreSQL の初期スーパーユーザー（ローカルは POSTGRES_USER、
--    Testcontainers は postgres）」で実行する。app_migrator 自身は NOCREATEROLE のため、
--    自分自身を含む他ロールを作れない（app_migrator はテーブル所有者であり、
--    ロールの作成主体ではない。docs/05 §4.2）。
--
-- 🔴 パスワードはこのファイルに書かない（CLAUDE.md §3.5）。psql の -v 変数
--    （app_migrator_password / app_tenant_password / app_platform_password /
--    app_platform_write_password）で渡す。app_share_probe は NOLOGIN のためパスワード不要
--    （docs/05 §4.2「（接続しない）」。§4.5 の SECURITY DEFINER 関数の所有者としてのみ使う）。
--
-- 🔴 冪等（何度実行してもエラーにならない）。DO $$ ... $$ の本体では psql の :'var' 置換が
--    効かない（dollar-quote の中は素通しされる）ため、\gexec パターン
--    （トップレベル SELECT の結果を SQL として実行する。条件が偽なら 0 行 = 何もしない）を使う。

-- app_migrator: マイグレーション専用。アプリは使わない（docs/05 §4.2）。テーブル所有者。
SELECT format(
    'CREATE ROLE app_migrator LOGIN PASSWORD %L NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS',
    :'app_migrator_password'
  )
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_migrator')
\gexec

-- app_tenant: 主平面。🔴 BYPASSRLS を持たない（docs/05 §4.2 / CLAUDE.md §3.1）。
SELECT format(
    'CREATE ROLE app_tenant LOGIN PASSWORD %L NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS',
    :'app_tenant_password'
  )
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_tenant')
\gexec

-- app_platform: 管理平面の読み取り専用（docs/05 §5.2）。業務テーブルへの INSERT/UPDATE/DELETE を持たない。
SELECT format(
    'CREATE ROLE app_platform LOGIN PASSWORD %L NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS',
    :'app_platform_password'
  )
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_platform')
\gexec

-- app_platform_write: 契約・クォータ・機能フラグ・お知らせ + tenants/invitations/tenant_sending_domains
-- の INSERT のみ（docs/05 §5.2）。業務テーブルへの書き込み権限を一切持たない。
SELECT format(
    'CREATE ROLE app_platform_write LOGIN PASSWORD %L NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS',
    :'app_platform_write_password'
  )
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_platform_write')
\gexec

-- app_share_probe: NOLOGIN。engineer_shares の 3 列 SELECT のみ（SP-08 の経路 4。docs/05 §4.5）。
-- パスワード不要。GRANT は engineer_shares が生まれる SP-08 で追加する。
SELECT 'CREATE ROLE app_share_probe NOLOGIN NOBYPASSRLS'
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_share_probe')
\gexec

-- app_assignment_owner_probe: NOLOGIN。engineers.owner_partner_company_id の SELECT のみ
-- （T-02-08。docs/05 §4.4.1 の assignments ← engineers(engineer_id) 継承専用。§4.5 の
-- app_share_probe と同じパターン: engineers は C3 OWNER_SCOPED のため、ホスト文脈からは
-- パートナー所属エンジニアの行が見えない（CLAUDE.md §3.1 経路 2）。しかし assignments は
-- C2 HOST_ONLY（書込はホストのみ）であり、ホストがパートナー所属エンジニアを稼働させる
-- （＝counterparty_partner_company_id にパートナーの ID を継承させる）のは通常業務のため、
-- 専用ロール + SECURITY DEFINER 関数でテナント境界のみのポリシー（パートナー境界は課さない）
-- を与える。docs/05 §4.2 / §4.4.1 / P-A-19（T-02-08 で確定）。
-- パスワード不要。GRANT とポリシーは packages/db/prisma/migrations/20260903070000_*/migration.sql。
SELECT 'CREATE ROLE app_assignment_owner_probe NOLOGIN NOBYPASSRLS'
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_assignment_owner_probe')
\gexec

-- 🔴 `ALTER FUNCTION ... OWNER TO app_assignment_owner_probe`（migration 20260903070000）は
-- app_migrator が app_assignment_owner_probe に対して SET ROLE できることを要求する
-- （PostgreSQL の所有者変更の仕様。実行者は新旧いずれの所有者ロールにもなれる必要がある）。
-- app_migrator はこのロールにログインしない（NOLOGIN のまま）が、所有権の付け替えだけができるよう
-- メンバーシップを与える。
GRANT app_assignment_owner_probe TO app_migrator;

-- public スキーマの所有者を app_migrator にする（PostgreSQL 15 以降は既定で PUBLIC に
-- CREATE 権限が無いため、これが無いとマイグレーションがテーブルを作れない。docs/05 §4.2）。
ALTER SCHEMA public OWNER TO app_migrator;
GRANT USAGE ON SCHEMA public TO app_tenant, app_platform, app_platform_write;
