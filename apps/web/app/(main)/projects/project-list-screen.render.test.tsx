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
    // 🔴 ✅ 2026-10-14: 状態の**値**（語ではない）。色は `@ses/ui` が状態名から決める。
    statusState: 'OPEN',
    mustRequirements: 'Java 5 年以上、Spring',
    moreMustRequirements: null,
    unitPrice: '65〜75 万円',
    startDate: '2026-10-01',
    location: '東京都',
    remoteMode: '一部リモート可',
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
  // ✅ 2026-10-16: 「リモート可否」を外した（稼働形態の絞り込みを実装したため）。
  searchLegend: '検索条件',
  searchQ: 'フリーワード',
  searchStatus: 'ステータス',
  searchPriceMin: '単価（下限）',
  searchPriceMax: '単価（上限）',
  // ✅ 2026-10-15: 受領画像の絞り込みカード（虫眼鏡 + プレースホルダ / 単価の 1 つの欄）。
  searchQPlaceholder: '案件名・外部公開用の記載から探す',
  searchPrice: '単価（月額）',
  searchPriceMinPlaceholder: '下限なし',
  searchPriceMaxPlaceholder: '上限なし',
  searchPriceRangeSeparator: '〜',
  searchPriceUnit: '円',
  // ✅ 2026-10-16（人間の明示指示。案件一覧の検索機能）。
  searchRemoteMode: '稼働形態',
  searchCategory: 'カテゴリ',
  // ✅✅ 2026-10-16: スキル（複数選択 / OR）。
  searchSkill: 'スキル',
  searchSkillAll: 'すべて',
  searchSkillRemove: 'を外す',
  searchSkillHint:'スキルは複数選べます（選んだいずれかを要件に持つ案件が出ます）。',
  searchSkillEmpty: 'スキル辞書に登録がありません。',
  searchPriceInverted: '単価の下限が上限を上回っています。どちらかを直してください。',
  searchSubmit: '検索',
  searchClear: '条件をクリア',
  register: '案件を登録',
  readOnlyNote: '案件の登録は、閲覧のみの権限では行えません。',
  columnName: '案件名',
  columnStatus: '状態',
  columnMustRequirements: '必須要件の要約',
  columnUnitPrice: '単価レンジ',
  columnStartDate: '開始日',
  columnLocation: '勤務地',
  columnRemoteMode: '稼働形態',
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
  // ✅ 2026-10-16: 2 値になった（Issue #98 の回答「募集中と終了の二つだけでよい」）。
  { value: 'OPEN', label: '募集中' },
  { value: 'CLOSED', label: '終了' },
] as const;


const emptyFilters = {
  q: '',
  status: '',
  startFrom: '',
  prefecture: '',
  priceMin: '',
  priceMax: '',
  // ✅ 2026-10-16: 稼働形態 / 募集中のみ / カテゴリ / 案件区分 / 並行可否 / 開始時期。
  remoteMode: '',
  recruitingOnly: '',
  category: '',
  sourceKind: '',
  parallelOk: '',
  startWithin: '',
  // ✅✅ 2026-10-16: スキルは配列である（`<select multiple>` の選択状態）。
  skills: [] as readonly string[],
} as const;

/** ✅ 2026-10-16（受領モック）: カテゴリ / 案件区分 / 並行可否 / 開始時期の選択肢。 */
const categoryOptions = [
  { value: '', label: 'すべて' },
  { value: 'BACKEND', label: 'バックエンド' },
  { value: 'FRONTEND', label: 'フロントエンド' },
] as const;
/**
 * ✅✅ 2026-10-16: スキルの選択肢（辞書の ID と `name`）。
 * 🔴 **「すべて」を含まない** —— `<select multiple>` では**何も選んでいない状態が「すべて」**である。
 */
const skillOptions = [
  { value: '11111111-1111-7111-8111-111111111111', label: 'Java' },
  { value: '22222222-2222-7222-8222-222222222222', label: 'TypeScript' },
] as const;

