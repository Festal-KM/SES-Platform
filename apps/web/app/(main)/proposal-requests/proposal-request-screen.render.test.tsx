// apps/web/app/(main)/proposal-requests/proposal-request-screen.render.test.tsx
// `ProposalRequestScreen`（`S-017`）の状態別描画テスト。T-08-06。
//
// 🔴 ここで固定するもの（「描かれていること / 描かれていないこと」が要件であり、API のテストでは示せない）:
//   ①ホストの行の候補列は「共有候補（匿名）」の一語で、依頼先の社名・`engineer_id`・辞退理由が描かれない（`F-018 AC-1`）
//   ②`DECLINED` / `EXPIRED` / `WITHDRAWN_BY_HOST` が別のバッジ文言で描かれる（`F-018 AC-5`）
//   ③取り下げの導線は「ホスト × REQUESTED × 実行可」のときだけ。取引先・`VIEWER`・停止中には無い
//   ④取引先の行には `S-018`（応諾・辞退）への導線があり、ホストの行には無い（T-08-07。押しても動かない応諾・辞退ボタンは描かない）
//   ⑤残り時間はサーバ時刻（`nowMs`）で描かれる（hydration の不一致を作らない）
//
// 🔴 `react-dom/server` の `renderToStaticMarkup` を使う（他の render テストと同じ）。
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { ProposalRequestRowView } from '../../../lib/proposal-requests/list-rows';
import {
  ProposalRequestScreen,
  type ProposalRequestScreenMessages,
  type ProposalRequestScreenProps,
} from './proposal-request-screen';

const NOW_MS = Date.parse('2026-09-15T03:00:00.000Z');
const PROJECT = '01930000-0000-7000-8000-0000000000f1';
const REQUESTED_ID = '01930000-0000-7000-8000-000000000201';
const DECLINED_ID = '01930000-0000-7000-8000-000000000202';
const EXPIRED_ID = '01930000-0000-7000-8000-000000000203';
const WITHDRAWN_ID = '01930000-0000-7000-8000-000000000204';

function row(overrides: Partial<ProposalRequestRowView> & Pick<ProposalRequestRowView, 'id' | 'state'>): ProposalRequestRowView {
  return {
    projectId: PROJECT,
    projectName: '架空案件',
    candidate: '共有候補（匿名）',
    stateLabel: overrides.state,
    createdAt: '2026-09-15 10:00 JST',
    expiresAtIso: '2026-09-22T14:59:59.000Z',
    expiresAt: '2026-09-22 23:59 JST',
    updatedAt: '2026-09-15 10:00 JST',
    message: '11 月開始を希望します。',
    canWithdraw: overrides.state === 'REQUESTED',
    respondHref: null,
    ...overrides,
  };
}

const rows: readonly ProposalRequestRowView[] = [
  row({ id: REQUESTED_ID, state: 'REQUESTED', stateLabel: '返答待ち' }),
  row({ id: DECLINED_ID, state: 'DECLINED', stateLabel: '依頼を辞退' }),
  row({ id: EXPIRED_ID, state: 'EXPIRED', stateLabel: '期限切れ' }),
  row({ id: WITHDRAWN_ID, state: 'WITHDRAWN_BY_HOST', stateLabel: '取り下げ' }),
];

