// tests/static/proposal-resend-human-only.test.ts
// T-09-08（docs/sprints/SP-09 §T-09-08 / docs/05 §10.6 / §6.8 / §17.2 #16 と**対** / `F-023 AC-1` / `CLAUDE.md` §4.2）:
// 🔴 **`Proposal` の `SUBMIT_FAILED → APPROVED` を起こすコードが、#44 の実装（`apps/web/app/api/(main)/proposals/[id]/resend/route.ts`
//    と、そのサービス `apps/web/lib/proposals/resend.ts`）以外に無い**ことを AST で固定する。
//
// なぜ要るか: `SUBMIT_FAILED` からの復帰は**人間の明示操作に限る**（`CLAUDE.md` §4.2「`SUBMIT_FAILED` からの復帰は人間の操作に限る」/
// docs/05 §10.6「自動リトライを禁止する実装上の担保」）。`attempts: 1`（`queue-attempts.test.ts`）は BullMQ の自動再試行を塞ぐが、
// **「失敗した提案を拾って `APPROVED` に戻すジョブ」を誰かが書けば、それは自動再送そのもの**である。型では止められない
// （`proposalMachine.transition('SUBMIT_FAILED', 'APPROVED')` はどこからでも呼べる）ので、構造として見張る。
// Phase 3 の `contract-resend-human-only.test.ts`（`Contract` の `SEND_FAILED → DRAFT`。docs/05 §17.2 #16）と**対**にする。
//
// 検査（非テストソース。`apps/**` / `packages/**`）:
//   ① 遷移の記述 — 次のいずれかを「`SUBMIT_FAILED → APPROVED` を起こす記述」として拾う:
//      a. `transition('SUBMIT_FAILED', 'APPROVED')`（`proposalMachine.transition` / 生の `transition`）
//      b. `{ from: 'SUBMIT_FAILED', to: 'APPROVED' }`（遷移の記述子。#44 の `PROPOSAL_RESEND_TRANSITION` がこれ）
//      c. `{ fromState: 'SUBMIT_FAILED', toState: 'APPROVED' }` が **`where` の外**にある（`ProposalEvent` の書き込み。
//         `where` の中は読み取り = `resolveProposalSendResumeOrigin` の復元であり、遷移ではない）
//      d. Prisma の `update` / `updateMany` で `where: { …, state: 'SUBMIT_FAILED' }`（`SUBMIT_FAILED` からの UPDATE）
//      e. 生 SQL（タグ付きテンプレート / 文字列）で `UPDATE proposals … WHERE … state = 'SUBMIT_FAILED'`
//      → 拾った場所は許可リスト（`resend.ts`）と完全に一致する。🔴 `apps/worker/**` と `packages/**` は許可リストとは独立に 0 件。
//   ② `requestProposalResend`（#44 の実体）を参照するのは `resend.ts` 自身と `resend/route.ts` だけ
//   ③ 🔴 `apps/worker/**` に「再送」を名乗る識別子・文字列が無い（`SendAttemptOrigin.kind` の `'RESEND'` リテラルだけを許す —— ジョブは
//      人間が採番した由来を**写す**だけで、自分で再送を起こさない）
//   ④ ジョブ名の宣言（`packages/connectors/src/queues.ts` / `apps/worker/src/jobs/index.ts`）に `resend` / `retry` を含む名前が無い
//      （docs/05 §6.8「送信の自動再試行 API / スケジュール」を作らない）
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

/** 🔴 `SUBMIT_FAILED → APPROVED` を起こす記述を書いてよい場所（docs/05 §10.6。route はサービスを呼ぶだけで遷移の記述を持たない）。 */
const ALLOWED_TRANSITION_SITES = ['apps/web/lib/proposals/resend.ts'];

/** 🔴 #44 の実体を参照してよい場所（実体 + それを呼ぶ Route Handler）。 */
const ALLOWED_RESEND_CALLERS = ['apps/web/app/api/(main)/proposals/[id]/resend/route.ts', 'apps/web/lib/proposals/resend.ts'];

const FROM_STATE = 'SUBMIT_FAILED';
const TO_STATE = 'APPROVED';
const RESEND_ENTRYPOINT = 'requestProposalResend';

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