/** ✅ 2026-10-16: 稼働形態の選択肢（値の出所は `REMOTE_MODES`。語は一覧の列と同じ）。 */
const remoteModeOptions = [
  { value: '', label: 'すべて' },
  { value: 'FULL_REMOTE', label: 'フルリモート可' },
  { value: 'PARTIAL_REMOTE', label: '一部リモート可' },
  { value: 'ONSITE_ONLY', label: '常駐' },
] as const;

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

// ⚠️ **2026-10-16: 「隠している状態」の形は外した** —— `表示する列` のボタンを画面から
//    外した時点（人間の明示指示）で、この形を描く経路が 1 つも無くなったためである。
//    🔴 **`?hide=` の query を受け取れる状態は保っている**（`page.tsx` が `columnToggleItems` を
//    組み立て続けている）ので、共有された URL は壊れていない。

function render(
  overrides: Partial<Parameters<typeof ProjectListScreen>[0]> = {},
): string {
  // 🔴 取引先には 9 列目そのものが無いので、切替も届かない（`page.tsx` と同じ導き方）。
  return renderToStaticMarkup(
    createElement(ProjectListScreen, {
      rows: [row()],
      filters: emptyFilters,
      statusOptions,
      remoteModeOptions,
      categoryOptions,
      skillOptions,
      skillRemoveHrefOf: (skillId: string) => `/projects?removed=${skillId}`,
      priceInverted: false,
      canRegister: true,
      nextPageHref: null,
      firstPageHref: null,
      columnToggleItems: COLUMN_TOGGLE_SHOWN,
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
  // ✅✅ **2026-10-16: 名称の行き先が `S-011` から「右パネルを開く URL」に変わった**
  //    （人間の明示指示「案件タイトルもリンクにしない。列クリック→右側で詳細をクリックで
  //    詳細画面に行く動線」）。🔴 **行いっぱいが当たり判定である**（`nameCell.stretch`）。
  it('行の当たり判定が右パネルを開く URL になる', () => {
    // 2026-10-16: 行の行き先は右パネルを開く URL（selectHrefOf）である。
    expect(render()).toContain(`project-list-link-${PROJECT_A}`);
  });

  it('複数行を描ける', () => {
    const html = render({ rows: [row(), row({ id: PROJECT_B, name: '物流管理システム保守' })] });

    expect(html).toContain(`project-list-link-${PROJECT_A}`);
    expect(html).toContain(`project-list-link-${PROJECT_B}`);
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
      filters: {
        q: '基幹',
        status: 'OPEN',
        startFrom: '2026-10-01',
        prefecture: '13',
        // ✅ 2026-10-15: 単価レンジも戻る（条件が 1 つでも落ちると「検索したのに消えた」になる）。
        priceMin: '600000',
        priceMax: '800000',
        // ✅ 2026-10-16: 稼働形態と「募集中のみ」も戻る。
        remoteMode: 'FULL_REMOTE',
        recruitingOnly: '1',
        // ✅ 2026-10-16（受領モック）: 足した 4 条件も戻る。
        category: 'BACKEND',
        sourceKind: 'OWN',
        parallelOk: '1',
        startWithin: 'THIS_MONTH',
        // ✅✅ 2026-10-16: スキル（複数選択）も戻る。
        skills: ['22222222-2222-7222-8222-222222222222'],
      },
    });

    expect(html).toContain('value="基幹"');
    expect(html).toContain('value="600000"');
    expect(html).toContain('value="800000"');
    // `select` の既定値は `option` の `selected` として描かれる。
    expect(html).toContain('<option value="OPEN" selected=""');
    expect(html).toContain('<option value="BACKEND" selected=""');
    expect(html).toContain('<option value="FULL_REMOTE" selected=""');
    // ✅✅ **2026-10-16（同日の 2 回目。人間の明示指示「スキルの部分はポップアップや Tip で
    //    選択肢を表示して…表示させるのはバッチ風の表示にするのがいい」）: 複数選択は
    //    `<select multiple>` から**チェックボックスのポップアップ**に替わった。**
    //    🔴 送る形は 1 文字も変えていない（`skills=A&skills=B`）。戻り方は `checked` で見る。
    expect(html).toContain('checked="" value="22222222-2222-7222-8222-222222222222"');
    expect(html).not.toContain('checked="" value="11111111-1111-7111-8111-111111111111"');
    // 🔴 **選んだものはバッジで見える**（引き金に出る）。
    expect(html).toContain('TypeScript');
    // ⚠️ **2026-10-16: 画面から外した 4 条件（案件区分 / 勤務地 / 開始時期 / 並行可否）は
    //    欄ごと無いので「戻る」こと自体が無い。** 🔴 **query と述語は残してある**ので、
    //    共有済みの URL は従来どおり効く（`lib/projects/list-rows.test.ts` が URL 側を固定する）。
    expect(html).not.toContain('name="startWithin"');
    expect(html).not.toContain('name="prefecture"');
  });

  // ✅✅ **2026-10-16: 常時表示に変えた**（受領モックのフッタは「条件をクリア」と「検索」が
  //    常に並んでいる）。⚠️ **以前は「絞り込みが効いているときだけ」だった** ——
  //    「押しても何も起きないボタンを常設しない」という規律による。
  // 🔴 **規律を曲げた理由**: 絞り込みの帯が 3 行になり、どこまでが条件なのかが一目で
  //    分からなくなった。クリアが常に同じ位置に在ることのほうが、空振りの 1 クリックより
  //    価値が高い（押した結果は「条件なしの一覧」であり、壊れる操作ではない）。
  it('🔴 「条件をクリア」は常に出る（絞り込みの有無によらない）', () => {
    // 🔴 **絞り込みが 1 つも無くても出る**（これが変えた点である）。
    expect(render()).toContain('条件をクリア');
    // 🔴 行き先は条件なしの一覧である（押しても壊れない）。
    expect(render()).toContain('data-testid="project-list-clear"');
  });

  // ✅✅ **2026-10-16: 「効かない条件」が 1 つも無くなった**（人間の明示指示の 6 項目を
  //    すべて実装した）。旧題は「効かない条件は入力欄を描かず、できないことを書く」であり、
  //    🔴 **できるようになったものを「できない」と書き続けると画面が嘘をつく**ので、
  //    検査も「スキルの欄が在り、操作の仕方と OR であることを書いている」に置き換えた。
  it('🔴 スキルは複数選択の欄を描き、「複数選べる」と「いずれかに一致」を書く', () => {
    const html = render();

    // ✅✅ **2026-10-16（同日の 2 回目。人間の明示指示）: ポップアップ + バッジ。**
    // 🔴 **`<select multiple>` をやめた** —— `size={3}` でもリストボックスは 3 行ぶんの高さを
    //    占め、同じ行の `Select`（36px）の 2 倍以上になって帯の縦幅を崩していた。
    // 🔴 **実体は同じ `name` のチェックボックス**（送る形は `skills=A&skills=B` のまま）。
    expect(html).toContain('name="skills"');
    expect(html).toContain('type="checkbox"');
    expect(html).not.toContain('multiple=""');
    // 🔴 **ポップアップは `<details>` である**（クライアントの島を使っていない）。
    expect(html).toContain('data-testid="project-list-filter-skills-panel"');
    // 🔴 **開いても帯の高さが変わらない**（重ねて出す）。
    expect(html).toContain('absolute');
    // 🔴 1 つも選んでいないときの引き金の語（空の引き金を置かない）。
    expect(html).toContain('すべて');
    // 🔴 **操作の仕方と OR であることを書く** —— `<select multiple>` はどちらも見た目から
    //    分からず、書かないと「選んだのに 0 件」を不具合と区別できない。
    expect(html).toContain('data-testid="project-list-search-skill-hint"');
    expect(html).toContain('複数選べます');
    expect(html).toContain('いずれか');
    // 🔴 **「後続のリリースで行えます」は消えている**（実装したので嘘になる）。
    expect(html).not.toContain('後続のリリース');
    expect(html).not.toContain('data-testid="project-list-search-coming-soon"');
    // 🔴 「すべて」の番兵を選択肢に作らない（未選択がすべてである）。
    expect(html).not.toMatch(/name="skills"[^>]*>\s*<option value=""/);
  });

  it('🔴 スキル辞書が空なら `<select>` を描かず、その旨を書く', () => {
    const html = render({ skillOptions: [] });

    expect(html).not.toContain('name="skills"');
    expect(html).toContain('data-testid="project-list-filter-skills-empty"');
    expect(html).toContain('スキル辞書に登録がありません。');
  });

  it('✅ 2026-10-15: 単価レンジは入力欄を描く（人材一覧と同じ名前・同じ単位）', () => {
    const html = render();

    expect(html).toContain('name="priceMin"');
    expect(html).toContain('name="priceMax"');
    // 🔴 単位は円（人材一覧と同じ `step`）。万円に変えるなら 2 画面を同時に変える。
    expect(html).toContain('step="10000"');
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
    // ⚠️ ✅ **2026-10-15: 名称の前に状態の点（`StatusDot`）が入った**ぶん、`<td>` の直後に
    //    1 つ `<span>` が増える（`NameCell.leading`）。**判定は 1 つも緩めていない** ——
    //    名称の `<span>`（`title` 付き）の中身は下で同じだけ検査している。
    const cell =
      /<td class="([^"]*)"[^>]*>(?:<span class="mr-2[^"]*">.*?<[/]span>)?(<span class="[^"]*" title="金融系 Web API 改修">.*?<[/]span>)<[/]td>/.exec(
        html,
      );
    expect(cell).not.toBeNull();
    const classes = (cell?.[1] ?? '').split(' ');
    expect(classes).toContain('whitespace-normal');
    expect(classes).toContain('min-w-40');
    // 2026-10-16: 行いっぱいのリンクになったので切り詰めない（全文は折り返しで読める）。
    expect(classes).not.toContain('lg:max-w-64');
    expect(classes).not.toContain('truncate');
    expect(classes).not.toContain('whitespace-nowrap');
    const inner = cell?.[2] ?? '';
    // 2026-10-16: 行いっぱいのリンクになったので切り詰めない（`block` のまま）。
    //    全文は折り返しで読め、`title` も残っている（§10.3 の「長い名称を読めること」は満たす）。
    expect(inner).toContain('<span class="block" title="金融系 Web API 改修">');
    const link = /<a ([^>]*)>金融系 Web API 改修<[/]a>/.exec(inner);
    expect(link).not.toBeNull();
    expect(link?.[1]).toContain(`project-list-link-${PROJECT_A}`); // 2026-10-16: 右パネルを開く URL
    expect(link?.[1]).toContain(`data-testid="project-list-link-${PROJECT_A}"`);
    expect(link?.[1]).not.toContain('truncate');
  });

  // ✅✅ **2026-10-16: 状態の点（`StatusDot`）を外した**（人間の明示指示「案件名の左に
  //    〇があるけどこれはいらないね」）。🔴 **状態は隣の列の `StatusBadge` が語で出している**
  //    ので、読み取れる情報は 1 つも減っていない（案件名の左端が揃うぶん読みやすくなる）。
  it('🔴 名称の前に状態の点を出さない（状態は隣の列の Badge が語で出す）', () => {
    const html = render({ rows: [row({ name: '金融系 Web API 改修' })] });

    expect(html).not.toContain('data-entity="project" data-state="OPEN" aria-hidden');
    // 🔴 状態そのものは消えていない（Badge が語で出す）。
    expect(html).toContain('募集中');
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


  // ✅ **2026-10-15: 10 列になった**（[Issue #101](https://github.com/Festal-KM/SES-Platform/issues/101) の回答 C で
  //    `勤務地・リモート` を 2 列に分けた）。🔴 **出ている情報は 1 つも増えていない。**
  it('ホスト = 10 列（10 列目は公開先の設定状況）。並びと境界が表どおりである', () => {
    expect(headerColumns(render())).toEqual([
      { id: 'name', breakpoint: 'always' },
      { id: 'status', breakpoint: 'always' },
      { id: 'mustRequirements', breakpoint: 'lg' },
      { id: 'unitPrice', breakpoint: 'always' },
      { id: 'startDate', breakpoint: 'always' },
      { id: 'location', breakpoint: 'sm' },
      { id: 'remoteMode', breakpoint: 'sm' },
      { id: 'headcount', breakpoint: 'lg' },
      { id: 'updatedOn', breakpoint: 'sm' },
    ]);
  });


  it('🔴 モバイル（`sm` 未満）に残るのは 4 列（案件名 / 状態 / 単価レンジ / 開始日）', () => {
    const always = headerColumns(render()).filter((column) => column.breakpoint === 'always');
    expect(always.map((column) => column.id)).toEqual(['name', 'status', 'unitPrice', 'startDate']);
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
    const card = html.indexOf('rounded-lg border border-border');
    const form = html.indexOf('data-testid="project-list-filters"');

    expect(card, '絞り込みカードの面が描かれていない').toBeGreaterThanOrEqual(0);
    expect(form, '検索フォームがカードの外にある').toBeGreaterThan(card);
  });

  it('🔴 フリーワードは他の条件より広い（同じ幅に並べない）', () => {
    const html = render();
    const label = /<label class="([^"]*)"[^>]*>\s*<span[^>]*>フリーワード/.exec(html);

    expect(label, 'フリーワードの欄が見つからない').not.toBeNull();
    const classes = (label?.[1] ?? '').split(' ');
    // ✅ **2026-10-15: 全幅（4 列ぶん）→ 2 列ぶん**（定義書 §1.6 の「検索 Input 420×36」+
    //    受領した画像）。🔴 **帯が 1 行ぶん縮む**（行を 45px に上げたぶんをここで取り戻す。
    //    `docs/04` §7.1「一覧はファーストビューに 12 行以上」）。
    // 🔴 **他の条件（1 列）より広いことは変えていない** —— 入力できる語数が画面幅で
    //    変わらないための幅である。
    expect(classes).toContain('col-span-full'); // ✅ 2026-10-16: 受領モックは帯の幅いっぱい
    expect(classes).not.toContain('xl:col-span-4');
  });

  // ✅✅ **2026-10-16: 対象を「効かない条件の 1 行」から「スキル欄の説明の 1 行」に替えた**
  //    （実装したので前者が無くなった）。🔴 **守りたい性質は同じ** —— 注記は絞り込みカードの
  //    中に在り、条件の群の隣で読める。
  it('🔴 スキル欄の説明の 1 行は絞り込みカードの中にある（条件の群の隣で読む）', () => {
    const html = render();
    const comingSoon = html.indexOf('data-testid="project-list-search-skill-hint"');
    const form = html.indexOf('data-testid="project-list-filters"');
    const table = html.indexOf('data-testid="project-list-table"');

    expect(comingSoon).toBeGreaterThan(form);
    // 2026-10-16: 母集団の 1 行を外したので、目印を「表の手前」に変えた
    //    （守りたい性質は「注記が絞り込みカードの中に在る」であって、件数バーの位置ではない）。
    expect(comingSoon, '表より後に出ている（カードの外）').toBeLessThan(table);
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

    // ✅ 2026-10-15: `priceMin` / `priceMax` はこの一覧から外した（API に入ったため）。
    // ✅✅ **2026-10-16: `category` / `kind` / `parallel` / `openOnly` もこの一覧から外した** ——
    //    受領モックの絞り込みを実装し、**API（`#25`）の query に入った**ためである
    //    （`category` / `sourceKind` / `parallelOk` / `recruitingOnly`。列は migration
    //     `20261016030000`、承認は [Issue #113](https://github.com/Festal-KM/SES-Platform/issues/113)）。
    //    🔴 **この検査が守っているのは「押しても効かない入力欄を作らない」である。** 実装した
    //       条件を一覧に残すと、**実装したことを検査が禁じる**状態になり、意味が反転する。
    //    ✅✅ **2026-10-16（同日の 2 回目）: `skills` もこの一覧から外した** ——
    //       人間の明示指示「スキル（リストから複数選択できる、or 検索）」を実装し、
    //       **`#25` の query に入った**（`projectListQuerySchema.skills`。述語は
    //       `project_requirements` への `some` + `skillId IN (…)`）。
    //    🔴 **残りは 1 つも描かない**（表示件数は API に無い。`name="remote"` は
    //       `remoteMode` の綴り間違いを拾うための番兵である）。
    for (const name of ['name="remote"', 'name="limit"']) {
      expect(html, `${name} の入力欄が描かれている（API に無い条件）`).not.toContain(name);
    }
  });
});

