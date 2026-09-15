// tests/isolation/rls-enforced.test.ts
// T-02-09（docs/sprints/SP-02-schema-isolation.md）: 🔴 分離機構が「有効であること自体」の
// 機械検証（docs/05 §4.7 / §17.2 #1 / #2 / #4 / #5）。**docs/05 §4.7 のカタログ走査 15 本を
// そのままテストに落とす、唯一の場所**（監査上「15 本が 1 箇所で読める」ことを優先する）。
//
// 🔴 T-08-03（SP-08）で #15（共有スコープの追加ポリシーが 2 表だけであること。docs/05 §4.5）を
//    足した。#14 と同じ理由で**末尾に置く**（番号は安定した識別子であり、並び順ではない）。
//
// 🔴 Issue #33（docs/05 §3.3.1 / §17.1「14 本」）で #14（パートナー FK の複合 FK 化）を足した。
//    docs/05 §4.7 の本文では #10 と #11 の間に書かれているが、**実装では末尾の #14 とする**:
//    途中に挿入して以降を繰り上げると、既存の #11〜#13 を参照している本ファイル外のコメント
//    （seed / route5-counterparty.test.ts 等）が一斉に指し違える。番号は「並び順」ではなく
//    「安定した識別子」として扱う。docs/05 §4.7 側も末尾へ移動して並びを揃えてある。
//
// 🔴 RLS が無効化されてもアプリは正常に動くため、機能テストでは気づけない。この網はカタログ
//    （`pg_class` / `pg_policy` / `information_schema.role_*_grants` / Prisma DMMF）を走査し、
//    テーブル名を一切列挙しない（除外は「4 表 + `_prisma_migrations`」だけを「全部から引く」
//    向きで書く）。除外リストを広げて通すのは、このテストが防ごうとしている壊し方そのもの。
//
// 置き場所の整理（T-02-09 申し送り 3。programmer 判断）:
//   - #1〜#4: rls-classes.test.ts の「T-02-06 の完了判定」ブロック（同ファイルの予告どおり）を
//     ここへ移設した。旧ブロックは削除済み。
//   - #5 / #6 / #7 / #10: roles.test.ts に T-01-05 / T-02-08 の完了判定として、許可リスト単位の
//     より詳しい実装（許可されるべき列・ロールの正確な集合）がすでにある。それらは残したまま、
//     ここには docs/05 §4.7 の文言どおりの粗い集合検査（「0 件であること」）を独立に置く。
//     深さの異なる 2 つの検査であり、単純な二重定義ではない。denylist（§7）だけは
//     tests/isolation/support/platform-read-denylist.ts に単一出所化し、両ファイルが import する。
//   - #8: Prisma DMMF は `@prisma/client` の直接 import を要するが、tests/isolation/** では
//     ESLint が禁止する（`eslint.config.mjs` の TESTS_ISOLATION_OPTIONS）。判定ロジック
//     （`tenantKeyOf`）は packages/db/src/scope-injection.ts の実装を再利用し、DMMF の読み取りは
//     `@ses/db/testing` の `readTenantScopeCoverage()` に閉じ込めた
//     （packages/db/src/tenant-relation.test.ts と同じ関数を呼ぶため、判定の二重実装ではない）。
//   - #9 / #11: owner-counterparty-inheritance.test.ts の ⑤ は T-02-08 の最小実証であり、
//     表を列挙してよい前提で書かれている（同ファイル冒頭コメント）。ここでは列挙せず、
//     `pg_attribute` + `pg_description` のカタログ走査で「宣言を持つ全表」を動的に求める。
//   - #12 / #13: route5-counterparty.test.ts（T-02-07）にすでに詳しい実証があるが、
//     期待値（許可列・依存表）は tests/isolation/support/route5-views.ts に単一出所化し、
//     両ファイルが import する。ここでは docs/05 §4.7 の文言に対応する最小集合だけを書く。
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { TENANT_SCOPE_EXCLUDED_MODELS, TENANT_SCOPE_SYSTEM_ONLY_MODELS } from '@ses/db';
import {
  createUnextendedClient,
  hasColumnPrivilege,
  hasTablePrivilege,
  readPolicies,
  readPublicBaseTables,
  readRoleBypassRls,
  readTableColumns,
  readTableRlsStatus,
  readTenantScopeCoverage,
  type PolicyRow,
  type UnextendedClient,
} from '@ses/db/testing';
import { PLATFORM_READ_COLUMN_DENYLIST } from './support/platform-grants.js';
import { ROLE_NAMES, startIsolationDatabase, type IsolationDatabase } from './support/postgres.js';
import { ALLOWED_VIEW_COLUMNS, ALLOWED_VIEW_DEPENDENCY_TABLES, VIEW_NAMES } from './support/route5-views.js';

const SETUP_TIMEOUT_MS = 600_000;

// docs/05 §4.7 の除外リスト。🔴 「全部から 4 つを引く」向きで書き、ここを広げて通さない。
const OUT_OF_SCOPE = ['platform_users', 'plans', 'subscriptions', 'skills', '_prisma_migrations'];

// docs/05 §4.4.1 / §4.7 #11: 当事者列を持ってよいのはこの 4 表だけ（経路 5。人間が承認した対象）。
const COUNTERPARTY_TABLES = ['assignments', 'contracts', 'contract_documents', 'orders'] as const;

let database: IsolationDatabase;
let db: UnextendedClient;
let migrator: UnextendedClient;

beforeAll(async () => {
  database = await startIsolationDatabase();
  db = createUnextendedClient(database.tenantUrl);
  migrator = createUnextendedClient(database.migratorUrl);
}, SETUP_TIMEOUT_MS);

afterAll(async () => {
  await db?.$disconnect();
  await migrator?.$disconnect();
  await database?.stop();
}, SETUP_TIMEOUT_MS);

/** #1〜#4 / #6 / #7 / #9 / #11 が共有する母集団: 射程外 4 表を除いた「実表（親のみ、子パーティション除く）」。 */
async function businessTables(): Promise<string[]> {
  return (await readPublicBaseTables(db)).filter((table) => !OUT_OF_SCOPE.includes(table));
}

describe('#1 全業務テーブルで RLS が有効かつ FORCE されている（docs/05 §4.7 #1）', () => {
  it('除外4表 + _prisma_migrations を除く全表で relrowsecurity / relforcerowsecurity が true', async () => {
    const tables = await businessTables();
    expect(tables.length).toBeGreaterThan(0); // 空振り防止（対照）

    const statuses = await readTableRlsStatus(db, tables);
    expect(statuses).toHaveLength(tables.length);
    for (const status of statuses) {
      expect(status.rlsEnabled, `${status.table}: RLS 無効`).toBe(true);
      expect(status.rlsForced, `${status.table}: FORCE 無し`).toBe(true);
    }
  });
});

describe('#2 全表にポリシーが 1 つ以上ある（docs/05 §4.7 #2）', () => {
  it('ポリシーが 1 つも無い業務テーブルが 0 件である', async () => {
    const tables = await businessTables();
    // 空振り防止（docs/05 §3.2 の 58 表 − 射程外 4 表）。
    // 🔴 T-07-09 で `project_publish_requests` を 1 表足した（docs/05 §11.11 ①）。
    // 🔴 T-09-12 で `engineer_careers` を 1 表足した（docs/05 §3.4 / Issue #35 = A）。
    // 🔴 T-10-02 で `usage_measurement_findings` を 1 表足した（docs/05 §9.8 / migration 20260919000000）。
    expect(tables).toHaveLength(55);

    const policies = await readPolicies(db);
    const withPolicy = new Set(policies.map((policy) => policy.table));
    expect(tables.filter((table) => !withPolicy.has(table))).toEqual([]);
  });
});

