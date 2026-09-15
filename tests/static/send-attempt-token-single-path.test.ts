// tests/static/send-attempt-token-single-path.test.ts
// T-09-05（docs/sprints/SP-09 §T-09-05 / docs/05 §10.1 / docs/03 `program-design` 申し送り 3）:
// 🔴 **`SendAttemptToken` を作れる場所を `packages/db/src/send.ts` の 1 ファイルに固定する。**
//
// なぜ型だけでは足りないか: `SendAttemptToken` はブランド型であり、予約（`reserveSendAttempt`）を経ずに
// `EmailSender.send` / `EsignProvider.createAndSend` を呼ぶ経路は型として存在しない
// （`packages/connectors/src/send-attempt-token.test.ts` の型テスト）。だが **`as SendAttemptToken` を 1 行書けば
// その担保は静かに全部消える**。「取引先への二重送信 0 件」（`CLAUDE.md` §7 / §3.4）を守っているのは型そのものではなく、
// 「型を握り潰す記述がどこにも無い」という構造であり、それを見張れるのは静的検査だけである
// （`tests/static/masked-text-single-path.test.ts` の `MaskedText` と同じ規律）。
//
// 検査は 2 つ:
//   ① `x as SendAttemptToken` / `x as unknown as SendAttemptToken` / `<SendAttemptToken>x` を書いてよいのは
//      `packages/db/src/send.ts` だけ（INSERT が 1 行返った直後の 1 箇所）
//   ② ブランドのシンボル名 `SendAttemptTokenBrand` に言及してよいのは宣言ファイル
//      `packages/domain/src/idempotency.ts` だけ（export して `[SendAttemptTokenBrand]: true` を書けるようにした瞬間に
//      ①の走査をすり抜ける組み立てが可能になる）
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..', '..');

const SCAN_ROOTS = ['apps', 'packages', 'prompts', 'scripts'];
const IGNORED_DIRECTORIES = new Set(['node_modules', '.next', 'dist', '.turbo', 'generated']);
const SOURCE_EXTENSIONS = new Set(['.ts', '.tsx', '.mts', '.cts']);

/** 🔴 `SendAttemptToken` へのキャストを書いてよい唯一のファイル（docs/05 §10.1「他に生成経路が無い」）。 */
const ALLOWED_BRANDING_SITES = ['packages/db/src/send.ts'];

/** 🔴 ブランドのシンボル名に言及してよい唯一のファイル（宣言そのもの）。 */
const ALLOWED_BRAND_DECLARATION_SITES = ['packages/domain/src/idempotency.ts'];

const TOKEN_TYPE_NAME = 'SendAttemptToken';
const BRAND_SYMBOL_NAME = 'SendAttemptTokenBrand';

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
 * 🔴 テストファイルは走査対象外（本リポジトリの全走査テストと同じ規約）。テストは型を意図的に崩して
 *    「崩れることの確認」をするのが仕事であり、ここで落とすと検査自体が形骸化する
 *    （`packages/connectors/src/mock/esign.test.ts` 等がモックの検証のためにトークンを偽造している）。
 *    「本番コードを `*.test.ts` に隠す」抜け道は `tests/static/no-test-module-imports.test.ts` が別途塞いでいる。
 */
function isTestFile(absolutePath: string): boolean {
  return /\.test\.(ts|tsx|mts|cts)$/.test(absolutePath);
}

type Findings = {
  readonly castsToToken: boolean;
  readonly mentionsBrand: boolean;
};

/** `x as SendAttemptToken` / `<SendAttemptToken>x` と、識別子 `SendAttemptTokenBrand` の出現を AST で数える。 */
function inspect(sourceText: string, fileName: string): Findings {
  const sourceFile = ts.createSourceFile(fileName, sourceText, ts.ScriptTarget.ES2023, true);
  let castsToToken = false;
  let mentionsBrand = false;
  function isTokenType(type: ts.TypeNode): boolean {
    return ts.isTypeReferenceNode(type) && type.typeName.getText(sourceFile) === TOKEN_TYPE_NAME;
  }
  function visit(node: ts.Node): void {
    if ((ts.isAsExpression(node) || ts.isTypeAssertionExpression(node)) && isTokenType(node.type)) {
      castsToToken = true;
    }
    if (ts.isIdentifier(node) && node.text === BRAND_SYMBOL_NAME) {
      mentionsBrand = true;
    }
    ts.forEachChild(node, visit);
  }
  visit(sourceFile);
  return { castsToToken, mentionsBrand };
}

