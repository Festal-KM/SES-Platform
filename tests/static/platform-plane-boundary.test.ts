// tests/static/platform-plane-boundary.test.ts
// T-03-08: 管理平面の分離バイパスの**構造**を固定する（docs/05 §5.2 / §5.3 /
// docs/03 `program-design` 申し送り 2 / `CLAUDE.md` §10.5）。
//
// 🔴 ESLint（`@ses/db/platform` の import 制限）は「そのファイル集合に対してルールが効いている限り」
//    正しい。ゾーン定義の書き換えや `exports` の追加で**静かに緩む**経路があるため、
//    ここではモジュールの形そのものを走査する:
//   ① `@ses/db`（index）が `withPlatform*` への到達経路を 1 つも持たない
//   ② `@ses/db/platform` サブパスが package.json に宣言されている（唯一の公開経路）
//   ③ ESLint の ADMIN_PLANE_FILES が実在の管理平面ディレクトリを覆っている
//   ④ 管理平面の専用クエリ関数（`packages/db/src/platform/queries/**`）が
//      **必ず `withPlatformRead` / `withPlatformWrite` を通る**（監査を迂回する読み取りを作らない）
//   ⑤ サブパスの入口が内部関数（`restrictToWriteDomain` / `auditEntryOf`）を公開しない
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { ADMIN_PLANE_FILES } from '../../eslint.config.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..', '..');
const dbSrc = path.join(repoRoot, 'packages', 'db', 'src');

function read(relative: string): string {
  return readFileSync(path.join(repoRoot, relative), 'utf8');
}

/** コメントを落としたソース（設計意図をコメントに書いた行で落ちないようにする）。 */
function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .map((line) => line.split('//')[0] ?? '')
    .join('\n');
}

describe('① @ses/db（index）は withPlatform* への到達経路を持たない（docs/05 §5.2）', () => {
  const indexSource = stripComments(read('packages/db/src/index.ts'));

  it.each(['withPlatformRead', 'withPlatformWrite', 'PlatformReadDb', 'PlatformWriteDbFor'])(
    '🔴 index.ts が %s を export しない',
    (identifier) => {
      // 🔴 単語境界で見る。`PlatformReadDbOptions`（接続プールの初期化引数。公開してよい）は
      //    `PlatformReadDb` を部分文字列として含むため、`toContain` だと誤検知する。
      expect(indexSource).not.toMatch(new RegExp(`\\b${identifier}\\b`));
    },
  );

  it('🔴 index.ts が platform.js / platform/index.js を re-export しない', () => {
    expect(indexSource).not.toMatch(/from '\.\/platform\.js'/);
    expect(indexSource).not.toMatch(/from '\.\/platform\/index\.js'/);
  });

  it('対照: index.ts は接続プールの初期化だけを export する（空振り防止）', () => {
    expect(indexSource).toContain('configurePlatformReadDb');
    expect(indexSource).toContain('configurePlatformWriteDb');
  });
});

describe('② @ses/db/platform サブパスが唯一の公開経路である', () => {
  it('package.json に ./platform の exports がある', () => {
    const pkg = JSON.parse(read('packages/db/package.json')) as {
      exports: Record<string, { types: string; default: string }>;
    };
    expect(pkg.exports['./platform']).toEqual({
      types: './dist/src/platform/index.d.ts',
      default: './dist/src/platform/index.js',
    });
  });
});

describe('③ ESLint の管理平面ゾーンが実在のディレクトリを覆っている', () => {
  it.each(['apps/web/app/admin', 'apps/web/app/api/admin'])(
    '%s が ADMIN_PLANE_FILES の glob に含まれる',
    (dir) => {
      expect((ADMIN_PLANE_FILES as string[]).some((glob) => glob.startsWith(`${dir}/`))).toBe(true);
      // 実在するディレクトリであること（glob が空振りしていない）。
      expect(readdirSync(path.join(repoRoot, dir)).length).toBeGreaterThan(0);
    },
  );
});

describe('④ 管理平面の専用クエリ関数は必ず withPlatform* を通る（docs/05 §5.2 / §5.3）', () => {
  const queriesDir = path.join(dbSrc, 'platform', 'queries');
  const queryFiles = readdirSync(queriesDir).filter(
    (name) => name.endsWith('.ts') && !name.endsWith('.test.ts'),
  );

  it('対照: 専用クエリ関数のファイルが 1 つ以上ある（走査が空振りしていない）', () => {
    expect(queryFiles.length).toBeGreaterThan(0);
  });

  it.each(queryFiles)(
    '🔴 %s は withPlatformRead / withPlatformWrite のいずれかを通る（監査を迂回する読み取りを作らない）',
    (name) => {
      const source = stripComments(readFileSync(path.join(queriesDir, name), 'utf8'));
      const usesWrapper =
        source.includes('withPlatformRead') || source.includes('withPlatformWrite');
      expect(usesWrapper, `${name}: withPlatform* を経由していない`).toBe(true);
    },
  );

  it.each(queryFiles)('🔴 %s が接続プールを直接取得しない（ラッパを迂回しない）', (name) => {
    const source = stripComments(readFileSync(path.join(queriesDir, name), 'utf8'));
    expect(source).not.toContain('getPlatformReadClient');
    expect(source).not.toContain('getPlatformWriteClient');
  });
});

describe('⑤ サブパスの入口は内部関数を公開しない', () => {
  const entrySource = stripComments(read('packages/db/src/platform/index.ts'));

  it.each(['restrictToWriteDomain', 'auditEntryOf'])(
    '🔴 %s は @ses/db/platform から export されない（テスト用の @internal である）',
    (identifier) => {
      expect(entrySource).not.toContain(identifier);
    },
  );
});