describe('#3 app_tenant に権限がある表の全ポリシーが app_tenant_id() を参照する（docs/05 §4.7 #3）', () => {
  it('USING(true) の類が無く、app_tenant_id() を参照しないポリシー式が無い', async () => {
    const tables = await businessTables();
    const policies = await readPolicies(db);

    const offenders: string[] = [];
    let checked = 0;
    for (const table of tables) {
      const privileges = await Promise.all(
        (['SELECT', 'INSERT', 'UPDATE', 'DELETE'] as const).map((privilege) =>
          hasTablePrivilege(db, 'app_tenant', table, privilege),
        ),
      );
      if (!privileges.some(Boolean)) continue;

      for (const policy of policies.filter((candidate) => candidate.table === table)) {
        // app_tenant に適用されるポリシー = TO app_tenant または TO PUBLIC。
        if (!policy.roles.includes('app_tenant') && !policy.roles.includes('public')) continue;
        checked += 1;
        const expression = `${policy.using ?? ''} ${policy.withCheck ?? ''}`;
        if (!expression.includes('app_tenant_id()')) {
          offenders.push(`${table}.${policy.policy}: ${expression.trim()}`);
        }
      }
    }
    expect(checked).toBeGreaterThan(0); // 空振り防止（対照）
    expect(offenders).toEqual([]);
  });

  it('🔴 USING (true) / WITH CHECK (true) 相当のポリシーが 1 件も無い', async () => {
    const policies = await readPolicies(db);
    const suspicious = policies.filter(
      (policy) => policy.using === 'true' || policy.withCheck === 'true',
    );
    expect(suspicious).toEqual([]);
  });
});

describe('#4 孤児表の検出（docs/05 §4.7 #4）', () => {
  it('app_tenant に権限が無い業務テーブルは app_platform / app_platform_write のいずれかに権限がある', async () => {
    const tables = await businessTables();
    const orphans: string[] = [];
    for (const table of tables) {
      const tenant = await Promise.all(
        (['SELECT', 'INSERT', 'UPDATE', 'DELETE'] as const).map((privilege) =>
          hasTablePrivilege(db, 'app_tenant', table, privilege),
        ),
      );
      if (tenant.some(Boolean)) continue;
      const platform = await Promise.all(
        (['app_platform', 'app_platform_write'] as const).flatMap((role) =>
          (['SELECT', 'INSERT', 'UPDATE'] as const).map((privilege) =>
            hasTablePrivilege(db, role, table, privilege),
          ),
        ),
      );
      if (!platform.some(Boolean)) orphans.push(table);
    }
    expect(orphans).toEqual([]);
  });
});

describe('#5 全ロールが BYPASSRLS を持たない（docs/05 §4.7 #5 / §4.2）', () => {
  it('LOGIN 4 ロール + probe 5 ロール（app_gate_probe を含む。T-09-13）のいずれも rolbypassrls = false', async () => {
    const roles = await readRoleBypassRls(db, [...ROLE_NAMES]);
    // 空振り防止（対照）。🔴 ROLE_NAMES が唯一の出所であり、ここに数値を書き写さない
    //    （T-05-05 で app_scan_probe を足したとき、この行だけが取り残された）。
    expect(roles).toHaveLength(ROLE_NAMES.length);
    for (const role of roles) {
      expect(role.bypassRls, `${role.role}: BYPASSRLS を持っている`).toBe(false);
    }
  });
});

/**
 * 🔴 T-03-08: `audit_logs` だけは `app_platform` に `INSERT` がある（docs/05 §4.2 の表
 *    「`audit_logs` は `INSERT/SELECT`」/ §5.2 / §5.3）。
 *    §5.3 の「`fn` の前に**同一トランザクションで** `AuditLog` を書く」は、読み取り接続そのものが
 *    書けなければ成立しない。**業務テーブルへの書き込みは 1 つも開いていない**ことを、
 *    この 1 表を除いた全表で毎回確認する（`UPDATE` / `DELETE` はこの表でも 0 件）。
 */
const PLATFORM_INSERT_ALLOWED_TABLES = ['audit_logs'];

describe('#6 app_platform は業務テーブルに INSERT/UPDATE/DELETE 権限を持たない（docs/05 §4.7 #6）', () => {
  it('全業務テーブルで INSERT / DELETE がすべて 0 件（audit_logs の INSERT を除く）、UPDATE も全列で 0 件', async () => {
    const tables = await businessTables();
    expect(tables.length).toBeGreaterThan(0); // 空振り防止（対照）

    for (const table of tables) {
      const [insert, del] = await Promise.all([
        hasTablePrivilege(db, 'app_platform', table, 'INSERT'),
        hasTablePrivilege(db, 'app_platform', table, 'DELETE'),
      ]);
      expect(insert, `${table}: app_platform の INSERT 権限が許可リストと不一致`).toBe(
        PLATFORM_INSERT_ALLOWED_TABLES.includes(table),
      );
      expect(del, `${table}: app_platform に DELETE 権限がある`).toBe(false);

      const columns = await readTableColumns(db, table);
      for (const column of columns) {
        const columnUpdate = await hasColumnPrivilege(db, 'app_platform', table, column, 'UPDATE');
        expect(columnUpdate, `${table}.${column}: app_platform に UPDATE 権限がある`).toBe(false);
      }
    }
  });
});

describe('#7 §5.5 の非開示列が app_platform に GRANT されていない（docs/05 §4.7 #7 / §5.5）', () => {
  it('denylist（tests/isolation/support/platform-read-denylist.ts）の全列に SELECT 権限が無い', async () => {
    let checkedCount = 0;
    for (const [table, deniedColumns] of Object.entries(PLATFORM_READ_COLUMN_DENYLIST)) {
      for (const column of deniedColumns) {
        checkedCount += 1;
        const has = await hasColumnPrivilege(db, 'app_platform', table, column, 'SELECT');
        expect(has, `${table}.${column}: app_platform に SELECT 権限がある（§5.5 違反）`).toBe(false);
      }
    }
    expect(checkedCount).toBeGreaterThan(0); // 空振り防止（対照）
  });
});

describe('#8 Prisma 拡張の対象モデル一覧が、除外 4 モデル以外のすべてを含む（docs/05 §4.7 #8 / §17.2 #2）', () => {
  it('除外 4 モデル以外は tenantKeyOf の宣言先が実在するスカラー列を指す', () => {
    const coverage = readTenantScopeCoverage();
    expect(coverage.length).toBeGreaterThan(0); // 空振り防止（対照。DMMF の読み取りが空振りしていない）

    const excluded = new Set<string>(TENANT_SCOPE_EXCLUDED_MODELS);
    const notExcluded = coverage.filter((row) => !excluded.has(row.model));
    expect(notExcluded.length).toBeGreaterThan(0); // 空振り防止（対照）
    for (const row of notExcluded) {
      expect(
        row.declaredFieldExists,
        `${row.model}${row.tenantKey ? `.${row.tenantKey}` : ''}: 宣言された注入先列が実在しない（対象モデルの取りこぼし）`,
      ).toBe(true);
    }

    // 除外 4 モデルは逆に対象外（tenantKeyOf が null を返す）であること。
    const excludedRows = coverage.filter((row) => excluded.has(row.model));
    expect(excludedRows).toHaveLength(TENANT_SCOPE_EXCLUDED_MODELS.length); // 空振り防止（対照）
    for (const row of excludedRows) {
      expect(row.tenantKey, `${row.model}: 除外モデルなのに注入先が宣言されている`).toBeNull();
    }
  });

  it('🔴 C0 SYSTEM_ONLY の 4 モデルは「除外」ではなく「対象」である（withSystemScope 経由で拒否される形の対象）', () => {
    const coverage = readTenantScopeCoverage();
    const byModel = new Map(coverage.map((row) => [row.model, row]));
    for (const model of TENANT_SCOPE_SYSTEM_ONLY_MODELS) {
      const row = byModel.get(model);
      expect(row, `${model}: DMMF に存在しない（宣言が空振りしている）`).toBeDefined();
      expect(TENANT_SCOPE_EXCLUDED_MODELS as readonly string[]).not.toContain(model);
    }
  });
});

/** #9 / #11 が共有する走査。テーブル名を列挙せず、その列を持つ表をカタログから求める。 */
type OwnerColumnRow = { readonly table: string; readonly description: string | null };

async function scanDeclaredColumn(
  column: 'owner_partner_company_id' | 'counterparty_partner_company_id',
): Promise<OwnerColumnRow[]> {
  // 🔴 T-02-09 申し送り 1: relkind IN ('r','p') AND NOT relispartition で母集団を絞る。
  //    射影ビュー（relkind = 'v'）にも counterparty_partner_company_id 列があるため、
  //    relkind で絞らないとビュー 4 本を「表」として誤検知する（migration 060 の注意書き）。
  const rows = await db.$queryRaw<Array<{ relname: string; description: string | null }>>`
    SELECT c.relname, d.description
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    JOIN pg_attribute a ON a.attrelid = c.oid AND a.attname = ${column} AND NOT a.attisdropped
    LEFT JOIN pg_description d ON d.objoid = c.oid AND d.objsubid = a.attnum
    WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p') AND NOT c.relispartition
    ORDER BY c.relname`;
  return rows.map((row) => ({ table: row.relname, description: row.description }));
}

