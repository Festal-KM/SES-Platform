// tests/static/gate-engineer-facts-single-path.test.ts
// 🔴 T-09-13（docs/05 §17.2 #31。Issue #41 = 1）: **ゲート実行文脈の限定経路（§11.14）の呼び出し元を
//    1 ファイルに固定する。**
//
// なぜ ESLint だけでは足りないか: `packages/db` 内部の相対 import には `no-restricted-imports` が掛からず、
// `TenantDb` から `$queryRaw` を型で除いている担保も `packages/db/src/**` の中では効かない。
// 本経路は `CLAUDE.md` §3.1 経路 2 を「1 人分・ゲート実行中」に限って越える唯一の関数であり、
// **呼び出し元が 2 つ目になった時点で「汎用の入口」に変質する**（§10.5）。それを見張れるのは走査だけである。
//
// 4 本立て（docs/05 §17.2 #31。`career-not-anonymous.test.ts` と同じく `apps/**` + `packages/**` の
// 非テストソースを走査。コメントは除く）:
//   ① SQL 識別子 `app_gate_proposal_engineer_pii` / `app_gate_proposal_engineer_skills` がコードとして
//      現れるファイルが `packages/db/src/gate-engineer-facts.ts` の 1 本
//   ② `readGateEngineerFacts` を参照するファイルが同ファイル + `packages/db/src/gate-target.ts` の 2 本
//   ③ `packages/db/src/index.ts` が `readGateEngineerFacts` / `GateEngineerFacts` / `TenantTransactionClient` を
//      export しない（バレルに載った瞬間に `apps/**` から到達できる）
//   ④ `gate-target.ts` に `.engineer.` / `.engineerSkill.` / `.engineerCareer.` / `.skillSheet.` のデリゲート参照が無い
//      （台帳を C3 越しに読む経路が復活していない ＝ 所有で結果が変わる分岐が無い。`engineerSnapshot` は凍結コピーであり対象外）
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..', '..');

const SCAN_ROOTS = ['apps', 'packages'];
const IGNORED_DIRECTORIES = new Set(['node_modules', '.next', 'dist', '.turbo', 'generated']);
const SOURCE_EXTENSIONS = new Set(['.ts', '.tsx', '.mts', '.cts']);

/** 🔴 SECURITY DEFINER 2 関数を SQL として呼んでよい唯一のファイル。 */
const SQL_CALLER_FILE = 'packages/db/src/gate-engineer-facts.ts';
/** 🔴 `readGateEngineerFacts` の定義 + 唯一の消費者。 */
const TS_CALLER_FILES = ['packages/db/src/gate-engineer-facts.ts', 'packages/db/src/gate-target.ts'];
const GATE_TARGET_FILE = 'packages/db/src/gate-target.ts';
const BARREL_FILE = 'packages/db/src/index.ts';

const SQL_IDENTIFIERS = ['app_gate_proposal_engineer_pii', 'app_gate_proposal_engineer_skills'];

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

function filesMentioning(pattern: RegExp): string[] {
  return sourceFiles
    .filter((file) => pattern.test(stripComments(readFileSync(file, 'utf8'))))
    .map(toRepoRelative)
    .sort();
}

function readRepoFile(relative: string): string {
  return readFileSync(path.join(repoRoot, relative), 'utf8');
}

describe('🔴 ゲート実行文脈の限定経路（docs/05 §11.14）の呼び出し元は 1 ファイルである（§17.2 #31）', () => {
  it('対照: 走査対象のソースが存在し、許可ファイルが実在する（テスト自体が空振りしていない）', () => {
    expect(sourceFiles.length).toBeGreaterThan(0);
    const relatives = new Set(sourceFiles.map(toRepoRelative));
    expect(relatives.has(SQL_CALLER_FILE)).toBe(true);
    expect(relatives.has(GATE_TARGET_FILE)).toBe(true);
  });

  it.each(SQL_IDENTIFIERS)('① SQL 識別子 %s がコードとして現れるのは gate-engineer-facts.ts の 1 本だけ', (identifier) => {
    expect(filesMentioning(new RegExp(`\\b${identifier}\\b`))).toEqual([SQL_CALLER_FILE]);
  });

  it('② readGateEngineerFacts を参照するのは定義ファイル + gate-target.ts の 2 本だけ', () => {
    expect(filesMentioning(/\breadGateEngineerFacts\b/)).toEqual([...TS_CALLER_FILES].sort());
  });

  it('② の対照: gate-target.ts は実際に readGateEngineerFacts を呼んでいる（置き換えが戻っていない）', () => {
    const source = stripComments(readRepoFile(GATE_TARGET_FILE));
    expect(source).toMatch(/await readGateEngineerFacts\(tx, proposal\.id\)/);
    // 🔴 fail-closed の reason が固定されている（PASS に倒していない）。
    expect(source).toContain("'ENGINEER_FACTS_UNAVAILABLE'");
  });

  it('③ packages/db/src/index.ts は readGateEngineerFacts / GateEngineerFacts / TenantTransactionClient を export しない', () => {
    const barrel = stripComments(readRepoFile(BARREL_FILE));
    expect(barrel).not.toMatch(/\breadGateEngineerFacts\b/);
    expect(barrel).not.toMatch(/\bGateEngineerFacts\b/);
    expect(barrel).not.toMatch(/\bTenantTransactionClient\b/);
    expect(barrel).not.toContain('gate-engineer-facts');
    // 対照: バレルは gate-target.ts の公開面（loadGateInput）を export している（走査が別のファイルを見ていない）。
    expect(barrel).toMatch(/\bloadGateInput\b/);
  });

  it('④ gate-target.ts に台帳を C3 越しに読むデリゲート参照（.engineer. / .engineerSkill. / .engineerCareer. / .skillSheet.）が無い', () => {
    const source = stripComments(readRepoFile(GATE_TARGET_FILE));
    for (const delegate of ['engineer', 'engineerSkill', 'engineerCareer', 'skillSheet']) {
      expect(source, `gate-target.ts が .${delegate}. を参照している`).not.toMatch(new RegExp(`\\.${delegate}\\.`));
    }
    // 対照: 凍結コピー（engineerSnapshot）は経路 2 の開示範囲であり、引き続き読んでよい。
    expect(source).toMatch(/\.engineerSnapshot\./);
  });

  it('🔴 gate-engineer-facts.ts は proposalId 以外の鍵（engineerId / partnerCompanyId）を SQL に渡していない（§11.14 ⑤-1）', () => {
    const source = stripComments(readRepoFile(SQL_CALLER_FILE));
    // `${proposalId}::uuid` だけがパラメータとして現れる。
    const params = [...source.matchAll(/\$\{([^}]+)\}/g)].map((match) => match[1]?.trim());
    expect(params.length).toBeGreaterThan(0);
    expect(new Set(params)).toEqual(new Set(['proposalId']));
    expect(source).not.toMatch(/engineerId|partnerCompanyId|ownerPartnerCompanyId/);
  });
});
