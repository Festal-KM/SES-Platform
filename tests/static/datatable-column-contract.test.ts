// tests/static/datatable-column-contract.test.ts
// 🔴 `docs/05` §17.7.1 **(m)**: **`DataTable` の列定義の契約**（`docs/05` §2.3.5 / `docs/04` §10.3）。
//
// ============================================================================
// なぜこの検査が要るのか
// ============================================================================
// 列の落とし方を部品（`priority`）に移す狙いは 🔴 **11 画面分の省略方針が 1 箇所で守られること**
// である（`docs/05` §2.3.5）。ところが列定義は「ただのデータ」なので、次の 3 つが静かに壊れる。
//
//   ① **`S-044` / `S-045`（越境経路 5）の列が増える / 減る** —— `CLAUDE.md` §3.1 経路 5 の
//      開示項目は `BR-66` の列挙だけであり、**項目を増やすことは人間の承認事項**（§8.6）。
//      `hideable` が付くと「隠せる = 増やしてもよい」の入口になる。
//   ② **`A-005` / `A-006`（運用監視・監査ログ横断）で列が隠れる** —— `docs/04` §10.3 は
//      🔴 **監視画面では列を隠さない**と定めている。失敗ジョブの一覧で「原因」の列が
//      境界によって消えると、運用者は消えたことに気づけない。
//   ③ **`selection` が渡される** —— Phase 1 に一括承認・一括共有解除は無い
//      （`S-015` の `F-016 AC-1` / `S-019` の `U-18`）。選択列が描かれると、
//      「選べるのに実行できない」画面になるか、そのまま一括実行の導線が足される。
//   ④ **部品と画面が二重に列を隠す** —— 画面側に `hidden lg:table-cell` が残ったまま
//      `priority` を付けると、**どちらが効いているか**が境界ごとに変わる。
//
// ============================================================================
// ⚠️ 着手時（2026-09-30）の状態と、この検査の射程
// ============================================================================
// `DataTable` は `T-22-04` が作る。`S-044` / `S-045` は **Phase 2 / 3 の画面であり未実装**である。
// したがって `docs/05` §17.7.1 (m) の 🔴 のとおり、**検査は「実在する画面について」見る形にし、
// 画面が追加された時点で自動で射程に入る**。
//
// 🔴 **だから「列定義が 0 件でも緑」で終わらせない。** 検出器そのものが働くことを
//    合成ソース（下の「対照」）で証明し、**いま 0 件であることを明示的に固定する**
//    （0 件でないのに 0 件扱いする、という空振りを起こさない）。
import path from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { collectSourceFiles, readSource, repoRoot, toRepoRelative } from './support/ui-classes.js';

const APP_ROOT = path.join(repoRoot, 'apps', 'web', 'app');
const UI_SRC = path.join(repoRoot, 'packages', 'ui', 'src');

/** `docs/05` §2.3.5 の `ColumnPriority`。 */
const COLUMN_PRIORITIES = ['always', 'lg', 'sm'] as const;

/** 🔴 `priority='always'` の列だけで構成しなければならない画面（`docs/05` §6.11.4 の表）。 */
const ALWAYS_ONLY_SCREENS: ReadonlyArray<readonly [screen: string, pathFragment: string, reason: string]> = [
  [
    'S-044',
    'app/(main)/assignments',
    '🔴 越境経路 5。開示は BR-66 の列挙だけであり、列を増やすことも減らすこともしない（CLAUDE.md §8.6）',
  ],
  [
    'S-045',
    'app/(main)/contracts',
    '🔴 越境経路 5。同上（BR-66）',
  ],
  [
    'A-005',
    'app/admin/monitoring',
    '🔴 運用監視では列を隠さない（docs/04 §10.3）。消えた列に運用者は気づけない',
  ],
  [
    'A-006',
    'app/admin/audit-logs',
    '🔴 監査ログ横断検索でも列を隠さない（docs/04 §10.3）',
  ],
];

type ColumnDefinition = {
  readonly file: string;
  readonly line: number;
  readonly id: string | null;
  readonly priority: string | null;
  readonly hideable: boolean;
};

function lineOf(source: ts.SourceFile, node: ts.Node): number {
  return source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;
}

function propertyName(property: ts.ObjectLiteralElementLike): string | null {
  if (!ts.isPropertyAssignment(property) && !ts.isShorthandPropertyAssignment(property)) return null;
  const name = property.name;
  return ts.isIdentifier(name) || ts.isStringLiteral(name) ? name.text : null;
}

/**
 * 列定義（`{ id, header, priority, minWidth, cell }`）のオブジェクトリテラルを拾う。
 * 🔴 **`priority` を持つオブジェクトリテラル**を列定義とみなす（型解決を持たない AST 走査なので、
 *    `docs/05` §2.3.5 で列定義だけが持つキーを目印にする）。
 */
