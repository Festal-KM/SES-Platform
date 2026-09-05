// tests/static/no-restricted-imports.test.ts
// docs/05 §17.2 #3: eslint.config.mjs の依存方向ルール①②③（CLAUDE.md §2.1）を、
// わざと違反させた fixture で「lint が落ちること」を検証する。
// SDK の単一経路（rule④）は tests/static/ai-single-path.test.ts で検証する。
//
// fixture 自体は本体のビルド対象に含めず（vitest / tsc の include から除外）、
// ここで文字列として読み込み、ESLint#lintText に架空の filePath を与えて検査する。
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ESLint } from 'eslint';
import { beforeAll, describe, expect, it } from 'vitest';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..', '..');
const fixturesDir = path.join(here, '__fixtures__', 'no-restricted-imports');

function readFixture(name: string): string {
  return readFileSync(path.join(fixturesDir, name), 'utf8');
}

// ESLint インスタンスの構築自体は数 ms で終わる（flat config は遅延解決のため）。
// 実際に重いのは初回の lintText() で発生する flat config の解決 + typescript-eslint のロードで、
// これが Vitest 既定 timeout (5000ms) を超えうる。ここで 1 回空 lint して解決コストを
// beforeAll の timeout 予算（30000ms）に寄せておくことで、各 it は解決済みの状態から
// 数十 ms で終わるようにする。
let eslint: ESLint;

beforeAll(async () => {
  eslint = new ESLint({ cwd: repoRoot });
  await eslint.lintText('', { filePath: path.join(repoRoot, 'packages/domain/src/__warmup__.ts') });
}, 30000);

/**
 * fixture の内容を、あたかも `spoofedRelativePath` に置かれたファイルであるかのように lint する。
 * 実体は tests/static/__fixtures__ 配下にあるが、依存方向ルールはファイルパスで判定されるため、
 * 検査したいゾーン（packages/domain 等）に見せかけて実行する。
 */
async function lintAs(content: string, spoofedRelativePath: string) {
  const filePath = path.join(repoRoot, spoofedRelativePath);
  const [result] = await eslint.lintText(content, { filePath });
  if (!result) {
    throw new Error(`lintText did not return a result for ${spoofedRelativePath}`);
  }
  return result;
}

function ruleIds(messages: ESLint.LintResult['messages']): string[] {
  return messages.map((m) => m.ruleId).filter((id): id is string => id !== null);
}

function hasRule(messages: ESLint.LintResult['messages'], ruleId: string): boolean {
  return ruleIds(messages).includes(ruleId);
}

