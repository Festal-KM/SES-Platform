// apps/web/app/(main)/_home/action-queue-section.render.test.tsx
// 🔴 T-12-15: `ActionQueueSection`（`S-003` セクション 1 / `S-004` セクション 1・2 の要対応キュー）の描画。
//
// 固定するもの（docs/04 §S-003 / §S-004 / `F-006` / docs/05 §10.4 / §6.11.2）:
//   ① 並びはサーバが決めた順のまま（クライアントで並べ替えない）。種別バッジは種別ごとの語で、`SEND_FAILED` と `SEND_HELD` は別の語・別の色
//   ② 0 件でもセクションを消さず「対応が必要なものはありません」を出す。🔴 T-22-09: **アクションを置かない**
//   ③ 折りたたみ（`<details>`）を使わない。🔴 T-22-09: **モバイルに残るのは 3 要素**（種別バッジ / 対象 / 経過時間）であり、
//      `相手` / `期限` は `sm` 未満、**`状態` / `操作` は `xl` 未満**で落ちる（横スクロールさせないため）
//   ④ 種別ごとの件数を 1 つの合計に丸める表示（「N 件」）が無い
//   ⑤ 差分の合成（`mergeActionQueueDelta`）: 上書き / 消えた行の除去 / 材料が無い行があれば `null`
//   ⑥ 🔴 T-22-09: `操作` は `action` と `actionAvailability` の 2 項だけで決まる。**不能ならボタンを描かず理由テキスト**
//      （`disabled` を使わない）。`action` が `null`（ホストの依頼の行）は `—`
//   ⑦ 🔴 T-22-09: 色は**期限超過 / 経過時間が閾値超の行だけ**（行頭 2px の縦バー + 期限セルの文字色）。
//      **行の背景を塗らない / 赤を使わない**
//   ⑧ 🔴 T-22-09: ホストの依頼の行に**実名・所属会社名が無い**（経路 4。`subjectLabel` に入るのは案件名 + 匿名の語だけ）
//
// 🔴 `@testing-library/react` を使わず `react-dom/server` の `renderToStaticMarkup` を使う（`home-sections.render.test.tsx` と同じ方針）。
//    `useEffect`（ポーリング）はサーバ描画では走らない。`pollIntervalMs: 0` で明示的に無効化する。
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ACTION_QUEUE_ACTION_KINDS } from '../../../lib/home/action-availability';
import type {
  ActionQueueActionKind,
  ActionQueueHomeBlock,
  ActionQueueRow,
} from '../../../lib/home/types';
import { ActionQueueSection, mergeActionQueueDelta, type ActionQueueMessages } from './action-queue-section';

const MESSAGES: ActionQueueMessages = {
  title: 'title(合成)',
  lead: 'lead(合成)',
  empty: 'empty(合成)',
  scopeLegend: 'scope(合成)',
  scopeMine: 'mine(合成)',
  scopeAll: 'all(合成)',
  columnKind: 'kind(合成)',
  columnSubject: 'subject(合成)',
  columnCounterparty: 'counterparty(合成)',
  columnTime: 'time(合成)',
  columnDeadline: 'deadline(合成)',
  columnState: 'state(合成)',
  columnAction: 'action(合成)',
  kinds: {
    SEND_FAILED: 'KIND_SEND_FAILED',
    APPROVAL_PENDING: 'KIND_APPROVAL_PENDING',
    GATE_FAILED: 'KIND_GATE_FAILED',
    SEND_HELD: 'KIND_SEND_HELD',
    PROPOSAL_REQUEST_PENDING: 'KIND_REQUEST',
  },
  actions: {
    APPROVE: 'ACTION_APPROVE',
    FIX: 'ACTION_FIX',
    RESEND: 'ACTION_RESEND',
    RESPOND: 'ACTION_RESPOND',
  },
  denied: { 'home.actionQueue.denied.role': 'DENIED_ROLE' },
  proposalStates: { APPROVAL_PENDING: 'STATE_APPROVAL_PENDING', GATE_FAILED: 'STATE_GATE_FAILED', SUBMIT_FAILED: 'STATE_SUBMIT_FAILED', APPROVED: 'STATE_APPROVED' },
  proposalRequestStates: { REQUESTED: 'STATE_REQUESTED' },
  openRequestList: 'openRequestList(合成)',
  valueNone: 'NONE',
  changed: 'CHANGED',
  pollError: 'pollError(合成)',
  elapsed: { justNow: 'JUST_NOW', minutesSuffix: 'm', hoursSuffix: 'h', daysSuffix: 'd', none: 'NONE' },
  remaining: { prefix: 'R', days: 'd', hours: 'h', minutes: 'm', lessThanMinute: 'lt1m', expired: 'EXPIRED' },
};

