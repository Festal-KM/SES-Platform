// apps/web/app/(main)/_shell/main-shell.render.test.tsx
// 共通外枠の描画（docs/04 §3.1 / §3.2 / §3.4 / §7.5 / §7.9 / §7.10）。T-12-20 → SP-22 `T-22-05`。
//
// 🔴 なぜ描画のテストが要るか: 外枠が守るのは**見えていること**そのものである ——
//    「第二境界が常時見えている」「未実装の項目がリンクになっていない」「平常時に上限の警告を
//    出さない」「現在地が背景 + 文字色 + 左端 2px で示される」は、いずれも DOM に出たかどうかでしか
//    確かめられない。
//
// 🔴 `@testing-library/react` を使わず `react-dom/server` の `renderToStaticMarkup` を使う
//    （新規依存を増やさない。`home-sections.render.test.tsx` と同じ方針）。
//
// ============================================================================
// 🔴 `T-22-05` で**判定を変えた 2 件**（どちらも `docs/04` 改訂 16 の条文に合わせた追随であり、
//    緩めたものは 1 つも無い）
// ============================================================================
// | # | 旧 | 新 | 根拠 |
// |---|---|---|---|
// | 1 | 「サイドバーにアイコンを 1 つも使わない」（`<svg>` が 0 件） | 🔴 **全項目にアイコンが在る**（`<svg>` の数 = 項目数）+ **比喩アイコンを使えない**（写像が閉じている） | `docs/04` §7.5 ③（改訂 16 で**禁止を解除**。人間の決定 2026-09-29）/ §11-22。旧判定は改訂前の条文そのものであり、**条文が変わったので判定も変わる** |
// | 2 | DOM の順序が ヘッダ → サイドバー → 本文 | 🔴 **サイドバー → ヘッダ → 本文** | `docs/04` §3.1 の改訂 16（**サイドバーを 1 本の柱にし、ヘッダをその右＝本体カラムの上に置く**）。旧判定は旧構成（ヘッダが全幅）を固定していた |
//
// 🔴 それ以外（スコープ表示 2 段 / ロール別の項目集合 / 上限インジケータ / 404 を作らない /
//    期限バッジ / ボトムタブ）の判定は**1 つも緩めていない**。
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { t } from '@ses/i18n';
import { buildBottomTabs, buildMainNav, navItems } from '../../../lib/shell/nav';
import type { ShellUsageIndicator } from '../../../lib/shell/usage-indicator';
import { MainShell, type MainShellProps } from './main-shell';

const HOST_ORG = 'テスト商事株式会社';
const PARTNER_COMPANY = 'テストパートナー株式会社';

function render(overrides: Partial<MainShellProps> = {}): string {
  const props: MainShellProps = {
    wordmark: t('product.name'),
    organizationName: HOST_ORG,
    partnerCompanyName: null,
    userName: '山田太郎',
    roleLabel: t('members.role.SALES'),
    usage: { kind: 'NONE' },
    usageHref: '/settings/usage',
    nav: buildMainNav({ audience: 'HOST', role: 'SALES' }),
    tabs: buildBottomTabs(),
    currentPath: '/engineers',
    children: createElement('main', { 'data-testid': 'shell-probe' }),
    ...overrides,
  };
  return renderToStaticMarkup(createElement(MainShell, props));
}

function partnerMarkup(overrides: Partial<MainShellProps> = {}): string {
  return render({
    partnerCompanyName: PARTNER_COMPANY,
    roleLabel: t('members.role.PARTNER_SALES'),
    // 🔴 取引先所属では `S-038` への導線を持たない（docs/04 §S-038 / F-027 AC-1）。
    usageHref: null,
    nav: buildMainNav({ audience: 'PARTNER', role: 'PARTNER_SALES' }),
    ...overrides,
  });
}

/** `data-testid="x"` の付いた開始タグを 1 つ取り出す（属性の並び順に依存しない照合のため）。 */
function tagOf(html: string, testId: string): string {
  const match = new RegExp(`<[a-z]+[^>]*data-testid="${testId}"[^>]*>`).exec(html);
  return match?.[0] ?? '';
}

