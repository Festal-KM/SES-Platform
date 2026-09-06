// tests/isolation/roles.test.ts
// T-01-05（docs/sprints/SP-01-bootstrap.md）: DB ロールと GRANT の適用（docs/05 §4.2 / §5.2）。
//
// 完了判定（SP-01 T-01-05）:
//   ① 5 ロールすべてが pg_roles.rolbypassrls = false
//   ② app_platform が業務テーブルに書込権限を 0 件
//   ③ app_platform_write の書込先が許可リストと一致（docs/05 §17.2 #5）
//   ④ development 例外解除後も packages/config の schema.test.ts が green
//      （本ファイルの対象外。packages/config/src/schema.test.ts で検証する）
//
// 🔴 テーブル名を列挙せず、カタログを走査する（docs/05 §4.7 と同じ方針）。
//    現時点のスキーマは最小 2 表（tenants / engineers）だが、SP-02 で表が増えても
//    「許可リストに無い表は書込権限 0 件」がデフォルトで検証され続ける。
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createUnextendedClient,
  hasColumnPrivilege,
  hasTablePrivilege,
  readPublicTables,
  readRoleBypassRls,
  readTableColumns,
  type UnextendedClient,
} from '@ses/db/testing';
import {
  PLATFORM_READ_COLUMN_ALLOWLIST,
  PLATFORM_READ_COLUMN_DENYLIST,
  PLATFORM_WRITE_TENANTS_SELECT_COLUMNS,
} from './support/platform-grants.js';
import { ROLE_NAMES, startIsolationDatabase, type IsolationDatabase } from './support/postgres.js';

const SETUP_TIMEOUT_MS = 600_000;

// docs/05 §4.7「射程外の 4 表」+ _prisma_migrations。現行スキーマには存在しないが、
// rls-enforced.test.ts（SP-02）と同じ除外リストに揃えておく。
const OUT_OF_SCOPE_TABLES = ['platform_users', 'plans', 'subscriptions', 'skills', '_prisma_migrations'];

/**
 * docs/05 §5.2 の許可リスト。`app_platform_write` が書き込んでよいのはこれだけ
 * （契約・クォータ・機能フラグ・お知らせ + tenants/invitations/tenant_sending_domains の INSERT）。
 * 🔴 T-02-01 時点では `tenants` の UPDATE 許可列のみが実在する（`invitations` /
 *    `tenant_sending_domains` への INSERT 許可は、withPlatformWrite の TENANT_PROVISIONING
 *    ドメインを実際に配線する SP-03 / T-02-06 で GRANT + ポリシーを追加する）。
 *    他の表は生まれた時点で追記する（追記を忘れると、次の 2 項目目のテスト
 *    「許可リスト外は 0 件」でその表が捕捉され続ける）。
 */
const PLATFORM_WRITE_ALLOWLIST: Record<
  string,
  { readonly insert: boolean; readonly delete: boolean; readonly updateColumns: readonly string[] }