const NOW = '2026-09-16T03:00:00.000Z';

function row(kind: ActionQueueRow['kind'], targetId: string, overrides: Partial<ActionQueueRow> = {}): ActionQueueRow {
  return {
    kind,
    targetId,
    subjectLabel: `subject-${targetId}`,
    counterpartyLabel: `counterparty-${targetId}`,
    since: '2026-09-15T03:00:00.000Z',
    deadline: null,
    rowVersion: Date.parse('2026-09-15T03:00:00.000Z'),
    href: `/target/${targetId}`,
    stateBadge: { entity: 'PROPOSAL', state: 'APPROVAL_PENDING' },
    action: { kind: 'APPROVE', href: `/target/${targetId}/approve` },
    ...overrides,
  };
}

/** 🔴 4 kind すべてが可（既定）。**毎回 4 エントリを全量返す**契約を合成側でも守る。 */
function allowAll(): ActionQueueHomeBlock['actionAvailability'] {
  return Object.fromEntries(
    ACTION_QUEUE_ACTION_KINDS.map((kind) => [kind, { enabled: true, reasonKey: null } as const]),
  ) as ActionQueueHomeBlock['actionAvailability'];
}

/** 🔴 1 つだけ不能にする（理由キーは非 null であることが型で強制されている）。 */
function denyOnly(target: ActionQueueActionKind): ActionQueueHomeBlock['actionAvailability'] {
  return Object.fromEntries(
    ACTION_QUEUE_ACTION_KINDS.map((kind) => [
      kind,
      kind === target
        ? ({ enabled: false, reasonKey: 'home.actionQueue.denied.role' } as const)
        : ({ enabled: true, reasonKey: null } as const),
    ]),
  ) as ActionQueueHomeBlock['actionAvailability'];
}

function blockOf(
  rows: readonly ActionQueueRow[],
  availability: ActionQueueHomeBlock['actionAvailability'] = allowAll(),
): ActionQueueHomeBlock {
  return {
    kind: 'ACTION_QUEUE',
    targetIds: rows.map((item) => item.targetId),
    items: rows,
    actionAvailability: availability,
  };
}

function render(
  rows: readonly ActionQueueRow[],
  scope: 'mine' | 'all' = 'mine',
  options: {
    readonly availability?: ActionQueueHomeBlock['actionAvailability'];
    readonly audience?: 'HOST' | 'PARTNER';
  } = {},
): string {
  return renderToStaticMarkup(
    createElement(ActionQueueSection, {
      initial: blockOf(rows, options.availability ?? allowAll()),
      initialChangedSince: NOW,
      audience: options.audience ?? 'HOST',
      scope,
      scopeHrefs: { mine: '/', all: '/?scope=all' },
      requestListHref: '/proposal-requests',
      messages: MESSAGES,
      pollIntervalMs: 0,
    }),
  );
}

