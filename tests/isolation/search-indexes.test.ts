// tests/isolation/search-indexes.test.ts
// 🔴 SP-06 T-06-05 の完了判定のうち **「`EXPLAIN` でインデックスが使われることの結合テスト」**
//    （docs/05 TBD-8 / `docs/03` §3.7.2）。
//
// ============================================================================
// 🔴 ここで固定するのは 4 点である
// ============================================================================
//   ①`pg_trgm` が**マイグレーション経由で**実在すること（`docs/03` §3.7.2「拡張の作成経路は
//     Prisma マイグレーション」。ローカルの `docker/postgres/initdb/**` は Testcontainers では
//     走らないので、ここで確かめれば「本番相当環境で作られる経路」を確かめたことになる）
//   ②`engineers` / `projects` の**すべての複合索引の先頭列が `tenant_id`** であること
//     （`CLAUDE.md` §3.1 の共通規約 / `docs/03` §3.7.2 懸念 1）
//   ③決定的順序（`ENGINEER_LIST_ORDER_BY` / `PROJECT_LIST_ORDER_BY`）を索引が**そのまま**
//     供給できること（ソートが計画に現れない）
//   ④🔴 **trigram の GIN 索引を置かない判断の根拠**（`docs/03` §3.7.2 懸念 4 /
//     migration `20260912000000_search_indexes`）。**根拠そのものを常設テストで固定する**ので、
//     前提（`ILIKE` が leakproof でない / RLS が効いている）が変わったら**このテストが落ちて
//     判断をやり直せる**。索引を作らないという判断を、注釈だけで残さない。
//
// ============================================================================
// 🔴 `EXPLAIN` は `app_tenant` で実行する（特権接続ではない）
// ============================================================================
// RLS のポリシー式（C3 / C4）が計画に含まれた状態で索引が選ばれることを見たいためである。
// 🔴 ③では **`enable_seqscan = off` を掛ける。** seed の行数（数十行）では Seq Scan の方が安く、
//    「いま索引が選ばれるか」を固定すると SP-12（1 万件）の実測とは違う計画を強制してしまう。
//    ここで確かめたいのは **「この並びを索引で供給できるか」**である
//    （`tests/isolation/projects.test.ts` の T-06-03 のブロックと同じ判断）。
// 🔴 p95 1 秒（`F-009 AC-4` / `F-015 AC-2`）の**判定は SP-12 の T-12-02** であり、本タスクの
//    射程はインデックス設計と実行計画の確認までである（`docs/sprints/SP-06` §6-1）。
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { freeWordFilter, type TenantIdentity } from '@ses/db';
import { createUnextendedClient, runUnextended, type UnextendedClient } from '@ses/db/testing';
import { ISOLATION_SEED_IDS, runSeed } from '@ses/db/seed';
import { startIsolationDatabase, type IsolationDatabase } from './support/postgres.js';

const SETUP_TIMEOUT_MS = 600_000;
const NOW = new Date('2026-09-06T00:00:00.000Z');

const TENANT_1 = ISOLATION_SEED_IDS.tenants[0];

const HOST_1: TenantIdentity = {
  tenantId: TENANT_1.tenantId,
  partnerCompanyId: null,
  userId: TENANT_1.hostUserId,
};

/**
 * 🔴 フリーワードの検索語は **3 文字以上**にする。`pg_trgm` は 3-gram であり、2 文字以下では
 *    完全な trigram を取り出せない（`packages/db/src/search/free-word.ts` の「既知の限界」2）。
 */
const FREE_WORD = 'アルファ';

let database: IsolationDatabase;
/** 🔴 事実確認だけに使う特権接続。RLS ありの `EXPLAIN` には使わない。 */
let admin: UnextendedClient;

beforeAll(async () => {
  database = await startIsolationDatabase({ seed: 'none' });
  await runSeed({
    appEnv: 'development',
    databaseUrl: database.superuserUrl,
    preset: 'isolation',
    reset: true,
    now: NOW,
  });
  admin = createUnextendedClient(database.superuserUrl);
}, SETUP_TIMEOUT_MS);

afterAll(async () => {
  await admin?.$disconnect();
  await database?.stop();
});

/** `app_tenant` の文脈で `EXPLAIN` する（🔴 RLS が効いた状態の計画を見る）。 */
async function explain(
  identity: TenantIdentity,
  sql: string,
  options: { readonly forceIndex?: boolean } = {},
): Promise<string> {
  const client = createUnextendedClient(database.tenantUrl);
  try {
    return await runUnextended(
      client,
      {
        tenantId: identity.tenantId,
        partnerCompanyId: identity.partnerCompanyId,
        actorUserId: identity.userId,
      },
      async (tx) => {
        if (options.forceIndex === true) {
          await tx.$executeRawUnsafe('SET LOCAL enable_seqscan = off');
        }
        const rows = await tx.$queryRawUnsafe<{ 'QUERY PLAN': string }[]>(`EXPLAIN ${sql}`);
        return rows.map((row) => row['QUERY PLAN']).join('\n');
      },
    );
  } finally {
    await client.$disconnect();
  }
}

