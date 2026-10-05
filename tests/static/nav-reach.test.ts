// tests/static/nav-reach.test.ts
// 🔴 **到達性の証明**（2026-10-03。サイドバーをモックアップどおり「6 項目のフラット」に畳んだ変更の
//    安全網）。
//
// ============================================================================
// なぜこの 1 本が要るのか
// ============================================================================
// 畳む前のサイドバーは **群 4 つ + 16 項目**で、そのうち **`S-036` 送信ドメイン / `S-041` 監査ログ /
// `S-042` データの返却 / `S-015` 共有の設定 はナビが唯一の入口**だった
// （`apps/web/lib/shell/nav.ts` の `buildSettingsIndex` の 🔴）。
// 🔴 **6 項目に畳んだだけでは、この 4 画面が到達不能になり「機能が消える」。**
//    `CLAUDE.md` §13.3 の「Tier 3 の画面をモバイルで非表示にしない / 劣化はさせても遮断はしない」に
//    反するだけでなく、**画面は在るのに誰も開けない**という最悪の壊れ方（`CLAUDE.md` §11.1 の
//    「成功したように見えて実際には起きていない」と同型）になる。
//
// そこで **ロール別の到達集合が畳み込みの前後で一致する**ことを、実装から機械的に突き合わせる。
//
//   ① 🔴 **畳む前の到達集合（ロール別）を literal で凍結**し、現在の実装の到達集合と比較する。
//      増えてよいのは **`/settings`（索引そのもの）の 1 件だけ**である。
//      🔴 **凍結表は実装から生成しない** —— 生成すると、実装と期待値が同時にずれたときに
//         気づけない（`apps/web/lib/shell/nav.test.ts` の `SECTION_3_1_TABLE` と同じ構え）。
//   ② 🔴 **ロール条件が 1 つも変わっていない**こと（`/engineer-shares` / `/settings/organization` /
//      `/settings/usage` が現れるロールの集合）。
//   ③ 🔴 **主平面の静的ルートがすべて、ナビ・第 2 階層のタブ・`設定` の索引のいずれかから到達できる**
//      こと。到達しないものは**理由つきの許可リスト**に載せる（画面の中の導線から開くもの / 未認証）。
//   ④ 🔴 **第 2 階層が現に描かれている**配線（`layout.tsx` → `AppShell` → `SectionNav` /
//      `/settings` → `NavIndex`）。データだけ在って描かれていなければ到達性は 0 である。
//   ⑤ 🔴 **サイドバーがフラットである**こと（群の見出しを持たない）。
//
// 🔴 ✅ **2026-10-04 の 2 つの変更を織り込んでいる**（どちらも到達集合を 1 件も減らしていない）:
//   - **`レポート` をサイドバーから外した**（人間の明示指示）。🔴 畳む前も `LINK` ではなかったので
//     `PRE_FOLD_REACH` は 1 行も動かない（**到達性は変わっていない**）。文言キーは残している。
//   - **第 2 階層の帯の選び方が 2 段になった**（`navSectionsWithTabs` でパスに依存しない絞り込み +
//     `@ses/ui` の `currentNavSectionIndex` で現在地の判定）。理由は「App Router のレイアウトが
//     ソフトナビゲーションで再描画されない」ことであり、**同じ判定をクライアントの島
//     （`apps/web/app/(main)/_shell/nav-current.tsx`）も呼ぶ。**
//
// 🔴 **`tests/static/` に置く理由**: 到達性は「どの画面が入口を持つか」という**リポジトリ全体の
//    性質**であり、`apps/web` の 1 モジュールの単体性質ではない（③ はルート木の走査を伴う）。
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { TenantRole } from '@ses/db';
// 🔴 現在地の判定は `packages/ui` の**ソース**から読む（`tests/static/**` から `@ses/ui` の
//    パッケージ名は解決できない。`design-tokens.test.ts` が `lib/cn.js` を同じ形で読んでいる）。
import { currentNavSectionIndex } from '../../packages/ui/src/lib/current-nav-path.js';
import {
  buildMainNav,
  buildNavSections,
  buildSettingsIndex,
  navHrefs,
  navItems,
  navReachableHrefs,
  navSectionsWithTabs,
  type NavAudience,
  type NavSection,
} from '../../apps/web/lib/shell/nav';
import { repoRoot, toRepoRelative } from './support/ui-classes.js';

