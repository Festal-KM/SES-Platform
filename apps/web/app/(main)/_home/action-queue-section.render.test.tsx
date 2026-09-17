// apps/web/app/(main)/_home/action-queue-section.render.test.tsx
// 🔴 T-12-15: `ActionQueueSection`（`S-003` セクション 1 / `S-004` セクション 1・2 の要対応キュー）の描画。
//
// 固定するもの（docs/04 §S-003 / §S-004 / `F-006` / docs/05 §10.4）:
//   ① 並びはサーバが決めた順のまま（クライアントで並べ替えない）。種別バッジは種別ごとの語で、`SEND_FAILED` と `SEND_HELD` は別の語・別の色
//   ② 0 件でもセクションを消さず「対応が必要なものはありません」を出す
//   ③ 折りたたみ（`<details>`）を使わない。モバイルで見える 3 要素（種別バッジ / 対象 / 経過時間）は `hidden` を持たず、
//      `相手` / `期限` だけが `hidden sm:inline`
//   ④ 種別ごとの件数を 1 つの合計に丸める表示（「N 件」）が無い
//   ⑤ 差分の合成（`mergeActionQueueDelta`）: 上書き / 消えた行の除去 / 材料が無い行があれば `null`
//
// 🔴 `@testing-library/react` を使わず `react-dom/server` の `renderToStaticMarkup` を使う（`home-sections.render.test.tsx` と同じ方針）。
//    `useEffect`（ポーリング）はサーバ描画では走らない。`pollIntervalMs: 0` で明示的に無効化する。
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { ActionQueueHomeBlock, ActionQueueRow } from '../../../lib/home/types';
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
  kinds: {
    SEND_FAILED: 'KIND_SEND_FAILED',
    APPROVAL_PENDING: 'KIND_APPROVAL_PENDING',
    GATE_FAILED: 'KIND_GATE_FAILED',
    SEND_HELD: 'KIND_SEND_HELD',
    PROPOSAL_REQUEST_PENDING: 'KIND_REQUEST',
  },
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
    ...overrides,
  };
}

function blockOf(rows: readonly ActionQueueRow[]): ActionQueueHomeBlock {
  return { kind: 'ACTION_QUEUE', targetIds: rows.map((item) => item.targetId), items: rows };
}

function render(rows: readonly ActionQueueRow[], scope: 'mine' | 'all' = 'mine'): string {
  return renderToStaticMarkup(
    createElement(ActionQueueSection, {
      initial: blockOf(rows),
      initialChangedSince: NOW,
      scope,
      scopeHrefs: { mine: '/', all: '/?scope=all' },
      messages: MESSAGES,
      pollIntervalMs: 0,
    }),
  );
}

const ROWS: readonly ActionQueueRow[] = [
  row('SEND_FAILED', 's1', { href: '/proposals/send-failures' }),
  row('APPROVAL_PENDING', 'a1', { href: '/proposals/a1/approve', since: '2026-09-16T02:15:00.000Z' }),
  row('GATE_FAILED', 'g1', { href: '/proposals/g1/edit' }),
  row('SEND_HELD', 'h1', { href: '/proposals?state=APPROVED' }),
  row('PROPOSAL_REQUEST_PENDING', 'r1', {
    href: '/proposal-requests',
    counterpartyLabel: null,
    deadline: '2026-09-18T03:00:00.000Z',
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
});

describe('③ ④ モバイルの 3 要素と折りたたみ・合計の不在', () => {
  it('🔴 `<details>` を使わない（セクション 1〜4 を折りたたまない）', () => {
    expect(render(ROWS)).not.toContain('<details');
  });

  it('🔴 種別バッジ / 対象 / 経過時間は `hidden` を持たず、相手 / 期限だけが sm 未満で隠れる', () => {
    const html = render(ROWS);
    const elementOf = (testId: string): string => {
      const match = html.match(new RegExp(`<[a-z]+[^>]*data-testid="${testId}"[^>]*>`));
      if (match === null) throw new Error(`${testId} が無い`);
      return match[0];
    };
    const classesOf = (element: string): readonly string[] => element.match(/class="([^"]*)"/)?.[1]?.split(/\s+/) ?? [];
    for (const id of ['kind', 'subject', 'time']) {
      expect(classesOf(elementOf(`home-action-queue-${id}-a1`)), id).not.toContain('hidden');
    }
    for (const id of ['counterparty', 'deadline']) {
      const classes = classesOf(elementOf(`home-action-queue-${id}-a1`));
      expect(classes, id).toContain('hidden');
      expect(classes, id).toContain('sm:inline');
    }
  });

  it('🔴 種別ごとの件数を 1 つの合計に丸めた表示（「N 件」）が無い', () => {
    expect(render(ROWS)).not.toMatch(/[0-9０-９]+\s*件/);
  });
});

describe('⑤ mergeActionQueueDelta — 差分の合成（画面全体を再描画しない）', () => {
  it('差分の行で上書きし、targetIds に無い行を落とし、順は targetIds に従う', () => {
    const previous = [row('APPROVAL_PENDING', 'a1'), row('GATE_FAILED', 'g1'), row('GATE_FAILED', 'g2')];
    const delta: ActionQueueHomeBlock = {
      kind: 'ACTION_QUEUE',
      targetIds: ['g2', 'a1'],
      items: [row('GATE_FAILED', 'g2', { subjectLabel: 'updated' })],
    };
    const merged = mergeActionQueueDelta(previous, delta);
    expect(merged?.map((item) => item.targetId)).toEqual(['g2', 'a1']);
    expect(merged?.[0]?.subjectLabel).toBe('updated');
    expect(merged?.[1]).toEqual(previous[0]);
  });

  it('🔴 targetIds にあるのに手元にも差分にも無い行があれば null（全行の読み直しが要る。黙って欠けた行を描かない）', () => {
    const previous = [row('APPROVAL_PENDING', 'a1')];
    expect(mergeActionQueueDelta(previous, { kind: 'ACTION_QUEUE', targetIds: ['a1', 'x9'], items: [] })).toBeNull();
  });
});