async function triggerFunctionNames(table: string): Promise<string[]> {
  const rows = await db.$queryRaw<Array<{ proname: string }>>`
    SELECT DISTINCT p.proname
    FROM pg_trigger t
    JOIN pg_class c ON c.oid = t.tgrelid
    JOIN pg_proc p ON p.oid = t.tgfoid
    WHERE c.relname = ${table} AND NOT t.tgisinternal`;
  return rows.map((row) => row.proname);
}

/**
 * docs/05 §4.4.1 の COMMENT 表記（`<label>: root` / `<label>: child of ...`）を走査し、
 * 宣言に応じたトリガの実在だけを見る（親表名・FK 名では場合分けしない = 多相継承（CASE）にも
 * そのまま効く）。
 */
async function assertDeclarationMatchesTrigger(
  rows: readonly OwnerColumnRow[],
  label: 'owner-column' | 'counterparty-column',
): Promise<void> {
  expect(rows.length).toBeGreaterThan(0); // 空振り防止（対照）
  for (const row of rows) {
    expect(row.description, `${row.table}.*_partner_company_id: COMMENT 宣言が無い`).not.toBeNull();
    const description = row.description as string;
    expect(
      description.startsWith(`${label}: `),
      `${row.table}: 宣言の接頭辞が不正: "${description}"`,
    ).toBe(true);
    const body = description.slice(`${label}: `.length);
    const functionNames = await triggerFunctionNames(row.table);

    if (body === 'root') {
      expect(
        functionNames,
        `${row.table}: freeze_owner_partner_company トリガが無い（実際: ${functionNames.join(',') || '(なし)'}）`,
      ).toContain('freeze_owner_partner_company');
    } else if (body.startsWith('child of')) {
      expect(
        functionNames.some((name) => name.startsWith('inherit_')),
        `${row.table}: 継承トリガ（inherit_*）が無い（実際: ${functionNames.join(',') || '(なし)'}）`,
      ).toBe(true);
    } else {
      throw new Error(`${row.table}: 未知の宣言形式です: "${description}"（docs/05 §4.4.1）`);
    }
  }
}

describe('#9 オーナー列（owner_partner_company_id）の宣言とトリガの一致（docs/05 §4.7 #9 / §4.4.1）', () => {
  it('宣言（root/child）を持つ全表に、宣言どおりのトリガがある', async () => {
    const rows = await scanDeclaredColumn('owner_partner_company_id');
    await assertDeclarationMatchesTrigger(rows, 'owner-column');
  });
});

describe('#10 probe ロールの最小権限（docs/05 §4.7 #10 / §4.4.1 / §8.5 / §11.14 ③）', () => {
  it('probe ロールはいずれもテーブル単位の GRANT を持たない（列単位だけを持つ）', async () => {
    const rows = await migrator.$queryRaw<Array<{ grantee: string; table_name: string }>>`
      SELECT grantee, table_name FROM information_schema.role_table_grants
      WHERE grantee IN ('app_share_probe', 'app_assignment_owner_probe', 'app_scan_probe', 'app_scheduler_probe', 'app_gate_probe')`;
    expect(rows).toEqual([]);
  });

  /**
   * 🔴 T-08-03（SP-08）: docs/05 §4.7 #10 が定める「`app_share_probe` の権限は
   *    `engineer_shares` の 3 列の SELECT だけ」を実測する（migration 20260916000000）。
   *
   * 🔴 ここに列が増えることは、**共有元（`partner_company_id` / `shared_by`）が
   *    `app_engineer_is_shared()` の中から読める**ことを意味する。関数が返すのは真偽値だけでも、
   *    読める列が増えれば「共有元でフィルタする述語」を書けるようになり、ホストが
   *    「どの取引先が共有しているか」を二分探索できる（`BR-06` / `CLAUDE.md` §3.1 経路 4）。
   *    **期待値を固定して、増えたら必ず落ちるようにする。**
   */
  it('🔴 app_share_probe の権限は engineer_shares の 3 列（tenant_id/engineer_id/revoked_at）の SELECT だけ', async () => {
    const rows = await migrator.$queryRaw<
      Array<{ table_name: string; column_name: string; privilege_type: string }>
    >`
      SELECT table_name, column_name, privilege_type
      FROM information_schema.role_column_grants
      WHERE grantee = 'app_share_probe'
      ORDER BY table_name, column_name`;
    expect(rows).toEqual([
      { table_name: 'engineer_shares', column_name: 'engineer_id', privilege_type: 'SELECT' },
      { table_name: 'engineer_shares', column_name: 'revoked_at', privilege_type: 'SELECT' },
      { table_name: 'engineer_shares', column_name: 'tenant_id', privilege_type: 'SELECT' },
    ]);
  });

  it('🔴 app_share_probe に engineer_shares 以外のテーブルの GRANT が 1 つも無い', async () => {
    const rows = await migrator.$queryRaw<Array<{ table_name: string }>>`
      SELECT DISTINCT table_name FROM information_schema.role_column_grants
      WHERE grantee = 'app_share_probe'
      ORDER BY table_name`;
    expect(rows).toEqual([{ table_name: 'engineer_shares' }]);
  });

  it('🔴 app_share_probe は NOLOGIN であり、スキーマの CREATE 権限を持たない', async () => {
    const rows = await migrator.$queryRaw<Array<{ rolcanlogin: boolean; can_create: boolean }>>`
      SELECT rolcanlogin, has_schema_privilege('app_share_probe', 'public', 'CREATE') AS can_create
        FROM pg_roles WHERE rolname = 'app_share_probe'`;
    expect(rows[0]?.rolcanlogin).toBe(false);
    // 🔴 ALTER FUNCTION ... OWNER TO のために一時的に付与し、直後に REVOKE している。
    expect(rows[0]?.can_create).toBe(false);
  });

  it('app_assignment_owner_probe の権限は engineers の 3 列（tenant_id/id/owner_partner_company_id）の SELECT だけ', async () => {
    const rows = await migrator.$queryRaw<
      Array<{ table_name: string; column_name: string; privilege_type: string }>
    >`
      SELECT table_name, column_name, privilege_type
      FROM information_schema.role_column_grants
      WHERE grantee = 'app_assignment_owner_probe'
      ORDER BY table_name, column_name`;
    expect(rows).toEqual([
      { table_name: 'engineers', column_name: 'id', privilege_type: 'SELECT' },
      { table_name: 'engineers', column_name: 'owner_partner_company_id', privilege_type: 'SELECT' },
      { table_name: 'engineers', column_name: 'tenant_id', privilege_type: 'SELECT' },
    ]);
  });

  /**
   * 🔴 T-05-05: `app_scan_probe` の権限が **`skill_sheets` のスキャン関連の列だけ**であることを
   *    固定する（docs/05 §4.2 / §8.5。migration 20260908000000 の判断事項）。
   *
   * 🔴 ここに列が増えることは「スキャン以外の情報がパートナー境界を越える」ことを意味する。
   *    `engineer_id` / `uploaded_by` / `byte_size` などが混ざれば、ホスト文脈のジョブから
   *    パートナー所属エンジニアの台帳へ間接的に届く経路が開く。**期待値を固定して気づけるようにする。**
   */
  it('🔴 app_scan_probe の権限は skill_sheets のスキャン関連の列 + engineers の 3 列だけである', () => {
    // 実測は下の it（非同期）で行う。ここは期待値の宣言そのものをレビュー可能にするための対照。
    expect(SCAN_PROBE_EXPECTED_GRANTS).toHaveLength(13);
  });

  it('🔴 app_scan_probe の列単位 GRANT が期待どおり（増えたら必ず落ちる）', async () => {
    const rows = await migrator.$queryRaw<
      Array<{ table_name: string; column_name: string; privilege_type: string }>
    >`
      SELECT table_name, column_name, privilege_type
      FROM information_schema.role_column_grants
      WHERE grantee = 'app_scan_probe'
      ORDER BY table_name, column_name, privilege_type`;
    expect(rows).toEqual(SCAN_PROBE_EXPECTED_GRANTS);
  });

  it('🔴 app_scan_probe に skill_sheets / engineers 以外のテーブルの GRANT が 1 つも無い', async () => {
    const rows = await migrator.$queryRaw<Array<{ table_name: string }>>`
      SELECT DISTINCT table_name FROM information_schema.role_column_grants
      WHERE grantee = 'app_scan_probe'
      ORDER BY table_name`;
    expect(rows).toEqual([{ table_name: 'engineers' }, { table_name: 'skill_sheets' }]);
  });

  it('🔴 app_scan_probe は NOLOGIN であり、スキーマの CREATE 権限を持たない', async () => {
    const rows = await migrator.$queryRaw<Array<{ rolcanlogin: boolean; can_create: boolean }>>`
      SELECT rolcanlogin, has_schema_privilege('app_scan_probe', 'public', 'CREATE') AS can_create
        FROM pg_roles WHERE rolname = 'app_scan_probe'`;
    expect(rows[0]?.rolcanlogin).toBe(false);
    // 🔴 ALTER FUNCTION ... OWNER TO のために一時的に付与し、直後に REVOKE している。
    expect(rows[0]?.can_create).toBe(false);
  });

  /**
   * 🔴 T-09-13: `app_gate_probe` の権限が **`proposals` 4 列 + `engineers` 7 列 + `engineer_skills` 5 列
   *    = 16 行の SELECT だけ**であることを固定する（docs/05 §11.14 ③ / ⑧。migration 20260918000000）。
   *
   * 🔴 ここに列が増えることは「ゲート実行文脈からパートナー台帳の別の列が読める」ことを意味する。
   *    `owner_partner_company_id` が混ざれば、関数本体に「所有者で絞って一覧する」述語が書けるようになり
   *    §11.14 ⑤-1 の前提（鍵が `proposal_id` である以上 1 人分より広く返す形が存在しない）が崩れる。
   *    より詳しい denylist の実測は `roles.test.ts` にある。ここは §4.7 の文言どおりの集合検査。
   */
  it('🔴 app_gate_probe の列単位 GRANT が 16 行ちょうど（SELECT のみ。増えたら必ず落ちる）', async () => {
    expect(GATE_PROBE_EXPECTED_GRANTS).toHaveLength(16); // 対照（宣言そのものをレビュー可能にする）
    const rows = await migrator.$queryRaw<
      Array<{ table_name: string; column_name: string; privilege_type: string }>
    >`
      SELECT table_name, column_name, privilege_type
      FROM information_schema.role_column_grants
      WHERE grantee = 'app_gate_probe'
      ORDER BY table_name, column_name, privilege_type`;
    expect(rows).toEqual(GATE_PROBE_EXPECTED_GRANTS);
    expect(rows.every((row) => row.privilege_type === 'SELECT')).toBe(true);
  });

  it('🔴 app_gate_probe に proposals / engineers / engineer_skills 以外のテーブルの GRANT が 1 つも無い', async () => {
    const rows = await migrator.$queryRaw<Array<{ table_name: string }>>`
      SELECT DISTINCT table_name FROM information_schema.role_column_grants
      WHERE grantee = 'app_gate_probe'
      ORDER BY table_name`;
    expect(rows).toEqual([{ table_name: 'engineer_skills' }, { table_name: 'engineers' }, { table_name: 'proposals' }]);
  });

  it('🔴 app_gate_probe は engineers.owner_partner_company_id を SELECT できない（所有者で絞る述語が書けない。§11.14 ⑤-1）', async () => {
    expect(await hasColumnPrivilege(db, 'app_gate_probe', 'engineers', 'owner_partner_company_id', 'SELECT')).toBe(false);
    // 対照: 開示列は読める（列 GRANT そのものが効いている）。
    expect(await hasColumnPrivilege(db, 'app_gate_probe', 'engineers', 'contact_email', 'SELECT')).toBe(true);
  });

  it('🔴 app_gate_probe は NOLOGIN であり、スキーマの CREATE 権限を持たない', async () => {
    const rows = await migrator.$queryRaw<Array<{ rolcanlogin: boolean; can_create: boolean }>>`
      SELECT rolcanlogin, has_schema_privilege('app_gate_probe', 'public', 'CREATE') AS can_create
        FROM pg_roles WHERE rolname = 'app_gate_probe'`;
    expect(rows[0]?.rolcanlogin).toBe(false);
    // 🔴 ALTER FUNCTION ... OWNER TO のために一時的に付与し、直後に REVOKE している。
    expect(rows[0]?.can_create).toBe(false);
  });
});