const MAIN_PLANE_ROOT = path.join(repoRoot, 'apps', 'web', 'app', '(main)');

// ============================================================================
// 走査（主平面の静的ルート）
// ============================================================================
/**
 * 🔴 実在する URL を**ディレクトリ走査で**作る（一覧をテストに書き写さない。書き写すと、
 *    画面が増えたときに「入口の無い画面」を見逃す）。ルートグループ（`(list)` / `(auth)`）は
 *    URL に現れない。🔴 **動的セグメント（`[id]`）を含むルートは対象外** —— あれらは
 *    一覧の行から開くものであり、ナビに置ける遷移先が存在しない。
 */
function collectRouteUrls(dir: string, segments: readonly string[]): string[] {
  const entries = readdirSync(dir, { withFileTypes: true });
  const urls = entries.some((entry) => entry.isFile() && entry.name === 'page.tsx')
    ? [`/${segments.join('/')}`.replace(/\/$/, '') || '/']
    : [];
  return [
    ...urls,
    ...entries
      .filter((entry) => entry.isDirectory() && !entry.name.startsWith('_'))
      .flatMap((entry) =>
        collectRouteUrls(
          path.join(dir, entry.name),
          entry.name.startsWith('(') ? segments : [...segments, entry.name],
        ),
      ),
  ];
}

const ROUTE_URLS = collectRouteUrls(MAIN_PLANE_ROOT, []);
const STATIC_ROUTE_URLS = ROUTE_URLS.filter((url) => !url.includes('['));

function sourceOf(relative: string): string {
  return readFileSync(path.join(repoRoot, relative), 'utf8');
}

// ============================================================================
// 🔴 ① 畳む前（2026-10-03 以前 = 群 4 つ + 16 項目）のロール別の到達集合（**literal の凍結**）
// ============================================================================
/**
 * 🔴 **畳む前の `buildMainNav` が `LINK` として持っていた遷移先**を、ロールごとに写したものである。
 *
 * 出所は畳み込み直前の実装（`git show HEAD:apps/web/lib/shell/nav.ts` の `salesItems` +
 * `settingsItems` + 最上段のホーム）であり、**href のリテラルは 13 種類しか無い**:
 *
 *   `/` / `/engineers` / `/engineer-shares` / `/projects` / `/proposals` / `/proposal-requests` /
 *   `/settings/organization` / `/settings/partner-companies` / `/settings/sending-domains` /
 *   `/settings/usage` / `/settings/retention` / `/audit-logs` / `/skills`
 *
 * ロール別の出し分けは 3 つの条件だけだった（**畳み込みで 1 つも変えていない**）:
 *   - `isTenantAdmin`（ホスト所属の `OWNER` / `ADMIN`）… 組織設定 / 送信ドメイン / データの返却 / 監査ログ
 *   - `audience === 'HOST'` … 利用量と上限（`F-027 AC-1`: 取引先には停止の事実と理由だけ）
 *   - `isEngineerShareRole`（`PARTNER_ADMIN` / `PARTNER_SALES`）… 共有の設定（経路 4）
 *
 * ⚠️ `候補を探す` / `面談・結果`（単独の URL を持たない）と `契約` / `稼働` / `チャット` /
 *    `タスク` / `実績`（Phase 2 / 3）は**畳む前も `LINK` ではなかった**ので、この表に現れない
 *    （到達集合は変わっていない。項目の**表示**が消えたことは `docs/04` の追随事項である）。
 */
