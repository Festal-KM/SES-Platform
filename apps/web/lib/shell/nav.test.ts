// apps/web/lib/shell/nav.test.ts
// グローバルナビの項目表（docs/04 §3.1 / §3.4）の固定。
//
// 🔴 ここで固定するのは 3 つ:
//    ① **ホストと取引先で項目集合が違う**（第二境界の表現。§3.2 / §3.1 の 2 列）
//    ② **404 を作らない** —— `LINK` の遷移先が `apps/web/app/(main)/**/page.tsx` に実在する
//       （推測で書かれたリンクをリポジトリの実体と突き合わせる。**未実装の画面はリンクにしない**）
//    ③ **業務ループ ①〜⑥ の順**が保たれ、取引先にも ⑤ ⑥ が出る（Issue #8 = 経路 5）
import { readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { TenantRole } from '@ses/db';
import { buildBottomTabs, buildMainNav, navHrefs, type NavItem } from './nav';

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

function flatten(items: readonly NavItem[]): readonly NavItem[] {
  return items.flatMap((item) => [item, ...flatten(item.children)]);
}

function labelKeysOf(items: readonly NavItem[]): readonly string[] {
  return flatten(items).map((item) => item.labelKey);
}

const HOST_ROLES: readonly TenantRole[] = ['OWNER', 'ADMIN', 'SALES', 'VIEWER'];
const PARTNER_ROLES: readonly TenantRole[] = ['PARTNER_ADMIN', 'PARTNER_SALES'];

describe('対照: 走査が空振りしていない', () => {
  it('主平面の URL が集まっている', () => {
    expect(ROUTE_URLS.has('/')).toBe(true);
    expect(ROUTE_URLS.has('/engineers')).toBe(true);
    expect(ROUTE_URLS.has('/projects')).toBe(true);
    expect(ROUTE_URLS.size).toBeGreaterThan(10);
  });
});

describe('🔴 ② 404 を作らない（リンクの遷移先が実在する）', () => {
  it.each([...HOST_ROLES, ...PARTNER_ROLES])('%s のナビのリンクはすべて実在する画面を指す', (role) => {
    const audience = PARTNER_ROLES.includes(role) ? 'PARTNER' : 'HOST';
    const missing = navHrefs(buildMainNav({ audience, role })).filter((href) => !ROUTE_URLS.has(href));
    expect(missing).toEqual([]);
  });

  it('ボトムタブのリンクもすべて実在する', () => {
    expect(navHrefs(buildBottomTabs()).filter((href) => !ROUTE_URLS.has(href))).toEqual([]);
  });

  it('🔴 未実装・単独の URL を持たない項目は `href` を持たない（押せる形で描けない）', () => {
    const nav = flatten(buildMainNav({ audience: 'HOST', role: 'OWNER' }));
    const unavailable = nav.filter((item) => item.reach.kind === 'UNAVAILABLE');
    // ⑤ 契約 / ⑥ 稼働 / チャット / タスク / 実績 / ② 候補 / ④ 面談 の 7 つ。
    expect(unavailable.map((item) => item.id).sort()).toEqual(
      ['assignments', 'candidates', 'chat', 'contracts', 'interviews', 'reports', 'tasks'].sort(),
    );
    for (const item of unavailable) {
      expect(Object.keys(item.reach).sort()).toEqual(['kind', 'noteKey']);
    }
  });
});

describe('🔴 ① ホストと取引先で項目集合が違う（第二境界の表現）', () => {
  it('取引先にだけ「共有の設定」（S-015。経路 4）がある', () => {
    const host = labelKeysOf(buildMainNav({ audience: 'HOST', role: 'SALES' }));
    const partner = labelKeysOf(buildMainNav({ audience: 'PARTNER', role: 'PARTNER_SALES' }));
    expect(partner).toContain('shell.nav.partner.shares');
    expect(host).not.toContain('shell.nav.partner.shares');
  });

  it('① ② と ⑤ ⑥ の語が所属で異なる（母集団が違うことを語で示す）', () => {
    const host = labelKeysOf(buildMainNav({ audience: 'HOST', role: 'SALES' }));
    const partner = labelKeysOf(buildMainNav({ audience: 'PARTNER', role: 'PARTNER_SALES' }));
    for (const key of [
      'shell.nav.host.engineers',
      'shell.nav.host.projects',
      'shell.nav.host.candidates',
      'shell.nav.host.contracts',
      'shell.nav.host.assignments',
    ]) {
      expect(host).toContain(key);
      expect(partner).not.toContain(key);
    }
    for (const key of [
      'shell.nav.partner.engineers',
      'shell.nav.partner.projects',
      'shell.nav.partner.candidates',
      'shell.nav.partner.contracts',
      'shell.nav.partner.assignments',
    ]) {
      expect(partner).toContain(key);
      expect(host).not.toContain(key);
    }
  });

  it('🔴 取引先には組織設定（S-035）・送信ドメイン（S-036）・監査ログ（S-041）・利用量（S-038）の項目が無い', () => {
    for (const role of PARTNER_ROLES) {
      const partner = labelKeysOf(buildMainNav({ audience: 'PARTNER', role }));
      expect(partner).not.toContain('orgSettings.title');
      expect(partner).not.toContain('settings.sendingDomain.title');
      expect(partner).not.toContain('auditLogs.title');
      // 🔴 `S-038` の導線はホスト側にしか置かない（docs/04 §S-038 / F-027 AC-1）。
      expect(partner).not.toContain('usage.title');
      // 到達できるものは出す（自社の情報と、起票できるスキル辞書）。
      expect(partner).toContain('partnerCompanies.title');
      expect(partner).toContain('skillDictionary.title');
    }
  });

  it('🔴 ホストでも到達できないロールには設定の項目を出さない（押した先でホームへ戻る導線を作らない）', () => {
    for (const role of ['SALES', 'VIEWER'] as const) {
      const keys = labelKeysOf(buildMainNav({ audience: 'HOST', role }));
      expect(keys).not.toContain('orgSettings.title');
      expect(keys).not.toContain('auditLogs.title');
      // 到達できるものは出す（空の設定グループにしない）。
      expect(keys).toContain('usage.title');
      expect(keys).toContain('partnerCompanies.title');
    }
    for (const role of ['OWNER', 'ADMIN'] as const) {
      const keys = labelKeysOf(buildMainNav({ audience: 'HOST', role }));
      expect(keys).toContain('orgSettings.title');
      expect(keys).toContain('auditLogs.title');
    }
  });
});

describe('🔴 ③ 業務ループ ①〜⑥ の順（CLAUDE.md §1.3 / docs/04 §3.3）', () => {
  it.each(['HOST', 'PARTNER'] as const)('%s: ホーム → ① → ② → ③ → ④ → ⑤ → ⑥ の順で並ぶ', (audience) => {
    const nav = buildMainNav({
      audience,
      role: audience === 'HOST' ? 'OWNER' : 'PARTNER_ADMIN',
    });
    const ids = nav.map((item) => item.id);
    expect(ids.slice(0, 9)).toEqual([
      'home',
      'engineers',
      'projects',
      'candidates',
      'proposals',
      'proposal-requests',
      'interviews',
      'contracts',
      'assignments',
    ]);
    // 最後は設定（業務ループの外側）。
    expect(ids[ids.length - 1]).toBe('settings');
  });

  it('🔴 取引先にも ⑤ ⑥ を出す（Issue #8 = 越境経路 5。旧版の「表示しない」は取り下げ）', () => {
    const ids = buildMainNav({ audience: 'PARTNER', role: 'PARTNER_SALES' }).map((item) => item.id);
    expect(ids).toContain('contracts');
    expect(ids).toContain('assignments');
  });
});

describe('モバイルのボトムタブ（docs/04 §3.4）', () => {
  it('ホーム / 提案 / 候補 / チャット の 4 つ（5 つ目の「その他」は描画側が持つ）', () => {
    expect(buildBottomTabs().map((tab) => tab.id)).toEqual([
      'home',
      'proposals',
      'candidates',
      'chat',
    ]);
  });
});

describe('🔴 ③ 提案依頼（`S-017`）の期限バッジ（docs/04 §3.1 取引先列。T-12-21）', () => {
  function badgeOf(items: readonly NavItem[]): NavItem['badge'] {
    return items.find((item) => item.id === 'proposal-requests')?.badge ?? null;
  }

  it('取引先所属で残り時間が渡されたときだけ付く', () => {
    const withDue = buildMainNav({
      audience: 'PARTNER',
      role: 'PARTNER_SALES',
      proposalRequestDueText: '残り 2 日',
    });
    expect(badgeOf(withDue)).toEqual({ labelKey: 'shell.nav.proposalRequests.due.label', text: '残り 2 日' });

    const withoutDue = buildMainNav({ audience: 'PARTNER', role: 'PARTNER_SALES', proposalRequestDueText: null });
    expect(badgeOf(withoutDue)).toBeNull();
    // 渡されない（未指定）ときも付かない。
    expect(badgeOf(buildMainNav({ audience: 'PARTNER', role: 'PARTNER_SALES' }))).toBeNull();
  });

  it('🔴 ホストには付かない（docs/04 §3.1 の表はバッジを取引先列にしか書いていない）', () => {
    const host = buildMainNav({ audience: 'HOST', role: 'SALES', proposalRequestDueText: '残り 2 日' });
    expect(badgeOf(host)).toBeNull();
  });

  it('🔴 バッジを持つのは `proposal-requests` の 1 項目だけ（他の項目に件数・期限を配らない）', () => {
    const items = buildMainNav({
      audience: 'PARTNER',
      role: 'PARTNER_SALES',
      proposalRequestDueText: '残り 2 日',
    });
    const withBadge = [...items, ...items.flatMap((item) => item.children)].filter((item) => item.badge !== null);
    expect(withBadge.map((item) => item.id)).toEqual(['proposal-requests']);
  });

  it('🔴 バッジの文字列は渡された値そのままである（件数を組み立てない）', () => {
    // 🔴 `formatRemaining` の結果をそのまま運ぶだけであり、このモジュールは数を数えない
    //    （件数は他社情報の示唆になりうる。`CLAUDE.md` §3.1 / `F-004 AC-4`）。
    const items = buildMainNav({ audience: 'PARTNER', role: 'PARTNER_SALES', proposalRequestDueText: '残り 1 時間' });
    expect(badgeOf(items)?.text).toBe('残り 1 時間');
    expect(badgeOf(items)?.text).not.toMatch(/\d+\s*件/);
  });
});
