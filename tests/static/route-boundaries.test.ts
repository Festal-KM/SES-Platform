// tests/static/route-boundaries.test.ts
// 🔴 **`loading.tsx` / `error.tsx` は「その画面だけ」を包む位置に置く。**（T-06-04 Iteration 3）
//
// ============================================================================
// なぜこの検査が要るか（実測で起きた壊れ方）
// ============================================================================
// Next.js の `loading.tsx` / `error.tsx` は、**そのセグメントと配下のすべてのルート**を
// Suspense / エラー境界で包む。一覧画面のために書いた境界をセグメントの直下
// （例: `app/(main)/projects/loading.tsx`）に置くと、次の 2 つが同時に壊れる。
//
//   ① **子ルートに別画面のローディング / エラーが出る。**
//      `/projects/new`（`S-012` 案件の登録）を開くと「**案件一覧**を読み込んでいます…」の
//      骨格が出ていた。
//   ② 🔴 **子ルートの `redirect()` が HTTP 307 でなくなる。**
//      境界があると Next はシェルを先に flush するため、その後で投げられた `redirect()` は
//      `NEXT_REDIRECT` の**ストリーム中のエラー digest**として届き、実際の遷移は
//      **クライアントのハイドレーション後**になる（サーバの応答は 200 + シェル）。
//      `/projects/new` に到達したパートナーがホームへ戻される（`docs/04` §S-012 権限差分）
//      という挙動が JS の到着待ちになり、E2E（`tests/e2e/isolation.spec.ts` の
//      「ホスト専用の画面 / API に到達できない」）が実測で落ちた。
//      ⚠️ 認可そのものは破れない（拒否の本体は Route Handler の `requireRole` と RLS。
//      `F-004 AC-9`）。壊れるのは**「画面もホームへ戻す」という補助の挙動**である。
//
// 🔴 **この 2 つは typecheck・ユニット・`*.render.test.tsx` のどれにも引っかからない。**
//    境界の「位置」はファイルの中身ではなくディレクトリ構造が決めるからである。
//    したがって構造そのものを機械的に検査する（`package-zone-coverage.test.ts` と同じ発想）。
//
// **守り方**: 境界を置くセグメントに子ルートを持たせない。一覧と詳細/登録が同じ URL 空間に
// 並ぶ場合は、一覧を**ルートグループ**（`(list)` など。URL に現れない）へ入れ、その中に
// `page.tsx` / `loading.tsx` / `error.tsx` を置く。
import { readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const here = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.resolve(here, '..', '..', 'apps', 'web', 'app');

/** 境界ファイル（このファイルがあるディレクトリが Suspense / エラー境界になる）。 */
const BOUNDARY_FILES = ['loading.tsx', 'error.tsx'] as const;

/** ルートを構成するファイル（このファイルがあるディレクトリは 1 つのルートである）。 */
const ROUTE_FILES = ['page.tsx', 'route.ts', 'route.tsx'] as const;

/**
 * 🔴 **プライベートフォルダ（`_form` など）はルートにならない**ので子ルートとして数えない
 *    （Next.js の規約。`app/(main)/projects/_form/**` は URL を持たない）。
 * 🔴 **ルートグループ（`(list)` など）は数える。** URL には現れないが、**境界の配下である
 *    ことは変わらない** —— 親セグメントに境界があると、その中のルートも包まれてしまう。
 */
function isRouteDirectory(name: string): boolean {
  return !name.startsWith('_') && !name.startsWith('.');
}

type Directory = {
  /** `app/` からの相対パス（POSIX 区切り）。 */
  readonly relativePath: string;
  readonly absolutePath: string;
  readonly files: readonly string[];
  readonly childDirectories: readonly string[];
};

function collectDirectories(absolute: string, relative: string): Directory[] {
  const entries = readdirSync(absolute, { withFileTypes: true });
  const files = entries.filter((entry) => entry.isFile()).map((entry) => entry.name);
  const childDirectories = entries
    .filter((entry) => entry.isDirectory() && isRouteDirectory(entry.name))
    .map((entry) => entry.name);

  const self: Directory = { relativePath: relative, absolutePath: absolute, files, childDirectories };
  const nested = entries
    .filter((entry) => entry.isDirectory())
    .flatMap((entry) =>
      collectDirectories(
        path.join(absolute, entry.name),
        relative === '' ? entry.name : `${relative}/${entry.name}`,
      ),
    );
  return [self, ...nested];
}

const directories = collectDirectories(appRoot, '');

/** 境界ファイルを持つディレクトリ（＝ 検査対象）。 */
const boundaryDirectories = directories.filter((directory) =>
  BOUNDARY_FILES.some((file) => directory.files.includes(file)),
);

/** そのディレクトリの配下に、自分自身以外のルートがあるか。 */
function nestedRoutesUnder(directory: Directory): string[] {
  const prefix = directory.relativePath === '' ? '' : `${directory.relativePath}/`;
  return directories
    .filter((candidate) => candidate.relativePath.startsWith(prefix))
    .filter((candidate) => candidate.relativePath !== directory.relativePath)
    // 🔴 プライベートフォルダ（`_form` など）の配下は URL を持たないので除く。
    .filter((candidate) =>
      candidate.relativePath
        .slice(prefix.length)
        .split('/')
        .every((segment) => isRouteDirectory(segment)),
    )
    .filter((candidate) => ROUTE_FILES.some((file) => candidate.files.includes(file)))
    .map((candidate) => candidate.relativePath);
}

describe('🔴 loading.tsx / error.tsx は「その画面だけ」を包む（T-06-04 Iteration 3）', () => {
  it('検査対象が 1 つ以上ある（走査が空振りしていないことの対照）', () => {
    expect(boundaryDirectories.length).toBeGreaterThan(0);
  });

  it.each(boundaryDirectories.map((directory) => [directory.relativePath, directory] as const))(
    'app/%s の境界の配下に、別のルートが 1 つも無い',
    (_label, directory) => {
      const nested = nestedRoutesUnder(directory);
      expect(
        nested,
        `app/${directory.relativePath} の loading.tsx / error.tsx が ${nested
          .map((route) => `app/${route}`)
          .join(', ')} まで包んでいます。` +
          '子ルートに別画面のローディング / エラーが出るうえ、**子ルートの redirect() が ' +
          'HTTP 307 ではなくハイドレーション後のクライアント遷移になります**。' +
          '境界を置く画面をルートグループ（例: `(list)/`）へ入れて、配下から子ルートを外してください。',
      ).toEqual([]);
    },
  );

  it('境界を持つディレクトリは、必ずその画面自身（`page.tsx`）を持つ', () => {
    // 🔴 `page.tsx` の無い場所に境界だけを置くと、「何を包んでいるのか」が構造から読めない。
    for (const directory of boundaryDirectories) {
      expect(directory.files, `app/${directory.relativePath} に page.tsx がありません`).toContain(
        'page.tsx',
      );
    }
  });
});
