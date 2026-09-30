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

  it('⚠️ 現在の実体を明示的に固定する（0 件を「何も見ていない」で済ませない）', () => {
    // 🔴 **`T-22-06`（段② の一覧 ①）で列定義が実在するようになった。** 着手時（2026-09-30）の
    //    「列定義は 1 件も無い」という固定はここで**追随させた** —— 検出器の判定は 1 つも
    //    緩めていない（①②③④ の本体はそのままで、むしろ ④ が現に対象を持つようになった）。
    expect(definitions.length, '列定義が 0 件に戻った（`DataTable` の適用が失われていないか）').toBeGreaterThan(0);
    // 🔴 `T-22-06` の 3 画面 + `T-22-08` の `A-002` が現に列定義を持っている。
    const filesWithColumns = new Set(definitions.map((definition) => definition.file));
    for (const file of [
      'apps/web/app/(main)/engineers/engineer-ledger-screen.tsx',
      'apps/web/app/(main)/projects/project-list-screen.tsx',
      'apps/web/app/(main)/proposals/(list)/proposal-list-screen.tsx',
      'apps/web/app/admin/tenants/admin-tenants-list.tsx',
    ]) {
      expect(filesWithColumns, `${file} の列定義が見つからない`).toContain(file);
    }
    // 🔴 一方で「画面が自前で列を隠している」ソースは**まだ在る**（段② の残り 6 画面と段④）。
    //    ④ の対象が今後も生まれることの根拠であり、0 になったらこの固定を見直す。
    const selfHiding = appScanned.flatMap(({ file, source }) => hiddenColumnClassFindings(file, source));
    expect(
      selfHiding.length,
      '画面が自前で `hidden lg:table-cell` を書いている箇所が 0 になった。' +
        '全画面が `priority` へ移ったのなら、この固定を見直すこと',
    ).toBeGreaterThan(0);
    // 🔴 ④ は「列定義を持つ画面」に限って見る。移行済みの 3 画面に直書きが残っていない。
    expect(hiddenClassFindings).toEqual([]);
  });

  it('🔴 `T-22-06` の 3 画面の列の集合・並び・優先度が `docs/04` §10.3 / §S-0xx と一致する', () => {
    // 🔴 **これは「整形のついでに列を足していない」ことの機械側である**（`T-22-06` 受け入れ基準 2）。
    //    画面の render テストは「ロール別に描かれるか」を見るが、**列の順序と優先度の表**は
    //    ここで 1 箇所に固定する（§10.3 の表が一次資料。`docs/05` にも `packages/ui` にも写さない）。
    const columnsOf = (file: string): string[] =>
      definitions
        .filter((definition) => definition.file === file)
        .map((definition) => `${definition.id ?? '?'}:${definition.priority ?? '?'}${definition.hideable ? ':hideable' : ''}`);

    expect(columnsOf('apps/web/app/(main)/engineers/engineer-ledger-screen.tsx')).toEqual([
      'name:always',
      'ownership:lg',
      'skills:always',
      'unitPrice:sm',
      'availableFrom:always',
      'location:lg',
      'availability:sm',
      'updatedOn:lg',
    ]);
    expect(columnsOf('apps/web/app/(main)/projects/project-list-screen.tsx')).toEqual([
      'name:always',
      'status:always',
      'mustRequirements:lg',
      'unitPrice:always',
      'startDate:always',
      'location:sm',
      'headcount:lg',
      'updatedOn:sm',
      // 🔴 9 列目（ホストのみ）。§7.1「9 列目以降は列表示切替に格納する」。
      'visibility:lg:hideable',
    ]);
    expect(columnsOf('apps/web/app/(main)/proposals/(list)/proposal-list-screen.tsx')).toEqual([
      'state:always',
      'engineer:always',
      'recipient:always',
      'project:sm',
      'unitPrice:sm',
      'createdBy:lg',
      'updatedAt:lg',
      'elapsed:always',
    ]);
  });

  it('🔴 `T-22-08` の `A-002` の列の集合・並び・優先度が `docs/04` §10.3 改訂 21 と一致する', () => {
    // 🔴 **9 列である**（改訂 21 = 2026-09-30 に `docs/04` が実装の実測へ追随した）。
    //    優先度は §10.3 の `A-002` の行「優先度の低い列（先に隠す）: エンジニア数・案件数 → プラン →
    //    席数」を写す（`プラン` の列は実装に無い）。🔴 **`案件数` だけが `hideable`**（9 列目）であり、
    //    残り 8 列は `DATA_TABLE_MAX_VISIBLE_COLUMNS` の壁の内側に収まる。
    // 🔴 **列を増やすことは `BR-40` / `CLAUDE.md` §10.5 に触れる**（運営者に見せるものを増やす）。
    const columnsOf = (file: string): string[] =>
      definitions
        .filter((definition) => definition.file === file)
        .map((definition) => `${definition.id ?? '?'}:${definition.priority ?? '?'}${definition.hideable ? ':hideable' : ''}`);
    expect(columnsOf('apps/web/app/admin/tenants/admin-tenants-list.tsx')).toEqual([
      'name:always',
      'lifecycleState:always',
      'environment:always',
      'seats:sm',
      'partners:always',
      'engineers:lg',
      'projects:lg:hideable',
      'lastActivity:always',
      'health:always',
    ]);
  });

  it('🔴 `hideable` を持つ列があるのは `S-010` と `A-002` の 2 画面だけである（列を隠せる画面を増やさない）', () => {
    // 🔴 `hideable` は「切替に入る列」の宣言であり、**8 列の壁を通り抜ける唯一の口**である
    //    （`DataTable` は `hideable` を持つ列を数えない）。増やすには `docs/04` §7.1 / §10.3 の
    //    改訂が先であり、**画面の都合で足せない**（`CLAUDE.md` §8.7）。
    expect([...new Set(definitions.filter((definition) => definition.hideable).map((d) => d.file))].sort()).toEqual([
      'apps/web/app/(main)/projects/project-list-screen.tsx',
      'apps/web/app/admin/tenants/admin-tenants-list.tsx',
    ]);
  });

  it('🔴 `A-005` / `A-006` は `hideable` を 1 件も持たない（監視画面では列を隠さない。docs/04 §10.3）', () => {
    // 🔴 ①② の `it.each` と同じ事実を、**`A-005` / `A-006` について名指しで**固定する ——
    //    あちらは「`always` のみ」を見る形なので、**列定義が 0 件でも緑になる**（この 2 画面は
    //    `Table` プリミティブで組まれており列定義を持たない）。したがって
    //    「隠せる列が 1 つも無い」ことを、`hideable` の側からもう 1 本で言う。
    //    消えた列に運用者は気づけない（`F-059 AC-3` の材料が黙って落ちる）。
    const hideableIn = (fragment: string): string[] =>
      definitions
        .filter((definition) => definition.file.includes(fragment) && definition.hideable)
        .map((definition) => `${definition.file}:${definition.line} id=${definition.id ?? '?'}`);
    expect(hideableIn('app/admin/monitoring')).toEqual([]);
    expect(hideableIn('app/admin/audit-logs')).toEqual([]);
    // 🔴 画面が自前で `hideable` 相当を持たないこと（`priority` も `always` 以外を持たない）は
    //    ①② が見ている。ここは**その 2 画面が走査の射程に現に入っている**ことの対照である。
    const scannedAdminFiles = appScanned.filter(
      ({ file }) => file.includes('app/admin/monitoring/') || file.includes('app/admin/audit-logs/'),
    );
    expect(scannedAdminFiles.length, 'A-005 / A-006 のファイルが走査対象に無い').toBeGreaterThanOrEqual(6);
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

// ============================================================================
// 🔴 ⑤ `hideable` を持つ列がある画面は、**列表示切替を置いている**（`T-22-06` で追加）
// ============================================================================
// なぜこの検査が要るのか（実測で起きた抜け）:
// `T-22-06` は `S-010` の 9 列目に `hideable: true` を付けたが、**`DataTableColumnToggle` を
// どこにも置いていなかった**（デモ環境の `/projects` の HTML で確認）。結果として
// `docs/04` §7.1 の「既定 8 列 + 操作列。**9 列目以降は列表示切替に格納する**」が
// **満たされていないのに、①②③④ のどれも赤くならない**状態になっていた。
//
// 🔴 `hideable` は「切替に入る列」の**宣言**であって切替そのものではない。宣言だけが在ると
//    ①利用者は列を隠せない（条文が未達）②`DataTable` の 8 列の壁（`hideable` を持つ列は
//    数えない）を通り抜けられるため、**9 列目以降が「常に出ている 9 列目」として増えていく**。
//
// 判定: `hideable` を持つ列定義があるファイルは、**`@ses/ui/client` の `DataTableColumnToggle` へ
// 到達していること**。到達の形は 2 つだけである:
//   (a) そのファイル自身が `DataTableColumnToggle` を import している
//   (b) `DataTableColumnToggle` を import している**同一アプリ内のファイル**を相対 import している
//       （🔴 画面はサーバコンポーネントであり `@ses/ui/client` を直接 import できない
//        ——検査 (i)⑤。したがって薄い `'use client'` の配線を経由するのが正しい形である）

/** `@ses/ui/client` から `DataTableColumnToggle` を取り込んでいるか（= 切替を提供するファイル）。 */
export function importsColumnToggle(source: ts.SourceFile): boolean {
  let found = false;
  const visit = (node: ts.Node): void => {
    if (
      ts.isImportDeclaration(node) &&
      ts.isStringLiteralLike(node.moduleSpecifier) &&
      node.moduleSpecifier.text === '@ses/ui/client'
    ) {
      const bindings = node.importClause?.namedBindings;
      if (bindings !== undefined && ts.isNamedImports(bindings)) {
        if (
          bindings.elements.some(
            (element) => (element.propertyName ?? element.name).text === 'DataTableColumnToggle',
          )
        ) {
          found = true;
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return found;
}

/**
 * 相対 import の解決候補（リポジトリ相対・POSIX）。
 * 🔴 型解決を持たない AST 走査なので、拡張子と `index` の 4 通りを候補として返す
 *    （どれかが実在すれば到達したとみなす。**見つからなければ「到達していない = 落ちる」に倒れる**）。
 */
export function relativeImportTargets(file: string, source: ts.SourceFile): string[] {
  const directory = file.split('/').slice(0, -1).join('/');
  const targets: string[] = [];
  const visit = (node: ts.Node): void => {
    const specifier =
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier !== undefined
        ? node.moduleSpecifier
        : undefined;
    if (specifier !== undefined && ts.isStringLiteralLike(specifier) && specifier.text.startsWith('.')) {
      const base = path.posix.normalize(path.posix.join(directory, specifier.text)).replace(/\.js$/, '');
      targets.push(`${base}.tsx`, `${base}.ts`, `${base}/index.tsx`, `${base}/index.ts`);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return targets;
}

const columnToggleProviders = new Set(
  appScanned.filter(({ source }) => importsColumnToggle(source)).map(({ file }) => file),
);

/** `hideable` を持つ列定義があるファイル（= 切替が要る画面）。 */
const hideableColumnFiles = [...new Set(definitions.filter((definition) => definition.hideable).map((d) => d.file))];

function reachesColumnToggle(file: string): boolean {
  if (columnToggleProviders.has(file)) return true;
  const scanned = appScanned.find((entry) => entry.file === file);
  if (scanned === undefined) return false;
  return relativeImportTargets(file, scanned.source).some((target) => columnToggleProviders.has(target));
}

describe('🔴 (m)⑤ `hideable` を持つ列がある画面は列表示切替を置いている（docs/04 §7.1 / T-22-06）', () => {
  it('走査が空振りしていない（`hideable` を持つ画面と、切替を提供するファイルが現に在る）', () => {
    expect(
      hideableColumnFiles.length,
      '`hideable` を持つ列が 0 件になった。9 列目が消えたのなら、この固定を見直すこと',
    ).toBeGreaterThan(0);
    // 🔴 `T-22-06` の `S-010`（9 列目 = 公開先の設定状況）。
    expect(hideableColumnFiles).toContain('apps/web/app/(main)/projects/project-list-screen.tsx');
    expect(
      columnToggleProviders.size,
      '`@ses/ui/client` の `DataTableColumnToggle` を取り込んでいるファイルが 1 つも無い',
    ).toBeGreaterThan(0);
  });

  it('🔴 `hideable` を持つ画面がすべて列表示切替へ到達している', () => {
    expect(
      hideableColumnFiles.filter((file) => !reachesColumnToggle(file)),
      '🔴 docs/04 §7.1「既定 8 列 + 操作列。9 列目以降は列表示切替に格納する」: ' +
        '`hideable` を付けただけでは利用者が列を隠す手段が無く、条文が満たされない。' +
        '`DataTableColumnToggle`（`@ses/ui/client`）を `Toolbar` に置くこと（`S-010` の実装が手本）。' +
        '画面はサーバコンポーネントのままにするため、薄い `use client` の配線を経由する（検査 (i)⑤）',
    ).toEqual([]);
  });
});

// ============================================================================
// 対照: ⑤ の検出器（合成ソース）
// ============================================================================
describe('対照: (m)⑤ の検出器', () => {
  const parseSource = (text: string, name = 'apps/web/app/x.tsx'): ts.SourceFile =>
    ts.createSourceFile(name, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);

  it('`@ses/ui/client` からの `DataTableColumnToggle` の import を拾う', () => {
    expect(
      importsColumnToggle(parseSource("import { DataTableColumnToggle } from '@ses/ui/client';")),
    ).toBe(true);
    expect(
      importsColumnToggle(
        parseSource("import { Dialog, DataTableColumnToggle as Toggle } from '@ses/ui/client';"),
      ),
    ).toBe(true);
  });

  it('🔴 名前だけ・別モジュール・コメントは拾わない（「置いたつもり」を通さない）', () => {
    expect(importsColumnToggle(parseSource("import { Dialog } from '@ses/ui/client';"))).toBe(false);
    // 🔴 主バレル（`@ses/ui`）には無い部品である（あると Radix を全画面が引き込む）。
    expect(importsColumnToggle(parseSource("import { DataTableColumnToggle } from '@ses/ui';"))).toBe(
      false,
    );
    expect(importsColumnToggle(parseSource("// import { DataTableColumnToggle } from '@ses/ui/client';"))).toBe(
      false,
    );
  });

  it('相対 import を候補パスに解決する（`.js` 付き・親ディレクトリを含む）', () => {
    expect(
      relativeImportTargets(
        'apps/web/app/(main)/projects/project-list-screen.tsx',
        parseSource("import { ColumnToggle } from '../../_components/column-toggle';"),
      ),
    ).toContain('apps/web/app/_components/column-toggle.tsx');
    expect(
      relativeImportTargets('apps/web/app/x.tsx', parseSource("import { A } from './a.js';")),
    ).toContain('apps/web/app/a.tsx');
  });

  it('🔴 パッケージからの import は相対 import として数えない', () => {
    expect(relativeImportTargets('apps/web/app/x.tsx', parseSource("import { A } from '@ses/ui';"))).toEqual([]);
  });

  it('🔴 `S-010` が現に (b) の形（薄い配線経由）で到達している', () => {
    expect(reachesColumnToggle('apps/web/app/(main)/projects/project-list-screen.tsx')).toBe(true);
    // 🔴 到達していない画面では false になる（`S-005` は `hideable` を 1 列も持たないため
    //    切替を置いていない = ⑤ の対象ではない）。**判定が常に true を返していないことの対照**である。
    expect(reachesColumnToggle('apps/web/app/(main)/engineers/engineer-ledger-screen.tsx')).toBe(false);
  });
});
