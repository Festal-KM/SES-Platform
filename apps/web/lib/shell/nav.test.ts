// apps/web/lib/shell/nav.test.ts
// グローバルナビの項目表（docs/04 §3.1 / §3.4）の固定。
//
// 🔴 ここで固定するのは 4 つ:
//    ① **ホストと取引先で項目集合が違う**（第二境界の表現。§3.2 / §3.1 の 2 列）
//    ② **404 を作らない** —— `LINK` の遷移先が `apps/web/app/(main)/**/page.tsx` に実在する
//       （推測で書かれたリンクをリポジトリの実体と突き合わせる。**未実装の画面はリンクにしない**）
//    ③ **業務ループ ①〜⑥ の順**が保たれ、取引先にも ⑤ ⑥ が出る（Issue #8 = 経路 5）
//    ④ ✅ **SP-22 T-22-05: 群名・アイコン名・`Phase N` Badge の有無が docs/04 §3.1 の表と 1 対 1**
//       （下の `SECTION_3_1_TABLE` が**表の写し**である）
//
// 🔴 **④ で照合するのは「表そのもの」である。** 実装から生成した値どうしを比べると、両方が
//    同時にずれたときに気づけない。表は人間が docs/04 §3.1 を読んで写し、**ずれたら落ちる**形に置く。
import { readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { TenantRole } from '@ses/db';
import { ICON_NAMES } from '@ses/ui';
import { buildBottomTabs, buildMainNav, navHrefs, navItems, type NavGroup, type NavItem } from './nav';

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

function groupOf(groups: readonly NavGroup[], id: string): NavGroup {
  const group = groups.find((candidate) => candidate.id === id);
  if (group === undefined) throw new Error(`群 ${id} が無い`);
  return group;
}

const HOST_ROLES: readonly TenantRole[] = ['OWNER', 'ADMIN', 'SALES', 'VIEWER'];
const PARTNER_ROLES: readonly TenantRole[] = ['PARTNER_ADMIN', 'PARTNER_SALES'];

// ============================================================================
// 🔴 ④ docs/04 §3.1 の表の写し（**一次資料は docs/04。ここは写し**）
// ============================================================================
/**
 * 1 行 = `[群, 項目 id, labelKey, アイコン名, Phase Badge]`。
 *
 * 🔴 **`docs/04` §3.1「サイドバー（グローバルナビ）」の表をそのまま写した**（群 → 行の順序も同じ）。
 *    `Phase` の列は表の `Phase 2` / `Phase 3` の Badge に対応し、`null` は Badge が付かない項目である。
 *
 * ⚠️ **`設定` 群の中身だけは表より 3 項目多い。** 表は `設定` の中身を 4 項目（取引先企業 /
 *    利用量と上限 / スキル辞書 / 組織設定）しか列挙していないが、`S-036` 送信ドメイン /
 *    `S-042` データの返却と保持期間 / `S-041` 監査ログは**リポジトリに実在し、ナビが唯一の入口**
 *    である（`./nav.ts` の `settingsItems` の 🔴。`T-12-20` で人間のレビューを通った判断であり、
 *    `T-22-05` の受け入れ基準 1「ロール別の項目集合が 1 つも変わっていない」により減らせない）。
 *    アイコンの根拠は `packages/ui/src/icons.ts` の (2) に記録した。
 *
 * ⚠️ **ホストの `設定` 群は並びも表と違う。** 表の並びは `取引先企業 / 利用量と上限 / スキル辞書 /
 *    組織設定` だが、実装は **`組織設定` が先頭**である（`./nav.ts` の `settingsItems`）。
 *    下の写しは**実装の並び**で書いてあり、この照合は並びも見る —— したがってここは
 *    「表の並びからの逸脱をそのまま固定している」状態である。
 *
 * 🔴 **上の 3 項目多いことと、この並びの差は、どちらも [Issue #82] で `docs/04` §3.1 側の
 *    確認中である**（表を実装に合わせるのか、実装を表に戻すのかは人間の判断事項）。
 *    `T-22-05` の受け入れ基準 1 により、**実装の項目集合と並びはこのタスクでは変えない。**
 */
const SECTION_3_1_TABLE = {
  HOST: [
    // 群名なし（最上段）
    ['primary', 'home', 'shell.nav.home', 'home', null],
    // 営業
    ['sales', 'engineers', 'shell.nav.host.engineers', 'users', null],
    ['sales', 'projects', 'shell.nav.host.projects', 'briefcase', null],
    ['sales', 'candidates', 'shell.nav.host.candidates', 'user-search', null],
    ['sales', 'proposals', 'shell.nav.proposals', 'send', null],
    ['sales', 'proposal-requests', 'shell.nav.proposalRequests', 'inbox', null],
    ['sales', 'interviews', 'shell.nav.interviews', 'handshake', null],
    ['sales', 'contracts', 'shell.nav.host.contracts', 'file-signature', 'Phase 3'],
    ['sales', 'assignments', 'shell.nav.host.assignments', 'calendar-clock', 'Phase 2'],
    // 連絡
    ['comms', 'chat', 'shell.nav.chat', 'message-square', 'Phase 2'],
    ['comms', 'tasks', 'shell.nav.tasks', 'list-checks', 'Phase 2'],
    // 分析
    ['analytics', 'reports', 'shell.nav.host.reports', 'bar-chart-3', 'Phase 3'],
    // 設定
    ['settings', 'settings-organization', 'orgSettings.title', 'settings', null],
    ['settings', 'settings-partner-companies', 'partnerCompanies.title', 'building-2', null],
    ['settings', 'settings-sending-domains', 'settings.sendingDomain.title', 'mail', null],
    ['settings', 'settings-usage', 'usage.title', 'gauge', null],
    ['settings', 'settings-retention', 'retention.summary.heading', 'archive', null],
    ['settings', 'settings-audit-logs', 'auditLogs.title', 'scroll-text', null],
    ['settings', 'settings-skills', 'skillDictionary.title', 'book-open', null],
  ],
  PARTNER: [
    ['primary', 'home', 'shell.nav.home', 'home', null],
    ['sales', 'engineers', 'shell.nav.partner.engineers', 'users', null],
    // 🔴 表は `共有の設定` を `自社の人材` の**直下**に置いている（§3.1 の 🔴 = 稼働が決まった
    //    人材の共有解除は時間勝負であり、母集団が `自社の人材` と同じ台帳だから）。
    ['sales', 'engineer-shares', 'shell.nav.partner.shares', 'share-2', null],
    ['sales', 'projects', 'shell.nav.partner.projects', 'briefcase', null],
    ['sales', 'candidates', 'shell.nav.partner.candidates', 'user-search', null],
    ['sales', 'proposals', 'shell.nav.proposals', 'send', null],
    ['sales', 'proposal-requests', 'shell.nav.proposalRequests', 'inbox', null],
    ['sales', 'interviews', 'shell.nav.interviews', 'handshake', null],
    ['sales', 'contracts', 'shell.nav.partner.contracts', 'file-signature', 'Phase 3'],
    ['sales', 'assignments', 'shell.nav.partner.assignments', 'calendar-clock', 'Phase 2'],
    ['comms', 'chat', 'shell.nav.chat', 'message-square', 'Phase 2'],
    ['comms', 'tasks', 'shell.nav.tasks', 'list-checks', 'Phase 2'],
    ['analytics', 'reports', 'shell.nav.partner.reports', 'bar-chart-3', 'Phase 3'],
    // 🔴 取引先に `組織設定` / `送信ドメイン` / `利用量と上限` / `監査ログ` / `データの返却` は無い
    //    （第二境界 / `F-027 AC-1`）。**存在しない項目は行そのものを描かない。**
    //
    // ⚠️ **取引先の `設定` 群は、表の 2 行と 1 対 1 になっていない。** `docs/04` §3.1 の取引先列は
    //    `スキル辞書・別名・新語候補（S-009。book-open）` → `自社アカウントの設定（settings）` の
    //    2 行だが、実装は `取引先企業（building-2）` → `スキル辞書（book-open）` である。差は 2 点:
    //
    //    (a) 🔴 **表に無い `取引先企業`（`S-014`）が在る。** `docs/04` §S-014 が
    //        「`PARTNER_ADMIN` は**自社 1 社の詳細のみ**に到達し、他社は一覧にも件数にも現れない」と
    //        定めており、母集団を 1 行に絞るのは画面のロール判定ではなく **RLS の C5** である
    //        （`settings/partner-companies/page.tsx` の 🔴。`T-12-20` で人間のレビューを通った判断）。
    //        したがって **他社の社名・件数の露出は無い**（`F-007 AC-1` / `F-004 AC-1` / 第二境界）。
    //    (b) 🔴 **表に在る `自社アカウントの設定`（`settings`）に対応する項目が無い。** その画面は
    //        リポジトリに実在せず（`app/(main)/settings/**` は organization / partner-companies /
    //        retention / sending-domains / usage の 5 つだけ）、上の ② の規律により
    //        **実在しない遷移先をリンクにできない**（404 を作らない）。
    //
    // 🔴 **この食い違いは [Issue #82] で `docs/04` §3.1 側の確認中である。** `T-22-05` の
    //    受け入れ基準 1（ロール別の項目集合が 1 つも変わっていない）により、実装側は変えない。
    ['settings', 'settings-partner-companies', 'partnerCompanies.title', 'building-2', null],
    ['settings', 'settings-skills', 'skillDictionary.title', 'book-open', null],
  ],
} as const satisfies Readonly<
  Record<'HOST' | 'PARTNER', ReadonlyArray<readonly [string, string, string, string, string | null]>>
>;

/** 群名（docs/04 §3.1 の 4 群 + 群名なしの最上段）。🔴 **`分析` を `実績` にしない。** */
const SECTION_3_1_GROUPS = {
  HOST: [
    ['primary', null],
    ['sales', 'shell.nav.group.sales'],
    ['comms', 'shell.nav.group.comms'],
    ['analytics', 'shell.nav.group.analytics'],
    ['settings', 'shell.nav.host.settings'],
  ],
  PARTNER: [
    ['primary', null],
    ['sales', 'shell.nav.group.sales'],
    ['comms', 'shell.nav.group.comms'],
    ['analytics', 'shell.nav.group.analytics'],
    ['settings', 'shell.nav.partner.settings'],
  ],
} as const satisfies Readonly<Record<'HOST' | 'PARTNER', ReadonlyArray<readonly [string, string | null]>>>;

/** 表と同じ 5 つ組にする（比較は配列どうしで行い、差分を読める形にする）。 */
function tableOf(groups: readonly NavGroup[]): ReadonlyArray<readonly [string, string, string, string, string | null]> {
  return groups.flatMap((group) =>
    group.items.map(
      (item) => [group.id, item.id, item.labelKey, item.icon, item.phaseKey === null ? null : phaseLabel(item)] as const,
    ),
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
    expect(ROUTE_URLS.size).toBeGreaterThan(10);
  });
});