> = {
  tenants: {
    insert: true,
    delete: false,
    updateColumns: [
      'lifecycle_state',
      'lifecycle_changed_at',
      'lifecycle_changed_by',
      'suspend_reason',
      'sandbox_expires_at',
      'closing_entered_at',
    ],
  },
  // 🔴 T-02-06: impersonation_sessions は C0 SYSTEM_ONLY のうち唯一 app_tenant に権限を与えない表
  //    （docs/05 §4.4 C0）。app_platform / app_platform_write に権限が無いと「どのロールからも
  //    到達できない孤児表」になる（§4.7 テスト #4）ため、§5.2 が列挙するとおり INSERT を与える。
  //    🔴 終了（ended_at / end_kind）の UPDATE は §5.6 を実装する SP-03 T-03-08 で許可列を
  //    決めてから足す。ここで先に広げない。
  impersonation_sessions: { insert: true, delete: false, updateColumns: [] },
  // 🔴 T-03-08（docs/05 §5.2 / API-A5）: 運営者が発行できるのは**初期 `OWNER` 招待だけ**である。
  //    `INSERT` のみで `UPDATE` / `DELETE` を持たない（既存招待の変更・取消はできない）。
  //    行の内容は RLS の `invitations_platform_write_insert`（`role='OWNER'` /
  //    `partner_company_id IS NULL` / `invited_by IS NULL` / 発行者 = 自分）が固定する。
  invitations: { insert: true, delete: false, updateColumns: [] },
  // 🔴 T-03-08（docs/05 §5.2 / API-A4 の `sendingDomain`）: 運営者は**登録だけを代行**する。
  //    DNS の設定・検証の実行・`verified_at` の書き込みはできない（`UPDATE` を GRANT しない）。
  tenant_sending_domains: { insert: true, delete: false, updateColumns: [] },
  // 🔴 T-03-07（運営者認証。`F-055` / migration 20260904000000）: 管理平面の認証経路は
  //    `app_platform_write` で動く（`app_platform` は SELECT のみで 2FA の登録・確定・
  //    リカバリコード消費・監査ログの記録ができない）。**業務テーブルへの書き込みを開いたのではない**:
  //    ポリシーが `tenant_id IS NULL AND subject_type='PLATFORM_USER' AND
  //    subject_id = current_setting('app.platform_auth_subject_id')` を課すため、
  //    テナント利用者（`subject_type='USER'`）の行には 1 行も到達できない。
  //    DELETE は与えない（未確認の登録のやり直しは UPDATE で表現する）。
  two_factor_credentials: {
    insert: true,
    delete: false,
    updateColumns: ['secret_encrypted', 'recovery_code_hashes', 'confirmed_at'],
  },
  // 🔴 docs/05 §5.2 が `app_platform_write` の書き込み先として明示している表。
  //    T-03-07 は運営者のログイン・ログアウト・2FA の記録に使う（`F-055 AC-4` / `BR-41`）。
  //    UPDATE / DELETE は 20260903040000 の REVOKE のまま 0 件（`F-005 AC-3`）。
  audit_logs: { insert: true, delete: false, updateColumns: [] },
};

let database: IsolationDatabase;
let unextended: UnextendedClient;
// 🔴 T-02-08: role_table_grants / role_column_grants の走査専用（migrator 接続で読む必要がある。
//    ④ 「app_assignment_owner_probe は engineers の 3 列だけ」参照）。
let migrator: UnextendedClient;

beforeAll(async () => {
  database = await startIsolationDatabase();
  unextended = createUnextendedClient(database.tenantUrl);
  migrator = createUnextendedClient(database.migratorUrl);
}, SETUP_TIMEOUT_MS);

afterAll(async () => {
  await unextended?.$disconnect();
  await migrator?.$disconnect();
  await database?.stop();
}, SETUP_TIMEOUT_MS);

