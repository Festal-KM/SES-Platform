// tests/static/admin-console-frame.test.ts
// 🔴 **運営者コンソールの共通ナビが、認証済みの全画面にかかっている**ことを構造で固定する
//    （docs/04 §3.3-2「管理平面のナビは画面上部の横並びタブ 5 グループとする」。T-12-20）。
//
// ============================================================================
// なぜ静的検査か
// ============================================================================
// 本タスクが回収したのは「**外枠が 1 つも無く、どの画面からも他へ移動できない**」という欠落
// である。ナビは `app/admin/layout.tsx` ではなく**各区画のレイアウト**が描く
// （`A-001` サインインはナビを持たないため。理由は `app/admin/_components/console-frame.tsx` 冒頭）。
// この形は**新しい区画を足したときに置き忘れやすい** —— 置き忘れても画面は正常に描画され、
// テストも落ちず、「その画面からだけ移動できない」状態が静かに生まれる。だから機械で見る。
//
// 検査:
//   ① `apps/web/app/admin/**/page.tsx` のうち `A-001`（`/admin/signin`）以外は、自分自身か
//      祖先ディレクトリの `layout.tsx` のいずれかが `AdminConsoleFrame` を描いている。
//   ② 🔴 `/admin/signin` は**覆われていない**（未認証の画面にナビを出さない）。
//   ③ 🔴 `app/admin/layout.tsx`（= サインインも包む唯一のレイアウト）は `AdminConsoleFrame` を
//      描かない。ここに足すと ② が静かに破れる。
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..', '..');
const adminRoot = path.join(repoRoot, 'apps', 'web', 'app', 'admin');

const FRAME_IDENTIFIER = 'AdminConsoleFrame';
/** 未認証のためナビを持たない画面（docs/04 §3.3-2 の「ナビ外」）。 */
const UNAUTHENTICATED_PAGES = ['signin'] as const;

function collectPageDirs(dir: string, segments: readonly string[]): { dir: string; url: string }[] {
  const entries = readdirSync(dir, { withFileTypes: true });
  const self = entries.some((entry) => entry.isFile() && entry.name === 'page.tsx')
    ? [{ dir, url: `/admin/${segments.join('/')}`.replace(/\/$/, '') }]
    : [];
  return [
    ...self,
    ...entries
      .filter((entry) => entry.isDirectory() && !entry.name.startsWith('_'))
      .flatMap((entry) =>
        collectPageDirs(
          path.join(dir, entry.name),
          entry.name.startsWith('(') ? segments : [...segments, entry.name],
        ),
      ),
  ];
}

function drawsFrame(file: string): boolean {
  return existsSync(file) && readFileSync(file, 'utf8').includes(FRAME_IDENTIFIER);
}

/**
 * その画面がナビに覆われているか。
 * 🔴 **自分自身の `page.tsx`**（管理平面のホームだけがこの形）か、**自分自身を含む祖先の
 *    `layout.tsx`** が `AdminConsoleFrame` を描いている場合だけ覆われている。
 *    祖先の `page.tsx` は関係が無い（別の画面である）。
 */
function isCovered(pageDir: string): boolean {
  if (drawsFrame(path.join(pageDir, 'page.tsx'))) return true;
  let current = pageDir;
  for (;;) {
    if (drawsFrame(path.join(current, 'layout.tsx'))) return true;
    if (path.resolve(current) === path.resolve(adminRoot)) return false;
    current = path.dirname(current);
  }
}

const PAGES = collectPageDirs(adminRoot, []);

describe('対照: 走査が空振りしていない', () => {
  it('管理平面の画面が集まっている', () => {
    const urls = PAGES.map((page) => page.url);
    expect(urls).toContain('/admin');
    expect(urls).toContain('/admin/signin');
    expect(urls.length).toBeGreaterThanOrEqual(8);
  });
});

describe('🔴 認証済みの全画面に共通ナビがかかっている（docs/04 §3.3-2）', () => {
  const authenticated = PAGES.filter(
    (page) => !UNAUTHENTICATED_PAGES.some((name) => page.url === `/admin/${name}`),
  );

  it.each(authenticated.map((page) => page.url))('%s に共通ナビがかかっている', (url) => {
    const page = authenticated.find((candidate) => candidate.url === url);
    expect(page).toBeDefined();
    expect(isCovered(page?.dir ?? '')).toBe(true);
  });
});

describe('🔴 未認証の画面（A-001）にはナビを出さない', () => {
  it('/admin/signin は覆われていない', () => {
    const signin = PAGES.find((page) => page.url === '/admin/signin');
    expect(signin).toBeDefined();
    expect(isCovered(signin?.dir ?? '')).toBe(false);
  });

  it('🔴 app/admin/layout.tsx は AdminConsoleFrame を描かない（描くとサインインにもナビが出る）', () => {
    const source = readFileSync(path.join(adminRoot, 'layout.tsx'), 'utf8');
    expect(source).not.toContain(FRAME_IDENTIFIER);
  });
});
