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
    approvalQueue: false,
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
    // ⚠️ **T-22-06 で判定の形を追随させた（緩めていない）**: `@ses/ui` の `DataTable` は空状態を
    //    **表の中の 1 行**（`proposal-list-empty-row` の `colSpan`）として描く契約である
    //    （`docs/05` §2.3.5 の `empty`）。🔴 守るべき中身は「**データ行が 0 であること**」なので、
    //    それを直接見る（列ヘッダは骨格として残るのが部品の契約）。
    expect(initial).toContain('data-testid="proposal-list-empty-row"');
    expect(initial).not.toContain('data-testid="proposal-list-row-');
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

// ============================================================================
// 🔴 T-22-06: 列の集合・並び・ブレークポイントが**移行前と同一**である（受け入れ基準 2）
// ============================================================================
// 🔴 **整形のついでに列を足さない / 落とさない。** `hidden lg:table-cell` の直書きを列定義の
//    `priority` に移しただけであり、DOM に出る列と消える境界は 1 つも変わっていない
//    （§S-019「デバイス別」= モバイル 4 / タブレット 6 / デスクトップ 8）。
//
// | 列 | 移行前のクラス | 移行後の `priority` |
// |---|---|---|
// | 状態 | （常時） | `always` |
// | エンジニア | （常時） | `always` |
// | 提案先 | （常時） | `always` |
// | 案件 | `hidden sm:table-cell` | `sm` |
// | 単価 | `hidden sm:table-cell` | `sm` |
// | 作成者 | `hidden lg:table-cell` | `lg` |
// | 最終更新 | `hidden lg:table-cell` | `lg` |
// | 経過時間 | （常時） | `always` |
describe('🔴 T-22-06: 列の契約（移行前と同一。増減 0）', () => {
  function headerColumns(html: string): { readonly id: string; readonly breakpoint: string }[] {
    const head = /<thead[^>]*>(.*?)<[/]thead>/s.exec(html)?.[1] ?? '';
    return [...head.matchAll(/<th ([^>]*)>/g)].map((match) => {
      const attributes = match[1] ?? '';
      const id = /data-column-id="([^"]+)"/.exec(attributes)?.[1] ?? '?';
      const classes = /class="([^"]*)"/.exec(attributes)?.[1] ?? '';
      const breakpoint = classes.includes('hidden lg:table-cell')
        ? 'lg'
        : classes.includes('hidden sm:table-cell')
          ? 'sm'
          : 'always';
      return { id, breakpoint };
    });
  }

  it('8 列。並びと境界が移行前と一致する（ホスト / 取引先で同じ列）', () => {
    const expected = [
      { id: 'state', breakpoint: 'always' },
      { id: 'engineer', breakpoint: 'always' },
      { id: 'recipient', breakpoint: 'always' },
      { id: 'project', breakpoint: 'sm' },
      { id: 'unitPrice', breakpoint: 'sm' },
      { id: 'createdBy', breakpoint: 'lg' },
      { id: 'updatedAt', breakpoint: 'lg' },
      { id: 'elapsed', breakpoint: 'always' },
    ];
    expect(headerColumns(render())).toEqual(expected);
    // 🔴 取引先も同じ 8 列である（違うのは行の中身 = 作成会社の 1 行が無いこと）。
    expect(headerColumns(render({ audience: 'PARTNER', rows: rows.map((item) => ({ ...item, owner: null, hold: null })) }))).toEqual(
      expected,
    );
  });

  it('🔴 モバイル（`sm` 未満）に残るのは 4 列（状態 / エンジニア / 提案先 / 経過時間）', () => {
    const always = headerColumns(render()).filter((column) => column.breakpoint === 'always');
    expect(always.map((column) => column.id)).toEqual(['state', 'engineer', 'recipient', 'elapsed']);
  });

  it('🔴 `U-18`: 行選択のチェックボックスと一括承認のボタンを 1 つも描かない（Phase 1）', () => {
    const html = render();
    // `DataTable` の選択列（`selection`）を渡していない = 選択のチェックボックスが存在しない。
    expect(html).not.toContain('data-testid="proposal-list-select-');
    // 一括操作の置き場所（`Toolbar` の `bulkActions`）も渡していない。
    expect(html).not.toContain('data-testid="proposal-list-toolbar-bulk"');
    // 🔴 状態の絞り込みはフィルタであってタブではない（§10.3「多数タブ」）。
    expect(html).not.toContain('role="tablist"');
  });
});

