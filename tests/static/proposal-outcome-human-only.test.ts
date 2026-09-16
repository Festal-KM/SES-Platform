// tests/static/proposal-outcome-human-only.test.ts
// T-09-10（docs/sprints/SP-09 §T-09-10 / docs/05 §6.5「`S-024` の実装の決着」/ `F-025 AC-1` / `CLAUDE.md` §4.2）:
// 🔴 **`Proposal` の結果（`WON` / `LOST` / `WITHDRAWN`）を確定するコードが、#48（`transitionProposal`。`to` は人間の入力）以外に無い**
//    ことを AST で固定する。`proposal-resend-human-only.test.ts`（`SUBMIT_FAILED → APPROVED`）と**対**。
//
// なぜ要るか: 結果は業務基盤の外（電話・対面）で決まる事実であり、システムは推測してはならない（`F-025 AC-1`「結果はシステムが自動で
// 確定しない。人間の操作でのみ確定する」）。「返答期限を過ぎた提案を `LOST` にするジョブ」「面談後 N 日で `WITHDRAWN` 扱い」を誰かが
// 書けば、それは成約率の分母・分子を汚し（`BR-23`）、取引先の提案を勝手に終わらせる。型では止められない
// （`proposalMachine.transition('RESULT_PENDING', 'LOST')` はどこからでも呼べる）ので、構造として見張る。
//
// 検査（非テストソース。`apps/**` / `packages/**`）:
//   ① 結果の確定の記述 — 次のいずれかを「`WON` / `LOST` / `WITHDRAWN` を書き込む記述」として拾う:
//      a. `proposalMachine.transition(<any>, '<結果>')` / 生の `transition(<any>, '<結果>')`
//      b. `{ from: <any>, to: '<結果>' }`（遷移の記述子）
//      c. `{ fromState: <any>, toState: '<結果>' }` が **`where` の外**にある（`ProposalEvent` の書き込み）
//      d. Prisma の `proposal.update` / `proposal.updateMany` の **`data` に `state: '<結果>'`**
//      e. 生 SQL（タグ付きテンプレート / 文字列）で `UPDATE proposals SET … state = '<結果>'`
//      → 🔴 **許可リストは空**である。#48 は `body.to`（人間の入力）を変数として渡すので、結果の値をリテラルで書く場所は存在しない。
//        シード（`packages/db/seed/**`）は開発用の材料であり走査対象から外す（本番で動くコードではない）。
//   ② 🔴 `apps/worker/**` に #48 の実体（`transitionProposal`）・`S-024` の候補（`proposalInterviewOperations`）への参照が無く、
//      結果の値を**識別子・トークン形の文字列**として持たない（ジョブが結果を知る理由が無い）。
//   ③ ジョブ名の宣言（`packages/connectors/src/queues.ts` / `apps/worker/src/jobs/index.ts`）に `proposal.` で始まる名前
//      （`Proposal` を動かすジョブ）と、`outcome` / `won` / `lost` / `withdraw` を含む名前が無い（`proposal-request.expire` は
//      `ProposalRequest` の `EXPIRED` であり `Proposal` の結果ではない —— `DECLINED` / `EXPIRED` と `LOST` を混同しない。`BR-60`）。
//   ④ 🔴 `S-024` の実装（`interview-rows.ts` / 画面）に「期限」「自動」で結果を選ぶ設定値・分岐が無い（`expire` / `deadline` / `auto` を
//      名乗る識別子が 0 件）。
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..', '..');

const SCAN_ROOTS = ['apps', 'packages'];
const IGNORED_DIRECTORIES = new Set(['node_modules', '.next', 'dist', '.turbo', 'generated']);
const SOURCE_EXTENSIONS = new Set(['.ts', '.tsx', '.mts', '.cts']);

/** 🔴 走査対象から外すのは開発用のシードだけ（`seed:isolation` は状態機械を通して WON の材料を作る）。本番コードは 1 ファイルも外さない。 */
const EXCLUDED_PREFIXES = ['packages/db/seed/'];

/** 🔴 結果の値をリテラルで書き込んでよい場所。**空**である（#48 は `body.to` を変数で渡す）。 */
const ALLOWED_OUTCOME_WRITE_SITES: readonly string[] = [];

const OUTCOME_STATES = ['WON', 'LOST', 'WITHDRAWN'] as const;
const TRANSITION_ENTRYPOINT = 'transitionProposal';
const INTERVIEW_ENTRYPOINT = 'proposalInterviewOperations';

/** `S-024` の実装（④ の検査対象）。 */
const INTERVIEW_SOURCES = [
  'apps/web/lib/proposals/interview-note.ts',
  'apps/web/lib/proposals/interview-rows.ts',
  'apps/web/lib/proposals/interview.ts',
  'apps/web/app/(main)/proposals/[id]/interview/page.tsx',
  'apps/web/app/(main)/proposals/[id]/interview/proposal-interview-screen.tsx',
];

function listSourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return IGNORED_DIRECTORIES.has(entry.name) ? [] : listSourceFiles(full);
    return SOURCE_EXTENSIONS.has(path.extname(entry.name)) ? [full] : [];
  });
}

function toRepoRelative(absolute: string): string {
  return path.relative(repoRoot, absolute).split(path.sep).join('/');
}

function isTestFile(absolutePath: string): boolean {
  return /\.test\.(ts|tsx|mts|cts)$/.test(absolutePath);
}

function isOutcomeLiteral(node: ts.Node | undefined): boolean {
  return (
    node !== undefined &&
    (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) &&
    (OUTCOME_STATES as readonly string[]).includes(node.text)
  );
}

function propertyName(prop: ts.ObjectLiteralElementLike, sourceFile: ts.SourceFile): string | null {
  if (!ts.isPropertyAssignment(prop) && !ts.isShorthandPropertyAssignment(prop)) return null;
  const name = prop.name;
  if (ts.isIdentifier(name) || ts.isStringLiteral(name)) return name.text;
  return name.getText(sourceFile);
}

function hasProperty(obj: ts.ObjectLiteralExpression, key: string, sourceFile: ts.SourceFile): boolean {
  return obj.properties.some((prop) => propertyName(prop, sourceFile) === key);
}

/** `obj` に `key: '<結果>'` のプロパティがあるか。 */
function hasOutcomeProperty(obj: ts.ObjectLiteralExpression, key: string, sourceFile: ts.SourceFile): boolean {
  return obj.properties.some((prop) => ts.isPropertyAssignment(prop) && propertyName(prop, sourceFile) === key && isOutcomeLiteral(prop.initializer));
}

function objectProperty(obj: ts.ObjectLiteralExpression, key: string, sourceFile: ts.SourceFile): ts.ObjectLiteralExpression | null {
  for (const prop of obj.properties) {
    if (ts.isPropertyAssignment(prop) && propertyName(prop, sourceFile) === key && ts.isObjectLiteralExpression(prop.initializer)) {
      return prop.initializer;
    }
  }
  return null;
}

function isUnderWhere(node: ts.Node, sourceFile: ts.SourceFile): boolean {
  let current: ts.Node | undefined = node.parent;
  while (current !== undefined) {
    if (ts.isPropertyAssignment(current) && propertyName(current, sourceFile) === 'where') return true;
    current = current.parent;
  }
  return false;
}

/** 呼び出しの形。`proposalMachine.transition` / 生の `transition` / `<x>.proposal.update(Many)` を見分ける。 */
function calleeShape(call: ts.CallExpression, sourceFile: ts.SourceFile): { readonly name: string; readonly object: string | null } {
  const callee = call.expression;
  if (ts.isIdentifier(callee)) return { name: callee.text, object: null };
  if (ts.isPropertyAccessExpression(callee)) {
    const object = callee.expression;
    return {
      name: callee.name.getText(sourceFile),
      object: ts.isPropertyAccessExpression(object) ? object.name.getText(sourceFile) : ts.isIdentifier(object) ? object.text : object.getText(sourceFile),
    };
  }
  return { name: '', object: null };
}

function templateText(node: ts.Node): string | null {
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
  if (ts.isTemplateExpression(node)) {
    return node.head.text + node.templateSpans.map((span) => `?${span.literal.text}`).join('');
  }
  return null;
}

const UPDATE_PROPOSALS = /UPDATE\s+proposals\b/i;
const SET_STATE_OUTCOME = new RegExp(`\\bstate\\s*=\\s*'(${OUTCOME_STATES.join('|')})'`, 'i');
const OUTCOME_TOKEN = /^(WON|LOST|WITHDRAWN)$/;
const OUTCOME_NAMED_IDENTIFIER = /(^|[a-z_])(Won|Lost|Withdrawn|WON|LOST|WITHDRAWN)([A-Z_]|$)/;
const AUTO_DECISION_IDENTIFIER = /expire|deadline|autoClose|autoLost|autoWithdraw|autoDecide|autoConfirm/i;

type Findings = {
  readonly outcomeWriteSites: readonly string[];
  readonly mentionsTransitionEntrypoint: boolean;
  readonly mentionsInterviewEntrypoint: boolean;
  /** `apps/worker/**` 向け: 結果の値を名乗る識別子 / トークン形の文字列。 */
  readonly outcomeNamedTokens: readonly string[];
  /** `S-024` の実装向け: 「期限」「自動」で決める設定・分岐を名乗る識別子。 */
  readonly autoDecisionIdentifiers: readonly string[];
};

