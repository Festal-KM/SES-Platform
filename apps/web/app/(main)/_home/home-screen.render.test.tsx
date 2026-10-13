// apps/web/app/(main)/_home/home-screen.render.test.tsx
// 🔴 ホームの新フレーム（`docs/04` §4.1 / §3.4 / §7.2 の改訂 23。人間のモックアップ）。2026-10-02。
//
// 固定するもの:
//   ① 🔴 **挨拶行 → KPI カード 4 枚 → ✅ 0 → タブ → セクション**の順（画面の骨格）
//   ② 🔴 **KPI は 4 枚で、横スクロールにしない**（`md` 未満は 2×2 のグリッド。1 枚も落とさない）
//   ③ 🔴 **タブは 3 つ**（`メッセージ` を置かない = 実体が無いタブを先に置かない）
//   ④ 🔴 **右レールの「先に動くもの」は要対応キューと同じ 1 本のデータの上位 3 件**で、
//      **順はキューと同一**。🔴 **実行系の導線を持たない**（`href` も `onClick` も無い）
//   ⑤ 🔴 **匿名の行は右レールでも匿名のまま**（経路 4。`CLAUDE.md` §3.1 / §7）
//   ⑥ 🔴 **基準時刻（`◯時◯分 時点`）が画面に在る**（更新したことが読める唯一の場所）
//   ⑦ 🔴 **初回空では KPI・タブ・右レールを描かない**（`0` が 4 個並ぶ画面を作らない）
//   ⑧ 🔴 **今日の予定を架空のデータで埋めない**（0 件は専用の 1 行）
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ACTION_QUEUE_ACTION_KINDS } from '../../../lib/home/action-availability';
import type {
  ActionQueueHomeBlock,
  ActionQueueRow,
  FollowUpHomeBlock,
  SummaryHomeBlock,
} from '../../../lib/home/types';
import type { ActionQueueMessages } from './action-queue-section';
import {
  asOfLabel,
  greetingLead,
  HOME_PRIORITY_ITEM_COUNT,
  HomeScreen,
  priorityItems,
} from './home-screen';
import type { HomeScreenMessages } from './home-props';

const NOW = '2026-10-02T03:00:00.000Z';

const MESSAGES: HomeScreenMessages = {
  greeting: {
    slots: { MORNING: 'おはようございます、', AFTERNOON: 'こんにちは、', EVENING: 'お疲れさまです、' },
    nameSuffix: 'さん',
    leadNone: 'LEAD_NONE',
    leadPrefix: 'LEAD_PREFIX(',
    leadSuffix: ')LEAD_SUFFIX',
    asOfSuffix: ' 時点',
    asOfNote: 'ASOF_NOTE',
    asOfSeparator: ' / ',
  },
  kpi: {
    labels: {
      ACTION_QUEUE: 'KPI_ACTION_QUEUE',
      AWAITING_REPLY: 'KPI_AWAITING_REPLY',
      INTERVIEWS: 'KPI_INTERVIEWS',
      PROPOSALS_THIS_WEEK: 'KPI_PROPOSALS_THIS_WEEK',
    },
    unit: '件',
    allZero: 'KPI_ALL_ZERO',
    delta: {
      increase: '↑ +',
      decrease: '↓ −',
      unchanged: '±0',
      basis: { PREVIOUS_DAY: '（昨日比）', PREVIOUS_WEEK: '（先週比）' },
    },
  },
  tabs: {
    label: 'TABS',
    // ✅ 2026-10-11: 4 タブ目。
    messages: 'TAB_MESSAGES',
    actions: 'TAB_ACTIONS',
    projects: 'TAB_PROJECTS',
    engineers: 'TAB_ENGINEERS',
  },
  rail: {
    scheduleTitle: 'RAIL_SCHEDULE',
    scheduleEmpty: 'RAIL_SCHEDULE_EMPTY',
    priorityTitle: 'RAIL_PRIORITY',
    priorityEmpty: 'RAIL_PRIORITY_EMPTY',
    onePointTitle: 'RAIL_ONE_POINT',
    onePointLines: ['TIP_1', 'TIP_2', 'TIP_3'],
    onePointDismiss: 'RAIL_ONE_POINT_DISMISS',
  },
  seeAll: 'SEE_ALL',
  // ✅ 2026-10-11: `要対応` タブのセクション 2〜4 の語。
  sections: {
    AWAITING_REPLY: { title: 'SEC_AWAITING', lead: 'SEC_AWAITING_LEAD', empty: 'SEC_AWAITING_EMPTY' },
    INTERVIEW_COORDINATION: {
      title: 'SEC_INTERVIEW',
      lead: 'SEC_INTERVIEW_LEAD',
      empty: 'SEC_INTERVIEW_EMPTY',
    },
    PROPOSAL_FOLLOW_UP: { title: 'SEC_FOLLOW_UP', lead: 'SEC_FOLLOW_UP_LEAD', empty: 'SEC_FOLLOW_UP_EMPTY' },
  },
};

