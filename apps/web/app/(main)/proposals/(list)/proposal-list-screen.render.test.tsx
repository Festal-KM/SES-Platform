// apps/web/app/(main)/proposals/(list)/proposal-list-screen.render.test.tsx
// `ProposalListScreen`（`S-019`）の描画テスト。T-09-09。
//
// 🔴 ここで固定するもの（「描かれていること / 描かれていないこと」が要件であり、API のテストでは示せない）:
//   ① `F-024 AC-2`: 14 状態のチップが**それぞれ独立**に描かれ、`GATE_FAILED` / `SUBMIT_FAILED` / `LOST` は `data-failure-kind` が別値。
//      提案依頼の `DECLINED` は**別ブロック**（`S-017` への導線）にだけ現れ、提案の表・チップには無い
//   ② docs/05 §10.4: 保留中の行は `data-send-hold="true"` + 保留の注記で、`SUBMIT_FAILED` の行（`data-failure-kind="SUBMIT_FAILED"`）と別の印
//   ③ `S-022` への導線は `summary.sendFailuresHref` があるときだけ
//   ④ 🔴 一括承認・一括送信・自動再送に相当する testid と語が無い（`BR-50`）
//   ⑤ 空状態（初回空 = 導線あり / 絞り込み 0 件 = 導線なし）
//
// 🔴 `react-dom/server` の `renderToStaticMarkup` を使う（他の render テストと同じ）。
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { PROPOSAL_REQUEST_STATES, PROPOSAL_STATES } from '@ses/domain';
import type {
  ProposalListRowView,
  ProposalListSummaryView,
  ProposalRequestStateChip,
  ProposalStateChip,
} from '../../../../lib/proposals/list-rows';
import { ProposalListScreen, type ProposalListScreenMessages, type ProposalListScreenProps } from './proposal-list-screen';

const FAILED_ID = '01930000-0000-7000-8000-000000000a01';
const HELD_ID = '01930000-0000-7000-8000-000000000a02';
const LOST_ID = '01930000-0000-7000-8000-000000000a03';

const STATE_LABELS: Record<string, string> = {
  DRAFT: '下書き',
  GATE_RUNNING: '検査中',
  GATE_FAILED: '差し戻し（検査で不合格）',
  APPROVAL_PENDING: '承認待ち',
  APPROVED: '承認済み',
  SUBMITTING: '送信中',
  SUBMITTED: '送信済み',
  SUBMIT_FAILED: '送信失敗',
  INTERVIEW_SCHEDULED: '面談日程調整中',
  INTERVIEWED: '面談実施済み',
  RESULT_PENDING: '結果待ち',
  WON: '決定',
  LOST: '見送り',
  WITHDRAWN: '辞退',
};

const REQUEST_LABELS: Record<string, string> = {
  REQUESTED: '返答待ち',
  ACCEPTED: '応諾',
  DECLINED: '依頼を辞退',
  WITHDRAWN_BY_HOST: '取り下げ',
  EXPIRED: '期限切れ',
};

function failureKindOf(state: string): 'GATE_FAILED' | 'SUBMIT_FAILED' | 'LOST' | null {
  return state === 'GATE_FAILED' || state === 'SUBMIT_FAILED' || state === 'LOST' ? state : null;
}

const stateChips: readonly ProposalStateChip[] = PROPOSAL_STATES.map((state) => ({
  state,
  label: STATE_LABELS[state] ?? state,
  count: state === 'SUBMIT_FAILED' ? 1 : 0,
  checked: state === 'SUBMIT_FAILED',
  indicator: state === 'GATE_FAILED' ? 'GATE_FAILURE' : state === 'SUBMIT_FAILED' ? 'DELIVERY_FAILURE' : 'IN_PROGRESS',
  failureKind: failureKindOf(state),
  tone: 'neutral',
}));

const requestChips: readonly ProposalRequestStateChip[] = PROPOSAL_REQUEST_STATES.map((state) => ({
  state,
  label: REQUEST_LABELS[state] ?? state,
  count: state === 'DECLINED' ? 2 : 0,
  href: `/proposal-requests?state=${state}`,
}));

