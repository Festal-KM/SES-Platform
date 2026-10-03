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
  overflowNote: '右端が切れているときは、表を横にスクロールすると残りの列が見られます。',
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
  columnAction: '操作',
  panelOpen: '内容を見る',
  columnToggleTrigger: '表示する列',
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

/**
 * 🔴 列表示切替の項目（`T-22-06`）。**組み立てはサーバ側**（`list-props.ts` の
 * `projectColumnToggleItems` / `list-rows.ts` の `projectColumnToggleHref`）であり、
 * ここでは「画面が受け取った形をどう描くか」だけを見る。
 */
const COLUMN_TOGGLE_SHOWN = [
  {
    id: 'visibility',
    label: '「公開先の設定状況」の列を隠す',
    hidden: false,
    href: '/projects?hide=visibility',
  },
] as const;

/** 🔴 隠している状態（URL に `?hide=visibility` が載っている状態）で届く形。 */
const COLUMN_TOGGLE_HIDDEN = [
  {
    id: 'visibility',
    label: '「公開先の設定状況」の列を表示する',
    hidden: true,
    href: '/projects',
  },
] as const;

function render(
  overrides: Partial<Parameters<typeof ProjectListScreen>[0]> = {},
): string {
  // 🔴 取引先には 9 列目そのものが無いので、切替も届かない（`page.tsx` と同じ導き方）。
  const showVisibilityColumn = overrides.showVisibilityColumn ?? true;
  return renderToStaticMarkup(
    createElement(ProjectListScreen, {
      rows: [row()],
      filters: emptyFilters,
      statusOptions,
      prefectureOptions,
      showVisibilityColumn,
      canRegister: true,
      showClearFilters: false,
      nextPageHref: null,
      firstPageHref: null,
      columnToggleItems: showVisibilityColumn ? COLUMN_TOGGLE_SHOWN : [],
      // 🔴 SP-22 段④: 副カラムで開いている行（既定は先頭行）と、行から開く URL。
      //    組み立ては `lib/projects/list-rows.test.ts`（`selectedProjectId` / `projectSelectHref`）が
      //    固定する。ここでは「画面が受け取った形をどう描くか」だけを見る。
      selectedId: PROJECT_A,
      selectHrefOf: (projectId: string) => `/projects?selected=${projectId}`,
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
  // 🔴 **SP-22 段④で登録の導線は帯（`PageHeader`）へ移った**（`docs/04` §S-010「案件を登録
  //    （primary、ホストのみ）」/ §7.6「primary は大きく」）。したがって本体には描かれない。
  //    🔴 **判定の検出器は失っていない** —— `projectListPrimaryAction(canRegister)` が
  //    `null` を返すことを `lib/projects/list-rows.test.ts` が固定し（`page.tsx` は
  //    ユニットテストの対象外であるため、判定を `lib/**` に置いた）、`PageHeading` 側の
  //    `kind: 'ACTION'` × `canAct` の落とし方は `_shell/page-heading.render.test.tsx` が固定する。
  it('🔴 本体（一覧）には登録導線が無い（帯の primary へ移したため。二重に描かない）', () => {
    expect(render()).not.toContain('href="/projects/new"');
    expect(render({ canRegister: false })).not.toContain('href="/projects/new"');
  });

  it('🔴 取引先・`VIEWER` には理由テキストが出る（`disabled` のボタンを置かない。§7.6）', () => {
    const html = render({ canRegister: false });

    expect(html).toContain('data-testid="project-list-read-only-note"');
    expect(html).toContain('案件の登録は、閲覧のみの権限では行えません。');
  });

  it('🔴 登録できるロールには理由テキストを出さない（出すと「できない」と読める）', () => {
    const html = render();

    expect(html).not.toContain('data-testid="project-list-read-only-note"');
    expect(html).not.toContain('案件の登録は、閲覧のみの権限では行えません。');
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
  it('0 件のときはデータ行を 1 行も描かず、呼び出し側が選んだ文言を出す', () => {
    const html = render({ rows: [] });

    // ⚠️ **T-22-06 で判定の形を追随させた（緩めていない）**: `@ses/ui` の `DataTable` は空状態を
    //    **表の中の 1 行**（`project-list-empty-row` の `colSpan`）として描く契約である
    //    （`docs/05` §2.3.5 の `empty`）。🔴 守るべき中身は「**データ行が 0 であること**」である。
    expect(html).toContain('data-testid="project-list-empty-row"');
    expect(html).not.toContain('data-testid="project-list-row-');
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

describe('🔴 T-11-12: 案件名セルが docs/04 §10.3「長い名称」のブレークポイント別規約と一致する（`@ses/ui` の `NameCell`）', () => {
  it('lg 未満 = 折り返し + 下限 10rem、lg 以上 = 切り詰め（器）+ title + 同じ行に S-011 への導線', () => {
    const html = render({ rows: [row({ name: '金融系 Web API 改修' })] });
    // ⚠️ **T-22-06: `<td>` の属性が増えたぶんだけ正規表現を緩めた（判定は 1 つも緩めていない）**。
    //    `DataTable` は列定義由来の `style="min-width:…"` と `data-column-id` をセルに付ける。
    const cell = /<td class="([^"]*)"[^>]*>(<span class="[^"]*" title="金融系 Web API 改修">.*?<[/]span>)<[/]td>/.exec(html);
    expect(cell).not.toBeNull();
    const classes = (cell?.[1] ?? '').split(' ');
    expect(classes).toContain('whitespace-normal');
    expect(classes).toContain('min-w-40');
    expect(classes).toContain('lg:max-w-64');
    expect(classes).not.toContain('truncate');
    expect(classes).not.toContain('whitespace-nowrap');
    const inner = cell?.[2] ?? '';
    expect(inner).toContain('<span class="block lg:truncate" title="金融系 Web API 改修">');
    const link = /<a ([^>]*)>金融系 Web API 改修<[/]a>/.exec(inner);
    expect(link).not.toBeNull();
    expect(link?.[1]).toContain(`href="/projects/${PROJECT_A}"`);
    expect(link?.[1]).toContain(`data-testid="project-list-link-${PROJECT_A}"`);
    expect(link?.[1]).not.toContain('truncate');
  });
});

// ============================================================================
// 🔴 T-22-06: 列の集合・並び・ブレークポイントが**移行前と同一**である（受け入れ基準 2）
// ============================================================================
// 🔴 **整形のついでに列を足さない / 落とさない。** `hidden lg:table-cell` の直書きを列定義の
//    `priority` に移しただけであり、DOM に出る列と消える境界は 1 つも変わっていない
//    （§10.3 の `S-010` の行「募集人数 → 勤務地 → 更新日」/ §S-010「デバイス別」）。
//
// | 列 | 移行前のクラス | 移行後の `priority` |
// |---|---|---|
// | 案件名 | （常時） | `always` |
// | 状態 | （常時） | `always` |
// | 必須要件の要約 | `hidden lg:table-cell` | `lg` |
// | 単価レンジ | （常時） | `always` |
// | 開始日 | （常時） | `always` |
// | 勤務地・リモート | `hidden sm:table-cell` | `sm` |
// | 募集人数 | `hidden lg:table-cell` | `lg` |
// | 更新日 | `hidden sm:table-cell` | `sm` |
// | 公開先の設定状況（ホストのみ） | `hidden lg:table-cell` | `lg` + `hideable`（9 列目） |
describe('🔴 T-22-06: 列の契約（移行前と同一。増減 0）', () => {
  /**
   * 🔴 **データ列だけを返す**（`data-column-id` を持つ `<th>`）。
   *    ⚠️ **SP-22 段④ で操作列（`内容を見る`）が増えた**が、操作列は `docs/04` §7.1 の
   *    「既定 8 列 + **操作列**」の後者であり、**データ列の集合は 1 つも変わっていない**。
   *    操作列が 1 つだけ在ることは下の専用のテストが固定する（判定を緩めていない）。
   */
  function headerColumns(html: string): { readonly id: string; readonly breakpoint: string }[] {
    const head = /<thead[^>]*>(.*?)<[/]thead>/s.exec(html)?.[1] ?? '';
    return [...head.matchAll(/<th ([^>]*)>/g)]
      .map((match) => {
        const attributes = match[1] ?? '';
        const id = /data-column-id="([^"]+)"/.exec(attributes)?.[1] ?? '?';
        const classes = /class="([^"]*)"/.exec(attributes)?.[1] ?? '';
        const breakpoint = classes.includes('hidden lg:table-cell')
          ? 'lg'
          : classes.includes('hidden sm:table-cell')
            ? 'sm'
            : 'always';
        return { id, breakpoint };
      })
      .filter((column) => column.id !== '?');
  }

  it('🔴 データ列のほかに `<th>` が 1 つだけ在る（= 操作列。2 つ目の無名の列が生えていない）', () => {
    const head = /<thead[^>]*>(.*?)<[/]thead>/s.exec(render())?.[1] ?? '';
    const all = [...head.matchAll(/<th ([^>]*)>/g)].length;
    expect(all - headerColumns(render()).length).toBe(1);
  });

  it('ホスト = 9 列（9 列目は公開先の設定状況）。並びと境界が移行前と一致する', () => {
    expect(headerColumns(render())).toEqual([
      { id: 'name', breakpoint: 'always' },
      { id: 'status', breakpoint: 'always' },
      { id: 'mustRequirements', breakpoint: 'lg' },
      { id: 'unitPrice', breakpoint: 'always' },
      { id: 'startDate', breakpoint: 'always' },
      { id: 'location', breakpoint: 'sm' },
      { id: 'headcount', breakpoint: 'lg' },
      { id: 'updatedOn', breakpoint: 'sm' },
      { id: 'visibility', breakpoint: 'lg' },
    ]);
  });

  it('🔴 取引先 = 8 列（公開先の列そのものが無い。CSS で隠すのではない）', () => {
    const columns = headerColumns(render({ showVisibilityColumn: false }));
    expect(columns.map((column) => column.id)).toEqual([
      'name',
      'status',
      'mustRequirements',
      'unitPrice',
      'startDate',
      'location',
      'headcount',
      'updatedOn',
    ]);
    expect(render({ showVisibilityColumn: false })).not.toContain('data-testid="project-list-visibility-');
  });

  it('🔴 モバイル（`sm` 未満）に残るのは 4 列（案件名 / 状態 / 単価レンジ / 開始日）', () => {
    const always = headerColumns(render()).filter((column) => column.breakpoint === 'always');
    expect(always.map((column) => column.id)).toEqual(['name', 'status', 'unitPrice', 'startDate']);
  });

  it('🔴 公開状況列は 1 語だけを描く（理由・原因の欄を一覧に出さない）', () => {
    const html = render({ rows: [row({ visibility: '公開を解除（検査）' })] });
    expect(html).toMatch(/data-testid="project-list-visibility-[^"]+">公開を解除（検査）<\/span>/);
  });

  it('🔴 行選択（`selection`）を描かない（Phase 1 に一括操作は無い）', () => {
    expect(render()).not.toContain('data-testid="project-list-select-');
  });
});

// ============================================================================
// 🔴 T-22-06 の仕上げ: 列表示切替（`docs/04` §7.1 / §5-13）
// ============================================================================
// 🔴 §7.1 は「**既定 8 列 + 操作列。9 列目以降は列表示切替に格納する**」と定めている。
//    列定義に `hideable` を付けただけでは**利用者が列を隠す手段が無く**、条文が満たされない。
// ⚠️ **メニューの項目（`隠す` / `表示する` のリンク）は DOM に出ない** —— Radix の
//    `DropdownMenu` は開いた状態を `Portal` に載せ、`react-dom/server` には `document` が
//    無いためサーバ描画では何も出さない（`app/_components/ui-overlays.render.test.tsx` の実測）。
//    したがってここで観測するのは **①トリガの置き場所 ②いま隠している列（`data-hidden-columns`）
//    ③`<thead>` / 行に現れる列**の 3 つである。項目の href の組み立ては
//    `lib/projects/list-rows.test.ts` が固定する。
describe('🔴 T-22-06: 列表示切替（§7.1「9 列目以降は列表示切替に格納する」）', () => {
  it('🔴 切替は `Toolbar` の中にある（帯の外・テーブルの脇に置かない）', () => {
    const html = render();
    const filters = html.indexOf('data-testid="project-list-toolbar-filters"');
    const toggle = html.indexOf('data-testid="project-list-column-toggle-root"');
    const population = html.indexOf('data-testid="project-list-toolbar-population"');
    const table = html.indexOf('data-testid="project-list-table"');

    expect(filters, 'Toolbar の検索の段が描かれていない').toBeGreaterThanOrEqual(0);
    // 🔴 `Toolbar` は 検索の段 → 母集団の 1 行 → テーブル の順に描く（`packages/ui/src/components/toolbar.tsx`）。
    //    切替がその 2 つの間に在ることが「帯の中に在る」ことの機械的な判定である。
    expect(toggle, '列表示切替が描かれていない').toBeGreaterThan(filters);
    expect(toggle, '列表示切替が母集団の 1 行より後にある（帯の外に出ている）').toBeLessThan(population);
    expect(toggle, '列表示切替がテーブルより後にある').toBeLessThan(table);
  });

  it('切替のトリガは語を持つ（アイコンだけで開かせない）', () => {
    const html = render();

    expect(html).toContain('data-testid="project-list-column-toggle-trigger"');
    expect(html).toContain('表示する列');
  });

  it('🔴 既定では 9 列すべてが出る（切替を置いても見え方は変わらない。受け入れ基準 2）', () => {
    const html = render();
    const head = /<thead[^>]*>(.*?)<[/]thead>/s.exec(html)?.[1] ?? '';

    expect([...head.matchAll(/data-column-id="([^"]+)"/g)].map((match) => match[1])).toEqual([
      'name',
      'status',
      'mustRequirements',
      'unitPrice',
      'startDate',
      'location',
      'headcount',
      'updatedOn',
      'visibility',
    ]);
    // 🔴 「何も隠していない」は空である（`?hide=` が URL に無い状態と 1 対 1）。
    expect(html).toContain('data-hidden-columns=""');
  });

  it('🔴 隠している列は `<thead>` と行の両方から消える（CSS で隠すのではない）', () => {
    const html = render({ columnToggleItems: COLUMN_TOGGLE_HIDDEN });
    const head = /<thead[^>]*>(.*?)<[/]thead>/s.exec(html)?.[1] ?? '';

    expect([...head.matchAll(/data-column-id="([^"]+)"/g)].map((match) => match[1])).toEqual([
      'name',
      'status',
      'mustRequirements',
      'unitPrice',
      'startDate',
      'location',
      'headcount',
      'updatedOn',
    ]);
    expect(html).not.toContain('公開先の設定状況');
    expect(html).not.toContain('data-testid="project-list-visibility-');
    expect(html).not.toContain('3 社に公開中');
    // 🔴 いま何を外しているかは画面から読める（戻す導線が消えない）。
    expect(html).toContain('data-hidden-columns="visibility"');
    expect(html).toContain('data-testid="project-list-column-toggle-root"');
  });

  it('🔴 取引先には切替そのものが無い（9 列目が存在しないため。`F-014 AC-4` / `BR-07`）', () => {
    const html = render({ showVisibilityColumn: false, rows: [row({ visibility: null })] });

    expect(html).not.toContain('data-testid="project-list-column-toggle-root"');
    expect(html).not.toContain('data-testid="project-list-column-toggle-trigger"');
    expect(html).not.toContain('表示する列');
  });
});