describe('依存方向の ESLint ルール①②③（CLAUDE.md §2.1 / docs/05 §2.2）', () => {
  it('① packages/* から apps/* をパッケージ名で import すると検出する（解決に依存しない照合）', async () => {
    const result = await lintAs(
      readFixture('apps-import-bare.violation.ts'),
      'packages/domain/src/__violation__.ts',
    );
    expect(hasRule(result.messages, 'no-restricted-imports')).toBe(true);
  });

  it('① packages/* から apps/* を相対パス（.js specifier）で import すると検出する', async () => {
    const result = await lintAs(
      readFixture('apps-import-relative.violation.ts'),
      'packages/db/src/__violation__.ts',
    );
    expect(hasRule(result.messages, 'no-restricted-imports')).toBe(true);
  });

  it('① ルール①は db/ai/connectors 以外の packages/*（例: config）にも一律で効く', async () => {
    const result = await lintAs(
      readFixture('config-import-apps-bare.violation.ts'),
      'packages/config/src/__violation__.ts',
    );
    expect(hasRule(result.messages, 'no-restricted-imports')).toBe(true);
  });

  it('② packages/domain が他の @ses/* パッケージに依存すると検出する', async () => {
    const result = await lintAs(
      readFixture('domain-import-package.violation.ts'),
      'packages/domain/src/__violation__.ts',
    );
    expect(hasRule(result.messages, 'no-restricted-imports')).toBe(true);
  });

  it('② packages/domain が他の @ses/* パッケージのサブパスに依存すると検出する', async () => {
    const result = await lintAs(
      readFixture('domain-import-package-subpath.violation.ts'),
      'packages/domain/src/__violation__.ts',
    );
    expect(hasRule(result.messages, 'no-restricted-imports')).toBe(true);
  });

  it('② packages/domain が Node の I/O (fs) に依存すると検出する', async () => {
    const result = await lintAs(
      readFixture('domain-import-node-io.violation.ts'),
      'packages/domain/src/__violation__.ts',
    );
    expect(hasRule(result.messages, 'no-restricted-imports')).toBe(true);
  });

  it('② packages/domain が Node の I/O のサブパス（node:fs/promises 等）に依存すると検出する', async () => {
    const result = await lintAs(
      readFixture('domain-import-node-io-subpath.violation.ts'),
      'packages/domain/src/__violation__.ts',
    );
    const messages = result.messages.filter((m) => m.ruleId === 'no-restricted-imports');
    // fixture は node:fs/promises / fs/promises / node:timers/promises / node:stream/promises の 4 本を import する。
    expect(messages.length).toBeGreaterThanOrEqual(4);
  });

  it('② packages/domain が Node の I/O を動的 import (import()) しても検出する', async () => {
    const result = await lintAs(
      readFixture('domain-import-node-io-dynamic.violation.ts'),
      'packages/domain/src/__violation__.ts',
    );
    expect(hasRule(result.messages, 'no-restricted-syntax')).toBe(true);
  });

  it('③ packages/db が packages/ai に依存すると検出する', async () => {
    const result = await lintAs(readFixture('db-import-ai.violation.ts'), 'packages/db/src/__violation__.ts');
    expect(hasRule(result.messages, 'no-restricted-imports')).toBe(true);
  });

  it('③ packages/db が packages/ai のサブパス（@ses/ai/run）に依存すると検出する', async () => {
    const result = await lintAs(
      readFixture('db-import-ai-subpath.violation.ts'),
      'packages/db/src/__violation__.ts',
    );
    expect(hasRule(result.messages, 'no-restricted-imports')).toBe(true);
  });

  it('③ packages/db が packages/ai を動的 import (import()) しても検出する', async () => {
    const result = await lintAs(
      readFixture('db-import-ai-dynamic.violation.ts'),
      'packages/db/src/__violation__.ts',
    );
    expect(hasRule(result.messages, 'no-restricted-syntax')).toBe(true);
  });

  it('③ packages/ai が packages/connectors に依存すると検出する', async () => {
    const result = await lintAs(
      readFixture('ai-import-connectors.violation.ts'),
      'packages/ai/src/__violation__.ts',
    );
    expect(hasRule(result.messages, 'no-restricted-imports')).toBe(true);
  });

  it('③ packages/ai が packages/connectors のサブパス（@ses/connectors/email）に依存すると検出する', async () => {
    const result = await lintAs(
      readFixture('ai-import-connectors-subpath.violation.ts'),
      'packages/ai/src/__violation__.ts',
    );
    expect(hasRule(result.messages, 'no-restricted-imports')).toBe(true);
  });

  it('③ packages/connectors が packages/db に依存すると検出する', async () => {
    const result = await lintAs(
      readFixture('connectors-import-db.violation.ts'),
      'packages/connectors/src/__violation__.ts',
    );
    expect(hasRule(result.messages, 'no-restricted-imports')).toBe(true);
  });

  it('対照: packages/domain の正常系は違反 0 件', async () => {
    const result = await lintAs(readFixture('domain-clean.ok.ts'), 'packages/domain/src/index.ts');
    expect(result.errorCount).toBe(0);
  });
});

/**
 * 🔴 T-04-01 / docs/05 §13.1 / §2.2 の表:
 *    **モック実装（`packages/connectors/src/mock/**`）の import 元を
 *    `packages/connectors/src/index.ts` に限定する。**
 *    直接 import できると「この環境ならモック」というリクエストごとの分岐を業務コードに
 *    書けてしまい、差し替えが起動時 1 箇所に閉じているという前提が静かに壊れる
 *    （CLAUDE.md §11.1「production でモック実装が選ばれ得る経路を作らない」）。
 */
