// apps/web/app/(main)/_shell/page-heading.render.test.tsx
// 帯（パンくず / 画面タイトル / primary アクション）の描画（docs/04 §3.1 / §3.4 / §7.5 / §7.6）。T-12-21。
//
// 🔴 なぜ描画のテストが要るか: 帯が守るのは**見えていること**そのものである ——
//    「祖先が押せる」「現在地は押せない」「タイトルが二重に出ない」「閲覧専用ロールに作成系の
//    primary が出ない」「モバイルの固定バーがボトムタブと重ならない」は、いずれも DOM に出たか
//    どうかでしか確かめられない。
//
// 🔴 `@testing-library/react` を使わず `react-dom/server` の `renderToStaticMarkup` を使う
//    （新規依存を増やさない。`app-shell.render.test.tsx` と同じ方針）。
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { t } from '@ses/i18n';
import {
  ENGINEER_DETAIL_TRAIL,
  ENGINEER_LIST_TRAIL,
  USAGE_TRAIL,
  type PagePrimaryAction,
} from '../../../lib/shell/page-trail';
import { PageHeading, type PageHeadingProps } from './page-heading';

function render(props: PageHeadingProps): string {
  return renderToStaticMarkup(createElement(PageHeading, props));
}

const CREATE_ACTION: PagePrimaryAction = {
  labelKey: 'engineers.list.register',
  href: '/engineers/new',
  kind: 'ACTION',
};

const NAVIGATE_ACTION: PagePrimaryAction = {
  labelKey: 'projects.detail.candidates.open',
  href: '/projects/p1/candidates',
  kind: 'NAVIGATION',
};

/** 🔴 primary の testid は画面側が文字列リテラルで渡す（`page-heading.tsx` の props の 🔴）。 */
const ACTION_TEST_ID = 'page-heading-test-action';
const NAVIGATION_TEST_ID = 'page-heading-test-navigation';

describe('パンくず（docs/04 §3.1 / §S-005 / §S-006 の「←」）', () => {
  it('祖先はリンクで、現在地はリンクにせず `aria-current="page"` を持つ', () => {
    const html = render({ trail: ENGINEER_LIST_TRAIL, title: t('engineers.list.title') });
    expect(html).toContain('data-testid="app-page-breadcrumb"');
    // 祖先（ホーム）はリンク。
    expect(html).toMatch(/<a[^>]*href="\/"[^>]*>ホーム<\/a>/);
    // 現在地（人材）はリンクではなく `aria-current`。
    expect(html).toContain('aria-current="page"');
    expect(html).not.toMatch(/<a[^>]*href="\/engineers"/);
  });

  it('🔴 パンくずは 1 本だけ（帯が二重に描かれない）', () => {
    const html = render({ trail: USAGE_TRAIL, title: t('usage.title') });
    expect(html.match(/data-testid="app-page-breadcrumb"/g)).toHaveLength(1);
    expect(html.match(/data-testid="app-page-heading"/g)).toHaveLength(1);
  });

  it('🔴 `linkTestId` は**最後のリンク項目（= 戻り先）**に付く', () => {
    // `S-038` の表は 設定 / 現在地が非リンクなので、最後のリンクはホームである。
    const usage = render({ trail: USAGE_TRAIL, title: t('usage.title'), linkTestId: 'usage-breadcrumb-home' });
    // 属性の並び順に依存しないよう、`<a ...>` の 1 タグの中に両方あることで見る。
    expect(usage).toMatch(/<a[^>]*data-testid="usage-breadcrumb-home"[^>]*href="\/"[^>]*>/);
    // `S-006` の表は ホーム → 人材 の 2 リンクなので、付くのは「人材」（戻り先）である。
    const detail = render({ trail: ENGINEER_DETAIL_TRAIL, linkTestId: 'engineer-detail-list-link' });
    expect(detail).toMatch(/<a[^>]*data-testid="engineer-detail-list-link"[^>]*href="\/engineers"[^>]*>/);
    // ホーム（最後のリンクではない）には付かない。
    expect(detail).not.toMatch(/<a[^>]*data-testid="[^"]*"[^>]*href="\/"[^>]*>/);
  });

  it('`linkTestId` を渡さなければ `data-testid` の付いたパンくずが出ない', () => {
    expect(render({ trail: ENGINEER_DETAIL_TRAIL })).not.toMatch(/<a[^>]*data-testid=/);
  });

  it('読み上げのための見出し語が `aria-label` に付く', () => {
    expect(render({ trail: ENGINEER_LIST_TRAIL })).toContain(`aria-label="${t('shell.breadcrumb.label')}"`);
  });
});