describe('ヘッダ（docs/04 §3.1 の 5 要素）', () => {
  it('ワードマークはホームへのリンクで、製品名は `product.name` から来る（U-01）', () => {
    const html = render();
    expect(html).toContain('data-testid="app-header-wordmark"');
    expect(html).toContain(t('product.name'));
    expect(html).toMatch(/<a[^>]*data-testid="app-header-wordmark"[^>]*href="\/"/);
  });

  it('🔴 ホスト所属のスコープ表示は組織名の 1 段（自社名の行を持たない）', () => {
    const html = render();
    expect(html).toContain('data-scope="HOST"');
    expect(html).toContain(HOST_ORG);
    expect(html).not.toContain('app-header-scope-company');
  });

  it('🔴 取引先所属のスコープ表示は「組織名 ＞ 自社名」の 2 段（第二境界の常時表現。§3.2 の #1）', () => {
    const html = partnerMarkup();
    expect(html).toContain('data-scope="PARTNER"');
    const organization = html.indexOf('app-header-scope-organization');
    const company = html.indexOf('app-header-scope-company');
    expect(organization).toBeGreaterThanOrEqual(0);
    expect(company).toBeGreaterThan(organization);
    expect(html).toContain(HOST_ORG);
    expect(html).toContain(`${PARTNER_COMPANY}${t('shell.header.scope.ownCompanySuffix')}`);
  });

  it('🔴 スコープ表示は 2 段のまま（折りたたみ・タップ展開にしない。§3.4 の 2026-09-28 の判断）', () => {
    const html = partnerMarkup();
    // スコープの器の中に開閉ウィジェットが無い（`<details>` / `<summary>` / `aria-expanded`）。
    const scope = /data-testid="app-header-scope"[\s\S]*?<\/div>/.exec(html)?.[0] ?? '';
    expect(scope).not.toContain('<details');
    expect(scope).not.toContain('aria-expanded');
    expect(scope).not.toContain('hidden');
  });

  it('スコープ表示に読み上げ専用の見出し語が付く（組織名そのものの文字列は変えない）', () => {
    const html = render();
    expect(html).toContain(`<span class="sr-only">${t('shell.header.scope.organizationLabel')}</span>`);
    // 🔴 見出し語は `app-header-scope-organization` の**外**に在る（同要素の文字列は組織名だけ）。
    //    ⚠️ T-22-05: クラス名は semantic トークンへ移ったので**クラスを凍結しない**。
    //       固定するのは「その要素の中身が組織名そのものである」ことである（判定は同じ）。
    expect(html).toMatch(
      new RegExp(`<p[^>]*data-testid="app-header-scope-organization"[^>]*>${HOST_ORG}</p>`),
    );
  });

  it('自分は氏名 + ロール名で出る（なぜこの操作ができないかの一次説明）', () => {
    expect(render()).toContain(`山田太郎（${t('members.role.SALES')}）`);
  });

  it('🔴 通知（S-032 = Phase 2）は項目を出すがリンクにしない', () => {
    const html = render();
    expect(html).toContain('data-testid="app-header-notifications"');
    expect(html).toContain(t('shell.header.notifications'));
    expect(html).not.toMatch(/<a[^>]*data-testid="app-header-notifications"/);
    expect(html).toMatch(/<span[^>]*aria-disabled="true"[^>]*data-testid="app-header-notifications"/);
    // 🔴 印は無彩色の Badge（`Phase 2`）である（注記テキストを置き換えた。§3.1 の改訂 16）。
    expect(html).toContain(t('shell.nav.note.phase2'));
  });

  it('🔴 ヘッダにアイコンを付けない（§7.5 の「見出し全部」「ボタン全部」）', () => {
    const html = render();
    const header = /data-testid="app-header"[\s\S]*?<\/header>/.exec(html)?.[0] ?? '';
    expect(header.length).toBeGreaterThan(0);
    expect(header).not.toContain('<svg');
    expect(header).not.toContain('<img');
  });
});