// ============================================================================
// 🔴 SP-22 段④: ワイヤーフレームへの刷新（**見せ方だけ**。人間の
//    「SES Hub案件管理ダッシュボード.png」）
// ============================================================================
describe('🔴 SP-22 段④: 絞り込みカードと件数バー', () => {
  it('🔴 絞り込みは白い面のカード（`@ses/ui` の `Card`）の中にある（ページ地に溶けない）', () => {
    const html = render();
    // 🔴 面の語（`CARD_SURFACE_CLASSES`）は `packages/ui` にしか無いので、**ここでは
    //    その語を書かない**（書くと `tests/static/ui-shadow-and-size.test.ts` の
    //    「画面が面のクラス定数を再実装していない」に当たる）。radius + 枠線で器を掴む。
    const card = html.indexOf('rounded-md border border-border');
    const form = html.indexOf('data-testid="project-list-filters"');

    expect(card, '絞り込みカードの面が描かれていない').toBeGreaterThanOrEqual(0);
    expect(form, '検索フォームがカードの外にある').toBeGreaterThan(card);
  });

  it('🔴 フリーワードは全幅である（他の 3 条件と同じ幅に並べない）', () => {
    const html = render();
    const label = /<label class="([^"]*)"[^>]*>\s*<span[^>]*>フリーワード/.exec(html);

    expect(label, 'フリーワードの欄が見つからない').not.toBeNull();
    const classes = (label?.[1] ?? '').split(' ');
    expect(classes).toContain('sm:col-span-2');
    expect(classes).toContain('lg:col-span-3');
    expect(classes).toContain('xl:col-span-4');
  });

  it('🔴 「効かない条件」の 1 行は絞り込みカードの中にある（条件の群の隣で読む）', () => {
    const html = render();
    const comingSoon = html.indexOf('data-testid="project-list-search-coming-soon"');
    const form = html.indexOf('data-testid="project-list-filters"');
    const population = html.indexOf('data-testid="project-list-toolbar-population"');

    expect(comingSoon).toBeGreaterThan(form);
    expect(comingSoon, '件数バーより後に出ている（カードの外）').toBeLessThan(population);
  });

  it('🔴 件数バー: 母集団の 1 行と並び順の説明が同じ段にある', () => {
    const html = render();
    const population = html.indexOf('data-testid="project-list-toolbar-population"');
    const note = html.indexOf('data-testid="project-list-toolbar-note"');
    const orderNote = html.indexOf('data-testid="project-list-order-note"');
    const table = html.indexOf('data-testid="project-list-table"');

    expect(population).toBeGreaterThanOrEqual(0);
    expect(note, '並び順の置き場所（`Toolbar` の `note`）が無い').toBeGreaterThan(population);
    // 🔴 凍結済みの `project-list-order-note` が `note` の中に在る（`U-22`）。
    expect(orderNote).toBeGreaterThan(note);
    expect(orderNote, '並び順の説明がテーブルより後に出ている').toBeLessThan(table);
    expect(html).toContain('後任募集 → 募集中 → 充足');
  });

  it('🔴 並び順は**選べる形にしない**（`?sort=` は既存 API に無い）', () => {
    const html = render();

    // 並び替えのリンク（`DataTableSortLink`）も、並び順のセレクトも描かない。
    expect(html).not.toContain('data-testid="project-list-sort-');
    expect(html).not.toContain('name="sort"');
    expect(html).not.toContain('name="order"');
  });

  it('🔴 既存 API（#25）に無い条件の入力欄を 1 つも描かない', () => {
    const html = render();

    for (const name of [
      'name="skills"',
      'name="priceMin"',
      'name="priceMax"',
      'name="remote"',
      'name="category"',
      'name="kind"',
      'name="parallel"',
      'name="openOnly"',
      'name="limit"',
    ]) {
      expect(html, `${name} の入力欄が描かれている（API に無い条件）`).not.toContain(name);
    }
  });
});