/**
 * 🔴 `app_gate_probe` に許した列（migration 20260918000000。docs/05 §11.14 ③）。
 *
 *  - `proposals`: 鍵の解決に要る 4 列（subject / body / 提案先 / 単価には届かない）
 *  - `engineers`: PII 層の既知値 5 列 + 結合キー 2 列（🔴 `owner_partner_company_id` は無い）
 *  - `engineer_skills`: 整合層の照合 3 列 + 結合キー 2 列
 *
 * 合計 16 行ちょうど・すべて SELECT。
 */
const GATE_PROBE_EXPECTED_GRANTS = [
  { table_name: 'engineer_skills', column_name: 'engineer_id', privilege_type: 'SELECT' },
  { table_name: 'engineer_skills', column_name: 'level', privilege_type: 'SELECT' },
  { table_name: 'engineer_skills', column_name: 'skill_id', privilege_type: 'SELECT' },
  { table_name: 'engineer_skills', column_name: 'tenant_id', privilege_type: 'SELECT' },
  { table_name: 'engineer_skills', column_name: 'years_of_experience', privilege_type: 'SELECT' },
  { table_name: 'engineers', column_name: 'affiliation_label', privilege_type: 'SELECT' },
  { table_name: 'engineers', column_name: 'birth_date', privilege_type: 'SELECT' },
  { table_name: 'engineers', column_name: 'contact_email', privilege_type: 'SELECT' },
  { table_name: 'engineers', column_name: 'contact_phone', privilege_type: 'SELECT' },
  { table_name: 'engineers', column_name: 'display_name', privilege_type: 'SELECT' },
  { table_name: 'engineers', column_name: 'id', privilege_type: 'SELECT' },
  { table_name: 'engineers', column_name: 'tenant_id', privilege_type: 'SELECT' },
  { table_name: 'proposals', column_name: 'engineer_id', privilege_type: 'SELECT' },
  { table_name: 'proposals', column_name: 'id', privilege_type: 'SELECT' },
  { table_name: 'proposals', column_name: 'state', privilege_type: 'SELECT' },
  { table_name: 'proposals', column_name: 'tenant_id', privilege_type: 'SELECT' },
];

/**
 * 🔴 `app_scan_probe` に許した列（migration 20260908000000）。
 *
 *  - `skill_sheets`: SELECT 7 列 + UPDATE 3 列
 *  - `engineers`: SELECT 3 列 —— 🔴 **オーナー列の継承トリガ**
 *    （`inherit_owner_partner_company('engineers','engineer_id')`。docs/05 §4.4.1）が
 *    `skill_sheets` の UPDATE で必ず起動し、SECURITY INVOKER で親を読むため。
 *    `app_assignment_owner_probe` に与えているのと**同じ 3 列**である。
 *
 * 🔴 T-05-08 で `skill_sheets.owner_partner_company_id` の SELECT を 1 列足した
 *    （migration 20260910000000 / `app_scan_quarantine_target`）。**この 1 列だけで
 *    「隔離の周知をホスト側へ送るのか取引先側へ送るのか」が決まる** ——
 *    引けないと、`sandbox` で分類を取り違えて取引先へ実メールを送るか（`CLAUDE.md` §11.1）、
 *    逆にパートナーが上げたファイルの隔離が誰にも届かない（`F-011` 処理④）。
 *    🔴 それでも `engineer_id` / `version` / `note` は**足していない**: 周知メールは
 *    「画面で確認してください」の 1 リンクだけであり、内容を 1 つも運ばないためである。
 *
 * 合計 13 行ちょうど。ここに列が増えることは「スキャン以外の情報がパートナー境界を越える」
 * ことを意味する。
 */
const SCAN_PROBE_EXPECTED_GRANTS = [
  { table_name: 'engineers', column_name: 'id', privilege_type: 'SELECT' },
  { table_name: 'engineers', column_name: 'owner_partner_company_id', privilege_type: 'SELECT' },
  { table_name: 'engineers', column_name: 'tenant_id', privilege_type: 'SELECT' },
  { table_name: 'skill_sheets', column_name: 'id', privilege_type: 'SELECT' },
  { table_name: 'skill_sheets', column_name: 'is_latest', privilege_type: 'SELECT' },
  { table_name: 'skill_sheets', column_name: 'is_latest', privilege_type: 'UPDATE' },
  { table_name: 'skill_sheets', column_name: 'object_key', privilege_type: 'SELECT' },
  {
    table_name: 'skill_sheets',
    column_name: 'owner_partner_company_id',
    privilege_type: 'SELECT',
  },
  { table_name: 'skill_sheets', column_name: 'scan_status', privilege_type: 'SELECT' },
  { table_name: 'skill_sheets', column_name: 'scan_status', privilege_type: 'UPDATE' },
  { table_name: 'skill_sheets', column_name: 'scan_updated_at', privilege_type: 'UPDATE' },
  { table_name: 'skill_sheets', column_name: 'tenant_id', privilege_type: 'SELECT' },
  { table_name: 'skill_sheets', column_name: 'uploaded_at', privilege_type: 'SELECT' },
];

