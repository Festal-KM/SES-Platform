// tests/static/audit-detail-single-path.test.ts
// 🔴 T-11-09（docs/05 §17.2 #32 / §6.4「#10 の改訂」）: **監査ログの `summary` が許可リストの 1 関数を経ずに
//    主平面の応答へ出る経路が無い**ことを、参照と識別子の走査で固定する。
//
// 6 本立て（docs/05 §17.2 #32）:
//   ① `pickAuditDetail` を呼ぶ非テストソースが `apps/web/lib/audit-logs/service.ts` の 1 本だけ
//   ② `apps/web/lib/audit-logs/**` と `apps/web/app/(main)/audit-logs/**` で識別子 `summary` が現れるのは
//      `service.ts` の `select: { summary: true }` と `pickAuditDetail(row.action, row.summary, …)` の 2 箇所だけ
//      （画面が生 JSON を受け取る経路を型〔`view.types.test.ts`〕と AST の両方で塞ぐ）
//   ③ `apps/web/app/(main)/audit-logs/**` が `@ses/domain` の `pickAuditDetail` / `AUDIT_DETAIL_ALLOWLIST` /
//      `maskAuditSummary` を import しない（画面は選ばない・伏せない。描くだけ）
//   ④ `packages/domain/src/audit/pick-detail.ts` と `mask-summary.ts` が相互に import しない
//   ⑤ `GET /api/audit-logs/{id}`（行の詳細の追加取得）が存在しない —— `forbidden-api-routes.test.ts`（#30）側に
//      禁止パターンを置いた。ここでは対照として禁止リストに載っていることだけを見る
//   ⑥ `apps/web/lib/admin-audit-logs/**` / `packages/db/src/serializers/platform/**` から `pickAuditDetail` を
//      import しない（`A-006` を許可リスト方式へ静かに寄せる変更を落とす。`CLAUDE.md` §10.5）
//   ＋ CSV（✅ T-12-18 ⑪で実装。docs/05 §6.4「CSV エクスポート」行 ④）: `S-041` の CSV エクスポート（`lib/audit-logs/csv.ts` /
//      `lib/audit-logs/export.ts` / #10b の route `app/api/(main)/audit-logs/export/route.ts`）が `detail` / `summary` の識別子と
//      `pickAuditDetail` / `AUDIT_DETAIL_ALLOWLIST` / `maskAuditSummary` の参照を持たない（許可リストの 2 実装が構造的に書けない）。
//      加えて対象ディレクトリの `text/csv` を持つソースにも同じ検査を当てる（CSV を生成する別のファイルが増えても自動で対象になる）
//
// 🔴 識別子の走査は TypeScript の AST で行う（コメントの中の `summary` を実物と区別するため。
//    `tests/static/testid-inventory.test.ts` と同じ）。import の走査は正規表現で足りる（コメントを落としてから）。
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..', '..');

const IGNORED_DIRECTORIES = new Set(['node_modules', '.next', 'dist', '.turbo', 'generated', 'coverage']);
const SOURCE_EXTENSIONS = new Set(['.ts', '.tsx', '.mts', '.cts']);

function listSourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return IGNORED_DIRECTORIES.has(entry.name) ? [] : listSourceFiles(full);
    return SOURCE_EXTENSIONS.has(path.extname(entry.name)) ? [full] : [];
  });
}

function toRepoRelative(absolute: string): string {
  return path.relative(repoRoot, absolute).split(path.sep).join('/');
}

function isTestFile(absolutePath: string): boolean {
  return /\.test\.(ts|tsx|mts|cts)$/.test(absolutePath);
}

/** コメントを落としたソース（設計意図を書いた行で落ちないようにする）。 */
function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .map((line) => line.split('//')[0] ?? '')
    .join('\n');
}

function sourcesUnder(...roots: readonly string[]): string[] {
  return roots
    .flatMap((root) => listSourceFiles(path.join(repoRoot, root)))
    .filter((file) => !isTestFile(file));
}

function read(relative: string): string {
  return readFileSync(path.join(repoRoot, relative), 'utf8');
}