describe('① 全ロールが BYPASSRLS を持たない（docs/05 §4.2）', () => {
  it('pg_roles.rolbypassrls = false', async () => {
    const roles = await readRoleBypassRls(unextended, [...ROLE_NAMES]);
    expect(roles.map((r) => r.role)).toEqual([...ROLE_NAMES].sort());
    for (const role of roles) {
      expect(role.bypassRls, `${role.role}: BYPASSRLS を持っている`).toBe(false);
    }
  });

  it('app_share_probe は NOLOGIN である（docs/05 §4.2「（接続しない）」）', async () => {
    const rows = await unextended.$queryRaw<Array<{ rolcanlogin: boolean }>>`
      SELECT rolcanlogin FROM pg_roles WHERE rolname = 'app_share_probe'`;
    expect(rows[0]?.rolcanlogin).toBe(false);
  });

  // 🔴 T-02-08（code-reviewer 指摘 1-②）: app_share_probe と同形の NOLOGIN 検証。
  it('app_assignment_owner_probe は NOLOGIN である（docs/05 §4.2「（接続しない）」）', async () => {
    const rows = await unextended.$queryRaw<Array<{ rolcanlogin: boolean }>>`
      SELECT rolcanlogin FROM pg_roles WHERE rolname = 'app_assignment_owner_probe'`;
    expect(rows[0]?.rolcanlogin).toBe(false);
  });

  // 🔴 T-05-05: 同形の NOLOGIN 検証（ウイルススキャンの SECURITY DEFINER 関数の所有者）。
  it('app_scan_probe は NOLOGIN である（docs/05 §4.2「（接続しない）」）', async () => {
    const rows = await unextended.$queryRaw<Array<{ rolcanlogin: boolean }>>`
      SELECT rolcanlogin FROM pg_roles WHERE rolname = 'app_scan_probe'`;
    expect(rows[0]?.rolcanlogin).toBe(false);
  });

  it('対照: app_migrator / app_tenant / app_platform / app_platform_write は LOGIN できる', async () => {
    const rows = await unextended.$queryRaw<Array<{ rolname: string; rolcanlogin: boolean }>>`
      SELECT rolname, rolcanlogin FROM pg_roles
      WHERE rolname IN ('app_migrator', 'app_tenant', 'app_platform', 'app_platform_write')
      ORDER BY rolname`;
    expect(rows.every((r) => r.rolcanlogin)).toBe(true);
  });

  it('対照: app_platform / app_platform_write に実際にログインできる（発行したパスワードが有効）', async () => {
    const platform = createUnextendedClient(database.platformUrl);
    const platformWrite = createUnextendedClient(database.platformWriteUrl);
    try {
      const [platformUser] = await platform.$queryRaw<Array<{ current_user: string }>>`SELECT current_user`;
      const [writeUser] = await platformWrite.$queryRaw<Array<{ current_user: string }>>`SELECT current_user`;
      expect(platformUser?.current_user).toBe('app_platform');
      expect(writeUser?.current_user).toBe('app_platform_write');
    } finally {
      await platform.$disconnect();
      await platformWrite.$disconnect();
    }
  });
});

/**
 * 🔴 T-03-08: `app_platform` に `INSERT` を許す唯一の表（docs/05 §4.2「`audit_logs` は
 *    `INSERT/SELECT`」/ §5.2「`audit_logs` の `INSERT` のみ許す」/ §5.3）。
 *
 *    §5.3 は「`fn` を実行する**前に**、**同一トランザクション**で `AuditLog` を `INSERT` する」と
 *    定める。読み取り接続そのものが書けなければこれは成立しない（別接続にすると
 *    「監査は commit されたがクエリは rollback」「その逆」が起こりうる）。
 *    🔴 **業務テーブルへの書き込みは 1 つも開いていない**（下のループが毎回それを確認する）。
 *    `UPDATE` / `DELETE` は 20260903040000 で `REVOKE` 済み（`F-005 AC-3`）。
 */
const PLATFORM_INSERT_ALLOWED_TABLES = ['audit_logs'];