describe('🔴 上限インジケータ（F-027 AC-6 / BR-24）', () => {
  it('🔴 80% 未満（NONE）では要素ごと描かれない', () => {
    expect(render()).not.toContain('app-header-usage');
  });

  it('接近しているときだけ、件数で残量を出す（金額を出さない）', () => {
    const usage: ShellUsageIndicator = {
      kind: 'NEARING',
      metric: {
        labelKey: 'usage.aiUnit.proposalDraft',
        remaining: '12',
        unitKey: 'usage.unit.count',
        level: 'NEARING',
      },
    };
    const html = render({ usage });
    expect(html).toContain('data-usage-state="NEARING"');
    expect(html).toContain(t('shell.header.usage.nearing'));
    expect(html).toContain(t('usage.aiUnit.proposalDraft'));
    expect(html).toContain(`${t('usage.remaining.prefix')} 12 ${t('usage.unit.count')}`);
    expect(html).toContain('data-testid="app-header-usage-remaining"');
    for (const money of ['USD', '$', 'ドル', '円']) expect(html).not.toContain(money);
  });

  it('🔴 停止中は残量ではなく「停止中」と理由を出す', () => {
    const html = render({ usage: { kind: 'STOPPED' } });
    expect(html).toContain('data-usage-state="STOPPED"');
    expect(html).toContain(t('shell.header.usage.stopped'));
    expect(html).toContain(t('quota.aiDaily'));
    expect(html).not.toContain(t('usage.remaining.prefix'));
  });

  it('🔴 取引先所属では停止の事実と理由だけを出し、S-038 への導線を置かない（F-027 AC-1）', () => {
    const html = partnerMarkup({ usage: { kind: 'STOPPED' } });
    expect(html).toContain('data-usage-state="STOPPED"');
    expect(html).toContain(t('quota.aiDaily'));
    // インジケータがリンクになっていない。ナビにも `S-038` の項目が無い。
    expect(html).not.toMatch(/<a[^>]*data-testid="app-header-usage"/);
    expect(html).toMatch(/<span[^>]*data-testid="app-header-usage"/);
    expect(html).not.toContain('href="/settings/usage"');
  });
});