describe('画面タイトル（🔴 二重に描かない）', () => {
  it('`title` を渡すと `h1` が 1 つだけ出る', () => {
    const html = render({ trail: ENGINEER_LIST_TRAIL, title: t('engineers.list.title') });
    expect(html.match(/<h1/g)).toHaveLength(1);
    expect(html).toContain(t('engineers.list.title'));
  });

  it('🔴 `title` を渡さなければ `h1` を描かない（詳細画面のエンティティ名と二重にしない）', () => {
    const html = render({ trail: ENGINEER_DETAIL_TRAIL });
    expect(html).not.toContain('<h1');
  });

});

describe('🔴 primary アクション（docs/04 §7.6 / CLAUDE.md §10.1）', () => {
  it('`ACTION` は `canAct` が真のときだけ出る', () => {
    expect(
      render({ trail: ENGINEER_LIST_TRAIL, primaryAction: CREATE_ACTION, canAct: true, testId: ACTION_TEST_ID }),
    ).toContain(`data-testid="${ACTION_TEST_ID}"`);
    expect(
      render({ trail: ENGINEER_LIST_TRAIL, primaryAction: CREATE_ACTION, canAct: false, testId: ACTION_TEST_ID }),
    ).not.toContain(`data-testid="${ACTION_TEST_ID}"`);
  });

  it('🔴 `canAct` を渡し忘れたら出さない（閲覧専用ロールへ漏れる側に倒さない）', () => {
    expect(render({ trail: ENGINEER_LIST_TRAIL, primaryAction: CREATE_ACTION, testId: ACTION_TEST_ID })).not.toContain(
      `data-testid="${ACTION_TEST_ID}"`,
    );
  });

  it('🔴 `NAVIGATION` はロールで隠さない（`S-011` の「候補を探す」= `VIEWER` も閲覧してよい）', () => {
    expect(
      render({
        trail: ENGINEER_LIST_TRAIL,
        primaryAction: NAVIGATE_ACTION,
        canAct: false,
        testId: NAVIGATION_TEST_ID,
      }),
    ).toContain(`data-testid="${NAVIGATION_TEST_ID}"`);
  });

  it('🔴 1 画面 1 つ（帯は primary を 1 つしか描けない）', () => {
    const html = render({
      trail: ENGINEER_LIST_TRAIL,
      primaryAction: NAVIGATE_ACTION,
      canAct: true,
      testId: NAVIGATION_TEST_ID,
    });
    expect(html.match(new RegExp(`data-testid="${NAVIGATION_TEST_ID}"`, 'g'))).toHaveLength(1);
  });
});

describe('🔴 モバイルの固定バー（docs/04 §3.4）', () => {
  const html = render({
    trail: ENGINEER_LIST_TRAIL,
    primaryAction: NAVIGATE_ACTION,
    canAct: true,
    testId: NAVIGATION_TEST_ID,
  });

  it('画面下部に固定され、`md:` 以上では帯の中に収まる（2 つ描いて片方を隠さない）', () => {
    expect(html).toContain('fixed');
    expect(html).toContain('md:static');
    // 🔴 同じ要素が両方の役割を持つ（primary の要素は 1 つだけ）。
    expect(html.match(new RegExp(`data-testid="${NAVIGATION_TEST_ID}"`, 'g'))).toHaveLength(1);
  });

  it('🔴 ボトムタブ（`fixed bottom-0 z-10`。T-12-20）と重ならない', () => {
    // ボトムタブの上（`bottom-12` = 48px > タブの高さ 33px）に出し、`z-20` で手前に置く。
    expect(html).toContain('bottom-12');
    expect(html).not.toContain('bottom-0');
    expect(html).toContain('z-20');
  });

  it('🔴 独自ブレークポイントを使わない（Tailwind 既定の `md:` のみ）', () => {
    expect(html).not.toMatch(/(?:min|max)-\[/);
    expect(html).not.toMatch(/\bmax-(?:sm|md|lg|xl):/);
    expect(html).not.toMatch(/\b(?:sm|lg|xl|2xl):/);
  });
});

describe('🔴 アイコンを付けない（docs/04 §7.5「見出し全部」「ボタン全部」）', () => {
  it('帯に `svg` / `img` が 1 つも無い', () => {
    const html = render({
      trail: ENGINEER_LIST_TRAIL,
      title: t('engineers.list.title'),
      primaryAction: NAVIGATE_ACTION,
      canAct: true,
    });
    expect(html).not.toContain('<svg');
    expect(html).not.toContain('<img');
  });
});