describe('② app_platform は業務テーブルへの書込権限を 0 件持つ（docs/05 §4.2 / §5.2）', () => {
  it('SELECT 以外（INSERT/UPDATE/DELETE）がすべて 0 件（audit_logs の INSERT を除く）', async () => {
    const tables = (await readPublicTables(unextended)).filter((t) => !OUT_OF_SCOPE_TABLES.includes(t));
    expect(tables.length).toBeGreaterThan(0); // 空振り防止（対照）

    for (const table of tables) {
      const [insert, del] = await Promise.all([
        hasTablePrivilege(unextended, 'app_platform', table, 'INSERT'),
        hasTablePrivilege(unextended, 'app_platform', table, 'DELETE'),
      ]);
      expect(insert, `${table}: app_platform の INSERT 権限が許可リストと不一致`).toBe(
        PLATFORM_INSERT_ALLOWED_TABLES.includes(table),
      );
      expect(del, `${table}: app_platform に DELETE 権限がある`).toBe(false);

      const columns = await readTableColumns(unextended, table);
      for (const column of columns) {
        const columnUpdate = await hasColumnPrivilege(unextended, 'app_platform', table, column, 'UPDATE');
        expect(columnUpdate, `${table}.${column}: app_platform に UPDATE 権限がある`).toBe(false);
      }
    }
  });

  it('🔴 対照: audit_logs には INSERT がある（§5.3 の「監査を先に書く」が成立する）', async () => {
    const insert = await hasTablePrivilege(unextended, 'app_platform', 'audit_logs', 'INSERT');
    expect(insert, 'audit_logs: app_platform に INSERT 権限が無い（監査の先行が成立しない）').toBe(true);
  });

  it('🔴 tenants はテーブル単位の SELECT を持たない（§5.5「列を列挙して GRANT する」）', async () => {
    // 🔴 T-03-08 で列レベルへ寄せた（20260903050000 のテーブル単位 GRANT は REVOKE 済み）。
    //    テーブル単位が残っていると、後から追加された列が自動的に運営者へ開示される。
    const wholeTable = await hasTablePrivilege(unextended, 'app_platform', 'tenants', 'SELECT');
    expect(wholeTable, 'tenants: 列 GRANT のみのはずがテーブル単位の GRANT も存在する').toBe(false);

    const disclosedColumn = await hasColumnPrivilege(unextended, 'app_platform', 'tenants', 'id', 'SELECT');
    expect(disclosedColumn, 'tenants.id: app_platform に SELECT 権限が無い').toBe(true);
  });

  it('対照: app_platform は engineers を（列単位で）SELECT できる（§5.5 で開示列に限定されるため hasTablePrivilege は false になる）', async () => {
    // 🔴 engineers は §5.5 の非開示列を除くため列レベル GRANT のみ（テーブル単位の GRANT が無い）。
    //    has_table_privilege はテーブル ACL のみを見るため、開示列がある場合でも false を返す
    //    （④ の「実測」テストが、列 GRANT により実際に SELECT できることを別途確認する）。
    const wholeTable = await hasTablePrivilege(unextended, 'app_platform', 'engineers', 'SELECT');
    expect(wholeTable, 'engineers: 列 GRANT のみのはずがテーブル単位の GRANT も存在する').toBe(false);

    const disclosedColumn = await hasColumnPrivilege(unextended, 'app_platform', 'engineers', 'id', 'SELECT');
    expect(disclosedColumn, 'engineers.id: app_platform に SELECT 権限が無い').toBe(true);
  });
});

