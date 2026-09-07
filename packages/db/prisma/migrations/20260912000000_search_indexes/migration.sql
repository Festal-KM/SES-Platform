-- packages/db/prisma/migrations/20260912000000_search_indexes/migration.sql
-- SP-06 T-06-05: 検索基盤のインデックス設計（docs/05 TBD-8 / docs/03 §3.7.2 / `F-009` / `F-015`）。
--
-- ============================================================================
-- 何をするか
-- ============================================================================
--   1. `pg_trgm` の作成。🔴 **これが本番相当環境での唯一の作成経路**である（docs/03 §3.7.2）。
--      RDS / Aurora には `docker-entrypoint-initdb.d` が無く、ローカルでも既存ボリュームがあると
--      `docker/postgres/initdb/001-extensions.sql` は再実行されないため、
--      **マイグレーションに置かないとステージング / 本番に拡張が入らない**（この移行までは
--      実際に入っていなかった）。
--   2. 決定的順序（`ENGINEER_LIST_ORDER_BY` / `PROJECT_LIST_ORDER_BY`）を**向きまで**覆う
--      複合 B-tree 索引への張り替え。🔴 `tenant_id` を先頭列に置く（§3.1 共通規約 /
--      docs/03 §3.7.2 懸念 1。RLS の `tenant_id = app_tenant_id()`〔STABLE〕が等値で枝刈りできる）。
--
-- ============================================================================
-- 🔴 フリーワード用の trigram GIN 索引は**作らない**（2026-09-07 の実測に基づく判断）
-- ============================================================================
-- `docs/03` §3.7.2 は「`pg_trgm` の GIN で日本語のフリーワードを加速する」としていたが、
-- **本プロジェクトの RLS 構成ではその索引を使えない**ことが PostgreSQL 17 の実測で判明した。
--
--   ①`LIKE` / `ILIKE` の実装関数（`pg_catalog.textlike` / `texticlike`）は
--     **`proleakproof = false`** である（本 DB で確認）。
--   ②PostgreSQL は、RLS が有効な表に対して **leakproof でない条件をセキュリティ条件より
--     下に降ろさない**。索引条件はセキュリティ条件より下で評価されるため、
--     **`ILIKE` は索引条件になれず、必ず Filter として後段に残る**。
--   ③実測（`tests/isolation/search-indexes.test.ts` ④）: `engineers` に単一列の
--     `gin_trgm_ops` 索引を作っても、`app_tenant`（RLS 適用）からの `ILIKE` は
--     `Filter: display_name ~~* '%…%'` のままで索引が使われない。**RLS を素通りする
--     superuser では同じ索引が使われる**（＝ 索引の不備ではなく RLS との組み合わせの問題）。
--   ④加えて、`tenant_id` を先頭列に置くために `btree_gin` と組んだ多列 GIN は、
--     単一列 GIN に比べてプランナ見積りが約 78 倍高い（1678.95 対 21.49）。
--     「`tenant_id` を先頭に置く」規約と trigram は元々相性が悪い。
--
-- 🔴 **使われない索引を作らない。** 作れば更新のたびに書き込みコストだけが増え、しかも
--    「フリーワードは索引で加速されている」という**事実と違う前提**が残る
--    （`CLAUDE.md` §11.1 が嫌う「成功したように見えて実際には起きていない」の同型）。
--
-- **代わりに何が担保になるか**: RLS の `tenant_id` 等値がそのまま索引条件になるため、
-- フリーワードの走査は**常にそのテナントの行数に閉じる**。`docs/03` §3.7.2 が想定する
-- 最大テナント（エンジニア 3,000 件 / 案件 3,000 件）で、実測は数十 ms であり
-- `F-009 AC-4` / `F-015 AC-2`（p95 1 秒）に十分な余裕がある（p95 の判定は SP-12 の T-12-02）。
-- 精度・速度が足りなくなったときの手順は `docs/03` §3.7.3 の段階 1〜4 に従う。
-- 🔴 前提が変わったら気づけるように、①（`proleakproof`）と③（実行計画）は
--    `tests/isolation/search-indexes.test.ts` が**常設テストとして固定する**。
--
-- ============================================================================
-- 🔴 §3.3.1 の migration テンプレート（FORCE RLS の一時解除 + pre-check + restore + self-check）
--    との関係
-- ============================================================================
-- §3.3.1（Issue #38）のテンプレートは **`ADD CONSTRAINT ... FOREIGN KEY` の検証が FORCE RLS で
-- 盲目になる**という PostgreSQL の挙動への対処であり、その要件は「既存行を検査する DDL」に
-- 対してのみ生じる。本 migration が行うのは **`CREATE EXTENSION` と `CREATE INDEX` / `DROP INDEX`
-- だけ**であり、
--   ・`CREATE INDEX` の索引構築はヒープを直接走査する（RLS はクエリの書き換え機構であり、
--     索引構築には適用されない）ため、FORCE RLS で「見えない行が索引に入らない」ことは起きない
--   ・既存行に対する制約検査を伴わない（違反行という概念が無い）
-- したがって **FORCE の一時解除は行わない**（不要な解除は、戻し忘れの事故面を増やすだけである）。
-- 代わりに**手順 3 の自己検査**を置き、拡張と索引が期待どおり作られたことをこの migration 自身が
-- 確かめて落とす（§3.3.1 の「事後検査」と同じ向き）。