describe('🔴 サイドバー（docs/04 §3.1 の項目表 / §7.5 ③ アイコンの許可）', () => {
  it('🔴 ① 群名が 4 つ出る（`営業` / `連絡` / `分析` / `設定`。🔴 `分析` を `実績` にしない）', () => {
    const html = render();
    for (const key of [
      'shell.nav.group.sales',
      'shell.nav.group.comms',
      'shell.nav.group.analytics',
      'shell.nav.host.settings',
    ] as const) {
      expect(html, key).toContain(t(key));
    }
    // 群名の要素は 4 つ（最上段のホームは群名を持たない）。
    for (const id of ['sales', 'comms', 'analytics', 'settings']) {
      expect(html, id).toContain(`data-testid="app-nav-${id}"`);
    }
    expect(html).not.toContain('data-testid="app-nav-primary"');
  });

  it('🔴 ① 全項目にアイコンが 1 つずつ付く（§7.5 ③ = 改訂 16 で禁止を解除。走査性のため）', () => {
    const html = render();
    const sidebar = /data-testid="app-sidebar"[\s\S]*?<\/nav>/.exec(html)?.[0] ?? '';
    expect(sidebar.length).toBeGreaterThan(0);
    const items = navItems(buildMainNav({ audience: 'HOST', role: 'SALES' }));
    // 項目ごとに 1 つ + 開閉トグルの 1 つ。
    expect((sidebar.match(/<svg/g) ?? []).length).toBe(items.length + 1);
    // 🔴 `<img>` は使わない（セットは `lucide-react` の 1 つに固定。写像が閉じている）。
    expect(sidebar).not.toContain('<img');
  });

  it('🔴 ② ホストと取引先で項目集合が違う（取引先にだけ「共有の設定」がある）', () => {
    const host = render();
    const partner = partnerMarkup();
    expect(host).toContain(t('shell.nav.host.engineers'));
    expect(host).not.toContain(t('shell.nav.partner.engineers'));
    expect(partner).toContain(t('shell.nav.partner.engineers'));
    expect(partner).toContain(t('shell.nav.partner.shares'));
    expect(host).not.toContain(t('shell.nav.partner.shares'));
    // 🔴 見えてはいけない導線は**DOM から取り除かれている**（CSS で隠れているだけにしない）。
    expect(host).not.toContain('data-testid="app-nav-engineer-shares"');
    expect(host).not.toContain('href="/engineer-shares"');
    // 🔴 取引先には組織設定・送信ドメイン・監査ログ・利用量の項目が存在しない。
    for (const testId of [
      'app-nav-settings-organization',
      'app-nav-settings-sending-domains',
      'app-nav-settings-audit-logs',
      'app-nav-settings-usage',
    ]) {
      expect(partner, testId).not.toContain(`data-testid="${testId}"`);
    }
  });

  it('🔴 取引先にも ⑤ ⑥ が出る（Issue #8 = 越境経路 5）', () => {
    const partner = partnerMarkup();
    expect(partner).toContain(t('shell.nav.partner.contracts'));
    expect(partner).toContain(t('shell.nav.partner.assignments'));
  });

  it('🔴 ③ 未実装の項目は `<span>` で描かれ `href` を持たない（404 を作らない）', () => {
    const html = render();
    for (const id of ['contracts', 'assignments', 'chat', 'tasks', 'reports']) {
      expect(html, id).toMatch(new RegExp(`<span[^>]*aria-disabled="true"[^>]*data-testid="app-nav-${id}"`));
      expect(html, id).not.toMatch(new RegExp(`<a[^>]*data-testid="app-nav-${id}"`));
      // 🔴 印は無彩色の `Phase N` Badge（注記テキストを置き換えたもの）。
      expect(html, id).toContain(`data-testid="app-nav-phase-${id}"`);
    }
    expect(html).toContain(t('shell.nav.note.phase3'));
    expect(html).toContain(t('shell.nav.note.phase2'));
    // ② 候補・④ 面談は「実在するが単独の URL を持たない」ので `Phase N` ではなく注記になる。
    expect(html).toContain(t('shell.nav.note.fromProject'));
    expect(html).toContain(t('shell.nav.note.fromProposal'));
    for (const id of ['candidates', 'interviews']) {
      expect(html, id).not.toContain(`data-testid="app-nav-phase-${id}"`);
    }
  });

  it('実在する画面はリンクになる（人材・案件・提案・提案依頼・設定の子項目）', () => {
    const html = render({ nav: buildMainNav({ audience: 'HOST', role: 'OWNER' }) });
    for (const [testId, href] of [
      ['app-nav-engineers', '/engineers'],
      ['app-nav-projects', '/projects'],
      ['app-nav-proposals', '/proposals'],
      ['app-nav-proposal-requests', '/proposal-requests'],
      ['app-nav-settings-audit-logs', '/audit-logs'],
      ['app-nav-settings-skills', '/skills'],
    ] as const) {
      expect(html, testId).toMatch(new RegExp(`<a[^>]*data-testid="${testId}"[^>]*href="${href}"`));
    }
  });

  it('🔴 ④ 現在地は 背景 + 文字色 + 左端 2px の 3 点で示される（太字だけで示さない）', () => {
    const html = render({ currentPath: '/engineers/e1' });
    const current = tagOf(html, 'app-nav-engineers');
    expect(current).toContain('aria-current="page"');
    // 🔴 3 点（`docs/04` §7.9 / §7.10 の selected = `SELECTED_CLASSES`）。
    expect(current).toContain('bg-brand-bg');
    expect(current).toContain('text-brand');
    expect(current).toContain('border-l-2');
    expect(current).toContain('border-l-brand');
    // 🔴 太字で示していない（weight を現在地の手がかりにしない）。
    expect(current).not.toContain('font-bold');
    expect(current).not.toContain('font-semibold');
    // 現在地は 1 項目だけ（前方一致が別の項目を飲み込まない）。
    expect((html.match(/aria-current="page"/g) ?? []).length).toBe(1);
    expect(tagOf(html, 'app-nav-engineer-shares')).not.toContain('aria-current');
    // ホームは完全一致のときだけ光る。
    expect(tagOf(html, 'app-nav-home')).not.toContain('aria-current');
  });

  it('🔴 ④ ホームは完全一致のときだけ現在地になる', () => {
    const html = render({ currentPath: '/' });
    expect(tagOf(html, 'app-nav-home')).toContain('aria-current="page"');
    expect((html.match(/aria-current="page"/g) ?? []).length).toBe(1);
  });

  it('🔴 ④ 現在地が取れないとき（ヘッダが欠けたとき）はどの項目も光らない', () => {
    expect(render({ currentPath: '' })).not.toContain('aria-current="page"');
  });

  it('🔴 ⑤ 2 形態の切替は JS を持たない（`<input type="checkbox">` + CSS）', () => {
    const html = render();
    expect(html).toContain('data-testid="app-sidebar-toggle"');
    expect(html).toMatch(/<input[^>]*type="checkbox"[^>]*data-testid="app-sidebar-toggle"/);
    // 🔴 語は方向を断定しない（既定の形態が幅で変わるため）。
    expect(html).toContain(t('shell.sidebar.toggle'));
    // 🔴 `xl` の 1 本だけが形態の境界である（1440 / 1920 に別の境界を作らない）。
    const sidebar = /data-testid="app-sidebar"[\s\S]*?<\/nav>/.exec(html)?.[0] ?? '';
    expect(sidebar).toContain('xl:');
    expect(sidebar).not.toMatch(/\b2xl:/);
    // 🔴 上端にワードマークを置かない（製品名は Top Header の 1 箇所のみ = U-01）。
    const toggleRow = sidebar.slice(0, sidebar.indexOf('data-testid="app-nav-home"'));
    expect(toggleRow).not.toContain(t('product.name'));
  });

  it('🔴 外枠は primary アクション（作成系の導線）を持たない', () => {
    const html = render();
    expect(html).not.toContain('<button');
    expect(html).not.toContain('href="/engineers/new"');
    expect(html).not.toContain('href="/projects/new"');
    expect(html).not.toContain('href="/proposals/new"');
  });

  it('🔴 hover で動かない（拡大・浮き上がり・影・下線を出さない。§7.10）', () => {
    const html = render();
    const sidebar = /data-testid="app-sidebar"[\s\S]*?<\/nav>/.exec(html)?.[0] ?? '';
    for (const forbidden of ['hover:scale', 'hover:shadow', 'hover:underline', 'hover:-translate', 'shadow-lg']) {
      expect(sidebar, forbidden).not.toContain(forbidden);
    }
  });
});