describe('③ app_platform_write の書込先が許可リストと一致する（docs/05 §5.2 / §17.2 #5）', () => {
  it('許可リスト外の表には INSERT/UPDATE/DELETE のいずれも無い', async () => {
    const tables = (await readPublicTables(unextended)).filter((t) => !OUT_OF_SCOPE_TABLES.includes(t));
    expect(tables.length).toBeGreaterThan(0); // 空振り防止（対照）

    for (const table of tables) {
      if (table in PLATFORM_WRITE_ALLOWLIST) continue;

      const [insert, del] = await Promise.all([
        hasTablePrivilege(unextended, 'app_platform_write', table, 'INSERT'),
        hasTablePrivilege(unextended, 'app_platform_write', table, 'DELETE'),
      ]);
      expect(insert, `${table}: 許可リスト外への INSERT 権限がある`).toBe(false);
      expect(del, `${table}: 許可リスト外への DELETE 権限がある`).toBe(false);

      const columns = await readTableColumns(unextended, table);
      for (const column of columns) {
        const columnUpdate = await hasColumnPrivilege(
          unextended,
          'app_platform_write',
          table,
          column,
          'UPDATE',
        );
        expect(columnUpdate, `${table}.${column}: 許可リスト外への UPDATE 権限がある`).toBe(false);
      }
    }
  });

  it('許可リスト内の表は、宣言どおりの列だけを書ける（それ以外は書けない）', async () => {
    for (const [table, allowed] of Object.entries(PLATFORM_WRITE_ALLOWLIST)) {
      const [insert, del] = await Promise.all([
        hasTablePrivilege(unextended, 'app_platform_write', table, 'INSERT'),
        hasTablePrivilege(unextended, 'app_platform_write', table, 'DELETE'),
      ]);
      expect(insert, `${table}: INSERT が許可リストと不一致`).toBe(allowed.insert);
      expect(del, `${table}: DELETE が許可リストと不一致`).toBe(allowed.delete);

      const columns = await readTableColumns(unextended, table);
      for (const column of columns) {
        const expectedUpdatable = allowed.updateColumns.includes(column);
        const actual = await hasColumnPrivilege(unextended, 'app_platform_write', table, column, 'UPDATE');
        expect(actual, `${table}.${column}: UPDATE 可否が許可リストと不一致`).toBe(expectedUpdatable);
      }
    }
  });

  /**
   * 🔴 T-03-08 / Issue #24（決定 = 既定値 A）: `app_platform_write` の `tenants` に対する
   *    `SELECT` は `(id, lifecycle_state)` の **2 列ちょうど**である。
   *    テナント開設直後の読み戻し（API-A4 の `INSERT ... RETURNING`）に要る最小であり、
   *    🔴 **行全体・他列に広げてはならない**（広げると `BR-40` の担保が除外リスト頼みになる）。
   */
  it('🔴 app_platform_write の tenants への SELECT は (id, lifecycle_state) の 2 列に限られる', async () => {
    const wholeTable = await hasTablePrivilege(unextended, 'app_platform_write', 'tenants', 'SELECT');
    expect(wholeTable, 'tenants: app_platform_write にテーブル単位の SELECT がある').toBe(false);

    const columns = await readTableColumns(unextended, 'tenants');
    expect(columns.length).toBeGreaterThan(2); // 空振り防止（対照。2 列しかない表ではない）
    for (const column of columns) {
      const expected = (PLATFORM_WRITE_TENANTS_SELECT_COLUMNS as readonly string[]).includes(column);
      const actual = await hasColumnPrivilege(unextended, 'app_platform_write', 'tenants', column, 'SELECT');
      expect(actual, `tenants.${column}: app_platform_write の SELECT 可否が Issue #24 の決定と不一致`).toBe(
        expected,
      );
    }
  });

  it('🔴 app_platform_write は tenants 以外の表を 1 列も SELECT できない（認証経路の 3 表を除く）', async () => {
    // 認証経路（T-03-07。migration 20260904000000）が使う 3 表は別枠である（docs/05 §5.2 の 🔴）。
    const AUTH_PATH_TABLES = ['platform_users', 'two_factor_credentials', 'audit_logs'];
    const tables = (await readPublicTables(unextended)).filter(
      (t) => !OUT_OF_SCOPE_TABLES.includes(t) && t !== 'tenants' && !AUTH_PATH_TABLES.includes(t),
    );
    expect(tables.length).toBeGreaterThan(0); // 空振り防止（対照）

    for (const table of tables) {
      const columns = await readTableColumns(unextended, table);
      for (const column of columns) {
        const actual = await hasColumnPrivilege(unextended, 'app_platform_write', table, column, 'SELECT');
        expect(actual, `${table}.${column}: app_platform_write に SELECT 権限がある`).toBe(false);
      }
    }
  });

  it('engineers（業務テーブル。許可リスト外）には一切の書込権限が無い', async () => {
    const [insert, del] = await Promise.all([
      hasTablePrivilege(unextended, 'app_platform_write', 'engineers', 'INSERT'),
      hasTablePrivilege(unextended, 'app_platform_write', 'engineers', 'DELETE'),
    ]);
    expect(insert).toBe(false);
    expect(del).toBe(false);
    const updatable = await hasColumnPrivilege(unextended, 'app_platform_write', 'engineers', 'display_name', 'UPDATE');
    expect(updatable).toBe(false);
  });
});

describe('app_share_probe は engineer_shares 以外に一切の権限を持たない（docs/05 §4.2 / §4.5）', () => {
  it('現行スキーマの業務テーブル（tenants / engineers）に SELECT すら持たない', async () => {
    for (const table of ['tenants', 'engineers']) {
      const select = await hasTablePrivilege(unextended, 'app_share_probe', table, 'SELECT');
      expect(select, `${table}: app_share_probe に SELECT 権限がある`).toBe(false);
    }
  });
});

