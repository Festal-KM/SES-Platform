// tests/isolation/rls-enforced.test.ts
// T-02-09（docs/sprints/SP-02-schema-isolation.md）: 🔴 分離機構が「有効であること自体」の
// 機械検証（docs/05 §4.7 / §17.2 #1 / #2 / #4 / #5）。**docs/05 §4.7 のカタログ走査 13 本を
// そのままテストに落とす、唯一の場所**（監査上「13 本が 1 箇所で読める」ことを優先する）。
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
    expect(tables).toHaveLength(52); // 空振り防止（docs/05 §3.2 の 56 表 − 射程外 4 表）

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
  it('4 ロール + probe 3 ロールのいずれも rolbypassrls = false', async () => {
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

describe('#10 probe 3 ロールの最小権限（docs/05 §4.7 #10 / §4.4.1 / §8.5）', () => {
  it('probe ロールはいずれもテーブル単位の GRANT を持たない（列単位だけを持つ）', async () => {
    const rows = await migrator.$queryRaw<Array<{ grantee: string; table_name: string }>>`
      SELECT grantee, table_name FROM information_schema.role_table_grants
      WHERE grantee IN ('app_share_probe', 'app_assignment_owner_probe', 'app_scan_probe')`;
    expect(rows).toEqual([]);
  });

  // 🔴 docs/05 §4.7 #10 は「app_share_probe の権限は engineer_shares の 3 列の SELECT だけ」と
  //    書くが、その GRANT は SP-08 で追加される（packages/db/prisma/sql/000_roles.sql:56-57
  //    「GRANT は engineer_shares が生まれる SP-08 で追加する」。roles.test.ts の対応するブロック
  //    と同じ前提）。表自体は SP-02（migration 20260903010000_engineer_project_visibility_share）
  //    で作成済みであり、無いのは app_share_probe への GRANT のみである。SP-08 で GRANT を追加する
  //    際、この期待値を 3 列ちょうどの形（app_assignment_owner_probe と対称の非空配列）へ更新すること。
  it('app_share_probe は現時点で列単位の GRANT を 0 件持つ（GRANT は SP-08 で付与される）', async () => {
    const rows = await migrator.$queryRaw<
      Array<{ table_name: string; column_name: string; privilege_type: string }>
    >`
      SELECT table_name, column_name, privilege_type
      FROM information_schema.role_column_grants
      WHERE grantee = 'app_share_probe'
      ORDER BY table_name, column_name`;
    expect(rows).toEqual([]);
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
});

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
