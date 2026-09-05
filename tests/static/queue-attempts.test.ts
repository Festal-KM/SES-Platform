// tests/static/queue-attempts.test.ts
// docs/05 §17.2 #6 / SP-04 T-04-01: 🔴 **送信系キューの `attempts` が 1 であること**を
// ソースの AST 走査で固定する。
//
// なぜ型テストだけでは足りないか:
//   `ExternalSendQueueOptions = { attempts: 1 }` は「送信系キューとして作られたもの」しか守れない。
//   `send.proposal` を `internalQueue('send.proposal', { attempts: 3 })` として**別の分類で**
//   定義し直せば、型は通ったまま自動リトライが復活する。AST 走査はその抜け道を塞ぐ。
//
// なぜ「名前が `send.` で始まるか」で判定しないか:
//   `send.hold-release`（保留の再判定と再 enqueue。docs/05 §9.4）は `send.` 接頭辞を持つが
//   外部 API を呼ばないため `attempts: 3` でよい。接頭辞で機械的に判定すると、この正当な
//   ジョブが落ちるか、逆に例外リストが野放しになる。**例外はスナップショットで固定**し、
//   新しい `send.*` 内部ジョブを足したら必ずこのテストが落ちるようにする。
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..', '..');
const queuesFile = path.join(repoRoot, 'packages', 'connectors', 'src', 'queues.ts');
const fixturesDir = path.join(here, '__fixtures__', 'queue-attempts');

/** 🔴 キュー定義（名前と `attempts`）を置いてよい唯一のファイル（docs/05 §9.1「キュー定義の場所」）。 */
const QUEUE_DEFINITION_FILE = 'packages/connectors/src/queues.ts';

/**
 * 🔴 BullMQ の import と `Queue` の実体化を許すファイル（docs/05 §17.2 #6 ⑤）。
 *
 * `queues.ts` が返すのは「名前 + 既定ジョブオプション」の素のデータであり（§9.1）、
 * それを `new Queue(def.name, { defaultJobOptions: def.defaultJobOptions })` に渡す実体化は
 * **`apps/worker` の起動配線 1 箇所**に閉じる。両方が 1 箇所に固定されて初めて
 * 「`attempts` の上書きがどこでも起きない」と言える。
 *
 * T-04-01 時点では実体化は 0 件（BullMQ は依存にも入っていない）。
 * ⚠️ T-04-03 がワーカーの起動配線を 1 件だけここに追加する。**2 件目を足さない。**
 */
const QUEUE_CONSTRUCTION_ALLOWLIST: readonly string[] = [];

const EXTERNAL_SEND_QUEUE_FACTORY = 'externalSendQueue';
const INTERNAL_QUEUE_FACTORY = 'internalQueue';
const MAX_INTERNAL_ATTEMPTS = 3;

type ViolationRule =
  | 'EXTERNAL_SEND_ATTEMPTS_NOT_ONE'
  | 'EXTERNAL_SEND_HAS_BACKOFF'
  | 'SEND_PREFIXED_QUEUE_NOT_EXTERNAL'
  | 'QUEUE_NAME_MISMATCH'
  | 'INTERNAL_ATTEMPTS_TOO_MANY'
  | 'ATTEMPTS_NOT_LITERAL';

type Violation = { rule: ViolationRule; text: string; line: number };

type QueueSourceAnalysis = {
  violations: Violation[];
  /** `QUEUE_DEFINITIONS` のキー → 生成に使ったファクトリ名。 */
  definitions: { name: string; factory: string; argument: string | null }[];
  externalSendJobNames: string[];
  internalJobNames: string[];
};

function sourceOf(text: string, fileName: string): ts.SourceFile {
  return ts.createSourceFile(fileName, text, ts.ScriptTarget.ES2023, true, ts.ScriptKind.TS);
}

