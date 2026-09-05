// tests/static/aws-sdk-single-path.test.ts
// 🔴 T-04-03: **AWS SDK（`@aws-sdk/*`）を import してよい場所を 1 ファイルに固定する。**
//    `tests/static/ai-single-path.test.ts`（`@anthropic-ai/sdk` を `packages/ai/src/client.ts` に
//    限定する）と同じ発想である。
//
// なぜ要るか:
//   ① 🔴 **SDK 内部のリトライ**（既定 3 回）を止められるのは、クライアントを生成する場所だけである。
//      別の場所で `new SESv2Client()` が作られると、送信系キューの `attempts: 1`
//      （`packages/connectors/src/queues.ts`）を SDK が内側から無効化する（`BR-21` / `BR-22`）。
//   ② サービス固有の型（`SendEmailCommand` / `SESv2Client`）がドメイン層・ジョブ層へ漏れない
//      （`CLAUDE.md` §3.4「サービス差異をドメイン層に漏らさない」）。
//   ③ 主バレル（`@ses/connectors`）に SDK が載らない ——
//      `apps/web` は宛先分類・payload の型のために `@ses/connectors` を import しており、
//      主バレル経由で SDK が入ると Next.js のサーババンドルに AWS SDK 一式が同梱される。
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..', '..');

/** 🔴 AWS SDK を import してよい唯一のファイル（docs/03 §3.2.9 / docs/05 §8.3）。 */
const AWS_SDK_ADAPTER = 'packages/connectors/src/email/ses/aws-sdk-api.ts';

/**
 * 🔴 SDK の入口を公開する唯一のサブパス。ここも SDK を直接 import はせず、
 *    アダプタを re-export するだけである（再輸出は import 文の走査に引っかかる）。
 */
const AWS_SUBPATH_ENTRY = 'packages/connectors/src/aws.ts';

const SKIP_DIRS = new Set(['node_modules', 'dist', '.next', '.turbo', 'coverage', '.git']);
const SOURCE_PATTERN = /\.(ts|tsx|mts|cts|js|mjs|cjs)$/;

function listSourceFiles(dir: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      files.push(...listSourceFiles(full));
      continue;
    }
    if (statSync(full).isFile() && SOURCE_PATTERN.test(entry.name)) files.push(full);
  }
  return files;
}

function toRepoRelative(absolute: string): string {
  return path.relative(repoRoot, absolute).split(path.sep).join('/');
}

/** コメントを落としてから照合する（設計意図を書いた行で落とさない）。 */
function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .map((line) => line.split('//')[0] ?? '')
    .join('\n');
}

/** `@aws-sdk/*` を静的 import / 動的 import / require のいずれかで参照しているか。 */
const AWS_SDK_REFERENCE = /(?:from|import|require)\s*\(?\s*['"]@aws-sdk\/[^'"]*['"]/;

const sourceFiles = ['packages', 'apps', 'tests', 'scripts']
  .flatMap((root) => listSourceFiles(path.join(repoRoot, root)))
  .map(toRepoRelative)
  // このテスト自身（検出パターンを文字列として持つ）は対象外。
  .filter((file) => file !== 'tests/static/aws-sdk-single-path.test.ts');

describe('🔴 AWS SDK の単一経路（CLAUDE.md §3.4 / BR-22 / docs/03 §3.2.9）', () => {
  it('対照: このテストが空振りしていない（走査対象のソースがある）', () => {
    expect(sourceFiles.length).toBeGreaterThan(0);
  });

  it('🔴 @aws-sdk/* を import しているのはアダプタ 1 ファイル（とそのユニットテスト）だけである', () => {
    const importers = sourceFiles.filter((file) =>
      AWS_SDK_REFERENCE.test(stripComments(readFileSync(path.join(repoRoot, file), 'utf8'))),
    );
    // 🔴 テストは出荷されないが、**アダプタのユニットテスト以外**に増えていないことは見る
    //    （増えた時点で「SDK の型が別の層に漏れている」ため）。
    expect(importers.sort()).toEqual(
      [AWS_SDK_ADAPTER, 'packages/connectors/src/email/ses/aws-sdk-api.test.ts'].sort(),
    );
  });

  it('🔴 SDK 内部のリトライを止めている（maxAttempts: 1。既定の 3 回だと attempts: 1 が無意味になる）', () => {
    const source = readFileSync(path.join(repoRoot, AWS_SDK_ADAPTER), 'utf8');
    expect(source).toMatch(/new SESv2Client\(/);
    expect(stripComments(source)).toMatch(/maxAttempts:\s*1/);
  });

  it('🔴 主バレル（src/index.ts）がアダプタを re-export しない（サーババンドルに SDK を載せない）', () => {
    const barrel = stripComments(
      readFileSync(path.join(repoRoot, 'packages/connectors/src/index.ts'), 'utf8'),
    );
    expect(barrel).not.toContain('aws-sdk-api');
    expect(barrel).not.toContain('./aws.js');
  });

  it('🔴 SDK への公開経路は @ses/connectors/aws サブパス 1 本だけである', () => {
    const entry = readFileSync(path.join(repoRoot, AWS_SUBPATH_ENTRY), 'utf8');
    expect(entry).toContain('./email/ses/aws-sdk-api.js');

    const manifest = JSON.parse(
      readFileSync(path.join(repoRoot, 'packages/connectors/package.json'), 'utf8'),
    ) as { exports: Record<string, unknown> };
    expect(Object.keys(manifest.exports).sort()).toEqual(['.', './aws']);
  });

  it('🔴 ses/index.ts（主バレルが読む面）もアダプタを re-export しない', () => {
    const sesBarrel = stripComments(
      readFileSync(path.join(repoRoot, 'packages/connectors/src/email/ses/index.ts'), 'utf8'),
    );
    expect(sesBarrel).not.toContain('aws-sdk-api');
  });
});