function inspect(sourceText: string, fileName: string): Findings {
  const sourceFile = ts.createSourceFile(fileName, sourceText, ts.ScriptTarget.ES2023, true);
  const outcomeWriteSites: string[] = [];
  const outcomeNamedTokens: string[] = [];
  const autoDecisionIdentifiers: string[] = [];
  let mentionsTransitionEntrypoint = false;
  let mentionsInterviewEntrypoint = false;

  function visit(node: ts.Node): void {
    if (ts.isCallExpression(node)) {
      const { name, object } = calleeShape(node, sourceFile);
      // ① a. proposalMachine.transition(x, '<結果>') / transition(x, '<結果>')（`contractMachine.transition` は別の機械なので拾わない）
      if (name === 'transition' && (object === null || object === 'proposalMachine') && isOutcomeLiteral(node.arguments[1])) {
        outcomeWriteSites.push('transition()');
      }
      // ① d. <x>.proposal.update(Many)({ data: { state: '<結果>' } })
      if ((name === 'update' || name === 'updateMany') && object === 'proposal' && node.arguments[0] !== undefined && ts.isObjectLiteralExpression(node.arguments[0])) {
        const data = objectProperty(node.arguments[0], 'data', sourceFile);
        if (data !== null && hasOutcomeProperty(data, 'state', sourceFile)) outcomeWriteSites.push(`proposal.${name}()`);
      }
    }
    if (ts.isObjectLiteralExpression(node)) {
      // ① b. { from, to: '<結果>' }
      if (hasProperty(node, 'from', sourceFile) && hasOutcomeProperty(node, 'to', sourceFile)) outcomeWriteSites.push('{ from, to }');
      // ① c. { fromState, toState: '<結果>' }（where の外 = 書き込み）
      if (hasProperty(node, 'fromState', sourceFile) && hasOutcomeProperty(node, 'toState', sourceFile) && !isUnderWhere(node, sourceFile)) {
        outcomeWriteSites.push('{ fromState, toState }');
      }
    }
    // ① e. 生 SQL
    const text = templateText(node);
    if (text !== null && UPDATE_PROPOSALS.test(text) && SET_STATE_OUTCOME.test(text)) outcomeWriteSites.push('raw SQL');

    if (ts.isIdentifier(node)) {
      if (node.text === TRANSITION_ENTRYPOINT) mentionsTransitionEntrypoint = true;
      if (node.text === INTERVIEW_ENTRYPOINT) mentionsInterviewEntrypoint = true;
      if (OUTCOME_NAMED_IDENTIFIER.test(node.text)) outcomeNamedTokens.push(node.text);
      if (AUTO_DECISION_IDENTIFIER.test(node.text)) autoDecisionIdentifiers.push(node.text);
    }
    if ((ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) && OUTCOME_TOKEN.test(node.text)) {
      outcomeNamedTokens.push(node.text);
    }
    ts.forEachChild(node, visit);
  }
  visit(sourceFile);
  return { outcomeWriteSites, mentionsTransitionEntrypoint, mentionsInterviewEntrypoint, outcomeNamedTokens, autoDecisionIdentifiers };
}