function stringLiteralsOfArrayVariable(sourceFile: ts.SourceFile, variableName: string): string[] {
  const values: string[] = [];
  function visit(node: ts.Node): void {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.name.text === variableName &&
      node.initializer !== undefined
    ) {
      const initializer = ts.isAsExpression(node.initializer) ? node.initializer.expression : node.initializer;
      if (ts.isArrayLiteralExpression(initializer)) {
        for (const element of initializer.elements) {
          if (ts.isStringLiteralLike(element)) values.push(element.text);
        }
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(sourceFile);
  return values;
}

function propertyOf(node: ts.ObjectLiteralExpression, name: string): ts.PropertyAssignment | null {
  for (const property of node.properties) {
    if (!ts.isPropertyAssignment(property)) continue;
    const key = property.name;
    const keyText = ts.isIdentifier(key) || ts.isStringLiteralLike(key) ? key.text : null;
    if (keyText === name) return property;
  }
  return null;
}

/** 数値リテラル（`1` / `-1`）だけを値として認める。変数・式は「リテラルでない」として弾く。 */
function numericLiteralValue(expression: ts.Expression): number | null {
  if (ts.isNumericLiteral(expression)) return Number(expression.text);
  if (
    ts.isPrefixUnaryExpression(expression) &&
    expression.operator === ts.SyntaxKind.MinusToken &&
    ts.isNumericLiteral(expression.operand)
  ) {
    return -Number(expression.operand.text);
  }
  return null;
}

export function analyzeQueueSource(text: string, fileName: string): QueueSourceAnalysis {
  const sourceFile = sourceOf(text, fileName);
  const violations: Violation[] = [];
  const definitions: QueueSourceAnalysis['definitions'] = [];

  const lineOf = (node: ts.Node): number =>
    sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1;
  const report = (rule: ViolationRule, node: ts.Node): void => {
    violations.push({ rule, text: node.getText(sourceFile).slice(0, 160), line: lineOf(node) });
  };

  const externalSendJobNames = stringLiteralsOfArrayVariable(sourceFile, 'EXTERNAL_SEND_JOB_NAMES');
  const internalJobNames = stringLiteralsOfArrayVariable(sourceFile, 'INTERNAL_JOB_NAMES');

  // ① `externalSendQueue` の実装が返す既定オプションを検査する。
  //    ここが `attempts: 1` である限り、送信系キューは他の値を持ちようがない
  //    （ファクトリがオプションを引数に取らないため）。
  function checkExternalSendFactory(node: ts.FunctionDeclaration): void {
    let sawAttempts = false;
    function visit(inner: ts.Node): void {
      if (ts.isObjectLiteralExpression(inner)) {
        const attempts = propertyOf(inner, 'attempts');
        if (attempts !== null) {
          sawAttempts = true;
          const value = numericLiteralValue(attempts.initializer);
          if (value === null) report('ATTEMPTS_NOT_LITERAL', attempts);
          else if (value !== 1) report('EXTERNAL_SEND_ATTEMPTS_NOT_ONE', attempts);
        }
        const backoff = propertyOf(inner, 'backoff');
        if (backoff !== null) report('EXTERNAL_SEND_HAS_BACKOFF', backoff);
      }
      ts.forEachChild(inner, visit);
    }
    visit(node);
    if (!sawAttempts) report('ATTEMPTS_NOT_LITERAL', node);
  }

  // ② `internalQueue(name, { attempts })` の attempts を検査する（1〜3 のリテラル）。
  function checkInternalQueueCall(call: ts.CallExpression): void {
    const options = call.arguments[1];
    if (options === undefined || !ts.isObjectLiteralExpression(options)) {
      report('ATTEMPTS_NOT_LITERAL', call);
      return;
    }
    const attempts = propertyOf(options, 'attempts');
    if (attempts === null) {
      report('ATTEMPTS_NOT_LITERAL', call);
      return;
    }
    const value = numericLiteralValue(attempts.initializer);
    if (value === null) report('ATTEMPTS_NOT_LITERAL', attempts);
    else if (value > MAX_INTERNAL_ATTEMPTS || value < 1) report('INTERNAL_ATTEMPTS_TOO_MANY', attempts);
  }

  // ③ `QUEUE_DEFINITIONS` の各エントリ。
  function checkQueueDefinitions(objectLiteral: ts.ObjectLiteralExpression): void {
    for (const property of objectLiteral.properties) {
      if (!ts.isPropertyAssignment(property)) continue;
      const key = property.name;
      const name = ts.isIdentifier(key) || ts.isStringLiteralLike(key) ? key.text : null;
      if (name === null) continue;

      const initializer = property.initializer;
      const factory =
        ts.isCallExpression(initializer) && ts.isIdentifier(initializer.expression)
          ? initializer.expression.text
          : null;
      const firstArgument =
        ts.isCallExpression(initializer) && initializer.arguments[0] !== undefined && ts.isStringLiteralLike(initializer.arguments[0])
          ? initializer.arguments[0].text
          : null;

      definitions.push({ name, factory: factory ?? '(not-a-call)', argument: firstArgument });

      if (factory === null) {
        report('SEND_PREFIXED_QUEUE_NOT_EXTERNAL', property);
        continue;
      }
      if (firstArgument !== null && firstArgument !== name) report('QUEUE_NAME_MISMATCH', property);

      // 🔴 `send.` 接頭辞を持つのに外部送信キューでないものは、
      //    `INTERNAL_JOB_NAMES` に明示されている場合だけ許す（下のスナップショットで固定）。
      if (name.startsWith('send.') && factory !== EXTERNAL_SEND_QUEUE_FACTORY && !internalJobNames.includes(name)) {
        report('SEND_PREFIXED_QUEUE_NOT_EXTERNAL', property);
      }
      // 🔴 送信系として宣言された名前が、別のファクトリで定義されていないこと。
      if (externalSendJobNames.includes(name) && factory !== EXTERNAL_SEND_QUEUE_FACTORY) {
        report('SEND_PREFIXED_QUEUE_NOT_EXTERNAL', property);
      }
    }
  }

  function visit(node: ts.Node): void {
    if (ts.isFunctionDeclaration(node) && node.name?.text === EXTERNAL_SEND_QUEUE_FACTORY) {
      checkExternalSendFactory(node);
    }
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === INTERNAL_QUEUE_FACTORY) {
      checkInternalQueueCall(node);
    }
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.name.text === 'QUEUE_DEFINITIONS' &&
      node.initializer !== undefined
    ) {
      const initializer = ts.isAsExpression(node.initializer) ? node.initializer.expression : node.initializer;
      if (ts.isObjectLiteralExpression(initializer)) checkQueueDefinitions(initializer);
    }
    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return { violations, definitions, externalSendJobNames, internalJobNames };
}

function readFixture(name: string): string {
  return readFileSync(path.join(fixturesDir, name), 'utf8');
}

const SKIP_DIRS = new Set(['node_modules', 'dist', '.next', '.turbo', 'coverage', '__fixtures__', '.git']);

function listSourceFiles(dir: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      files.push(...listSourceFiles(full));
    } else if (statSync(full).isFile() && /\.(ts|tsx|mts|cts|js|mjs|cjs)$/.test(entry.name)) {
      files.push(full);
    }
  }
  return files;
}

