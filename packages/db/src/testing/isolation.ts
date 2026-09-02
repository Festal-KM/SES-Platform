// packages/db/src/testing/isolation.ts
// 🔴 分離機構が「有効であること自体」を検証する結合テスト（docs/05 §4.7）専用の入口。
//    アプリコードから import してはならない。
//
//    docs/05 §4.7 の二重防御テスト #1〜#3 は、その性質上
//    「拡張を外したクライアント」と「RLS を落とした DB」を作らなければ書けない。
//    それでも生 PrismaClient と生 SQL を packages/db の外へ出さないために、
//    必要な操作だけをここで名前付きの関数として公開する
//    （docs/05 §2.2「$queryRaw / $executeRaw の例外は packages/db/src/** のみ」）。
//
//    🔴 汎用のエスケープハッチにしない。ここに「任意の SQL を実行する」関数を足さないこと。
//    T-01-06 の ESLint（生 PrismaClient の import 禁止）を入れる際に、
//    このサブパス（`@ses/db/testing`）の import 元を `tests/isolation/**` に限定する。
import { Prisma, PrismaClient } from '@prisma/client';
import { tenantScopeSettingsSql, type TenantScopeSettings } from '../scope-settings.js';

export type UnextendedClient = PrismaClient;

/** 生の（拡張を適用していない）トランザクションクライアント。 */
export type UnextendedTransactionClient = Parameters<
  Parameters<PrismaClient['$transaction']>[0]
>[0];

type RawQueryable = Pick<PrismaClient, '$queryRaw'>;

const SAFE_IDENTIFIER = /^[a-z_][a-z0-9_]*$/;

function assertSafeIdentifiers(names: readonly string[]): void {
  const invalid = names.filter((name) => !SAFE_IDENTIFIER.test(name));
  if (invalid.length > 0) {
    throw new Error(`識別子として受け付けられません: ${invalid.join(', ')}`);
  }
}

/**
 * 二重防御テスト #1 / #2 用: Prisma Client Extension を適用しない素のクライアント。
 * 🔴 接続に使うのは `app_tenant` ロール（`BYPASSRLS` を持たない）であること。
 */
export function createUnextendedClient(datasourceUrl: string): UnextendedClient {
  return new PrismaClient({ datasourceUrl });
}

/**
 * 素のクライアントでトランザクションを開き、`scope` が渡されたときだけ
 * `withTenant` と同じ `SET LOCAL` を発行する。
 * `scope` に `null` を渡すと二重防御テスト #2（`SET LOCAL` を発行しない）になる。
 */
export async function runUnextended<T>(
  client: UnextendedClient,
  scope: TenantScopeSettings | null,
  fn: (tx: UnextendedTransactionClient) => Promise<T>,
): Promise<T> {
  return client.$transaction(async (tx) => {
    if (scope !== null) {
      await tx.$queryRaw(tenantScopeSettingsSql(scope));
    }
    return fn(tx);
  });
}

/**
 * 二重防御テスト #3 用: RLS を一時的に落とす / 戻す。
 * 🔴 テーブル所有者（`app_migrator`）の接続文字列でしか実行できない。
 */
export async function setRowLevelSecurity(options: {
  readonly ownerDatasourceUrl: string;
  readonly tables: readonly string[];
  readonly enabled: boolean;
}): Promise<void> {
  assertSafeIdentifiers(options.tables);
  const owner = new PrismaClient({ datasourceUrl: options.ownerDatasourceUrl });
  try {
    for (const table of options.tables) {
      const action = Prisma.raw(options.enabled ? 'ENABLE' : 'DISABLE');
      await owner.$executeRaw`ALTER TABLE ${Prisma.raw(table)} ${action} ROW LEVEL SECURITY`;
    }
  } finally {
    await owner.$disconnect();
  }
}

export type TableRlsStatus = {
  readonly table: string;
  readonly rlsEnabled: boolean;
  readonly rlsForced: boolean;
};

export type RoleBypassRlsStatus = {
  readonly role: string;
  readonly bypassRls: boolean;
};

/**
 * 🔴 対照用。二重防御テストが「そもそも RLS が有効でなかったから 0 件だった」等の
 * 空振りになっていないことを確かめるために、カタログの実値を読む（docs/05 §4.7）。
 */
export async function readTableRlsStatus(
  client: RawQueryable,
  tables: readonly string[],
): Promise<TableRlsStatus[]> {
  assertSafeIdentifiers(tables);
  const rows = await client.$queryRaw<
    Array<{ relname: string; relrowsecurity: boolean; relforcerowsecurity: boolean }>
  >(Prisma.sql`
    SELECT c.relname, c.relrowsecurity, c.relforcerowsecurity
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relkind IN ('r', 'p')
      AND c.relname IN (${Prisma.join([...tables])})
    ORDER BY c.relname`);
  return rows.map((row) => ({
    table: row.relname,
    rlsEnabled: row.relrowsecurity,
    rlsForced: row.relforcerowsecurity,
  }));
}