const messages: ProposalRequestScreenMessages = {
  lead: '自社が送った提案依頼が表示されます。',
  // ✅ SP-22 段④: 件数バー（母集団 + 並び順の説明）。🔴 **母集団に件数を入れない**（`HANDOFF.md` §3.3）。
  population: '自社が送った提案依頼',
  orderNote: '依頼日の新しい順に表示しています。',
  overflowNote: '右端が切れているときは、表を横にスクロールすると残りの列が見られます。',
  filterLegend: '状態で絞り込む',
  filterState: '状態',
  filterApply: '絞り込む',
  columnProject: '案件',
  columnCandidate: '候補',
  columnCreatedAt: '依頼日',
  columnRemaining: '期限までの残り',
  columnState: '状態',
  columnUpdatedAt: '最終更新',
  columnAction: '操作',
  panelOpen: '内容を見る',
  emptyTitle: '提案依頼はまだありません。',
  emptyLead: '案件の候補検索で共有候補を選ぶと、提案依頼を送れます。',
  emptyOpenProjects: '案件一覧を開く',
  detailTitle: '選択した依頼',
  detailSelect: '行を選ぶと、ここに依頼の内容を表示します。',
  detailMessage: '依頼メッセージ',
  detailExpiresAt: '返答期限',
  detailCreatedAt: '依頼日時',
  detailUpdatedAt: '最終更新',
  detailOpenProject: '案件詳細を開く',
  partnerRespond: 'この依頼に返答する',
  withdraw: '取り下げる',
  withdrawConfirmTitle: 'この提案依頼を取り下げますか',
  withdrawConfirmLead: '取り下げると、取引先はこの依頼に応諾できなくなります。',
  withdrawConfirmSubmit: '取り下げる',
  withdrawConfirmCancel: 'キャンセル',
  withdrawSubmitting: '取り下げています…',
  withdrawError: '取り下げられませんでした。',
  withdrawErrorState: 'この依頼は既に返答待ちではありません。',
  deniedTitle: '提案依頼の操作を行えません。',
  remaining: { prefix: '残り ', days: ' 日', hours: ' 時間', minutes: ' 分', lessThanMinute: '1 分未満', expired: '期限を過ぎました' },
  remainingNone: '—',
  nextPage: '次のページ',
  firstPage: '最初のページに戻る',
};

function render(overrides: Partial<ProposalRequestScreenProps> = {}): string {
  const props: ProposalRequestScreenProps = {
    rows,
    stateOptions: [
      { value: '', label: 'すべて' },
      { value: 'REQUESTED', label: '返答待ち' },
      { value: 'ACCEPTED', label: '応諾' },
      { value: 'DECLINED', label: '依頼を辞退' },
      { value: 'WITHDRAWN_BY_HOST', label: '取り下げ' },
      { value: 'EXPIRED', label: '期限切れ' },
    ],
    stateValue: '',
    filtered: false,
    canAct: true,
    denialMessage: null,
    nowMs: NOW_MS,
    projectsHref: '/projects',
    listHref: '/proposal-requests',
    nextPageHref: null,
    firstPageHref: null,
    messages,
    ...overrides,
  };
  return renderToStaticMarkup(createElement(ProposalRequestScreen, props));
}

describe('🔴 F-018 AC-1 / AC-5: ホストの一覧', () => {
  it('4 行が別々の状態バッジで描かれ、候補列は「共有候補（匿名）」の一語', () => {
    const html = render();
    for (const id of [REQUESTED_ID, DECLINED_ID, EXPIRED_ID, WITHDRAWN_ID]) {
      expect(html).toContain(`data-testid="proposal-request-row-${id}"`);
    }
    expect(html).toMatch(new RegExp(`data-testid="proposal-request-state-${REQUESTED_ID}"[^>]*>返答待ち<`));
    expect(html).toMatch(new RegExp(`data-testid="proposal-request-state-${DECLINED_ID}"[^>]*>依頼を辞退<`));
    expect(html).toMatch(new RegExp(`data-testid="proposal-request-state-${EXPIRED_ID}"[^>]*>期限切れ<`));
    expect(html).toMatch(new RegExp(`data-testid="proposal-request-state-${WITHDRAWN_ID}"[^>]*>取り下げ<`));
    expect(html.match(/共有候補（匿名）/g)?.length).toBe(4);
    // 🔴 辞退理由・依頼先の社名に相当する語が無い（型に無いので描けない）。
    for (const word of ['辞退理由', '理由', 'Partner A1', 'partnerCompany', 'engineerId', 'declineReason']) {
      expect(html).not.toContain(word);
    }
  });

  it('残り時間はサーバ時刻で描かれ（7 日）、終端状態は `—`', () => {
    const html = render();
    expect(html).toMatch(new RegExp(`data-testid="proposal-request-remaining-${REQUESTED_ID}"[^>]*>残り 7 日<`));
    expect(html).toMatch(new RegExp(`data-testid="proposal-request-remaining-${DECLINED_ID}"[^>]*>—<`));
  });

  it('状態フィルタは 6 択（すべて + 5 状態）で、「失効」のような畳んだ選択肢が無い', () => {
    const html = render();
    expect(html).toContain('data-testid="proposal-request-filter-state"');
    expect(html.match(/<option/g)?.length).toBe(6);
    expect(html).not.toContain('失効');
  });

  it('初期状態では詳細パネルは「行を選ぶと…」だけで、取り下げボタンが無い（選択後に出る）', () => {
    const html = render();
    expect(html).toContain('data-testid="proposal-request-detail-empty"');
    expect(html).not.toContain('proposal-request-withdraw');
  });
});

