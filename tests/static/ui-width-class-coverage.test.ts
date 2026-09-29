// tests/static/ui-width-class-coverage.test.ts
// 🔴 `docs/05` §17.7.1 **(k)**: **すべての画面が幅クラスを 1 つ持つ**（`docs/04` `U-23`）。
//
// ============================================================================
// なぜこの検査が要るのか
// ============================================================================
// `docs/04` §7.1 / `U-23` は 🔴 **全画面に A 全幅 / B 分割 / C 読み幅 720px のいずれかを
// 割り当てる**と定めている。(c)（`ui-screen-width.test.ts`）が「画面が自分で幅を決めていない」
// ことを見ても、それだけでは **どこにも幅の指定が無い画面**が既定幅に落ちるのを止められない。
// **2 つで 1 組である。**
//
//   (c) = 画面が `max-w-*` / `style` の width を書かない
//   (k) = 画面が `PageBody` に `widthClass` を**ちょうど 1 回**渡す
//
// 🔴 **渡していない / 2 回渡している画面があれば FAIL**（`docs/05` §17.7.1 (k)）。2 回は
//    「入れ子の `PageBody`」か「条件分岐で違う幅」を意味し、どちらも `U-23` の 1 画面 1 クラスに反する。
// 🔴 **画面数の期待値をここに書かない**（`docs/05` §17.7.1 (k)）—— 60 という数は `docs/04` が持つ。
//    ここが数を持つと画面追加のたびに 2 箇所を直すことになる。走査は `app/**/page.tsx` の実在に従い、
//    **認証前の画面（`(auth)/**`）も含むすべて**を見る。
//
// ⚠️ **着手時（2026-09-30）は `PageBody` がまだ存在しない**（`T-22-04` が作る）。したがって
//    実在する 43 ルートすべてが許可リストに載っている。段が進むごとに削られ、段⑤ で空になる
//    （`SP-22` §4.1）。**「後で有効にする」で終わらないのは、ラチェットの ②（未使用なら落ちる）が
//    働くためである。**
import { describe, expect, it } from 'vitest';
import path from 'node:path';
import ts from 'typescript';
import { collectSourceFiles, readSource, repoRoot, toRepoRelative } from './support/ui-classes.js';
import { describeRatchetInvariants, violationLinesByFile } from './support/ui-ratchet.js';
import { UI_RATCHET_ALLOWLIST_K } from './support/ui-ratchet-allowlist.js';
import { UI_RATCHET_BASELINE_K } from './support/ui-ratchet-baseline.js';

const APP_ROOT = path.join(repoRoot, 'apps', 'web', 'app');

/**
 * `widthClass` 属性の出現数を AST で数える。
 * 🔴 **JSX 属性に限る**（コメントや文言の中の `widthClass` を数えない）。要素名は見ない ——
 *    `PageBody` を薄く包んだ画面固有のラッパを許すが、**`widthClass` を素通しさせる**形になるので
 *    「1 画面に 1 つ」の性質は保たれる。
 */
export function widthClassAttributeCount(source: ts.SourceFile): number {
  let count = 0;
  const visit = (node: ts.Node): void => {
    if (ts.isJsxAttribute(node) && node.name.getText(source) === 'widthClass') count += 1;
    ts.forEachChild(node, visit);
  };
  visit(source);
  return count;
}

type Finding = { readonly file: string; readonly line: number; readonly count: number };

const routes = collectSourceFiles(APP_ROOT, ['.tsx']).filter((absolute) => path.basename(absolute) === 'page.tsx');

const findings: Finding[] = routes.flatMap((absolute) => {
  const source = ts.createSourceFile(absolute, readSource(absolute), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const count = widthClassAttributeCount(source);
  return count === 1 ? [] : [{ file: toRepoRelative(absolute), line: 1, count }];
});
const actual = violationLinesByFile(findings);

describeRatchetInvariants({
  label: '(k) 幅クラスの網羅',
  allowlist: UI_RATCHET_ALLOWLIST_K,
  baseline: UI_RATCHET_BASELINE_K,
  actual,
  scannedFileCount: 128,
});

describe('🔴 (k) 画面が幅クラスをちょうど 1 つ持つ（許可リストの外）', () => {
  it('`widthClass` を渡していない / 2 回渡している画面が無い', () => {
    const violations = findings
      .filter((finding) => !UI_RATCHET_ALLOWLIST_K.has(finding.file))
      .map((finding) => `${finding.file}: widthClass の出現 ${finding.count} 回（1 回でなければならない）`);
    expect(
      violations,
      '🔴 docs/04 §7.1 / U-23: 全画面が A 全幅 / B 分割 / C 読み幅 720px のいずれか 1 つを持つ。' +
        '渡さないと既定幅に落ち、2 回渡すと「条件で幅が変わる画面」になる',
    ).toEqual([]);
  });

  it('🔴 走査が `app/**/page.tsx` の実在に従っている（画面数の期待値を持たない）', () => {
    // 数そのものを固定しない（docs/04 が持つ）。代わりに主平面・管理平面・認証前が入っていることを見る。
    const files = routes.map(toRepoRelative);
    expect(files.length).toBeGreaterThan(0);
    expect(files.some((file) => file.startsWith('apps/web/app/(main)/'))).toBe(true);
    expect(files.some((file) => file.startsWith('apps/web/app/admin/'))).toBe(true);
    expect(files.some((file) => file.includes('/(auth)/'))).toBe(true);
    expect(files.every((file) => file.endsWith('/page.tsx'))).toBe(true);
    // 🔴 `*.render.test.tsx` を数えていない（凍結の射程は実装側）。
    expect(files.some((file) => /\.test\.tsx$/.test(file))).toBe(false);
  });

  it('走査が空振りしていない（着手時は `PageBody` が未実装で全ルートが違反である）', () => {
    expect(findings.length).toBeGreaterThan(0);
  });
});

// ============================================================================
// 対照: 検出器が「何を拾い / 何を拾わないか」（合成ソース）
// ============================================================================
describe('対照: (k) の検出器', () => {
  const parse = (text: string): ts.SourceFile =>
    ts.createSourceFile('page.tsx', text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);

  it('`widthClass` を 1 回渡していれば 1 を返す', () => {
    expect(widthClassAttributeCount(parse('export default () => <PageBody widthClass="full">x</PageBody>;'))).toBe(1);
  });

  it('🔴 渡していない画面は 0 を返す（既定幅に落ちる形を検出する）', () => {
    expect(widthClassAttributeCount(parse('export default () => <PageBody>x</PageBody>;'))).toBe(0);
    expect(widthClassAttributeCount(parse('export default () => <main className="p-4">x</main>;'))).toBe(0);
  });

  it('🔴 2 回渡している画面は 2 を返す（入れ子 / 条件分岐で幅が変わる形を検出する）', () => {
    expect(
      widthClassAttributeCount(
        parse('export default () => <PageBody widthClass="full"><PageBody widthClass="prose">x</PageBody></PageBody>;'),
      ),
    ).toBe(2);
  });

  it('🔴 コメント・文言・変数名の中の `widthClass` を数えない', () => {
    expect(
      widthClassAttributeCount(
        parse(
          [
            '// widthClass についての説明',
            'const widthClass = "full";',
            'export default () => <PageBody title="widthClass">x</PageBody>;',
          ].join('\n'),
        ),
      ),
    ).toBe(0);
  });

  it('式で渡していても数える（`widthClass={w}`）', () => {
    expect(widthClassAttributeCount(parse('export default () => <PageBody widthClass={w}>x</PageBody>;'))).toBe(1);
  });
});