const PRE_FOLD_REACH: Readonly<Record<TenantRole, readonly string[]>> = {
  OWNER: [
    '/',
    '/engineers',
    '/projects',
    '/proposals',
    '/proposal-requests',
    '/settings/organization',
    '/settings/partner-companies',
    '/settings/sending-domains',
    '/settings/usage',
    '/settings/retention',
    '/audit-logs',
    '/skills',
  ],
  ADMIN: [
    '/',
    '/engineers',
    '/projects',
    '/proposals',
    '/proposal-requests',
    '/settings/organization',
    '/settings/partner-companies',
    '/settings/sending-domains',
    '/settings/usage',
    '/settings/retention',
    '/audit-logs',
    '/skills',
  ],
  SALES: [
    '/',
    '/engineers',
    '/projects',
    '/proposals',
    '/proposal-requests',
    '/settings/partner-companies',
    '/settings/usage',
    '/skills',
  ],
  // 🔴 `VIEWER` は `SALES` と同じ到達集合である（見える**中身**が変わるのは RLS と各画面の
  //    権限差分であり、ナビの項目集合ではない。`nav.test.ts` の同判定と対）。
  VIEWER: [
    '/',
    '/engineers',
    '/projects',
    '/proposals',
    '/proposal-requests',
    '/settings/partner-companies',
    '/settings/usage',
    '/skills',
  ],
  PARTNER_ADMIN: [
    '/',
    '/engineers',
    '/engineer-shares',
    '/projects',
    '/proposals',
    '/proposal-requests',
    '/settings/partner-companies',
    '/skills',
  ],
  PARTNER_SALES: [
    '/',
    '/engineers',
    '/engineer-shares',
    '/projects',
    '/proposals',
    '/proposal-requests',
    '/settings/partner-companies',
    '/skills',
  ],
};

/**
 * 🔴 畳み込みで**増えた遷移先**（これだけである）。
 *    `/settings` は 7 項目の索引そのものであり、**畳む前の `設定` 群の見出しに相当する**。
 */
const FOLD_ADDED_HREFS: readonly string[] = ['/settings'];

/** 所属の軸（ロール名で代用しない。`memberships` の CHECK と 1 対 1）。 */
const AUDIENCE_ROLES: Readonly<Record<NavAudience, readonly TenantRole[]>> = {
  HOST: ['OWNER', 'ADMIN', 'SALES', 'VIEWER'],
  PARTNER: ['PARTNER_ADMIN', 'PARTNER_SALES'],
};

function audienceOf(role: TenantRole): NavAudience {
  return AUDIENCE_ROLES.PARTNER.includes(role) ? 'PARTNER' : 'HOST';
}

/** そのロールがナビ・第 2 階層のタブ・索引・ボトムタブから到達できる遷移先（昇順）。 */
function reachOf(role: TenantRole): readonly string[] {
  return [...navReachableHrefs({ audience: audienceOf(role), role })].sort();
}

const ALL_ROLES: readonly TenantRole[] = [...AUDIENCE_ROLES.HOST, ...AUDIENCE_ROLES.PARTNER];

/**
 * そのパスで帯に出るセクション（`null` = 帯を描かない）。
 *
 * 🔴 ✅ **2026-10-04: 実装と同じ 2 段の組み合わせで求める** ——
 *    ①`navSectionsWithTabs`（パスに依存しない絞り込み。サーバ側）
 *    ②`@ses/ui` の `currentNavSectionIndex`（現在地の判定。**サーバの初回描画とクライアントの島が
 *      同じものを呼ぶ 1 実装**）。
 *    🔴 ここで独自に `find` を書くと、**実装とテストが別々の規則を持つ**ことになる。
 */