describe('🔴 ④ 群名・アイコン名・Phase Badge が docs/04 §3.1 の表と 1 対 1（T-22-05）', () => {
  it.each(['HOST', 'PARTNER'] as const)('%s: 群の並びと群名が表どおり', (audience) => {
    const groups = buildMainNav({ audience, role: audience === 'HOST' ? 'OWNER' : 'PARTNER_ADMIN' });
    expect(groups.map((group) => [group.id, group.labelKey])).toEqual(
      SECTION_3_1_GROUPS[audience].map(([id, labelKey]) => [id, labelKey]),
    );
  });

  it.each(['HOST', 'PARTNER'] as const)(
    '%s: 項目の並び・labelKey・アイコン名・Badge の有無が表どおり（表に無い項目を足していない / 表に在る項目を落としていない）',
    (audience) => {
      const groups = buildMainNav({ audience, role: audience === 'HOST' ? 'OWNER' : 'PARTNER_ADMIN' });
      expect(tableOf(groups)).toEqual(SECTION_3_1_TABLE[audience].map((row) => [...row]));
    },
  );

  it('🔴 アイコン名は `@ses/ui` の閉じた写像の中だけである（写像に無い名前は型エラーにもなる）', () => {
    const used = new Set(
      [...SECTION_3_1_TABLE.HOST, ...SECTION_3_1_TABLE.PARTNER].map(([, , , icon]) => icon as string),
    );
    expect([...used].filter((icon) => !(ICON_NAMES as readonly string[]).includes(icon))).toEqual([]);
  });

  it('🔴 同じアイコンを別の項目で使い回していない（アイコンは弁別の印。docs/04 §3.1）', () => {
    for (const audience of ['HOST', 'PARTNER'] as const) {
      const icons = SECTION_3_1_TABLE[audience].map(([, , , icon]) => icon as string);
      expect(new Set(icons).size, audience).toBe(icons.length);
    }
  });

  it('🔴 Badge が付くのは未実装の項目だけ（実在する画面に `Phase N` を付けない）', () => {
    const groups = buildMainNav({ audience: 'HOST', role: 'OWNER' });
    for (const item of navItems(groups)) {
      if (item.phaseKey !== null) expect(item.reach.kind, item.id).toBe('UNAVAILABLE');
    }
  });
});