const QUEUE_MESSAGES: ActionQueueMessages = {
  title: 'QUEUE_TITLE',
  lead: 'QUEUE_LEAD',
  empty: 'QUEUE_EMPTY',
  scopeLegend: 'SCOPE',
  scopeMine: 'MINE',
  scopeAll: 'ALL',
  columnKind: 'C_KIND',
  columnSubject: 'C_SUBJECT',
  columnCounterparty: 'C_COUNTERPARTY',
  columnTime: 'C_TIME',
  columnDeadline: 'C_DEADLINE',
  columnState: 'C_STATE',
  columnAction: 'C_ACTION',
  kinds: {
    SEND_FAILED: 'KIND_SEND_FAILED',
    APPROVAL_PENDING: 'KIND_APPROVAL_PENDING',
    GATE_FAILED: 'KIND_GATE_FAILED',
    SEND_HELD: 'KIND_SEND_HELD',
    PROPOSAL_REQUEST_PENDING: 'KIND_REQUEST',
    AWAITING_REPLY: 'KIND_AWAITING_REPLY',
    INTERVIEW_COORDINATION: 'KIND_INTERVIEW',
    PROPOSAL_FOLLOW_UP: 'KIND_FOLLOW_UP',
  },
  actions: {
    APPROVE: 'A_APPROVE',
    FIX: 'A_FIX',
    RESEND: 'A_RESEND',
    RESPOND: 'A_RESPOND',
    RECORD: 'A_RECORD',
  },
  priorities: { HIGH: 'PRIORITY_HIGH', MEDIUM: 'PRIORITY_MEDIUM', LOW: 'PRIORITY_LOW' },
  priorityNote: 'PRIORITY_NOTE',
  denied: { 'home.actionQueue.denied.role': 'DENIED_ROLE' },
  proposalStates: { APPROVAL_PENDING: 'S_APPROVAL_PENDING' },
  proposalRequestStates: { REQUESTED: 'S_REQUESTED' },
  openRequestList: 'OPEN_REQUESTS',
  drawer: {
    open: 'DRAWER_OPEN',
    close: 'DRAWER_CLOSE',
    fieldSubject: 'F_SUBJECT',
    fieldCounterparty: 'F_COUNTERPARTY',
    fieldState: 'F_STATE',
    fieldTime: 'F_TIME',
    fieldDeadline: 'F_DEADLINE',
    detailLink: 'D_DETAIL',
    historyLabel: 'D_HISTORY',
    historyLoading: 'D_LOADING',
    historyFailed: 'D_FAILED',
    valueNone: 'NONE',
    history: {
      kinds: {
        CREATED: 'K_CREATED',
        TRANSITION: 'K_TRANSITION',
        REJECT: 'K_REJECT',
        APPROVAL: 'K_APPROVAL',
        RESEND: 'K_RESEND',
        SEND_FAILURE: 'K_SEND_FAILURE',
        DRAFT_UPDATED: 'K_DRAFT_UPDATED',
        NOTE: 'K_NOTE',
        OTHER: 'K_OTHER',
      },
      states: { APPROVAL_PENDING: 'S_APPROVAL_PENDING' },
      arrow: ' → ',
      valueNone: 'NONE',
    },
  },
  valueNone: '—',
  changed: 'CHANGED',
  pollError: 'POLL_ERROR',
  elapsed: { justNow: 'JUST_NOW', minutesSuffix: 'm', hoursSuffix: 'h', daysSuffix: 'd', none: 'NONE' },
  remaining: { prefix: 'R', days: 'd', hours: 'h', minutes: 'm', lessThanMinute: 'lt1m', expired: 'EXPIRED' },
};

function row(kind: ActionQueueRow['kind'], targetId: string, overrides: Partial<ActionQueueRow> = {}): ActionQueueRow {
  return {
    kind,
    targetId,
    subjectLabel: `subject-${targetId}`,
    counterpartyLabel: `counterparty-${targetId}`,
    since: '2026-10-01T03:00:00.000Z',
    deadline: null,
    rowVersion: Date.parse('2026-10-01T03:00:00.000Z'),
    href: `/target/${targetId}`,
    stateBadge: { entity: 'PROPOSAL', state: 'APPROVAL_PENDING' },
    action: { kind: 'APPROVE', href: `/target/${targetId}/approve` },
    ...overrides,
  };
}