describe('🔴 取り下げの導線と停止中の表示', () => {
  it('停止中（denialMessage）はホストの発行ロールに理由が出る。取引先・VIEWER（canAct=false）には出ない', () => {
    expect(render({ denialMessage: 'この組織は現在停止中です。' })).toContain('data-testid="proposal-request-denied"');
    expect(render({ canAct: false, denialMessage: 'この組織は現在停止中です。' })).not.toContain('proposal-request-denied');
  });
});

describe('取引先視点と空状態', () => {
  it('取引先の行は自社エンジニアの実名で、S-018 への導線は選択後にだけ出る（初期状態では無い。ホストの行には無い）', () => {
    const html = render({
      canAct: false,
      rows: [
        row({
          id: REQUESTED_ID,
          state: 'REQUESTED',
          stateLabel: '返答待ち',
          candidate: '山田 太郎',
          canWithdraw: false,
          respondHref: `/proposal-requests/${REQUESTED_ID}`,
        }),
      ],
    });
    expect(html).toContain('山田 太郎');
    expect(html).not.toContain('proposal-request-withdraw');
    // 🔴 押しても動かない応諾・辞退ボタンが無い（応諾・辞退は `S-018` で行う。T-08-07）。
    expect(html).not.toContain('応諾する');
    expect(html).not.toContain('辞退する');
    // 🔴 初期状態（未選択）では導線が描かれない（詳細パネルは「行を選ぶと…」）。
    expect(html).not.toContain('proposal-request-detail-respond');
    // 🔴 ホストの行（`respondHref: null`）には導線が無い（`S-018` に到達しない。`docs/04` §S-018 権限差分）。
    expect(render()).not.toContain('proposal-request-detail-respond');
  });

  it('ホストの初回空は説明 + 案件一覧への導線、絞込 0 件は導線なし、取引先は事実だけ', () => {
    const hostEmpty = render({ rows: [] });
    expect(hostEmpty).toContain('data-testid="proposal-request-empty"');
    expect(hostEmpty).toContain('data-testid="proposal-request-empty-open-projects"');
    expect(hostEmpty).not.toContain('proposal-request-table');

    const filtered = render({
      rows: [],
      filtered: true,
      messages: { ...messages, emptyTitle: '条件に一致する依頼はありません。', emptyLead: null, emptyOpenProjects: null },
    });
    expect(filtered).toContain('条件に一致する依頼はありません。');
    expect(filtered).not.toContain('proposal-request-empty-open-projects');

    const partnerEmpty = render({
      rows: [],
      canAct: false,
      messages: { ...messages, emptyTitle: '返答が必要な提案依頼はありません。', emptyLead: null, emptyOpenProjects: null },
    });
    expect(partnerEmpty).toContain('返答が必要な提案依頼はありません。');
    // 🔴 煽らない（「共有すると…」「機会を逃さない」に相当する語が無い）。
    expect(partnerEmpty).not.toContain('機会');
  });

  it('ページングは「全 N ページ中 M ページ目」を描かない', () => {
    const html = render({ nextPageHref: `/proposal-requests?cursor=${WITHDRAWN_ID}`, firstPageHref: '/proposal-requests' });
    expect(html).toContain('data-testid="proposal-request-next"');
    expect(html).toContain('data-testid="proposal-request-first"');
    expect(html).not.toMatch(/ページ目/);
  });
});

