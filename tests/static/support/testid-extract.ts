// tests/static/support/testid-extract.ts
// 🔴 **`data-testid` の抽出器を 1 箇所に集める**（`docs/05` §17.4）。
//
// `tests/static/testid-inventory.test.ts`（実体 ⊇ `FROZEN_*`）と
// `tests/static/testid-freeze.test.ts`（実体 ⊇ 2026-09-30 のベースライン）は
// **同じ抽出器**を使う。抽出器を片方に置いてもう片方から import すると
// **テストモジュールの import になり、そのファイルの `describe` が二重に登録される**
// （テスト数が二重に数えられ、失敗の出所が読めなくなる）。よって support に出す。
//
// ⚙️ 抽出の規則と「なぜ AST か」の理由は
//    `tests/static/testid-inventory.test.ts` の冒頭にある（そちらが一次資料）。
import ts from 'typescript';

export const TESTID_PATTERN = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;
/** 動的 testid の静的接頭辞（末尾は必ず `-`。`engineer-list-row-` など）。 */
export const TESTID_PREFIX_PATTERN = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*-$/;

/**
 * 拾う属性名。`testId` は `data-testid={testId}` へ流れるプロパティ（冒頭コメント (2)）。
 * ✅ T-11-12: `linkTestId` は `@ses/ui` の `NameCell` が導線（`<a>`）の `data-testid` へ流す（`engineer-list-link-` /
 *    `project-list-link-` / `candidate-list-link-`）。凍結済みの接頭辞を `packages/ui` へ移した形なので、リストから
 *    消さずに走査対象（属性名）を足す（冒頭「凍結リストを直すとき」）。
 */
export const ATTRIBUTE_NAMES = new Set(['data-testid', 'testId', 'linkTestId']);

export type Extraction = {
  /** 完全一致で凍結する値。 */
  readonly exact: readonly string[];
  /** 静的接頭辞で凍結する値（末尾 `-`）。 */
  readonly prefixes: readonly string[];
  /** 静的に解決できなかった式（`testId` のような素の識別子）。 */
  readonly unresolved: readonly string[];
  /** 属性の出現回数（走査が空振りしていないことの対照に使う）。 */
  readonly occurrences: number;
};

