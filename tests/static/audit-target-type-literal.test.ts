// tests/static/audit-target-type-literal.test.ts
// 🔴 T-12-13 ①（docs/05 §17.2 #37 / SP-09 T-09-09 ③-① の申し送り）: **`audit_logs.target_type`（提案）の表記が 1 定数に
//    統一されている**構造を静的に固定する（docs/05 §6.5「#45 / #46 / #47 と `S-019` / `S-023` の実装の決着」の `targetType` の統一 /
//    §16.1 / `CLAUDE.md` §3.5）。
//
//   ① 🔴 `audit_logs` の `targetType` に `'Proposal'` / `'PROPOSAL'` の**リテラル**を書く箇所が、`apps/**` + `packages/**` の非テスト
//      ソースに 0 件（定数 `PROPOSAL_AUDIT_TARGET_TYPE` 経由のみ）。**監査の書き込み**だけを AST で見る —— 対象は
//      (a) 監査を書く関数呼び出し（`writeAuditLog` / `recordAuditLog` / `recordAuthAuditLog` / `rethrowWithInvalidTransitionAudit` /
//          `auditLogRowValues` / `audit.write` / `auditLog.create(Many)`）の引数に直接置かれたオブジェクトリテラル
//      (b) `action` と `actorKind` の両方を持つオブジェクトリテラル（監査行の形。変数に受けてから渡す経路も拾う）
//      🔴 `review_gates.target_type` / `ai_usage.target_type` / `send_attempts.entity_type` の `'PROPOSAL'` は**別の列・別の定数**
//      （`GateTargetType` / `PROPOSAL_SEND_ENTITY_TYPE`）であり、ここでは対象にしない（対照 ③ が「見分けている」ことを固定する）。
//   ①' 🔴 **別の列の定数を監査行に流用しない** —— 監査行の `targetType` に `*GATE_TARGET_TYPE` / `*SEND_ENTITY_TYPE` を名乗る識別子が
//      0 件。加えて、`action` が提案のもの（`'proposal.*'` のリテラル / `PROPOSAL_*AUDIT_ACTION*` の識別子）である監査行の
//      `targetType` は識別子 `PROPOSAL_AUDIT_TARGET_TYPE` そのものである（`gate.ts` の `GATE_REQUEST` が `PROPOSAL_GATE_TARGET_TYPE`
//      を流用していた事故を、リテラル検査だけでは捕まえられなかったため）。
//   ② 定数経由の書き込みが実在する（検査が空振りしていない対照）
//   ③ `targetType: 'PROPOSAL'` のリテラル自体は `review_gates` の行（シード）に残っている = 走査が「監査の書き込み」だけを見ている
//   ④ migration 20260929000000 の射程: 原文の `UPDATE` 文が 1 回だけあり、列の追加・GRANT / REVOKE / ポリシーの変更が無く、
//      一時解除した FORCE ROW LEVEL SECURITY を同じファイルで戻している
//
// 結合側（実 `gate.run` の `GATE_RESULT` 行が定数で引ける / 移行後に `'PROPOSAL'` + `proposal.%` が 0 行 / migration の再生）は
// `tests/isolation/proposal-approval.test.ts` ② と `tests/isolation/audit-log.test.ts`「T-12-13 ①」。
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { PROPOSAL_AUDIT_TARGET_TYPE } from '../../packages/db/src/proposal-draft';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..', '..');

const IGNORED_DIRECTORIES = new Set(['node_modules', '.next', 'dist', '.turbo', 'generated']);
const SOURCE_EXTENSIONS = new Set(['.ts', '.tsx', '.mts', '.cts']);

/** 監査を書く関数（識別子で呼ぶもの）。 */
const AUDIT_WRITER_IDENTIFIERS = new Set([
  'writeAuditLog',
  'recordAuditLog',
  'recordAuthAuditLog',
  'rethrowWithInvalidTransitionAudit',
  'auditLogRowValues',
]);
/** 監査を書くメソッド（`<receiver>.<name>(...)`）。`audit.write`（シードの `AuditWriter`）/ `auditLog.create(Many)`（Prisma）。 */
const AUDIT_WRITER_METHODS: readonly { readonly receiver: string; readonly method: string }[] = [
  { receiver: 'audit', method: 'write' },
  { receiver: 'auditLog', method: 'create' },
  { receiver: 'auditLog', method: 'createMany' },
];

function listSourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      return IGNORED_DIRECTORIES.has(entry.name) ? [] : listSourceFiles(full);
    }
    return SOURCE_EXTENSIONS.has(path.extname(entry.name)) ? [full] : [];
  });
}

function toRepoRelative(absolute: string): string {
  return path.relative(repoRoot, absolute).split(path.sep).join('/');
}

function isTestFile(absolutePath: string): boolean {
  return /\.test\.(ts|tsx|mts|cts)$/.test(absolutePath);
}

const sourceFiles = ['apps', 'packages']
  .flatMap((root) => listSourceFiles(path.join(repoRoot, root)))
  .filter((file) => !isTestFile(file));

function parse(file: string): ts.SourceFile {
  return ts.createSourceFile(
    file,
    readFileSync(file, 'utf8'),
    ts.ScriptTarget.Latest,
    true,
    file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
}

function propertyName(node: ts.ObjectLiteralElementLike): string | null {
  if (!ts.isPropertyAssignment(node) && !ts.isShorthandPropertyAssignment(node)) return null;
  const name = node.name;
  if (ts.isIdentifier(name) || ts.isStringLiteral(name)) return name.text;
  return null;
}

function findProperty(literal: ts.ObjectLiteralExpression, name: string): ts.ObjectLiteralElementLike | undefined {
  return literal.properties.find((property) => propertyName(property) === name);
}

/** 監査を書く呼び出しの callee か。 */
function isAuditWriterCallee(callee: ts.LeftHandSideExpression): boolean {
  if (ts.isIdentifier(callee)) return AUDIT_WRITER_IDENTIFIERS.has(callee.text);
  if (ts.isPropertyAccessExpression(callee)) {
    const method = callee.name.text;
    const receiver = callee.expression;
    // `db.auditLog.createMany` / `tx.auditLog.create` / `this.db.auditLog.create` / `audit.write`
    const receiverName = ts.isPropertyAccessExpression(receiver) ? receiver.name.text : ts.isIdentifier(receiver) ? receiver.text : null;
    return AUDIT_WRITER_METHODS.some((entry) => entry.method === method && entry.receiver === receiverName);
  }
  return false;
}

/**
 * オブジェクトリテラルが「監査行の形」か。
 *  (a) 監査を書く呼び出しの引数（`{ data: [...] }` / `{ data: {...} }` の中も含む）に直接置かれている
 *  (b) `action` と `actorKind` の両方を持つ（`AuditLogEntry` の形。変数に受けてから渡す経路）
 */
function isAuditEntryLiteral(literal: ts.ObjectLiteralExpression): boolean {
  if (findProperty(literal, 'action') !== undefined && findProperty(literal, 'actorKind') !== undefined) return true;
  let node: ts.Node = literal;
  // 引数 → 呼び出し の間に `{ data: [ … ] }` / スプレッド / 配列 を挟む形（Prisma の `createMany({ data: [ … ] })`）を許す。
  for (let depth = 0; depth < 6; depth += 1) {
    const parent: ts.Node | undefined = node.parent;
    if (parent === undefined) return false;
    if (ts.isCallExpression(parent) && parent.arguments.includes(node as ts.Expression)) {
      return isAuditWriterCallee(parent.expression);
    }
    if (
      ts.isArrayLiteralExpression(parent) ||
      ts.isPropertyAssignment(parent) ||
      ts.isObjectLiteralExpression(parent) ||
      ts.isSpreadAssignment(parent) ||
      ts.isSpreadElement(parent) ||
      ts.isParenthesizedExpression(parent) ||
      ts.isAsExpression(parent) ||
      ts.isSatisfiesExpression(parent)
    ) {
      node = parent;
      continue;
    }
    return false;
  }
  return false;
}

type Occurrence = { readonly file: string; readonly line: number; readonly value: string };

/** 監査行の `action` が提案のものか（`'proposal.*'` のリテラル / `PROPOSAL_*AUDIT_ACTION*` の識別子。`PROPOSAL_REQUEST_*` は別の実体）。 */
function isProposalAuditAction(literal: ts.ObjectLiteralExpression): boolean {
  const action = findProperty(literal, 'action');
  if (action === undefined || !ts.isPropertyAssignment(action)) return false;
  const initializer = action.initializer;
  if (ts.isStringLiteral(initializer) || ts.isNoSubstitutionTemplateLiteral(initializer)) return initializer.text.startsWith('proposal.');
  if (ts.isIdentifier(initializer)) return /^PROPOSAL_(?!REQUEST_)\w*AUDIT_ACTION/.test(initializer.text);
  return false;
}

/**
 * 走査結果: 監査行の `targetType` に置かれたリテラル / 定数 / 別の列の定数、提案の監査行で定数以外を置いたもの、
 * および監査行の外の `targetType: 'PROPOSAL'` リテラル（対照）。
 */
function scan(): {
  readonly literalInAudit: Occurrence[];
  readonly constantInAudit: Occurrence[];
  readonly foreignConstantInAudit: Occurrence[];
  readonly proposalAuditWithoutConstant: Occurrence[];
  readonly literalOutsideAudit: Occurrence[];
} {
  const literalInAudit: Occurrence[] = [];
  const constantInAudit: Occurrence[] = [];
  const foreignConstantInAudit: Occurrence[] = [];
  const proposalAuditWithoutConstant: Occurrence[] = [];
  const literalOutsideAudit: Occurrence[] = [];
  for (const file of sourceFiles) {
    const source = parse(file);
    const visit = (node: ts.Node): void => {
      if (ts.isObjectLiteralExpression(node)) {
        const target = findProperty(node, 'targetType');
        if (target !== undefined && ts.isPropertyAssignment(target)) {
          const initializer = target.initializer;
          const line = source.getLineAndCharacterOfPosition(target.getStart(source)).line + 1;
          const occurrence = (value: string): Occurrence => ({ file: toRepoRelative(file), line, value });
          const inAudit = isAuditEntryLiteral(node);
          const isConstant = ts.isIdentifier(initializer) && initializer.text === 'PROPOSAL_AUDIT_TARGET_TYPE';
          if (ts.isStringLiteral(initializer) || ts.isNoSubstitutionTemplateLiteral(initializer)) {
            if (initializer.text.toLowerCase() === 'proposal') {
              (inAudit ? literalInAudit : literalOutsideAudit).push(occurrence(initializer.text));
            }
          } else if (inAudit && isConstant) {
            constantInAudit.push(occurrence(initializer.text));
          } else if (inAudit && ts.isIdentifier(initializer) && /(GATE_TARGET_TYPE|SEND_ENTITY_TYPE)$/.test(initializer.text)) {
            foreignConstantInAudit.push(occurrence(initializer.text));
          }
          if (inAudit && !isConstant && isProposalAuditAction(node)) {
            proposalAuditWithoutConstant.push(occurrence(initializer.getText(source)));
          }
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
  }
  return { literalInAudit, constantInAudit, foreignConstantInAudit, proposalAuditWithoutConstant, literalOutsideAudit };
}

const scanned = scan();

describe("① audit_logs.targetType に 'Proposal' / 'PROPOSAL' のリテラルを書く箇所が非テストソースに 0 件", () => {
  it('監査行（書き込み呼び出しの引数 / action + actorKind を持つリテラル）の targetType はリテラルではない', () => {
    expect(scanned.literalInAudit).toEqual([]);
  });

  it('定数の値は Proposal（T-09-09 の値を変えていない = 既存行の移行先と一致する）', () => {
    expect(PROPOSAL_AUDIT_TARGET_TYPE).toBe('Proposal');
  });
});

describe("①' 別の列の定数（review_gates / send_attempts）を監査行の targetType に流用しない", () => {
  it('監査行の targetType に *GATE_TARGET_TYPE / *SEND_ENTITY_TYPE を名乗る識別子が 0 件', () => {
    expect(scanned.foreignConstantInAudit).toEqual([]);
  });

  it("action が提案のもの（'proposal.*' / PROPOSAL_*AUDIT_ACTION*）の監査行は、targetType が識別子 PROPOSAL_AUDIT_TARGET_TYPE そのもの", () => {
    expect(scanned.proposalAuditWithoutConstant).toEqual([]);
  });
});

describe('② 対照: 定数経由の監査の書き込みが実在する（検査が空振りしていない）', () => {
  it('PROPOSAL_AUDIT_TARGET_TYPE を targetType に置く監査行が、書き込み側の 4 経路（apps/web / packages/db / apps/worker / seed）すべてにある', () => {
    const files = new Set(scanned.constantInAudit.map((occurrence) => occurrence.file));
    expect(files).toContain('apps/web/lib/proposals/approval.ts');
    expect(files).toContain('apps/web/lib/proposals/gate.ts');
    expect(files).toContain('apps/web/lib/proposals/notes.ts');
    expect(files).toContain('apps/web/lib/proposals/resend.ts');
    expect(files).toContain('apps/web/lib/proposals/service.ts');
    expect(files).toContain('apps/web/lib/proposals/submit.ts');
    expect(files).toContain('apps/web/lib/proposals/transition.ts');
    expect(files).toContain('packages/db/src/proposal-draft.ts');
    expect(files).toContain('packages/db/src/proposal-approval.ts');
    expect(files).toContain('packages/db/src/proposal-send.ts');
    expect(files).toContain('apps/worker/src/jobs/gate-run.ts');
    expect(files).toContain('packages/db/seed/presets/demo.ts');
    expect(scanned.constantInAudit.length).toBeGreaterThanOrEqual(16);
  });
});

describe("③ 対照: 走査は「監査の書き込み」だけを見ている（review_gates 等の 'PROPOSAL' は別の列）", () => {
  it("監査行の外には targetType: 'PROPOSAL' のリテラル（review_gates の行 / GateTargetType）が残っている", () => {
    const outside = scanned.literalOutsideAudit.filter((occurrence) => occurrence.value === 'PROPOSAL');
    expect(outside.length).toBeGreaterThan(0);
    const files = new Set(outside.map((occurrence) => occurrence.file));
    // `review_gates` を作るシード（`db.reviewGate.createMany`）と、ゲートの対象を組む `packages/db`。
    expect(files).toContain('packages/db/seed/presets/isolation.ts');
    expect(files).toContain('packages/db/src/gate-target.ts');
  });
});

describe('④ migration 20260929000000 の射程（表記の統一だけ）', () => {
  const file = path.join(repoRoot, 'packages/db/prisma/migrations/20260929000000_audit_target_type_proposal/migration.sql');
  // 🔴 改行は LF に正規化する（Windows の checkout で CRLF になっても同じ判定）。
  const sql = readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
  const statements = sql
    .split('\n')
    .filter((line) => !line.trimStart().startsWith('--'))
    .join('\n');

  it('原文の UPDATE 文が 1 回だけあり、target_type 以外の列を SET しない', () => {
    const updates = statements.match(/UPDATE audit_logs[^;]*;/g) ?? [];
    expect(updates).toEqual([
      "UPDATE audit_logs SET target_type = 'Proposal' WHERE target_type = 'PROPOSAL' AND action LIKE 'proposal.%';",
    ]);
  });

  it('列の追加・削除・GRANT / REVOKE / ポリシーの変更・DELETE / INSERT が無い', () => {
    expect(statements).not.toMatch(/ADD COLUMN|DROP COLUMN|ALTER COLUMN|\bGRANT\b|\bREVOKE\b|CREATE POLICY|DROP POLICY|ALTER POLICY|\bDELETE\b|\bINSERT\b|\bTRUNCATE\b/i);
    // 触る表は audit_logs だけ（review_gates / ai_usage / send_attempts に触れない）。
    expect(statements).not.toMatch(/review_gates|ai_usage|send_attempts/);
  });

  it('一時解除した FORCE ROW LEVEL SECURITY を同じファイルで戻し、残存 0 件の検査を戻す前に置いている', () => {
    const noForce = statements.indexOf('ALTER TABLE "audit_logs" NO FORCE ROW LEVEL SECURITY;');
    const update = statements.indexOf('UPDATE audit_logs SET target_type');
    const remainingCheck = statements.indexOf("WHERE target_type = 'PROPOSAL' AND action LIKE 'proposal.%';\n  IF remaining <> 0");
    const force = statements.indexOf('ALTER TABLE "audit_logs" FORCE ROW LEVEL SECURITY;');
    expect(noForce).toBeGreaterThanOrEqual(0);
    expect(update).toBeGreaterThan(noForce);
    expect(remainingCheck).toBeGreaterThan(update);
    expect(force).toBeGreaterThan(remainingCheck);
    expect(statements.match(/NO FORCE ROW LEVEL SECURITY/g)).toHaveLength(1);
    expect(statements.match(/"audit_logs" FORCE ROW LEVEL SECURITY/g)).toHaveLength(1);
    // ENABLE は外さない。
    expect(statements).not.toMatch(/DISABLE ROW LEVEL SECURITY/);
  });
});