describe('#11 当事者列（counterparty_partner_company_id）の宣言とトリガの一致 + 4 表限定（docs/05 §4.7 #11 / BR-65〜68）', () => {
  it('宣言（root/child）を持つ全表に、宣言どおりのトリガがある', async () => {
    const rows = await scanDeclaredColumn('counterparty_partner_company_id');
    await assertDeclarationMatchesTrigger(rows, 'counterparty-column');
  });

  it('🔴 当事者列を持つ表が assignments/contracts/contract_documents/orders の 4 表ちょうどである（経路 5 の対象拡大は人間の承認事項）', async () => {
    const rows = await scanDeclaredColumn('counterparty_partner_company_id');
    expect([...rows.map((row) => row.table)].sort()).toEqual([...COUNTERPARTY_TABLES].sort());
  });
});

describe('#12 経路 5 の 4 表に書込ポリシーが無く、extension_reviews にパートナー SELECT が無い（docs/05 §4.7 #12 / BR-67 / BR-68）', () => {
  function nonHostExpressions(policies: readonly PolicyRow[]): string[] {
    const offenders: string[] = [];
    for (const policy of policies) {
      const expressions = [policy.using, policy.withCheck].filter(
        (value): value is string => value !== null,
      );
      for (const expression of expressions) {
        if (!expression.includes('app_is_host()')) {
          offenders.push(`${policy.table}.${policy.policy} (${policy.command}): ${expression}`);
        }
      }
    }
    return offenders;
  }

  it.each(COUNTERPARTY_TABLES)('%s: INSERT/UPDATE/DELETE の全ポリシーが app_is_host() を含む', async (table) => {
    const policies = (await readPolicies(db)).filter(
      (policy) => policy.table === table && policy.roles.includes('app_tenant') && policy.command !== 'SELECT',
    );
    expect(policies.length).toBeGreaterThan(0); // 空振り防止（対照）
    expect(nonHostExpressions(policies)).toEqual([]);
  });

  it('extension_reviews: app_tenant 向けの全ポリシーが app_is_host() を含む（パートナー文脈で真になり得ない）', async () => {
    const policies = (await readPolicies(db)).filter(
      (policy) => policy.table === 'extension_reviews' && policy.roles.includes('app_tenant'),
    );
    expect(policies.length).toBeGreaterThan(0); // 空振り防止（対照）
    expect(nonHostExpressions(policies)).toEqual([]);
  });
});

describe('#13 射影ビュー 4 本: security_invoker + 列集合 + 依存先の限定（docs/05 §4.7 #13 / §4.9 / BR-66 / BR-67）', () => {
  it.each(VIEW_NAMES)('%s: 列集合が §4.9 の許可列一覧と一致する', async (view) => {
    const columns = await readTableColumns(db, view);
    expect(columns).toEqual([...(ALLOWED_VIEW_COLUMNS[view] ?? [])]);
  });

  it.each(VIEW_NAMES)('%s: security_invoker = true（所有者権限で RLS を素通りしない）', async (view) => {
    const rows = await db.$queryRaw<Array<{ reloptions: string[] | null }>>`
      SELECT c.reloptions
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relkind = 'v' AND c.relname = ${view}`;
    expect(rows).toHaveLength(1);
    expect(rows[0]?.reloptions ?? []).toContain('security_invoker=true');
  });

  it('依存する表が基底 4 表 + projects + project_visibilities 以外に無い', async () => {
    const rows = await db.$queryRaw<Array<{ view_name: string; dependency: string }>>`
      SELECT DISTINCT v.relname AS view_name, t.relname AS dependency
      FROM pg_depend d
      JOIN pg_rewrite r ON r.oid = d.objid
      JOIN pg_class v ON v.oid = r.ev_class
      JOIN pg_class t ON t.oid = d.refobjid
      JOIN pg_namespace n ON n.oid = t.relnamespace
      WHERE d.classid = 'pg_rewrite'::regclass
        AND d.refclassid = 'pg_class'::regclass
        AND v.relkind = 'v'
        AND v.relname LIKE 'partner\\_%\\_v'
        AND t.relkind IN ('r', 'p')
        AND n.nspname = 'public'
      ORDER BY 1, 2`;
    expect(rows.length).toBeGreaterThan(0); // 空振り防止（対照）
    const allowed = new Set<string>(ALLOWED_VIEW_DEPENDENCY_TABLES);
    for (const row of rows) {
      expect(
        allowed.has(row.dependency),
        `${row.view_name} が ${row.dependency} に依存している（依存先の増加は開示か行消失を生む）`,
      ).toBe(true);
    }
    expect(rows.map((row) => row.dependency)).not.toContain('extension_reviews');
  });
});

/**
 * 🔴 #14（docs/05 §4.7 / §3.3.1 / Issue #33）: `partner_companies` を参照する FK は
 *    1 本残らず複合 FK であり、パートナー列は「複合 FK」か「継承の子の宣言」の
 *    どちらかを必ず持つ。
 *
 * なぜ要るか: 単一列 FK（`REFERENCES partner_companies(id)`）は「その ID が実在すること」しか
 * 見ない。ホスト文脈の `INSERT` は RLS の C5 が `app_is_host()` で `WITH CHECK` を真にするため、
 * **他テナントの取引先 ID を書いても第一防御は素通しになる**（Issue #33 の発端）。
 * 複合 FK `(tenant_id, <パートナー列>) REFERENCES partner_companies(tenant_id, id)` にすれば
 * 構造的に不可能になる（`CLAUDE.md` §3.1 第二境界を DB 側で閉じる）。
 *
 * 🔴 **列挙リストを持たない**（新規テーブルを取りこぼさないため、必ずカタログ走査で書く）。
 *    SP-06 以降にパートナーを指す列を持つ表が増えたとき、「複合 FK を張る」か
 *    「継承の子として宣言する」かを決めずには通せない、という形にする。
 */
type PartnerFkRow = {
  readonly table_name: string;
  readonly conname: string;
  readonly match_type: string;
  readonly fk_columns: string[];
  readonly referenced_columns: string[];
};

/** 継承の子（B 群）の宣言。docs/05 §4.4.1 の COMMENT 表記。 */
const CHILD_DECLARATION_PREFIXES = ['owner-column: child of', 'counterparty-column: child of'];

/**
 * 🔴 **配列のため FK を張れない列（docs/05 §3.3.1 の D 群）。理由付きの明示的な例外である。**
 *
 * PostgreSQL は配列要素に FK を張れない。この 1 列を許すのは次の 2 つが成り立つからである:
 *   ① 行が**一時的**である（ゲートが通るまでの公開要求であり、確定と同時に消える）
 *   ② 実際に永続化される先（`project_visibilities`）に**複合 FK がある** ——
 *      他テナントの ID が紛れ込んでも公開範囲の行にはならず、確定が落ちる
 * 加えて入口（`#28` の `assertPartnerCompaniesExist`）が見えない ID を 400 で断る。
 *
 * 🔴 **ここを増やさない。** ①②のどちらかを欠く配列列は、複合 FK を張れる子表に分解すること。
 */
const ARRAY_COLUMN_EXCEPTIONS = new Set(['project_publish_requests.partner_company_ids']);

async function readPartnerCompanyForeignKeys(): Promise<PartnerFkRow[]> {
  // 🔴 conparentid = 0: パーティション子へ複製された FK の写しを重複計上しない
  //    （現時点で該当は無いが、将来パーティション表がパートナー列を持ったときに効く）。
  return db.$queryRaw<PartnerFkRow[]>`
    SELECT c.conrelid::regclass::text AS table_name,
           c.conname,
           c.confmatchtype::text AS match_type,
           (SELECT array_agg(a.attname ORDER BY k.ord)
              FROM unnest(c.conkey) WITH ORDINALITY AS k(attnum, ord)
              JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = k.attnum) AS fk_columns,
           (SELECT array_agg(a.attname ORDER BY k.ord)
              FROM unnest(c.confkey) WITH ORDINALITY AS k(attnum, ord)
              JOIN pg_attribute a ON a.attrelid = c.confrelid AND a.attnum = k.attnum) AS referenced_columns
      FROM pg_constraint c
     WHERE c.contype = 'f'
       AND c.confrelid = 'partner_companies'::regclass
       AND c.conparentid = 0
     ORDER BY 1, 2`;
}

