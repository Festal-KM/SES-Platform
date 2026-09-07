// tests/static/search-sql-single-path.test.ts
// 🔴 SP-06 T-06-05 の完了判定: **検索の実装が `packages/db/src/search/**` 以外に現れない**
//    （docs/05 TBD-8 / `docs/03` §3.7.3 / §5.3）。
//
// ============================================================================
// 🔴 「検索の実装」の定義（＝ 本テストの検査対象。曖昧にしない）
// ============================================================================
// 検査するのは「**`docs/03` §3.7.3 の代替（段階 1 インデックス見直し → 2 非正規化テーブル →
// 3 マテビュー → 4 OpenSearch）に進むときに書き換わるコード**」である。具体的には次の 3 つ:
//
//   A. **フリーワード（自由文）を列に部分一致させる述語** …… Prisma の `contains`
//      （`ILIKE '%…%'` に落ちる）。これは `pg_trgm` / `pg_bigm` / `tsvector` のどれで実装するかが
//      切り替わる当のものである。
//   B. **大文字小文字・表記ゆれの吸収の指定** …… Prisma の `mode: 'insensitive'`。
//      同上（`pg_trgm` が代替する機能そのもの）。
//   C. **生 SQL の検索式** …… `ILIKE` / `to_tsvector` / `*_tsquery` / `similarity()` /
//      `word_similarity()` / trigram 演算子（`%>` / `<->`）。現時点で 0 件であり、0 件を保つ。
//
// 加えて D として、**Prisma の全文検索フィルタ（`search`）が型として存在しないこと**を
// `schema.prisma` の `previewFeatures` で確かめる。`search` はプロパティ名として一般的すぎ
// （画面の文言オブジェクトにも現れる）AST で誤検知なく数えられないため、**そもそも使えない**
// ことを別の角度から固定する。使うと決めたときは、まず置き場所を `search/**` に決めてから
// preview を有効にする（そのとき本テストの D が落ちて気づける）。
//
// ============================================================================
// 🔴 検査対象**外**（意図的。理由を明示する）
// ============================================================================
//   - **一覧の単純な `SELECT`**（`select` する列・`count` の呼び出し・カーソルページング・
//     応答型の組み立て）…… 段階 1〜4 で書き換わらない。ここまで `packages/db` へ引き取ると、
//     射影の判断（`F-013 AC-2`）の置き場所が 2 つになる（`apps/web/lib/projects/list.ts` の冒頭）。
//   - **等値・範囲の絞り込み**（`status` / `prefecture` / `gte` / `lte`）…… B-tree で解決でき、
//     代替の検討対象にならない。
//   - **`startsWith` / `endsWith`** …… 前方 / 後方の**完全一致**であり、B-tree（`text_pattern_ops`）
//     で解決できる。実際の用途も自由文ではなく識別子の分類 / 後始末である
//     （`apps/web/lib/audit-logs/categories.ts` の `action` の接尾辞 `.create` / `.update` /
//     `.delete`〔`docs/05` §16.1 の action 名との照合〕、および結合テストがメールのドメインで
//     自分の作った行だけを消す `deleteMany`）。🔴 これらを**自由文の部分一致の代わりに使う**と
//     本テストをすり抜けるが、そのときは `mode: 'insensitive'` が要るはずで B が捕まえる
//     （大小を区別する部分一致は、日本語でもラテン文字でも検索として成立しない）。
//
// ============================================================================
// 実装
// ============================================================================
// AST 走査は TypeScript compiler API を直接使う（`tests/static/domain-purity.test.ts` と同じ経路）。
// 🔴 **コメントと JSDoc は対象にしない**（AST のノードだけを見る）。本リポジトリの各所に
//    「`contains`（`ILIKE '%…%'`）」のような**説明**があり、テキスト検索では区別できない。
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..', '..');

/** 🔴 検索の実装を置いてよい唯一の場所（repo ルートからの POSIX 相対パス接頭辞）。 */
const SEARCH_MODULE_DIR = 'packages/db/src/search/';