export function columnDefinitions(file: string, source: ts.SourceFile): ColumnDefinition[] {
  const definitions: ColumnDefinition[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isObjectLiteralExpression(node)) {
      const names = node.properties.map(propertyName).filter((name): name is string => name !== null);
      if (names.includes('priority')) {
        const read = (key: string): ts.Expression | null => {
          const property = node.properties.find(
            (candidate): candidate is ts.PropertyAssignment =>
              ts.isPropertyAssignment(candidate) && propertyName(candidate) === key,
          );
          return property?.initializer ?? null;
        };
        const priorityNode = read('priority');
        const idNode = read('id');
        definitions.push({
          file,
          line: lineOf(source, node),
          id: idNode !== null && ts.isStringLiteralLike(idNode) ? idNode.text : null,
          priority: priorityNode !== null && ts.isStringLiteralLike(priorityNode) ? priorityNode.text : null,
          hideable: names.includes('hideable'),
        });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return definitions;
}

type Finding = { readonly file: string; readonly line: number; readonly detail: string };

/** ③ `selection` を渡す `DataTable` の呼び出し（JSX 属性 / props オブジェクトの両方）。 */
export function selectionFindings(file: string, source: ts.SourceFile): Finding[] {
  const findings: Finding[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isJsxAttribute(node) && node.name.getText(source) === 'selection') {
      findings.push({ file, line: lineOf(source, node), detail: 'selection 属性' });
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return findings;
}

/** ④ 画面側に直書きされた列の落とし方（`hidden lg:table-cell` / `hidden sm:table-cell`）。 */
const HIDDEN_AT_BREAKPOINT = /\bhidden\s+(?:sm|md|lg|xl|2xl):(?:table-cell|table-row|inline|block|flex|grid)\b/;

export function hiddenColumnClassFindings(file: string, source: ts.SourceFile): Finding[] {
  const findings: Finding[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
      if (HIDDEN_AT_BREAKPOINT.test(node.text)) {
        findings.push({ file, line: lineOf(source, node), detail: node.text });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return findings;
}

// ============================================================================
// 走査
// ============================================================================
const scanned = [
  ...collectSourceFiles(APP_ROOT, ['.ts', '.tsx']),
  ...collectSourceFiles(UI_SRC, ['.ts', '.tsx']),
].map((absolute) => ({
  file: toRepoRelative(absolute),
  source: ts.createSourceFile(absolute, readSource(absolute), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX),
}));

const appScanned = scanned.filter(({ file }) => file.startsWith('apps/web/'));
const definitions = appScanned.flatMap(({ file, source }) => columnDefinitions(file, source));
const selections = appScanned.flatMap(({ file, source }) => selectionFindings(file, source));

/** ④ の対象は「`priority !== 'always'` の列を持つ画面」だけである（部品が落とすようになった画面）。 */
const screensWithHideableColumns = new Set(
  definitions.filter((definition) => definition.priority !== 'always').map((definition) => definition.file),
);
const hiddenClassFindings = appScanned
  .filter(({ file }) => screensWithHideableColumns.has(file))
  .flatMap(({ file, source }) => hiddenColumnClassFindings(file, source));

describe('🔴 (m) DataTable の列定義の契約（docs/05 §17.7.1 (m) / §2.3.5）', () => {
  it('走査が空振りしていない（`apps/web/app` と `packages/ui/src` を現に読んでいる）', () => {
    expect(appScanned.length).toBeGreaterThan(80);
    expect(scanned.some(({ file }) => file.startsWith('packages/ui/src/'))).toBe(true);
  });

  it('列定義の `priority` が `always` / `lg` / `sm` のいずれかである', () => {
    const invalid = definitions
      .filter((definition) => definition.priority === null || !(COLUMN_PRIORITIES as readonly string[]).includes(definition.priority))
      .map((definition) => `${definition.file}:${definition.line} priority=${definition.priority ?? '(静的に読めない)'}`);
    expect(
      invalid,
      '🔴 docs/05 §2.3.5: `ColumnPriority` は 3 値である。式で渡すと §10.3 の表との照合ができない',
    ).toEqual([]);
  });

  it.each(ALWAYS_ONLY_SCREENS)('①② %s の列定義が `always` のみで `hideable` を持たない', (_screen, fragment, reason) => {
    const target = definitions.filter((definition) => definition.file.includes(fragment));
    const violations = target
      .filter((definition) => definition.priority !== 'always' || definition.hideable)
      .map(
        (definition) =>
          `${definition.file}:${definition.line} id=${definition.id ?? '?'} priority=${definition.priority ?? '?'}` +
          `${definition.hideable ? ' hideable' : ''}`,
      );
    expect(violations, reason).toEqual([]);
  });

  it('🔴 ③ `selection` を渡す `DataTable` の呼び出しが 0 件である（Phase 1）', () => {
    expect(
      selections.map((finding) => `${finding.file}:${finding.line} ${finding.detail}`),
      '🔴 docs/04 `U-18` / `F-016 AC-1`: 一括承認は Phase 2、一括の共有解除は作らない。' +
        '選択チェックボックスも一括のボタンも描かない（`selection` は省略が既定）',
    ).toEqual([]);
  });

  it('🔴 ④ 列を部品に落とさせている画面が `hidden lg:` / `hidden sm:` を直書きしていない', () => {
    expect(
      hiddenClassFindings.map((finding) => `${finding.file}:${finding.line} ${finding.detail}`),
      '🔴 docs/05 §2.3.5: 列の落とし方は `priority` が決める。画面側に残すと、どちらが効いているかが' +
        '境界ごとに変わり、§10.3 の 11 画面分の省略方針が 1 箇所で守られなくなる',
    ).toEqual([]);
  });

  it('⚠️ 着手時点の実体を明示的に固定する（0 件を「何も見ていない」で済ませない）', () => {
    // 🔴 `DataTable` は `T-22-04` が作る。列定義は 1 件も無い。
    expect(definitions).toEqual([]);
    // 🔴 一方で「画面が自前で列を隠している」ソースは現に在る（④ の対象が段② 以降に生まれることの根拠）。
    const selfHiding = appScanned.flatMap(({ file, source }) => hiddenColumnClassFindings(file, source));
    expect(
      selfHiding.length,
      '画面が自前で `hidden lg:table-cell` を書いている箇所が 0 になった。' +
        '列定義が入ったのなら ④ の対象になっているはずで、この固定を見直すこと',
    ).toBeGreaterThan(0);
    // ④ は「列定義を持つ画面」に限って見るので、いまは 0 件である（緩めていないことの確認）。
    expect(hiddenClassFindings).toEqual([]);
  });
});

// ============================================================================
// 対照: 検出器が「何を拾い / 何を拾わないか」（合成ソース）
// ============================================================================
describe('対照: (m) の検出器', () => {
  const parseText = (text: string, name = 'x.tsx'): ts.SourceFile =>
    ts.createSourceFile(name, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);

  it('列定義を拾い、`priority` / `hideable` / `id` を読む', () => {
    const source = parseText(
      [
        'const columns = [',
        "  { id: 'name', header: h, priority: 'always', minWidth: '10rem', cell: c },",
        "  { id: 'site', header: h, priority: 'lg', minWidth: '8rem', hideable: true, cell: c },",
        '];',
      ].join('\n'),
    );
    expect(columnDefinitions('x.tsx', source)).toEqual([
      { file: 'x.tsx', line: 2, id: 'name', priority: 'always', hideable: false },
      { file: 'x.tsx', line: 3, id: 'site', priority: 'lg', hideable: true },
    ]);
  });

  it('🔴 `priority` を持たないオブジェクトリテラルを列定義と誤認しない', () => {
    expect(columnDefinitions('x.tsx', parseText("const a = { id: 'x', header: 'y' };"))).toEqual([]);
    expect(columnDefinitions('x.tsx', parseText("const a = { priorityLabel: 'x' };"))).toEqual([]);
    // コメント中の列定義は拾わない。
    expect(columnDefinitions('x.tsx', parseText("// { id: 'x', priority: 'lg' }\nconst a = 1;"))).toEqual([]);
  });

  it('🔴 `priority` が式なら「静的に読めない」として拾う（照合を迂回させない）', () => {
    expect(columnDefinitions('x.tsx', parseText('const a = [{ id: "x", priority: p }];')).map((d) => d.priority)).toEqual([
      null,
    ]);
  });

  it('③ `selection` 属性を拾う', () => {
    expect(
      selectionFindings('x.tsx', parseText('export const A = () => <DataTable selection={s} columns={c} rows={r} />;')).map(
        (f) => f.detail,
      ),
    ).toEqual(['selection 属性']);
    expect(selectionFindings('x.tsx', parseText('export const A = () => <DataTable columns={c} rows={r} />;'))).toEqual([]);
  });

  it('④ `hidden lg:table-cell` 系を拾い、`hidden` 単独 / `lg:table-cell` 単独は拾わない', () => {
    expect(
      hiddenColumnClassFindings('x.tsx', parseText("const c = 'hidden lg:table-cell';")).map((f) => f.detail),
    ).toEqual(['hidden lg:table-cell']);
    expect(
      hiddenColumnClassFindings('x.tsx', parseText("const c = 'hidden sm:table-cell';")).map((f) => f.detail),
    ).toEqual(['hidden sm:table-cell']);
    expect(hiddenColumnClassFindings('x.tsx', parseText("const c = 'hidden';"))).toEqual([]);
    expect(hiddenColumnClassFindings('x.tsx', parseText("const c = 'lg:table-cell';"))).toEqual([]);
  });
});
