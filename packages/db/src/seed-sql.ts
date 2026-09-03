// packages/db/src/seed-sql.ts
// 🔴 シード（packages/db/seed）が使う生 SQL の唯一の置き場所。
//    docs/05 §2.2「`$queryRaw` / `$executeRaw` の直接呼び出しの例外は `packages/db/src/**` のみ」に
//    従い、生 SQL をここへ閉じ込める（seed 側は Prisma のデリゲートとこの関数だけを使う）。
//
// 🔴 汎用のエスケープハッチにしない（`packages/db/src/testing/isolation.ts` と同じ規律）。
//    「任意の SQL を実行する」関数をここに足さないこと。
//
// 🔴 ここで扱う接続は **合成データの投入・リセット専用の特権接続**である
//    （`app_tenant` は `tenants` に INSERT できず、テーブル所有者 `app_migrator` も
//    FORCE ROW LEVEL SECURITY により適用ポリシーが 0 件で読み書きできない。§4.2 / §4.4）。
//    実行できる環境は `packages/config` の `assertSeedableAppEnv` が縛る（F-053 AC-6）。
import { Prisma, PrismaClient } from '@prisma/client';

const SAFE_IDENTIFIER = /^[a-z_][a-z0-9_]*$/;

function assertSafeIdentifier(name: string): string {
  if (!SAFE_IDENTIFIER.test(name)) {
    throw new Error(`テーブル名として受け付けられません: ${name}`);
  }
  return name;
}

/**
 * `tenant_id` 列を持つ `public` の実テーブル（パーティションの子を除く）。
 * 🔴 テーブル名を列挙しない（docs/05 §4.7 と同じ方針）。新しい業務テーブルは、
 *    宣言を足さなくてもリセットと行数集計の対象に入る（消し残し = 前の商談のデータが
 *    残る事故〔F-053 AC-2〕を、実装者の記憶に頼らない）。
 */
export async function readTenantScopedTables(db: PrismaClient): Promise<string[]> {
  const rows = await db.$queryRaw<Array<{ relname: string }>>(Prisma.sql`
    SELECT c.relname
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    JOIN pg_attribute a ON a.attrelid = c.oid
    WHERE n.nspname = 'public'
      AND c.relkind IN ('r', 'p')
      AND NOT c.relispartition
      AND a.attname = 'tenant_id'
      AND a.attnum > 0
      AND NOT a.attisdropped
    ORDER BY c.relname`);
  return rows.map((row) => row.relname);
}

/**
 * 指定テナントの業務データを削除する（`reset()`。docs/05 §13.6 / F-053 AC-2）。
 *
 * 🔴 `session_replication_role = replica` を**このトランザクションの中だけ**で有効にし、
 *    FK とトリガを外してから削除する。理由は 2 つ:
 *      ①削除順序の宣言（親子の並び）を人手で維持しないため。順序の宣言はテーブルが増えるたびに
 *        腐り、腐ったときの症状が「一部が消え残る」という気づきにくい形になる
 *      ②`ON DELETE RESTRICT` の FK（`chat_threads.project_id` など）が、同じ文で消える行に対しても
 *        発火して削除を止めてしまうため
 * 🔴 対象は「引数のテナント ID を持つ行」だけである。テーブル全体を TRUNCATE しない。
 */
export async function deleteTenantData(
  db: PrismaClient,
  tenantIds: readonly string[],
): Promise<void> {
  if (tenantIds.length === 0) return;
  const tables = (await readTenantScopedTables(db)).map(assertSafeIdentifier);
  const ids = [...tenantIds];
  await db.$transaction(async (tx) => {
    await tx.$executeRaw`SET LOCAL session_replication_role = replica`;
    for (const table of tables) {
      await tx.$executeRaw(
        Prisma.sql`DELETE FROM ${Prisma.raw(`"${table}"`)} WHERE tenant_id::text = ANY(${ids})`,
      );
    }
    // 🔴 `announcements` はテナントキーを配列で持つ（docs/05 §3.1 の 2 例外の 1 つ）。
    //    上のループ（`tenant_id` 列の走査）では拾えないため、ここで明示的に扱う。
    //    対象テナント宛のお知らせだけを消し、全テナント宛（空配列）は残す。
    await tx.$executeRaw(Prisma.sql`
      DELETE FROM announcements
       WHERE target_tenant_ids && (
               SELECT COALESCE(array_agg(x::uuid), ARRAY[]::uuid[])
               FROM unnest(${ids}::text[]) AS x
             )`);
    await tx.$executeRaw(
      Prisma.sql`DELETE FROM tenants WHERE id::text = ANY(${ids})`,
    );
  });
}

/**
 * 投入結果の行数（テナント ID で絞る）。冪等な再生成（F-053 AC-2）の検証と実行ログに使う。
 * 🔴 こちらもテーブル名を列挙しない。
 */
export async function countTenantRows(
  db: PrismaClient,
  tenantIds: readonly string[],
): Promise<Record<string, number>> {
  const tables = (await readTenantScopedTables(db)).map(assertSafeIdentifier);
  const ids = [...tenantIds];
  const counts: Record<string, number> = {};
  for (const table of tables) {
    const rows = await db.$queryRaw<Array<{ count: bigint }>>(
      Prisma.sql`SELECT count(*)::bigint AS count FROM ${Prisma.raw(`"${table}"`)} WHERE tenant_id::text = ANY(${ids})`,
    );
    const count = Number(rows[0]?.count ?? 0n);
    if (count > 0) counts[table] = count;
  }
  const tenantRows = await db.$queryRaw<Array<{ count: bigint }>>(
    Prisma.sql`SELECT count(*)::bigint AS count FROM tenants WHERE id::text = ANY(${ids})`,
  );
  counts.tenants = Number(tenantRows[0]?.count ?? 0n);
  return counts;
}