/**
 * 🔴 **例外は 1 ファイルだけ**である（実装ではなく、実装を検査するテスト）。
 *
 * `tests/isolation/search-indexes.test.ts` ④ は「🔴 **RLS 下では `ILIKE '%…%'` が索引条件に
 * 降りず、trigram の GIN 索引を作っても使われないこと**」を `EXPLAIN` で確かめる
 * （＝ 索引を作らないという判断の根拠。`docs/03` §3.7.2 懸念 4）。
 * **検査対象の SQL の形そのものを書かなければ計画を見られない**ため、ここだけを許す。
 * 🔴 増やすときはこの配列を編集することになる ＝ **レビューに必ず出る**（許可を暗黙に
 *    広げる手段を残さない）。実装コードをここに足してはならない。
 */
const RAW_SQL_VERIFICATION_FILES = ['tests/isolation/search-indexes.test.ts'];

/** 走査するソースの根（`.ts` / `.tsx`）。 */
const SCANNED_ROOTS = ['apps', 'packages', 'scripts', 'tests'];

const SKIPPED_DIR_NAMES = new Set(['node_modules', 'dist', '.next', '.turbo', 'coverage', '__fixtures__']);

/** C: 生 SQL の検索式。**列挙は「代替の検討対象になる構文」だけ**にする（拡張名は含めない）。 */
const RAW_SEARCH_SQL_PATTERN =
  /\bILIKE\b|\bto_tsvector\b|\b\w*to_tsquery\b|\btsvector\b|\bsimilarity\s*\(|\bword_similarity\s*\(|%>|<->/i;

type Violation = {
  readonly rule: 'PRISMA_CONTAINS' | 'PRISMA_INSENSITIVE_MODE' | 'RAW_SEARCH_SQL';
  readonly file: string;
  readonly line: number;
  readonly text: string;
};

function listSourceFiles(dir: string, acc: string[]): string[] {
  for (const entry of readdirSync(dir)) {
    if (SKIPPED_DIR_NAMES.has(entry)) continue;
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) {
      listSourceFiles(full, acc);
      continue;
    }
    if (/\.(ts|tsx|mts|cts)$/.test(entry)) acc.push(full);
  }
  return acc;
}

function toPosixRelative(absolute: string): string {
  return path.relative(repoRoot, absolute).split(path.sep).join('/');
}

/** オブジェクトリテラルのプロパティ名（`{ contains: x }` / `{ 'contains': x }` の両形）。 */
function propertyNameOf(node: ts.ObjectLiteralElementLike): string | undefined {
  const name = node.name;
  if (name === undefined) return undefined;
  if (ts.isIdentifier(name)) return name.text;
  if (ts.isStringLiteral(name)) return name.text;
  return undefined;
}

function findViolations(sourceText: string, relativePath: string): Violation[] {
  const sourceFile = ts.createSourceFile(
    relativePath,
    sourceText,
    ts.ScriptTarget.ES2023,
    true,
    relativePath.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const violations: Violation[] = [];

  function report(rule: Violation['rule'], node: ts.Node): void {
    violations.push({
      rule,
      file: relativePath,
      line: sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1,
      text: node.getText(sourceFile).slice(0, 120),
    });
  }

  function visit(node: ts.Node): void {
    // A / B: オブジェクトリテラルのプロパティ。🔴 **型（`PropertySignature`）は対象にしない** ——
    //        `FreeWordFilter` のような型宣言は述語の組み立てではないため（型は `@ses/db` から
    //        import して使う形にしてある）。
    if (ts.isPropertyAssignment(node) || ts.isShorthandPropertyAssignment(node)) {
      const name = propertyNameOf(node);
      if (name === 'contains') report('PRISMA_CONTAINS', node);
      if (
        name === 'mode' &&
        ts.isPropertyAssignment(node) &&
        node.initializer.getText(sourceFile).includes('insensitive')
      ) {
        report('PRISMA_INSENSITIVE_MODE', node);
      }
    }

    // C: 文字列リテラル / テンプレートリテラルの中の SQL 検索式。
    // 🔴 3 形を**排他的に**判定する（`isStringLiteralLike` は無置換テンプレートも真になるため、
    //    まとめて書くと同じノードを 2 回数えて failure メッセージが重複する）。
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
      if (RAW_SEARCH_SQL_PATTERN.test(node.text)) report('RAW_SEARCH_SQL', node);
    } else if (ts.isTemplateExpression(node)) {
      // 置換つきテンプレートは `${…}` を挟むので `.text` を持たない。生のソースで見る。
      if (RAW_SEARCH_SQL_PATTERN.test(node.getText(sourceFile))) report('RAW_SEARCH_SQL', node);
    }

    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return violations;
}

const scannedFiles = SCANNED_ROOTS.flatMap((root) =>
  listSourceFiles(path.join(repoRoot, root), []),
).map(toPosixRelative);

const violationsOutsideSearchModule = scannedFiles
  .filter(
    (relativePath) =>
      !relativePath.startsWith(SEARCH_MODULE_DIR) &&
      !RAW_SQL_VERIFICATION_FILES.includes(relativePath),
  )
  .flatMap((relativePath) =>
    findViolations(readFileSync(path.join(repoRoot, relativePath), 'utf8'), relativePath),
  );

describe('🔴 T-06-05: 検索の実装が packages/db/src/search/** に閉じている（docs/05 TBD-8）', () => {
  it('走査対象のファイルが十分にある（空振りしていない）', () => {
    // 🔴 「0 件だから合格」を「1 ファイルも読んでいないから 0 件」と区別する。
    expect(scannedFiles.length).toBeGreaterThan(200);
  });

  it('🔴 `search/**` の外に、フリーワード述語・大小無視の指定・生 SQL の検索式が 1 つも無い', () => {
    const rendered = violationsOutsideSearchModule.map(
      (violation) => `${violation.file}:${violation.line} [${violation.rule}] ${violation.text}`,
    );
    expect(rendered).toEqual([]);
  });

  it('🔴 例外に挙げたファイルが実在する（許可だけが残って対象が消えていない）', () => {
    for (const relativePath of RAW_SQL_VERIFICATION_FILES) {
      expect(scannedFiles, relativePath).toContain(relativePath);
    }
    // 🔴 例外は最小に保つ（増えたらこの数を意識的に上げることになる）。
    expect(RAW_SQL_VERIFICATION_FILES).toHaveLength(1);
  });

  it('🔴 検査が空振りしていない（`search/**` の中では実際に検出される）', () => {
    // 検査対象の構文が「そもそもどこにも無い」ために 0 件になっているのではないことを、
    // 唯一の正当な置き場所で実際に検出することで示す。
    const insideSearchModule = scannedFiles
      .filter(
        (relativePath) =>
          relativePath.startsWith(SEARCH_MODULE_DIR) && !relativePath.endsWith('.test.ts'),
      )
      .flatMap((relativePath) =>
        findViolations(readFileSync(path.join(repoRoot, relativePath), 'utf8'), relativePath),
      );

    expect(insideSearchModule.map((violation) => violation.rule)).toContain('PRISMA_CONTAINS');
    expect(insideSearchModule.map((violation) => violation.rule)).toContain(
      'PRISMA_INSENSITIVE_MODE',
    );
    // 🔴 述語を組み立てているのは `free-word.ts` だけである（呼び出し側は列名を選ぶだけ）。
    expect(
      [...new Set(insideSearchModule.map((violation) => violation.file))].sort(),
    ).toEqual(['packages/db/src/search/free-word.ts']);
  });
});

describe('🔴 D: Prisma の全文検索フィルタ（`search`）が型として存在しない', () => {
  const schemaPrisma = readFileSync(
    path.join(repoRoot, 'packages', 'db', 'prisma', 'schema.prisma'),
    'utf8',
  );

  it('`previewFeatures` に `fullTextSearchPostgres` が無い（＝ `{ search: … }` を書けない）', () => {
    // 有効にするときは、置き場所を `packages/db/src/search/**` に決めてから行うこと
    // （docs/05 TBD-8。本テストが落ちるので気づける）。
    expect(schemaPrisma).not.toContain('fullTextSearchPostgres');
  });
});