/** 🔴 テストファイルは走査対象外（本リポジトリの全走査テストと同じ規約。結合テストは前提を作るために管理接続で状態を書く）。 */
function isTestFile(absolutePath: string): boolean {
  return /\.test\.(ts|tsx|mts|cts)$/.test(absolutePath);
}

function isStringLiteralOf(node: ts.Node | undefined, value: string): boolean {
  return node !== undefined && (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) && node.text === value;
}

function propertyName(prop: ts.ObjectLiteralElementLike, sourceFile: ts.SourceFile): string | null {
  if (!ts.isPropertyAssignment(prop) && !ts.isShorthandPropertyAssignment(prop)) return null;
  const name = prop.name;
  if (ts.isIdentifier(name) || ts.isStringLiteral(name)) return name.text;
  return name.getText(sourceFile);
}

/** `obj` に `key: '<value>'` のプロパティがあるか。 */
function hasLiteralProperty(obj: ts.ObjectLiteralExpression, key: string, value: string, sourceFile: ts.SourceFile): boolean {
  return obj.properties.some(
    (prop) => ts.isPropertyAssignment(prop) && propertyName(prop, sourceFile) === key && isStringLiteralOf(prop.initializer, value),
  );
}

/** `obj` の `key` の値がオブジェクトリテラルならそれを返す。 */
function objectProperty(obj: ts.ObjectLiteralExpression, key: string, sourceFile: ts.SourceFile): ts.ObjectLiteralExpression | null {
  for (const prop of obj.properties) {
    if (ts.isPropertyAssignment(prop) && propertyName(prop, sourceFile) === key && ts.isObjectLiteralExpression(prop.initializer)) {
      return prop.initializer;
    }
  }
  return null;
}

/** 祖先に `where:` のプロパティ割り当てがあるか（読み取りの条件 = 遷移ではない）。 */
function isUnderWhere(node: ts.Node, sourceFile: ts.SourceFile): boolean {
  let current: ts.Node | undefined = node.parent;
  while (current !== undefined) {
    if (ts.isPropertyAssignment(current) && propertyName(current, sourceFile) === 'where') return true;
    current = current.parent;
  }
  return false;
}

function calleeName(call: ts.CallExpression, sourceFile: ts.SourceFile): string {
  const callee = call.expression;
  if (ts.isIdentifier(callee)) return callee.text;
  if (ts.isPropertyAccessExpression(callee)) return callee.name.getText(sourceFile);
  return '';
}

/** テンプレート / 文字列の本文（式は `?` に潰す）。 */
function templateText(node: ts.Node): string | null {
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
  if (ts.isTemplateExpression(node)) {
    return node.head.text + node.templateSpans.map((span) => `?${span.literal.text}`).join('');
  }
  return null;
}

const RESEND_TOKEN = /resend|Resend|RESEND/;
const TOKEN_LIKE_STRING = /^[A-Za-z0-9.\-_:]+$/;

const UPDATE_PROPOSALS = /UPDATE\s+proposals\b/i;
const WHERE_FROM_SUBMIT_FAILED = new RegExp(`WHERE[\\s\\S]*\\bstate\\s*=\\s*'${FROM_STATE}'`, 'i');

type Findings = {
  readonly transitionSites: readonly string[];
  readonly mentionsResendEntrypoint: boolean;
  /** `apps/worker/**` 向け: 「再送」を名乗る識別子 / 文字列（`'RESEND'` リテラルは除く）。 */
  readonly resendNamedTokens: readonly string[];
};