describe('#14 partner_companies を指す FK は全て複合 FK である（docs/05 §4.7 / §3.3.1 / Issue #33）', () => {
  it('① すべての FK が (tenant_id, <パートナー列>) → (tenant_id, id) の 2 列である', async () => {
    const rows = await readPartnerCompanyForeignKeys();
    // 空振り防止（対照）。docs/05 §3.3.1 の A 群 13 列が下限であり、
    // 🔴 減ることは「複合 FK が単一列へ差し戻された / FK ごと消えた」を意味する。
    expect(rows.length).toBeGreaterThanOrEqual(13);

    const offenders = rows.filter(
      (row) =>
        row.fk_columns.length !== 2 ||
        row.fk_columns[0] !== 'tenant_id' ||
        row.referenced_columns.length !== 2 ||
        row.referenced_columns[0] !== 'tenant_id' ||
        row.referenced_columns[1] !== 'id',
    );
    expect(
      offenders.map(
        (row) =>
          `${row.table_name}.${row.conname}: (${row.fk_columns.join(',')}) -> (${row.referenced_columns.join(',')})`,
      ),
      '単一列 FK（テナントをまたいで成立する）が残っています',
    ).toEqual([]);
  });

  it('🔴 ① MATCH FULL（confmatchtype = f）の FK が 1 本も無い（既定の MATCH SIMPLE のみ）', async () => {
    // 🔴 docs/05 §3.3.1-4: パートナー列の NULL は「ホスト所有」を意味する正当な値であり、
    //    MATCH SIMPLE では照合そのものが行われない。MATCH FULL にすると
    //    「tenant_id はあるがパートナー列は NULL」の行が拒否され、ホスト所有行を 1 行も作れなくなる。
    const rows = await readPartnerCompanyForeignKeys();
    expect(rows.length).toBeGreaterThan(0); // 空振り防止（対照）
    expect(
      rows.filter((row) => row.match_type !== 's').map((row) => `${row.conname}: ${row.match_type}`),
    ).toEqual([]);
  });

  it('② パートナー列は「複合 FK の 1 列」か「継承の子の宣言」か「明示的な例外」のいずれかを必ず持つ', async () => {
    // 🔴 relkind で絞る: 経路 5 の射影ビュー（relkind = 'v'）にも
    //    counterparty_partner_company_id 列があり、ビューは FK を持てない（#9 / #11 と同じ理由）。
    const columns = await db.$queryRaw<
      Array<{ table_name: string; column_name: string; description: string | null }>
    >`
      SELECT c.relname AS table_name, a.attname AS column_name, d.description
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      JOIN pg_attribute a ON a.attrelid = c.oid AND NOT a.attisdropped AND a.attnum > 0
      LEFT JOIN pg_description d ON d.objoid = c.oid AND d.objsubid = a.attnum
      WHERE n.nspname = 'public'
        AND c.relkind IN ('r', 'p')
        AND NOT c.relispartition
        -- 🔴 T-07-09: 末尾一致から部分一致に広げた。末尾一致のままだと、列名を複数形にする
        --    （partner_company_ids）だけで「複合 FK か継承の子かを決めずに表を足せる」——
        --    Issue #33 の一般則が命名で回避できてしまう（本テストが防ごうとしている壊し方そのもの）。
        AND a.attname LIKE '%partner\\_company\\_id%'
      ORDER BY 1, 2`;
    expect(columns.length).toBeGreaterThanOrEqual(24); // 空振り防止（A 群 13 + B 群 10 + D 群 1）

    const fkColumns = new Set(
      (await readPartnerCompanyForeignKeys()).map((row) => `${row.table_name}.${row.fk_columns[1]}`),
    );

    const offenders = columns
      .filter((column) => !fkColumns.has(`${column.table_name}.${column.column_name}`))
      .filter(
        (column) =>
          !CHILD_DECLARATION_PREFIXES.some((prefix) => (column.description ?? '').startsWith(prefix)),
      )
      .filter((column) => !ARRAY_COLUMN_EXCEPTIONS.has(`${column.table_name}.${column.column_name}`))
      .map((column) => `${column.table_name}.${column.column_name} (COMMENT: ${column.description ?? 'なし'})`);

    expect(
      offenders,
      '複合 FK も継承の子の宣言も持たないパートナー列があります（docs/05 §3.3.1 の A / B / D のどれかに決めてください）',
    ).toEqual([]);
  });

  it('🔴 ② 例外に登録した列が実在し、かつ「配列だから FK を張れない」ものだけである', async () => {
    // 🔴 例外リストが**空振り**（列名を書き間違えたまま通る）していないこと、および
    //    スカラー列をこっそり例外に入れられないことを固定する。配列でない列は
    //    複合 FK を張れるのだから、例外に入れてよい理由が無い（docs/05 §3.3.1 D）。
    const rows = await db.$queryRaw<Array<{ qualified: string; is_array: boolean }>>`
      SELECT c.relname || '.' || a.attname AS qualified, (a.attndims > 0 OR t.typcategory = 'A') AS is_array
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      JOIN pg_attribute a ON a.attrelid = c.oid AND NOT a.attisdropped AND a.attnum > 0
      JOIN pg_type t ON t.oid = a.atttypid
      WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p') AND NOT c.relispartition
        AND a.attname LIKE '%partner\\_company\\_id%'`;
    const byName = new Map(rows.map((row) => [row.qualified, row.is_array]));

    expect(ARRAY_COLUMN_EXCEPTIONS.size).toBeGreaterThan(0); // 空振り防止（対照）
    for (const qualified of ARRAY_COLUMN_EXCEPTIONS) {
      expect(byName.has(qualified), `${qualified}: 例外に登録されているが列が実在しない`).toBe(true);
      expect(byName.get(qualified), `${qualified}: 配列でない列を例外にしている`).toBe(true);
    }
  });

  it('③ partner_companies に UNIQUE(tenant_id, id) がある（① の参照先。消えると ① が張れない）', async () => {
    // 🔴 `ADD CONSTRAINT ... UNIQUE`（本移行）でも Prisma の `CREATE UNIQUE INDEX` でも成立する
    //    ように、制約名ではなく「一意インデックスの意味」で検査する（複合 FK の前提条件そのもの）。
    const rows = await db.$queryRaw<Array<{ index_name: string; columns: string[] }>>`
      SELECT i.relname AS index_name,
             (SELECT array_agg(a.attname ORDER BY k.ord)
                FROM unnest(x.indkey::int2[]) WITH ORDINALITY AS k(attnum, ord)
                JOIN pg_attribute a ON a.attrelid = x.indrelid AND a.attnum = k.attnum) AS columns
        FROM pg_index x
        JOIN pg_class i ON i.oid = x.indexrelid
       WHERE x.indrelid = 'partner_companies'::regclass
         AND x.indisunique
         AND x.indpred IS NULL`;
    const matching = rows.filter(
      (row) => row.columns?.length === 2 && row.columns[0] === 'tenant_id' && row.columns[1] === 'id',
    );
    expect(matching.length, 'partner_companies の UNIQUE(tenant_id, id) が見つかりません').toBe(1);
  });

  it('🔴 ② の走査が射影ビューを誤検出していない（B 群を「宣言なし」と誤判定しない対照）', async () => {
    // ビューは relkind = 'v' なので ② の母集団に入らない。入っていたら FK を持てないため
    // 必ず FAIL する = このテスト自体が「ビューを除外できているか」の対照になる。
    const rows = await db.$queryRaw<Array<{ relname: string }>>`
      SELECT DISTINCT c.relname
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      JOIN pg_attribute a ON a.attrelid = c.oid AND NOT a.attisdropped AND a.attnum > 0
      WHERE n.nspname = 'public'
        AND c.relkind = 'v'
        AND a.attname LIKE '%partner\\_company\\_id'`;
    expect(rows.map((row) => row.relname).sort()).toEqual([...VIEW_NAMES].sort());
  });
});

