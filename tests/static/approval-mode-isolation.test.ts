// tests/static/approval-mode-isolation.test.ts
// docs/05 §17.2 #8:「🔴 `apps/web/app/api/(main)/proposals/**` に `TenantRoleApprovalMode` / `decideRoleHandoff` が現れない
// （`F-035 AC-3`）」。T-09-03（docs/sprints/SP-09-proposal-flow.md §4 T-09-03 / §5 静的テスト）。
//
// ---------------------------------------------------------------------------
// 🔴 なぜこの検査が要るか（`F-035 AC-3` / `AC-6` / `BR-17` / `BR-18` / `CLAUDE.md` §12.4）
// ---------------------------------------------------------------------------
// AI ロール別の承認モード（`TenantRoleApprovalMode`。テナント × ロール。`F-035`）と、提案の承認自動付与
// （`Tenant.autoApproveEnabled`。テナント単位。`F-021`）は**別の設定項目**であり、一方の変更が他方に影響してはならない。
// 特に「全ロールを自動承認にしたら提案の実行ゲートが緩む」経路は、**設定画面で隠すのではなく、承認の経路が
// ロール別モードをそもそも読まない**ことで塞ぐ。ここは「レビューで気をつける」の代わりであり、必ず自動化する。
//
// 🔴 射程は docs/05 §17.2 #8 の `apps/web/app/api/(main)/proposals/**` に加えて、T-09-03 でその実体を置いた
//    `apps/web/lib/proposals/**`（#41 / #42 / `S-021` の読み取り）と `packages/db/src/proposal-approval.ts`
//    （承認 CAS の唯一の実装）、`packages/domain/src/gate/autoApprove.ts`（§11.6 の分岐）、
//    `apps/worker/src/jobs/gate-run.ts`（自動承認の呼び出し元）も走査する —— ルートは薄い入口であり、
//    実体が読んでいたら意味が無い。
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..', '..');

/** 🔴 走査する場所。**減らさない**（足すのは可）。 */
const SCAN_TARGETS: readonly string[] = [
  'apps/web/app/api/(main)/proposals',
  'apps/web/app/(main)/proposals',
  'apps/web/lib/proposals',
  'packages/db/src/proposal-approval.ts',
  'packages/domain/src/gate/autoApprove.ts',
  'apps/worker/src/jobs/gate-run.ts',
];

/**
 * 🔴 承認の経路に現れてはならない識別子（docs/05 §17.2 #8 の 2 つ + その周辺の実体名）。
 *    - `TenantRoleApprovalMode` … AI ロール別承認モードの表 / 型
 *    - `decideRoleHandoff` … ロール別モードによる「都度承認 / 自動承認」の分岐（docs/05 §7.5）
 *    - `tenantRoleApprovalMode` … Prisma のデリゲート名（`db.tenantRoleApprovalMode.findFirst` の形で読む経路）
 *    - `TENANT_ROLE_APPROVAL_MODE_VALUES` … 値集合（`packages/db/src/schema-value-sets.ts`）
 */
const FORBIDDEN_IDENTIFIERS = [
  'TenantRoleApprovalMode',
  'decideRoleHandoff',
  'tenantRoleApprovalMode',
  'TENANT_ROLE_APPROVAL_MODE_VALUES',
] as const;

const IGNORED_DIRECTORIES = new Set(['node_modules', '.next', 'dist', '.turbo', 'generated']);
const SOURCE_EXTENSIONS = new Set(['.ts', '.tsx', '.mts', '.cts']);

function listSourceFiles(target: string): string[] {
  const absolute = path.join(repoRoot, target);
  if (statSync(absolute).isFile()) return [absolute];
  return readdirSync(absolute, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(absolute, entry.name);
    if (entry.isDirectory()) {
      return IGNORED_DIRECTORIES.has(entry.name) ? [] : listSourceFiles(path.relative(repoRoot, full));
    }
    return SOURCE_EXTENSIONS.has(path.extname(entry.name)) ? [full] : [];
  });
}

function toRepoRelative(absolute: string): string {
  return path.relative(repoRoot, absolute).split(path.sep).join('/');
}

