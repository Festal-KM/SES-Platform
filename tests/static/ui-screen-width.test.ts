// tests/static/ui-screen-width.test.ts
// 🔴 `docs/05` §17.7.1 **(c)**: **画面ファイルに幅の指定が無い。**
//
// ============================================================================
// なぜこの検査が要るのか
// ============================================================================
// `docs/04` §7.1 / `U-23` の実測: 画面ごとの `max-w-*`（`max-w-3xl` = 768px が 12 箇所）のため、
// 🔴 **1920px のディスプレイでも一覧が 768px に絞られている。** 幅は画面ごとの判断ではなく
// **A 全幅 / B 分割 / C 読み幅 720px の 3 クラス**（`docs/04` §7.1）で決まり、その実装は
// `PageBody` と `DataTable` の列定義**だけ**が持つ（`docs/05` §2.3.4）。
//
// 検査（(c) の ①②）:
//   ① `apps/web/app/**/*.tsx` に `max-w-` が現れない
//   ② 同じ範囲に `style` 属性による `width` / `maxWidth` / `minWidth` が現れない
//   🔴 **`packages/ui/src/**` は対象外**（`PageBody` / `NameCell` / `DataTable` が唯一の置き場所である。
//      任意寸法〔`w-90` / `max-w-180`〕は `PageBody` の中だけに存在する = `docs/04` §7.1）
//
// ⚠️ **幅クラスを「渡しているか」は (k)（`ui-width-class-coverage.test.ts`）が見る。**
//    本ファイルは「画面が自分で幅を決めていないこと」だけを見る。2 つで 1 組である
//    （片方だけだと「幅を書かないが幅クラスも渡さない」= 既定幅に落ちる画面が通ってしまう）。
import { describe, expect, it } from 'vitest';
import path from 'node:path';
import ts from 'typescript';
import {
  MAX_WIDTH_UTILITY,
  classTokensOf,
  collectSourceFiles,
  maxWidthValueOf,
  readSource,
  repoRoot,
  toRepoRelative,
} from './support/ui-classes.js';
import {
  describeRatchetInvariants,
  scanClassFixtures,
  violationLinesByFile,
} from './support/ui-ratchet.js';
import { UI_RATCHET_ALLOWLIST_C } from './support/ui-ratchet-allowlist.js';
import { UI_RATCHET_BASELINE_C } from './support/ui-ratchet-baseline.js';

const APP_ROOT = path.join(repoRoot, 'apps', 'web', 'app');

type Finding = { readonly file: string; readonly line: number; readonly token: string };

/**
 * ② `style={{ width: … }}` / `maxWidth` / `minWidth`。
 * 🔴 **クラスだけを見ると `style` で同じことができる**（`usage-screen.tsx` の進捗バーが実例）。
 *    走査は AST の JSX 属性に限る（文字列の中の `width` を拾わない）。
 */