describe('🔴 モバイル（docs/04 §3.4）', () => {
  it('ボトムタブは 5 つ（ホーム / 提案 / 候補 / チャット / その他）', () => {
    const html = render();
    for (const id of ['home', 'proposals', 'candidates', 'chat', 'more']) {
      expect(html, id).toContain(`data-testid="app-tab-${id}"`);
    }
    expect(html).toContain(t('shell.tab.more'));
  });

  it('🔴 ボトムタブの 5 つにアイコンが付く（ラベルが 2〜3 文字に切り詰まっているため）', () => {
    const html = render();
    const tabs = /data-testid="app-bottom-tabs"[\s\S]*?data-testid="app-tab-more"/.exec(html)?.[0] ?? '';
    expect((tabs.match(/<svg/g) ?? []).length).toBe(4);
    // 5 つ目（その他）のアイコンは `<summary>` の中に在る。
    expect(/data-testid="app-tab-more-summary"[\s\S]*?<svg/.test(html)).toBe(true);
  });

  it('🔴 「その他」からサイドバーと同じ項目に到達でき、業務ループの順序を保つ', () => {
    const html = render();
    // 同じ項目表から描くので、サイドバーの項目はすべて「その他」にも在る（接頭辞だけが違う）。
    for (const id of ['home', 'engineers', 'projects', 'proposals', 'settings']) {
      expect(html, id).toContain(`data-testid="app-more-nav-${id}"`);
    }
    const order = ['home', 'engineers', 'projects', 'candidates', 'proposals'].map((id) =>
      html.indexOf(`data-testid="app-more-nav-${id}"`),
    );
    expect(order).toEqual([...order].sort((a, b) => a - b));
  });

  it('🔴 「その他」でも群の区切り・アイコン・`Phase N` Badge をデスクトップと同じにする（隠さない）', () => {
    const html = render();
    const more = /data-testid="app-tab-more"[\s\S]*?<\/details>/.exec(html)?.[0] ?? '';
    expect(more.length).toBeGreaterThan(0);
    for (const id of ['sales', 'comms', 'analytics', 'settings']) {
      expect(more, id).toContain(`data-testid="app-more-nav-${id}"`);
    }
    for (const id of ['contracts', 'assignments', 'chat', 'tasks', 'reports']) {
      expect(more, id).toContain(`data-testid="app-more-nav-phase-${id}"`);
    }
    const items = navItems(buildMainNav({ audience: 'HOST', role: 'SALES' }));
    // 「その他」の一覧にも項目ごとに 1 つのアイコンが在る（+ `<summary>` の 1 つ）。
    expect((more.match(/<svg/g) ?? []).length).toBe(items.length + 1);
  });

  it('開閉は `<details>` で行う（クライアントコンポーネントを増やさない）', () => {
    expect(render()).toMatch(/<details[^>]*data-testid="app-tab-more"/);
  });
});

