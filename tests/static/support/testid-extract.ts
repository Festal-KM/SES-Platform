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