/** 🔴 抽出器の本体。自己検査は末尾の `describe('抽出器そのものの検査', ...)` が行う。 */
export function extractTestIds(source: string, fileName = 'source.tsx'): Extraction {
  const sourceFile = ts.createSourceFile(
    fileName,
    source,
    ts.ScriptTarget.Latest,
    /* setParentNodes */ true,
    ts.ScriptKind.TSX,
  );
  const exact: string[] = [];
  const prefixes: string[] = [];
  const unresolved: string[] = [];
  let occurrences = 0;

  /** 値の式から静的に決まる部分を拾う。拾えたら true。 */
  function collectFrom(expression: ts.Expression): boolean {
    if (ts.isParenthesizedExpression(expression)) return collectFrom(expression.expression);
    if (ts.isStringLiteral(expression) || ts.isNoSubstitutionTemplateLiteral(expression)) {
      exact.push(expression.text);
      return true;
    }
    // `engineer-list-row-${row.id}` → 静的接頭辞は `head`（`${` の手前）。
    if (ts.isTemplateExpression(expression)) {
      prefixes.push(expression.head.text);
      return true;
    }
    // 🔴 三項演算子は**枝だけ**を見る（条件に書かれた列挙値は testid ではない）。
    if (ts.isConditionalExpression(expression)) {
      const whenTrue = collectFrom(expression.whenTrue);
      const whenFalse = collectFrom(expression.whenFalse);
      return whenTrue || whenFalse;
    }
    if (
      ts.isBinaryExpression(expression) &&
      (expression.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken ||
        expression.operatorToken.kind === ts.SyntaxKind.BarBarToken)
    ) {
      const left = collectFrom(expression.left);
      const right = collectFrom(expression.right);
      return left || right;
    }
    return false;
  }

  function visit(node: ts.Node): void {
    if (ts.isJsxAttribute(node) && ATTRIBUTE_NAMES.has(node.name.getText(sourceFile))) {
      occurrences += 1;
      const initializer = node.initializer;
      if (initializer !== undefined && ts.isStringLiteral(initializer)) {
        exact.push(initializer.text);
      } else if (
        initializer !== undefined &&
        ts.isJsxExpression(initializer) &&
        initializer.expression !== undefined &&
        !collectFrom(initializer.expression)
      ) {
        unresolved.push(initializer.expression.getText(sourceFile));
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(sourceFile);

  return { exact, prefixes, unresolved, occurrences };
}

// ============================================================================
// 🔴 `testIdPrefix` から組まれる testid の解決（`T-22-06` で追加）
// ============================================================================
// `T-22-04` の一覧の部品（`DataTable` / `Toolbar` / `Pagination` / `EmptyState`）は testid を
// **`${testIdPrefix}` + 固定の接尾辞**で組む。したがって部品側のソースだけを見ると
// 静的接頭辞は**空文字**であり、`engineer-list-table` / `engineer-list-row-` のような
// **凍結済みの値（`docs/04` `U-22`）がどのファイルにも現れない**ように見える。
//
// 🔴 **これは「testid が消えた」ではなく「抽出器が合成を知らない」である。** 製品側の testid を
//    部品に合わせて改名して回避してはならない（`SP-22` §3.2 / `T-22-04` の申し送り）。よって
//    **抽出器の側で合成を解く**。解き方は次の 2 段で、どちらも AST である。
//
//   ① 部品側: `data-testid={`${testIdPrefix}row-${key}`}` のような形から
//      **接尾辞**（`row-`）と**動的な尾があるか**を拾い、**囲む部品の名前**（`DataTable`）に紐づける。
//   ② 呼び出し側: `<DataTable testIdPrefix="engineer-list-" …>` から **要素名 → 接頭辞**を拾う。
//
// ③ 突き合わせ: 同じ要素名について ①×② を合成する（`engineer-list-` + `row-` → 接頭辞
//    `engineer-list-row-` / `engineer-list-` + `table` → 完全一致 `engineer-list-table`）。
//
// 🔴 **要素名で突き合わせる**（モジュール解決をしない）理由: 解けなかったときに起きるのは
//    「凍結値が見つからない = 検査が落ちる」であって、**緩む側に倒れない**。逆に接頭辞と接尾辞を
//    総当たりで掛けると、実際には描かれない値まで「在る」ことになって緩む。
// ⚠️ **合成は 1 段だけ解く。** 部品が別の部品へ `testIdPrefix={`${testIdPrefix}sort-`}` と
//    渡す形（`DataTable` → `DataTableSortLink`）は解かない —— 接頭辞がリテラルでないためである。
//    2026-09-30 の凍結値にこの形で組まれるものは 1 つも無く、**解けない場合は厳しい側に倒れる**。

/** 部品が `testIdPrefix` の後ろに置く固定文字列 1 件。 */
export type ComposedSuffix = {
  /** `${testIdPrefix}` の直後の静的文字列（`row-` / `table` / `''`）。 */
  readonly suffix: string;
  /** さらに動的な尾が続くか（続くなら合成結果は「接頭辞」である）。 */
  readonly dynamicTail: boolean;
};

/** 囲む関数（= 部品）の名前。見つからなければ `null`。 */
function enclosingComponentName(node: ts.Node, sourceFile: ts.SourceFile): string | null {
  for (let current: ts.Node | undefined = node.parent; current !== undefined; current = current.parent) {
    if (ts.isFunctionDeclaration(current) && current.name !== undefined) return current.name.getText(sourceFile);
    if (ts.isVariableDeclaration(current) && ts.isIdentifier(current.name)) return current.name.text;
  }
  return null;
}

/** JSX 要素のタグ名（`<DataTable …>` → `DataTable`）。 */
function jsxTagName(attribute: ts.JsxAttribute, sourceFile: ts.SourceFile): string | null {
  const attributes = attribute.parent;
  const element = attributes.parent;
  if (ts.isJsxSelfClosingElement(element) || ts.isJsxOpeningElement(element)) {
    return element.tagName.getText(sourceFile);
  }
  return null;
}

/**
 * ① 部品名 → その部品が `testIdPrefix` から組む接尾辞の集合。
 * 🔴 対象は `ATTRIBUTE_NAMES` の属性だけである（`testIdPrefix` を下流へ渡す形は対象外）。
 */
export function testIdSuffixesByComponent(
  source: string,
  fileName = 'source.tsx',
): Map<string, ComposedSuffix[]> {
  const sourceFile = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const found = new Map<string, ComposedSuffix[]>();
  const visit = (node: ts.Node): void => {
    if (ts.isJsxAttribute(node) && ATTRIBUTE_NAMES.has(node.name.getText(sourceFile))) {
      const initializer = node.initializer;
      if (
        initializer !== undefined &&
        ts.isJsxExpression(initializer) &&
        initializer.expression !== undefined &&
        ts.isTemplateExpression(initializer.expression)
      ) {
        const template = initializer.expression;
        const [first] = template.templateSpans;
        // 🔴 `${testIdPrefix}…` の形だけを解く（頭に文字があるものは接頭辞が合成でない）。
        if (template.head.text === '' && first !== undefined && first.expression.getText(sourceFile) === 'testIdPrefix') {
          const component = enclosingComponentName(node, sourceFile);
          if (component !== null) {
            const entries = found.get(component) ?? [];
            entries.push({ suffix: first.literal.text, dynamicTail: template.templateSpans.length > 1 });
            found.set(component, entries);
          }
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return found;
}

/** ② 要素名 → 呼び出し側がリテラルで渡した `testIdPrefix` の集合。 */
export function testIdPrefixArguments(source: string, fileName = 'source.tsx'): Map<string, string[]> {
  const sourceFile = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const found = new Map<string, string[]>();
  const record = (tag: string | null, value: string): void => {
    if (tag === null) return;
    const entries = found.get(tag) ?? [];
    entries.push(value);
    found.set(tag, entries);
  };
  const visit = (node: ts.Node): void => {
    if (ts.isJsxAttribute(node) && node.name.getText(sourceFile) === 'testIdPrefix') {
      const initializer = node.initializer;
      if (initializer !== undefined && ts.isStringLiteral(initializer)) {
        record(jsxTagName(node, sourceFile), initializer.text);
      } else if (
        initializer !== undefined &&
        ts.isJsxExpression(initializer) &&
        initializer.expression !== undefined &&
        (ts.isStringLiteral(initializer.expression) || ts.isNoSubstitutionTemplateLiteral(initializer.expression))
      ) {
        record(jsxTagName(node, sourceFile), initializer.expression.text);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return found;
}

/** ③ ①×② の突き合わせ（同じ要素名のものだけ）。 */
export function composeTestIds(
  files: readonly { readonly label: string; readonly source: string }[],
): { readonly exact: readonly string[]; readonly prefixes: readonly string[] } {
  const suffixes = new Map<string, ComposedSuffix[]>();
  const prefixes = new Map<string, string[]>();
  for (const file of files) {
    for (const [component, entries] of testIdSuffixesByComponent(file.source, file.label)) {
      suffixes.set(component, [...(suffixes.get(component) ?? []), ...entries]);
    }
    for (const [tag, values] of testIdPrefixArguments(file.source, file.label)) {
      prefixes.set(tag, [...(prefixes.get(tag) ?? []), ...values]);
    }
  }
  const exact: string[] = [];
  const composedPrefixes: string[] = [];
  for (const [tag, values] of prefixes) {
    for (const prefix of values) {
      for (const entry of suffixes.get(tag) ?? []) {
        (entry.dynamicTail ? composedPrefixes : exact).push(`${prefix}${entry.suffix}`);
      }
    }
  }
  return { exact, prefixes: composedPrefixes };
}

export type TestIdValueOrigin = {
  readonly line: number;
  readonly text: string;
  readonly kind: 'literal' | 'template' | 'prop-or-param' | 'local';
};

/** 関数・アロー関数・メソッドの引数が束縛する名前（分割代入・入れ子を含む）。 */
function boundParameterNames(node: ts.Node, into: Set<string>): void {
  if (!ts.isFunctionLike(node)) return;
  const collect = (name: ts.BindingName): void => {
    if (ts.isIdentifier(name)) {
      into.add(name.text);
      return;
    }
    if (ts.isObjectBindingPattern(name) || ts.isArrayBindingPattern(name)) {
      for (const element of name.elements) {
        if (ts.isBindingElement(element)) collect(element.name);
      }
    }
  };
  for (const parameter of node.parameters) collect(parameter.name);
}

/** 識別子が「囲むいずれかの関数の引数」に由来するか。 */
function isFromEnclosingParameter(expression: ts.Expression, sourceFile: ts.SourceFile): boolean {
  // `testId` / `props.testId` / `row.testId` のいずれも、根の識別子で判定する。
  let root: ts.Expression = expression;
  while (ts.isPropertyAccessExpression(root)) root = root.expression;
  if (!ts.isIdentifier(root)) return false;
  const names = new Set<string>();
  for (let current: ts.Node | undefined = expression; current !== undefined; current = current.parent) {
    boundParameterNames(current, names);
    if (current === sourceFile) break;
  }
  return names.has(root.text);
}

export function testIdValueOrigins(source: string, fileName = 'source.tsx'): TestIdValueOrigin[] {
  const sourceFile = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const origins: TestIdValueOrigin[] = [];
  const record = (node: ts.Node, text: string, kind: TestIdValueOrigin['kind']): void => {
    origins.push({
      line: sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1,
      text: text.trim(),
      kind,
    });
  };
  const classify = (expression: ts.Expression): void => {
    if (ts.isParenthesizedExpression(expression)) {
      classify(expression.expression);
      return;
    }
    if (ts.isStringLiteral(expression) || ts.isNoSubstitutionTemplateLiteral(expression)) {
      record(expression, expression.text, 'literal');
      return;
    }
    if (ts.isTemplateExpression(expression)) {
      record(expression, expression.head.text, 'template');
      return;
    }
    if (ts.isConditionalExpression(expression)) {
      classify(expression.whenTrue);
      classify(expression.whenFalse);
      return;
    }
    if (
      ts.isBinaryExpression(expression) &&
      (expression.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken ||
        expression.operatorToken.kind === ts.SyntaxKind.BarBarToken)
    ) {
      classify(expression.left);
      classify(expression.right);
      return;
    }
    record(
      expression,
      expression.getText(sourceFile),
      isFromEnclosingParameter(expression, sourceFile) ? 'prop-or-param' : 'local',
    );
  };
  const visit = (node: ts.Node): void => {
    if (ts.isJsxAttribute(node) && ATTRIBUTE_NAMES.has(node.name.getText(sourceFile))) {
      const initializer = node.initializer;
      if (initializer !== undefined && ts.isStringLiteral(initializer)) {
        record(initializer, initializer.text, 'literal');
      } else if (
        initializer !== undefined &&
        ts.isJsxExpression(initializer) &&
        initializer.expression !== undefined
      ) {
        classify(initializer.expression);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return origins;
}