const ROWS: readonly ActionQueueRow[] = [
  row('SEND_FAILED', 's1'),
  row('APPROVAL_PENDING', 'a1'),
  row('GATE_FAILED', 'g1'),
  row('SEND_HELD', 'h1'),
  // 🔴 ホストの `提案依頼の返答待ち`: 対象は案件名 + 匿名の語、相手は `null`、操作は無い（経路 4）。
  row('PROPOSAL_REQUEST_PENDING', 'r1', {
    subjectLabel: 'Project X / 共有候補（匿名）',
    counterpartyLabel: null,
    deadline: '2026-10-03T03:00:00.000Z',
    stateBadge: { entity: 'PROPOSAL_REQUEST', state: 'REQUESTED' },
    action: null,
  }),
];

function queueBlock(rows: readonly ActionQueueRow[]): ActionQueueHomeBlock {
  return {
    kind: 'ACTION_QUEUE',
    targetIds: rows.map((item) => item.targetId),
    items: rows,
    actionAvailability: Object.fromEntries(
      ACTION_QUEUE_ACTION_KINDS.map((kind) => [kind, { enabled: true, reasonKey: null } as const]),
    ) as ActionQueueHomeBlock['actionAvailability'],
  };
}

function summaryBlock(options: { readonly initialEmpty?: boolean } = {}): SummaryHomeBlock {
  return {
    kind: 'SUMMARY',
    audience: 'HOST',
    initialEmpty: options.initialEmpty ?? false,
    items: [
      // ✅ 2026-10-11: 遷移先は**実装（`lib/home/summary.ts`）と同じ値**にする
      //    （合成側に別の URL を書くと、クリックの検査が実物と無関係になる）。
      { kind: 'ACTION_QUEUE', count: 5, href: '/#home-section-today', delta: null },
      { kind: 'AWAITING_REPLY', count: 12, href: '/#home-section-awaiting-reply', delta: null },
      // 🔴 遷移先を持たないカードの対照（押せる見た目にならないことを見る）。
      { kind: 'INTERVIEWS', count: 0, href: null, delta: null },
      { kind: 'PROPOSALS_THIS_WEEK', count: 3, href: '/proposals', delta: { basis: 'PREVIOUS_WEEK', count: 2 } },
    ],
  };
}

/**
 * 🔴 ✅ 2026-10-03: **4 指標がすべて 0**（取引先のデモで実際に起きていた状態）。
 * ⚠️ `summaryBlock().items.map(...)` で作らない —— `SummaryHomeBlock` は所属で判別する
 *    共用体であり、`map` の結果は**ホスト / 取引先が混ざった配列型**に広がって代入できない。
 */
function allZeroSummaryBlock(): SummaryHomeBlock {
  return {
    kind: 'SUMMARY',
    audience: 'HOST',
    initialEmpty: false,
    items: [
      { kind: 'ACTION_QUEUE', count: 0, href: null, delta: null },
      { kind: 'AWAITING_REPLY', count: 0, href: '/proposals', delta: null },
      { kind: 'INTERVIEWS', count: 0, href: null, delta: null },
      { kind: 'PROPOSALS_THIS_WEEK', count: 0, href: '/proposals', delta: null },
    ],
  };
}

/** ✅ 2026-10-11: `FOLLOW_UP` ブロック（`要対応` タブの 2〜4 番目のセクションの行）。 */
function followUpBlock(rows: readonly ActionQueueRow[]): FollowUpHomeBlock {
  return { kind: 'FOLLOW_UP', targetIds: rows.map((item) => item.targetId), items: rows };
}

/** ✅ 2026-10-11: セクション 2〜4 に入る行（`返信待ち` 2 件 / `面談調整中` 1 件 / `提案後フォロー` 1 件）。 */
const FOLLOW_UP_ROWS: readonly ActionQueueRow[] = [
  row('AWAITING_REPLY', 'a1', {
    stateBadge: { entity: 'PROPOSAL', state: 'SUBMITTED' },
    action: null,
  }),
  row('AWAITING_REPLY', 'a2', {
    stateBadge: { entity: 'PROPOSAL', state: 'SUBMITTED' },
    action: null,
  }),
  row('INTERVIEW_COORDINATION', 'i1', {
    stateBadge: { entity: 'PROPOSAL', state: 'INTERVIEW_SCHEDULED' },
    action: { kind: 'RECORD', href: '/proposals/i1/interview' },
  }),
  row('PROPOSAL_FOLLOW_UP', 'f1', {
    stateBadge: { entity: 'PROPOSAL', state: 'INTERVIEWED' },
    action: { kind: 'RECORD', href: '/proposals/f1/interview' },
  }),
];

