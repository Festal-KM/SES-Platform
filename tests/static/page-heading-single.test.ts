// tests/static/page-heading-single.test.ts
// 🔴 主平面の**帯が 1 画面に 1 つ**であること、**自前のパンくずが残っていない**こと、
//    **画面の中のリンクが実在する画面だけを指す**ことを構造で固定する（T-12-21）。
//
// ============================================================================
// なぜ静的検査か
// ============================================================================
// 帯（`_shell/page-heading.tsx`）は 29 画面が共通で使う。移行の取りこぼしは
// **「パンくずが 2 本出る」「タイトルが 2 つ出る」**という形で現れるが、どちらも画面が描画
// されたときにしか目に見えず、`*.render.test.tsx` は**画面本体（screen コンポーネント）**を
// 対象にしていて `page.tsx` を通らない（`vitest.config.ts` の注記のとおり `app/**` の
// サーバコンポーネントはユニットテストの対象外）。したがって「どの `page.tsx` が帯を
// 何個描いているか」はソースの形で見るのが唯一の手段である。
//
// 🔴 **404 の検査（③）は `lib/shell/nav.test.ts` / `lib/shell/page-trail.test.ts` の続き**である。
//    あちらは「ナビと帯の表」を見ており、こちらは**画面の中に書かれた `href` のリテラル**を見る。
//    どちらか一方だけでは、未実装画面（Phase 2 / 3）への導線を塞げない。
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..', '..');
const mainPlaneRoot = path.join(repoRoot, 'apps', 'web', 'app', '(main)');

type SourceFile = { readonly rel: string; readonly text: string };

function walk(dir: string): readonly string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return walk(full);
    return entry.isFile() && (entry.name.endsWith('.tsx') || entry.name.endsWith('.ts')) ? [full] : [];
  });
}

/**
 * 🔴 ✅ `T-22-05`: 走査に **`packages/ui/src/components`** を足した。帯の**描画**が
 *    `packages/ui/src/components/page-header.tsx` へ移った（`docs/05` §2.3.1: 19 部品はすべて
 *    `packages/ui` に置く）ため、ここを見ないと「帯の実装は 1 つだけ」が**0 件でも真**になる
 *    （＝ 検査が空振りする）。`testid-inventory.test.ts` が `SCAN_ROOTS` に `packages/ui` を
 *    足したのと同じ理由である。🔴 **判定は変えていない**（実装は 1 ファイルだけ）。
 */
const SCAN_ROOTS = [mainPlaneRoot, path.join(repoRoot, 'packages', 'ui', 'src', 'components')];

const ALL_FILES: readonly SourceFile[] = SCAN_ROOTS.flatMap(walk)
  .filter((full) => !full.includes('.test.'))
  .map((full) => ({
    rel: path.relative(repoRoot, full).split(path.sep).join('/'),
    text: readFileSync(full, 'utf8'),
  }));

/** 認証前の 4 画面（`S-001` / `S-002` / `S-046`）は外枠の外であり、帯を持たない。 */
const PAGES: readonly SourceFile[] = ALL_FILES.filter(
  (file) => file.rel.endsWith('/page.tsx') && !file.rel.includes('/(auth)/'),
);

/**
 * 🔴 **画面タイトルを画面本体の `h1` が持つ画面**（帯には `title` を渡さない）。
 *    どちらにしたかを一覧で残す（T-12-21 の完了記録と同じ表）。値はその `h1` の `data-testid`。
 */
const TITLE_OWNED_BY_SCREEN: ReadonlyMap<string, string> = new Map([
  ['apps/web/app/(main)/engineers/[id]/page.tsx', 'engineer-detail-name'],
  ['apps/web/app/(main)/projects/[id]/page.tsx', 'project-detail-name'],
  ['apps/web/app/(main)/projects/[id]/visibility/page.tsx', 'project-visibility-name'],
]);

/**
 * Phase 2 / 3 の画面（`S-025`〜`S-034` / `S-037` / `S-039` / `S-040` / `S-043`〜`S-045`）の URL。
 * ✅ **2026-10-05: `/chat`（`S-031`）を外した** —— 画面（`app/(main)/chat/page.tsx`）と API
 *    （`/api/threads`）を実装したので、**リンクを張ってよい画面**になった。
 *    🔴 **他の 10 本は外さない**（実装していないものへのリンクは依然として 404 を作る）。
 */
const UNIMPLEMENTED_HREFS: readonly string[] = [
  '/contracts',
  '/orders',
  '/assignments',
  '/notifications',
  '/tasks',
  '/reports',
  '/settings/e-signature',
  '/settings/ai-roles',
  '/settings/match-weights',
  '/settings/sandbox',
];

describe('対照: 走査が空振りしていない', () => {
  it('主平面の `page.tsx` が集まっている', () => {
    expect(PAGES.length).toBeGreaterThanOrEqual(29);
    expect(PAGES.map((page) => page.rel)).toContain('apps/web/app/(main)/page.tsx');
  });
});