describe('🔴 SendAttemptToken を作れる場所が 1 ファイルに閉じていること（docs/05 §10.1 / CLAUDE.md §3.4）', () => {
  const sourceFiles = SCAN_ROOTS.flatMap((root) => {
    const dir = path.join(repoRoot, root);
    try {
      return statSync(dir).isDirectory() ? listSourceFiles(dir) : [];
    } catch {
      return [];
    }
  }).filter((file) => !isTestFile(file));

  // 🔴 全ソースの AST 走査は `it` の外で 1 回だけ行う（`masked-text-single-path` と同じ整理。タイムアウト対策）。
  const findings = sourceFiles.map((file) => ({
    file: toRepoRelative(file),
    ...inspect(readFileSync(file, 'utf8'), file),
  }));
  const brandingSites = findings.filter((f) => f.castsToToken).map((f) => f.file).sort();
  const brandMentionSites = findings.filter((f) => f.mentionsBrand).map((f) => f.file).sort();

  it('対照: 走査対象のソースが十分にある（テストが空振りしていない）', () => {
    expect(sourceFiles.length).toBeGreaterThan(50);
  });

  it('対照: 走査対象に apps/** と packages/connectors/** が含まれている', () => {
    const files = findings.map((f) => f.file);
    expect(files.some((file) => file.startsWith('apps/'))).toBe(true);
    expect(files.some((file) => file.startsWith('packages/connectors/'))).toBe(true);
  });

  it('SendAttemptToken へキャストする非テストソースは許可リストと完全に一致する', () => {
    expect(brandingSites).toEqual([...ALLOWED_BRANDING_SITES].sort());
  });

  it('🔴 apps/** と packages/connectors/** に SendAttemptToken へのキャストが 1 つも無い（許可リストとは独立に固定）', () => {
    const forbidden = brandingSites.filter(
      (file) => file.startsWith('apps/') || file.startsWith('packages/connectors/'),
    );
    expect(forbidden).toEqual([]);
  });

  it('🔴 ブランドのシンボル名に言及するのは宣言ファイルだけである（export して組み立てる経路が無い）', () => {
    expect(brandMentionSites).toEqual([...ALLOWED_BRAND_DECLARATION_SITES].sort());
  });

  it('🔴 宣言ファイルはブランドを export していない（`declare const` のモジュール内シンボルのまま）', () => {
    const source = readFileSync(path.join(repoRoot, 'packages/domain/src/idempotency.ts'), 'utf8');
    expect(source).toMatch(/declare const SendAttemptTokenBrand: unique symbol;/);
    expect(source).not.toMatch(/export\s+(declare\s+)?const SendAttemptTokenBrand/);
    expect(source).not.toMatch(/export\s*\{[^}]*SendAttemptTokenBrand/);
  });

  it('🔴 許可されているのは 1 ファイルだけである（増やすときは docs/05 §10.1 と併せて人間が判断する）', () => {
    expect(ALLOWED_BRANDING_SITES).toHaveLength(1);
  });

  it('🔴 @ses/domain / @ses/db のバレルが無条件変換を公開していない', () => {
    for (const barrel of ['packages/domain/src/index.ts', 'packages/db/src/index.ts']) {
      const text = readFileSync(path.join(repoRoot, barrel), 'utf8');
      for (const forbidden of ['asSendAttemptToken', 'unsafeSendAttemptToken', 'sendAttemptTokenFor', 'forgeSendAttemptToken']) {
        expect(text).not.toContain(forbidden);
      }
    }
  });
});