export function inlineWidthFindings(file: string, source: ts.SourceFile): Finding[] {
  const findings: Finding[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isJsxAttribute(node) && node.name.getText(source) === 'style') {
      const text = node.getText(source);
      const matched = ['width', 'maxWidth', 'minWidth'].filter((key) => new RegExp(`\\b${key}\\b`).test(text));
      if (matched.length > 0) {
        findings.push({
          file,
          line: source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1,
          token: `style:${matched.join('/')}`,
        });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return findings;
}

function parse(absolute: string, text: string): ts.SourceFile {
  return ts.createSourceFile(absolute, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
}

const scanned = collectSourceFiles(APP_ROOT, ['.tsx']);
const findings: Finding[] = scanned.flatMap((absolute) => {
  const file = toRepoRelative(absolute);
  const text = readSource(absolute);
  const fromClasses = classTokensOf(text, absolute)
    .filter(({ token }) => maxWidthValueOf(token) !== null)
    .map(({ token, line }) => ({ file, line, token }));
  return [...fromClasses, ...inlineWidthFindings(file, parse(absolute, text))];
});
const actual = violationLinesByFile(findings);

describeRatchetInvariants({
  label: '(c) 画面の幅指定',
  allowlist: UI_RATCHET_ALLOWLIST_C,
  baseline: UI_RATCHET_BASELINE_C,
  actual,
  scannedFileCount: scanned.length,
});

describe('🔴 (c) apps/web/app に幅の指定が無い（許可リストの外）', () => {
  it('① `max-w-*` / ② `style` の width が 1 件も無い', () => {
    const violations = findings
      .filter((finding) => !UI_RATCHET_ALLOWLIST_C.has(finding.file))
      .map((finding) => `${finding.file}:${finding.line} ${finding.token}`);
    expect(
      violations,
      '🔴 幅は `PageBody` の 3 クラス（full / split / prose）と `DataTable` の列定義が決める（docs/04 §7.1 / U-23）',
    ).toEqual([]);
  });

  it('🔴 `packages/ui/src/**` を対象にしていない（部品が唯一の置き場所である）', () => {
    expect(findings.some((finding) => finding.file.startsWith('packages/'))).toBe(false);
  });

  // ============================================================================
  // 🔴 段⑤（`T-22-14`）で違反が 0 件になった。**ここが「空振り」に化けないようにする**
  // ============================================================================
  // 旧実装は対照として **「移行中のファイルに現に違反が在る」**（= 本番の走査が非空）を見て
  // いた。許可リストが空になった以上その条件は成立しないが、🔴 **代わりに何も見ないと、
  // 検出器が壊れて 0 件になったときも「違反 0 件」が自明に真**になる（`testid-freeze.test.ts`
  // の「抽出器が 0 件になれば削除が無いも自明に真になる」と同じ穴）。
  // そこで対照を **2 つに置き換えた**:
  //   ① **走査が現にファイルを読み、クラス名候補を取り出している**（件数の下限）。
  //   ② **検出器が合成ソース（`__fixtures__/ui-classes/`）では現に違反を拾う**
  //      （このファイル下部の「対照」ブロック。**0 件の根拠はそこに在る**）。
  // 🔴 ② の「`style` 由来」の対照は下の「`style` の width / maxWidth / minWidth を拾う」
  //    （合成ソースの AST）と、`packages/ui` の `Meter`（塗り幅を持つ唯一の実装）である。
  it('🔴 違反が 0 件である（段⑤ で許可リストが空になり、本検査は無条件 green である）', () => {
    expect(findings).toEqual([]);
    expect(actual.size).toBe(0);
  });

  it('① 走査が現にファイルを読み、クラス名候補を取り出している（空振りの対照）', () => {
    expect(scanned.length).toBeGreaterThan(80);
    const tokens = scanned.flatMap((absolute) => classTokensOf(readSource(absolute), absolute));
    expect(tokens.length).toBeGreaterThan(1000);
    expect(tokens.some(({ token }) => token === 'w-full')).toBe(true);
  });
});

// ============================================================================
// 対照: 検出器が「何を拾い / 何を拾わないか」（合成ソース）
// ============================================================================
describe('対照: (c) の検出器', () => {
  it('① `max-w-*` を拾う（任意値・バリアント付きも）', () => {
    for (const token of ['max-w-3xl', 'max-w-sm', 'max-w-[96rem]', 'max-w-68', 'sm:max-w-md', 'lg:max-w-none']) {
      expect(maxWidthValueOf(token), token).not.toBeNull();
    }
  });

  it('🔴 `w-*` / `min-w-*` のクラスは (c) ① の対象ではない（`DataTable` の `minWidth` に写す寸法である）', () => {
    for (const token of ['w-4', 'w-full', 'min-w-40', 'max-h-64']) {
      expect(maxWidthValueOf(token), token).toBeNull();
    }
    expect(MAX_WIDTH_UTILITY.test('min-w-40')).toBe(false);
  });

  it('② `style` の width / maxWidth / minWidth を拾う', () => {
    const source = parse(
      'x.tsx',
      [
        'export const A = () => (',
        '  <div>',
        '    <span style={{ width: `${p}%` }} />',
        '    <span style={{ maxWidth: 200, color: "red" }} />',
        '    <span style={{ minWidth: 100 }} />',
        '  </div>',
        ');',
      ].join('\n'),
    );
    expect(inlineWidthFindings('x.tsx', source).map((finding) => `${finding.line}:${finding.token}`)).toEqual([
      '3:style:width',
      '4:style:maxWidth',
      '5:style:minWidth',
    ]);
  });

  it('🔴 `style` でも幅以外は拾わない / 文字列の中の `width` は拾わない（誤検知しない）', () => {
    const source = parse(
      'x.tsx',
      [
        'export const A = () => (',
        '  <div title="width of the panel">',
        '    <span style={{ color: "red" }} />',
        '    <span data-note="maxWidth" />',
        '  </div>',
        ');',
      ].join('\n'),
    );
    expect(inlineWidthFindings('x.tsx', source)).toEqual([]);
  });
});

describe('対照: fixtures の合成ソースをファイルから走査する（ファイル収集 → AST → 検出器）', () => {
  const fixtures = scanClassFixtures(maxWidthValueOf);

  it('🔴 違反を仕込んだファイルで検出される（検査が「何も見ていない」状態で緑になっていない）', () => {
    expect([...fixtures.violationTokens].sort()).toEqual(['max-w-3xl', 'sm:max-w-md']);
  });

  it('🔴 適合しているファイルでは 0 件である（誤検知しない。誤検知する検査はいずれ緩められる）', () => {
    expect(fixtures.cleanTokens).toEqual([]);
  });

  it('🔴 コメントの中に書いたクラス名を拾わない（規律を書き残した瞬間に落ちる検査にしない）', () => {
    // `violation.tsx` のコメントには同じ語が書いてある。拾っていたら件数が増える。
    expect(fixtures.violationTokens.length).toBe(2);
  });
});
