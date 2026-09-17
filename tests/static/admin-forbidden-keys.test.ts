// tests/static/admin-forbidden-keys.test.ts
// 🔴 T-11-07（docs/05 §5.5 第 2 層 / §17.2 #34 / E2E #15 の (a) の静的な側）: **管理平面の DTO 型のプロパティ名に
//    禁止キーが無い**ことを構造で固定する（`BR-40` / `CLAUDE.md` §10.5「運営者に必要なのは件数・状態・エラーであって
//    内容ではない」）。
//
// なぜ静的テストか: E2E（`tests/e2e/admin-non-disclosure.spec.ts`）は seed と仕込みが持つ値が**実際に出ていない**ことを
// 確かめるが、キーが「型として存在しうる」ことは値が空のときに見えない（`items: []` の応答は何も漏らさない）。
// ここでは応答の形を定める型そのものを歩き、**書かれた瞬間に落ちる**ようにする。
// `apps/web/lib/admin-monitoring/view.types.test.ts` / `admin-usage`（型レベルの `DeepKeys`）と同じ向きだが、
// あちらは 2 型に閉じている。ここは管理平面の DTO 型**すべて**を対象にし、禁止キーの語彙を
// `tests/support/admin-forbidden-keys.ts`（E2E と**同じ 1 つの定数**）から取る。
//
// 走査対象（管理平面の DTO が定義される 3 区画）:
//   - `packages/db/src/platform/queries/*.ts`（専用クエリの DTO）
//   - `packages/db/src/serializers/platform/*.ts`（シリアライザの View）
//   - `apps/web/lib/admin-*/view.ts`（API の応答型。`'use client'` の画面が参照する純粋な型）
// 対象は **export された type / interface** の全プロパティ名（入れ子・合併・交差・ジェネリクスの引数・同一ファイル内で参照する非 export 型を含む）。
// 🔴 名前が `Input` で終わる型は**入力**（`OwnerInvitationInput.email` / `SetTenantQuotaOverrideInput.reason` は運営者が
//    書き込む値であり応答ではない）として対象外にする。それ以外の接尾辞（`Meta` / `Query` / `Row`）は対象に残す
//    （`GateStallRow` / `PlatformAuditLogRow` のように応答の材料に禁止キーが紛れる方が危ない）。
//
// 🔴 例外は `ADMIN_FORBIDDEN_KEY_EXCEPTIONS`（応答 × キー × 根拠）の 1 箇所だけ。ここではファイルを応答 ID に写像し、
//    その応答の例外だけを許す。**例外が空振りしていない**（宣言した例外キーが実在する）ことも固定する。
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { GATE_STALL_REASONS_VIEW } from '../../apps/web/lib/admin-monitoring/view';
import {
  ADMIN_FORBIDDEN_KEY_EXCEPTIONS,
  ADMIN_FORBIDDEN_RESPONSE_KEYS,
  classifyAdminForbiddenKey,
  collectForbiddenKeySightings,
  GATE_STALL_REASON_VALUES,
  MASKED_VALUE_LITERAL,
  type AdminResponseId,
} from '../support/admin-forbidden-keys';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..', '..');

const SCAN_DIRS = ['packages/db/src/platform/queries', 'packages/db/src/serializers/platform'] as const;
const ADMIN_VIEW_GLOB_DIR = 'apps/web/lib';

/**
 * 🔴 ファイル → 応答 ID。ここに無いファイルは例外を持たない（禁止キーが 1 つでもあれば違反）。
 *    API-A2 / A3 / A16 には例外が無いので写像を書かない（書いても意味が変わらない）。
 */
const FILE_RESPONSE: Readonly<Record<string, AdminResponseId>> = {
  'packages/db/src/platform/queries/usage.ts': 'API-A6',
  'apps/web/lib/admin-usage/view.ts': 'API-A6',
  'packages/db/src/platform/queries/audit-logs.ts': 'API-A7',
  'packages/db/src/serializers/platform/audit-logs.ts': 'API-A7',
  'packages/db/src/platform/queries/gate-stalls.ts': 'API-A8',
  'packages/db/src/platform/queries/monitoring.ts': 'API-A8',
  'apps/web/lib/admin-monitoring/view.ts': 'API-A8',
};

/** 入力型（応答ではない）。 */
const INPUT_TYPE_PATTERN = /Input$/;

function listSourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return [];
    if (!/\.ts$/.test(entry.name) || /\.test\.ts$/.test(entry.name)) return [];
    return [full];
  });
}

function listAdminViewFiles(): string[] {
  const libDir = path.join(repoRoot, ADMIN_VIEW_GLOB_DIR);
  return readdirSync(libDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name.startsWith('admin-'))
    .map((entry) => path.join(libDir, entry.name, 'view.ts'))
    .filter((file) => {
      try {
        readFileSync(file);
        return true;
      } catch {
        return false;
      }
    });
}