// ============================================================================
// ✅ SP-22 段④（提案まわりの刷新。2026-10-03）
// ============================================================================
// 🔴 ここで固定するのは「**色を画面が決めていないこと**」と「**母集団に件数が無いこと**」である。
//    どちらも旧実装で実際に破れていた（`EXPIRED` が障害色の赤 / 母集団の 1 行が無い）。
describe('🔴 SP-22 段④: 状態バッジは `StatusBadge`（色は状態名から決まる）', () => {
  /** その testid を持つタグの属性文字列。 */
  function tagOf(html: string, testId: string): string {
    return new RegExp(`<[^>]*data-testid="${testId}"[^>]*>`).exec(html)?.[0] ?? '';
  }

  it('5 状態すべてが `entity="proposalRequest"` + 自分の `data-state` を持つ', () => {
    const html = render();
    for (const [id, state] of [
      [REQUESTED_ID, 'REQUESTED'],
      [DECLINED_ID, 'DECLINED'],
      [EXPIRED_ID, 'EXPIRED'],
      [WITHDRAWN_ID, 'WITHDRAWN_BY_HOST'],
    ] as const) {
      const tag = tagOf(html, `proposal-request-state-${id}`);
      expect(tag, id).toContain('data-entity="proposalRequest"');
      expect(tag, id).toContain(`data-state="${state}"`);
    }
  });

  it('🔴 障害色（赤）を 1 つも使わない —— `docs/04` §5-1「赤・塗りは `SUBMIT_FAILED` / `SEND_FAILED` / `SUSPENDED` のみ」', () => {
    // 旧実装は `EXPIRED: 'danger'`（赤）だった。期限切れは業務的な終わりであり外部で事故は起きていない。
    const html = render();
    for (const id of [REQUESTED_ID, DECLINED_ID, EXPIRED_ID, WITHDRAWN_ID]) {
      expect(tagOf(html, `proposal-request-state-${id}`), id).not.toMatch(/danger/);
    }
  });

  it('🔴 `EXPIRED` は点線枠、`DECLINED` / `WITHDRAWN_BY_HOST` は実線枠（§5-1 の形状で区別する）', () => {
    const html = render();
    expect(tagOf(html, `proposal-request-state-${EXPIRED_ID}`)).toContain('border-dashed');
    expect(tagOf(html, `proposal-request-state-${DECLINED_ID}`)).not.toContain('border-dashed');
    expect(tagOf(html, `proposal-request-state-${WITHDRAWN_ID}`)).not.toContain('border-dashed');
  });

  it('🔴 件数バーの母集団に数字が 1 文字も無い（件数は他社情報の示唆になりうる）', () => {
    const html = render();
    const population = /<p[^>]*data-testid="proposal-request-toolbar-population"[^>]*>([^<]*)</.exec(html)?.[1] ?? '';
    expect(population).not.toBe('');
    expect(population).not.toMatch(/[0-9０-９]/);
  });

  it('操作列（`内容を見る`）が全行に在り、行クリックの選択も残っている', () => {
    const html = render();
    for (const id of [REQUESTED_ID, DECLINED_ID, EXPIRED_ID, WITHDRAWN_ID]) {
      expect(html).toContain(`data-testid="proposal-request-panel-open-${id}"`);
    }
    expect(html).toMatch(new RegExp(`data-testid="proposal-request-row-${REQUESTED_ID}"`));
    expect(html).toContain('role="button"');
  });
});

