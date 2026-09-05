// tests/static/provider-quota-hold.test.ts
// 🔴 docs/05 §17.2 #19「hold-release の追補（§8.3-Q）」の 3 項目を、コードの構造として固定する。T-04-04。
//
//   ① `email.dispatch` / `account.mail` のハンドラで、`decideProviderQuota` の `HOLD` と
//      `ProviderQuotaExceededError` の catch が **`status='HELD_PROVIDER_QUOTA'` への更新で終わり**、
//      再 throw・`FAILED` 更新・`failureReason` 書込のいずれにも到達しない
//   ② `send.hold-release` が走査する `EmailDispatch.status` の集合が
//      `{'HELD_DOMAIN_UNVERIFIED','HELD_PROVIDER_QUOTA'}` と一致する
//      （🔴 **スナップショットで固定する。CHECK の 7 値から `HELD_` 接頭辞を持つものを導出して比較** =
//       列挙式にしない）
//   ③ `packages/domain/src/quota/provider.ts` が `Date.now` / `process.env` を参照しない
//      （#14 と同じ検査を、この 1 ファイルに対して個別に固定する）
//
// 🔴 なぜ静的テストが要るか: ①は「保留が失敗に化けていないこと」の担保であり、
//    実行時テストは「今その分岐を通る入力」でしか確かめられない。将来 `settleFailure` に
//    分岐が増えたとき、保留の経路だけが `FAILED` 側へ落ちても実行時テストは緑のままになりうる。
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { EMAIL_DISPATCH_STATUSES } from '../../packages/db/src/schema-value-sets.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..', '..');

const EMAIL_SEND_FILE = path.join(repoRoot, 'apps', 'worker', 'src', 'jobs', 'email-send.ts');
const HOLD_RELEASE_FILE = path.join(repoRoot, 'apps', 'worker', 'src', 'jobs', 'send-hold-release.ts');
const DB_EMAIL_DISPATCH_FILE = path.join(repoRoot, 'packages', 'db', 'src', 'email-dispatch.ts');
const PROVIDER_QUOTA_FILE = path.join(repoRoot, 'packages', 'domain', 'src', 'quota', 'provider.ts');

function parse(file: string): ts.SourceFile {
  return ts.createSourceFile(
    file,
    readFileSync(file, 'utf8'),
    ts.ScriptTarget.ES2023,
    true,
    ts.ScriptKind.TS,
  );
}

/**
 * 🔴 コメントを落としたコードだけを検査対象にする。
 *    このファイルの検査対象（`failureReason` を書かない / 上限値をハードコードしない）は
 *    **コメントで説明されている**ため、素のテキストを見ると必ず誤検知する。
 *    TypeScript のトランスパイラに落とさせるのが最も確実である（自前の正規表現より安全）。
 */
function stripComments(text: string): string {
  return ts.transpileModule(text, {
    compilerOptions: { removeComments: true, target: ts.ScriptTarget.ES2023 },
  }).outputText;
}

/** ある関数・ブロックの部分木を集める。 */
function collect(node: ts.Node, predicate: (node: ts.Node) => boolean): ts.Node[] {
  const found: ts.Node[] = [];
  const visit = (current: ts.Node): void => {
    if (predicate(current)) found.push(current);
    ts.forEachChild(current, visit);
  };
  visit(node);
  return found;
}

/**
 * 🔴 「`HELD_PROVIDER_QUOTA` を扱うブロック」を取り出す。
 *
 * 具体的には `holdEmailDispatch(...)` の引数に `'HELD_PROVIDER_QUOTA'` を渡している呼び出しを含む
 * **直近の Block** である。①はこのブロックの中身だけを見る（ブロックの外に `FAILED` の更新が
 * あるのは正常 —— 本当に失敗した経路のためのものである）。
 */
function holdProviderQuotaBlocks(sourceFile: ts.SourceFile): ts.Node[] {
  const calls = collect(
    sourceFile,
    (node) =>
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === 'holdEmailDispatch' &&
      node.getText(sourceFile).includes("'HELD_PROVIDER_QUOTA'"),
  );
  return calls.map((call) => {
    let current: ts.Node = call;
    while (current.parent !== undefined && !ts.isBlock(current.parent)) current = current.parent;
    return current.parent ?? current;
  });
}

const FORBIDDEN_IN_HOLD_BLOCK = ['failEmailDispatch', 'suppressEmailDispatch'];

describe('🔴 ① 保留（HELD_PROVIDER_QUOTA）が失敗に化けない（docs/05 §17.2 #19-①）', () => {
  const sourceFile = parse(EMAIL_SEND_FILE);
  const blocks = holdProviderQuotaBlocks(sourceFile);

  it('対照: `HELD_PROVIDER_QUOTA` に置く箇所が 2 つある（事前判定と事後の安全網）', () => {
    // ③の事前判定（`decideProviderQuota` の HOLD）と、⑤の事後の安全網
    // （`ProviderQuotaExceededError` の catch）の 2 箇所（docs/05 §8.3-Q ④ / ⑤）。
    expect(blocks.length).toBe(2);
  });

  it.each(FORBIDDEN_IN_HOLD_BLOCK)('保留のブロックに %s が現れない（失敗として記録しない）', (name) => {
    for (const block of blocks) {
      const calls = collect(
        block,
        (node) =>
          ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === name,
      );
      expect(calls).toEqual([]);
    }
  });

  it('🔴 保留のブロックに `failureReason` の書き込みが現れない', () => {
    for (const block of blocks) {
      expect(stripComments(block.getText(sourceFile))).not.toContain('failureReason');
    }
  });

  it('🔴 保留のブロックに `throw` が現れない（`attempts: 3` に乗せない）', () => {
    for (const block of blocks) {
      expect(collect(block, ts.isThrowStatement)).toEqual([]);
    }
  });

  it("🔴 保留のブロックに `status: 'FAILED'` が現れない", () => {
    for (const block of blocks) {
      expect(stripComments(block.getText(sourceFile))).not.toContain("'FAILED'");
    }
  });

  it('対照: 検査が空振りしていない（`FAILED` の確定はファイル内の別の場所に存在する）', () => {
    expect(sourceFile.getText()).toContain('failEmailDispatch');
  });
});

