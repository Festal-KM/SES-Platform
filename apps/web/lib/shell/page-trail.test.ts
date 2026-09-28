// apps/web/lib/shell/page-trail.test.ts
// 帯のパンくず表（`page-trail.ts`）の固定。T-12-21。
//
// 🔴 ここで固定するのは 4 つ:
//    ① **404 を作らない** —— パンくずの `href` が `apps/web/app/(main)/**/page.tsx` に実在する
//       （= Phase 2 / 3 の画面へのリンクが 1 本も無い。`nav.test.ts` ② と同じ規律）
//    ② **どの画面からもホームへ戻れる** —— 先頭の項目がホームである
//    ③ **`設定` をリンクにしない** —— 到達できないロール（`SALES` / `VIEWER` / 取引先）に
//       押せない導線を配らない（`S-035` はホスト所属の `OWNER` / `ADMIN` だけの画面）
//    ④ **`ACTION` の primary を閲覧専用ロールに出さない**（`CLAUDE.md` §10.1）。
//       `PARTNER_VIEWER`（`T-16-12` で `TENANT_ROLES` に入る）も追記なしで閉じることを含む
import { readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { TENANT_ROLES, type TenantRole } from '@ses/db';
import {
  ALL_PAGE_TRAILS,
  ENGINEER_DETAIL_TRAIL,
  HOME_TRAIL,
  isPageActionRole,
  pageTrailHrefs,
  PROJECT_DETAIL_TRAIL,
  SAMPLE_TRAIL_ID,
  type PageCrumb,
} from './page-trail';

const here = path.dirname(fileURLToPath(import.meta.url));
/** `apps/web/lib/shell` → `apps/web/app/(main)` */
const mainPlaneRoot = path.resolve(here, '..', '..', 'app', '(main)');

/**
 * 実在する URL の集合をディレクトリ走査で作る。
 * 🔴 `nav.test.ts` の `collectRouteUrls` と同じ実装を**意図して重複させている** ——
 *    テスト間で実装を import し合わない（`tests/static/no-test-module-imports.test.ts` の規律）。
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

/** 動的セグメントの見本 ID を `[id]` に戻す（走査した URL は `[id]` のまま持っている）。 */
function toRoutePattern(href: string): string {
  return href.split('/').map((segment) => (segment === SAMPLE_TRAIL_ID ? '[id]' : segment)).join('/');
}

describe('対照: 走査が空振りしていない', () => {
  it('主平面の URL が集まっている', () => {
    expect(ROUTE_URLS.has('/')).toBe(true);
    expect(ROUTE_URLS.has('/engineers')).toBe(true);
    expect(ROUTE_URLS.has('/proposals/[id]/approve')).toBe(true);
    expect(ROUTE_URLS.size).toBeGreaterThan(10);
  });

  it('パンくず表が空でない（29 画面ぶんを想定した下限）', () => {
    expect(ALL_PAGE_TRAILS.length).toBeGreaterThanOrEqual(29);
    expect(ALL_PAGE_TRAILS.every((trail) => trail.length > 0)).toBe(true);
  });
});

describe('🔴 ① 404 を作らない（パンくずの遷移先が実在する）', () => {
  it('すべての `href` が実在する画面を指す', () => {
    const missing = pageTrailHrefs(ALL_PAGE_TRAILS)
      .map(toRoutePattern)
      .filter((href) => !ROUTE_URLS.has(href));
    expect(missing).toEqual([]);
  });

  it('🔴 Phase 2 / 3 の画面（未実装）への `href` が 1 本も無い', () => {
    // `S-025`〜`S-034` / `S-037` / `S-039` / `S-040` / `S-043`〜`S-045` に相当する URL。
    const unimplemented = [
      '/contracts',
      '/orders',
      '/assignments',
      '/chat',
      '/notifications',
      '/tasks',
      '/reports',
      '/settings/e-signature',
      '/settings/ai-roles',
      '/settings/match-weights',
      '/settings/sandbox',
    ];
    const hrefs = pageTrailHrefs(ALL_PAGE_TRAILS).map(toRoutePattern);
    expect(hrefs.filter((href) => unimplemented.some((prefix) => href.startsWith(prefix)))).toEqual([]);
  });
});

describe('🔴 ② どの画面からもホームへ戻れる', () => {
  it('すべての表の先頭がホームである（ホーム自身を除きリンク）', () => {
    for (const trail of ALL_PAGE_TRAILS) {
      const head: PageCrumb = trail[0] as PageCrumb;
      if (trail === HOME_TRAIL) {
        // 🔴 ホームは自分自身へのリンクを作らない（現在地）。
        expect(head.href).toBeNull();
        continue;
      }
      expect(head.href).toBe('/');
      expect(head.labelKey.endsWith('.home') || head.labelKey === 'shell.nav.home').toBe(true);
    }
  });
});

describe('🔴 ③ `設定` の遷移先（押せる相手が変わっていないこと）', () => {
  // 🔴 `S-036` / `S-041` / `S-042` は到達条件が `S-035`（ホスト所属の `OWNER` / `ADMIN`）と同一なので、
  //    `設定` を `S-035` へのリンクにしてよい（`page-trail.ts` 冒頭の注記）。
  const ORG_SETTINGS_LINKED_KEYS = new Set([
    'settings.sendingDomain.breadcrumb.settings',
    'auditLogs.breadcrumb.settings',
    'retention.breadcrumb.settings',
  ]);

  it('到達条件が `S-035` と同じ 3 画面だけ `設定` が `/settings/organization` へのリンクになる', () => {
    const settingsCrumbs = ALL_PAGE_TRAILS.flat().filter((crumb) => crumb.labelKey.endsWith('breadcrumb.settings'));
    expect(settingsCrumbs.length).toBeGreaterThan(0);
    for (const crumb of settingsCrumbs) {
      if (ORG_SETTINGS_LINKED_KEYS.has(crumb.labelKey)) {
        expect(crumb.href, crumb.labelKey).toBe('/settings/organization');
      } else {
        expect(crumb.href, crumb.labelKey).toBeNull();
      }
    }
    // 🔴 対照: 3 画面すべてがリンクになっている（1 つでも取りこぼしていない）。
    const linkedLabelKeys = new Set(settingsCrumbs.filter((crumb) => crumb.href !== null).map((crumb) => crumb.labelKey));
    expect(linkedLabelKeys).toEqual(ORG_SETTINGS_LINKED_KEYS);
  });

  it('🔴 `S-014` / `S-038` は到達条件が `S-035` と異なるため、`設定` は遷移先を持たないまま', () => {
    const partnerCompaniesCrumb = ALL_PAGE_TRAILS.flat().find(
      (crumb) => crumb.labelKey === 'partnerCompanies.breadcrumb.settings',
    );
    const usageCrumb = ALL_PAGE_TRAILS.flat().find((crumb) => crumb.labelKey === 'usage.breadcrumb.settings');
    expect(partnerCompaniesCrumb?.href).toBeNull();
    expect(usageCrumb?.href).toBeNull();
  });
});

describe('🔴 ④ `ACTION` の primary を閲覧専用ロールに出さない（CLAUDE.md §10.1）', () => {
  it('`VIEWER` では false、それ以外の現行ロールでは true', () => {
    expect(isPageActionRole('VIEWER')).toBe(false);
    expect(isPageActionRole('OWNER')).toBe(true);
    expect(isPageActionRole('ADMIN')).toBe(true);
    expect(isPageActionRole('SALES')).toBe(true);
    expect(isPageActionRole('PARTNER_ADMIN')).toBe(true);
    expect(isPageActionRole('PARTNER_SALES')).toBe(true);
  });

  it('🔴 名前が `VIEWER` で終わるロールはすべて閲覧専用として扱われる（`PARTNER_VIEWER` = T-16-12 を含む）', () => {
    for (const role of TENANT_ROLES) {
      expect(isPageActionRole(role)).toBe(!role.endsWith('VIEWER'));
    }
    // 🔴 `T-16-12` で `PARTNER_VIEWER` が加わったときに、ここが追記なしで閉じることの対照。
    expect(isPageActionRole('PARTNER_VIEWER' as TenantRole)).toBe(false);
  });
});

describe('🔴 表は `data-testid` を持たない（testid の凍結を壊さない）', () => {
  it('パンくずの項目が `labelKey` / `href` の 2 つだけである', () => {
    // 🔴 testid をデータとして持つと `tests/static/testid-inventory.test.ts` が値を凍結できず、
    //    削除・改名の検知が効かなくなる。既存の 3 値は画面側が `linkTestId="..."` に書く。
    const keys = new Set(ALL_PAGE_TRAILS.flat().flatMap((crumb) => Object.keys(crumb)));
    expect([...keys].sort()).toEqual(['href', 'labelKey']);
  });

  it('🔴 詳細 2 画面の表は「現在地」の項目を持たない（タイトルは画面本体の `h1` が持つ）', () => {
    // 最後の項目がリンクである = 現在地の項目が無い、という形でそれを表す。
    expect(ENGINEER_DETAIL_TRAIL[ENGINEER_DETAIL_TRAIL.length - 1]?.href).toBe('/engineers');
    expect(PROJECT_DETAIL_TRAIL[PROJECT_DETAIL_TRAIL.length - 1]?.href).toBe('/projects');
  });
});
