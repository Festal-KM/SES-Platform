// tests/static/proposal-request-operation-literal.test.ts
// 🔴 T-12-17 ⑮（SP-11 T-11-09 申し送り ②）: `proposal_request.update` の `summary.operation` に載せる値
//    （`ACCEPT` / `DECLINE` / `WITHDRAW` / `EXPIRE`）は `packages/domain` の閉集合 `PROPOSAL_REQUEST_OPERATIONS`
//    （`audit/pick-detail.ts`）が唯一の出所であり、**書き込み側がリテラルで書き写す箇所が非テストソースに 0 件**であることを固定する。
//
// なぜ静的検査か: 値そのものは変えていない（監査ログの改変にならない）。守りたいのは「閉集合を直したのに書き込み側の
// 文字列が古いまま残る」経路であり、実行時テストでは既存の値が一致している限り見えない。ここでは
// `proposal_request.update` を書く側（`PROPOSAL_REQUEST_AUDIT_ACTION_UPDATE` を参照する / 文字列 `proposal_request.update` を持つ
// 非テストソース）を AST で歩き、4 値のいずれかに等しい文字列リテラルが無いことを見る。閉集合の宣言元だけが唯一の例外。
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { PROPOSAL_REQUEST_OPERATION, PROPOSAL_REQUEST_OPERATIONS } from '../../packages/domain/src/audit/pick-detail.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..', '..');

/** 走査の根（非テストの実装ソース）。 */
const SCAN_ROOTS = ['apps/web', 'apps/worker/src', 'packages/db/src', 'packages/domain/src', 'packages/ai/src', 'packages/connectors/src'];
const SKIPPED_DIRS = new Set(['node_modules', 'dist', '.next', '.turbo', 'coverage']);

/** 🔴 閉集合の宣言元（唯一の例外）。 */
const SOURCE_OF_TRUTH = 'packages/domain/src/audit/pick-detail.ts';

/** 書き込み側の目印（この語を持つファイルだけが `summary.operation` を書きうる）。 */
const WRITE_SITE_MARKERS = ['PROPOSAL_REQUEST_AUDIT_ACTION_UPDATE', 'proposal_request.update'];

/** 🔴 対照: 書き込み側 2 ファイル（ここに無ければ走査が空振りしている）。 */
const EXPECTED_WRITE_SITES = ['apps/web/lib/proposal-requests/service.ts', 'packages/db/src/proposal-request-expiry.ts'];

function listSources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return SKIPPED_DIRS.has(entry.name) ? [] : listSources(full);
    if (!/\.tsx?$/.test(entry.name)) return [];
    if (/\.(test|spec)\.tsx?$/.test(entry.name) || /\.render\.test\.tsx$/.test(entry.name)) return [];
    return [full];
  });
}

function toRepoRelative(absolute: string): string {
  return path.relative(repoRoot, absolute).split(path.sep).join('/');
}

const OPERATION_VALUES: ReadonlySet<string> = new Set(PROPOSAL_REQUEST_OPERATIONS);

/** ファイル内の文字列リテラル（テンプレートの静的部分を含む）のうち、4 値のいずれかに等しいものの位置。 */
function operationLiteralSites(file: string, text: string): string[] {
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const sites: string[] = [];
  const visit = (node: ts.Node): void => {
    if ((ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) && OPERATION_VALUES.has(node.text)) {
      sites.push(`${toRepoRelative(file)}:${source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1} '${node.text}'`);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return sites;
}

const writeSites = SCAN_ROOTS.flatMap((root) => listSources(path.join(repoRoot, root)))
  .map((absolute) => ({ file: absolute, relative: toRepoRelative(absolute), text: readFileSync(absolute, 'utf8') }))
  .filter((entry) => entry.relative !== SOURCE_OF_TRUTH)
  .filter((entry) => WRITE_SITE_MARKERS.some((marker) => entry.text.includes(marker)));

describe('🔴 proposal_request.update の summary.operation はリテラルで書かれない（T-12-17 ⑮）', () => {
  it('対照: 書き込み側 2 ファイルが走査に含まれる（空振りしていない）', () => {
    const relatives = writeSites.map((entry) => entry.relative);
    for (const expected of EXPECTED_WRITE_SITES) expect(relatives).toContain(expected);
  });

  it('🔴 書き込み側の非テストソースに ACCEPT / DECLINE / WITHDRAW / EXPIRE の文字列リテラルが 0 件', () => {
    const sites = writeSites.flatMap((entry) => operationLiteralSites(entry.file, entry.text));
    expect(sites, sites.join('\n')).toEqual([]);
  });

  it('書き込み側 2 ファイルは packages/domain の名前付き定数（PROPOSAL_REQUEST_OPERATION）を参照している', () => {
    for (const expected of EXPECTED_WRITE_SITES) {
      const entry = writeSites.find((candidate) => candidate.relative === expected);
      expect(entry?.text).toContain('PROPOSAL_REQUEST_OPERATION.');
    }
  });

  it('対照: 名前付き定数は閉集合の写しである（キー = 値。値を変えていない）', () => {
    expect(Object.entries(PROPOSAL_REQUEST_OPERATION).every(([key, value]) => key === value)).toBe(true);
    expect([...Object.keys(PROPOSAL_REQUEST_OPERATION)].sort()).toEqual([...PROPOSAL_REQUEST_OPERATIONS].sort());
    expect([...PROPOSAL_REQUEST_OPERATIONS].sort()).toEqual(['ACCEPT', 'DECLINE', 'EXPIRE', 'WITHDRAW']);
  });

  it('対照（合成ソース）: リテラルを書けば捕まる', () => {
    const synthetic = 'apps/web/lib/proposal-requests/synthetic.ts';
    expect(operationLiteralSites(synthetic, `const x = { operation: 'EXPIRE' };`)).toEqual([`${synthetic}:1 'EXPIRE'`]);
    expect(operationLiteralSites(synthetic, `const x = { operation: PROPOSAL_REQUEST_OPERATION.EXPIRE };`)).toEqual([]);
    // 状態名（`EXPIRED` / `DECLINED` / `ACCEPTED`）は別の語であり対象外。
    expect(operationLiteralSites(synthetic, `const s = 'EXPIRED'; const t = 'DECLINED'; const u = 'ACCEPTED';`)).toEqual([]);
  });
});