-- ---------------------------------------------------------------------------
-- 1. 拡張
-- ---------------------------------------------------------------------------
-- 🔴 `pg_trgm` は PostgreSQL の contrib に含まれ **trusted**（PG13 以降）である。したがって
--    「現在のデータベースに対する CREATE 権限」を持つ非スーパーユーザー（= app_migrator。
--    `prisma/sql/000_roles.sql` で GRANT 済み）が作成できる。
-- 🔴 索引としては使えない（上記）が、**関数としては使う**: 辞書に無い語の候補提示
--    （`similarity()`。`docs/03` §3.7.1 の「表記ゆれの吸収」/ `F-010` / `F-033`）は
--    索引を必要としない。ローカル（`docker/postgres/initdb/001-extensions.sql`）と
--    ステージング / 本番で拡張の有無を揃える意味もある。
-- 🔴 `btree_gin` は作らない（多列 GIN を作らないので使い道が無い）。
-- 🔴 `pg_bigm` も作らない（docs/03 §3.7.2 の決着。ローカルの公式イメージに同梱されておらず、
--    そもそも `LIKE` の索引利用が RLS で塞がれている以上、切り替えても解決しない）。
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- ---------------------------------------------------------------------------
-- 2. 決定的順序を覆う複合 B-tree 索引（旧索引からの張り替え）
-- ---------------------------------------------------------------------------
-- 🔴 `engineers`: 旧 `(tenant_id, updated_at)` は `ORDER BY updated_at DESC, id DESC` の
--    第 2 キー（`id`）を持たないため、同一 `updated_at` の塊で追加のソートが要る。
--    向きまで一致させた `(tenant_id, updated_at DESC, id DESC)` に置き換える
--    （旧索引は新索引の先頭 2 列に覆われるので残さない）。
DROP INDEX IF EXISTS "engineers_tenant_id_updated_at_idx";
CREATE INDEX "engineers_tenant_id_updated_at_id_idx"
  ON "engineers"("tenant_id", "updated_at" DESC, "id" DESC);

-- 🔴 `projects`: `PROJECT_LIST_ORDER_BY` は 4 段（`status DESC, updated_at DESC,
--    start_date ASC〔NULLS LAST〕, id DESC`）。**`ASC` の既定が NULLS LAST** なので、
--    `start_date` は向きの指定だけで `nulls: 'last'` と一致する（明示すると Prisma の
--    既定命名と DDL がずれるため書かない）。旧 `(tenant_id, status, updated_at)` は
--    `status` の向きが逆で、後続キーと同時に索引順を使えないため落とす。
DROP INDEX IF EXISTS "projects_tenant_id_status_updated_at_idx";
CREATE INDEX "projects_tenant_id_status_updated_at_start_date_id_idx"
  ON "projects"("tenant_id", "status" DESC, "updated_at" DESC, "start_date", "id" DESC);

-- ---------------------------------------------------------------------------
-- 3. 🔴 自己検査（このファイル自身が落とす。§3.3.1 の「事後検査」と同じ向き）
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_trgm') THEN
    RAISE EXCEPTION 'T-06-05: pg_trgm が作成されていません（app_migrator に当該 DB の CREATE 権限がありますか）';
  END IF;
END $$;

DO $$
DECLARE bad text;
BEGIN
  SELECT string_agg(spec.relname, ', ' ORDER BY spec.relname) INTO bad
    FROM (VALUES
            ('engineers_tenant_id_updated_at_id_idx'),
            ('projects_tenant_id_status_updated_at_start_date_id_idx')
         ) AS spec(relname)
   WHERE NOT EXISTS (
     SELECT 1
       FROM pg_class c
       JOIN pg_namespace n ON n.oid = c.relnamespace
       JOIN pg_am am ON am.oid = c.relam
      WHERE n.nspname = 'public' AND c.relkind = 'i'
        AND c.relname = spec.relname AND am.amname = 'btree'
   );
  IF bad IS NOT NULL THEN
    RAISE EXCEPTION 'T-06-05: 決定的順序を覆う索引がありません: %', bad;
  END IF;
END $$;

DO $$
DECLARE bad text;
BEGIN
  -- 🔴 `engineers` / `projects` の複合索引はすべて先頭列が `tenant_id` であること
  --    （主キーだけが例外 = 行の同一性の担保であり分離キーではない）。
  SELECT string_agg(c.relname, ', ' ORDER BY c.relname) INTO bad
    FROM pg_index i
    JOIN pg_class c ON c.oid = i.indexrelid
    JOIN pg_class t ON t.oid = i.indrelid
    JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = i.indkey[0]
   WHERE t.relname IN ('engineers', 'projects')
     AND NOT i.indisprimary
     AND a.attname <> 'tenant_id';
  IF bad IS NOT NULL THEN
    RAISE EXCEPTION 'T-06-05: 先頭列が tenant_id でない索引があります: %', bad;
  END IF;
END $$;
