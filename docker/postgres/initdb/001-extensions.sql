-- docker/postgres/initdb/001-extensions.sql
-- T-01-02 (docs/03 §3.7.2 / TBD-8): ローカル開発 DB の拡張初期化。
-- 🔴 本ファイルはローカル専用。本番相当環境（ステージング/本番の RDS・Aurora）の拡張作成は
-- Prisma マイグレーション（ロール app_migrator / MIGRATION_DATABASE_URL。docs/05 §4.2）で行う
-- （RDS/Aurora には docker-entrypoint-initdb.d が存在せず、ローカルでも既存ボリュームがあると
-- 本ファイルは再実行されないため）。
--
-- pg_trgm は PostgreSQL 本体の contrib に含まれ、公式 postgres イメージに同梱されている
-- ため常に有効化できる。pg_bigm は Amazon RDS / Aurora PostgreSQL では利用できる
-- （docs/03 §3.7.2 決定済み・2026-09-02）が、公式 Docker Hub の postgres イメージには
-- 同梱されていない。本プロジェクトの制約（Docker Hub からのイメージ pull 以外の外部
-- ネットワークアクセスをしない）の下では、追加のパッケージ取得（PGDG apt リポジトリ等）
-- を行えないため、ローカル開発コンテナでは pg_bigm を同梱しない。
--
-- そのため pg_bigm は「拡張が利用可能な場合にのみ」有効化する形にし、無い場合は
-- 初期化を失敗させずに NOTICE を出して読み飛ばす。日本語全文検索の実装は
-- packages/db/src/search/*.ts の 1 箇所に閉じ、pg_trgm の GIN で代替できる形にする
-- （SP-01 完了判定 / SP-06 で実装）。

CREATE EXTENSION IF NOT EXISTS pg_trgm;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_available_extensions WHERE name = 'pg_bigm') THEN
    CREATE EXTENSION IF NOT EXISTS pg_bigm;
  ELSE
    RAISE NOTICE 'pg_bigm is not available in this local PostgreSQL image; skipping. '
      'It is confirmed available on Amazon RDS/Aurora PostgreSQL (docs/03 §3.7.2, decided 2026-09-02). '
      'Local dev falls back to pg_trgm per SP-01 T-01-02 default.';
  END IF;
END
$$;