function row(overrides: Partial<ProposalListRowView> & Pick<ProposalListRowView, 'id' | 'state'>): ProposalListRowView {
  return {
    href: `/proposals/${overrides.id}`,
    recipient: '架空エンド株式会社',
    engineer: '佐藤 花子',
    project: '基幹刷新',
    projectId: '01930000-0000-7000-8000-0000000000f1',
    stateLabel: STATE_LABELS[overrides.state] ?? overrides.state,
    tone: 'neutral',
    failureKind: failureKindOf(overrides.state),
    unitPrice: '650,000',
    createdBy: '担当 太郎',
    owner: 'Partner A1',
    updatedAt: '2026-09-16 10:00 JST',
    elapsed: '2 時間',
    inProgress: false,
    stuckSubmitting: false,
    hold: null,
    ...overrides,
  };
}

const rows: readonly ProposalListRowView[] = [
  row({ id: FAILED_ID, state: 'SUBMIT_FAILED' }),
  row({ id: HELD_ID, state: 'APPROVED', hold: { label: '送信を保留中', message: '送信元ドメインが未検証のため保留中です。' } }),
  row({ id: LOST_ID, state: 'LOST' }),
];

const summary: ProposalListSummaryView = {
  lead: 'この一覧には、自社と取引先が作成したすべての提案が表示されます。',
  total: '該当 3 件',
  sendFailuresHref: '/proposals/send-failures',
  sendFailuresLabel: '送信失敗の一覧へ',
};

const messages: ProposalListScreenMessages = {
  filterLegend: '絞り込み',
  filterStates: '提案の状態（複数選択可）',
  filterQ: '提案先・案件名で検索',
  filterApply: '絞り込む',
  filterClear: '条件を解除する',
  filterCountPrefix: '（',
  filterCountSuffix: '）',
  requestsTitle: '提案依頼（提案とは別の区分）',
  requestsLead: '提案依頼は、応諾されて提案が作成されるまで提案ではありません。',
  requestsOpen: '提案依頼の一覧を開く',
  columnRecipient: '提案先',
  columnEngineer: 'エンジニア',
  columnProject: '案件',
  columnState: '状態',
  columnUnitPrice: '単価',
  columnCreatedBy: '作成者',
  columnUpdatedAt: '最終更新',
  columnElapsed: '経過時間',
  inProgress: '進行中',
  stuckSubmitting: '送信中のまま 30 分以上経過しています。',
  emptyTitle: 'まだ提案がありません。',
  emptyLead: '案件の候補検索から提案を作成できます。',
  emptyOpenProjects: '案件一覧を開く',
  nextPage: '次のページ',
  firstPage: '最初のページに戻る',
};

function render(overrides: Partial<ProposalListScreenProps> = {}): string {
  const props: ProposalListScreenProps = {
    audience: 'HOST',
    rows,
    summary,
    stateChips,
    requestChips,
    requestsHref: '/proposal-requests',
    qValue: '',
    hiddenFilters: [],
    filtered: false,
    listHref: '/proposals',
    projectsHref: '/projects',
    nextPageHref: null,
    firstPageHref: null,
    messages,
    ...overrides,
  };
  return renderToStaticMarkup(createElement(ProposalListScreen, props));
}

describe('🔴 ① F-024 AC-2: 4 つの「うまくいかなかった」が別のチップ・別の区分', () => {
  it('14 状態のチップがそれぞれ描かれ、GATE_FAILED / SUBMIT_FAILED / LOST は data-failure-kind が別値', () => {
    const html = render();
    for (const state of PROPOSAL_STATES) {
      expect(html).toContain(`data-testid="proposal-list-state-chip-${state}"`);
    }
    expect(html).toMatch(/data-testid="proposal-list-state-chip-GATE_FAILED"[^>]*data-failure-kind="GATE_FAILED"/);
    expect(html).toMatch(/data-testid="proposal-list-state-chip-SUBMIT_FAILED"[^>]*data-failure-kind="SUBMIT_FAILED"/);
    expect(html).toMatch(/data-testid="proposal-list-state-chip-LOST"[^>]*data-failure-kind="LOST"/);
    expect(html).toMatch(/data-testid="proposal-list-state-chip-WITHDRAWN"[^>]*data-failure-kind=""/);
    // 語も別。
    expect(html).toContain('差し戻し（検査で不合格）');
    expect(html).toContain('送信失敗');
    expect(html).toContain('見送り');
    // 選択中のチップだけ checked。
    expect(html).toMatch(/data-testid="proposal-list-state-chip-SUBMIT_FAILED"[^>]*data-checked="true"/);
    expect(html).toMatch(/data-testid="proposal-list-state-chip-LOST"[^>]*data-checked="false"/);
  });

  it('🔴 提案依頼の DECLINED は別ブロック（S-017 への導線）にだけあり、提案のチップには無い。語は「依頼を辞退」', () => {
    const html = render();
    expect(html).toContain('data-testid="proposal-list-requests"');
    expect(html).toContain('data-testid="proposal-list-request-chip-DECLINED"');
    expect(html).toContain('依頼を辞退');
    expect(html).not.toContain('data-testid="proposal-list-state-chip-DECLINED"');
    expect(html).toMatch(/data-testid="proposal-list-request-chip-DECLINED"[^>]*href="\/proposal-requests\?state=DECLINED"/);
    // 提案の表の行に提案依頼の状態は載らない。
    expect(html).not.toMatch(/data-testid="proposal-list-row-[^"]+"[^>]*data-state="DECLINED"/);
  });
});