/**
 * 🔴 T-02-08（code-reviewer 指摘 1-③）: app_assignment_owner_probe の権限が
 * engineers.tenant_id / id / owner_partner_company_id の 3 列 SELECT だけであることを
 * `information_schema.role_table_grants` / `role_column_grants` の走査で確認する（docs/05 §4.2 / §4.4.1）。
 *
 * 🔴 `migrator`（`app_migrator`）接続で読むこと。`role_table_grants` / `role_column_grants` は
 * 「現在の接続ロールが grantor / grantee のいずれかである GRANT だけ」を返す
 * （PostgreSQL の仕様。`information_schema.columns` が呼び出し元の権限でフィルタされるのと同じ理由。
 * `readTableColumns` の JSDoc 参照）。`GRANT SELECT (...) ON engineers TO app_assignment_owner_probe`
 * を実行したのは migration（`app_migrator` 接続）であり、`app_migrator` が grantor になる。
 * `unextended`（`app_tenant` 接続）で読むと 0 行になり、空振りで PASS してしまう。
 */
describe('app_assignment_owner_probe は engineers の 3 列（tenant_id/id/owner_partner_company_id）の SELECT だけを持つ（docs/05 §4.2 / §4.4.1）', () => {
  it('role_table_grants にこのロール宛の行が無い（テーブル単位の GRANT を一切持たない。列単位の GRANT のみ）', async () => {
    const rows = await migrator.$queryRaw<Array<{ table_name: string; privilege_type: string }>>`
      SELECT table_name, privilege_type
      FROM information_schema.role_table_grants
      WHERE grantee = 'app_assignment_owner_probe'`;
    expect(rows).toEqual([]);
  });

  it('role_column_grants は engineers.id / owner_partner_company_id / tenant_id の SELECT だけ', async () => {
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
});

// docs/05 §5.5「運営者に対するマスキング（二層）」第 1 層 = 列単位の GRANT。
// `CLAUDE.md` §10.5「運営者にも見せないもの: エンジニアの氏名 …」/ `BR-40` の実装担保。
// 🔴 T-02-09 申し送り 3 / T-03-08: 許可リスト・非開示リストとも
//    tests/isolation/support/platform-grants.ts に単一出所化した
//    （roles.test.ts と rls-enforced.test.ts の両方が同じ一覧を実測する）。
// 🔴 T-03-08: 3 表だけだった許可リストを **52 表すべて**へ広げ、`'ALL'`（テーブル単位 GRANT）を
//    廃止した。テーブル単位の GRANT が 1 つでも残っていると「後から追加した列が自動的に
//    運営者へ開示される」ため、§5.5 の「書き忘れても漏れない」が成立しない。

describe('④ app_platform への SELECT は §5.5 の非開示列を除外している（CLAUDE.md §10.5）', () => {
  it('カタログ走査: app_platform への SELECT は許可リストの宣言と一致する（許可リスト外の表は全列 0 件）', async () => {
    const tables = (await readPublicTables(unextended)).filter((t) => !OUT_OF_SCOPE_TABLES.includes(t));
    expect(tables.length).toBeGreaterThan(0); // 空振り防止（対照）

    let checkedColumns = 0;
    for (const table of tables) {
      const allowed = PLATFORM_READ_COLUMN_ALLOWLIST[table];
      const columns = await readTableColumns(unextended, table);
      expect(columns.length).toBeGreaterThan(0); // 空振り防止（対照）

      for (const column of columns) {
        checkedColumns += 1;
        const expectedSelectable = allowed !== undefined && allowed.includes(column);
        const actual = await hasColumnPrivilege(unextended, 'app_platform', table, column, 'SELECT');
        expect(
          actual,
          `${table}.${column}: SELECT 可否が許可リストと不一致（許可リスト = ${JSON.stringify(allowed ?? null)}）`,
        ).toBe(expectedSelectable);
      }
    }
    expect(checkedColumns).toBeGreaterThan(0); // 空振り防止（対照）
  });

  it('🔴 許可リストは 52 表すべてを覆う（走査の母集団と 1 対 1。表の追加を取りこぼさない）', async () => {
    const tables = (await readPublicTables(unextended)).filter((t) => !OUT_OF_SCOPE_TABLES.includes(t));
    // 🔴 partitioned table の子パーティションは readPublicTables に含まれうるため、
    //    「許可リストに無い表」ではなく「母集団に無い許可リスト項目」を見る向きで検査する。
    const population = new Set(tables);
    const stale = Object.keys(PLATFORM_READ_COLUMN_ALLOWLIST).filter((t) => !population.has(t));
    expect(stale, '許可リストに、実在しない表が残っている').toEqual([]);
    expect(Object.keys(PLATFORM_READ_COLUMN_ALLOWLIST)).toHaveLength(52);
  });

  it('🔴 テーブル単位の GRANT SELECT を持つ表が 1 つも無い（§5.5「列を列挙して GRANT する」）', async () => {
    const rows = await migrator.$queryRaw<Array<{ table_name: string; privilege_type: string }>>`
      SELECT table_name, privilege_type
      FROM information_schema.role_table_grants
      WHERE grantee = 'app_platform' AND privilege_type = 'SELECT'
      ORDER BY table_name`;
    expect(rows, 'app_platform にテーブル単位の SELECT が残っている（新しい列が自動的に開示される）').toEqual([]);
  });

  it('固定リスト走査: §5.5 の非開示列に SELECT 権限が無い（denylist の実測。has_column_privilege）', async () => {
    let checkedCount = 0;
    for (const [table, deniedColumns] of Object.entries(PLATFORM_READ_COLUMN_DENYLIST)) {
      for (const column of deniedColumns) {
        checkedCount += 1;
        const has = await hasColumnPrivilege(unextended, 'app_platform', table, column, 'SELECT');
        expect(has, `${table}.${column}: app_platform に SELECT 権限がある（§5.5 違反）`).toBe(false);
      }
    }
    expect(checkedCount).toBeGreaterThan(0); // 空振り防止（対照）
  });

  it('対照: engineers の開示列（id）には SELECT 権限がある（非開示列テストが空振りでない）', async () => {
    const has = await hasColumnPrivilege(unextended, 'app_platform', 'engineers', 'id', 'SELECT');
    expect(has, 'engineers.id: app_platform に SELECT 権限が無い（テーブルごと塞がっている）').toBe(true);
  });

  it('実測: app_platform 接続 + 両 GUC 設定でも SELECT display_name FROM engineers は permission denied になる', async () => {
    const platform = createUnextendedClient(database.platformUrl);
    try {
      await expect(
        platform.$transaction(async (tx) => {
          // withPlatformRead（T-03-08）が発行する 2 つの GUC を模す。RLS が行を返す状態でも
          // 列 GRANT がブロックすること（RLS が偶然 0 件だから読めていないだけ、ではないこと）を示す。
          await tx.$queryRaw`SELECT
            set_config('app.platform_user_id', 'platform-read-probe', true),
            set_config('app.target_tenant_id', '', true)`;
          return tx.$queryRaw<Array<{ display_name: string }>>`SELECT display_name FROM engineers`;
        }),
      ).rejects.toThrow(/permission denied/i);
    } finally {
      await platform.$disconnect();
    }
  });

  it('対照: 同じ GUC 設定で開示列（id）は読める（上のテストがクエリ全体の失敗ではないこと）', async () => {
    const platform = createUnextendedClient(database.platformUrl);
    try {
      const rows = await platform.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT
          set_config('app.platform_user_id', 'platform-read-probe', true),
          set_config('app.target_tenant_id', '', true)`;
        return tx.$queryRaw<Array<{ id: string }>>`SELECT id FROM engineers`;
      });
      expect(rows.length).toBeGreaterThan(0);
    } finally {
      await platform.$disconnect();
    }
  });
});