/** 🔴 テストファイルは走査対象外（テストは出荷されない。他の全走査テストと同じ規約）。 */
function isTestFile(absolutePath: string): boolean {
  return /\.(?:test|render\.test)\.(ts|tsx|mts|cts)$/.test(absolutePath);
}

/**
 * 🔴 AST で**識別子・プロパティ名・文字列リテラル**を集める（正規表現だとコメント中の言及と区別できない）。
 *    文字列リテラルも見るのは、`db['tenantRoleApprovalMode']` / `$queryRaw` の表名（`tenant_role_approval_modes`）の
 *    形で読む経路を取りこぼさないため。
 */
function collectTokens(sourceText: string, fileName: string): ReadonlySet<string> {
  const sourceFile = ts.createSourceFile(fileName, sourceText, ts.ScriptTarget.ES2023, true, ts.ScriptKind.TSX);
  const tokens = new Set<string>();
  function visit(node: ts.Node): void {
    if (ts.isIdentifier(node) || ts.isPrivateIdentifier(node)) tokens.add(node.text);
    if (ts.isStringLiteralLike(node)) {
      tokens.add(node.text);
      // テンプレートの生 SQL に表名が埋め込まれる形も見る。
      if (node.text.includes('tenant_role_approval_modes')) tokens.add('tenant_role_approval_modes');
    }
    if (ts.isTemplateLiteralToken(node) && node.text.includes('tenant_role_approval_modes')) {
      tokens.add('tenant_role_approval_modes');
    }
    ts.forEachChild(node, visit);
  }
  visit(sourceFile);
  return tokens;
}

const sourceFiles = SCAN_TARGETS.flatMap(listSourceFiles).filter((file) => !isTestFile(file));

describe('🔴 提案の承認経路は AI ロール別承認モードを読まない（docs/05 §17.2 #8 / F-035 AC-3 / AC-6）', () => {
  it('対照: 走査対象に承認の実体（#41 / #42 / 承認 CAS / §11.6 / gate.run）が含まれている', () => {
    const relative = sourceFiles.map(toRepoRelative);
    expect(relative).toContain('apps/web/app/api/(main)/proposals/[id]/approve/route.ts');
    expect(relative).toContain('apps/web/app/api/(main)/proposals/[id]/reject/route.ts');
    expect(relative).toContain('apps/web/lib/proposals/approval.ts');
    expect(relative).toContain('packages/db/src/proposal-approval.ts');
    expect(relative).toContain('packages/domain/src/gate/autoApprove.ts');
    expect(relative).toContain('apps/worker/src/jobs/gate-run.ts');
  });

  it.each(FORBIDDEN_IDENTIFIERS)('🔴 `%s` が走査対象のどのソースにも現れない', (identifier) => {
    const offenders = sourceFiles
      .filter((file) => collectTokens(readFileSync(file, 'utf8'), file).has(identifier))
      .map(toRepoRelative);
    expect(offenders).toEqual([]);
  });

  it('🔴 表名 `tenant_role_approval_modes` を生 SQL で読む経路も無い', () => {
    const offenders = sourceFiles
      .filter((file) => collectTokens(readFileSync(file, 'utf8'), file).has('tenant_role_approval_modes'))
      .map(toRepoRelative);
    expect(offenders).toEqual([]);
  });

  it('対照: 検出器はコメントではなくコードを見る（識別子を含むソースを検出できる）', () => {
    const violation = `const mode = await db.tenantRoleApprovalMode.findFirst();\nexport const x = decideRoleHandoff(mode);`;
    const tokens = collectTokens(violation, '__violation__.ts');
    expect(tokens.has('tenantRoleApprovalMode')).toBe(true);
    expect(tokens.has('decideRoleHandoff')).toBe(true);
    const commentOnly = `// TenantRoleApprovalMode は読まない\nexport const y = 1;`;
    expect(collectTokens(commentOnly, '__ok__.ts').has('TenantRoleApprovalMode')).toBe(false);
  });

  it('🔴 対照: `TenantRoleApprovalMode` という実体は Prisma スキーマに実在する（識別子が空振りしていない）', () => {
    const schema = readFileSync(path.join(repoRoot, 'packages', 'db', 'prisma', 'schema.prisma'), 'utf8');
    expect(schema).toMatch(/model TenantRoleApprovalMode /);
  });
});
