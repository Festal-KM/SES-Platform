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
  row({ id: DECLINED_ID, state: 'DECLINED', stateLabel: '辞退' }),
  row({ id: EXPIRED_ID, state: 'EXPIRED', stateLabel: '期限切れ' }),
  row({ id: WITHDRAWN_ID, state: 'WITHDRAWN_BY_HOST', stateLabel: '取り下げ' }),
];

const messages: ProposalRequestScreenMessages = {
  lead: '自社が送った提案依頼が表示されます。',
  filterLegend: '状態で絞り込む',
  filterState: '状態',
  filterApply: '絞り込む',
  columnProject: '案件',
  columnCandidate: '候補',
  columnCreatedAt: '依頼日',
  columnRemaining: '期限までの残り',
  columnState: '状態',
  columnUpdatedAt: '最終更新',
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
  withdrawConfirmCancel: 'やめる',
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
      { value: 'DECLINED', label: '辞退' },
      { value: 'WITHDRAWN_BY_HOST', label: '取り下げ' },
      { value: 'EXPIRED', label: '期限切れ' },
    ],
    stateValue: '',
    filtered: false,
    canAct: true,
    denialMessage: null,
    nowMs: NOW_MS,
    projectsHref: '/projects',
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
    expect(html).toMatch(new RegExp(`data-testid="proposal-request-state-${DECLINED_ID}"[^>]*>辞退<`));
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