// ============================================================================
// 🔴 ✅ 2026-10-03: **1 文字ずつ縦に折り返す事故の再発防止**（デモ巡回で発見）
// ============================================================================
// **何が起きていたか（1280px の実測）**: 本画面は幅クラス B であり、右パネル 400px により
// 表の器が **582px** になる。`table-layout: auto` の下で **`whitespace-nowrap` の日時列
// （`2026-09-23 11:11 JST` = 約 149px）が折り返さずに幅を確保し続け、折り返してよい
// テキスト列（案件 / 候補）だけが min-content まで潰れた。** 日本語の min-content は 1 文字な
// ので、「業務システムのクラウド移行」が **1 文字 1 行で 10 行**になり、行の高さが 160〜180px に
// 膨らんで表として読めなかった。🔴 **1920px では再現しない**（器が広く潰れない）。
//
// 🔴 **`renderToStaticMarkup` は幅を測れない。** 固定するのは「潰れないための構造的な条件」=
//    **折り返してよい列（`whitespace-normal`）が必ず下限幅（`min-w-*`）を持つこと**である。
//    これは「列定義の最小幅を見る」という形であり、**実測値そのものではなく再発の経路を塞ぐ**。
describe('🔴 テキスト列の下限幅（1 文字折り返しの再発防止）', () => {
  /** `<td ... class="...">` の class 属性を列の出現順に取り出す。 */
  function cellClasses(html: string, rowId: string): readonly string[] {
    const start = html.indexOf(`data-testid="proposal-request-row-${rowId}"`);
    expect(start, rowId).toBeGreaterThan(-1);
    const rowHtml = html.slice(start, html.indexOf('</tr>', start));
    return rowHtml
      .split('<td')
      .slice(1)
      .map((cell) => /class="([^"]*)"/.exec(cell)?.[1] ?? '');
  }

  it('🔴 `whitespace-normal` のセルは必ず `min-w-*` を持つ（下限の無い折り返し列を作らない）', () => {
    const html = render();
    for (const id of [REQUESTED_ID, DECLINED_ID, EXPIRED_ID, WITHDRAWN_ID]) {
      for (const classes of cellClasses(html, id)) {
        if (!classes.includes('whitespace-normal')) continue;
        expect(classes, `下限幅の無い折り返しセル: ${classes}`).toMatch(/(?:^|\s)min-w-\d/);
      }
    }
  });

  it('🔴 案件名の列は `docs/04` §10.3 の名称列の下限（10rem = `min-w-40`）を持つ', () => {
    const html = render();
    const projectCell = new RegExp(
      `<td class="([^"]*)"[^>]*data-testid="proposal-request-project-${REQUESTED_ID}"`,
    ).exec(html);
    expect(projectCell?.[1]).toContain('min-w-40');
    // 列ヘッダ側にも同じ下限を置く（`table-layout: auto` は `<th>` の幅も列幅に効く）。
    expect(html).toMatch(/<th class="[^"]*min-w-40[^"]*"[^>]*>案件</);
  });

  it('🔴 日時列は折り返さないまま（`nowrap`）—— 全行の高さを上げる直し方を採っていない', () => {
    const html = render();
    const classes = cellClasses(html, REQUESTED_ID);
    // 依頼日 / 最終更新 のセル（`whitespace-nowrap`）が現に在る。
    expect(classes.filter((value) => value.includes('whitespace-nowrap')).length).toBeGreaterThan(0);
  });

  it('🔴 副カラムの並置は `2xl` から（1280px で主カラムを 1,008px にする）', () => {
    const html = render();
    expect(html).toContain('2xl:flex-row');
    expect(html).not.toContain('lg:flex-row');
  });

  it('🔴 列が器に収まらないときの導線が語で示されている（`Table` の `overflowNote`）', () => {
    const html = render();
    expect(html).toContain('data-table-overflow-note');
    expect(html).toContain(messages.overflowNote);
  });
});