function sectionAt(sections: readonly NavSection[], currentPath: string): NavSection | null {
  const withTabs = navSectionsWithTabs(sections);
  const index = currentNavSectionIndex(
    currentPath,
    withTabs.map((section) => navHrefs(section.items)),
  );
  return index < 0 ? null : (withTabs[index] ?? null);
}

describe('対照: 走査が空振りしていない', () => {
  it('主平面の静的ルートが集まっている', () => {
    expect(STATIC_ROUTE_URLS).toContain('/');
    expect(STATIC_ROUTE_URLS).toContain('/engineers');
    expect(STATIC_ROUTE_URLS).toContain('/settings/sending-domains');
    expect(STATIC_ROUTE_URLS.length).toBeGreaterThanOrEqual(18);
    // 動的ルートは落ちている（`[id]` を含む URL が 1 つも無い）。
    expect(STATIC_ROUTE_URLS.filter((url) => url.includes('['))).toEqual([]);
    expect(ROUTE_URLS.some((url) => url.includes('['))).toBe(true);
  });

  it('🔴 ロール表が `TENANT_ROLES`（`packages/db`）の全値を覆っている', () => {
    // 🔴 `@ses/db` を**値として** import しない（静的検査に Prisma を読み込ませない）。
    //    `TENANT_ROLES` の宣言をソースから読んで突き合わせる。
    const context = sourceOf('packages/db/src/context.ts');
    const declaration = /export const TENANT_ROLES = \[([\s\S]*?)\] as const;/.exec(context);
    expect(declaration, 'TENANT_ROLES の宣言が見つからない').not.toBeNull();
    const declared = [...(declaration?.[1] ?? '').matchAll(/'([A-Z_]+)'/g)].map((match) => match[1] as string);
    expect(declared.length).toBeGreaterThanOrEqual(6);
    // 🔴 ロールが増えたら（`PARTNER_VIEWER` = `T-16-12`）**この検査が落ちる** ——
    //    落ちることで「新しいロールの到達集合を決めていない」ことに気づける。
    expect([...declared].sort()).toEqual([...ALL_ROLES].sort());
    expect([...Object.keys(PRE_FOLD_REACH)].sort()).toEqual([...declared].sort());
  });
});

describe('🔴 ① ロール別の到達集合が、畳む前と一致する（機能が 1 つも消えていない）', () => {
  it.each(ALL_ROLES)('%s: 畳む前の遷移先がすべて到達可能なまま', (role) => {
    const reach = reachOf(role);
    const missing = PRE_FOLD_REACH[role].filter((href) => !reach.includes(href));
    expect(
      missing,
      `🔴 ${role} が到達できなくなった画面がある: ${missing.join(', ')}\n` +
        '6 項目に畳む前はナビから直接開けていた。第 2 階層のタブ（`buildNavSections`）か ' +
        '`設定` の索引（`buildSettingsIndex`）に置くこと（`CLAUDE.md` §13.3「遮断しない」）。',
    ).toEqual([]);
  });

  it.each(ALL_ROLES)('%s: 増えた遷移先は `/settings`（索引）の 1 件だけ', (role) => {
    const added = reachOf(role).filter((href) => !PRE_FOLD_REACH[role].includes(href));
    expect(
      added,
      `🔴 ${role} に新しい遷移先が増えている: ${added.join(', ')}\n` +
        '畳み込みは到達手段の置き換えであり、ロール別の到達範囲を広げる変更ではない' +
        '（広げるなら `docs/04` の権限差分の改訂 = 人間の判断を要する）。',
    ).toEqual(FOLD_ADDED_HREFS.filter((href) => added.includes(href)));
    expect(added.every((href) => FOLD_ADDED_HREFS.includes(href))).toBe(true);
  });

  it.each(ALL_ROLES)('%s: 到達集合が「畳む前 + /settings」と完全一致する（過不足ゼロ）', (role) => {
    expect(reachOf(role)).toEqual([...PRE_FOLD_REACH[role], ...FOLD_ADDED_HREFS].sort());
  });

  it('🔴 対照: 凍結表はロールで現に違う（全ロール同じ表を比べて緑になっていない）', () => {
    expect(PRE_FOLD_REACH.OWNER.length).toBeGreaterThan(PRE_FOLD_REACH.SALES.length);
    expect(PRE_FOLD_REACH.PARTNER_ADMIN).toContain('/engineer-shares');
    expect(PRE_FOLD_REACH.OWNER).not.toContain('/engineer-shares');
  });
});

