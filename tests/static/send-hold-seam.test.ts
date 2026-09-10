// tests/static/send-hold-seam.test.ts
// 🔴 T-07-11: `send.hold-release` の `releaseSendHolds` seam が**未実装のままでよい**根拠を固定する。
//
// ============================================================================
// 🔴 なぜこのテストが要るか
// ============================================================================
// ワーカーの起動配線（`apps/worker/src/runtime.ts`）は `SendHoldReleaseDeps` を組み立てるために
// `releaseSendHolds` を渡さなければならない（既定値を置かない設計。`send-hold-release.ts`）。
// 実装は **SP-09 T-09-06** の範囲なので、T-07-11 は `sendHoldReleaseNotImplemented`（常に 0）を渡した。
//
// 🔴 「0 件復帰させた」は**今は事実**である —— `Proposal` / `Contract` の
//    `sendHoldReasonKey` を**書くコードがリポジトリに 1 つも無い**（保留行が存在しない）。
//    しかし SP-09 が送信の保留を実装した瞬間、同じ 0 が**嘘**になる
//    （`CLAUDE.md` §11.1「成功したように見えて実際には起きていない」）。
// 🔴 その瞬間に落ちるようにしておくのが本テストである。落ちたら `sendHoldReleaseNotImplemented`
//    を実装で置き換え（T-09-06）、このファイルを削除すること。**期待値を書き換えて緑にしない。**
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..', '..');
const SELF_RELATIVE_PATH = 'tests/static/send-hold-seam.test.ts';

const SKIP_DIRS = new Set(['node_modules', 'dist', '.next', 'coverage', '.turbo', 'test-results']);
/** 🔴 走査対象は実装だけ（`packages` / `apps`）。テストの期待値まで拾うと意味が薄れる。 */
const SCAN_ROOTS = ['packages', 'apps'] as const;

/** 🔴 保留を「書いた」ことを示す列（Prisma のデータオブジェクトのプロパティ名）。 */
const SEND_HOLD_COLUMNS = ['sendHoldReasonKey', 'sendHoldSince'] as const;

function listSourceFiles(dir: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      files.push(...listSourceFiles(full));
      continue;
    }
    if (statSync(full).isFile() && /\.(ts|tsx)$/.test(entry.name)) files.push(full);
  }
  return files;
}

/**
 * `sendHoldReasonKey` / `sendHoldSince` を**オブジェクトリテラルのプロパティとして書いている**
 * 箇所を探す（= Prisma の `data:` / `where:` に現れる形）。
 *
 * 🔴 単なる文字列一致にしないのは、コメントや型宣言（`send-hold-release.ts` の JSDoc）を
 *    拾ってしまうためである。**書き込みの形**だけを見る。
 */
function findSendHoldPropertyLines(sourceFile: ts.SourceFile): number[] {
  const lines: number[] = [];
  function visit(node: ts.Node): void {
    if (
      ts.isPropertyAssignment(node) &&
      (ts.isIdentifier(node.name) || ts.isStringLiteral(node.name)) &&
      (SEND_HOLD_COLUMNS as readonly string[]).includes(node.name.text)
    ) {
      lines.push(sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1);
    }
    ts.forEachChild(node, visit);
  }
  visit(sourceFile);
  return lines;
}

const OFFENDERS: readonly string[] = SCAN_ROOTS.flatMap((root) =>
  listSourceFiles(path.join(repoRoot, root)),
)
  .map((file) => [path.relative(repoRoot, file).split(path.sep).join('/'), file] as const)
  .filter(([relative]) => relative !== SELF_RELATIVE_PATH)
  .filter(
    ([relative, file]) =>
      findSendHoldPropertyLines(
        ts.createSourceFile(relative, readFileSync(file, 'utf8'), ts.ScriptTarget.ES2023, true),
      ).length > 0,
  )
  .map(([relative]) => relative);

describe('🔴 `send.*` の保留を書く経路がまだ存在しない（T-07-11 / SP-09 T-09-06）', () => {
  it('Proposal / Contract の sendHoldReasonKey・sendHoldSince を書く実装が 0 件である', () => {
    expect(
      OFFENDERS,
      '`send.*` の保留を書く実装が入りました。`apps/worker/src/runtime.ts` の ' +
        '`sendHoldReleaseNotImplemented` を SP-09 T-09-06 の実装で置き換え、本ファイルを削除してください。' +
        '（0 を返し続けると「配ったつもりで配れていない」状態になります）',
    ).toEqual([]);
  });

  it('対照: 検出器そのものは機能している（プロパティの形を拾える）', () => {
    const source = ts.createSourceFile(
      'fixture.ts',
      'const x = { data: { sendHoldReasonKey: "PROVIDER_QUOTA" } };',
      ts.ScriptTarget.ES2023,
      true,
    );
    expect(findSendHoldPropertyLines(source)).toEqual([1]);
  });

  it('対照: コメント・型宣言は拾わない（`send-hold-release.ts` の JSDoc で誤検知しない）', () => {
    const source = ts.createSourceFile(
      'fixture.ts',
      '// sendHoldReasonKey について\ntype T = { sendHoldReasonKey?: string };\n',
      ts.ScriptTarget.ES2023,
      true,
    );
    expect(findSendHoldPropertyLines(source)).toEqual([]);
  });
});
