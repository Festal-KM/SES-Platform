// tests/static/package-zone-coverage.test.ts
// docs/05 §2.2: 新規 packages/* が eslint.config.mjs のゾーン定義（PACKAGE_ZONES）や
// 動的 import 検出用の ALL_SES_PACKAGE_NAMES から漏れると、依存方向ルール①②③④が
// 「コメントの注意喚起だけ」に頼ることになり、静かに効かなくなる（CLAUDE.md §2.1 / §3.2）。
// packages/*・apps/* の実ディレクトリと eslint.config.mjs のデータを突き合わせ、
// 未登録があれば機械的に落とす。
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  ALL_SES_PACKAGE_NAMES,
  APPS_PACKAGES,
  APPS_PATH_PATTERNS,
  PACKAGE_ZONES,
} from '../../eslint.config.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..', '..');

type Zone = { files: string[] };

function subdirNames(rootRelative: string): string[] {
  return readdirSync(path.join(repoRoot, rootRelative), { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name);
}

function packageNameOf(rootRelative: string, dirName: string): string {
  const pkgJsonPath = path.join(repoRoot, rootRelative, dirName, 'package.json');
  const pkgJson = JSON.parse(readFileSync(pkgJsonPath, 'utf8')) as { name?: string };
  if (!pkgJson.name) {
    throw new Error(`${pkgJsonPath} に "name" がありません`);
  }
  return pkgJson.name;
}

const packageDirs = subdirNames('packages');
const appDirs = subdirNames('apps');

describe('新規 packages/* が eslint.config.mjs のゾーン定義から漏れていないこと', () => {
  it.each(packageDirs)(
    'packages/%s は PACKAGE_ZONES のいずれかの files に含まれる（ルール①②③の適用対象になっている）',
    (dirName) => {
      const covered = (PACKAGE_ZONES as Zone[]).some((zone) =>
        zone.files.some((glob) => glob.startsWith(`packages/${dirName}/`)),
      );
      expect(covered).toBe(true);
    },
  );

  it.each(packageDirs)(
    'packages/%s の package.json name は ALL_SES_PACKAGE_NAMES に含まれる（forbidAllSes ゾーンの動的 import 検出対象になっている）',
    (dirName) => {
      const pkgName = packageNameOf('packages', dirName);
      expect(ALL_SES_PACKAGE_NAMES as string[]).toContain(pkgName);
    },
  );

  it.each(appDirs)('apps/%s の package.json name は ALL_SES_PACKAGE_NAMES に含まれる', (dirName) => {
    const pkgName = packageNameOf('apps', dirName);
    expect(ALL_SES_PACKAGE_NAMES as string[]).toContain(pkgName);
  });

  it.each(appDirs)('apps/%s の package.json name は APPS_PACKAGES に含まれる（ルール①の適用対象）', (dirName) => {
    const pkgName = packageNameOf('apps', dirName);
    expect(APPS_PACKAGES as string[]).toContain(pkgName);
  });

  // T-01-01 レビューの申し送り: APPS_PATH_PATTERNS（相対パス脱出の検出リスト。CATCH_ALL_MESSAGE の
  // 「相対パス経由の import も禁止」の実体）は APPS_PACKAGES と別の配列であり、新規アプリを
  // 追加したとき片方だけ更新して他方を忘れる事故を、この対照テストが機械的に検知する。
  it.each(appDirs)(
    'apps/%s の相対パス脱出パターン(**/apps/%s/**)が APPS_PATH_PATTERNS に含まれる（新規アプリ追加時の脱出リスト漏れを検知する）',
    (dirName) => {
      expect(APPS_PATH_PATTERNS as string[]).toContain(`**/apps/${dirName}/**`);
    },
  );

  it('対照: packages/ 配下に 1 件以上のディレクトリが存在する（このテスト自体が空振りしていないこと）', () => {
    expect(packageDirs.length).toBeGreaterThan(0);
  });
});