describe('🔴 ② ロールによる出し分けの条件が 1 つも変わっていない', () => {
  it('`/engineer-shares`（経路 4 の共有設定）は取引先の `PARTNER_ADMIN` / `PARTNER_SALES` だけ', () => {
    const reachable = ALL_ROLES.filter((role) => reachOf(role).includes('/engineer-shares'));
    expect(reachable).toEqual(['PARTNER_ADMIN', 'PARTNER_SALES']);
  });

  it('`/settings/organization` / `/settings/sending-domains` / `/settings/retention` / `/audit-logs` はホストの `OWNER` / `ADMIN` だけ', () => {
    for (const href of [
      '/settings/organization',
      '/settings/sending-domains',
      '/settings/retention',
      '/audit-logs',
    ]) {
      expect(
        ALL_ROLES.filter((role) => reachOf(role).includes(href)),
        href,
      ).toEqual(['OWNER', 'ADMIN']);
    }
  });

  it('🔴 `/settings/usage`（S-038）はホスト所属だけ（`F-027 AC-1`: 取引先には停止の事実と理由だけ）', () => {
    expect(ALL_ROLES.filter((role) => reachOf(role).includes('/settings/usage'))).toEqual(
      AUDIENCE_ROLES.HOST as TenantRole[],
    );
  });

  it('🔴 索引（`/settings`）そのものは全ロールが開ける（空の索引にならない = 最低 2 項目）', () => {
    for (const role of ALL_ROLES) {
      expect(reachOf(role), role).toContain('/settings');
      const items = buildSettingsIndex({ audience: audienceOf(role), role });
      expect(items.length, role).toBeGreaterThanOrEqual(2);
      // 🔴 索引の行はすべてリンクである（押せない行を索引に並べない）。
      expect(items.every((item) => item.reach.kind === 'LINK'), role).toBe(true);
    }
  });
});

describe('🔴 ③ 主平面の静的ルートに入口がある（到達不能な画面を作らない）', () => {
  /**
   * 🔴 **ナビ・タブ・索引から到達しない静的ルートと、その入口**。
   *    🔴 **「入口が無い」ものをここに載せてはならない** —— ここは「別の画面の中に入口が在る」
   *       ことの記録であって、例外の置き場所ではない。
   */
  const REACHED_FROM_SCREEN: ReadonlyMap<string, string> = new Map([
    ['/signin', '未認証（外枠の外。`S-001`）'],
    ['/password-reset', '未認証（`S-002`。サインイン画面の導線）'],
    ['/password-reset/confirm', '未認証（メールのリンクから開く）'],
    ['/engineers/new', '`S-005` の primary アクション（人材を登録）'],
    ['/projects/new', '`S-010` の primary アクション（案件を登録）'],
    ['/proposals/new', '`S-016` 候補検索 / `S-019` 提案一覧の導線'],
    ['/proposals/send-failures', '`S-019` 提案一覧の導線（`S-022` 送信失敗一覧）'],
  ]);

  it('すべての静的ルートが、ナビ / タブ / 索引から到達できるか、画面の中に入口がある', () => {
    const reachable = new Set(ALL_ROLES.flatMap((role) => [...reachOf(role)]));
    const orphans = STATIC_ROUTE_URLS.filter(
      (url) => !reachable.has(url) && !REACHED_FROM_SCREEN.has(url),
    );
    expect(
      orphans,
      `🔴 入口の無い画面がある: ${orphans.join(', ')}\n` +
        'ナビ（`buildMainNav`）/ 第 2 階層のタブ（`buildNavSections`）/ `設定` の索引' +
        '（`buildSettingsIndex`）のいずれかに置くか、画面の中の導線を ' +
        '`REACHED_FROM_SCREEN` に理由つきで記録すること。',
    ).toEqual([]);
  });

  it('🔴 `REACHED_FROM_SCREEN` に陳腐化した項目が無い（実在し、かつナビから到達しない）', () => {
    for (const [url, reason] of REACHED_FROM_SCREEN) {
      expect(STATIC_ROUTE_URLS, url).toContain(url);
      expect(reason.trim().length, url).toBeGreaterThan(0);
    }
    const reachable = new Set(ALL_ROLES.flatMap((role) => [...reachOf(role)]));
    const redundant = [...REACHED_FROM_SCREEN.keys()].filter((url) => reachable.has(url));
    expect(redundant, 'ナビから到達できるのに「画面の中から開く」として記録されている').toEqual([]);
  });

  it('🔴 ナビが指す遷移先はすべて実在する（404 を作らない）', () => {
    const missing = ALL_ROLES.flatMap((role) =>
      reachOf(role).filter((href) => !ROUTE_URLS.includes(href)),
    );
    expect([...new Set(missing)]).toEqual([]);
  });
});

