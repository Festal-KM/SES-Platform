// apps/web/app/(main)/_shell/nav-current.render.test.tsx
// 🔴 **クライアント遷移で現在地が追随すること**（2026-10-04 の実バグの回帰検出器）。
//
// ============================================================================
// 🔴 何のバグを固定するのか
// ============================================================================
// 人間の報告: 「サイドメニューがどこをクリックしてもホームにハイライトされます。」
// demo 環境で再現・確認した実測（`packages/ui/src/lib/current-nav-path.ts` 冒頭に表がある）:
//
//   `/` にハードリロード → ホームが光る ✅
//   そこから `人材管理` をクリック（ソフトナビ）→ **まだホームが光る** ❌
//   さらに `案件管理` をクリック → **まだホームが光る** ❌
//   `/projects` をハードリロード → 案件管理が光る ✅
//   そこから `設定` をクリック → **案件管理が光ったまま、第 2 階層の帯も案件管理のまま残る** ❌
//
// 原因は **App Router のレイアウトがソフトナビゲーションで再描画されない**ことである
// （現在地は `apps/web/proxy.ts` が添えたヘッダから `layout.tsx` が読んでおり、
// レイアウトの出力は遷移の差分に含まれない）。
//
// 🔴 **これが無いと同じバグが戻る。** 既存の `./main-shell.render.test.tsx` は
//    `usePathname()` を持たない状態（= サーバの初回描画）だけを見ており、
//    **ヘッダの値と実際のパスが食い違う状態を 1 件も作っていない**ので、原理的に検出できない。
//    本ファイルは `usePathname` をモックして**その食い違いを作る。**
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { t } from '@ses/i18n';
import {
  buildBottomTabs,
  buildMainNav,
  buildNavSections,
  buildSettingsIndex,
  navSectionsWithTabs,
} from '../../../lib/shell/nav';
import { MainShell, type MainShellProps } from './main-shell';

// 🔴 クライアントの現在地（`usePathname()`）を差し替える。`vi.hoisted` でモック工場より先に作る
//    （`vi.mock` は import より前に巻き上げられるので、工場が参照できるのは hoisted な値だけ）。
const nav = vi.hoisted(() => ({ pathname: null as string | null }));
vi.mock('next/navigation', () => ({
  usePathname: (): string | null => nav.pathname,
}));

// 🔴 `OWNER` にしてあるのは、`設定` の索引が 7 項目すべてを持つロールだからである
//    （`/audit-logs` / `/skills` は `/settings` 配下に無い URL であり、**射程が効いているか**を
//    見るにはこのロールが要る。ロールで項目が増減しないことは `nav.test.ts` が別に固定する）。
const HOST = { audience: 'HOST', role: 'OWNER' } as const;

/**
 * 外枠を描く。`currentPath` は **`proxy.ts` のヘッダ由来の「初回描画の現在地」**であり、
 * `nav.pathname` は**クライアントが知っている現在地**である。
 * 🔴 **この 2 つを別の値にできることが本ファイルの要点である**（レイアウトが再描画されない =
 *    `currentPath` が最初に着地した画面のまま固まる、という実際の状態を作る）。
 */
function render(currentPath: string): string {
  const props: MainShellProps = {
    wordmark: t('product.name'),
    organizationName: 'テスト商事株式会社',
    partnerCompanyName: null,
    userName: '山田太郎',
    roleLabel: t('members.role.OWNER'),
    usage: { kind: 'NONE' },
    usageHref: '/settings/usage',
    nav: buildMainNav(HOST),
    sections: navSectionsWithTabs(buildNavSections(HOST)),
    settingsIndex: buildSettingsIndex(HOST),
    tabs: buildBottomTabs(),
    currentPath,
    children: createElement('main', { 'data-testid': 'shell-probe' }),
  };
  return renderToStaticMarkup(createElement(MainShell, props));
}

/** `data-testid="x"` の付いた開始タグ（属性の並び順に依存しない照合のため）。 */
function tagOf(html: string, testId: string): string {
  return new RegExp(`<[a-z]+[^>]*data-testid="${testId}"[^>]*>`).exec(html)?.[0] ?? '';
}

/** サイドバーの `<nav>` だけを取り出す（ヘッダ・本文・「その他」と混ぜない）。 */
function sidebarOf(html: string): string {
  return /data-testid="app-sidebar"[\s\S]*?<\/nav>/.exec(html)?.[0] ?? '';
}

/**
 * いま現在地として光っているサイドバーの項目（🔴 多くとも 1 つ）。
 * ⚠️ **属性の並び順に依存しない**で拾う（`aria-current` は `data-testid` より前に出る）。
 */
function currentNavIds(html: string): readonly string[] {
  const sidebar = sidebarOf(html);
  return [...sidebar.matchAll(/<[a-z]+[^>]*data-testid="app-nav-([a-z-]+)"[^>]*>/g)]
    .filter((match) => (match[0] as string).includes('aria-current="page"'))
    .map((match) => match[1] as string);
}

beforeEach(() => {
  nav.pathname = null;
});

