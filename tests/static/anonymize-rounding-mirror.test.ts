// tests/static/anonymize-rounding-mirror.test.ts
// T-08-01: 🔴 匿名共有の丸め（`CLAUDE.md` §3.1 経路 4 / `docs/02` A-04）が、**パッケージ間で
// 二重に宣言している値・形**を突合する。`connector-selection-mirror.test.ts` と同じ扱いである。
//
// 対象は 3 組:
//   ① `packages/config` の `ANONYMIZE_ROUNDING`（**値**の出所）
//      ↔ `packages/domain` の `AnonymizeRoundingConfig`（**形**の出所）
//      🔴 ずれると、丸め関数が粒度の一部を受け取れないまま動く。`packages/domain` は
//      `@ses/config` を import できない（`CLAUDE.md` §2.1 / `eslint.config.mjs` の
//      `forbidAllSes`）ため、import で共有できない。
//   ② `packages/domain` の `ANONYMIZED_REMOTE_MODES` ↔ `packages/db` の `REMOTE_MODES`
//      🔴 ずれると、台帳の `remote_mode`（CHECK 付き）に存在しない値が匿名候補として組み上がる。
//   ③ `packages/config` の `ANONYMIZE_ROUNDING` の**値**
//      ↔ `packages/domain` の丸めユニットテストが使う `A04` の値
//      🔴 これが無いと、config の粒度を緩めても domain のテストは**古い値のまま緑になる**
//      （`7 年 → 5〜10 年` を証明しているつもりで、実際には別の粒度が本番に出る）。
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..', '..');
const configAnonymizeFile = path.join(repoRoot, 'packages', 'config', 'src', 'anonymize.ts');
const domainRoundingFile = path.join(
  repoRoot,
  'packages',
  'domain',
  'src',
  'anonymize',
  'rounding.ts',
);
const domainRoundingTestFile = path.join(
  repoRoot,
  'packages',
  'domain',
  'src',
  'anonymize',
  'rounding.test.ts',
);
const dbValueSetsFile = path.join(repoRoot, 'packages', 'db', 'src', 'schema-value-sets.ts');

function parse(file: string): ts.SourceFile {
  return ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.ES2023, true, ts.ScriptKind.TS);
}

/** `const X = ['a', 'b'] as const;` の文字列リテラルを取り出す。 */
function arrayLiteralsOfConst(sourceFile: ts.SourceFile, variableName: string): string[] {
  const found: string[] = [];
  function visit(node: ts.Node): void {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.name.text === variableName &&
      node.initializer !== undefined
    ) {
      const initializer = ts.isAsExpression(node.initializer)
        ? node.initializer.expression
        : node.initializer;
      if (ts.isArrayLiteralExpression(initializer)) {
        for (const element of initializer.elements) {
          if (ts.isStringLiteralLike(element)) found.push(element.text);
        }
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(sourceFile);
  return found;
}

/** `export type X = { a: T; b: T };` のプロパティ名を取り出す。 */
function propertyNamesOfTypeAlias(sourceFile: ts.SourceFile, typeName: string): string[] {
  const found: string[] = [];
  function visit(node: ts.Node): void {
    if (
      ts.isTypeAliasDeclaration(node) &&
      node.name.text === typeName &&
      ts.isTypeLiteralNode(node.type)
    ) {
      for (const member of node.type.members) {
        if (ts.isPropertySignature(member) && member.name !== undefined && ts.isIdentifier(member.name)) {
          found.push(member.name.text);
        }
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(sourceFile);
  return found;
}

function numericValueOf(node: ts.Expression): number | number[] | null {
  if (ts.isNumericLiteral(node)) return Number(node.text.replace(/_/g, ''));
  if (ts.isArrayLiteralExpression(node)) {
    const values: number[] = [];
    for (const element of node.elements) {
      if (!ts.isNumericLiteral(element)) return null;
      values.push(Number(element.text.replace(/_/g, '')));
    }
    return values;
  }
  return null;
}

/** `const X = { a: 1, b: [2, 3] } as const;` のプロパティ名 → 数値（または数値配列）。 */
function numericObjectOfConst(
  sourceFile: ts.SourceFile,
  variableName: string,
): Record<string, number | number[]> {
  const found: Record<string, number | number[]> = {};
  function visit(node: ts.Node): void {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.name.text === variableName &&
      node.initializer !== undefined
    ) {
      const initializer = ts.isAsExpression(node.initializer)
        ? node.initializer.expression
        : node.initializer;
      if (ts.isObjectLiteralExpression(initializer)) {
        for (const property of initializer.properties) {
          if (
            ts.isPropertyAssignment(property) &&
            ts.isIdentifier(property.name) &&
            numericValueOf(property.initializer) !== null
          ) {
            found[property.name.text] = numericValueOf(property.initializer) as number | number[];
          }
        }
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(sourceFile);
  return found;
}

describe('① 丸めの粒度: packages/config の値 ↔ packages/domain の型', () => {
  const configValues = numericObjectOfConst(parse(configAnonymizeFile), 'ANONYMIZE_ROUNDING');
  const typeMembers = propertyNamesOfTypeAlias(
    parse(domainRoundingFile),
    'AnonymizeRoundingConfig',
  );

  it('対照: 双方が空でない（テスト自体が空振りしていない）', () => {
    expect(Object.keys(configValues).length).toBeGreaterThan(0);
    expect(typeMembers.length).toBeGreaterThan(0);
  });

  it('🔴 プロパティ名が完全に一致する（片方だけに項目が増えていない）', () => {
    expect(Object.keys(configValues).sort()).toEqual([...typeMembers].sort());
  });
});

describe('② リモート可否 3 値: packages/domain ↔ packages/db', () => {
  const domainModes = arrayLiteralsOfConst(parse(domainRoundingFile), 'ANONYMIZED_REMOTE_MODES');
  const dbModes = arrayLiteralsOfConst(parse(dbValueSetsFile), 'REMOTE_MODES');

  it('対照: 双方が空でない', () => {
    expect(domainModes.length).toBeGreaterThan(0);
    expect(dbModes.length).toBeGreaterThan(0);
  });

  it('🔴 値集合が順序まで一致する（docs/02 A-04 ⑤ の 3 値）', () => {
    expect(domainModes).toEqual(dbModes);
    expect(domainModes).toEqual(['FULL_REMOTE', 'PARTIAL_REMOTE', 'ONSITE_ONLY']);
  });
});

describe('③ 丸めのユニットテストが使う値 ↔ packages/config の確定値', () => {
  const configValues = numericObjectOfConst(parse(configAnonymizeFile), 'ANONYMIZE_ROUNDING');
  const testValues = numericObjectOfConst(parse(domainRoundingTestFile), 'A04');

  it('対照: 双方が空でない', () => {
    expect(Object.keys(configValues).length).toBeGreaterThan(0);
    expect(Object.keys(testValues).length).toBeGreaterThan(0);
  });

  it('🔴 domain のユニットテストは、config の確定値そのもので丸めを検証している', () => {
    expect(testValues).toEqual(configValues);
  });

  it('🔴 確定値は docs/02 A-04（Issue #5 の回答、2026-09-10）のとおりである', () => {
    expect(configValues).toEqual({
      maxSkills: 8,
      yearsBandBoundaries: [1, 3, 5, 10],
      priceBucketYen: 100_000,
      priceCapYen: 1_000_000,
    });
  });
});
