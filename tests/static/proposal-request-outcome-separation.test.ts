// tests/static/proposal-request-outcome-separation.test.ts
// 🔴 T-08-08（docs/sprints/SP-08-anonymous-share.md §5）: `DECLINED` / `EXPIRED` の区別と理由の非開示を**静的に**固定する。
//    `F-018 AC-1`（理由がホスト側の画面・API・通知・エクスポート・集計に現れない）/ `AC-5`（`GATE_FAILED` /
//    `SUBMIT_FAILED` / `LOST` と `DECLINED` を 1 つの区分に畳まない）/ `BR-57` / `BR-23` / `BR-60` / docs/05 §4.8。
//
// ---------------------------------------------------------------------------
// 🔴 なぜ静的検査か
// ---------------------------------------------------------------------------
// 実 DB のテスト（`tests/isolation/proposal-requests.test.ts` / `proposal-request-respond.test.ts` /
// `proposal-request-outcomes.test.ts`）は**今ある経路**（#32 / `S-017` / `S-018` / 監査）に理由が出ないことを
// 証明する。しかし `F-018 AC-1` が列挙する「通知・エクスポート・集計」は Phase 1 の現時点で**存在しない**
// （通知は `F-039` = Phase 2、エクスポートは `F-064` / `F-052`、集計は `F-051` = SP-19）。存在しない経路は
// 実行時テストでは固定できないので、**`declineReason` / `decline_reason` を読むソースが取引先向けの
// 5 ファイルに閉じている**ことをリポジトリ全体の走査で固定する。将来 6 つ目のファイルが理由に触れた時点で
// ここが落ち、それがホスト向け・運営者向け・通知・エクスポート・集計のどれであっても気づける。
//
// `AC-5` の「別の区分」も同じ理由で静的に見る: `Proposal` の状態（`LOST` / `GATE_FAILED` / `SUBMIT_FAILED`）と
// `ProposalRequest` の状態（`DECLINED` / `EXPIRED` / `WITHDRAWN_BY_HOST`）を **1 つの配列リテラル・1 つの union
// 型に並べたソースが存在しない**ことを AST で検査する（`packages/domain` の `indicators.ts` が型で塞いでいる
// のと同じ性質を、型注釈を持たない文字列の経路〔`WHERE state IN (...)` / フィルタの選択肢 / 通知の分岐〕でも守る）。
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { ASSIGNMENT_STATES } from '../../packages/domain/src/state/assignment.js';
import { CONTRACT_STATES } from '../../packages/domain/src/state/contract.js';
import { PROPOSAL_STATES } from '../../packages/domain/src/state/proposal.js';
import { PROPOSAL_REQUEST_STATES } from '../../packages/domain/src/state/proposalRequest.js';
import { TENANT_LIFECYCLE_STATES } from '../../packages/domain/src/state/tenant.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..', '..');
const fixturesDir = path.join(here, '__fixtures__', 'proposal-request-outcome-separation');

const SCAN_ROOTS = ['apps', 'packages'];
const IGNORED_DIRECTORIES = new Set(['node_modules', '.next', 'dist', '.turbo', 'generated']);
const SOURCE_EXTENSIONS = new Set(['.ts', '.tsx', '.mts', '.cts']);

/**
 * 🔴 `declineReason` / `decline_reason` に触れてよい非テストソース（取引先向けの経路だけ）。
 *
 *   - `views.ts` … `PartnerProposalRequestDetailView` / `PartnerProposalRequestDetailRow` / `toPartnerProposalRequestDetailView`
 *     （ホスト向けの型に無いことは `views.types.test.ts` が型で固定する）
 *   - `service.ts` … 辞退の書き込み（`leaveRequestedByCas`）と `S-018` の読み取り（`readPartnerProposalRequestDetail`）
 *   - `detail-rows.ts` … `S-018` の表示値
 *   - `app/(main)/proposal-requests/[id]/**` … `S-018`（取引先専用の画面。ホスト文脈は 404）
 *
 * ここに無いファイルが触れたら、それは 6 つ目の経路である。**足す前に `F-018 AC-1` と突き合わせること。**
 */