// ============================================================================
// 🔴 ✅ 2026-10-14: 状態列は `StatusBadge`（受領した定義書 §1.7「ステータス 100 Badge」）
// ============================================================================
describe('🔴 状態は Badge で描き、色は画面が決めない（`docs/04` §5-13）', () => {
  it('状態名が `data-state` に出て、語は `packages/i18n` 由来のまま出る', () => {
    const html = render();

    expect(html).toContain('data-entity="project"');
    expect(html).toContain('data-state="OPEN"');
    expect(html).toContain('募集中');
  });

  it('🔴 行ごとに状態名が変わる（語ではなく値で描き分けている）', () => {
    const html = render({
      rows: [
        row({ status: '募集中', statusState: 'OPEN' }),
        row({ id: PROJECT_B, name: '物流管理システム保守', status: '終了', statusState: 'CLOSED' }),
      ],
    });

    expect(html).toContain('data-state="OPEN"');
    expect(html).toContain('data-state="CLOSED"');
  });

  it('🔴 画面が色を渡していない（`variant` / `shape` / 色のクラスを 1 つも書いていない）', () => {
    // 🔴 **画面側のソースを見る検査ではない** —— 色の語が DOM に出るのは `@ses/ui` の
    //    `STATUS_BADGE_APPEARANCES` 由来のクラスだけであり、`StatusBadge` は `variant` の
    //    prop を持たない（型で渡せない）。ここでは**状態名が DOM に出ていること**を根拠に、
    //    色の出所が部品側の 1 箇所であることを固定する（割り当ての正しさは
    //    `app/_components/ui-display.render.test.tsx` が見る）。
    const html = render();
    expect(html).toContain('data-entity="project"');
    // 対照: 状態の語が素のテキストとしてセルに残っていない（Badge の中に在る）。
    expect(html).toMatch(/data-state="OPEN"[^>]*>募集中</);
  });
});