describe('🔴 ② send.hold-release の走査対象（docs/05 §17.2 #19-②）', () => {
  /**
   * 🔴 CHECK の 7 値（`EMAIL_DISPATCH_STATUSES`）から `HELD_` 接頭辞を持つものを**導出**する。
   *    列挙式に書き写すと、値が増えたときに片方だけ古くなり、
   *    **新しい保留が永久に復帰しない**（`send.hold-release` の走査から漏れる）。
   */
  const derived = EMAIL_DISPATCH_STATUSES.filter((status) => status.startsWith('HELD_'));

  it('導出した集合がスナップショットと一致する', () => {
    expect([...derived].sort()).toEqual(['HELD_DOMAIN_UNVERIFIED', 'HELD_PROVIDER_QUOTA']);
  });

  it('🔴 `EMAIL_DISPATCH_HOLD_STATUSES` は列挙ではなく導出で作られている（`filter` を通る）', () => {
    const text = readFileSync(DB_EMAIL_DISPATCH_FILE, 'utf8');
    const declaration = text.slice(text.indexOf('export const EMAIL_DISPATCH_HOLD_STATUSES'));
    expect(declaration).toContain('EMAIL_DISPATCH_STATUSES.filter');
    // 🔴 導出のはずの場所に値をベタ書きしていない。
    expect(declaration.slice(0, declaration.indexOf(';'))).not.toContain("'HELD_DOMAIN_UNVERIFIED'");
  });

  it('🔴 走査クエリが `EMAIL_DISPATCH_HOLD_STATUSES` を使う（状態名を SQL にベタ書きしない）', () => {
    const text = readFileSync(DB_EMAIL_DISPATCH_FILE, 'utf8');
    const fn = text.slice(text.indexOf('export async function listHeldEmailDispatches'));
    expect(fn).toContain('EMAIL_DISPATCH_HOLD_STATUSES');
  });

  it('🔴 `send.hold-release` のコードに保留以外の状態リテラルが現れない（3 つ目の分岐を作っていない）', () => {
    const code = stripComments(readFileSync(HOLD_RELEASE_FILE, 'utf8'));
    const mentioned = EMAIL_DISPATCH_STATUSES.filter((status) => code.includes(`'${status}'`));
    // 🔴 走査対象は `listHeldEmailDispatches`（= 導出された集合）が決めるので、
    //    ハンドラ側に状態リテラルが現れるとしても保留の 2 値以外であってはならない。
    //    `SENT` / `FAILED` / `SUPPRESSED` を書いた分岐が生えたら落ちる。
    expect(mentioned.filter((status) => !derived.includes(status))).toEqual([]);
  });
});

describe('🔴 ③ decideProviderQuota の純粋性（docs/05 §17.2 #19-③）', () => {
  const sourceFile = parse(PROVIDER_QUOTA_FILE);
  const text = sourceFile.getText();

  it('`Date.now` を参照しない', () => {
    const calls = collect(
      sourceFile,
      (node) =>
        ts.isCallExpression(node) &&
        ts.isPropertyAccessExpression(node.expression) &&
        ts.isIdentifier(node.expression.expression) &&
        node.expression.expression.text === 'Date',
    );
    expect(calls.map((node) => node.getText(sourceFile))).toEqual([]);
  });

  it('`new Date()` を作らない（現在時刻は引数で受け取る）', () => {
    const news = collect(
      sourceFile,
      (node) =>
        ts.isNewExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 'Date',
    );
    expect(news.map((node) => node.getText(sourceFile))).toEqual([]);
  });

  it('`process.env` / `process.*` を参照しない（上限値は引数で受け取る）', () => {
    const refs = collect(
      sourceFile,
      (node) =>
        (ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)) &&
        ts.isIdentifier(node.expression) &&
        node.expression.text === 'process',
    );
    expect(refs.map((node) => node.getText(sourceFile))).toEqual([]);
  });

  it('🔴 上限値をハードコードしていない（`MAIL_PROVIDER_DAILY_QUOTA` の値をベタ書きしない）', () => {
    // 🔴 200（SES サンドボックスの枠）が**コード**に現れたら、設定の出所が 2 つになる。
    //    コメントには説明として現れてよいので、コメントを落としてから見る。
    expect(stripComments(text)).not.toMatch(/\b200\b/);
  });

  it('対照: このファイルが実際に判定を持っている（空振りしていない）', () => {
    expect(text).toContain('export function decideProviderQuota');
  });
});
