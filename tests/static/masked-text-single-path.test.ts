// tests/static/masked-text-single-path.test.ts
// docs/05 §17.2 #23 / §7.10（T-07-02）: 🔴 **`MaskedText` を作れる場所を 1 ファイルに固定する。**
//
// なぜ型だけでは足りないか: `MaskedText` はブランド型であり、`runRole` に生の `string` を渡す経路は
// 型として存在しない（`packages/ai/src/mask.test.ts` の型テスト）。だが **`as MaskedText` を 1 行
// 書けば、その担保は静かに全部消える**。「PII 未マスキングでの LLM 送信 0 件」（`CLAUDE.md` §7 /
// `BR-11` / `F-032 AC-1`）を守っているのは型そのものではなく、「型を握り潰す記述がどこにも無い」
// という構造であり、それを見張れるのは静的検査だけである。
//
// 🔴 許可は `packages/ai/src/mask.ts` の 1 ファイルのみ。同ファイル内の `brand()` が唯一のブランド
//    付与地点であり、そこへ到達する手段は `mask()`（実行時のデータ）と `maskedTemplate`
//    （ソース上のリテラル）に限られる。
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..', '..');

// `prompts/roles/**`（T-07-05 で追加される製品プロンプト）も走査対象に含める。
// プロンプトこそ「地の文と本文を連結する」場所であり、`as MaskedText` を書きたくなる筆頭である。
const SCAN_ROOTS = ['apps', 'packages', 'prompts', 'scripts'];
const IGNORED_DIRECTORIES = new Set(['node_modules', '.next', 'dist', '.turbo', 'generated']);
const SOURCE_EXTENSIONS = new Set(['.ts', '.tsx', '.mts', '.cts']);

/** 🔴 `MaskedText` へのキャストを書いてよい唯一のファイル（docs/05 §7.8 / §7.10）。 */
const ALLOWED_BRANDING_SITES = ['packages/ai/src/mask.ts'];

function listSourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      return IGNORED_DIRECTORIES.has(entry.name) ? [] : listSourceFiles(full);
    }
    return SOURCE_EXTENSIONS.has(path.extname(entry.name)) ? [full] : [];
  });
}

function toRepoRelative(absolute: string): string {
  return path.relative(repoRoot, absolute).split(path.sep).join('/');
}

/**
 * 🔴 テストファイルは走査対象外（本リポジトリの全走査テストと同じ規約）。テストは型を意図的に
 *    崩して「崩れることの確認」をするのが仕事であり、ここで落とすと検査自体が形骸化する。
 *    「本番コードを `*.test.ts` に隠す」抜け道は `tests/static/no-test-module-imports.test.ts` が
 *    別途塞いでいる。なお `packages/ai/src/mask.test.ts`（マスキングの検証そのもの）は
 *    キャストを 1 つも使わず `mask()` の戻り値だけで書いてある。
 */
function isTestFile(absolutePath: string): boolean {
  return /\.test\.(ts|tsx|mts|cts)$/.test(absolutePath);
}

/** `x as MaskedText` / `x as unknown as MaskedText` / `<MaskedText>x` を数える。 */
function castsToMaskedText(sourceText: string, fileName: string): boolean {
  const sourceFile = ts.createSourceFile(fileName, sourceText, ts.ScriptTarget.ES2023, true);
  let found = false;
  function isMaskedTextType(type: ts.TypeNode): boolean {
    return ts.isTypeReferenceNode(type) && type.typeName.getText(sourceFile) === 'MaskedText';
  }
  function visit(node: ts.Node): void {
    if (found) return;
    if ((ts.isAsExpression(node) || ts.isTypeAssertionExpression(node)) && isMaskedTextType(node.type)) {
      found = true;
    }
    ts.forEachChild(node, visit);
  }
  visit(sourceFile);
  return found;
}

describe('🔴 MaskedText を作れる場所が 1 ファイルに閉じていること（BR-11 / F-032 AC-1）', () => {
  const sourceFiles = SCAN_ROOTS.flatMap((root) => {
    const dir = path.join(repoRoot, root);
    try {
      return statSync(dir).isDirectory() ? listSourceFiles(dir) : [];
    } catch {
      return [];
    }
  }).filter((file) => !isTestFile(file));

  it('対照: 走査対象のソースが十分にある（テストが空振りしていない）', () => {
    expect(sourceFiles.length).toBeGreaterThan(50);
  });

  it('MaskedText へキャストする非テストソースは許可リストと完全に一致する', () => {
    const sites = sourceFiles
      .filter((file) => castsToMaskedText(readFileSync(file, 'utf8'), file))
      .map(toRepoRelative)
      .sort();
    expect(sites).toEqual([...ALLOWED_BRANDING_SITES].sort());
  });

  it('🔴 許可されているのは 1 ファイルだけである（増やすときは docs/05 §7.10 と併せて人間が判断する）', () => {
    expect(ALLOWED_BRANDING_SITES).toHaveLength(1);
  });

  it('🔴 `unsafeAsMasked` 相当の無条件変換が公開されていない（packages/ai のバレル）', () => {
    // `mask()`（実行時データ）と `maskedTemplate`（ソースのリテラル）以外に MaskedText を返す
    // 公開関数を足すと、型の担保が「気をつける」に戻る。
    const barrel = readFileSync(path.join(repoRoot, 'packages/ai/src/index.ts'), 'utf8');
    for (const forbidden of ['unsafeAsMasked', 'asMasked', 'toMaskedText', 'brand']) {
      expect(barrel).not.toContain(forbidden);
    }
  });
});