describe('🔴 ① 帯は 1 画面に 1 つ（パンくずが二重に出ない）', () => {
  it('すべての `page.tsx` が `<PageHeading` をちょうど 1 つ描く', () => {
    const wrong = PAGES.map((page) => ({
      rel: page.rel,
      count: (page.text.match(/<PageHeading\b/g) ?? []).length,
    })).filter((entry) => entry.count !== 1);
    expect(wrong).toEqual([]);
  });

  it('🔴 帯の実装は 1 つだけ（`data-testid="app-page-breadcrumb"` を他の場所で作らない）', () => {
    const owners = ALL_FILES.filter((file) => file.text.includes('data-testid="app-page-breadcrumb"')).map(
      (file) => file.rel,
    );
    // ✅ `T-22-05`: 描画が `packages/ui` へ移った（値の組み立ては `_shell/page-heading.tsx` に残る）。
    //    🔴 **「1 つだけ」という判定は変えていない。**
    expect(owners).toEqual(['packages/ui/src/components/page-header.tsx']);
  });

  it('🔴 自前のパンくずの列（`*.breadcrumb.*` を `/` で連ねたもの）が 1 つも残っていない', () => {
    // 残っている `*.breadcrumb.*` の参照は「一覧へ戻る」1 本のリンク（`not-found.tsx` 等）であり、
    // `/` 区切りで連なっていれば自前のパンくずである。
    const sameLineOffenders = ALL_FILES.filter((file) => /breadcrumb\.[A-Za-z.]+'\)\}[^\n]*\//.test(file.text)).map(
      (file) => file.rel,
    );
    // 🔴 上の同一行判定は `t('…breadcrumb.x')}` と `/` が同じ行にあることを要求するため、`<Link>` を
    //    挟んで複数行に割れた自前パンくず（移行前の `S-038` / `S-042` の形）を取りこぼす。**帯の実装
    //    自身（`page-heading.tsx`）以外で、`breadcrumb` キーを読む `t()` が 1 ファイルに 2 回以上
    //    現れたら自前のパンくずの疑いとする**（「一覧へ戻る」1 本の `not-found.tsx` 系は常に 1 回）。
    const PAGE_HEADING_REL = 'apps/web/app/(main)/_shell/page-heading.tsx';
    const BREADCRUMB_T_CALL = /t\(\s*['"][^'"]*breadcrumb[^'"]*['"]\s*\)/g;
    const multiCrumbOffenders = ALL_FILES.filter((file) => file.rel !== PAGE_HEADING_REL)
      .filter((file) => (file.text.match(BREADCRUMB_T_CALL) ?? []).length >= 2)
      .map((file) => file.rel);
    expect([...new Set([...sameLineOffenders, ...multiCrumbOffenders])]).toEqual([]);
  });

  it('🔴 空振り検査: 複数行に割れた自前パンくず（合成ソース）を上のロジックが実際に検知できる', () => {
    // 移行前の `S-038` / `S-042` にあった実際の形を単純化した合成ソース（`<Link>` を挟んで
    // breadcrumb キーの `t()` 呼び出しが 2 回、別の行に現れる）。この検査が空振りに陥っていないこと
    // （検知ロジックを壊す変更が緑のまま通らないこと）を固定する。
    const syntheticBadSource = [
      "        <Link href='/settings'>",
      "          {t('settings.breadcrumb.home')}",
      '        </Link>',
      '        <span>/</span>',
      "        {t('settings.breadcrumb.current')}",
    ].join('\n');
    const BREADCRUMB_T_CALL = /t\(\s*['"][^'"]*breadcrumb[^'"]*['"]\s*\)/g;
    expect((syntheticBadSource.match(BREADCRUMB_T_CALL) ?? []).length).toBeGreaterThanOrEqual(2);
    // 🔴 同一行判定（旧ロジック）はこの合成ソースを取りこぼす ―― それ自体がこの検査の存在理由である。
    expect(/breadcrumb\.[A-Za-z.]+'\)\}[^\n]*\//.test(syntheticBadSource)).toBe(false);
  });
});

describe('🔴 ② 画面タイトルが二重に出ない', () => {
  it('エンティティ名を `h1` に持つ 3 画面は帯に `title` を渡さない', () => {
    for (const [rel, titleTestId] of TITLE_OWNED_BY_SCREEN) {
      const page = PAGES.find((candidate) => candidate.rel === rel);
      expect(page, rel).toBeDefined();
      const heading = /<PageHeading[\s\S]*?\/>/.exec(page?.text ?? '');
      expect(heading, rel).not.toBeNull();
      expect(heading?.[0] ?? '', rel).not.toContain('title=');
      // 対照: その `h1` の `data-testid` はリポジトリに実在する（凍結を壊していない）。
      expect(ALL_FILES.some((file) => file.text.includes(`data-testid="${titleTestId}"`)), titleTestId).toBe(true);
    }
  });

  it('それ以外の画面は帯に `title` を渡す（見出しの無い画面を作らない）', () => {
    const missing = PAGES.filter((page) => !TITLE_OWNED_BY_SCREEN.has(page.rel))
      .filter((page) => !(/<PageHeading[\s\S]*?\/>/.exec(page.text)?.[0] ?? '').includes('title='))
      .map((page) => page.rel);
    expect(missing).toEqual([]);
  });
});

describe('🔴 ③ 未実装画面（Phase 2 / 3）へのリンクが 1 つも無い', () => {
  it('主平面のソースに書かれた `href` のリテラルが未実装の URL を指さない', () => {
    const offenders: string[] = [];
    for (const file of ALL_FILES) {
      // `href="/x"` / `href={`/x/...`}` / `href={'/x'}` のリテラルだけを見る（変数経由は表側で固定済み）。
      for (const match of file.text.matchAll(/href=(?:"|\{[`']?)(\/[^"`'\s{}]*)/g)) {
        const rawHref = match[1] ?? '';
        // 🔴 クエリ・フラグメント付き（`/chat?tab=1` 等）を比較の前に落とす。落とさないと
        //    `href === prefix` にも `startsWith(prefix + '/')` にも一致せず取りこぼす。
        const href = rawHref.split(/[?#]/)[0] ?? '';
        if (UNIMPLEMENTED_HREFS.some((prefix) => href === prefix || href.startsWith(`${prefix}/`))) {
          offenders.push(`${file.rel}: ${rawHref}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});
