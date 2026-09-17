// tests/static/career-audit-per-row.test.ts
// 🔴 T-09-12（docs/05 §17.2 #29）: **経歴の変更の監査が「行ごと」に残る**構造を静的に固定する
//    （`F-008 AC-5` / `docs/04` 申し送り 17-⑤ / docs/05 §16.1）。
//
//   ① `diffCareerRows` は純粋関数である（`packages/domain/src/ledger/careers.ts` は何も import しない。
//      `tests/static/domain-purity.test.ts` の走査対象でもある）
//   ② `engineer_career.*` の `AuditLog` を書く経路が `apps/web/lib/engineers/careers.ts` の 1 本だけ
//   ③ `summary` に載せるキーの集合をスナップショットで固定し、`role` / `description` / `technologies` が
//      含まれない（監査ログが第 2 の経歴台帳にならない）
//   ④ 独自 action（`engineer_career.save` / `.apply` 等）を作らない（`S-041` の接尾辞一致から漏れる）
//
// 結合側（1 回の保存で 3 行追加 + 1 行削除 → `AuditLog` 4 件）は `tests/isolation/engineer-careers.test.ts`。
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import {
  ENGINEER_CAREER_AUDIT_ACTIONS,
  ENGINEER_CAREER_AUDIT_SUMMARY_KEYS,
} from '../../apps/web/lib/engineers/careers';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..', '..');

const IGNORED_DIRECTORIES = new Set(['node_modules', '.next', 'dist', '.turbo', 'generated']);
const SOURCE_EXTENSIONS = new Set(['.ts', '.tsx', '.mts', '.cts']);

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

function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .map((line) => line.split('//')[0] ?? '')
    .join('\n');
}

const sourceFiles = ['apps', 'packages'].flatMap((root) => listSourceFiles(path.join(repoRoot, root))).filter(
  (file) => !isTestFile(file),
);

describe('① diffCareerRows は純粋関数である（packages/domain）', () => {
  it('packages/domain/src/ledger/careers.ts は 1 つも import を持たない（I/O・時刻・他パッケージに触れない）', () => {
    const file = path.join(repoRoot, 'packages/domain/src/ledger/careers.ts');
    const source = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true);
    const imports = source.statements.filter(
      (statement) => ts.isImportDeclaration(statement) || ts.isImportEqualsDeclaration(statement),
    );
    expect(imports).toHaveLength(0);
    // 対照: 関数はここに実在する。
    expect(source.text).toContain('export function diffCareerRows');
  });
});

describe('② engineer_career.* の監査を書く経路は 1 本だけ', () => {
  it("'engineer_career.' を含むソースは apps/web/lib/engineers/careers.ts と、読み取り側の許可リストだけ", () => {
    const offenders = sourceFiles
      .filter((file) => /engineer_career\./.test(stripComments(readFileSync(file, 'utf8'))))
      .map(toRepoRelative)
      .sort();
    expect(offenders).toEqual([
      'apps/web/lib/engineers/careers.ts',
      // ✅ T-11-09: `S-041` の行の詳細の許可リスト（docs/05 §6.4「#10 の改訂」）。`PARTNER_LEDGER_ACTION_PREFIXES` が
      //    「主体がパートナーなら 1 キーも出さない action の接頭辞」として `engineer_career.` を**読む側**で持つ。
      //    `AuditLog` を書く経路ではない（`writeAuditLog` を呼ばない。下の対照で固定）。
      'packages/domain/src/audit/pick-detail.ts',
    ]);
    // 対照: 許可リスト側は監査ログを書かない（書く経路が 2 本になっていない）。
    const pickDetail = stripComments(readFileSync(path.join(repoRoot, 'packages/domain/src/audit/pick-detail.ts'), 'utf8'));
    expect(pickDetail).not.toMatch(/writeAuditLog|auditLog\.|@ses\/db/);
  });

  it('action は create / update / delete の 3 種で、独自 action を持たない（S-041 の接尾辞一致）', () => {
    expect(Object.values(ENGINEER_CAREER_AUDIT_ACTIONS).sort()).toEqual([
      'engineer_career.create',
      'engineer_career.delete',
      'engineer_career.update',
    ]);
    for (const action of Object.values(ENGINEER_CAREER_AUDIT_ACTIONS)) {
      expect(action).toMatch(/\.(create|update|delete)$/);
    }
  });
});

describe('③ summary のキー集合（🔴 本文を載せない）', () => {
  it('キーはスナップショットどおり', () => {
    expect([...ENGINEER_CAREER_AUDIT_SUMMARY_KEYS].sort()).toEqual(
      ['careerId', 'changedFields', 'periodFrom', 'periodTo', 'source'].sort(),
    );
  });

  it('🔴 role / description / technologies（自由入力の本文）が summary のキーに無い', () => {
    const keys: readonly string[] = ENGINEER_CAREER_AUDIT_SUMMARY_KEYS;
    for (const forbidden of ['role', 'description', 'technologies', 'before', 'after']) {
      expect(keys).not.toContain(forbidden);
    }
  });
});