function inspect(sourceText: string, fileName: string): Findings {
  const sourceFile = ts.createSourceFile(fileName, sourceText, ts.ScriptTarget.ES2023, true);
  const transitionSites: string[] = [];
  const resendNamedTokens: string[] = [];
  let mentionsResendEntrypoint = false;

  function visit(node: ts.Node): void {
    // ① a. transition('SUBMIT_FAILED', 'APPROVED')
    if (ts.isCallExpression(node)) {
      const name = calleeName(node, sourceFile);
      if (name === 'transition' && isStringLiteralOf(node.arguments[0], FROM_STATE) && isStringLiteralOf(node.arguments[1], TO_STATE)) {
        transitionSites.push('transition()');
      }
      // ① d. update / updateMany({ where: { state: 'SUBMIT_FAILED' }, … })
      if ((name === 'update' || name === 'updateMany') && node.arguments[0] !== undefined && ts.isObjectLiteralExpression(node.arguments[0])) {
        const where = objectProperty(node.arguments[0], 'where', sourceFile);
        if (where !== null && hasLiteralProperty(where, 'state', FROM_STATE, sourceFile)) transitionSites.push(`${name}()`);
      }
    }
    // ① b. / c.
    if (ts.isObjectLiteralExpression(node)) {
      if (hasLiteralProperty(node, 'from', FROM_STATE, sourceFile) && hasLiteralProperty(node, 'to', TO_STATE, sourceFile)) {
        transitionSites.push('{ from, to }');
      }
      if (
        hasLiteralProperty(node, 'fromState', FROM_STATE, sourceFile) &&
        hasLiteralProperty(node, 'toState', TO_STATE, sourceFile) &&
        !isUnderWhere(node, sourceFile)
      ) {
        transitionSites.push('{ fromState, toState }');
      }
    }
    // ① e. 生 SQL
    const text = templateText(node);
    if (text !== null && UPDATE_PROPOSALS.test(text) && WHERE_FROM_SUBMIT_FAILED.test(text)) transitionSites.push('raw SQL');

    // ② #44 の実体への言及
    if (ts.isIdentifier(node) && node.text === RESEND_ENTRYPOINT) mentionsResendEntrypoint = true;

    // ③ 「再送」を名乗るトークン（識別子 / トークン形の文字列。`'RESEND'` そのものは `SendAttemptOrigin.kind`）。
    //    🔴 大文字小文字を区別して `resend` / `Resend` / `RESEND` を見る（`expireSendingDomain` の `reSend` を誤検出しない）。
    //    文字列は識別子・ジョブ名の形（英数と `.-_:` だけ）に限る（`'RESEND には requestedBy が必須です'` のような文は対象外）。
    if (ts.isIdentifier(node) && RESEND_TOKEN.test(node.text)) resendNamedTokens.push(node.text);
    if (
      (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) &&
      TOKEN_LIKE_STRING.test(node.text) &&
      RESEND_TOKEN.test(node.text) &&
      node.text !== 'RESEND'
    ) {
      resendNamedTokens.push(node.text);
    }
    ts.forEachChild(node, visit);
  }
  visit(sourceFile);
  return { transitionSites, mentionsResendEntrypoint, resendNamedTokens };
}