describe('🔴 SP-22 段④: 操作列から副カラム（案件の要点パネル）を開く', () => {
  it('操作列の語は §7.8 の統一語（`内容を見る`）で、行ごとに URL を持つ', () => {
    const html = render({ rows: [row(), row({ id: PROJECT_B, name: '物流管理システム保守' })] });

    expect(html).toContain('操作');
    expect(html).toContain(`data-testid="project-list-panel-open-${PROJECT_A}"`);
    expect(html).toContain(`data-testid="project-list-panel-open-${PROJECT_B}"`);
    expect(html).toContain(`href="/projects?selected=${PROJECT_A}"`);
    expect(html).toContain(`href="/projects?selected=${PROJECT_B}"`);
  });

  it('🔴 `詳細` の語を操作列に使わない（`詳細` は画面〔`S-011`〕を指す語である。§7.8）', () => {
    const html = render();
    const actionCell = /内容を見る/.exec(html);

    expect(actionCell).not.toBeNull();
    // 操作列のリンクのラベルが `詳細` になっていない（同じ語が 2 概念を指さない）。
    expect(html).not.toContain('>詳細<');
  });

  it('🔴 行クリック（名称セル）の行き先は `S-011` のまま（閲覧の監査記録は遷移先が書く）', () => {
    const html = render();

    expect(html).toContain(`href="/projects/${PROJECT_A}"`);
    expect(html).toContain(`data-testid="project-list-link-${PROJECT_A}"`);
  });

  it('副カラムで開いている行に印が付く（選択＝一括操作ではない）', () => {
    const html = render({
      rows: [row(), row({ id: PROJECT_B, name: '物流管理システム保守' })],
      selectedId: PROJECT_B,
    });
    const selected = /<tr class="[^"]*" data-testid="project-list-row-([^"]+)" data-selected="true">/.exec(
      html,
    );

    expect(selected?.[1]).toBe(PROJECT_B);
    // 🔴 チェックボックスは置かない（Phase 1 に一括操作は 1 つも無い）。
    expect(html).not.toContain('data-testid="project-list-select-');
    expect(html).not.toContain('type="checkbox"');
  });

  it('🔴 どの行も選ばれていないときは印が 1 つも付かない', () => {
    expect(render({ selectedId: null })).not.toContain('data-selected="true"');
  });
});