describe('🔴 ② docs/05 §10.4: 保留は SUBMIT_FAILED と別の印', () => {
  it('保留中の行は data-send-hold="true" + 注記、状態は承認済み。SUBMIT_FAILED の行は data-failure-kind="SUBMIT_FAILED" で保留の印が無い', () => {
    const html = render();
    expect(html).toMatch(new RegExp(`data-testid="proposal-list-row-${HELD_ID}"[^>]*data-state="APPROVED"[^>]*data-failure-kind=""[^>]*data-send-hold="true"`));
    expect(html).toContain(`data-testid="proposal-list-hold-${HELD_ID}"`);
    expect(html).toContain('送信を保留中');
    expect(html).toMatch(new RegExp(`data-testid="proposal-list-row-${FAILED_ID}"[^>]*data-state="SUBMIT_FAILED"[^>]*data-failure-kind="SUBMIT_FAILED"[^>]*data-send-hold=""`));
    expect(html).not.toContain(`data-testid="proposal-list-hold-${FAILED_ID}"`);
    expect(html).toMatch(new RegExp(`data-testid="proposal-list-row-${LOST_ID}"[^>]*data-failure-kind="LOST"`));
  });

  it('行 → S-023 の導線。作成会社（ホスト）が描かれる', () => {
    const html = render();
    expect(html).toMatch(new RegExp(`data-testid="proposal-list-link-${FAILED_ID}"[^>]*href="/proposals/${FAILED_ID}"|href="/proposals/${FAILED_ID}"[^>]*data-testid="proposal-list-link-${FAILED_ID}"`));
    expect(html).toContain('Partner A1');
  });
});

describe('③ S-022 への導線 / ④ 一括の語が無い / ⑤ 空状態', () => {
  it('sendFailuresHref があるときだけ S-022 への導線', () => {
    expect(render()).toContain('data-testid="proposal-list-open-send-failures"');
    expect(render({ summary: { ...summary, sendFailuresHref: null } })).not.toContain('data-testid="proposal-list-open-send-failures"');
  });

  it('🔴 一括承認・一括送信・自動再送・force / override に相当する testid と語が無い', () => {
    const html = render();
    expect(html).not.toMatch(/data-testid="[^"]*(bulk|force|override|auto-resend)[^"]*"/);
    expect(html).not.toMatch(/一括承認|一括送信|自動再送|無視して/);
  });

  it('初回空は導線つき、絞り込み 0 件は導線なしで条件の解除がある', () => {
    const initial = render({ rows: [], summary: { ...summary, sendFailuresHref: null } });
    expect(initial).toMatch(/data-testid="proposal-list-empty"[^>]*data-filtered="false"/);
    expect(initial).toContain('data-testid="proposal-list-empty-open-projects"');
    expect(initial).not.toContain('data-testid="proposal-list-table"');
    const filtered = render({
      rows: [],
      filtered: true,
      summary: { ...summary, sendFailuresHref: null },
      messages: { ...messages, emptyTitle: '条件に一致する提案はありません。', emptyLead: null, emptyOpenProjects: null },
    });
    expect(filtered).toMatch(/data-testid="proposal-list-empty"[^>]*data-filtered="true"/);
    expect(filtered).not.toContain('data-testid="proposal-list-empty-open-projects"');
    expect(filtered).toContain('data-testid="proposal-list-filter-clear"');
  });

  it('取引先の描画: audience が PARTNER、作成会社の列は無い', () => {
    const html = render({ audience: 'PARTNER', rows: rows.map((item) => ({ ...item, owner: null, hold: null })), summary: { ...summary, sendFailuresHref: null } });
    expect(html).toMatch(/data-testid="proposal-list-screen"[^>]*data-audience="PARTNER"/);
    expect(html).not.toContain('Partner A1');
    expect(html).not.toContain('data-testid="proposal-list-open-send-failures"');
  });
});