/** 🔴 対照用。`app_tenant` が `BYPASSRLS` を持たないこと（docs/05 §4.2）。 */
export async function readRoleBypassRls(
  client: RawQueryable,
  roles: readonly string[],
): Promise<RoleBypassRlsStatus[]> {
  assertSafeIdentifiers(roles);
  const rows = await client.$queryRaw<Array<{ rolname: string; rolbypassrls: boolean }>>(
    Prisma.sql`
      SELECT rolname, rolbypassrls FROM pg_roles
      WHERE rolname IN (${Prisma.join([...roles])})
      ORDER BY rolname`,
  );
  return rows.map((row) => ({ role: row.rolname, bypassRls: row.rolbypassrls }));
}

/**
 * 🔴 T-01-05（docs/05 §4.2 / §5.2 / §17.2 #5）: `public` スキーマの全テーブル名を
 * カタログから走査する（列挙しない。docs/05 §4.7 と同じ方針）。
 */
export async function readPublicTables(client: RawQueryable): Promise<string[]> {
  const rows = await client.$queryRaw<Array<{ relname: string }>>(Prisma.sql`
    SELECT c.relname
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p')
    ORDER BY c.relname`);
  return rows.map((row) => row.relname);
}

/**
 * `has_table_privilege(role, table, privilege)`。ANY の接続ロールから、他ロールの
 * テーブル権限を調べられる（GRANT の可視性は接続ロールに依存しない。pg_class.relacl は
 * 誰からでも読めるメタデータのため）。列レベルのみの GRANT（例: `UPDATE (col)`）は
 * ここでは `false` になる（`hasColumnPrivilege` で見る）。
 */
export async function hasTablePrivilege(
  client: RawQueryable,
  role: string,
  table: string,
  privilege: 'SELECT' | 'INSERT' | 'UPDATE' | 'DELETE',
): Promise<boolean> {
  const rows = await client.$queryRaw<Array<{ has: boolean }>>(
    Prisma.sql`SELECT has_table_privilege(${role}, ${table}, ${privilege}) AS has`,
  );
  return rows[0]?.has ?? false;
}

/** `has_column_privilege(role, table, column, privilege)`。列レベル GRANT の有無を調べる。 */
export async function hasColumnPrivilege(
  client: RawQueryable,
  role: string,
  table: string,
  column: string,
  privilege: 'SELECT' | 'INSERT' | 'UPDATE',
): Promise<boolean> {
  const rows = await client.$queryRaw<Array<{ has: boolean }>>(
    Prisma.sql`SELECT has_column_privilege(${role}, ${table}, ${column}, ${privilege}) AS has`,
  );
  return rows[0]?.has ?? false;
}

/**
 * 指定テーブルの全列名を取得する（列挙しない）。
 *
 * 🔴 T-02-01: `information_schema.columns` は「呼び出し元ロールがその列に何らかの権限を
 *    持つ列だけ」を返す（PostgreSQL の仕様。`pg_has_role` / `has_column_privilege` による
 *    可視性フィルタが view 定義に組み込まれている）。RLS の C0〜C8 本適用前（T-02-06 前）の
 *    表は `app_tenant` へ何も GRANT していないため、`information_schema.columns` は 0 行を
 *    返し、カタログ走査テスト（roles.test.ts ②〜④）が「空振り防止」の対照で落ちる。
 *    `pg_attribute` は呼び出し元の権限に関わらずメタデータとして常に読めるため、
 *    カタログ走査の土台としてはこちらが正しい（`hasColumnPrivilege` 側で権限の有無を別途判定する）。
 */
export async function readTableColumns(client: RawQueryable, table: string): Promise<string[]> {
  const rows = await client.$queryRaw<Array<{ attname: string }>>(Prisma.sql`
    SELECT a.attname
    FROM pg_attribute a
    JOIN pg_class c ON c.oid = a.attrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relname = ${table}
      AND a.attnum > 0
      AND NOT a.attisdropped
    ORDER BY a.attnum`);
  return rows.map((row) => row.attname);
}

export type ScopeSettingsSnapshot = {
  readonly tenantId: string;
  readonly partnerCompanyId: string;
  readonly actorUserId: string;
  readonly sharedScope: string;
};

/**
 * 現在の接続に設定されている `app.*` を読む。
 * 🔴 「トランザクションの先頭で発行されていること」と
 *    「トランザクションを抜けたら残っていないこと」の両方の検証に使う（docs/05 §4.3 規約 1）。
 *    未設定の GUC は空文字で返る（`current_setting(..., true)`）。
 */
export async function readScopeSettings(client: RawQueryable): Promise<ScopeSettingsSnapshot> {
  const rows = await client.$queryRaw<
    Array<{
      tenant_id: string | null;
      partner_company_id: string | null;
      actor_user_id: string | null;
      shared_scope: string | null;
    }>
  >(Prisma.sql`
    SELECT
      current_setting('app.tenant_id', true)          AS tenant_id,
      current_setting('app.partner_company_id', true) AS partner_company_id,
      current_setting('app.actor_user_id', true)      AS actor_user_id,
      current_setting('app.shared_scope', true)       AS shared_scope`);
  const row = rows[0];
  return {
    tenantId: row?.tenant_id ?? '',
    partnerCompanyId: row?.partner_company_id ?? '',
    actorUserId: row?.actor_user_id ?? '',
    sharedScope: row?.shared_scope ?? '',
  };
}
