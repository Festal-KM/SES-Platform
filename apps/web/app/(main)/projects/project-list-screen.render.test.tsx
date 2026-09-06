// apps/web/app/(main)/projects/project-list-screen.render.test.tsx
// `ProjectListScreen`（`S-010`）の状態別描画テスト。T-06-03。
//
// 🔴 なぜこの粒度で要るか（`engineer-ledger-screen.render.test.tsx` と同じ理由）:
//    ①**取引先視点で「公開先の設定状況」の列が消えること**（`F-014 AC-4` / `BR-07`）と
//    ②**`VIEWER` / 取引先に登録導線が無いこと**（`docs/04` §S-010 権限差分）は、
//      E2E の seed 依存を避けてここで固定する。
//    ③**スコア・順位・重み・「全 N ページ中 M ページ目」を描かないこと**（docs/05 §4.8）は
//      「描かれていないこと」が要件であり、API のテストでは示せない。
//    ④**検索条件がページングのリンクに残ること**（`docs/04` §10.1 `S-010`）。
//
// 🔴 `@testing-library/react` を使わず `react-dom/server` の `renderToStaticMarkup` を使う
//    （新規依存を増やさない）。
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { ProjectListRowView } from '../../../lib/projects/list-rows';
import {
  ProjectListScreen,
  type ProjectListScreenMessages,
} from './project-list-screen';

const PROJECT_A = '01930000-0000-7000-8000-0000000000c1';
const PROJECT_B = '01930000-0000-7000-8000-0000000000c2';

function row(overrides: Partial<ProjectListRowView> = {}): ProjectListRowView {
  return {
    id: PROJECT_A,
    name: '金融系 Web API 改修',
    status: '募集中',
    mustRequirements: 'Java 5 年以上、Spring',
    moreMustRequirements: null,
    unitPrice: '650,000〜750,000 円',
    startDate: '2026-10-01',
    location: '東京都・一部リモート可',
    headcount: '2 名',
    updatedOn: '2026-09-05',
    visibility: '3 社に公開中',
    ...overrides,
  };
}

const messages: ProjectListScreenMessages = {
  populationLabel: '自社案件 2 件',
  partnerScopeNotice: null,
  orderNote: '後任募集 → 募集中 → 充足 の順に、同じ状態のなかでは更新日の新しい順に表示しています。',
  searchComingSoon: 'スキル要件・単価レンジ・リモート可否での絞り込みは、後続のリリースで行えます。',
  searchLegend: '検索条件',
  searchQ: 'フリーワード',
  searchStatus: '案件の状態',
  searchStartFrom: '開始日（この日以降）',
  searchPrefecture: '勤務地（都道府県）',
  searchSubmit: '検索',
  searchClear: '条件をクリア',
  register: '案件を登録',
  readOnlyNote: '案件の登録は、閲覧のみの権限では行えません。',
  columnName: '案件名',
  columnStatus: '状態',
  columnMustRequirements: '必須要件の要約',
  columnUnitPrice: '単価レンジ',
  columnStartDate: '開始日',
  columnLocation: '勤務地・リモート',
  columnHeadcount: '募集人数',
  columnUpdatedOn: '更新日',
  columnVisibility: '公開先の設定状況',
  emptyTitle: 'まだ案件が登録されていません。',
  emptyLead: '案件を登録すると、この一覧に表示されます。',
  nextPage: '次のページ',
  firstPage: '最初のページに戻る',
};

const statusOptions = [
  { value: '', label: 'すべて' },
  { value: 'OPEN', label: '募集中' },
  { value: 'FILLED', label: '充足' },
  { value: 'SUCCESSOR_WANTED', label: '後任募集' },
] as const;

const prefectureOptions = [
  { value: '', label: 'すべて' },
  { value: '13', label: '東京都' },
] as const;

const emptyFilters = { q: '', status: '', startFrom: '', prefecture: '' } as const;

function render(
  overrides: Partial<Parameters<typeof ProjectListScreen>[0]> = {},
): string {
  return renderToStaticMarkup(
    createElement(ProjectListScreen, {
      rows: [row()],
      filters: emptyFilters,
      statusOptions,
      prefectureOptions,
      showVisibilityColumn: true,
      canRegister: true,
      showClearFilters: false,
      nextPageHref: null,
      firstPageHref: null,
      messages,
      ...overrides,
    }),
  );
}

describe('🔴 F-014 AC-4 / BR-07: 取引先に公開先の設定状況を出さない', () => {
  it('ホストには 9 列目（公開先の設定状況）が出る', () => {
    const html = render();

    expect(html).toContain('公開先の設定状況');
    expect(html).toContain('3 社に公開中');
  });

  it('🔴 取引先では列そのものが描かれない（列見出しも値も 0 件）', () => {
    const html = render({
      showVisibilityColumn: false,
      // 🔴 取引先の行は `visibility: null` で届く（`projectListRow` が型で保証する）。
      rows: [row({ visibility: null })],
    });

    expect(html).not.toContain('公開先の設定状況');
    expect(html).not.toContain('社に公開中');
    expect(html).not.toContain('未設定');
  });
});