const ALLOWED_DECLINE_REASON_FILES = [
  'apps/web/app/(main)/proposal-requests/[id]/proposal-request-respond-screen.tsx',
  'apps/web/app/(main)/proposal-requests/[id]/respond-props.ts',
  'apps/web/lib/proposal-requests/detail-rows.ts',
  'apps/web/lib/proposal-requests/service.ts',
  'apps/web/lib/proposal-requests/views.ts',
];

/**
 * 🔴 T-10-09: 辞退理由を**消去の対象列として名指しするだけ**のファイル（`PURGE_SPEC`。docs/05 §9.7 / `F-064 AC-3`）。
 *    値を読まない・運ばない（表名と列名の文字列だけ）。読み手（ホストの通知・エクスポート・集計・運営者）に
 *    辞退理由が流れる経路ではなく、逆に `PURGED` で消すための列挙である。ここに載るのは**列名を文字列で持つ設定**に限り、
 *    `declineReason` をプロパティとして読む記述（`.declineReason` / `declineReason:`）が無いことを別途固定する。
 */
const ERASURE_ONLY_DECLINE_REASON_FILES = ['packages/config/src/retention.ts'];

/** 辞退理由に関する文言キー（`packages/i18n`）。参照してよいのは `S-018` の props 組み立てだけ。 */
const DECLINE_REASON_MESSAGE_KEY = /proposalRequests\.respond\.decline\.(?:reasonLabel|reasonNote|recordedReason|recordedReasonNone)\b/;
const ALLOWED_DECLINE_REASON_MESSAGE_KEY_FILES = [
  'apps/web/app/(main)/proposal-requests/[id]/respond-props.ts',
  'packages/i18n/src/index.ts',
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

/** 🔴 テストファイルは走査対象外（本リポジトリの全走査テストと同じ規約。テストは出荷されない）。 */
function isTestFile(absolutePath: string): boolean {
  return /\.(?:test|render\.test)\.(ts|tsx|mts|cts)$/.test(absolutePath);
}

/** コメントを落としたソース（設計意図を書いた行で落ちないようにする）。 */
function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .map((line) => line.split('//')[0] ?? '')
    .join('\n');
}

const sourceFiles = SCAN_ROOTS.flatMap((root) => listSourceFiles(path.join(repoRoot, root))).filter(
  (file) => !isTestFile(file),
);

const DECLINE_REASON_IDENTIFIER = /\bdeclineReason\w*|\bdecline_reason\b/;

function filesMatching(pattern: RegExp): string[] {
  return sourceFiles
    .filter((file) => pattern.test(stripComments(readFileSync(file, 'utf8'))))
    .map(toRepoRelative)
    .sort();
}

// ---------------------------------------------------------------------------
// AST: Proposal と ProposalRequest の状態を 1 つに畳んだ配列 / union の検出
// ---------------------------------------------------------------------------

/**
 * 🔴 走査に使うのは**そのエンティティにしか無い状態名**である。`DRAFT` / `WITHDRAWN` は `Contract` にも、
 *    `EXPIRED` は `Contract` にもあるため、他機械の配列（`CONTRACT_STATES` 自身など）を誤検出しないよう、
 *    5 機械のうち 1 つにしか現れない名前だけを「その機械の印」として使う。`F-018 AC-5` が名指しする
 *    `GATE_FAILED` / `SUBMIT_FAILED` / `LOST`（Proposal）と `DECLINED` / `WITHDRAWN_BY_HOST`（ProposalRequest）は
 *    いずれも固有名であり、下の対照テストがそれを確かめる。
 */