// ============================================================================
// ✅ SP-22 段④（提案まわり。2026-10-03）: 状態バッジを `StatusBadge` に寄せた
// ============================================================================
// 🔴 **3 つの「うまくいかなかった」が同じ見た目にならないこと**を固定する。
//    着手時の実装は `row.tone`（5 値）を `BadgeVariant` に写していたため、
//    **`GATE_FAILED` と `SUBMIT_FAILED` が同じ赤**だった ——
//    `CLAUDE.md` §4.2「すべて別の状態」/ `docs/04` §5-1「赤・塗りは `SUBMIT_FAILED` /
//    `SEND_FAILED` / `SUSPENDED` のみ。ゲート差し戻しは橙」に反する。
//    色は `@ses/ui` の `StatusBadge`（`STATUS_BADGE_APPEARANCES`）が状態名から決め、画面は渡せない。
describe('🔴 SP-22 段④: `GATE_FAILED` / `SUBMIT_FAILED` / `LOST` は 3 つ別の見た目である', () => {
  const GATE_FAILED_ID = '01930000-0000-7000-8000-000000000a04';

  /** その行の状態バッジのタグ（属性文字列）。 */
  function badgeTag(html: string, id: string): string {
    return new RegExp(`<[^>]*data-testid="proposal-list-state-${id}"[^>]*>`).exec(html)?.[0] ?? '';
  }

  const threeRows: readonly ProposalListRowView[] = [
    row({ id: GATE_FAILED_ID, state: 'GATE_FAILED' }),
    row({ id: FAILED_ID, state: 'SUBMIT_FAILED' }),
    row({ id: LOST_ID, state: 'LOST' }),
  ];

  it('`entity="proposal"` と、それぞれ自分の `data-state` を持つ', () => {
    const html = render({ rows: threeRows });
    expect(badgeTag(html, GATE_FAILED_ID)).toContain('data-entity="proposal"');
    expect(badgeTag(html, GATE_FAILED_ID)).toContain('data-state="GATE_FAILED"');
    expect(badgeTag(html, FAILED_ID)).toContain('data-state="SUBMIT_FAILED"');
    expect(badgeTag(html, LOST_ID)).toContain('data-state="LOST"');
  });

  it('🔴 3 つのバッジのクラス文字列が互いに異なる（= 同じ見た目ではない）', () => {
    const html = render({ rows: threeRows });
    const classOf = (id: string): string => /class="([^"]*)"/.exec(badgeTag(html, id))?.[1] ?? '';
    const classes = [classOf(GATE_FAILED_ID), classOf(FAILED_ID), classOf(LOST_ID)];
    for (const value of classes) expect(value).not.toBe('');
    expect(new Set(classes).size).toBe(3);
  });

  it('🔴 赤（`danger`）は `SUBMIT_FAILED` だけ。`GATE_FAILED` は橙、`LOST` は無彩色（§5-1）', () => {
    const html = render({ rows: threeRows });
    expect(badgeTag(html, FAILED_ID)).toContain('danger');
    expect(badgeTag(html, GATE_FAILED_ID)).not.toContain('danger');
    expect(badgeTag(html, GATE_FAILED_ID)).toContain('warning');
    expect(badgeTag(html, LOST_ID)).not.toContain('danger');
    expect(badgeTag(html, LOST_ID)).not.toContain('warning');
  });
});