describe('🔴 docs/05 §4.8: 順位・全体件数・スコアを描かない', () => {
  it('ページ番号（「全 N ページ中 M ページ目」）を描かない', () => {
    const html = render({ nextPageHref: '/projects?cursor=x' });

    expect(html).not.toContain('ページ目');
    expect(html).not.toContain('ページ中');
  });

  it('スコア・順位・重みの語が 1 つも出ない（Phase 1）', () => {
    const html = render();

    for (const word of ['スコア', '順位', '重み', '適合度']) {
      expect(html, `${word} が描かれている`).not.toContain(word);
    }
  });
});

describe('権限差分（docs/04 §S-010）', () => {
  it('登録できるロールには「案件を登録」が出る', () => {
    expect(render()).toContain('href="/projects/new"');
  });

  it('🔴 取引先・`VIEWER` には登録導線が無く、代わりに理由が出る', () => {
    const html = render({ canRegister: false });

    expect(html).not.toContain('href="/projects/new"');
    expect(html).toContain('案件の登録は、閲覧のみの権限では行えません。');
  });

  it('取引先には母集団の説明が 1 行増える', () => {
    const html = render({
      messages: { ...messages, partnerScopeNotice: 'この一覧には、御社に公開された案件のみが表示されます。' },
    });

    expect(html).toContain('御社に公開された案件のみが表示されます');
  });
});

describe('行から詳細への導線（docs/04 §S-010「行クリックで `S-011`」）', () => {
  it('案件名が `S-011` へのリンクになる', () => {
    expect(render()).toContain(`href="/projects/${PROJECT_A}"`);
  });

  it('複数行を描ける', () => {
    const html = render({ rows: [row(), row({ id: PROJECT_B, name: '物流管理システム保守' })] });

    expect(html).toContain(`href="/projects/${PROJECT_A}"`);
    expect(html).toContain(`href="/projects/${PROJECT_B}"`);
  });

  it('🔴 超過件数は 0 のとき描かない（`+0` を出さない）', () => {
    expect(render()).not.toContain('+0');
    expect(render({ rows: [row({ moreMustRequirements: '+2' })] })).toContain('+2');
  });
});

describe('空状態（docs/04 §10.1 `S-010`）', () => {
  it('0 件のときはテーブルを描かず、呼び出し側が選んだ文言を出す', () => {
    const html = render({ rows: [] });

    expect(html).not.toContain('data-testid="project-list-table"');
    expect(html).toContain('まだ案件が登録されていません。');
  });

  it('🔴 取引先の初回空は「公開されていない」と書く（「案件が無い」と書かない）', () => {
    const html = render({
      rows: [],
      showVisibilityColumn: false,
      messages: {
        ...messages,
        emptyTitle: '御社に公開された案件はまだありません。',
        emptyLead: '案件が公開されると、この画面と通知でお知らせします。',
      },
    });

    expect(html).toContain('御社に公開された案件はまだありません。');
    expect(html).not.toContain('まだ案件が登録されていません。');
  });
});

describe('検索条件（docs/04 §S-010 セクション 1）', () => {
  it('`method="get"` のフォームで `/projects` に送る（クライアント JS を要求しない）', () => {
    const html = render();

    expect(html).toContain('method="get"');
    expect(html).toContain('action="/projects"');
  });

  it('現在の条件がフォームに戻る（検索してもフォームが空にならない）', () => {
    const html = render({
      filters: { q: '基幹', status: 'OPEN', startFrom: '2026-10-01', prefecture: '13' },
    });

    expect(html).toContain('value="基幹"');
    expect(html).toContain('value="2026-10-01"');
    // `select` の既定値は `option` の `selected` として描かれる。
    expect(html).toContain('<option value="OPEN" selected=""');
    expect(html).toContain('<option value="13" selected=""');
  });

  it('🔴 絞り込みが効いているときだけ「条件をクリア」を出す', () => {
    expect(render()).not.toContain('条件をクリア');
    expect(render({ showClearFilters: true })).toContain('条件をクリア');
  });

  it('効かない条件は入力欄を描かず、できないことを書く', () => {
    const html = render();

    expect(html).toContain('スキル要件・単価レンジ・リモート可否');
    expect(html).not.toContain('name="skills"');
    expect(html).not.toContain('name="priceMin"');
    expect(html).not.toContain('name="remote"');
  });
});

describe('ページング（検索条件を保つ）', () => {
  it('次ページのリンクは呼び出し側が組み立てた URL をそのまま使う', () => {
    const html = render({ nextPageHref: `/projects?q=%E5%9F%BA%E5%B9%B9&cursor=${PROJECT_B}` });

    expect(html).toContain(`href="/projects?q=%E5%9F%BA%E5%B9%B9&amp;cursor=${PROJECT_B}"`);
  });

  it('1 ページ目では「最初のページに戻る」を出さない', () => {
    expect(render()).not.toContain('最初のページに戻る');
    expect(render({ firstPageHref: '/projects?q=x' })).toContain('最初のページに戻る');
  });

  it('次も前も無ければページングの領域ごと描かない', () => {
    expect(render()).not.toContain('data-testid="project-list-paging"');
  });
});