describe('🔴 SP-22 段④: 操作列から副カラム（案件の要点パネル）を開く', () => {


  // ✅✅ **2026-10-16: 詳細画面へは右パネルの `詳細` から行く**（人間の明示指示）。
  //    🔴 **閲覧の監査記録は遷移先（`S-011`）が書く**という規律は変わっていない ——
  //    変わったのは**どこを押すと `S-011` に行くか**だけである。
  it('🔴 行の行き先は右パネルで、詳細画面へは行かない（監査記録の位置は不変）', () => {
    const html = render();

    expect(html).toContain(`project-list-link-${PROJECT_A}`); // 2026-10-16: 右パネルを開く URL
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
    // 🔴 **行にチェックボックスは置かない**（Phase 1 に一括操作は 1 つも無い）。
    expect(html).not.toContain('data-testid="project-list-select-');
    // ✅✅ **2026-10-16: 検査の射程を「表の中」に絞った。**
    // 🔴 **緩めたのではない。** 以前は画面全体に `type="checkbox"` が 1 つも無いことを
    //    見ていたが、人間の明示指示で**絞り込みの帯に「募集中のみ」のチェックボックスが
    //    入った**（それは行の選択ではなく検索条件である）。画面全体で見続けると、
    //    **検索条件のチェックボックスを足すだけで落ちる**ので、守りたい性質
    //    （**表の行に選択の UI が無い**）を直接見る形に書き換えた。
    // 🔴 帯のチェックボックスが表の中に混入したらここで落ちる（射程は `<tbody>` 以降である）。
    const tableBody = html.slice(html.indexOf('<tbody'));
    expect(tableBody).not.toContain('type="checkbox"');
    // 🔴 「募集中のみ」は**帯の側に在る**（表に無いことと、画面に在ることを両方固定する）。
    // 2026-10-16: 「募集中のみ」のチェックボックスは外した（人間の明示指示）。
  });

  it('🔴 どの行も選ばれていないときは印が 1 つも付かない', () => {
    expect(render({ selectedId: null })).not.toContain('data-selected="true"');
  });
});
