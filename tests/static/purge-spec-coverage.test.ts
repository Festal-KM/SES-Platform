// tests/static/purge-spec-coverage.test.ts
// 🔴 docs/05 §17.2 #12（T-10-09。`F-064 AC-3`「残す範囲と消す範囲が設定として明示され、暗黙に全件削除・全件保持のいずれにもならない」）:
//    `schema.prisma` の**全業務テーブル**（射程外 4 表と `_prisma_migrations`、射影ビュー 4 本を除く）が
//    `PURGE_SPEC.delete` / `PURGE_SPEC.retain` の**どちらか一方に必ず現れる**ことをカタログ走査で検証する。
//
// なぜ静的テストか: 表を 1 つ足したときに `PURGE_SPEC` を更新し忘れると、その表の個人情報は `PURGED` でも消えない
//   （「暗黙の全件保持」）。逆に spec に無い表名を書いても消えない（「消したつもり」）。どちらも DB を起動する前に構造で捕まえる。
//   走査は `schema.prisma` の `@@map`（`platform-grants-consistency.test.ts` と同じ読み方）であり、表名を列挙しない。
//
// 🔴 あわせて次を固定する:
//   ① `delete` の列（`columns` / `objectKeyColumns` / `purgedAtColumn`）が実在の列を指す（存在しない列名は UPDATE が落ちる）
//   ② NOT NULL の列は消去値（`erase`）を持ち、NULL 許容の列は文字列で書かれている（NOT NULL に NULL を書くと実行時に落ちる）
//   ③ 個人情報を含む代表列（連絡先 / 生年月日 / 原本 / 本文 / 添付 / 凍結 PII / 抽出結果 / メールアドレス / 氏名 / 電話番号）が
//      `delete` にあり、`retain` の表には含まれない（`F-064 AC-2` / `CLAUDE.md` §3.5）
//   ④ 削除スコープの追加ポリシー（migration 20260927000000 ④）が並べる表の集合と `PURGE_SPEC.delete` の表の集合が一致する
//      （spec に表を足したのにポリシーを足し忘れると、その表の取引先所有行に削除が届かない）
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  isPurgeRowsSpec,
  PURGE_SPEC,
  purgeColumnErasure,
  purgeColumnName,
  type PurgeDeleteSpec,
} from '../../packages/config/src/retention.js';
import { TENANT_SCOPE_EXCLUDED_MODELS } from '../../packages/db/src/scope-injection.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..', '..');
const SCHEMA_PATH = path.join(repoRoot, 'packages', 'db', 'prisma', 'schema.prisma');
const PURGE_MIGRATION_PATH = path.join(
  repoRoot,
  'packages',
  'db',
  'prisma',
  'migrations',
  '20260927000000_tenant_purge',
  'migration.sql',
);

type ColumnInfo = { readonly nullable: boolean };
type TableInfo = { readonly model: string; readonly isView: boolean; readonly columns: ReadonlyMap<string, ColumnInfo> };