describe('🔴 サイドバーの現在地がクライアント遷移に追随する（2026-10-04 の実バグ）', () => {
  it('🔴 ヘッダが `/` のままでも、クライアントが `/engineers` に居れば `人材管理` が光る', () => {
    // 🔴 これが人間の報告そのものである（サインイン直後にホームへ着地 → 以後どこへ行っても
    //    レイアウトは再描画されないので `currentPath` は `/` のまま）。
    nav.pathname = '/engineers';
    const html = render('/');
    expect(currentNavIds(html)).toEqual(['engineers']);
    expect(tagOf(html, 'app-nav-engineers')).toContain('bg-sidebar-selected-bg');
    // 🔴 ホームは光らない（修正前はここが `aria-current="page"` のままだった）。
    expect(tagOf(html, 'app-nav-home')).not.toContain('aria-current');
  });

  it('🔴 パスが変わるとハイライトが移る（同じ `currentPath` のまま 3 回移動する）', () => {
    const observed = ['/engineers', '/projects', '/settings', '/'].map((pathname) => {
      nav.pathname = pathname;
      // 🔴 `currentPath` は**動かさない**（レイアウトが再描画されない状態の再現）。
      return currentNavIds(render('/'));
    });
    expect(observed).toEqual([['engineers'], ['projects'], ['settings'], ['home']]);
  });

  it('🔴 第 2 階層・索引の射程もクライアント側で効く（`/proposals` で `案件管理` が光る）', () => {
    for (const [pathname, id] of [
      ['/proposals', 'projects'],
      ['/proposals/abc/approve', 'projects'],
      ['/proposal-requests', 'projects'],
      ['/skills', 'settings'],
      ['/audit-logs', 'settings'],
      ['/settings/organization', 'settings'],
    ] as const) {
      nav.pathname = pathname;
      expect(currentNavIds(render('/')), pathname).toEqual([id]);
    }
  });

  it('🔴 ホームは完全一致のときだけ光る（クライアント側でも前方一致にしない）', () => {
    nav.pathname = '/';
    expect(currentNavIds(render('/engineers'))).toEqual(['home']);
    nav.pathname = '/engineers';
    expect(currentNavIds(render('/'))).not.toContain('home');
  });

  it('🔴 `usePathname()` が取れないとき（水和前 / JS 無し）はサーバの判定をそのまま使う', () => {
    // 🔴 **ヘッダ経由の値を捨てていない**ことの固定 —— JS が効かない環境でも初回は正しく光る。
    nav.pathname = null;
    expect(currentNavIds(render('/projects'))).toEqual(['projects']);
    expect(currentNavIds(render('/'))).toEqual(['home']);
    expect(currentNavIds(render(''))).toEqual([]);
  });

  it('🔴 「その他」のパネルとボトムタブは現在地を持たない（柱と二重に示さない）', () => {
    nav.pathname = '/engineers';
    const html = render('/');
    const more = /data-testid="app-tab-more"[\s\S]*?<\/details>/.exec(html)?.[0] ?? '';
    expect(more.length).toBeGreaterThan(0);
    expect(more).not.toContain('aria-current');
    const tabs = /data-testid="app-bottom-tabs"[\s\S]*?data-testid="app-tab-more"/.exec(html)?.[0] ?? '';
    expect(tabs).not.toContain('aria-current');
    // 🔴 `matchPaths` が DOM へ漏れていない（未知の属性を `<a>` に流さない）。
    expect(html).not.toContain('matchPaths');
    expect(html).not.toContain('matchpaths');
  });
});

describe('🔴 第 2 階層の帯がクライアント遷移に追随する（帯ごと出る / 出ないが変わる）', () => {
  it('🔴 ヘッダが `/` のままでも、クライアントが `/proposals` に居れば帯が出て `提案` が光る', () => {
    nav.pathname = '/proposals';
    const html = render('/');
    expect(html).toContain('data-testid="app-section-nav"');
    expect(tagOf(html, 'app-section-tab-proposals')).toContain('aria-current="page"');
    expect(tagOf(html, 'app-section-tab-proposals')).toContain('border-b-brand');
    expect(tagOf(html, 'app-section-tab-projects')).not.toContain('aria-current');
  });

  it('🔴 セクションの外へ移動したら帯ごと消える（`/settings` に案件管理のタブが残らない）', () => {
    // 🔴 これが実測した症状の後半である（タブの色だけ直しても残る）。
    nav.pathname = '/settings';
    const html = render('/projects');
    expect(html).not.toContain('data-testid="app-section-nav"');
    expect(html).not.toContain('data-testid="app-section-tab-proposals"');
  });

  it('🔴 帯は多くとも 1 本である（候補を全部渡しても 2 本出ない）', () => {
    for (const pathname of ['/projects', '/proposals', '/proposal-requests', '/engineers', '/']) {
      nav.pathname = pathname;
      const html = render('/');
      expect((html.match(/data-testid="app-section-nav"/g) ?? []).length, pathname).toBeLessThanOrEqual(
        1,
      );
    }
  });

  it('🔴 ホスト所属の `/engineers` では帯が出ない（タブが 1 つのセクションは候補に入らない）', () => {
    nav.pathname = '/engineers';
    expect(render('/')).not.toContain('data-testid="app-section-nav"');
  });

  it('🔴 `usePathname()` が取れないときはサーバが選んだ帯をそのまま描く', () => {
    nav.pathname = null;
    expect(render('/proposals')).toContain('data-testid="app-section-nav"');
    expect(render('/settings')).not.toContain('data-testid="app-section-nav"');
  });
});