const OTHER_MACHINE_STATES: ReadonlySet<string> = new Set<string>([
  ...ASSIGNMENT_STATES,
  ...CONTRACT_STATES,
  ...TENANT_LIFECYCLE_STATES,
]);
const PROPOSAL_STATE_SET: ReadonlySet<string> = new Set(
  PROPOSAL_STATES.filter(
    (state) => !OTHER_MACHINE_STATES.has(state) && !(PROPOSAL_REQUEST_STATES as readonly string[]).includes(state),
  ),
);
const PROPOSAL_REQUEST_STATE_SET: ReadonlySet<string> = new Set(
  PROPOSAL_REQUEST_STATES.filter(
    (state) => !OTHER_MACHINE_STATES.has(state) && !(PROPOSAL_STATES as readonly string[]).includes(state),
  ),
);

/**
 * 🔴 AST を組む前の安価な前段: 両エンティティの固有名が**同じファイルに文字列リテラルとして現れる**か
 *    （型参照の union `ProposalState | ProposalRequestState` も両方の型名で拾う）。片方しか現れないファイルには
 *    混在の余地が無い。全ファイルを parse すると並列実行下で数秒かかり、CI でタイムアウトする。
 */
function mentionsBothEntities(rawSource: string): boolean {
  const source = stripComments(rawSource);
  const quoted = (names: ReadonlySet<string>): boolean =>
    [...names].some((name) => source.includes(`'${name}'`) || source.includes(`"${name}"`));
  const bothLiterals = quoted(PROPOSAL_STATE_SET) && quoted(PROPOSAL_REQUEST_STATE_SET);
  const bothTypeNames = /\bProposalState\b/.test(source) && /\bProposalRequestState\b/.test(source);
  return bothLiterals || bothTypeNames;
}

type MixRule = 'MIXED_ARRAY_LITERAL' | 'MIXED_STRING_UNION' | 'MIXED_TYPE_REFERENCE_UNION';
type MixViolation = { readonly rule: MixRule; readonly text: string; readonly line: number };

function stringLiteralsOf(nodes: readonly ts.Node[]): string[] {
  return nodes.flatMap((node) => {
    if (ts.isStringLiteralLike(node)) return [node.text];
    if (ts.isLiteralTypeNode(node) && ts.isStringLiteralLike(node.literal)) return [node.literal.text];
    return [];
  });
}

/** 両方のエンティティの状態名を**同時に**含むか（片方だけなら混ざっていない）。 */
function mixesBothEntities(values: readonly string[]): boolean {
  return values.some((v) => PROPOSAL_STATE_SET.has(v)) && values.some((v) => PROPOSAL_REQUEST_STATE_SET.has(v));
}

function typeReferenceNames(nodes: readonly ts.TypeNode[]): string[] {
  return nodes.flatMap((node) =>
    ts.isTypeReferenceNode(node) && ts.isIdentifier(node.typeName) ? [node.typeName.text] : [],
  );
}

/**
 * 検査対象:
 *   - 配列リテラル `[ 'LOST', 'DECLINED' ]`（`as const` の有無を問わない）
 *   - 文字列リテラルの union 型 `'LOST' | 'DECLINED'`
 *   - 型参照の union `ProposalState | ProposalRequestState`
 */