/** `schema.prisma` の `model` ブロックを表名（`@@map`）→ 列（`@map` または項目名 / NULL 許容）に写す。リレーション項目は除く。 */
function readSchemaTables(): ReadonlyMap<string, TableInfo> {
  const text = readFileSync(SCHEMA_PATH, 'utf8');
  const modelPattern = /^model\s+(\w+)\s*\{([\s\S]*?)^\}/gm;
  const blocks: Array<{ model: string; body: string }> = [];
  for (const match of text.matchAll(modelPattern)) blocks.push({ model: match[1]!, body: match[2]! });
  const modelNames = new Set(blocks.map((b) => b.model));
  const tables = new Map<string, TableInfo>();
  for (const { model, body } of blocks) {
    const table = body.match(/@@map\("([^"]+)"\)/)?.[1] ?? model;
    const columns = new Map<string, ColumnInfo>();
    for (const rawLine of body.split('\n')) {
      const line = rawLine.trim();
      if (line === '' || line.startsWith('//') || line.startsWith('@@')) continue;
      const fieldMatch = line.match(/^(\w+)\s+([\w.]+)(\[\])?(\?)?/);
      if (fieldMatch === null) continue;
      const [, field, type, , optional] = fieldMatch;
      if (modelNames.has(type!)) continue;
      columns.set(line.match(/@map\("([^"]+)"\)/)?.[1] ?? field!, { nullable: optional === '?' });
    }
    // 射影ビュー（docs/05 §4.9）は `view` ブロックで宣言されており `model` の走査には現れない。`_v` は念のための保険。
    tables.set(table, { model, isView: /_v$/.test(table), columns });
  }
  return tables;
}

/** 射程外 4 表（`TENANT_SCOPE_EXCLUDED_MODELS`。`CLAUDE.md` §3.1）の表名。モデル名から `@@map` を引く。 */
function outOfScopeTables(tables: ReadonlyMap<string, TableInfo>): ReadonlySet<string> {
  const excluded = new Set<string>(TENANT_SCOPE_EXCLUDED_MODELS);
  const names = new Set<string>();
  for (const [table, info] of tables) if (excluded.has(info.model)) names.add(table);
  return names;
}

const tables = readSchemaTables();
const outOfScope = outOfScopeTables(tables);
const businessTables = [...tables.entries()]
  .filter(([table, info]) => !info.isView && !outOfScope.has(table) && table !== '_prisma_migrations')
  .map(([table]) => table)
  .sort();
const deleteTables: string[] = PURGE_SPEC.delete.map((spec) => spec.table).sort();
const retainTables: string[] = PURGE_SPEC.retain.map((spec) => spec.table).sort();

/** 🔴 個人情報を含む代表列（`F-064 AC-2` / `CLAUDE.md` §3.5 / T-10-09 の指示）。`retain` の表に 1 つも残さない。 */
const PII_COLUMNS: ReadonlyArray<readonly [table: string, column: string]> = [
  ['engineers', 'contact_email'],
  ['engineers', 'contact_phone'],
  ['engineers', 'birth_date'],
  ['engineers', 'display_name'],
  ['engineers', 'affiliation_label'],
  ['skill_sheets', 'object_key'],
  ['skill_sheet_extractions', 'payload'],
  ['engineer_careers', 'description'],
  ['engineer_snapshots', 'display_name'],
  ['engineer_snapshots', 'careers'],
  ['messages', 'body'],
  ['messages', 'attachment_key'],
  ['proposal_events', 'attachment_key'],
  ['invitations', 'email'],
  ['users', 'email'],
  ['users', 'display_name'],
  ['partner_companies', 'contact_email'],
  ['proposals', 'recipient_email'],
  ['email_dispatches', 'recipient_email'],
  ['contract_documents', 'object_key'],
  ['data_export_requests', 'object_key'],
];

function deleteSpecOf(table: string): PurgeDeleteSpec | undefined {
  return (PURGE_SPEC.delete as readonly PurgeDeleteSpec[]).find((spec) => spec.table === table);
}

function erasedColumnsOf(spec: PurgeDeleteSpec): readonly string[] {
  return isPurgeRowsSpec(spec) ? [...(tables.get(spec.table)?.columns.keys() ?? [])] : spec.columns.map(purgeColumnName);
}

describe('🔴 docs/05 §17.2 #12: 全業務テーブルが PURGE_SPEC.delete / .retain のどちらかに現れる（F-064 AC-3。T-10-09）', () => {
  it('対照: schema.prisma の読み取りが空振りしていない（射程外 4 表を除いて 50 表以上。`view` ブロックは model の走査に現れない）', () => {
    expect(outOfScope).toEqual(new Set(['skills', 'plans', 'subscriptions', 'platform_users']));
    expect([...tables.entries()].filter(([, info]) => info.isView)).toHaveLength(0);
    expect(businessTables.length).toBeGreaterThan(50);
    expect(tables.get('engineers')?.columns.get('contact_email')).toEqual({ nullable: true });
    expect(tables.get('messages')?.columns.get('body')).toEqual({ nullable: true });
    expect(tables.get('users')?.columns.get('email')).toEqual({ nullable: false });
  });

  it('🔴 業務テーブルの集合 = delete ∪ retain（欠けも余りも無い）', () => {
    expect([...deleteTables, ...retainTables].sort()).toEqual(businessTables);
  });

  it('🔴 delete と retain の交差が空集合で、それぞれに重複が無い', () => {
    expect(deleteTables.filter((table) => retainTables.includes(table))).toEqual([]);
    expect(new Set(deleteTables).size).toBe(deleteTables.length);
    expect(new Set(retainTables).size).toBe(retainTables.length);
  });

  it('① delete の列（columns / objectKeyColumns / purgedAtColumn）が schema.prisma の実在の列を指す', () => {
    const missing: string[] = [];
    for (const spec of PURGE_SPEC.delete as readonly PurgeDeleteSpec[]) {
      const columns = tables.get(spec.table)?.columns;
      if (columns === undefined) {
        missing.push(`${spec.table}（表が無い）`);
        continue;
      }
      if (isPurgeRowsSpec(spec)) continue;
      for (const column of spec.columns) if (!columns.has(purgeColumnName(column))) missing.push(`${spec.table}.${purgeColumnName(column)}`);
      for (const column of spec.objectKeyColumns ?? []) if (!columns.has(column)) missing.push(`${spec.table}.${column}（objectKeyColumns）`);
      if (spec.purgedAtColumn !== undefined && !columns.has(spec.purgedAtColumn)) missing.push(`${spec.table}.${spec.purgedAtColumn}（purgedAtColumn）`);
    }
    expect(missing).toEqual([]);
  });

  it('② NOT NULL の列は消去値（erase）を持ち、NULL 許容の列は NULL 化（文字列）で書かれている', () => {
    const offenders: string[] = [];
    for (const spec of PURGE_SPEC.delete as readonly PurgeDeleteSpec[]) {
      if (isPurgeRowsSpec(spec)) continue;
      for (const column of spec.columns) {
        const info = tables.get(spec.table)?.columns.get(purgeColumnName(column));
        if (info === undefined) continue;
        const erase = purgeColumnErasure(column);
        if (!info.nullable && erase === null) offenders.push(`${spec.table}.${purgeColumnName(column)}: NOT NULL なのに NULL 化`);
        if (info.nullable && erase !== null) offenders.push(`${spec.table}.${purgeColumnName(column)}: NULL 許容なのに ${erase}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('🔴 ③ 個人情報を含む代表列が delete にあり、retain の表に含まれない', () => {
    const missing: string[] = [];
    for (const [table, column] of PII_COLUMNS) {
      expect(retainTables, `${table} が retain にある`).not.toContain(table);
      const spec = deleteSpecOf(table);
      if (spec === undefined || !erasedColumnsOf(spec).includes(column)) missing.push(`${table}.${column}`);
    }
    expect(missing).toEqual([]);
  });

  it('retain の全要素が理由（reason）と RETAIN_ALL を持つ', () => {
    for (const spec of PURGE_SPEC.retain) {
      expect(spec.policy).toBe('RETAIN_ALL');
      expect(spec.reason.length, spec.table).toBeGreaterThan(2);
    }
  });

  it('🔴 F-064 AC-9: 環境で削除を止める / 期限を延ばす設定項目が packages/config の env スキーマに無い', () => {
    const schema = readFileSync(path.join(repoRoot, 'packages', 'config', 'src', 'schema.ts'), 'utf8');
    const keys = [...schema.matchAll(/^\s+([A-Z][A-Z0-9_]*)\s*:/gm)].map((m) => m[1]!);
    const related = keys.filter((key) => /PURGE|RETENTION|CLOSING/.test(key)).sort();
    // 猶予日数と保持年数の 2 つ（どちらも全環境で同じ既定値。環境名を含むキーは無い）と、
    // T-12-17 ⑱ の `PURGE_RUN_STALL_ALERT_MINUTES`（`A-005` 項目 7 に `RUNNING` の滞留を載せるまでの分数 = **監視の閾値**。
    // 削除を止める / 期限を延ばす効果は無く、読むのは `apps/web/lib/db/bootstrap.ts` の `monitoringThresholdsRuntime()` だけ）。
    expect(related).toEqual(['PII_RETENTION_YEARS', 'PURGE_RUN_STALL_ALERT_MINUTES', 'TENANT_PURGE_GRACE_DAYS']);
    // 🔴 監視の閾値が削除の経路（worker の `tenant-purge*.ts` / `packages/db` の purge 実装）から読まれていない。
    const purgeSources = ['apps/worker/src/jobs/tenant-purge.ts', 'apps/worker/src/jobs/tenant-purge-scan.ts', 'packages/db/src/tenant-purge.ts'];
    for (const source of purgeSources) {
      const full = path.join(repoRoot, source);
      if (!existsSync(full)) continue;
      expect(readFileSync(full, 'utf8'), source).not.toContain('PURGE_RUN_STALL_ALERT_MINUTES');
    }
    expect(keys.filter((key) => /(SANDBOX|DEMO|STAGING).*(PURGE|RETENTION)|(PURGE|RETENTION).*(SANDBOX|DEMO|STAGING)|SKIP_PURGE|DISABLE_PURGE/.test(key))).toEqual([]);
  });

  it('🔴 ④ 削除スコープの追加ポリシー（migration 20260927000000）の表の集合が PURGE_SPEC.delete の表と一致する', () => {
    const sql = readFileSync(PURGE_MIGRATION_PATH, 'utf8');
    const array = /FOREACH t IN ARRAY ARRAY\[([\s\S]*?)\]\s+LOOP/.exec(sql);
    expect(array, 'FOREACH の表配列が見つからない').not.toBeNull();
    const policyTables = [...(array?.[1] ?? '').matchAll(/'([a-z_]+)'/g)].map((m) => m[1]!).sort();
    expect(policyTables).toEqual(deleteTables);
    // DELETE のポリシーは rows: 'ALL' の表だけ。
    const deletePolicies = [...sql.matchAll(/CREATE POLICY (\w+)_purge_scope_delete ON (\w+)/g)].map((m) => m[2]!).sort();
    expect(deletePolicies).toEqual(PURGE_SPEC.delete.filter(isPurgeRowsSpec).map((spec) => spec.table).sort());
  });
});