describe('🔴 Proposal の結果（WON / LOST / WITHDRAWN）を確定するコードが #48（人間の入力）以外に無い（F-025 AC-1 / CLAUDE.md §4.2）', () => {
  const sourceFiles = SCAN_ROOTS.flatMap((root) => {
    const dir = path.join(repoRoot, root);
    try {
      return statSync(dir).isDirectory() ? listSourceFiles(dir) : [];
    } catch {
      return [];
    }
  })
    .filter((file) => !isTestFile(file))
    .filter((file) => !EXCLUDED_PREFIXES.some((prefix) => toRepoRelative(file).startsWith(prefix)));

  const findings = sourceFiles.map((file) => ({ file: toRepoRelative(file), ...inspect(readFileSync(file, 'utf8'), file) }));
  const writeSites = findings.filter((f) => f.outcomeWriteSites.length > 0).map((f) => f.file).sort();
  const workerFindings = findings.filter((f) => f.file.startsWith('apps/worker/'));

  it('対照: 走査対象のソースが十分にあり、apps/web / apps/worker / packages/db が含まれている', () => {
    expect(sourceFiles.length).toBeGreaterThan(50);
    const files = findings.map((f) => f.file);
    expect(files.some((file) => file.startsWith('apps/web/'))).toBe(true);
    expect(files.some((file) => file.startsWith('apps/worker/'))).toBe(true);
    expect(files.some((file) => file.startsWith('packages/db/'))).toBe(true);
    // #48 と S-024 の実装が走査に入っている。
    expect(files).toContain('apps/web/lib/proposals/transition.ts');
    for (const source of INTERVIEW_SOURCES) expect(files).toContain(source);
  });

  it('対照: 検出器の 5 パターンが合成ソースで動く（a〜e）。where の中の toState・比較・対応表・contractMachine は拾わない', () => {
    const synthetic = [
      `proposalMachine.transition('RESULT_PENDING', 'LOST');`,
      `const T = { from: 'RESULT_PENDING', to: 'WON' } as const;`,
      `await tx.proposalEvent.create({ data: { fromState: 'SUBMITTED', toState: 'WITHDRAWN' } });`,
      `await db.proposal.updateMany({ where: { id, state: 'RESULT_PENDING' }, data: { state: 'LOST' } });`,
      `await tx.$queryRaw(Prisma.sql\`UPDATE proposals SET state = 'LOST', updated_at = now() WHERE id = \${id}::uuid AND state = 'RESULT_PENDING'\`);`,
    ];
    expect(inspect(synthetic.join('\n'), 'synthetic.ts').outcomeWriteSites).toEqual([
      'transition()',
      '{ from, to }',
      '{ fromState, toState }',
      'proposal.updateMany()',
      'raw SQL',
    ]);
    const benign = [
      `await tx.proposalEvent.findFirst({ where: { proposalId, fromState: 'RESULT_PENDING', toState: 'LOST' } });`,
      `if (detail.state === 'WON') return note;`,
      `const TARGETS = { WON: 'WON', LOST: 'LOST', WITHDRAWN: 'WITHDRAWN' } as const;`,
      `contractMachine.transition('UNDER_REVIEW', 'WITHDRAWN');`,
      `await db.proposal.updateMany({ where: { id, state: from }, data: { state: next } });`,
    ];
    expect(inspect(benign.join('\n'), 'benign.ts').outcomeWriteSites).toEqual([]);
  });

  it('🔴 結果の値をリテラルで書き込む非テストソースは存在しない（許可リストは空。#48 は body.to を変数で渡す）', () => {
    expect(ALLOWED_OUTCOME_WRITE_SITES).toEqual([]);
    expect(writeSites).toEqual([...ALLOWED_OUTCOME_WRITE_SITES]);
  });

  it('🔴 apps/worker/** に結果を確定する記述が 1 つも無い（自動で LOST / WON / WITHDRAWN にするジョブが存在しない）', () => {
    expect(workerFindings.filter((f) => f.outcomeWriteSites.length > 0).map((f) => f.file)).toEqual([]);
  });

  it('🔴 apps/worker/** は #48 の実体・S-024 の候補を参照せず、結果の値を識別子・トークンとして持たない', () => {
    expect(workerFindings.filter((f) => f.mentionsTransitionEntrypoint).map((f) => f.file)).toEqual([]);
    expect(workerFindings.filter((f) => f.mentionsInterviewEntrypoint).map((f) => f.file)).toEqual([]);
    const offenders = workerFindings.filter((f) => f.outcomeNamedTokens.length > 0).map((f) => `${f.file}: ${f.outcomeNamedTokens.join(', ')}`);
    expect(offenders).toEqual([]);
  });

  it('🔴 #48 の実体 transitionProposal を参照するのは、その実装と transition/route.ts だけ', () => {
    const callers = findings.filter((f) => f.mentionsTransitionEntrypoint).map((f) => f.file).sort();
    expect(callers).toEqual(['apps/web/app/api/(main)/proposals/[id]/transition/route.ts', 'apps/web/lib/proposals/transition.ts']);
  });

  it('🔴 ジョブ名の宣言に proposal. で始まる名前・outcome / won / lost / withdraw を含む名前が無い（Proposal の結果を動かすジョブを作らない）', () => {
    for (const relative of ['packages/connectors/src/queues.ts', 'apps/worker/src/jobs/index.ts']) {
      const sourceFile = ts.createSourceFile(relative, readFileSync(path.join(repoRoot, relative), 'utf8'), ts.ScriptTarget.ES2023, true);
      const names: string[] = [];
      function visit(node: ts.Node): void {
        if (ts.isStringLiteral(node) && (/^proposal\./.test(node.text) || /outcome|\bwon\b|\blost\b|withdraw/i.test(node.text))) names.push(node.text);
        ts.forEachChild(node, visit);
      }
      visit(sourceFile);
      expect(names, relative).toEqual([]);
    }
  });

  it('🔴 S-024 の実装に「期限」「自動」で結果を選ぶ設定・分岐を名乗る識別子が無い（F-025 AC-1。設定項目そのものを作らない）', () => {
    for (const source of INTERVIEW_SOURCES) {
      const found = findings.find((f) => f.file === source);
      expect(found, source).toBeDefined();
      expect(found?.autoDecisionIdentifiers, source).toEqual([]);
      expect(found?.outcomeWriteSites, source).toEqual([]);
    }
  });
});