async function indexDefs(table: string): Promise<{ indexname: string; indexdef: string }[]> {
  return admin.$queryRawUnsafe<{ indexname: string; indexdef: string }[]>(
    `SELECT indexname, indexdef FROM pg_indexes WHERE schemaname = 'public' AND tablename = $1
      ORDER BY indexname`,
    table,
  );
}

describe('① 検索に必要な拡張がマイグレーションで作られている（docs/03 §3.7.2）', () => {
  it('🔴 `pg_trgm` が実在する（Testcontainers は initdb を通らない ＝ 本番相当の経路の検証）', async () => {
    const rows = await admin.$queryRaw<{ extname: string }[]>`
      SELECT extname FROM pg_extension ORDER BY extname`;

    expect(rows.map((row) => row.extname)).toContain('pg_trgm');
  });

  it('🔴 `app_migrator` が当該 DB の `CREATE` 権限を持つ（trusted 拡張を作成できる条件）', async () => {
    // 🔴 これが無いと `CREATE EXTENSION` が権限エラーになり、マイグレーションが**本番で**落ちる。
    //    付与は `packages/db/prisma/sql/000_roles.sql`（ステージング / 本番では RDS の
    //    マスターユーザーが同じ GRANT を 1 度実行する）。運用上の前提をテストで可視化しておく。
    const rows = await admin.$queryRaw<{ granted: boolean }[]>`
      SELECT has_database_privilege('app_migrator', current_database(), 'CREATE') AS granted`;

    expect(rows[0]?.granted).toBe(true);
  });

  it('🔴 使わない拡張を作らない（`pgroonga` は不採用 / `btree_gin` は GIN を作らないので不要）', async () => {
    const rows = await admin.$queryRaw<{ extname: string }[]>`
      SELECT extname FROM pg_extension ORDER BY extname`;
    const names = rows.map((row) => row.extname);

    // docs/03 §3.7.2 の決着（RDS で使えないため環境差を作らない）。
    expect(names).not.toContain('pgroonga');
    // ④ のとおり trigram の GIN を作らないので、`btree_gin`（uuid の GIN 演算子クラス）も要らない。
    expect(names).not.toContain('btree_gin');
  });
});

describe('② すべての複合索引の先頭列が `tenant_id`（CLAUDE.md §3.1 / docs/03 §3.7.2 懸念 1）', () => {
  it.each(['engineers', 'projects'])('🔴 `%s`', async (table) => {
    const rows = await indexDefs(table);

    // 🔴 主キー（`id`）だけが例外である（分離キーではなく行の同一性の担保）。
    for (const row of rows.filter((candidate) => candidate.indexname !== `${table}_pkey`)) {
      expect(row.indexdef, row.indexname).toMatch(/\(tenant_id[,)]/);
    }
    // 空振り防止: 索引が主キーしか無い状態で通っていないこと。
    expect(rows.length).toBeGreaterThan(1);
  });

  it('🔴 `engineers` の索引が実装の宣言（`ENGINEER_LIST_ORDER_BY`）と向きまで一致する', async () => {
    const defs = (await indexDefs('engineers')).map((row) => row.indexdef).join('\n');

    expect(defs).toContain('(tenant_id, updated_at DESC, id DESC)');
    // 🔴 画面が出さない PII を索引に入れない（＝ 検索対象にしない。docs/05 §6.4 #17）。
    expect(defs).not.toContain('contact_email');
    expect(defs).not.toContain('contact_phone');
    expect(defs).not.toContain('affiliation_label');
    expect(defs).not.toContain('birth_date');
  });

  it('🔴 `projects` の索引に商流情報の列が現れない（`F-013 AC-2`）', async () => {
    const defs = (await indexDefs('projects')).map((row) => row.indexdef).join('\n');

    expect(defs).toContain('(tenant_id, status DESC, updated_at DESC, start_date, id DESC)');
    expect(defs).not.toContain('end_client_name');
    expect(defs).not.toContain('internal_unit_price');
  });
});

describe('③ 決定的順序を索引がそのまま供給できる（`F-009 AC-1` / `F-015 AC-3`）', () => {
  it('🔴 `engineers`: `updated_at DESC, id DESC` にソートが要らない', async () => {
    const plan = await explain(
      HOST_1,
      `SELECT id, display_name, availability, updated_at
         FROM engineers
        ORDER BY updated_at DESC, id DESC
        LIMIT 51`,
      { forceIndex: true },
    );

    expect(plan).toContain('Index Scan using engineers_tenant_id_updated_at_id_idx');
    expect(plan).not.toContain('Sort Key:');
    expect(plan).not.toContain('Incremental Sort');
  });

  it('🔴 実行計画に RLS（C3）の述語が現れる —— 母集団を決めているのはアプリではない', async () => {
    const plan = await explain(
      HOST_1,
      `SELECT id FROM engineers ORDER BY updated_at DESC, id DESC LIMIT 51`,
      { forceIndex: true },
    );

    expect(plan).toContain("current_setting('app.tenant_id'");
    expect(plan).toContain('owner_partner_company_id');
  });
});

