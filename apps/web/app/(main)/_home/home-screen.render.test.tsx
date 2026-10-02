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
  SummaryHomeBlock,
} from '../../../lib/home/types';
import type { ActionQueueMessages } from './action-queue-section';
import { asOfLabel, greetingLead, HomeScreen, priorityItems } from './home-screen';
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
    delta: {
      increase: '↑ +',
      decrease: '↓ −',
      unchanged: '±0',
      basis: { PREVIOUS_DAY: '（昨日比）', PREVIOUS_WEEK: '（先週比）' },
    },
  },
  tabs: { label: 'TABS', actions: 'TAB_ACTIONS', projects: 'TAB_PROJECTS', engineers: 'TAB_ENGINEERS' },
  rail: {
    scheduleTitle: 'RAIL_SCHEDULE',
    scheduleEmpty: 'RAIL_SCHEDULE_EMPTY',
    priorityTitle: 'RAIL_PRIORITY',
    priorityEmpty: 'RAIL_PRIORITY_EMPTY',
    onePointTitle: 'RAIL_ONE_POINT',
    onePointLines: ['TIP_1', 'TIP_2', 'TIP_3'],
  },
  seeAll: 'SEE_ALL',
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
  },
  actions: { APPROVE: 'A_APPROVE', FIX: 'A_FIX', RESEND: 'A_RESEND', RESPOND: 'A_RESPOND' },
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
      { kind: 'ACTION_QUEUE', count: 5, href: null, delta: null },
      { kind: 'AWAITING_REPLY', count: 12, href: '/proposals', delta: null },
      { kind: 'INTERVIEWS', count: 0, href: null, delta: null },
      { kind: 'PROPOSALS_THIS_WEEK', count: 3, href: '/proposals', delta: { basis: 'PREVIOUS_WEEK', count: 2 } },
    ],
  };
}

function render(
  options: {
    readonly rows?: readonly ActionQueueRow[];
    readonly initialEmpty?: boolean;
    readonly tab?: 'actions' | 'projects' | 'engineers';
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
      initialSummary: summaryBlock({ initialEmpty: options.initialEmpty ?? false }),
      initialChangedSince: NOW,
      scope: 'mine',
      scopeHrefs: { mine: '/', all: '/?scope=all' },
      requestListHref: '/proposal-requests',
      queueListHref: '/proposals',
      initialTab: options.tab ?? 'actions',
      tabHrefs: { actions: '/', projects: '/?tab=projects', engineers: '/?tab=engineers' },
      schedule: [],
      messages: MESSAGES,
      queueMessages: QUEUE_MESSAGES,
      pollIntervalMs: 0,
      banner: null,
      heading: createElement('div', { 'data-testid': 'synthetic-heading' }),
      belowKpi: createElement('div', { 'data-testid': 'synthetic-below-kpi' }),
      quarantine: createElement('div', { 'data-testid': 'synthetic-quarantine' }),
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

  it('差分は件数差のみで、持たない指標は欄ごと出さない', () => {
    const html = render();
    expect(html).toContain('↑ +2（先週比）');
    expect(html).not.toContain('data-testid="home-host-kpi-interviews-delta"');
    expect(html).not.toContain('%');
  });
});

describe('🔴 ③ タブは 3 つ（`メッセージ` を置かない）', () => {
  it('要対応 / 案件 / 人材 の 3 つだけが出て、件数は要対応にだけ付く', () => {
    const html = render();
    expect(html).toContain('TAB_ACTIONS 5');
    expect(html).toContain('TAB_PROJECTS');
    expect(html).toContain('TAB_ENGINEERS');
    expect(html).not.toContain('メッセージ');
    expect((html.match(/role="tab"/g) ?? []).length).toBe(3);
  });

  it('既定タブは `要対応`（キューが描かれる）', () => {
    expect(render()).toContain('data-testid="home-action-queue"');
  });

  it('`?tab=` で別の面を初期表示できる（戻って同じ面に帰れる）', () => {
    const html = render({ tab: 'projects' });
    expect(html).toContain('data-testid="synthetic-projects"');
  });
});

describe('🔴 ④⑤ 右レール（先に動くもの / 今日の予定 / ワンポイント）', () => {
  it('先に動くものは要対応キューの上位 3 件で、順がキューと同一である', () => {
    const items = priorityItems(ROWS, Date.parse(NOW), QUEUE_MESSAGES);
    expect(items).toHaveLength(3);
    expect(items.map((item) => item.rank)).toEqual([1, 2, 3]);
    expect(items.map((item) => item.title)).toEqual(['subject-s1', 'subject-a1', 'subject-g1']);
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

  it('レールの並びは 先に動くもの → 今日の予定 → ワンポイント（狭い画面でも同じ走査順）', () => {
    const html = render();
    const order = ['home-rail-priority-root', 'home-rail-schedule-root', 'home-rail-one-point-root'].map(
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