// 🔴 #15（T-08-03 / SP-08。docs/05 §4.7 #15）。**#14 と同じ理由で末尾に置く**
//    （番号は「並び順」ではなく安定した識別子である）。
/**
 * 🔴 共有スコープ（`CLAUDE.md` §3.1 経路 4）の追加 SELECT ポリシーを持つ表を
 *    `engineers` / `engineer_skills` の **2 表ちょうど**に固定する（docs/05 §4.5 / §4.6）。
 *
 * 🔴 なぜ列挙ではなく走査か: 「経路 4 の開示項目を増やすこと」は**人間の承認事項**
 *    （`CLAUDE.md` §8.6 / §3.1 経路 4 の 🔴）であり、**ポリシーを 1 本足すだけで実現できては
 *    ならない**。表名を列挙した許可リストにすると「足すときに一緒に足す」で通ってしまうため、
 *    カタログ全体を走査して集合が一致することだけを見る。
 *    `engineer_careers`（T-09-12）はもちろん、将来の子表がここに現れた時点で FAIL する。
 */
const SHARED_SCOPE_POLICIES = [
  { table: 'engineer_skills', policy: 'engineer_skills_shared_candidate_read' },
  { table: 'engineers', policy: 'engineers_shared_candidate_read' },
];

describe('#15 共有スコープ（経路 4）の追加ポリシーが 2 表だけである（docs/05 §4.7 #15 / §4.5）', () => {
  it('🔴 app_engineer_is_shared / shared_scope を参照するポリシーは engineers / engineer_skills の 2 本だけ', async () => {
    const policies = await readPolicies(db);
    expect(policies.length).toBeGreaterThan(0); // 空振り防止（対照）

    const matching = policies
      .filter((policy) => {
        const expression = `${policy.using ?? ''} ${policy.withCheck ?? ''}`;
        return expression.includes('app_engineer_is_shared') || expression.includes('shared_scope');
      })
      .map((policy) => ({ table: policy.table, policy: policy.policy }))
      .sort((left, right) =>
        left.table === right.table
          ? left.policy.localeCompare(right.policy)
          : left.table.localeCompare(right.table),
      );
    expect(matching).toEqual(SHARED_SCOPE_POLICIES);
  });

  it('🔴 2 本とも SELECT 専用であり、書き込み（INSERT/UPDATE/DELETE）を開いていない', async () => {
    const policies = (await readPolicies(db)).filter((policy) =>
      SHARED_SCOPE_POLICIES.some(
        (expected) => expected.table === policy.table && expected.policy === policy.policy,
      ),
    );
    expect(policies).toHaveLength(SHARED_SCOPE_POLICIES.length); // 空振り防止（対照）
    for (const policy of policies) {
      expect(policy.command, `${policy.policy}: SELECT 以外に開いている`).toBe('SELECT');
      expect(policy.withCheck, `${policy.policy}: WITH CHECK を持っている`).toBeNull();
      // 🔴 テナント境界は共有スコープでも外さない（#3 と同じ述語を持つ）。
      expect(policy.using ?? '').toContain('app_tenant_id()');
    }
  });

  it('🔴 app_share_probe の GRANT 対象表が engineer_shares の 1 表だけである（#10 と対）', async () => {
    const rows = await migrator.$queryRaw<Array<{ table_name: string }>>`
      SELECT DISTINCT table_name FROM information_schema.role_column_grants
      WHERE grantee = 'app_share_probe'`;
    expect(rows).toEqual([{ table_name: 'engineer_shares' }]);
  });

  it('🔴 app_engineer_is_shared() の EXECUTE を持つのは app_tenant だけである（PUBLIC に無い）', async () => {
    const rows = await migrator.$queryRaw<
      Array<{ role: string; can_execute: boolean }>
    >`
      SELECT role, has_function_privilege(role, 'app_engineer_is_shared(uuid, uuid)', 'EXECUTE') AS can_execute
        FROM (VALUES ('app_tenant'), ('app_platform'), ('app_platform_write'), ('public')) AS r(role)`;
    const byRole = new Map(rows.map((row) => [row.role, row.can_execute]));
    expect(byRole.get('app_tenant')).toBe(true);
    expect(byRole.get('app_platform')).toBe(false);
    expect(byRole.get('app_platform_write')).toBe(false);
    expect(byRole.get('public')).toBe(false);
  });

  it('🔴 app_engineer_is_shared() は SECURITY DEFINER であり、所有者が app_share_probe である', async () => {
    const rows = await migrator.$queryRaw<
      Array<{ prosecdef: boolean; owner: string; proconfig: string[] | null }>
    >`
      SELECT p.prosecdef, pg_get_userbyid(p.proowner) AS owner, p.proconfig
        FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
       WHERE n.nspname = 'public' AND p.proname = 'app_engineer_is_shared'`;
    expect(rows).toHaveLength(1);
    expect(rows[0]?.prosecdef, 'SECURITY DEFINER ではない').toBe(true);
    expect(rows[0]?.owner).toBe('app_share_probe');
    // 🔴 search_path を固定していないと、SECURITY DEFINER が呼び出し側の search_path で
    //    別スキーマの engineer_shares を読みうる（PostgreSQL の定番の落とし穴）。
    // 🔴 `pg_temp` を**末尾に明示**する（T-09-13 レビューで是正。migration 20260918010000）。明示しないと
    //    一時スキーマが最初に探され、呼び出し側の一時表 `engineer_shares` で非共有エンジニアを「共有中」に
    //    化けさせられる（`tests/isolation/shared-candidate-scope.test.ts` ⑤ が実データで固定）。
    expect(rows[0]?.proconfig ?? []).toContain('search_path=public, pg_temp');
  });
});

// 🔴 #16（T-09-13 / Issue #41 = 1。docs/05 §4.7 #16 / §11.14）。**#14 / #15 と同じ理由で末尾に置く**
//    （番号は「並び順」ではなく安定した識別子である）。
/**
 * 🔴 ゲート実行文脈の限定経路（`app_gate_probe`）が読める範囲を、**`proposals` / `engineers` /
 *    `engineer_skills` の 3 表 × SELECT ちょうど**に固定する（docs/05 §11.14 ③）。
 *
 * 🔴 なぜ列挙ではなく走査か: 「ゲートが読める範囲を広げること」は本書（docs/05 §11.14 ②③）の改訂から
 *    始めるものであり、**ポリシーを 1 本足すだけで実現できてはならない**。`pg_policy` を全件走査し、
 *    `polroles` に `app_gate_probe` を含む (table, policy, command) の集合が期待値と一致することだけを見る。
 *    ①表が 4 つ目に増えた（`skill_sheets` / `engineer_careers` / `engineer_shares` 等）
 *    ②`command` に INSERT / UPDATE / DELETE が現れた ③`USING` に `app_tenant_id()` が無い —— のどれかで落ちる。
 *    あわせて `pg_proc` を走査し、所有者が `app_gate_probe` の関数が 2 本ちょうどで、SECURITY DEFINER・
 *    `search_path=public, pg_temp`・EXECUTE が `app_tenant` にだけ与えられていることを見る（#10 と対）。
 *    🔴 `pg_temp` の末尾明示は T-09-13 レビューでの是正（docs/05 §11.14 ⑩）: 無いと一時スキーマが最初に探され、
 *    呼び出し側の一時表 `proposals` で本体を隠して ⑤-1 / ⑤-2 を迂回できる（実 DB で再現。
 *    `gate-engineer-facts.test.ts` #14 ④ が固定）。
 */
const GATE_PROBE_POLICIES = [
  { table: 'engineer_skills', policy: 'engineer_skills_gate_probe_select', command: 'SELECT' },
  { table: 'engineers', policy: 'engineers_gate_probe_select', command: 'SELECT' },
  { table: 'proposals', policy: 'proposals_gate_probe_select', command: 'SELECT' },
];
const GATE_PROBE_FUNCTIONS = ['app_gate_proposal_engineer_pii', 'app_gate_proposal_engineer_skills'];