describe('🔴 SUBMIT_FAILED → APPROVED を起こすコードが #44 の実装以外に無い（docs/05 §10.6 / F-023 AC-1 / CLAUDE.md §4.2）', () => {
  const sourceFiles = SCAN_ROOTS.flatMap((root) => {
    const dir = path.join(repoRoot, root);
    try {
      return statSync(dir).isDirectory() ? listSourceFiles(dir) : [];
    } catch {
      return [];
    }
  }).filter((file) => !isTestFile(file));

  // 🔴 全ソースの AST 走査は `it` の外で 1 回だけ行う（`send-attempt-token-single-path` と同じ整理）。
  const findings = sourceFiles.map((file) => ({ file: toRepoRelative(file), ...inspect(readFileSync(file, 'utf8'), file) }));
  const transitionSites = findings.filter((f) => f.transitionSites.length > 0).map((f) => f.file).sort();
  const resendCallers = findings.filter((f) => f.mentionsResendEntrypoint).map((f) => f.file).sort();

  it('対照: 走査対象のソースが十分にあり、apps/web / apps/worker / packages/db が含まれている', () => {
    expect(sourceFiles.length).toBeGreaterThan(50);
    const files = findings.map((f) => f.file);
    expect(files.some((file) => file.startsWith('apps/web/'))).toBe(true);
    expect(files.some((file) => file.startsWith('apps/worker/'))).toBe(true);
    expect(files.some((file) => file.startsWith('packages/db/'))).toBe(true);
  });

  it('対照: 検出器が #44 の実装（遷移の記述子）を実際に拾っている（空振りしていない）', () => {
    expect(transitionSites).toContain('apps/web/lib/proposals/resend.ts');
    const resend = findings.find((f) => f.file === 'apps/web/lib/proposals/resend.ts');
    expect(resend?.transitionSites).toContain('{ from, to }');
  });

  it('対照: 検出器の 5 パターンが合成ソースで動く（a〜e）と、where の中の fromState / toState は拾わない', () => {
    const synthetic = [
      `proposalMachine.transition('SUBMIT_FAILED', 'APPROVED');`,
      `const T = { from: 'SUBMIT_FAILED', to: 'APPROVED' } as const;`,
      `await tx.proposalEvent.create({ data: { fromState: 'SUBMIT_FAILED', toState: 'APPROVED' } });`,
      `await db.proposal.updateMany({ where: { id, state: 'SUBMIT_FAILED' }, data: { state: 'APPROVED' } });`,
      `await tx.$queryRaw(Prisma.sql\`UPDATE proposals SET state = \${to} WHERE id = \${id}::uuid AND state = 'SUBMIT_FAILED'\`);`,
    ];
    expect(inspect(synthetic.join('\n'), 'synthetic.ts').transitionSites).toEqual([
      'transition()',
      '{ from, to }',
      '{ fromState, toState }',
      'updateMany()',
      'raw SQL',
    ]);
    const readOnly = `await tx.proposalEvent.findFirst({ where: { proposalId, fromState: 'SUBMIT_FAILED', toState: 'APPROVED' } });`;
    expect(inspect(readOnly, 'read.ts').transitionSites).toEqual([]);
    // 逆向き（SUBMITTING → SUBMIT_FAILED の確定）は拾わない。
    const settle = `await tx.$queryRaw(Prisma.sql\`UPDATE proposals SET state = 'SUBMIT_FAILED' WHERE id = \${id} AND state = 'SUBMITTING'\`);`;
    expect(inspect(settle, 'settle.ts').transitionSites).toEqual([]);
  });

  it('🔴 SUBMIT_FAILED → APPROVED を起こす記述を持つ非テストソースは許可リストと完全に一致する', () => {
    expect(transitionSites).toEqual([...ALLOWED_TRANSITION_SITES].sort());
  });

  it('🔴 apps/worker/** に SUBMIT_FAILED → APPROVED を起こす記述が 1 つも無い（許可リストとは独立に固定。自動再送のジョブが存在しない）', () => {
    expect(transitionSites.filter((file) => file.startsWith('apps/worker/'))).toEqual([]);
  });

  it('🔴 packages/** に SUBMIT_FAILED → APPROVED を起こす記述が 1 つも無い（DB 層に「失敗を戻す」関数を置かない。復帰は HTTP 経路の 1 実装だけ）', () => {
    expect(transitionSites.filter((file) => file.startsWith('packages/'))).toEqual([]);
  });

  it('🔴 #44 の実体 requestProposalResend を参照するのは、その実装と resend/route.ts だけ', () => {
    expect(resendCallers).toEqual([...ALLOWED_RESEND_CALLERS].sort());
  });

  it('🔴 apps/worker/** に「再送」を名乗る識別子・文字列が無い（`SendAttemptOrigin.kind` の RESEND リテラルだけを許す）', () => {
    const offenders = findings
      .filter((f) => f.file.startsWith('apps/worker/') && f.resendNamedTokens.length > 0)
      .map((f) => `${f.file}: ${f.resendNamedTokens.join(', ')}`);
    expect(offenders).toEqual([]);
  });

  it('🔴 ジョブ名の宣言に resend / retry を含む名前が無い（docs/05 §6.8「送信の自動再試行 API / スケジュール」を作らない）', () => {
    for (const relative of ['packages/connectors/src/queues.ts', 'apps/worker/src/jobs/index.ts']) {
      const sourceFile = ts.createSourceFile(relative, readFileSync(path.join(repoRoot, relative), 'utf8'), ts.ScriptTarget.ES2023, true);
      const names: string[] = [];
      function visit(node: ts.Node): void {
        if (ts.isStringLiteral(node) && /resend|retry/i.test(node.text)) names.push(node.text);
        ts.forEachChild(node, visit);
      }
      visit(sourceFile);
      expect(names, relative).toEqual([]);
    }
  });

  it('🔴 許可リストは 1 ファイル（遷移）+ 2 ファイル（呼び出し元）である（増やすときは docs/05 §10.6 と併せて人間が判断する）', () => {
    expect(ALLOWED_TRANSITION_SITES).toHaveLength(1);
    expect(ALLOWED_RESEND_CALLERS).toHaveLength(2);
    expect(ALLOWED_RESEND_CALLERS.filter((file) => file.startsWith('apps/worker/'))).toEqual([]);
  });
});