describe('🔴 ④ 第 2 階層が現に描かれている（データだけ在って描かれていない状態を作らない）', () => {
  it('外枠が `SectionNav` に、第 2 階層のタブを渡している', () => {
    const layout = sourceOf('apps/web/app/(main)/layout.tsx');
    expect(layout).toContain('navSectionsWithTabs(');
    expect(layout).toContain('sections=');
    expect(layout).toContain('settingsIndex=');
    const mainShell = sourceOf('apps/web/app/(main)/_shell/main-shell.tsx');
    expect(mainShell).toContain('resolveSectionTabs(');
    expect(mainShell).toContain('sectionTabsLabel=');
    const appShell = sourceOf('packages/ui/src/components/app-shell.tsx');
    expect(appShell).toContain('<SectionNav');
  });

  it('🔴 ✅ 帯の現在地がクライアント遷移に追随する配線が在る（2026-10-04）', () => {
    // 🔴 **データだけ在って追随しなければ、到達性は「見えているのに違う画面のタブ」になる**
    //    （`/settings` に案件管理のタブが残り続けた実測症状）。配線は 2 本である。
    const mainShell = sourceOf('apps/web/app/(main)/_shell/main-shell.tsx');
    expect(mainShell).toContain('sectionGate={SectionNavGate}');
    expect(mainShell).toContain('linkComponent={NavLink}');
    const island = sourceOf('apps/web/app/(main)/_shell/nav-current.tsx');
    expect(island.trimStart().startsWith("'use client'")).toBe(true);
    expect(island).toContain('usePathname');
    // 🔴 判定は `@ses/ui` の 1 実装を呼ぶ（島が 2 つ目の判定を書いていない）。
    expect(island).toContain('currentNavSectionIndex');
    expect(island).toContain('matchesCurrentNavPath');
    const appShell = sourceOf('packages/ui/src/components/app-shell.tsx');
    expect(appShell).toContain('sectionGate');
  });

  it('`設定` の索引が `buildSettingsIndex` の結果を `NavIndex` で描いている', () => {
    const page = sourceOf('apps/web/app/(main)/settings/page.tsx');
    expect(page).toContain('buildSettingsIndex(');
    expect(page).toContain('<NavIndex');
    // 🔴 索引ページにロール判定を書いていない（2 つ目のロール表を作らない）。
    expect(page).not.toContain("role === 'OWNER'");
    expect(page).not.toContain('isTenantAdmin');
  });

  it('🔴 第 2 階層が成立するセクションで、現にタブが 2 つ以上描かれる', () => {
    // 案件管理（`/projects` 配下）はどの所属でも 3 タブ（案件一覧 / 提案 / 提案依頼）。
    for (const role of ALL_ROLES) {
      const context = { audience: audienceOf(role), role };
      const section = sectionAt(buildNavSections(context), '/projects');
      expect(section?.id, role).toBe('projects');
      expect(section?.items.map((item) => item.id), role).toEqual([
        'projects',
        'proposals',
        'proposal-requests',
      ]);
    }
    // 人材管理は取引先（共有の設定を持つロール）だけが 2 タブになる。ホストは 1 つなので
    // 帯を描かない（`navSectionsWithTabs` が外す）が、サイドバーの項目が入口を持つ。
    for (const role of AUDIENCE_ROLES.PARTNER) {
      const section = sectionAt(buildNavSections({ audience: 'PARTNER', role }), '/engineers');
      expect(section?.items.map((item) => item.id), role).toEqual(['engineers', 'engineer-shares']);
    }
    for (const role of AUDIENCE_ROLES.HOST) {
      expect(sectionAt(buildNavSections({ audience: 'HOST', role }), '/engineers'), role).toBeNull();
      expect(reachOf(role), role).toContain('/engineers');
    }
  });

  it('🔴 `/engineers` のタブ判定が `/engineer-shares` を飲み込まない（前方一致の事故）', () => {
    const sections = buildNavSections({ audience: 'PARTNER', role: 'PARTNER_SALES' });
    expect(sectionAt(sections, '/engineer-shares')?.id).toBe('engineers');
    expect(sectionAt(sections, '/engineers/00000000-0000-7000-8000-000000000000')?.id).toBe(
      'engineers',
    );
    // 🔴 どのセクションにも属さない画面では帯を描かない（ホーム / 設定 / スキル辞書）。
    for (const path of ['/', '/settings', '/skills', '/audit-logs']) {
      expect(sectionAt(sections, path), path).toBeNull();
    }
  });
});