describe('#16 ゲート実行文脈の限定経路（§11.14）: app_gate_probe 向けのポリシーが 3 表 × SELECT ちょうど（docs/05 §4.7 #16）', () => {
  it('🔴 polroles に app_gate_probe を含むポリシーの (table, policy, command) 集合が 3 表 × SELECT ちょうど', async () => {
    const policies = await readPolicies(db);
    expect(policies.length).toBeGreaterThan(0); // 空振り防止（対照）

    const matching = policies
      .filter((policy) => policy.roles.includes('app_gate_probe'))
      .map((policy) => ({ table: policy.table, policy: policy.policy, command: policy.command }))
      .sort((left, right) =>
        left.table === right.table ? left.policy.localeCompare(right.policy) : left.table.localeCompare(right.table),
      );
    expect(matching).toEqual(GATE_PROBE_POLICIES);
  });

  it('🔴 3 本とも USING が app_tenant_id() を参照し、WITH CHECK を持たない（テナント境界は課す。書き込みを開かない）', async () => {
    const policies = (await readPolicies(db)).filter((policy) => policy.roles.includes('app_gate_probe'));
    expect(policies).toHaveLength(GATE_PROBE_POLICIES.length); // 空振り防止（対照）
    for (const policy of policies) {
      expect(policy.command, `${policy.policy}: SELECT 以外に開いている`).toBe('SELECT');
      expect(policy.withCheck, `${policy.policy}: WITH CHECK を持っている`).toBeNull();
      expect(policy.using ?? '', `${policy.policy}: app_tenant_id() を参照しない`).toContain('app_tenant_id()');
    }
  });

  it('🔴 所有者が app_gate_probe の関数は 2 本ちょうどで、SECURITY DEFINER かつ search_path=public, pg_temp', async () => {
    const rows = await migrator.$queryRaw<
      Array<{ proname: string; prosecdef: boolean; proconfig: string[] | null }>
    >`
      SELECT p.proname, p.prosecdef, p.proconfig
        FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
       WHERE n.nspname = 'public' AND pg_get_userbyid(p.proowner) = 'app_gate_probe'
       ORDER BY p.proname`;
    expect(rows.map((row) => row.proname)).toEqual(GATE_PROBE_FUNCTIONS);
    for (const row of rows) {
      expect(row.prosecdef, `${row.proname}: SECURITY DEFINER ではない`).toBe(true);
      // 🔴 search_path を固定していないと、SECURITY DEFINER が呼び出し側の search_path で
      //    別スキーマの proposals / engineers を読みうる（PostgreSQL の定番の落とし穴）。
      // 🔴 `pg_temp` を末尾に明示する。無いと一時スキーマが最初に探され、呼び出し側の一時表 `proposals` で
      //    本体を隠せる（T-09-13 レビューで実 DB 再現。docs/05 §11.14 ⑩）。
      expect(row.proconfig ?? [], `${row.proname}: search_path が public, pg_temp に固定されていない`).toContain(
        'search_path=public, pg_temp',
      );
    }
  });

  it('🔴 2 関数の EXECUTE を持つのは app_tenant だけである（PUBLIC / app_platform / app_platform_write に無い）', async () => {
    for (const fn of GATE_PROBE_FUNCTIONS) {
      const signature = `${fn}(uuid)`;
      const rows = await migrator.$queryRaw<Array<{ role: string; can_execute: boolean }>>`
        SELECT role, has_function_privilege(role, ${signature}::text, 'EXECUTE') AS can_execute
          FROM (VALUES ('app_tenant'), ('app_platform'), ('app_platform_write'), ('public')) AS r(role)`;
      const byRole = new Map(rows.map((row) => [row.role, row.can_execute]));
      expect(byRole.get('app_tenant'), `${fn}: app_tenant が EXECUTE できない`).toBe(true);
      expect(byRole.get('app_platform'), `${fn}: app_platform が EXECUTE できる`).toBe(false);
      expect(byRole.get('app_platform_write'), `${fn}: app_platform_write が EXECUTE できる`).toBe(false);
      expect(byRole.get('public'), `${fn}: PUBLIC が EXECUTE できる`).toBe(false);
    }
  });

  it('🔴 2 関数の引数は uuid 1 つだけで、戻り値に ID 列（*_id）が無い（鍵は proposal_id、固定形の DTO。§11.14 ⑤-1 / ⑤-3）', async () => {
    const rows = await migrator.$queryRaw<Array<{ proname: string; args: string; result: string }>>`
      SELECT p.proname,
             pg_get_function_identity_arguments(p.oid) AS args,
             pg_get_function_result(p.oid) AS result
        FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
       WHERE n.nspname = 'public' AND pg_get_userbyid(p.proowner) = 'app_gate_probe'
       ORDER BY p.proname`;
    expect(rows).toHaveLength(2);
    for (const row of rows) {
      expect(row.args, `${row.proname}: 引数が proposal_id 1 つではない`).toBe('p_proposal_id uuid');
      // 🔴 skill_id は Skill 辞書（グローバル）の ID であり個人を指さない。それ以外の *_id が戻り値に無い。
      const idColumns = row.result.match(/\b\w*_id\b/g) ?? [];
      expect(idColumns.filter((column) => column !== 'skill_id'), `${row.proname}: 戻り値に ID 列がある`).toEqual([]);
      expect(row.result).not.toMatch(/owner_partner_company_id|engineer_id|proposal_id/);
    }
  });
});

// 🔴 #17（T-09-13 レビュー是正。2026-09-15 追加）。**#14〜#16 と同じ理由で末尾に置く**（番号は安定した識別子）。
/**
 * 🔴 `SECURITY DEFINER` 関数の `search_path` は**すべて** `public, pg_temp` である（migration 20260918010000）。
 *
 * 🔴 なぜ列挙ではなく走査か: `pg_temp` を明示しない `SET search_path = public` は、リレーション名の解決で
 *    一時スキーマを最初に探す。呼び出し側が本体と同名の一時表を作り所有者ロールに SELECT を与えると、
 *    関数本体の `WHERE` / ポリシーが課す条件を呼び出し側が用意した行で満たせる（T-09-13 で実 DB 再現。
 *    `app_engineer_is_shared` は RLS ポリシーから呼ばれるため経路 4 の違反に直結する）。
 *    **今後 SECURITY DEFINER 関数を 1 本足して `pg_temp` を忘れた時点で落ちる**形にする:
 *    ① `prosecdef = true` の全関数 ② 所有者が `app_*_probe` の全関数 —— の和集合を `pg_proc` から取り、
 *    `proconfig` が `search_path=public, pg_temp` を含むことを要求する。
 */
describe('#17 SECURITY DEFINER / probe 所有の全関数の search_path が public, pg_temp である（T-09-13 レビュー是正）', () => {
  type FunctionRow = { proname: string; owner: string; prosecdef: boolean; proconfig: string[] | null };

  async function readGuardedFunctions(): Promise<FunctionRow[]> {
    return migrator.$queryRaw<FunctionRow[]>`
      SELECT p.proname, pg_get_userbyid(p.proowner) AS owner, p.prosecdef, p.proconfig
        FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
       WHERE n.nspname = 'public'
         AND (p.prosecdef OR pg_get_userbyid(p.proowner) LIKE 'app_%_probe')
       ORDER BY p.proname`;
  }

  it('対照: 母集団が空振りしていない（既知の 8 本以上）', async () => {
    const rows = await readGuardedFunctions();
    expect(rows.length).toBeGreaterThanOrEqual(8);
    expect(rows.map((row) => row.proname)).toEqual(
      expect.arrayContaining([
        'app_engineer_is_shared',
        'app_apply_scan_status',
        'app_list_stalled_scan_targets',
        'app_scan_quarantine_target',
        'app_list_scheduler_tenants',
        'app_gate_proposal_engineer_pii',
        'app_gate_proposal_engineer_skills',
        'inherit_assignment_counterparty',
      ]),
    );
  });

  it('🔴 全関数が SECURITY DEFINER であり、proconfig に search_path=public, pg_temp を含む', async () => {
    const rows = await readGuardedFunctions();
    for (const row of rows) {
      expect(row.prosecdef, `${row.proname}（owner=${row.owner}）: probe 所有なのに SECURITY DEFINER ではない`).toBe(true);
      const searchPath = (row.proconfig ?? []).find((entry) => entry.startsWith('search_path='));
      expect(searchPath, `${row.proname}: search_path が public, pg_temp に固定されていない（pg_temp を忘れると一時表で本体を隠せる）`).toBe(
        'search_path=public, pg_temp',
      );
    }
  });

  it('🔴 所有者が app_*_probe でない SECURITY DEFINER 関数が 1 本も無い（バイパスは専用ロール経由に限る。CLAUDE.md §10.5）', async () => {
    const rows = await readGuardedFunctions();
    const strangers = rows.filter((row) => !/^app_.+_probe$/.test(row.owner)).map((row) => `${row.proname}@${row.owner}`);
    expect(strangers).toEqual([]);
  });
});
