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
};

let database: IsolationDatabase;
let unextended: UnextendedClient;

beforeAll(async () => {
  database = await startIsolationDatabase();
  unextended = createUnextendedClient(database.tenantUrl);
}, SETUP_TIMEOUT_MS);

afterAll(async () => {
  await unextended?.$disconnect();
  await database?.stop();
}, SETUP_TIMEOUT_MS);

describe('① 5 ロールすべてが BYPASSRLS を持たない（docs/05 §4.2）', () => {
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

describe('② app_platform は業務テーブルへの書込権限を 0 件持つ（docs/05 §4.2 / §5.2）', () => {
  it('SELECT 以外（INSERT/UPDATE/DELETE）がすべて 0 件', async () => {
    const tables = (await readPublicTables(unextended)).filter((t) => !OUT_OF_SCOPE_TABLES.includes(t));
    expect(tables.length).toBeGreaterThan(0); // 空振り防止（対照）

    for (const table of tables) {
      const [insert, del] = await Promise.all([
        hasTablePrivilege(unextended, 'app_platform', table, 'INSERT'),
        hasTablePrivilege(unextended, 'app_platform', table, 'DELETE'),
      ]);
      expect(insert, `${table}: app_platform に INSERT 権限がある`).toBe(false);
      expect(del, `${table}: app_platform に DELETE 権限がある`).toBe(false);

      const columns = await readTableColumns(unextended, table);
      for (const column of columns) {
        const columnUpdate = await hasColumnPrivilege(unextended, 'app_platform', table, column, 'UPDATE');
        expect(columnUpdate, `${table}.${column}: app_platform に UPDATE 権限がある`).toBe(false);
      }
    }
  });

  it('対照: app_platform は tenants を（テーブル単位で）SELECT できる（0 件書込が「何も見えていない」からではない）', async () => {
    const select = await hasTablePrivilege(unextended, 'app_platform', 'tenants', 'SELECT');
    expect(select, 'tenants: app_platform に SELECT 権限が無い').toBe(true);
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
 * docs/05 §5.5「運営者に対するマスキング（二層）」第 1 層 = 列単位の GRANT。
 * `CLAUDE.md` §10.5「運営者にも見せないもの: エンジニアの氏名 …」の実装担保。
 * SP-02 で §5.5 の非開示列が実在するようになった表を追記する。`skill_sheets` /
 * `skill_sheet_extractions` / `projects` は本タスク（T-02-02）時点で `app_platform` への
 * GRANT が 0 件（010_rls.sql 未追記）だが、それは「④ カタログ走査」テストが表単位で
 * 検出する話であり、本リストは §5.5 の非開示列一覧そのものと突き合わせる独立防御である。
 * 将来 GRANT を追加したときに §5.5 の見落とし（開示してはいけない列まで開けてしまう）を
 * 検知するのが目的なので、GRANT が無い今の時点でも追記しておく。
 * 追記を忘れても他のテストが自動で検知するわけではない
 * （§5.5 の表自体が唯一の真実であり、ここは実測用の固定リストである）。
 */
const PLATFORM_READ_COLUMN_DENYLIST: Record<string, readonly string[]> = {
  engineers: [
    'display_name',
    'birth_date',
    'contact_email',
    'contact_phone',
    'affiliation_label',
    'city',
    'preference_note',
  ],
  skill_sheets: ['object_key'],
  skill_sheet_extractions: ['payload'],
  projects: ['end_client_name', 'internal_unit_price'],
  // 🔴 T-02-03（docs/05 §3.6 / §5.5）: proposals / engineer_snapshots / proposal_events /
  //    review_gates / proposal_requests に新たに非開示列が実在するようになった。GRANT は
  //    T-02-06/07 の範囲だが、追加を忘れると将来 GRANT を足したときに §5.5 の見落としを
  //    検知できないため、GRANT が無い今の時点でも追記しておく（既存コメントと同じ方針）。
  engineer_snapshots: ['display_name', 'affiliation_label', 'skills', 'careers'],
  proposals: ['subject', 'body', 'draft_body', 'recipient_email'],
  proposal_events: ['note', 'attachment_key'],
  review_gates: ['findings', 'ai_warnings'],
  proposal_requests: ['message', 'decline_reason'],
};

/**
 * docs/05 §5.5 第 1 層の許可リスト（唯一の真実）。`app_platform` に SELECT を許す列を宣言する。
 * `'ALL'` はテーブル全体（列レベル GRANT ではなくテーブル単位 GRANT）を意味し、
 * `readonly string[]` は列挙した列だけを意味する。**許可リストに無い表は SELECT 0 件**
 * （全列 false）を要求する。現行スキーマ（tenants / engineers の 2 表）は
 * `010_rls.sql` の GRANT と一致させてある。
 *
 * ③（書込側 `PLATFORM_WRITE_ALLOWLIST`）と対称の役割: SP-02 で表・列が増えたとき、
 * docs/05 §5.5 の非開示列一覧と照合してからここへ追記しないと、次の「カタログ走査」テストが
 * 新表 / 新列を「許可リスト外 = SELECT 不可のはず」として検出し、GRANT を足した瞬間に落ちる。
 */
const PLATFORM_READ_ALLOWLIST: Record<string, 'ALL' | readonly string[]> = {
  tenants: 'ALL',
  engineers: ['id', 'tenant_id', 'owner_partner_company_id', 'created_at', 'updated_at'],
};

describe('④ app_platform への SELECT は §5.5 の非開示列を除外している（CLAUDE.md §10.5）', () => {
  it('カタログ走査: app_platform への SELECT は許可リストの宣言と一致する（許可リスト外の表は全列 0 件）', async () => {
    const tables = (await readPublicTables(unextended)).filter((t) => !OUT_OF_SCOPE_TABLES.includes(t));
    expect(tables.length).toBeGreaterThan(0); // 空振り防止（対照）

    let checkedColumns = 0;
    for (const table of tables) {
      const allowed = PLATFORM_READ_ALLOWLIST[table];
      const columns = await readTableColumns(unextended, table);
      expect(columns.length).toBeGreaterThan(0); // 空振り防止（対照）

      for (const column of columns) {
        checkedColumns += 1;
        const expectedSelectable = allowed === 'ALL' || (Array.isArray(allowed) && allowed.includes(column));
        const actual = await hasColumnPrivilege(unextended, 'app_platform', table, column, 'SELECT');
        expect(
          actual,
          `${table}.${column}: SELECT 可否が許可リストと不一致（許可リスト = ${JSON.stringify(allowed ?? null)}）`,
        ).toBe(expectedSelectable);
      }
    }
    expect(checkedColumns).toBeGreaterThan(0); // 空振り防止（対照）
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