describe('モック実装の import 元の限定（docs/05 §13.1 / CLAUDE.md §11.1）', () => {
  const OUTSIDE_PATHS = [
    'apps/web/lib/__violation__.ts',
    'apps/web/app/api/(main)/__violation__/route.ts',
    'apps/worker/src/__violation__.ts',
    'packages/connectors/src/__violation__.ts',
    'tests/e2e/harness/__violation__.ts',
  ];

  it.each(OUTSIDE_PATHS)('🔴 %s からのサブパス import (@ses/connectors/mock) を検出する', async (spoofedPath) => {
    const result = await lintAs(readFixture('connectors-mock-subpath.violation.ts'), spoofedPath);
    expect(hasRule(result.messages, 'no-restricted-imports')).toBe(true);
  });

  it.each(OUTSIDE_PATHS)('🔴 %s からの動的 import (import()) も検出する', async (spoofedPath) => {
    const result = await lintAs(readFixture('connectors-mock-dynamic.violation.ts'), spoofedPath);
    expect(hasRule(result.messages, 'no-restricted-syntax')).toBe(true);
  });

  // 🔴 T-04-03 以降、`src/email/ses.ts` や `src/esign/docusign/oauth.ts` のようにサブディレクトリが
  //    増える。1 階層（`./mock/...`）だけ塞いでも、深い階層からの `'../../mock/...'` が素通りする。
  it.each([
    ['connectors-mock-relative.violation.ts', 'packages/connectors/src/__violation__.ts', './mock/email.js'],
    ['connectors-mock-relative-depth2.violation.ts', 'packages/connectors/src/email/ses.ts', '../mock/email.js'],
    [
      'connectors-mock-relative-depth3.violation.ts',
      'packages/connectors/src/esign/docusign/oauth.ts',
      '../../mock/esign.js',
    ],
    [
      'connectors-mock-relative-depth4.violation.ts',
      'packages/connectors/src/esign/docusign/internal/x.ts',
      '../../../mock/esign.js',
    ],
  ])('🔴 packages/connectors 内部の相対 import を検出する（%s: %s から %s）', async (fixture, spoofedPath) => {
    const result = await lintAs(readFixture(fixture), spoofedPath);
    expect(hasRule(result.messages, 'no-restricted-imports')).toBe(true);
  });

  it('対照: packages/connectors/src/index.ts からの import は許可される（違反 0 件）', async () => {
    const result = await lintAs(readFixture('connectors-mock-index.ok.ts'), 'packages/connectors/src/index.ts');
    expect(result.errorCount).toBe(0);
  });

  it('対照: モック実装自身の相対 import は許可される（違反 0 件）', async () => {
    const result = await lintAs(
      readFixture('connectors-mock-index.ok.ts'),
      'packages/connectors/src/mock/email.ts',
    );
    expect(result.errorCount).toBe(0);
  });

  it('🔴 モックの import が許される区画でも @ses/db は禁止のまま（許可を広げすぎていない）', async () => {
    const result = await lintAs(
      readFixture('connectors-import-db.violation.ts'),
      'packages/connectors/src/index.ts',
    );
    expect(hasRule(result.messages, 'no-restricted-imports')).toBe(true);
  });
});

/**
 * 🔴 T-03-08 / docs/03 `program-design` 申し送り 2 / `CLAUDE.md` §10.5:
 *    **主平面のコードから `withPlatform*` を import できない**ことを lint で担保する。
 *    到達経路は `@ses/db/platform` サブパスだけ（`@ses/db` の index は re-export しない）であり、
 *    それを管理平面の 2 区画と `tests/isolation/**` に限定する。
 */
describe('@ses/db/platform（分離バイパス）の import 元の限定（CLAUDE.md §10.5 / docs/05 §5.2）', () => {
  const MAIN_PLANE_PATHS = [
    'apps/web/app/(main)/__violation__.tsx',
    'apps/web/app/api/(main)/__violation__/route.ts',
    'apps/web/lib/__violation__.ts',
    'apps/worker/src/__violation__.ts',
    'packages/domain/src/__violation__.ts',
    // 🔴 packages/db 自身も（相対 import で足りるため）パッケージ名経由では禁止する。
    'packages/db/src/__violation__.ts',
  ];

  it.each(MAIN_PLANE_PATHS)('🔴 %s からの静的 import を検出する', async (spoofedPath) => {
    const result = await lintAs(readFixture('db-platform-subpath.violation.ts'), spoofedPath);
    expect(hasRule(result.messages, 'no-restricted-imports')).toBe(true);
  });

  it.each(MAIN_PLANE_PATHS)('🔴 %s からの動的 import (import()) も検出する', async (spoofedPath) => {
    const result = await lintAs(
      readFixture('db-platform-subpath-dynamic.violation.ts'),
      spoofedPath,
    );
    expect(hasRule(result.messages, 'no-restricted-syntax')).toBe(true);
  });

  it.each([
    'apps/web/app/admin/page.tsx',
    'apps/web/app/api/admin/tenants/route.ts',
    'tests/isolation/platform-plane.test.ts',
  ])('対照: %s からの import は許可される（違反 0 件）', async (spoofedPath) => {
    const result = await lintAs(readFixture('db-platform-subpath-admin.ok.ts'), spoofedPath);
    expect(result.errorCount).toBe(0);
  });

  it('🔴 管理平面ゾーンでも生 @prisma/client は禁止のまま（許可を広げすぎていない）', async () => {
    const raw = await lintAs(
      "import { PrismaClient } from '@prisma/client';\nexport const c = PrismaClient;\n",
      'apps/web/app/admin/__violation__.ts',
    );
    expect(hasRule(raw.messages, 'no-restricted-imports')).toBe(true);
  });

  it('🔴 管理平面ゾーンでも @ses/db/testing は禁止のまま（許可を広げすぎていない）', async () => {
    const raw = await lintAs(
      "import { createUnextendedClient } from '@ses/db/testing';\nexport const c = createUnextendedClient;\n",
      'apps/web/app/api/admin/__violation__/route.ts',
    );
    expect(hasRule(raw.messages, 'no-restricted-imports')).toBe(true);
  });
});