// ---------------------------------------------------------------------------
// ④ 🔴 trigram の GIN 索引を置かない判断の**根拠**（docs/03 §3.7.2 懸念 4）
// ---------------------------------------------------------------------------
// 🔴 「作らないことにした」を注釈だけで残すと、次にこの領域を触る人が理由を再発見できない
//    （そして「なぜか索引が無い」として足し直す）。**根拠を機械で固定する。**
describe('④ RLS 下では trigram の GIN を使えない（索引を作らない判断の根拠。docs/03 §3.7.2 懸念 4）', () => {
  it('🔴 根拠 1: `LIKE` / `ILIKE` の実装関数が leakproof ではない', async () => {
    const rows = await admin.$queryRaw<{ proname: string; proleakproof: boolean }[]>`
      SELECT proname, proleakproof FROM pg_proc
       WHERE pronamespace = 'pg_catalog'::regnamespace
         AND proname IN ('textlike', 'texticlike')
       ORDER BY proname`;

    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      // 🔴 ここが `true` に変わったら（PostgreSQL 側の変更 / 手動の ALTER FUNCTION）、
      //    trigram の GIN を索引条件に降ろせるようになる。**そのときは判断をやり直す**
      //    （docs/03 §3.7.2 懸念 4 / §3.7.3 の段階 1）。
      expect(row.proleakproof, `${row.proname} が leakproof になった`).toBe(false);
    }
  });

  it('🔴 根拠 2: RLS が効いた `ILIKE` は索引条件になれず Filter に残る', async () => {
    // 単一列の `gin_trgm_ops` 索引を**一時的に**作って確かめる（作った索引はこのテストで消す）。
    await admin.$executeRawUnsafe(
      `CREATE INDEX t0605_probe_trgm ON engineers USING gin (display_name gin_trgm_ops)`,
    );
    try {
      await admin.$executeRawUnsafe('ANALYZE engineers');
      const plan = await explain(
        HOST_1,
        `SELECT id FROM engineers WHERE display_name ILIKE '%${FREE_WORD}%'`,
        { forceIndex: true },
      );

      // 🔴 索引があっても使われない（＝ 作る意味が無い）。
      expect(plan).not.toContain('t0605_probe_trgm');
      expect(plan).toContain('display_name ~~*');
      // 🔴 一方で **RLS の `tenant_id` 等値は索引条件になる** —— これが「フリーワードの走査が
      //    そのテナントの行数に閉じる」ことの根拠であり、Phase 1 の性能の拠り所である。
      expect(plan).toContain("Index Cond: (tenant_id = (NULLIF(current_setting('app.tenant_id'");
    } finally {
      await admin.$executeRawUnsafe('DROP INDEX t0605_probe_trgm');
      await admin.$executeRawUnsafe('ANALYZE engineers');
    }
  });

  it('🔴 したがって trigram の GIN 索引は 1 本も存在しない（使われない索引を作らない）', async () => {
    const rows = await admin.$queryRaw<{ indexdef: string }[]>`
      SELECT indexdef FROM pg_indexes WHERE schemaname = 'public'`;

    expect(rows.map((row) => row.indexdef).filter((def) => def.includes('trgm_ops'))).toEqual([]);
  });
});

describe('検索の結果そのもの（計画だけでなく、seam が実データで一致すること）', () => {
  it('🔴 `freeWordFilter` の述語が実 DB で一致する', async () => {
    const engineerId = '01930000-0000-7000-8000-00000000ee01';
    await admin.engineer.create({
      data: {
        id: engineerId,
        tenantId: TENANT_1.tenantId,
        displayName: `${FREE_WORD}テスト`,
        availability: 'STANDBY',
        createdAt: NOW,
        updatedAt: NOW,
      },
    });
    try {
      const client = createUnextendedClient(database.tenantUrl);
      try {
        const rows = await runUnextended(
          client,
          {
            tenantId: HOST_1.tenantId,
            partnerCompanyId: HOST_1.partnerCompanyId,
            actorUserId: HOST_1.userId,
          },
          // 🔴 述語は `@ses/db` の seam（`freeWordFilter`）から作る —— テストが独自に
          //    `contains` を書くと、実装を差し替えたときにテストだけ古い形のまま通る。
          (tx) =>
            tx.engineer.findMany({
              where: { displayName: freeWordFilter(FREE_WORD) },
              select: { id: true },
            }),
        );
        expect(rows.map((row) => row.id)).toEqual([engineerId]);
      } finally {
        await client.$disconnect();
      }
    } finally {
      await admin.engineer.delete({ where: { id: engineerId } });
    }
  });
});