function findStateMixViolations(sourceText: string, fileName: string): MixViolation[] {
  const sourceFile = ts.createSourceFile(
    fileName,
    sourceText,
    ts.ScriptTarget.ES2023,
    true,
    fileName.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const violations: MixViolation[] = [];

  function report(rule: MixRule, node: ts.Node): void {
    violations.push({
      rule,
      text: node.getText(sourceFile),
      line: sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1,
    });
  }

  function visit(node: ts.Node): void {
    if (ts.isArrayLiteralExpression(node) && mixesBothEntities(stringLiteralsOf(node.elements))) {
      report('MIXED_ARRAY_LITERAL', node);
    }
    if (ts.isUnionTypeNode(node)) {
      if (mixesBothEntities(stringLiteralsOf(node.types))) report('MIXED_STRING_UNION', node);
      const names = typeReferenceNames(node.types);
      if (names.includes('ProposalState') && names.includes('ProposalRequestState')) {
        report('MIXED_TYPE_REFERENCE_UNION', node);
      }
    }
    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return violations;
}

function readFixture(name: string): string {
  return readFileSync(path.join(fixturesDir, name), 'utf8');
}

// ---------------------------------------------------------------------------

describe('🔴 F-018 AC-1: 辞退理由に触れるソースは取引先向けの経路に閉じている（通知・エクスポート・集計・運営者に無い）', () => {
  it('対照: 走査対象のソースが存在し、テストファイルが除外されている', () => {
    expect(sourceFiles.length).toBeGreaterThan(0);
    expect(sourceFiles.some((file) => /\.test\.tsx?$/.test(file))).toBe(false);
  });

  it('🔴 `declineReason` / `decline_reason` を参照する非テストソースは許可リストの 5 ファイル + 消去列挙の 1 ファイルちょうどである', () => {
    expect(filesMatching(DECLINE_REASON_IDENTIFIER)).toEqual(
      [...ALLOWED_DECLINE_REASON_FILES, ...ERASURE_ONLY_DECLINE_REASON_FILES].sort(),
    );
  });

  it('🔴 消去列挙のファイル（PURGE_SPEC）は列名を文字列で持つだけで、辞退理由の値を読まない', () => {
    for (const file of ERASURE_ONLY_DECLINE_REASON_FILES) {
      const source = stripComments(readFileSync(path.join(repoRoot, file), 'utf8'));
      expect(/'decline_reason'/.test(source), file).toBe(true);
      expect(/\.declineReason\b|declineReason\s*:/.test(source), `${file}: 辞退理由の値を読んでいる`).toBe(false);
      expect(file.startsWith('packages/config/')).toBe(true);
    }
  });

  it('🔴 許可リストの全ファイルが取引先向けの経路（`lib/proposal-requests/**` / `S-018` の画面）にある', () => {
    for (const file of ALLOWED_DECLINE_REASON_FILES) {
      expect(
        file.startsWith('apps/web/lib/proposal-requests/') ||
          file.startsWith('apps/web/app/(main)/proposal-requests/[id]/'),
        file,
      ).toBe(true);
    }
    // 🔴 ホストの一覧画面（`S-017`）・ワーカー・`packages/db`・管理平面・API ルートは含まれない。
    for (const file of ALLOWED_DECLINE_REASON_FILES) {
      expect(file.startsWith('apps/worker/')).toBe(false);
      expect(file.startsWith('packages/')).toBe(false);
      expect(file.includes('/(admin)/')).toBe(false);
      expect(file.includes('/api/')).toBe(false);
      expect(file.endsWith('proposal-request-screen.tsx')).toBe(false);
    }
  });

  it('対照: 許可リストの各ファイルは実際に識別子を含む（走査が空振りしていない）', () => {
    for (const file of ALLOWED_DECLINE_REASON_FILES) {
      const source = stripComments(readFileSync(path.join(repoRoot, file), 'utf8'));
      expect(DECLINE_REASON_IDENTIFIER.test(source), file).toBe(true);
    }
  });

  it('🔴 #32 が両 view に読む列（`PROPOSAL_REQUEST_ROW_SELECT`）に `declineReason` / 依頼先 / 担当者の列が無い', () => {
    const source = readFileSync(path.join(repoRoot, 'apps/web/lib/proposal-requests/service.ts'), 'utf8');
    const match = /const PROPOSAL_REQUEST_ROW_SELECT = \{([\s\S]*?)\} as const;/.exec(source);
    expect(match, 'PROPOSAL_REQUEST_ROW_SELECT の定義が見つからない').not.toBeNull();
    const body = stripComments(match?.[1] ?? '');
    const keys = [...body.matchAll(/(\w+)\s*:\s*true/g)].map((m) => m[1]).sort();
    expect(keys).toEqual(['createdAt', 'expiresAt', 'id', 'message', 'projectId', 'respondedAt', 'state']);
    for (const forbidden of ['declineReason', 'engineerId', 'partnerCompanyId', 'issuedBy', 'respondedBy']) {
      expect(body).not.toContain(forbidden);
    }
  });

  it('🔴 辞退理由の文言キーを参照するのは `S-018` の props 組み立てと `packages/i18n` の定義だけである', () => {
    expect(filesMatching(DECLINE_REASON_MESSAGE_KEY)).toEqual([...ALLOWED_DECLINE_REASON_MESSAGE_KEY_FILES].sort());
  });
});

describe('🔴 F-018 AC-5 / BR-23: Proposal の状態と ProposalRequest の状態を 1 つの区分に畳んだソースが無い', () => {
  it('対照: 2 つの状態集合は値を共有せず、AC-5 が名指しする状態はすべて固有名として走査に使われる', () => {
    expect(PROPOSAL_STATES.filter((state) => (PROPOSAL_REQUEST_STATES as readonly string[]).includes(state))).toEqual([]);
    for (const state of ['GATE_FAILED', 'SUBMIT_FAILED', 'LOST']) expect(PROPOSAL_STATE_SET.has(state), state).toBe(true);
    for (const state of ['DECLINED', 'WITHDRAWN_BY_HOST']) expect(PROPOSAL_REQUEST_STATE_SET.has(state), state).toBe(true);
    // 他機械と重なる名前は印にしない（`CONTRACT_STATES` の配列そのものを誤検出しないため）。
    for (const state of ['DRAFT', 'WITHDRAWN', 'EXPIRED']) {
      expect(PROPOSAL_STATE_SET.has(state), state).toBe(false);
      expect(PROPOSAL_REQUEST_STATE_SET.has(state), state).toBe(false);
    }
  });

  it(
    '🔴 apps / packages の非テストソースに、両者を混ぜた配列リテラル・union 型が 0 件',
    () => {
      const candidates = sourceFiles.filter((file) => mentionsBothEntities(readFileSync(file, 'utf8')));
      const violations = candidates.flatMap((file) =>
        findStateMixViolations(readFileSync(file, 'utf8'), file).map((v) => ({ ...v, file: toRepoRelative(file) })),
      );
      expect(violations).toEqual([]);
    },
    30_000,
  );

  it('対照: 前段の絞り込みは違反 fixture を落とさず、片方しか無いソースだけを外す', () => {
    for (const name of ['mixed-array.violation.ts', 'mixed-union.violation.ts', 'mixed-type-alias-union.violation.ts']) {
      expect(mentionsBothEntities(readFixture(name)), name).toBe(true);
    }
    expect(mentionsBothEntities(readFixture('clean.ok.ts'))).toBe(true); // 両方在るが混ざっていない（AST が判定する）
    expect(mentionsBothEntities(readFileSync(path.join(repoRoot, 'packages/domain/src/state/proposal.ts'), 'utf8'))).toBe(false);
    expect(mentionsBothEntities(readFileSync(path.join(repoRoot, 'packages/domain/src/state/proposalRequest.ts'), 'utf8'))).toBe(false);
  });

  it('違反 fixture: 配列リテラルの混在を検出する', () => {
    const violations = findStateMixViolations(readFixture('mixed-array.violation.ts'), 'mixed-array.violation.ts');
    expect(violations.map((v) => v.rule)).toEqual(['MIXED_ARRAY_LITERAL']);
  });

  it('違反 fixture: 文字列 union の混在を検出する', () => {
    const violations = findStateMixViolations(readFixture('mixed-union.violation.ts'), 'mixed-union.violation.ts');
    expect(violations.map((v) => v.rule)).toEqual(['MIXED_STRING_UNION']);
  });

  it('違反 fixture: `ProposalState | ProposalRequestState` を検出する', () => {
    const violations = findStateMixViolations(
      readFixture('mixed-type-alias-union.violation.ts'),
      'mixed-type-alias-union.violation.ts',
    );
    expect(violations.map((v) => v.rule)).toEqual(['MIXED_TYPE_REFERENCE_UNION']);
  });

  it('適合 fixture: 片方のエンティティだけを並べた配列・union は検出しない', () => {
    expect(findStateMixViolations(readFixture('clean.ok.ts'), 'clean.ok.ts')).toEqual([]);
  });
});