/** BullMQ の `Queue` を実体化している箇所（キュー定義の場所が 1 箇所であることの検査）。 */
function findQueueConstructionSites(text: string, fileName: string): number[] {
  const sourceFile = sourceOf(text, fileName);
  const lines: number[] = [];
  function visit(node: ts.Node): void {
    if (ts.isNewExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 'Queue') {
      lines.push(sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1);
    }
    if (
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
      node.moduleSpecifier !== undefined &&
      ts.isStringLiteralLike(node.moduleSpecifier) &&
      node.moduleSpecifier.text === 'bullmq'
    ) {
      lines.push(sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1);
    }
    ts.forEachChild(node, visit);
  }
  visit(sourceFile);
  return lines;
}

describe('🔴 送信系キューの attempts が 1（docs/05 §17.2 #6 / §9.1 / CLAUDE.md §3.4）', () => {
  const analysis = analyzeQueueSource(readFileSync(queuesFile, 'utf8'), queuesFile);

  it('対照: このテストが空振りしていない（キュー定義が 1 件以上ある）', () => {
    expect(analysis.definitions.length).toBeGreaterThan(0);
    expect(analysis.externalSendJobNames.length).toBeGreaterThan(0);
  });

  it('packages/connectors/src/queues.ts に違反が 0 件', () => {
    expect(analysis.violations).toEqual([]);
  });

  it('🔴 宣言された送信系ジョブがすべて externalSendQueue で定義されている', () => {
    for (const name of analysis.externalSendJobNames) {
      const definition = analysis.definitions.find((entry) => entry.name === name);
      expect(definition, `${name} のキュー定義が無い`).toBeDefined();
      expect(definition?.factory).toBe(EXTERNAL_SEND_QUEUE_FACTORY);
    }
  });

  it('🔴 送信系ジョブ名のスナップショット（増減したら設計側の判断が要る）', () => {
    expect(analysis.externalSendJobNames).toEqual(['send.proposal', 'send.interview-invite', 'send.contract']);
  });

  it('🔴 「send. 接頭辞を持つが外部送信ではない」ジョブのスナップショット（例外を野放しにしない）', () => {
    const exceptions = analysis.internalJobNames.filter((name) => name.startsWith('send.'));
    // ここに新しい名前が増えたら、それが本当に外部 API を呼ばないジョブかを人間が確かめる。
    expect(exceptions).toEqual(['send.hold-release']);
  });

  it('🔴 BullMQ の import / Queue の実体化が許可リスト以外に無い（docs/05 §17.2 #6 ⑤ / §9.1）', () => {
    const offenders: string[] = [];
    for (const root of ['packages', 'apps', 'tests', 'scripts']) {
      for (const file of listSourceFiles(path.join(repoRoot, root))) {
        const relative = path.relative(repoRoot, file).split(path.sep).join('/');
        if (QUEUE_CONSTRUCTION_ALLOWLIST.includes(relative)) continue;
        // このテスト自身（検出器のセレクタを文字列として持つ）は対象外。
        if (relative === 'tests/static/queue-attempts.test.ts') continue;
        if (findQueueConstructionSites(readFileSync(file, 'utf8'), file).length > 0) offenders.push(relative);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('🔴 キュー定義（attempts を持つ表）が queues.ts 以外に無い', () => {
    // `externalSendQueue` / `internalQueue` / `QUEUE_DEFINITIONS` の宣言がここ以外に現れない
    // ＝ 定義の分散（片方だけ attempts が違う 2 つ目の表）を防ぐ。
    const offenders: string[] = [];
    for (const root of ['packages', 'apps', 'scripts']) {
      for (const file of listSourceFiles(path.join(repoRoot, root))) {
        const relative = path.relative(repoRoot, file).split(path.sep).join('/');
        if (relative === QUEUE_DEFINITION_FILE) continue;
        const text = readFileSync(file, 'utf8');
        if (/\b(?:export\s+)?(?:function|const)\s+(?:externalSendQueue|internalQueue|QUEUE_DEFINITIONS)\b/.test(text)) {
          offenders.push(relative);
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});

describe('違反 fixture（検出器そのものが働いていること）', () => {
  it('externalSendQueue が attempts: 2 を返すと検出する', () => {
    const { violations } = analyzeQueueSource(readFixture('attempts-two.violation.ts'), 'attempts-two.violation.ts');
    expect(violations.some((v) => v.rule === 'EXTERNAL_SEND_ATTEMPTS_NOT_ONE')).toBe(true);
  });

  it('externalSendQueue が backoff を設定すると検出する', () => {
    const { violations } = analyzeQueueSource(readFixture('backoff.violation.ts'), 'backoff.violation.ts');
    expect(violations.some((v) => v.rule === 'EXTERNAL_SEND_HAS_BACKOFF')).toBe(true);
  });

  it('🔴 送信系ジョブを internalQueue で定義し直すと検出する（型をすり抜ける抜け道）', () => {
    const { violations } = analyzeQueueSource(
      readFixture('send-as-internal.violation.ts'),
      'send-as-internal.violation.ts',
    );
    expect(violations.some((v) => v.rule === 'SEND_PREFIXED_QUEUE_NOT_EXTERNAL')).toBe(true);
  });

  it('内部ジョブの attempts が 4 以上だと検出する', () => {
    const { violations } = analyzeQueueSource(
      readFixture('internal-attempts.violation.ts'),
      'internal-attempts.violation.ts',
    );
    expect(violations.some((v) => v.rule === 'INTERNAL_ATTEMPTS_TOO_MANY')).toBe(true);
  });

  it('attempts が変数（リテラルでない）だと検出する', () => {
    const { violations } = analyzeQueueSource(
      readFixture('attempts-variable.violation.ts'),
      'attempts-variable.violation.ts',
    );
    expect(violations.some((v) => v.rule === 'ATTEMPTS_NOT_LITERAL')).toBe(true);
  });

  it('キー名とジョブ名がずれていると検出する', () => {
    const { violations } = analyzeQueueSource(
      readFixture('name-mismatch.violation.ts'),
      'name-mismatch.violation.ts',
    );
    expect(violations.some((v) => v.rule === 'QUEUE_NAME_MISMATCH')).toBe(true);
  });

  it('対照: 正常な fixture は違反 0 件', () => {
    const { violations } = analyzeQueueSource(readFixture('clean.ok.ts'), 'clean.ok.ts');
    expect(violations).toEqual([]);
  });
});