function render(
  options: {
    readonly rows?: readonly ActionQueueRow[];
    readonly followUpRows?: readonly ActionQueueRow[];
    readonly initialEmpty?: boolean;
    readonly allZero?: boolean;
    readonly tab?: 'messages' | 'actions' | 'projects' | 'engineers';
  } = {},
): string {
  const rows = options.rows ?? ROWS;
  return renderToStaticMarkup(
    createElement(HomeScreen, {
      widthClass: 'split',
      audience: 'HOST',
      userName: '山田太郎',
      dateLabel: '2026/10/02（金）',
      initialQueue: queueBlock(rows),
      initialFollowUp: followUpBlock(options.followUpRows ?? FOLLOW_UP_ROWS),
      initialSummary:
        options.allZero === true
          ? allZeroSummaryBlock()
          : summaryBlock({ initialEmpty: options.initialEmpty ?? false }),
      initialChangedSince: NOW,
      scope: 'mine',
      scopeHrefs: { mine: '/', all: '/?scope=all' },
      requestListHref: '/proposal-requests',
      queueListHref: '/proposals',
      initialTab: options.tab ?? 'actions',
      tabHrefs: {
        messages: '/?tab=messages',
        actions: '/',
        projects: '/?tab=projects',
        engineers: '/?tab=engineers',
      },
      schedule: [],
      messages: MESSAGES,
      queueMessages: QUEUE_MESSAGES,
      pollIntervalMs: 0,
      banner: null,
      heading: createElement('div', { 'data-testid': 'synthetic-heading' }),
      belowKpi: createElement('div', { 'data-testid': 'synthetic-below-kpi' }),
      quarantine: createElement('div', { 'data-testid': 'synthetic-quarantine' }),
      messagesPanel: createElement('div', { 'data-testid': 'synthetic-messages' }),
      projectsPanel: createElement('div', { 'data-testid': 'synthetic-projects' }),
      engineersPanel: createElement('div', { 'data-testid': 'synthetic-engineers' }),
      emptyState: createElement('div', { 'data-testid': 'synthetic-empty' }),
    }),
  );
}

describe('🔴 ① 画面の骨格（挨拶 → KPI → ✅ 0 → タブ）', () => {
  it('順序が `docs/04` §4.1 の図のとおりである', () => {
    const html = render();
    const order = [
      'home-host-greeting-root',
      'home-host-summary',
      'synthetic-quarantine',
      'home-tabs',
    ].map((id) => html.indexOf(id));
    expect(order.every((index) => index >= 0)).toBe(true);
    expect([...order]).toEqual([...order].sort((a, b) => a - b));
  });

  it('挨拶は時間帯 + 氏名 + 敬称（🔴 サインインしている本人の名であり、エンジニアではない）', () => {
    // 2026-10-02T03:00Z = 12:00 JST → `AFTERNOON`。
    expect(render()).toContain('こんにちは、山田太郎さん');
  });

  it('🔴 ⑥ 基準時刻が画面に在る（一括更新の時刻。省略できない）', () => {
    expect(render()).toContain('12:00 時点 / ASOF_NOTE');
    expect(asOfLabel(NOW, MESSAGES)).toBe('12:00 時点 / ASOF_NOTE');
  });

  it('一文は件数で選ばれる（0 件は専用の 1 文）', () => {
    expect(greetingLead(0, MESSAGES)).toBe('LEAD_NONE');
    expect(greetingLead(5, MESSAGES)).toBe('LEAD_PREFIX(5)LEAD_SUFFIX');
    expect(render()).toContain('LEAD_PREFIX(5)LEAD_SUFFIX');
  });
});