describe('レイアウト（docs/04 §3.1 のレイアウト図。改訂 16）', () => {
  it('🔴 サイドバー → ヘッダ → 本文 の順（サイドバーは 1 本の柱で、ヘッダはその右）', () => {
    const html = render();
    const sidebar = html.indexOf('data-testid="app-sidebar"');
    const header = html.indexOf('data-testid="app-header"');
    const probe = html.indexOf('data-testid="shell-probe"');
    expect(sidebar).toBeGreaterThanOrEqual(0);
    expect(header).toBeGreaterThan(sidebar);
    expect(probe).toBeGreaterThan(header);
  });

  it('パンくず / 画面タイトル / primary アクションの領域が本文の手前に在る（中身は各画面が持つ）', () => {
    const html = render();
    expect(html.indexOf('data-testid="app-page-heading-slot"')).toBeLessThan(
      html.indexOf('data-testid="shell-probe"'),
    );
  });

  it('🔴 独自ブレークポイントを使わない（Tailwind 既定の `md:` / `xl:` のみ）', () => {
    const html = render();
    expect(html).not.toMatch(/(?:min|max)-\[/);
    expect(html).not.toMatch(/\bmax-(?:sm|md|lg|xl):/);
  });

  it('🔴 影を足さない（階層は border と背景の差で表す。§7.9）', () => {
    expect(render()).not.toMatch(/\bshadow-/);
  });
});

describe('🔴 提案依頼の期限バッジ（docs/04 §3.1 取引先列。T-12-21）', () => {
  const DUE = '残り 2 日';

  it('取引先のサイドバーと「その他」の両方に出る（項目表は 1 本なので同じ値）', () => {
    const html = partnerMarkup({
      nav: buildMainNav({ audience: 'PARTNER', role: 'PARTNER_SALES', proposalRequestDueText: DUE }),
    });
    expect(html).toContain('data-testid="app-nav-proposal-requests-due"');
    expect(html).toContain('data-testid="app-more-nav-proposal-requests-due"');
    expect(html).toContain(DUE);
  });

  it('🔴 件数を出さない（出すのは期限だけ。CLAUDE.md §3.1 / F-004 AC-4）', () => {
    const html = partnerMarkup({
      nav: buildMainNav({ audience: 'PARTNER', role: 'PARTNER_SALES', proposalRequestDueText: DUE }),
    });
    // バッジの中身に「N 件」に相当する表現が無い。
    const badge = /data-testid="app-nav-proposal-requests-due"[^>]*>(.*?)<\/span>/s.exec(html);
    expect(badge).not.toBeNull();
    expect(badge?.[1] ?? '').not.toMatch(/\d+\s*件/);
  });

  it('残り時間が無ければバッジの要素ごと出さない', () => {
    const html = partnerMarkup({
      nav: buildMainNav({ audience: 'PARTNER', role: 'PARTNER_SALES', proposalRequestDueText: null }),
    });
    expect(html).not.toContain('app-nav-proposal-requests-due');
  });

  it('🔴 ホストには出ない', () => {
    const html = render({
      nav: buildMainNav({ audience: 'HOST', role: 'SALES', proposalRequestDueText: DUE }),
    });
    expect(html).not.toContain('app-nav-proposal-requests-due');
  });

  it('読み上げ専用の見出し語が添えられる（「残り 2 日」が何の残りか分かる）', () => {
    const html = partnerMarkup({
      nav: buildMainNav({ audience: 'PARTNER', role: 'PARTNER_SALES', proposalRequestDueText: DUE }),
    });
    expect(html).toContain(`<span class="sr-only">${t('shell.nav.proposalRequests.due.label')}</span>`);
  });

  it('🔴 状態バッジにアイコンを付けない（§7.5 / §5-1。色 + 形状 + 語で区別する）', () => {
    const html = partnerMarkup({
      nav: buildMainNav({ audience: 'PARTNER', role: 'PARTNER_SALES', proposalRequestDueText: DUE }),
    });
    const badge = /data-testid="app-nav-proposal-requests-due"[\s\S]*?<\/span>/.exec(html)?.[0] ?? '';
    expect(badge.length).toBeGreaterThan(0);
    expect(badge).not.toContain('<svg');
  });
});

describe('🔴 読み上げ（アイコンのみの形態でも語が失われない。docs/04 §3.1）', () => {
  it('項目には `title` と読み上げ用の語の写しが付く', () => {
    const html = render();
    const link = tagOf(html, 'app-nav-engineers');
    expect(link).toContain(`title="${t('shell.nav.host.engineers')}"`);
    // 🔴 見える語が `display: none` になっても、`sr-only` の写しが読み上げに残る。
    expect(html).toContain(`<span class="sr-only">${t('shell.nav.host.engineers')}</span>`);
    // 🔴 `aria-label` で打ち消さない（打ち消すと期限バッジの語が読み上げから消える）。
    expect(link).not.toContain('aria-label');
  });
});