function toRepoRelative(absolute: string): string {
  return path.relative(repoRoot, absolute).split(path.sep).join('/');
}

function parse(absolute: string, text = readFileSync(absolute, 'utf8')): ts.SourceFile {
  return ts.createSourceFile(absolute, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
}

type Violation = { readonly file: string; readonly type: string; readonly key: string; readonly line: number };
type Property = { readonly type: string; readonly key: string; readonly line: number };

function hasExportModifier(node: ts.Node): boolean {
  return ts.canHaveModifiers(node) && (ts.getModifiers(node) ?? []).some((m) => m.kind === ts.SyntaxKind.ExportKeyword);
}

/**
 * export された type / interface の全プロパティ名（宣言の部分木にある `PropertySignature` すべて。
 * 🔴 同一ファイル内で参照する非 export 型を含む —— `type Row = {...}; export type FooView = { rows: Row[] }` の
 * `Row` のように、別の宣言に切り出された型は部分木の外にあるため、参照先を名前で引いて同じ `typeName` で歩く）。
 */
function collectExportedTypeProperties(source: ts.SourceFile): Property[] {
  const declarations = new Map<string, ts.TypeAliasDeclaration | ts.InterfaceDeclaration>();
  for (const statement of source.statements) {
    if (!(ts.isTypeAliasDeclaration(statement) || ts.isInterfaceDeclaration(statement))) continue;
    declarations.set(statement.name.text, statement);
  }
  const properties: Property[] = [];
  for (const statement of source.statements) {
    if (!(ts.isTypeAliasDeclaration(statement) || ts.isInterfaceDeclaration(statement))) continue;
    if (!hasExportModifier(statement)) continue;
    const typeName = statement.name.text;
    if (INPUT_TYPE_PATTERN.test(typeName)) continue;
    const visited = new Set<string>([typeName]);
    const visit = (node: ts.Node): void => {
      if (ts.isPropertySignature(node)) {
        const name = ts.isIdentifier(node.name) || ts.isStringLiteral(node.name) ? node.name.text : null;
        if (name !== null) {
          properties.push({ type: typeName, key: name, line: source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1 });
        }
      }
      if (ts.isTypeReferenceNode(node) && ts.isIdentifier(node.typeName)) {
        const referencedName = node.typeName.text;
        if (!INPUT_TYPE_PATTERN.test(referencedName) && !visited.has(referencedName)) {
          const referenced = declarations.get(referencedName);
          if (referenced !== undefined) {
            visited.add(referencedName);
            visit(referenced);
          }
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(statement);
  }
  return properties;
}

function scan(file: string, source: ts.SourceFile): { violations: Violation[]; exceptionsUsed: Set<string> } {
  const responseId = FILE_RESPONSE[file];
  const exceptions = responseId === undefined ? {} : ADMIN_FORBIDDEN_KEY_EXCEPTIONS[responseId];
  const violations: Violation[] = [];
  const exceptionsUsed = new Set<string>();
  for (const property of collectExportedTypeProperties(source)) {
    if (classifyAdminForbiddenKey(property.key) === null) continue;
    if (property.key in exceptions) {
      exceptionsUsed.add(`${responseId}:${property.key}`);
      continue;
    }
    violations.push({ file, type: property.type, key: property.key, line: property.line });
  }
  return { violations, exceptionsUsed };
}

const scannedFiles = [
  ...SCAN_DIRS.flatMap((dir) => listSourceFiles(path.join(repoRoot, dir))),
  ...listAdminViewFiles(),
].map((absolute) => ({ file: toRepoRelative(absolute), source: parse(absolute) }));

function format(violations: readonly Violation[]): string {
  return violations.map((v) => `${v.file}:${v.line} — ${v.type}.${v.key}（禁止キー。docs/05 §5.5 / tests/support/admin-forbidden-keys.ts）`).join('\n');
}

describe('🔴 管理平面の DTO 型に禁止キーが無い（docs/05 §5.5 第 2 層 / E2E #15 (a) の静的な側。T-11-07）', () => {
  it('対照: 走査が空振りしていない（3 区画のファイルが含まれる）', () => {
    const files = scannedFiles.map((f) => f.file);
    expect(files).toContain('packages/db/src/platform/queries/usage.ts');
    expect(files).toContain('packages/db/src/platform/queries/monitoring.ts');
    expect(files).toContain('packages/db/src/platform/queries/demo-seed.ts');
    expect(files).toContain('packages/db/src/serializers/platform/audit-logs.ts');
    expect(files).toContain('apps/web/lib/admin-monitoring/view.ts');
    expect(files).toContain('apps/web/lib/admin-usage/view.ts');
    expect(files).toContain('apps/web/lib/admin-demo/view.ts');
    // export された型のプロパティが実際に集まっている。
    const total = scannedFiles.reduce((sum, f) => sum + collectExportedTypeProperties(f.source).length, 0);
    expect(total).toBeGreaterThan(100);
  });

  it('🔴 export された type / interface のプロパティ名に禁止キーが 1 つも無い（例外は応答 × キーで列挙した分だけ）', () => {
    const violations = scannedFiles.flatMap((f) => scan(f.file, f.source).violations);
    expect(violations, format(violations)).toEqual([]);
  });

  it('🔴 宣言した例外がすべて実在の型で使われている（使われていない例外 = 緩めるだけの穴。空振り防止）', () => {
    const used = new Set<string>();
    for (const f of scannedFiles) for (const key of scan(f.file, f.source).exceptionsUsed) used.add(key);
    const declared = Object.entries(ADMIN_FORBIDDEN_KEY_EXCEPTIONS).flatMap(([responseId, keys]) =>
      Object.keys(keys).map((key) => `${responseId}:${key}`),
    );
    expect(declared.length).toBeGreaterThan(0);
    expect(declared.filter((entry) => !used.has(entry)), '型の走査で見つからなかった例外').toEqual([]);
  });

  it('対照: 入力型（`*Input`）は対象外であり、その中には運営者が書き込む禁止語のキーが実在する（除外が空振りしていない）', () => {
    const provisioning = scannedFiles.find((f) => f.file === 'packages/db/src/platform/queries/provisioning.ts');
    expect(provisioning).toBeDefined();
    const text = provisioning?.source.getFullText() ?? '';
    expect(text).toContain('export type OwnerInvitationInput');
    expect(text).toMatch(/OwnerInvitationInput = \{[\s\S]*?readonly email: string;/);
    // 対象に含めると違反になる（＝ 除外が効いている）。
    const scanned = collectExportedTypeProperties(provisioning!.source).filter((p) => p.type === 'OwnerInvitationInput');
    expect(scanned).toEqual([]);
  });

  it('🔴 対照（合成ソース）: 禁止キー・前方一致・例外の形が意図どおりに判定される', () => {
    const at = 'packages/db/src/platform/queries/synthetic.ts';
    const run = (code: string, file = at) => scan(file, parse(file, code)).violations.map((v) => `${v.type}.${v.key}`);
    expect(run(`export type FooView = { readonly id: string; readonly displayName: string };`)).toEqual(['FooView.displayName']);
    expect(run(`export type FooView = { readonly rows: readonly { readonly unitPriceMin: number }[] };`)).toEqual(['FooView.unitPriceMin']);
    expect(run(`export type FooView = { readonly tokens: string[]; readonly tokenHash: string; readonly tokenizer: string };`)).toEqual([
      'FooView.tokens',
      'FooView.tokenHash',
    ]);
    expect(run(`export type FooView = { readonly a: { readonly nested: { readonly body: string } } };`)).toEqual(['FooView.body']);
    expect(run(`export type FooView = { readonly email: { readonly used: number } };`)).toEqual(['FooView.email']);
    // 例外は写像したファイルでだけ効く。
    expect(run(`export type FooView = { readonly email: { readonly used: number } };`, 'packages/db/src/platform/queries/usage.ts')).toEqual([]);
    expect(run(`export type FooView = { readonly targetId: string; readonly reason: string };`, 'packages/db/src/platform/queries/gate-stalls.ts')).toEqual([]);
    expect(run(`export type FooView = { readonly targetId: string; readonly reason: string };`, 'packages/db/src/serializers/platform/audit-logs.ts')).toEqual([
      'FooView.reason',
    ]);
    // 入力型と非 export は対象外。
    expect(run(`export type FooInput = { readonly email: string };`)).toEqual([]);
    expect(run(`type FooRow = { readonly email: string };`)).toEqual([]);
    // 🔴 同一ファイル内で export 型から参照される非 export 型は含む。参照されない非 export 型は対象外のまま。
    expect(
      run(`type Row = { readonly email: string }; export type FooView = { readonly rows: readonly Row[] };`),
    ).toEqual(['FooView.email']);
    expect(run(`type Orphan = { readonly email: string };`)).toEqual([]);
    // 禁止キーの語彙は共有定数から来ている（ここで別の一覧を持たない）。
    expect(ADMIN_FORBIDDEN_RESPONSE_KEYS).toContain('displayName');
    expect(ADMIN_FORBIDDEN_RESPONSE_KEYS).toContain('dkimTokens');
  });

  it('🔴 対照: GATE_STALL_REASON_VALUES は GATE_STALL_REASONS_VIEW の写しである（値のずれを固定する）', () => {
    expect([...GATE_STALL_REASON_VALUES]).toEqual([...GATE_STALL_REASONS_VIEW]);
  });
});

/**
 * 🔴 E2E（`tests/e2e/admin-non-disclosure.spec.ts`）が実サーバの JSON に当てる走査器そのものの対照。
 *    走査器が緩いと E2E の green が根拠を失うため、判定の境界をここで固定する（Playwright 無しで回る）。
 */
describe('🔴 対照: JSON の走査器（collectForbiddenKeySightings）が意図どおりに判定する', () => {
  const keysOf = (value: unknown, responseId: AdminResponseId) =>
    collectForbiddenKeySightings(value, responseId).map((s) => `${s.path}:${s.group}`);

  it('禁止キーはどの深さでも・配列の中でも捕まえる。前方一致は語の境界で切る', () => {
    expect(keysOf({ items: [{ a: { displayName: 'x' } }] }, 'API-A2')).toEqual(['items[0].a.displayName:IDENTITY']);
    expect(keysOf({ rows: [{ unitPriceMin: 1 }, { tokenHash: 'h' }, { tokenizer: 'ok' }] }, 'API-A2')).toEqual([
      'rows[0].unitPriceMin:IDENTITY',
      'rows[1].tokenHash:SECRET',
    ]);
    expect(keysOf({ body: null, findings: [], modelId: 'm', dkimTokens: ['t'] }, 'API-A16')).toEqual([
      'body:CONTENT',
      'findings:CONTENT',
      'modelId:PROVENANCE',
      'dkimTokens:SECRET',
    ]);
    expect(keysOf({ id: 'x', name: 'テナント', counts: { engineerCount: 3 } }, 'API-A3')).toEqual([]);
  });

  it('例外は応答ごと・値の形まで見る（API-A6 の email はオブジェクトだけ / API-A8 の reason は列挙値だけ / targetId は UUID だけ）', () => {
    expect(keysOf({ items: [{ email: { used: 1, limit: 2 } }] }, 'API-A6')).toEqual([]);
    expect(keysOf({ items: [{ email: 'owner@seed-isolation.test' }] }, 'API-A6')).toEqual(['items[0].email:IDENTITY']);
    // 同じ形でも別の応答では違反。
    expect(keysOf({ items: [{ email: { used: 1 } }] }, 'API-A2')).toEqual(['items[0].email:IDENTITY']);
    expect(keysOf({ rows: [{ targetId: '0193b107-0000-7000-8000-000000000001', reason: 'JOB_FAILED' }] }, 'API-A8')).toEqual([]);
    expect(keysOf({ rows: [{ targetId: 'not-a-uuid', reason: 'ある理由の自由文' }] }, 'API-A8')).toEqual([
      'rows[0].targetId:PROVENANCE',
      'rows[0].reason:CONTENT',
    ]);
    expect(keysOf({ items: [{ targetId: null }, { targetId: '0193b107-0000-7000-8000-000000000001' }] }, 'API-A7')).toEqual([]);
    expect(keysOf({ items: [{ reason: 'JOB_FAILED' }] }, 'API-A7')).toEqual(['items[0].reason:CONTENT']);
  });

  it('🔴 API-A7 の items[*].summary はマスク済み領域: 内容キーは無い・身元キーは [masked]・生成由来の列挙値は残ってよい', () => {
    const ok = {
      items: [
        {
          id: 'x',
          summary: {
            displayName: MASKED_VALUE_LITERAL,
            email: MASKED_VALUE_LITERAL,
            recipients: [MASKED_VALUE_LITERAL, MASKED_VALUE_LITERAL],
            unitPriceMin: MASKED_VALUE_LITERAL,
            modelId: 'claude-haiku-4-5-20251001',
            promptVersion: 'v3',
            purpose: 'gate',
            targetId: '0193b107-0000-7000-8000-000000000001',
            via: 'DETAIL',
          },
        },
      ],
    };
    expect(keysOf(ok, 'API-A7')).toEqual([]);
    const leaking = {
      items: [
        {
          id: 'x',
          summary: { displayName: '山田 太郎', body: MASKED_VALUE_LITERAL, tokenHash: MASKED_VALUE_LITERAL, objectKey: { key: 'a/b.pdf' } },
        },
      ],
    };
    expect(keysOf(leaking, 'API-A7')).toEqual([
      'items[0].summary.displayName:IDENTITY',
      'items[0].summary.body:CONTENT',
      'items[0].summary.tokenHash:SECRET',
      'items[0].summary.objectKey:IDENTITY',
    ]);
    // `summary` が items[*] の直下でなければマスク済み領域ではない（別の応答・別の深さでは通常の規則）。
    expect(keysOf({ summary: { displayName: MASKED_VALUE_LITERAL } }, 'API-A7')).toEqual(['summary.displayName:IDENTITY']);
    expect(keysOf({ items: [{ summary: { displayName: MASKED_VALUE_LITERAL } }] }, 'API-A8')).toEqual([
      'items[0].summary.displayName:IDENTITY',
    ]);
  });
});