const ROWS: readonly ActionQueueRow[] = [
  row('SEND_FAILED', 's1', {
    href: '/proposals/send-failures',
    stateBadge: { entity: 'PROPOSAL', state: 'SUBMIT_FAILED' },
    action: { kind: 'RESEND', href: '/proposals/send-failures' },
  }),
  row('APPROVAL_PENDING', 'a1', {
    href: '/proposals/a1/approve',
    since: '2026-09-16T02:15:00.000Z',
    stateBadge: { entity: 'PROPOSAL', state: 'APPROVAL_PENDING' },
    action: { kind: 'APPROVE', href: '/proposals/a1/approve' },
  }),
  row('GATE_FAILED', 'g1', {
    href: '/proposals/g1/edit',
    stateBadge: { entity: 'PROPOSAL', state: 'GATE_FAILED' },
    action: { kind: 'FIX', href: '/proposals/g1/edit' },
  }),
  row('SEND_HELD', 'h1', {
    href: '/proposals?state=APPROVED',
    stateBadge: { entity: 'PROPOSAL', state: 'APPROVED' },
    action: { kind: 'FIX', href: '/proposals?state=APPROVED' },
  }),
  // 🔴 ホストの `提案依頼の返答待ち`: 対象は案件名 + 匿名の語、相手は `null`、**操作は無い**（経路 4 / docs/05 §6.11.2）。
  row('PROPOSAL_REQUEST_PENDING', 'r1', {
    href: '/proposal-requests',
    subjectLabel: 'Project X / 共有候補（匿名）',
    counterpartyLabel: null,
    deadline: '2026-09-18T03:00:00.000Z',
    stateBadge: { entity: 'PROPOSAL_REQUEST', state: 'REQUESTED' },
    action: null,
  }),
];