describe('🔴 ② KPI カードは 4 枚で横スクロールにしない', () => {
  it('4 枚とも出る（1 枚も落とさない）', () => {
    const html = render();
    expect(html).toContain('data-item-count="4"');
    for (const id of ['action-queue', 'awaiting-reply', 'interviews', 'proposals-this-week']) {
      expect(html, id).toContain(`data-testid="home-host-kpi-${id}"`);
    }
  });

  it('🔴 `md` 未満は 2 列のグリッド（`overflow-x` を 1 語も書かない）', () => {
    const html = render();
    const root = html.match(/<div[^>]*data-testid="home-host-kpi-root"[^>]*>/)?.[0] ?? '';
    expect(root).toContain('grid-cols-2');
    expect(root).toContain('md:grid-cols-4');
    expect(root).not.toContain('overflow-x');
  });

  it('🔴 ✅ 2026-10-11: 遷移先があるカードだけがリンクになる（4 枚を同じボタンにしない）', () => {
    const html = render();
    // 🔴 `href` があるカードは `<a>` で、`href` が無いカードは `<a>` にならない。
    const cardOf = (id: string): string =>
      html.match(new RegExp(`<(a|div)[^>]*data-testid="home-host-kpi-${id}"[^>]*>`))?.[0] ?? '';
    expect(cardOf('action-queue')).toMatch(/^<a /);
    expect(cardOf('action-queue')).toContain('href="/#home-section-today"');
    expect(cardOf('awaiting-reply')).toContain('href="/#home-section-awaiting-reply"');
    // 🔴 遷移先を持たないカードは `<div>` のまま（カーソルも下線も付かない）。
    expect(cardOf('interviews')).toMatch(/^<div /);
    expect(cardOf('interviews')).not.toContain('href=');
  });

  it('🔴 ✅ 2026-10-11: `hover:` / `focus-visible:` は画面側に無い（検査 (j) / `packages/ui` が持つ）', () => {
    // 🔴 器のクラスは `packages/ui` の 1 定数から来る（画面が状態の見え方を決めない）。
    const html = render();
    const card = html.match(/<a[^>]*data-testid="home-host-kpi-action-queue"[^>]*>/)?.[0] ?? '';
    expect(card).toContain('hover:bg-row-hover-bg');
    // 🔴 `display` が `flex items-center` のまま（`block` を足すとアイコン面と文字の横並びと
    //    `gap` が黙って消える。`cn()` = `twMerge` は `display` の群を後勝ちで畳む）。
    expect(card).toContain('flex items-center');
    expect(card).not.toMatch(/class="[^"]* block( |")/);
  });

  it('差分は件数差のみで、持たない指標は欄ごと出さない', () => {
    const html = render();
    expect(html).toContain('↑ +2（先週比）');
    expect(html).not.toContain('data-testid="home-host-kpi-interviews-delta"');
    expect(html).not.toContain('%');
  });
});

describe('🔴 ③ ✅ 2026-10-11: タブは 4 つ（`メッセージ` を足した）', () => {
  it('メッセージ / 要対応 / 案件 / 人材 の 4 つが出て、件数は要対応にだけ付く', () => {
    const html = render();
    // 🔴 件数は **`今日やること` の件数だけ**（5）。挨拶行の一文と KPI カード 1 と**同じ数**である
    //    （`lib/home/sections.ts` の `homeActionsTabCount` の 🔴 —— 性質の違う仕事を
    //    1 つの合計に丸めない / 同じ画面に矛盾する 2 行を作らない）。
    expect(html).toContain('TAB_ACTIONS 5');
    expect(html).toContain('LEAD_PREFIX(5)LEAD_SUFFIX');
    expect(html).toContain('TAB_MESSAGES');
    expect(html).toContain('TAB_PROJECTS');
    expect(html).toContain('TAB_ENGINEERS');
    expect((html.match(/role="tab"/g) ?? []).length).toBe(4);
  });

  it('🔴 `メッセージ` タブに件数を付けない（未読の実体が無い。近似を入れない）', () => {
    const html = render();
    // 🔴 タブの中身はアイコン（`<svg>`）+ 語になったので、**タグを剥がしてから**照合する
    //    （`[^<]*` のままだと空文字しか取れず、**この検査は何も確かめなくなる**）。
    const tabs = [...html.matchAll(/role="tab"[^>]*>([\s\S]*?)<\/button>/g)].map((match) =>
      (match[1] ?? '').replace(/<[^>]*>/g, '').trim(),
    );
    expect(tabs.length, 'タブの語が 1 つも取れていない（検査が空振りしている）').toBe(4);
    expect(tabs).toContain('TAB_MESSAGES');
    // 🔴 `メッセージ` のラベルに数字が 1 文字も無い。
    expect(tabs.find((label) => label === 'TAB_MESSAGES')).not.toMatch(/[0-9]/);
    // 🔴 `案件` / `人材` も同じ（行が入るまで数が無い。`0` は「案件が無い」に読める）。
    expect(tabs.find((label) => label === 'TAB_PROJECTS')).not.toMatch(/[0-9]/);
    expect(tabs.find((label) => label === 'TAB_ENGINEERS')).not.toMatch(/[0-9]/);
  });

  it('🔴 既定タブは `要対応`（並びの先頭が `メッセージ` でも既定は変わらない）', () => {
    const html = render();
    expect(html).toContain('data-testid="home-action-queue"');
    expect(html).toContain('data-testid="home-actions-tab"');
  });

  it('`?tab=` で別の面を初期表示できる（戻って同じ面に帰れる）', () => {
    expect(render({ tab: 'projects' })).toContain('data-testid="synthetic-projects"');
    expect(render({ tab: 'messages' })).toContain('data-testid="synthetic-messages"');
  });
});

describe('🔴 ✅ 2026-10-11: `要対応` タブは 4 セクションを縦に並べる', () => {
  it('`今日やること` → `返信待ち` → `面談調整中` → `提案後フォロー` の順で出る', () => {
    const html = render();
    const order = [
      html.indexOf('data-testid="home-action-queue"'),
      html.indexOf('data-testid="home-section-awaiting-reply-root"'),
      html.indexOf('data-testid="home-section-interview-coordination-root"'),
      html.indexOf('data-testid="home-section-proposal-follow-up-root"'),
    ];
    expect(order.every((index) => index >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });

  it('🔴 行が 0 件のセクションは見出しごと描かない（`すべて見る` だけが残る空セクションを作らない）', () => {
    const html = render({ followUpRows: [] });
    expect(html).not.toContain('data-testid="home-section-awaiting-reply-root"');
    expect(html).not.toContain('SEC_AWAITING');
    // 🔴 対照: `今日やること` は 0 件でも残る（§S-003「画面全体を空にしない」）。
    const emptyHtml = render({ rows: [], followUpRows: [] });
    expect(emptyHtml).toContain('data-testid="home-action-queue"');
    expect(emptyHtml).toContain('QUEUE_EMPTY');
  });

  it('🔴 セクションの件数バッジはそのセクションの行数（合計に丸めない）', () => {
    const html = render();
    const countOf = (prefix: string): string =>
      html.match(new RegExp(`data-testid="${prefix}header-count"[^>]*>([^<]*)<`))?.[1] ?? '';
    expect(countOf('home-section-awaiting-reply-')).toBe('2件');
    expect(countOf('home-section-interview-coordination-')).toBe('1件');
    expect(countOf('home-section-proposal-follow-up-')).toBe('1件');
  });

  it('🔴 `すべて見る` はセクションの母集団をそのまま開く（状態フィルタ付きの `S-019`）', () => {
    const html = render();
    expect(html).toContain('href="/proposals?state=SUBMITTED"');
    expect(html).toContain('href="/proposals?state=INTERVIEW_SCHEDULED"');
    expect(html).toContain('href="/proposals?state=INTERVIEWED&amp;state=RESULT_PENDING"');
  });

  it('🔴 `返信待ち` の行に操作を置かない（催促のボタンをホームに置かない）', () => {
    const html = render();
    expect(html).toContain('data-testid="home-action-queue-action-none-a1"');
    // 🔴 対照: `面談調整中` / `提案後フォロー` は `結果を記録する`（`S-024` への遷移）。
    expect(html).toContain('data-testid="home-action-queue-action-i1"');
    expect(html).toContain('href="/proposals/i1/interview"');
    expect(html).toContain('A_RECORD');
  });

  it('🔴 🔴 `稼働開始が近い人材` のセクションを作らない（`Assignment` は Phase 2 / 氏名を出さない）', () => {
    const html = render();
    expect(html).not.toContain('data-testid="home-section-upcoming-assignment-root"');
  });
});

describe('🔴 ④⑤ 右レール（先に動くもの / 今日の予定 / ワンポイント）', () => {
  it('✅ 2026-10-11: 先に動くものは要対応キューの**上位 4 件**で、順がキューと同一である', () => {
    const items = priorityItems(ROWS, Date.parse(NOW), QUEUE_MESSAGES);
    // 🔴 人間の仕様「優先アクション（最大 4 件、順位つき）」。
    expect(HOME_PRIORITY_ITEM_COUNT).toBe(4);
    expect(items).toHaveLength(4);
    expect(items.map((item) => item.rank)).toEqual([1, 2, 3, 4]);
    expect(items.map((item) => item.title)).toEqual([
      'subject-s1',
      'subject-a1',
      'subject-g1',
      'subject-h1',
    ]);
  });

  it('🔴 「最大」4 件である（行が少なければ少ないまま。足して埋めない）', () => {
    const items = priorityItems(ROWS.slice(0, 2), Date.parse(NOW), QUEUE_MESSAGES);
    expect(items).toHaveLength(2);
  });

  it('🔴 右レールは `今日やること` の行だけから作る（`FOLLOW_UP` の行を混ぜない）', () => {
    // 🔴 混ぜると「キューの 1 行目と優先アクションの 1 位が違う」状態になる（§4.1 の右レール ②）。
    const items = priorityItems(ROWS, Date.parse(NOW), QUEUE_MESSAGES);
    expect(items.map((item) => item.title)).not.toContain('subject-a2');
  });

  it('🔴 実行系の導線を持たない（`href` / `onClick` のキーが無い = 型にも無い）', () => {
    const [first] = priorityItems(ROWS, Date.parse(NOW), QUEUE_MESSAGES);
    expect(Object.keys(first ?? {}).sort()).toEqual(['badge', 'rank', 'subtitle', 'title']);
  });

  it('🔴 ⑤ 匿名の行は右レールでも匿名のまま（経路 4。実名・所属会社名が出ない）', () => {
    const items = priorityItems([ROWS[4] as ActionQueueRow], Date.parse(NOW), QUEUE_MESSAGES);
    expect(items[0]?.title).toBe('Project X / 共有候補（匿名）');
    const html = render({ rows: [ROWS[4] as ActionQueueRow] });
    expect(html).toContain('共有候補（匿名）');
    // 🔴 相手の**値**が 1 つも出ない（`—` だけ）。⚠️ `data-testid` には `counterparty-r1` が
    //    出るので、**要素の中身**を見る（testid の文字列で空振りの green にしない）。
    expect(html).not.toContain('>counterparty-r1<');
    const rail = html.slice(html.indexOf('data-testid="home-rail-priority-list"'));
    expect(rail).not.toContain('counterparty');
  });

  it('🔴 ⑧ 今日の予定を架空のデータで埋めない（0 件は専用の 1 行）', () => {
    const html = render();
    expect(html).toContain('data-testid="home-rail-schedule-empty"');
    expect(html).toContain('RAIL_SCHEDULE_EMPTY');
    // 🔴 社内予定（朝会・定例）を 1 つも描かない。
    expect(html).not.toContain('朝会');
  });

  it('ワンポイントは静的な文言集から 1 つだけ出る（AI を呼ばない）', () => {
    const html = render();
    const shown = ['TIP_1', 'TIP_2', 'TIP_3'].filter((tip) => html.includes(tip));
    expect(shown).toHaveLength(1);
  });

  it('レールの並びは 今日の予定 → 先に動くもの → ワンポイント（狭い画面でも同じ走査順）', () => {
    // ✅ **2026-10-13（人間のデザインシステム定義 v1.0 §3.7）: 予定を先頭にした。**
    //    時刻の軸を持つものが上に来ると、朝に開いたときの「今日はどう進むか」が 1 枚目で分かる。
    const html = render();
    const order = ['home-rail-schedule-root', 'home-rail-priority-root', 'home-rail-one-point-root'].map(
      (id) => html.indexOf(id),
    );
    expect(order.every((index) => index >= 0)).toBe(true);
    expect([...order]).toEqual([...order].sort((a, b) => a - b));
  });
});

describe('🔴 ⑦ 初回空では KPI・タブ・右レールを描かない', () => {
  it('`EmptyState` だけが主カラムに出る', () => {
    const html = render({ initialEmpty: true, rows: [] });
    expect(html).toContain('data-testid="synthetic-empty"');
    expect(html).not.toContain('data-testid="home-host-kpi-root"');
    expect(html).not.toContain('data-testid="home-tabs"');
    expect(html).not.toContain('data-testid="home-rail"');
  });

  it('🔴 挨拶行は初回空でも出る（画面の骨格が日によって変わらない）', () => {
    expect(render({ initialEmpty: true, rows: [] })).toContain('home-host-greeting-root');
  });
});

describe('🔴 幅クラスは素通しされる（検査 (k) の 1 回）', () => {
  it('`split`（B = 分割）で描かれ、副カラムが在る', () => {
    const html = render();
    expect(html).toContain('data-width-class="split"');
    expect(html).toContain('data-page-body-aside="true"');
  });

  it('🔴 初回空では副カラムを描かない（空の 360px を置かない）', () => {
    expect(render({ initialEmpty: true, rows: [] })).not.toContain('data-page-body-aside="true"');
  });
});

// ============================================================================
// 🔴 ✅ 2026-10-03: **強さの順序**（KPI 帯 < 要対応キュー）を機械で固定する
// ============================================================================
// **何が起きていたか（デモ巡回の実測）**:
//   - KPI 帯が常に 240px 先に来て、375px では KPI のほうが背も高かった（256 > 198）
//   - KPI の件数は **24px / 600** でホーム内最大の文字だった
//   - KPI は白い器 4 枚（1920 で 1,144 × 133px。1 桁の数字 1 つに面積の 8 割が空白）
//   - 取引先は 4 枚すべてが `0 件`
//
// 🔴 `docs/04` §7.2 改訂 23 の表は **「件数を、その画面で最も強調される要素より強くする
//    （サイズ・太さ・色）」を「（認めていない）」側**に置き、🔴 **「`S-003` で最も強調するのは
//    `要対応` タブのセクション 1 の行」**と名指ししている。現状はこれに反していた。
// 🔴 **KPI カード 4 枚という形は人間の決定（[#86](https://github.com/Festal-KM/SES-Platform/issues/86)）
//    なので無くさない。** 変えたのは**強さの順序だけ**である。
describe('🔴 ⑧ KPI の件数は 4 枚とも同じ段である', () => {
  it('🔴 KPI の件数は 4 枚とも `--text-metric`（28px）で、1 枚だけ大きいカードが無い', () => {
    // ✅ **2026-10-13（人間のデザインシステム定義 v1.0 §3.4）: 旧条文「KPI の件数は要対応キューの
    //    見出しより強くない（`text-lg` に留める）」を置き換えた。** 仕様書は 4 枚を**並べて比べる**
    //    ものとして定義し、KPI Value を 28 / 700 と指定している。1 枚だけ大きいと、比較ではなく
    //    「1 つの数字 + 3 つの添え物」に見える。
    // 🔴 **検査の数は減らしていない** ——「4 つ見つかる」「4 つとも同じ段」の 2 つを見る。
    const html = render();
    const values = [...html.matchAll(/<span class="(text-(?:metric|lg|row)[ "][^"]*)"/g)]
      .map((match) => match[1] ?? '')
      .filter((classes) => classes.includes('tabular-nums'));
    expect(values.length, 'KPI の件数が 1 つも見つからない（検出器の空振り）').toBe(4);
    for (const classes of values) {
      expect(classes, `KPI の件数の段が揃っていない: ${classes}`).toContain('text-metric');
    }
  });

  it('🔴 要対応キューは白い面（器）を持ち、その中に節見出しが入っている', () => {
    const html = render();
    const start = html.indexOf('data-testid="home-action-queue"');
    expect(start).toBeGreaterThan(-1);
    const queue = html.slice(start, start + 2000);
    // 器（`Card` = `CARD_SURFACE_CLASSES`）が節見出しより先に在る。
    const card = queue.indexOf('rounded-lg border border-border bg-surface');
    const header = queue.indexOf('data-testid="home-action-queue-header-root"');
    expect(card, 'キューが器（白い面）を持っていない').toBeGreaterThan(-1);
    expect(header).toBeGreaterThan(card);
  });

  it('🔴 KPI カードの器は 4 枚とも同じ寸法である（押せるかどうかで変わらない）', () => {
    const html = render();
    // ⚠️ ✅ 2026-10-11: 遷移先を持つカードは `<a>` で描かれる（`<div>` 決め打ちにしない）。
    // ✅ 2026-10-13: 器の内側は 16px（`p-4`）、高さは 105（`min-h-26.25`）で固定した
    //    （`docs/design-system.md` §4）。🔴 **4 枚の高さが揃うこと**が器の条件である。
    const card = html.match(/<(?:a|div)[^>]*data-testid="home-host-kpi-action-queue"[^>]*>/)?.[0] ?? '';
    expect(card).toContain('p-4');
    expect(card).toContain('min-h-26.25');
    // 🔴 遷移先を持たないカードも同じ余白である（押せるかどうかで器の寸法が変わらない）。
    const plain = html.match(/<(?:a|div)[^>]*data-testid="home-host-kpi-interviews"[^>]*>/)?.[0] ?? '';
    expect(plain).toContain('p-4');
    expect(plain).toContain('min-h-26.25');
  });

  it('🔴 同じ 1 件が KPI とキュー見出しに二重に出ない（KPI は `data-emphasis` で既定のまま）', () => {
    const html = render();
    // ホストのカードは 1 枚も `primary` にならない（24px を使ってよいのは `S-004` のカード 1 だけ）。
    expect(html).not.toContain('data-emphasis="primary"');
  });
});

describe('🔴 ⑨ 4 指標がすべて 0 の日は KPI カードを描かない（0 が並ぶカードを出さない）', () => {
  it('カード 4 枚の代わりに 1 行を出し、器（`home-host-summary`）は残す', () => {
    const html = render({ allZero: true });
    expect(html).toContain('data-testid="home-host-summary"');
    expect(html).toContain('data-metrics="all-zero"');
    expect(html).toContain('data-testid="home-kpi-all-zero"');
    expect(html).toContain('KPI_ALL_ZERO');
    expect(html).not.toContain('data-testid="home-host-kpi-root"');
    // 🔴 キュー・タブ・右レールは出し続ける（画面全体を空にしない。§4.1）。
    expect(html).toContain('data-testid="home-action-queue"');
    expect(html).toContain('data-testid="home-rail"');
    expect(html).toContain('data-testid="synthetic-below-kpi"');
  });

  it('1 つでも 0 でなければカードが出る（対照: 常に隠れる実装になっていない）', () => {
    const html = render();
    expect(html).toContain('data-testid="home-host-kpi-root"');
    expect(html).toContain('data-metrics="present"');
    expect(html).not.toContain('data-testid="home-kpi-all-zero"');
  });
});
