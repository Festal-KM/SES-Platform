// apps/web/lib/shell/nav.test.ts
// グローバルナビの項目表（サイドバー 6 項目 / 第 2 階層のタブ / `設定` の索引 / ボトムタブ）の固定。
//
// 🔴 ここで固定するのは 5 つ:
//    ① 🔴 **サイドバーがモックアップどおり 6 項目のフラットである**（下の `MOCKUP_SIDEBAR` が
//       **人間が提示した画像の写し**である。群の見出しは無い）
//    ② **404 を作らない** —— `LINK` の遷移先が `apps/web/app/(main)/**/page.tsx` に実在する
//       （推測で書かれたリンクをリポジトリの実体と突き合わせる。**未実装の画面はリンクにしない**）
//    ③ **ホストと取引先で項目集合が違う**（第二境界の表現。§3.2 / §3.1 の 2 列）
//    ④ 🔴 **第 2 階層（タブ / 索引）が、畳む前のロール条件をそのまま持っている**
//    ⑤ 業務ループ ①〜⑥ の順が**第 2 階層**に残り、取引先にも経路 5 の対象が出る（Issue #8）
//
// 🔴 **ロール別の到達集合が畳み込みの前後で一致すること自体は `tests/static/nav-reach.test.ts` が
//    証明する**（あちらが「機能が消えていない」の本体で、ここは「表のとおりに組み立てている」である）。
//    2 本に分けたのは、到達性がルート木の走査を伴うリポジトリ全体の性質であるからである。
import { readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { TENANT_ROLES, type TenantRole } from '@ses/db';
import { ICON_NAMES } from '@ses/ui';
import {
  buildBottomTabs,
  buildMainNav,
  buildNavSections,
  buildSettingsIndex,
  currentNavSection,
  navHrefs,
  navItems,
  navReachableHrefs,
  SETTINGS_INDEX_PATH,
  type NavGroup,
  type NavItem,
} from './nav';

const here = path.dirname(fileURLToPath(import.meta.url));
/** `apps/web/lib/shell` → `apps/web/app/(main)` */
const mainPlaneRoot = path.resolve(here, '..', '..', 'app', '(main)');

/**
 * 🔴 実在する URL の集合を**ディレクトリ走査で**作る（一覧をテストに書き写さない。書き写すと、
 *    画面が消えた / 増えたときに気づけない）。ルートグループ（`(list)` / `(auth)`）は URL に現れない。
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

const ROUTE_URLS = new Set(collectRouteUrls(mainPlaneRoot, []));

function labelKeysOf(groups: readonly NavGroup[]): readonly string[] {
  return [
    ...groups.flatMap((group) => (group.labelKey === null ? [] : [group.labelKey])),
    ...navItems(groups).map((item) => item.labelKey),
  ];
}

const HOST_ROLES: readonly TenantRole[] = ['OWNER', 'ADMIN', 'SALES', 'VIEWER'];
const PARTNER_ROLES: readonly TenantRole[] = ['PARTNER_ADMIN', 'PARTNER_SALES'];

// ============================================================================
// 🔴 ① 人間が提示したモックアップの写し（2026-10-03。**一次資料は画像と人間の指示**）
// ============================================================================
/**
 * 1 行 = `[項目 id, labelKey, アイコン名, Phase Badge]`。
 *
 * 🔴 **画像は群の見出しを持たない 6 項目である**（`ホーム` / `チャット` / `人材管理` / `案件管理` /
 *    `レポート` / `設定`）。並びも画像のままである。
 * ⚠️ この並びは `CLAUDE.md` §1.3 の業務ループの順ではない（`チャット` が ① の手前に来る）。
 *    **ループの順序は第 2 階層（`案件管理` のタブ）が保つ**（下の ⑤）。
 * 🔴 **`docs/04` §3.1 は依然として「群 4 つ + 16 項目」を定めており、設計書の追随は別途行う**
 *    （`CLAUDE.md` §8.7。本タスクは `docs/**` を触らない）。したがって**この表の一次資料は
 *    人間の指示であり、docs/04 の表ではない** —— 食い違いは完了報告で申し送る。
 * 🔴 取引先の語（`自社の人材` / `公開された案件` / `自社レポート`）は**畳み込みで変えていない**
 *    （母集団が違うことを語で示すのは第二境界の常時表現。`CLAUDE.md` §3.1 / docs/04 §3.2）。
 */
const MOCKUP_SIDEBAR = {
  HOST: [
    ['home', 'shell.nav.home', 'home', null],
    ['chat', 'shell.nav.chat', 'message-square', 'Phase 2'],
    ['engineers', 'shell.nav.host.engineers', 'users', null],
    ['projects', 'shell.nav.host.projects', 'briefcase', null],
    ['reports', 'shell.nav.host.reports', 'bar-chart-3', 'Phase 3'],
    ['settings', 'shell.nav.host.settings', 'settings', null],
  ],
  PARTNER: [
    ['home', 'shell.nav.home', 'home', null],
    ['chat', 'shell.nav.chat', 'message-square', 'Phase 2'],
    ['engineers', 'shell.nav.partner.engineers', 'users', null],
    ['projects', 'shell.nav.partner.projects', 'briefcase', null],
    ['reports', 'shell.nav.partner.reports', 'bar-chart-3', 'Phase 3'],
    ['settings', 'shell.nav.partner.settings', 'settings', null],
  ],
} as const satisfies Readonly<
  Record<'HOST' | 'PARTNER', ReadonlyArray<readonly [string, string, string, string | null]>>
>;

/**
 * 🔴 第 2 階層の写し（畳み込みで消えた項目の到達手段。`buildNavSections`）。
 *    1 行 = `[セクション id, 項目 id, labelKey, 遷移先]`。
 */
const MOCKUP_SECTIONS = {
  HOST: [
    ['engineers', 'engineers', 'shell.section.engineers.list', '/engineers'],
    ['projects', 'projects', 'shell.section.projects.list', '/projects'],
    ['projects', 'proposals', 'shell.nav.proposals', '/proposals'],
    ['projects', 'proposal-requests', 'shell.nav.proposalRequests', '/proposal-requests'],
  ],
  PARTNER: [
    ['engineers', 'engineers', 'shell.section.engineers.list', '/engineers'],
    // 🔴 `共有の設定`（`S-015`。経路 4）は**取引先にだけ**在り、`候補者一覧` の直下に置く
    //    （母集団が同じ台帳であり、稼働が決まった人材の共有解除は時間勝負である。§11-13）。
    ['engineers', 'engineer-shares', 'shell.nav.partner.shares', '/engineer-shares'],
    ['projects', 'projects', 'shell.section.projects.list', '/projects'],
    ['projects', 'proposals', 'shell.nav.proposals', '/proposals'],
    ['projects', 'proposal-requests', 'shell.nav.proposalRequests', '/proposal-requests'],
  ],
} as const satisfies Readonly<
  Record<'HOST' | 'PARTNER', ReadonlyArray<readonly [string, string, string, string]>>
>;

/** 表と同じ 4 つ組にする（比較は配列どうしで行い、差分を読める形にする）。 */
function sidebarTableOf(
  groups: readonly NavGroup[],
): ReadonlyArray<readonly [string, string, string, string | null]> {
  return navItems(groups).map(
    (item) =>
      [item.id, item.labelKey, item.icon, item.phaseKey === null ? null : phaseLabel(item)] as const,
  );
}

/** `Phase N` の Badge に出る語（キーと値の対応は `packages/i18n` が持つ。ここは表との照合に使う）。 */
function phaseLabel(item: NavItem): string {
  if (item.phaseKey === 'shell.nav.note.phase2') return 'Phase 2';
  if (item.phaseKey === 'shell.nav.note.phase3') return 'Phase 3';
  throw new Error(`Phase の注記キーが表に無い: ${String(item.phaseKey)}`);
}

describe('対照: 走査が空振りしていない', () => {
  it('主平面の URL が集まっている', () => {
    expect(ROUTE_URLS.has('/')).toBe(true);
    expect(ROUTE_URLS.has('/engineers')).toBe(true);
    expect(ROUTE_URLS.has('/projects')).toBe(true);
    // ✅ 2026-10-03: `設定` の索引（6 項目に畳んだぶんの到達手段）。
    expect(ROUTE_URLS.has(SETTINGS_INDEX_PATH)).toBe(true);
    expect(ROUTE_URLS.size).toBeGreaterThan(10);
  });

  it('🔴 ロールの軸が `TENANT_ROLES` を覆っている（ロールが増えたら落ちる）', () => {
    expect([...HOST_ROLES, ...PARTNER_ROLES].sort()).toEqual([...TENANT_ROLES].sort());
  });
});

describe('🔴 ① サイドバーがモックアップどおり 6 項目のフラットである（2026-10-03）', () => {
  it.each(['HOST', 'PARTNER'] as const)('%s: 群は 1 つで、見出しを持たない', (audience) => {
    const groups = buildMainNav({ audience, role: audience === 'HOST' ? 'OWNER' : 'PARTNER_ADMIN' });
    expect(groups.map((group) => [group.id, group.labelKey])).toEqual([['primary', null]]);
  });

  it.each(['HOST', 'PARTNER'] as const)(
    '%s: 項目の並び・labelKey・アイコン名・Badge の有無が画像どおり（6 項目。足していない / 落としていない）',
    (audience) => {
      const groups = buildMainNav({ audience, role: audience === 'HOST' ? 'OWNER' : 'PARTNER_ADMIN' });
      expect(sidebarTableOf(groups)).toEqual(MOCKUP_SIDEBAR[audience].map((row) => [...row]));
    },
  );

  it.each([...HOST_ROLES, ...PARTNER_ROLES])('%s: ロールでサイドバーの 6 項目が増減しない', (role) => {
    const audience = PARTNER_ROLES.includes(role) ? 'PARTNER' : 'HOST';
    // 🔴 出し分けは**第 2 階層**（タブと索引）が持つ。サイドバーの 6 項目は全ロール共通である
    //    （`設定` は全ロールが開ける索引であり、中身がロールで変わる）。
    expect(navItems(buildMainNav({ audience, role })).map((item) => item.id)).toEqual([
      'home',
      'chat',
      'engineers',
      'projects',
      'reports',
      'settings',
    ]);
  });

  it('🔴 アイコン名は `@ses/ui` の閉じた写像の中だけである（写像に無い名前は型エラーにもなる）', () => {
    const used = new Set(
      [...MOCKUP_SIDEBAR.HOST, ...MOCKUP_SIDEBAR.PARTNER].map(([, , icon]) => icon as string),
    );
    expect([...used].filter((icon) => !(ICON_NAMES as readonly string[]).includes(icon))).toEqual([]);
  });

  it('🔴 同じアイコンを別の項目で使い回していない（アイコンは弁別の印。docs/04 §3.1）', () => {
    for (const audience of ['HOST', 'PARTNER'] as const) {
      const icons = MOCKUP_SIDEBAR[audience].map(([, , icon]) => icon as string);
      expect(new Set(icons).size, audience).toBe(icons.length);
    }
  });

  it('🔴 Badge が付くのは未実装の項目だけ（実在する画面に `Phase N` を付けない）', () => {
    const groups = buildMainNav({ audience: 'HOST', role: 'OWNER' });
    for (const item of navItems(groups)) {
      if (item.phaseKey !== null) expect(item.reach.kind, item.id).toBe('UNAVAILABLE');
    }
  });

  it('🔴 未実装（`チャット` / `レポート`）だけが `href` を持たない', () => {
    const unavailable = navItems(buildMainNav({ audience: 'HOST', role: 'OWNER' })).filter(
      (item) => item.reach.kind === 'UNAVAILABLE',
    );
    expect(unavailable.map((item) => item.id).sort()).toEqual(['chat', 'reports']);
    // 🔴 型としても値としても `href` が存在しない。
    for (const item of unavailable) {
      expect(Object.keys(item.reach), item.id).toEqual(['kind']);
      expect('href' in item.reach, item.id).toBe(false);
      // 🔴 印は `Phase N` であり、注記（別の入口から開く）と混ぜない。
      expect(item.phaseKey, item.id).not.toBeNull();
      expect(item.noteKey, item.id).toBeNull();
    }
  });
});

describe('🔴 ② 404 を作らない（リンクの遷移先が実在する）', () => {
  it.each([...HOST_ROLES, ...PARTNER_ROLES])(
    '%s のナビ・第 2 階層・索引・ボトムタブのリンクはすべて実在する画面を指す',
    (role) => {
      const audience = PARTNER_ROLES.includes(role) ? 'PARTNER' : 'HOST';
      const missing = navReachableHrefs({ audience, role }).filter((href) => !ROUTE_URLS.has(href));
      expect(missing).toEqual([]);
    },
  );

  it('ボトムタブのリンクもすべて実在する', () => {
    expect(navHrefs(buildBottomTabs()).filter((href) => !ROUTE_URLS.has(href))).toEqual([]);
  });
});

describe('🔴 ③ ホストと取引先で項目集合が違う（第二境界の表現）', () => {
  it('取引先にだけ「共有の設定」（S-015。経路 4）がある', () => {
    const hostTabs = buildNavSections({ audience: 'HOST', role: 'SALES' }).flatMap(
      (section) => section.items,
    );
    const partnerTabs = buildNavSections({ audience: 'PARTNER', role: 'PARTNER_SALES' }).flatMap(
      (section) => section.items,
    );
    expect(partnerTabs.map((item) => item.labelKey)).toContain('shell.nav.partner.shares');
    expect(hostTabs.map((item) => item.labelKey)).not.toContain('shell.nav.partner.shares');
    expect(navHrefs(hostTabs)).not.toContain('/engineer-shares');
  });

  it('① ② ⑥ の語が所属で異なる（母集団が違うことを語で示す）', () => {
    const host = labelKeysOf(buildMainNav({ audience: 'HOST', role: 'SALES' }));
    const partner = labelKeysOf(buildMainNav({ audience: 'PARTNER', role: 'PARTNER_SALES' }));
    for (const key of [
      'shell.nav.host.engineers',
      'shell.nav.host.projects',
      'shell.nav.host.reports',
    ]) {
      expect(host).toContain(key);
      expect(partner).not.toContain(key);
    }
    for (const key of [
      'shell.nav.partner.engineers',
      'shell.nav.partner.projects',
      'shell.nav.partner.reports',
    ]) {
      expect(partner).toContain(key);
      expect(host).not.toContain(key);
    }
  });

  it('🔴 取引先には組織設定（S-035）・送信ドメイン（S-036）・監査ログ（S-041）・利用量（S-038）の項目が無い', () => {
    for (const role of PARTNER_ROLES) {
      const keys = buildSettingsIndex({ audience: 'PARTNER', role }).map((item) => item.labelKey);
      expect(keys).not.toContain('orgSettings.title');
      expect(keys).not.toContain('settings.sendingDomain.title');
      expect(keys).not.toContain('auditLogs.title');
      // 🔴 `S-038` の導線はホスト側にしか置かない（docs/04 §S-038 / F-027 AC-1）。
      expect(keys).not.toContain('usage.title');
      // 到達できるものは出す（自社の情報と、起票できるスキル辞書）。
      expect(keys).toContain('partnerCompanies.title');
      expect(keys).toContain('skillDictionary.title');
    }
  });

  it('🔴 ホストでも到達できないロールには設定の項目を出さない（押した先でホームへ戻る導線を作らない）', () => {
    for (const role of ['SALES', 'VIEWER'] as const) {
      const keys = buildSettingsIndex({ audience: 'HOST', role }).map((item) => item.labelKey);
      expect(keys).not.toContain('orgSettings.title');
      expect(keys).not.toContain('auditLogs.title');
      // 到達できるものは出す（空の索引にしない）。
      expect(keys).toContain('usage.title');
      expect(keys).toContain('partnerCompanies.title');
    }
    for (const role of ['OWNER', 'ADMIN'] as const) {
      const keys = buildSettingsIndex({ audience: 'HOST', role }).map((item) => item.labelKey);
      expect(keys).toContain('orgSettings.title');
      expect(keys).toContain('auditLogs.title');
    }
  });
});

describe('🔴 ④ 第 2 階層（タブ / 索引）が畳む前のロール条件をそのまま持っている', () => {
  it.each(['HOST', 'PARTNER'] as const)('%s: セクションとタブが表どおり', (audience) => {
    const sections = buildNavSections({
      audience,
      role: audience === 'HOST' ? 'OWNER' : 'PARTNER_ADMIN',
    });
    const rows = sections.flatMap((section) =>
      section.items.map((item) => [
        section.id,
        item.id,
        item.labelKey,
        item.reach.kind === 'LINK' ? item.reach.href : null,
      ]),
    );
    expect(rows).toEqual(MOCKUP_SECTIONS[audience].map((row) => [...row]));
  });

  it('🔴 タブはすべてリンクである（押せないタブを置かない）', () => {
    for (const role of [...HOST_ROLES, ...PARTNER_ROLES]) {
      const audience = PARTNER_ROLES.includes(role) ? 'PARTNER' : 'HOST';
      for (const section of buildNavSections({ audience, role })) {
        for (const item of section.items) {
          expect(item.reach.kind, `${role}/${item.id}`).toBe('LINK');
          expect(item.phaseKey, `${role}/${item.id}`).toBeNull();
          expect(item.noteKey, `${role}/${item.id}`).toBeNull();
        }
      }
    }
  });

  it('🔴 `共有の設定` のタブは取引先の `PARTNER_ADMIN` / `PARTNER_SALES` だけ（経路 4 の opt-in を動かす側）', () => {
    const withShares = [...HOST_ROLES, ...PARTNER_ROLES].filter((role) => {
      const audience = PARTNER_ROLES.includes(role) ? 'PARTNER' : 'HOST';
      return navHrefs(buildNavSections({ audience, role }).flatMap((section) => [...section.items])).includes(
        '/engineer-shares',
      );
    });
    expect(withShares).toEqual(['PARTNER_ADMIN', 'PARTNER_SALES']);
  });

  it('🔴 セクションの語はサイドバーの同じ項目と同じキーである（所属の語を 2 箇所に持たない）', () => {
    for (const audience of ['HOST', 'PARTNER'] as const) {
      const role: TenantRole = audience === 'HOST' ? 'SALES' : 'PARTNER_SALES';
      const sidebar = new Map(
        navItems(buildMainNav({ audience, role })).map((item) => [item.id, item.labelKey]),
      );
      for (const section of buildNavSections({ audience, role })) {
        expect(section.labelKey, section.id).toBe(sidebar.get(section.id));
      }
    }
  });

  it('🔴 `設定` の索引は 7 画面すべてを持ちうる（`S-036` / `S-041` / `S-042` の唯一の入口）', () => {
    const owner = buildSettingsIndex({ audience: 'HOST', role: 'OWNER' });
    expect(owner.map((item) => item.id)).toEqual([
      'settings-organization',
      'settings-partner-companies',
      'settings-sending-domains',
      'settings-usage',
      'settings-retention',
      'settings-audit-logs',
      'settings-skills',
    ]);
    expect(navHrefs(owner)).toEqual([
      '/settings/organization',
      '/settings/partner-companies',
      '/settings/sending-domains',
      '/settings/usage',
      '/settings/retention',
      '/audit-logs',
      '/skills',
    ]);
  });

  it('🔴 サイドバーの `設定` は索引（`/settings`）を指す（7 項目を直接並べない）', () => {
    const settings = navItems(buildMainNav({ audience: 'HOST', role: 'OWNER' })).find(
      (item) => item.id === 'settings',
    );
    expect(settings?.reach).toEqual({ kind: 'LINK', href: SETTINGS_INDEX_PATH });
  });
});

describe('🔴 現在地の射程（`sectionPaths`）—— 畳み込みで「どこに居るか」が消えないこと', () => {
  function itemOf(role: TenantRole, id: string): NavItem {
    const audience = PARTNER_ROLES.includes(role) ? 'PARTNER' : 'HOST';
    const found = navItems(buildMainNav({ audience, role })).find((item) => item.id === id);
    if (found === undefined) throw new Error(`項目 ${id} が無い`);
    return found;
  }

  it('🔴 `案件管理` は `提案` / `提案依頼` を射程に持つ（第 2 階層の表と同一）', () => {
    for (const role of [...HOST_ROLES, ...PARTNER_ROLES]) {
      expect(itemOf(role, 'projects').sectionPaths, role).toEqual([
        '/projects',
        '/proposals',
        '/proposal-requests',
      ]);
    }
  });

  it('🔴 `人材管理` の射程は所属で変わる（取引先だけ `共有の設定` を含む）', () => {
    for (const role of HOST_ROLES) {
      expect(itemOf(role, 'engineers').sectionPaths, role).toEqual(['/engineers']);
    }
    for (const role of PARTNER_ROLES) {
      expect(itemOf(role, 'engineers').sectionPaths, role).toEqual(['/engineers', '/engineer-shares']);
    }
  });

  it('🔴 `設定` は索引の 7 項目（`/audit-logs` / `/skills` を含む）を射程に持つ', () => {
    // 🔴 この 2 つは `/settings` 配下に無い URL であり、前方一致では光らない。
    expect(itemOf('OWNER', 'settings').sectionPaths).toEqual([
      '/settings/organization',
      '/settings/partner-companies',
      '/settings/sending-domains',
      '/settings/usage',
      '/settings/retention',
      '/audit-logs',
      '/skills',
    ]);
    expect(itemOf('PARTNER_SALES', 'settings').sectionPaths).toEqual([
      '/settings/partner-companies',
      '/skills',
    ]);
  });

  it('🔴 射程は第 2 階層・索引の表から引いている（別の表を書き写していない）', () => {
    for (const role of [...HOST_ROLES, ...PARTNER_ROLES]) {
      const audience = PARTNER_ROLES.includes(role) ? 'PARTNER' : 'HOST';
      const context = { audience, role } as const;
      const sections = buildNavSections(context);
      for (const section of sections) {
        expect(itemOf(role, section.id).sectionPaths, `${role}/${section.id}`).toEqual(
          navHrefs(section.items),
        );
      }
      expect(itemOf(role, 'settings').sectionPaths, role).toEqual(
        navHrefs(buildSettingsIndex(context)),
      );
    }
  });

  it('🔴 未実装の項目（`チャット` / `レポート`）と `ホーム` は射程を持たない', () => {
    for (const id of ['home', 'chat', 'reports']) {
      expect(itemOf('OWNER', id).sectionPaths, id).toEqual([]);
    }
  });

  it('🔴 射程に含まれる遷移先はすべて実在する（404 を作らない）', () => {
    for (const role of [...HOST_ROLES, ...PARTNER_ROLES]) {
      const audience = PARTNER_ROLES.includes(role) ? 'PARTNER' : 'HOST';
      for (const item of navItems(buildMainNav({ audience, role }))) {
        for (const candidate of item.sectionPaths) {
          expect(ROUTE_URLS.has(candidate), `${role}/${item.id}: ${candidate}`).toBe(true);
        }
      }
    }
  });
});

describe('🔴 ⑤ 業務ループ ①〜⑥ の順は第 2 階層に残る（CLAUDE.md §1.3 / docs/04 §3.1）', () => {
  it.each(['HOST', 'PARTNER'] as const)('%s: `案件管理` のタブが 案件 → 提案 → 提案依頼 の順', (audience) => {
    const sections = buildNavSections({
      audience,
      role: audience === 'HOST' ? 'OWNER' : 'PARTNER_ADMIN',
    });
    const projects = sections.find((section) => section.id === 'projects');
    expect(projects?.items.map((item) => item.id)).toEqual([
      'projects',
      'proposals',
      'proposal-requests',
    ]);
  });

  it('🔴 取引先の `共有の設定` は `候補者一覧` の直下である（docs/04 §3.1 の 🔴）', () => {
    const engineers = buildNavSections({ audience: 'PARTNER', role: 'PARTNER_SALES' }).find(
      (section) => section.id === 'engineers',
    );
    expect(engineers?.items.map((item) => item.id)).toEqual(['engineers', 'engineer-shares']);
  });

  it('🔴 現在地のセクション判定（タブが 2 つ以上のときだけ帯を描く）', () => {
    const partner = buildNavSections({ audience: 'PARTNER', role: 'PARTNER_SALES' });
    expect(currentNavSection(partner, '/proposals/abc/approve')?.id).toBe('projects');
    expect(currentNavSection(partner, '/engineer-shares')?.id).toBe('engineers');
    expect(currentNavSection(partner, '/')).toBeNull();
    // ホストの `人材管理` はタブが 1 つなので帯を描かない（サイドバーの項目が入口を持つ）。
    expect(currentNavSection(buildNavSections({ audience: 'HOST', role: 'SALES' }), '/engineers')).toBeNull();
  });
});

describe('モバイルのボトムタブ（docs/04 §3.4。2026-10-03 に 6 項目へ合わせた）', () => {
  it('ホーム / 人材 / 案件 / チャット の 4 つ（5 つ目の「その他」は描画側が持つ）', () => {
    expect(buildBottomTabs().map((tab) => tab.id)).toEqual(['home', 'engineers', 'projects', 'chat']);
  });

  it('🔴 タブのアイコンはサイドバーの同じ項目と同じである（端末で見え方を変えない。docs/04 §3.4）', () => {
    const sidebar = new Map(
      navItems(buildMainNav({ audience: 'HOST', role: 'SALES' })).map((item) => [item.id, item.icon]),
    );
    for (const tab of buildBottomTabs()) {
      expect(tab.icon, tab.id).toBe(sidebar.get(tab.id));
    }
  });

  it('🔴 タブの id はサイドバーの 6 項目の部分集合である（「その他」の中身と食い違わせない）', () => {
    const ids = new Set(navItems(buildMainNav({ audience: 'HOST', role: 'SALES' })).map((item) => item.id));
    for (const tab of buildBottomTabs()) expect(ids.has(tab.id), tab.id).toBe(true);
  });

  it('🔴 未実装のタブ（チャット）はリンクにしない（404 を作らない）', () => {
    const chat = buildBottomTabs().find((tab) => tab.id === 'chat');
    expect(chat?.reach.kind).toBe('UNAVAILABLE');
    expect(chat?.phaseKey).toBe('shell.nav.note.phase2');
  });
});

describe('🔴 提案依頼（`S-017`）の期限バッジ（docs/04 §3.1 取引先列。T-12-21）', () => {
  /**
   * 🔴 畳み込みで `提案依頼` は第 2 階層へ移ったので、**期限は親の `案件管理` の行が預かる**
   *    （`NavContext.proposalRequestDueText` の 🔴）。サイドバーはどの画面でも見えている唯一の
   *    面であり、ここから期限が消えると取引先が返答期限に気づけない。
   */
  function badgeOf(groups: readonly NavGroup[]): NavItem['badge'] {
    return navItems(groups).find((item) => item.id === 'projects')?.badge ?? null;
  }

  it('取引先所属で残り時間が渡されたときだけ付く', () => {
    const withDue = buildMainNav({
      audience: 'PARTNER',
      role: 'PARTNER_SALES',
      proposalRequestDueText: '残り 2 日',
    });
    // 🔴 `dotLabelKey` はアイコンのみの形態で点に添える語（T-22-05 のレビュー指摘 11）。
    //    **期限の値と別のキーである**（点には件数も期限も出さない。`CLAUDE.md` §3.1 / `F-004 AC-4`）。
    expect(badgeOf(withDue)).toEqual({
      labelKey: 'shell.nav.proposalRequests.due.label',
      text: '残り 2 日',
      dotLabelKey: 'shell.nav.proposalRequests.due.dot',
    });

    const withoutDue = buildMainNav({ audience: 'PARTNER', role: 'PARTNER_SALES', proposalRequestDueText: null });
    expect(badgeOf(withoutDue)).toBeNull();
    // 渡されない（未指定）ときも付かない。
    expect(badgeOf(buildMainNav({ audience: 'PARTNER', role: 'PARTNER_SALES' }))).toBeNull();
  });

  it('🔴 ホストには付かない（docs/04 §3.1 の表はバッジを取引先列にしか書いていない）', () => {
    const host = buildMainNav({ audience: 'HOST', role: 'SALES', proposalRequestDueText: '残り 2 日' });
    expect(badgeOf(host)).toBeNull();
  });

  it('🔴 バッジを持つのは 1 項目だけ（他の項目に件数・期限を配らない）', () => {
    const items = navItems(
      buildMainNav({
        audience: 'PARTNER',
        role: 'PARTNER_SALES',
        proposalRequestDueText: '残り 2 日',
      }),
    );
    expect(items.filter((item) => item.badge !== null).map((item) => item.id)).toEqual(['projects']);
  });

  it('🔴 第 2 階層のタブに期限を複製しない（同じ値を 2 箇所に出すと片方だけ古くなる）', () => {
    const sections = buildNavSections({
      audience: 'PARTNER',
      role: 'PARTNER_SALES',
      proposalRequestDueText: '残り 2 日',
    });
    for (const section of sections) {
      for (const item of section.items) expect(item.badge, item.id).toBeNull();
    }
  });

  it('🔴 バッジの文字列は渡された値そのままである（件数を組み立てない）', () => {
    // 🔴 `formatRemaining` の結果をそのまま運ぶだけであり、このモジュールは数を数えない
    //    （件数は他社情報の示唆になりうる。`CLAUDE.md` §3.1 / `F-004 AC-4`）。
    const items = buildMainNav({ audience: 'PARTNER', role: 'PARTNER_SALES', proposalRequestDueText: '残り 1 時間' });
    expect(badgeOf(items)?.text).toBe('残り 1 時間');
    expect(badgeOf(items)?.text).not.toMatch(/\d+\s*件/);
  });
});