describe('① 並びと種別（サーバの順のまま。SEND_FAILED と SEND_HELD は別の語）', () => {
  it('行はサーバが決めた順で描かれ、各行が種別 / 遷移先を持つ', () => {
    const html = render(ROWS);
    const order = [...html.matchAll(/data-testid="home-action-queue-row-([a-z0-9]+)"/g)].map((match) => match[1]);
    expect(order).toEqual(['s1', 'a1', 'g1', 'h1', 'r1']);
    expect(html).toContain('data-kind="SEND_FAILED"');
    expect(html).toContain('data-kind="SEND_HELD"');
    expect(html).toContain('href="/proposals/send-failures"');
    expect(html).toContain('href="/proposals/a1/approve"');
    expect(html).toContain('href="/proposals/g1/edit"');
    expect(html).toContain('href="/proposals?state=APPROVED"');
    expect(html).toContain('href="/proposal-requests"');
  });

  it('🔴 種別バッジは種別ごとの語（5 つが全部出て、送信失敗と送信保留が別の語）', () => {
    const html = render(ROWS);
    for (const label of Object.values(MESSAGES.kinds)) expect(html).toContain(label);
    expect(MESSAGES.kinds.SEND_FAILED).not.toBe(MESSAGES.kinds.SEND_HELD);
  });

  it('時間の欄は提案の行 = 経過時間、提案依頼の行 = 返答期限までの残り（基準はサーバの応答時刻）', () => {
    const html = render(ROWS);
    // a1: 02:15 → 03:00 = 45 分。r1: 期限まで 2 日。
    expect(html).toContain('data-testid="home-action-queue-time-a1"');
    expect(html).toMatch(/home-action-queue-time-a1"[^>]*>45m</);
    expect(html).toMatch(/home-action-queue-time-r1"[^>]*>R2d</);
  });

  it('相手が無い行（提案依頼）は `—` 相当の語で埋める', () => {
    const html = render(ROWS);
    expect(html).toMatch(/home-action-queue-counterparty-r1"[^>]*>NONE</);
  });

  it('「自分の担当のみ」トグルは既定オン（aria-current）で、両方の導線が同期のリンクとして出る', () => {
    const html = render(ROWS, 'mine');
    expect(html).toContain('data-testid="home-action-queue-scope-mine"');
    expect(html).toContain('data-testid="home-action-queue-scope-all"');
    expect(html).toMatch(/home-action-queue-scope-mine"[^>]*data-active="true"/);
    expect(html).toMatch(/home-action-queue-scope-all"[^>]*data-active="false"/);
    expect(render(ROWS, 'all')).toMatch(/home-action-queue-scope-all"[^>]*data-active="true"/);
  });
});

describe('② 0 件でもセクションを消さない（docs/04 §S-003「要対応 0 件」）', () => {
  it('空文言が出て、行も件数の見出しも無い', () => {
    const html = render([]);
    expect(html).toContain('data-testid="home-action-queue"');
    expect(html).toContain('data-testid="home-action-queue-empty"');
    expect(html).toContain('empty(合成)');
    expect(html).not.toContain('home-action-queue-row-');
  });

  it('🔴 T-22-09: 要対応 0 件は**説明のみ**でアクションを置かない（0 件は正常であり、行動を促す相手がいない）', () => {
    const html = render([]);
    // `EmptyState` の 3 段のうち ①説明だけが在る（②Primary / ③Secondary の器が描かれていない）。
    expect(html).toContain('data-testid="home-action-queue-empty-state-description"');
    expect(html).not.toContain('data-testid="home-action-queue-empty-state-primary"');
    expect(html).not.toContain('data-testid="home-action-queue-empty-state-secondary"');
  });
});

describe('③ ④ モバイルの 3 要素と折りたたみ・合計の不在', () => {
  it('🔴 `<details>` を使わない（セクション 1〜4 を折りたたまない）', () => {
    expect(render(ROWS)).not.toContain('<details');
  });

  it('🔴 モバイルに残るのは 3 要素（種別 / 対象 / 経過時間）。相手 / 期限は `sm` 未満、状態 / 操作は `xl` 未満で落ちる', () => {
    const html = render(ROWS);
    const elementOf = (testId: string): string => {
      const match = html.match(new RegExp(`<[a-z]+[^>]*data-testid="${testId}"[^>]*>`));
      if (match === null) throw new Error(`${testId} が無い`);
      return match[0];
    };
    /** その要素を包む直近の `<span>` の開始タグ（列を落とすクラスは器の側に在る）。 */
    const wrapperOf = (testId: string): string => {
      const index = html.indexOf(`data-testid="${testId}"`);
      if (index < 0) throw new Error(`${testId} が無い`);
      // 🔴 testid を持つ要素そのものではなく、その**直前**に開かれた `<span>`（= 列の器）を取る。
      const start = html.lastIndexOf('<span', html.lastIndexOf('<', index) - 1);
      return html.slice(start, html.indexOf('>', start) + 1);
    };
    const classesOf = (element: string): readonly string[] => element.match(/class="([^"]*)"/)?.[1]?.split(/\s+/) ?? [];
    for (const id of ['kind', 'subject', 'time']) {
      expect(classesOf(elementOf(`home-action-queue-${id}-a1`)), id).not.toContain('hidden');
    }
    // 🔴 `相手` / `期限` は `sm` 未満で落ちる（移行前と同じ判定）。
    for (const id of ['counterparty', 'deadline']) {
      const classes = classesOf(elementOf(`home-action-queue-${id}-a1`));
      expect(classes, id).toContain('hidden');
      expect(classes, id).toContain('sm:inline');
    }
    // 🔴 ✅ T-22-09 で足した `状態` / `操作` は `xl` 未満で落ちる
    //    （7 列の固定トラックの和は `lg` の主カラムに収まらない = 横スクロールか `対象` の潰れになる。
    //    実測は `action-queue-section.tsx` の `ROW_GRID_CLASSES` の ⚠️）。
    for (const id of ['state', 'action']) {
      const classes = classesOf(wrapperOf(`home-action-queue-${id}-a1`));
      expect(classes, id).toContain('hidden');
      expect(classes, id).toContain('xl:inline');
    }
  });

  it('🔴 種別ごとの件数を 1 つの合計に丸めた表示（「N 件」）が無い', () => {
    expect(render(ROWS)).not.toMatch(/[0-9０-９]+\s*件/);
  });
});

describe('⑤ mergeActionQueueDelta — 差分の合成（画面全体を再描画しない）', () => {
  it('差分の行で上書きし、targetIds に無い行を落とし、順は targetIds に従う', () => {
    const previous = [row('APPROVAL_PENDING', 'a1'), row('GATE_FAILED', 'g1'), row('GATE_FAILED', 'g2')];
    const delta: ActionQueueHomeBlock = blockOf([row('GATE_FAILED', 'g2', { subjectLabel: 'updated' })]);
    const deltaWithOrder: ActionQueueHomeBlock = { ...delta, targetIds: ['g2', 'a1'] };
    const merged = mergeActionQueueDelta(previous, deltaWithOrder);
    expect(merged?.map((item) => item.targetId)).toEqual(['g2', 'a1']);
    expect(merged?.[0]?.subjectLabel).toBe('updated');
    expect(merged?.[1]).toEqual(previous[0]);
  });

  it('🔴 targetIds にあるのに手元にも差分にも無い行があれば null（全行の読み直しが要る。黙って欠けた行を描かない）', () => {
    const previous = [row('APPROVAL_PENDING', 'a1')];
    expect(mergeActionQueueDelta(previous, { ...blockOf([]), targetIds: ['a1', 'x9'] })).toBeNull();
  });
});

// ============================================================================
// ⑥ `操作` 列（T-22-09。docs/05 §6.11.2）
// ============================================================================
describe('🔴 ⑥ 操作はサーバが決めた 2 項だけで決まる（画面はロールも状態も見ない）', () => {
  it('可（`enabled`）なら操作のリンクが出て、種別ごとの語と遷移先を持つ', () => {
    const html = render(ROWS);
    expect(html).toMatch(/home-action-queue-action-a1"[^>]*>ACTION_APPROVE</);
    expect(html).toMatch(/home-action-queue-action-g1"[^>]*>ACTION_FIX</);
    expect(html).toMatch(/home-action-queue-action-s1"[^>]*>ACTION_RESEND</);
  });

  it('🔴 不能（`enabled === false`）ならボタンを描かず、その位置に理由テキストを置く（`disabled` を使わない）', () => {
    const html = render(ROWS, 'mine', { availability: denyOnly('APPROVE') });
    // 承認だけが落ちる（理由が出て、操作のリンクが無い）。
    expect(html).toContain('data-testid="home-action-queue-action-denied-a1"');
    expect(html).toContain('DENIED_ROLE');
    expect(html).not.toContain('data-testid="home-action-queue-action-a1"');
    // 🔴 `disabled` / `aria-disabled` を使わない（押せるように見える要素を残さない。§7.10 / `U-10`）。
    expect(html).not.toContain('aria-disabled');
    expect(html).not.toContain('disabled=""');
    // 他の kind は落ちない（条件が kind ごとに効いている）。
    expect(html).toContain('data-testid="home-action-queue-action-g1"');
  });

  it('🔴 `action` が `null`（ホストの依頼の行）は理由ではなく `—`（無い操作の理由を書かない）', () => {
    const html = render(ROWS);
    expect(html).toMatch(/home-action-queue-action-none-r1"[^>]*>NONE</);
    expect(html).not.toContain('data-testid="home-action-queue-action-r1"');
    expect(html).not.toContain('data-testid="home-action-queue-action-denied-r1"');
  });

  it('🔴 代理閲覧相当（全 kind が不能）でも、行は描かれ理由が全行に出る（部品側で分岐しない）', () => {
    const availability = Object.fromEntries(
      ACTION_QUEUE_ACTION_KINDS.map((kind: ActionQueueActionKind) => [
        kind,
        { enabled: false, reasonKey: 'home.actionQueue.denied.role' } as const,
      ]),
    ) as ActionQueueHomeBlock['actionAvailability'];
    const html = render(ROWS, 'mine', { availability });
    for (const id of ['s1', 'a1', 'g1', 'h1']) {
      expect(html, id).toContain(`data-testid="home-action-queue-action-denied-${id}"`);
    }
    // 🔴 操作が消えても行は消えない（閲覧はできる）。
    expect(html).toContain('data-testid="home-action-queue-row-s1"');
  });
});

// ============================================================================
// ⑦ 色（T-22-09。docs/04 §S-003 改訂 16）
// ============================================================================
describe('🔴 ⑦ 色は「期限超過」「経過時間が閾値超」の行だけ（赤は使わない / 行の背景を塗らない）', () => {
  /** class 属性の語。 */
  function classesOf(element: string): readonly string[] {
    return element.match(/class="([^"]*)"/)?.[1]?.split(/\s+/) ?? [];
  }

  /** 行（`<li>`）の開始タグ。 */
  function rowTag(html: string, targetId: string): string {
    const index = html.indexOf(`data-testid="home-action-queue-row-${targetId}"`);
    if (index < 0) throw new Error(`${targetId} の行が無い`);
    const start = html.lastIndexOf('<li', index);
    return html.slice(start, html.indexOf('>', start) + 1);
  }

  it('期限内・放置が短い行には色が付かない（縦バーは透明で、幅だけ揃える）', () => {
    // a1 は 45 分前、期限なし。
    const tag = rowTag(render(ROWS), 'a1');
    expect(tag).toContain('data-urgent="false"');
    expect(tag).toContain('border-l-transparent');
    expect(tag).not.toContain('border-l-warning');
  });

  it('🔴 期限超過の行は `--color-warning` の縦バーと期限セルの文字色だけ（行の背景を塗らない）', () => {
    const overdue = row('PROPOSAL_REQUEST_PENDING', 'x1', {
      deadline: '2026-09-15T00:00:00.000Z',
      stateBadge: { entity: 'PROPOSAL_REQUEST', state: 'REQUESTED' },
      action: null,
    });
    const html = render([overdue]);
    const tag = rowTag(html, 'x1');
    expect(tag).toContain('data-urgent="true"');
    expect(tag).toContain('border-l-warning');
    // 🔴 行の背景を塗らない（**無条件の** `bg-*` が 1 つも無い）。
    //    ⚠️ `hover:bg-bg-subtle` / `data-[state=selected]:bg-brand-bg` は `TableRow`（プリミティブ）が持つ
    //    §7.10 の 8 状態であり、**行が常時塗られること**とは別である（画面は状態の見え方を決めない）。
    expect(classesOf(tag).filter((token) => token.startsWith('bg-'))).toEqual([]);
    // 期限セルの文字色（🔴 赤ではなく橙）。
    expect(html).toMatch(/class="[^"]*text-warning[^"]*"[^>]*data-testid="home-action-queue-deadline-x1"/);
    expect(html).not.toMatch(/class="[^"]*text-danger[^"]*"[^>]*data-testid="home-action-queue-deadline-x1"/);
  });

  it('🔴 経過時間が閾値（3 日）を超えた行にも色が付く', () => {
    const stale = row('GATE_FAILED', 'y1', { since: '2026-09-10T03:00:00.000Z' });
    expect(rowTag(render([stale]), 'y1')).toContain('border-l-warning');
  });

  it('🔴 赤（`danger`）を行の色に使わない（赤は `SUBMIT_FAILED` の種別バッジだけ）', () => {
    const html = render(ROWS);
    // 行の `<tr>` に danger 系のクラスが 1 つも無い。
    for (const id of ['s1', 'a1', 'g1', 'h1', 'r1']) {
      expect(rowTag(html, id), id).not.toMatch(/danger/);
    }
  });
});

// ============================================================================
// ⑧ 経路 4（T-22-09。`CLAUDE.md` §3.1 経路 4 / §7 の「0 件」）
// ============================================================================
describe('🔴 ⑧ ホストの依頼の行に実名・所属会社名が無い', () => {
  it('対象は案件名 + 匿名の語で、相手は `—`（凍結情報の欄も無い）', () => {
    const html = render(ROWS);
    expect(html).toMatch(/home-action-queue-subject-r1"[^>]*>Project X \/ 共有候補（匿名）</);
    expect(html).toMatch(/home-action-queue-counterparty-r1"[^>]*>NONE</);
  });
});

// ============================================================================
// セクションのヘッダ右の入口（T-22-09。ナビの重複を作らずに `S-017` へ行ける）
// ============================================================================
describe('🔴 提案依頼の一覧への入口はセクションのヘッダ右に 1 本だけ', () => {
  it('ホストとパートナーで testid が分かれ、href は同じ既存の URL である', () => {
    const host = render(ROWS, 'mine', { audience: 'HOST' });
    expect(host).toContain('data-testid="home-host-proposal-requests"');
    expect(host).not.toContain('data-testid="home-partner-proposal-requests"');
    const partner = render(ROWS, 'mine', { audience: 'PARTNER' });
    expect(partner).toContain('data-testid="home-partner-proposal-requests"');
    expect(partner).toContain('href="/proposal-requests"');
  });
});