/** ソース中の識別子 `name` の出現（コメント・文字列リテラルを除く）を、行番号つきで列挙する。 */
function identifierOccurrences(source: string, fileName: string, name: string): readonly string[] {
  const sourceFile = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const found: string[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isIdentifier(node) && node.text === name) {
      const { line } = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
      const parent = node.parent;
      const kind = parent ? ts.SyntaxKind[parent.kind] : 'unknown';
      found.push(`${line + 1}:${kind}`);
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return found;
}

const SERVICE = 'apps/web/lib/audit-logs/service.ts';
const PICK_DETAIL = 'packages/domain/src/audit/pick-detail.ts';
const MASK_SUMMARY = 'packages/domain/src/audit/mask-summary.ts';
const SCREEN_ROOT = 'apps/web/app/(main)/audit-logs';
const LIB_ROOT = 'apps/web/lib/audit-logs';

describe('① pickAuditDetail の呼び出し元は apps/web/lib/audit-logs/service.ts の 1 本だけ', () => {
  it('apps/** と packages/** の非テストソースで、定義と公開面を除いて参照するのは service.ts のみ', () => {
    const definitionFiles = new Set([PICK_DETAIL, 'packages/domain/src/audit/index.ts']);
    const referencing = sourcesUnder('apps', 'packages')
      .filter((file) => /\bpickAuditDetail\b/.test(stripComments(readFileSync(file, 'utf8'))))
      .map(toRepoRelative)
      .filter((file) => !definitionFiles.has(file))
      .sort();
    expect(referencing).toEqual([SERVICE]);
  });

  it('対照: service.ts は実際に pickAuditDetail を呼んでいる（走査が空振りしていない）', () => {
    expect(stripComments(read(SERVICE))).toMatch(/pickAuditDetail\(/);
  });
});

describe('② 識別子 summary は service.ts の 2 箇所だけ（select のキーとプロパティアクセス）', () => {
  it('apps/web/lib/audit-logs/** と apps/web/app/(main)/audit-logs/** の非テストソース', () => {
    const occurrences = sourcesUnder(LIB_ROOT, SCREEN_ROOT).flatMap((file) => {
      const relative = toRepoRelative(file);
      return identifierOccurrences(readFileSync(file, 'utf8'), relative, 'summary').map((where) => `${relative}#${where}`);
    });
    expect(occurrences).toHaveLength(2);
    expect(occurrences.every((where) => where.startsWith(`${SERVICE}#`))).toBe(true);
    // 形も固定する: 1 つは `select` のプロパティ代入（`summary: true`）、もう 1 つはプロパティアクセス（`row.summary`）。
    const kinds = occurrences.map((where) => where.split(':').at(-1)).sort();
    expect(kinds).toEqual(['PropertyAccessExpression', 'PropertyAssignment']);
  });

  it('対照: 走査器は文字列リテラルとコメントの summary を数えない', () => {
    const sample = `// summary in comment\nconst a = { summary: true };\nconst b = row.summary;\nconst c = 'summary';\n/* summary */`;
    expect(identifierOccurrences(sample, 'sample.ts', 'summary')).toHaveLength(2);
  });
});

describe('③ 画面（app/(main)/audit-logs/**）は選ばない・伏せない', () => {
  it('pickAuditDetail / AUDIT_DETAIL_ALLOWLIST / maskAuditSummary / resolveAuditDetailKeySpecs を import しない', () => {
    const offenders = sourcesUnder(SCREEN_ROOT)
      .filter((file) =>
        /\b(pickAuditDetail|AUDIT_DETAIL_ALLOWLIST|maskAuditSummary|resolveAuditDetailKeySpecs)\b/.test(
          stripComments(readFileSync(file, 'utf8')),
        ),
      )
      .map(toRepoRelative);
    expect(offenders).toEqual([]);
  });

  it('画面は応答の固定形（lib/audit-logs/view.ts）だけを読む', () => {
    const detail = stripComments(read(`${SCREEN_ROOT}/audit-log-detail.tsx`));
    expect(detail).toMatch(/from '\.\.\/\.\.\/\.\.\/lib\/audit-logs\/view'/);
    expect(detail).not.toMatch(/from '@ses\/domain'/);
    expect(detail).not.toMatch(/from '@ses\/db'/);
  });
});

describe('④ pick-detail.ts と mask-summary.ts は相互に import しない（2 関数を 1 つに寄せない）', () => {
  it('pick-detail.ts → mask-summary.ts の import が無い', () => {
    expect(stripComments(read(PICK_DETAIL))).not.toMatch(/mask-summary/);
  });
  it('mask-summary.ts → pick-detail.ts の import が無い', () => {
    expect(stripComments(read(MASK_SUMMARY))).not.toMatch(/pick-detail/);
  });
  it('対照: 両者は audit/index.ts から並んで export される', () => {
    const index = stripComments(read('packages/domain/src/audit/index.ts'));
    expect(index).toMatch(/from '\.\/mask-summary\.js'/);
    expect(index).toMatch(/from '\.\/pick-detail\.js'/);
  });
});

describe('⑤ 行の詳細の追加取得 API（GET /api/audit-logs/{id}）が存在しない', () => {
  it('forbidden-api-routes.test.ts（#30）の禁止リストに載っている', () => {
    const source = read('tests/static/forbidden-api-routes.test.ts');
    expect(source).toContain("url: '/api/audit-logs/{}'");
  });
  it('apps/web/app/api/(main)/audit-logs/ 配下に動的セグメントのディレクトリが無い（在るのは #10b の静的セグメント export だけ）', () => {
    const entries = readdirSync(path.join(repoRoot, 'apps/web/app/api/(main)/audit-logs'), { withFileTypes: true });
    const directories = entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name);
    expect(directories.filter((name) => name.startsWith('['))).toEqual([]);
    // ✅ T-12-18 ⑪: `export`（`GET /api/audit-logs/export`。docs/05 §6.3 #10b）は静的セグメントであり、行の詳細の追加取得ではない。
    expect(directories).toEqual(['export']);
  });
});

describe('⑥ A-006（運営者）を許可リスト方式へ寄せない', () => {
  it('apps/web/lib/admin-audit-logs/** / packages/db/src/serializers/platform/** から pickAuditDetail を import しない', () => {
    const offenders = sourcesUnder('apps/web/lib/admin-audit-logs', 'packages/db/src/serializers/platform')
      .filter((file) => /\b(pickAuditDetail|AUDIT_DETAIL_ALLOWLIST)\b/.test(stripComments(readFileSync(file, 'utf8'))))
      .map(toRepoRelative);
    expect(offenders).toEqual([]);
  });
  it('対照: A-006 の直列化は maskAuditSummary のまま', () => {
    expect(stripComments(read('packages/db/src/serializers/platform/audit-logs.ts'))).toMatch(/maskAuditSummary\(/);
  });
});

describe('CSV: S-041 のエクスポート（#10b。T-12-18 ⑪）に detail / summary の列を足さない', () => {
  /** 🔴 CSV を生成する側の 3 本（docs/05 §6.4「CSV エクスポート」行 ④）。増えたら `text/csv` の走査が自動で拾う。 */
  const CSV_SOURCES = [
    'apps/web/lib/audit-logs/csv.ts',
    'apps/web/lib/audit-logs/export.ts',
    'apps/web/app/api/(main)/audit-logs/export/route.ts',
  ] as const;
  const EXPORT_ROUTE_ROOT = 'apps/web/app/api/(main)/audit-logs/export';

  function csvOffenders(files: readonly string[]): readonly string[] {
    return files
      .filter((file) => {
        const relative = toRepoRelative(file);
        const source = readFileSync(file, 'utf8');
        return (
          identifierOccurrences(source, relative, 'detail').length > 0 ||
          identifierOccurrences(source, relative, 'summary').length > 0 ||
          /\b(pickAuditDetail|AUDIT_DETAIL_ALLOWLIST|maskAuditSummary|resolveAuditDetailKeySpecs)\b/.test(stripComments(source))
        );
      })
      .map(toRepoRelative);
  }

  it('🔴 csv.ts / export.ts / #10b の route が detail / summary の識別子と許可リスト・マスクの関数を参照しない', () => {
    const files = CSV_SOURCES.map((relative) => path.join(repoRoot, relative));
    expect(csvOffenders(files)).toEqual([]);
    // 対照: 3 本は実在し、CSV の生成・読み出し・応答をそれぞれ担っている（走査が空振りしていない）。
    expect(stripComments(read(CSV_SOURCES[0]))).toMatch(/encodeCsv\(/);
    expect(stripComments(read(CSV_SOURCES[1]))).toMatch(/listAuditLogs\(/);
    expect(stripComments(read(CSV_SOURCES[2]))).toMatch(/text\/csv|AUDIT_LOG_CSV_CONTENT_TYPE/);
    // 🔴 監査記録 `audit_log.export` の組み立て（`summary` を持つ）は `packages/db`（`recordAuditLogExport`）に閉じ、route は呼ぶだけ。
    expect(stripComments(read(CSV_SOURCES[2]))).toMatch(/recordAuditLogExport\(/);
    expect(stripComments(read('packages/db/src/audit-log-export.ts'))).toMatch(/writeAuditLog\(/);
  });

  it('lib/audit-logs/** / app/(main)/audit-logs/** / #10b の route 配下の text/csv を持つソースが detail / summary を参照しない', () => {
    const csvSources = sourcesUnder(LIB_ROOT, SCREEN_ROOT, EXPORT_ROUTE_ROOT).filter((file) =>
      /text\/csv/.test(stripComments(readFileSync(file, 'utf8'))),
    );
    expect(csvSources.map(toRepoRelative)).toContain('apps/web/lib/audit-logs/csv.ts');
    expect(csvOffenders(csvSources)).toEqual([]);
  });
});