describe('🔴 ⑤ サイドバーはモックアップどおりフラットである', () => {
  it.each(ALL_ROLES)('%s: 群は 1 つで見出しを持たず、項目はちょうど 5 つ', (role) => {
    const groups = buildMainNav({ audience: audienceOf(role), role });
    expect(groups.length).toBe(1);
    expect(groups[0]?.labelKey).toBeNull();
    // ✅ 2026-10-04: `レポート` を外した（人間の明示指示）。🔴 **到達集合は 1 件も減っていない**
    //    （畳む前も `LINK` ではなく、`PRE_FOLD_REACH` に現れない項目だった）。
    expect(navItems(groups).map((item) => item.id)).toEqual([
      'home',
      'chat',
      'engineers',
      'projects',
      'settings',
    ]);
  });

  it('🔴 チャットに件数バッジを出さない（未読の実体が Phase 2 で存在しない）', () => {
    for (const role of ALL_ROLES) {
      const chat = navItems(buildMainNav({ audience: audienceOf(role), role })).find(
        (item) => item.id === 'chat',
      );
      expect(chat?.badge, role).toBeNull();
      // 🔴 Phase 2 の印は残す（「まだ無い」ことを伝える手段を消さない）。
      expect(chat?.phaseKey, role).toBe('shell.nav.note.phase2');
      expect(chat?.reach.kind, role).toBe('UNAVAILABLE');
    }
  });

  it('🔴 対照: 走査しているのは実装のソースである（パスの綴りを間違えていない）', () => {
    expect(toRepoRelative(path.join(repoRoot, 'apps', 'web', 'lib', 'shell', 'nav.ts'))).toBe(
      'apps/web/lib/shell/nav.ts',
    );
    expect(sourceOf('apps/web/lib/shell/nav.ts')).toContain('buildNavSections');
  });
});