describe('🔴 ② 404 を作らない（リンクの遷移先が実在する）', () => {
  it.each([...HOST_ROLES, ...PARTNER_ROLES])('%s のナビのリンクはすべて実在する画面を指す', (role) => {
    const audience = PARTNER_ROLES.includes(role) ? 'PARTNER' : 'HOST';
    const missing = navHrefs(navItems(buildMainNav({ audience, role }))).filter((href) => !ROUTE_URLS.has(href));
    expect(missing).toEqual([]);
  });

  it('ボトムタブのリンクもすべて実在する', () => {
    expect(navHrefs(buildBottomTabs()).filter((href) => !ROUTE_URLS.has(href))).toEqual([]);
  });

  it('🔴 未実装・単独の URL を持たない項目は `href` を持たない（押せる形で描けない）', () => {
    const nav = navItems(buildMainNav({ audience: 'HOST', role: 'OWNER' }));
    const unavailable = nav.filter((item) => item.reach.kind === 'UNAVAILABLE');
    // ⑤ 契約 / ⑥ 稼働 / チャット / タスク / 実績 / ② 候補 / ④ 面談 の 7 つ。
    expect(unavailable.map((item) => item.id).sort()).toEqual(
      ['assignments', 'candidates', 'chat', 'contracts', 'interviews', 'reports', 'tasks'].sort(),
    );
    // 🔴 型としても値としても `href` が存在しない（T-22-05 で `reach` から `noteKey` を外し、
    //    注記 / `Phase N` を項目側へ移したので、`reach` は `kind` だけを持つ）。
    for (const item of unavailable) {
      expect(Object.keys(item.reach), item.id).toEqual(['kind']);
      expect('href' in item.reach, item.id).toBe(false);
    }
  });

  it('🔴 `Phase N`（まだ無い）と注記（別の入口から開く）を混ぜない', () => {
    const nav = navItems(buildMainNav({ audience: 'HOST', role: 'OWNER' }));
    const byId = new Map(nav.map((item) => [item.id, item]));
    // 実在するが単独の URL を持たない 2 つは**注記**であり `Phase N` を持たない。
    for (const id of ['candidates', 'interviews']) {
      expect(byId.get(id)?.phaseKey, id).toBeNull();
      expect(byId.get(id)?.noteKey, id).not.toBeNull();
    }
    // 未実装の 5 つは `Phase N` であり注記を持たない。
    for (const id of ['contracts', 'assignments', 'chat', 'tasks', 'reports']) {
      expect(byId.get(id)?.noteKey, id).toBeNull();
      expect(byId.get(id)?.phaseKey, id).not.toBeNull();
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

describe('🔴 ③ 業務ループ ①〜⑥ の順（CLAUDE.md §1.3 / docs/04 §3.1 / §11-21）', () => {
  it.each(['HOST', 'PARTNER'] as const)('%s: `営業` 群が ① → ② → ③ → ④ → ⑤ → ⑥ の順で並ぶ', (audience) => {
    const groups = buildMainNav({
      audience,
      role: audience === 'HOST' ? 'OWNER' : 'PARTNER_ADMIN',
    });
    // 🔴 ホームは群に属さず最上段（docs/04 §3.1 の表の 1 行目）。
    expect(groups[0]?.items.map((item) => item.id)).toEqual(['home']);
    // 🔴 業務ループの 8 項目の**相対順序は T-12-20 から 1 つも動いていない**
    //    （取引先の `engineer-shares` は docs/04 §3.1 の表どおり `engineers` の直下に入る）。
    const sales = groupOf(groups, 'sales').items.map((item) => item.id);
    expect(sales.filter((id) => id !== 'engineer-shares')).toEqual([
      'engineers',
      'projects',
      'candidates',
      'proposals',
      'proposal-requests',
      'interviews',
      'contracts',
      'assignments',
    ]);
    // 最後の群は設定（業務ループの外側）。
    expect(groups[groups.length - 1]?.id).toBe('settings');
  });

  it('🔴 取引先にも ⑤ ⑥ を出す（Issue #8 = 越境経路 5。旧版の「表示しない」は取り下げ）', () => {
    const ids = navItems(buildMainNav({ audience: 'PARTNER', role: 'PARTNER_SALES' })).map((item) => item.id);
    expect(ids).toContain('contracts');
    expect(ids).toContain('assignments');
  });

  it('🔴 取引先の `共有の設定` は `自社の人材` の直下である（docs/04 §3.1 の 🔴）', () => {
    const sales = groupOf(buildMainNav({ audience: 'PARTNER', role: 'PARTNER_SALES' }), 'sales').items.map(
      (item) => item.id,
    );
    expect(sales.slice(0, 2)).toEqual(['engineers', 'engineer-shares']);
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

  it('🔴 タブのアイコンはサイドバーの同じ項目と同じである（端末で見え方を変えない。docs/04 §3.4）', () => {
    const sidebar = new Map(
      navItems(buildMainNav({ audience: 'HOST', role: 'SALES' })).map((item) => [item.id, item.icon]),
    );
    for (const tab of buildBottomTabs()) {
      expect(tab.icon, tab.id).toBe(sidebar.get(tab.id));
    }
  });
});

describe('🔴 提案依頼（`S-017`）の期限バッジ（docs/04 §3.1 取引先列。T-12-21）', () => {
  function badgeOf(groups: readonly NavGroup[]): NavItem['badge'] {
    return navItems(groups).find((item) => item.id === 'proposal-requests')?.badge ?? null;
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

  it('🔴 バッジを持つのは `proposal-requests` の 1 項目だけ（他の項目に件数・期限を配らない）', () => {
    const items = navItems(
      buildMainNav({
        audience: 'PARTNER',
        role: 'PARTNER_SALES',
        proposalRequestDueText: '残り 2 日',
      }),
    );
    expect(items.filter((item) => item.badge !== null).map((item) => item.id)).toEqual(['proposal-requests']);
  });

  it('🔴 バッジの文字列は渡された値そのままである（件数を組み立てない）', () => {
    // 🔴 `formatRemaining` の結果をそのまま運ぶだけであり、このモジュールは数を数えない
    //    （件数は他社情報の示唆になりうる。`CLAUDE.md` §3.1 / `F-004 AC-4`）。
    const items = buildMainNav({ audience: 'PARTNER', role: 'PARTNER_SALES', proposalRequestDueText: '残り 1 時間' });
    expect(badgeOf(items)?.text).toBe('残り 1 時間');
    expect(badgeOf(items)?.text).not.toMatch(/\d+\s*件/);
  });
});
