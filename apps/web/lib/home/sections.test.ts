// apps/web/lib/home/sections.test.ts
// 🔴 `要対応` タブの**セクションの割り当てと並び**（`./sections.ts`）と、`FOLLOW_UP` の行の
//    組み立て（`./action-queue.ts` の ✅ 2026-10-11 分）を固定する。人間の仕様 2026-10-11。
//
// なぜ要るか: 🔴 **「今日やること」と「返信待ち」に同じ行が二重に出ない**ことと、
// **セクションの並びが人間の仕様どおりである**ことが、この画面の読み方そのものである
// （`docs/04` §4.1 の 🔴「重複して出すと件数が二重に見え、KPI カード 1 と 2 の足し算が合わない」）。
import { describe, expect, it } from 'vitest';
import { PROPOSAL_STATES } from '@ses/domain';
import type { HostProposalListItem } from '../proposals/views';
import {
  buildFollowUpBlock,
  sortFollowUpRows,
  toFollowUpActionRow,
  toProposalActionRow,
} from './action-queue';
import { homeSectionAnchorId } from './hrefs';
import {
  FOLLOW_UP_KIND_ORDER,
  FOLLOW_UP_SECTION_ICONS,
  FOLLOW_UP_SECTION_OF_KIND,
  FOLLOW_UP_SECTION_SEE_ALL_HREFS,
  followUpKindOfState,
  HOME_SECTIONS,
  homeActionsTabCount,
  isFollowUpKind,
  toHomeSections,
} from './sections';
import type { ActionQueueRow } from './types';

const PROJECT = { id: '01930000-0000-7000-8000-0000000000f1', name: 'Project A Published' };

function hostItem(overrides: Partial<HostProposalListItem> & { readonly id: string }): HostProposalListItem {
  return {
    audience: 'HOST',
    owner: { kind: 'PARTNER', partnerCompanyName: 'Partner A1' },
    sendHold: null,
    lastFailureReason: null,
    sendAttempts: [],
    state: 'DRAFT',
    origin: 'OWN',
    project: PROJECT,
    recipient: { companyName: 'Client Co', email: 'client@example.test' },
    engineerDisplayName: 'Frozen Name',
    offeredUnitPrice: 700000,
    createdByName: 'Host A',
    createdAt: '2026-09-16T00:00:00.000Z',
    updatedAt: '2026-09-16T01:00:00.000Z',
    ...overrides,
  };
}

const NOW = Date.parse('2026-10-11T00:00:00.000Z');

describe('🔴 `今日やること` と `FOLLOW_UP` の行が重複しない（状態の集合が交わらない）', () => {
  it('どの提案状態も、要対応キューと FOLLOW_UP の**どちらか一方**にしか載らない', () => {
    for (const state of PROPOSAL_STATES) {
      const item = hostItem({ id: `p-${state}`, state });
      const inQueue = toProposalActionRow(item) !== null;
      const inFollowUp = toFollowUpActionRow(item) !== null;
      expect(inQueue && inFollowUp, `${state} が両方に載りました`).toBe(false);
    }
  });

  it('🔴 終端（`WON` / `LOST` / `WITHDRAWN`）はどちらにも載らない（`F-024 AC-2` / `BR-23`）', () => {
    for (const state of ['WON', 'LOST', 'WITHDRAWN'] as const) {
      expect(toFollowUpActionRow(hostItem({ id: `p-${state}`, state }))).toBeNull();
      expect(toProposalActionRow(hostItem({ id: `p-${state}`, state }))).toBeNull();
    }
  });

  it('🔴 `DRAFT` / `GATE_RUNNING` / `SUBMITTING` は FOLLOW_UP に載らない（まだ送っていない / 送信中）', () => {
    for (const state of ['DRAFT', 'GATE_RUNNING', 'SUBMITTING'] as const) {
      expect(toFollowUpActionRow(hostItem({ id: `p-${state}`, state }))).toBeNull();
    }
  });
});

describe('🔴 FOLLOW_UP の 3 セクションの母集団（状態 → 種別）', () => {
  it('`SUBMITTED` = 返信待ち / `INTERVIEW_SCHEDULED` = 面談調整中 / `INTERVIEWED` と `RESULT_PENDING` = 提案後フォロー', () => {
    expect(followUpKindOfState('SUBMITTED')).toBe('AWAITING_REPLY');
    expect(followUpKindOfState('INTERVIEW_SCHEDULED')).toBe('INTERVIEW_COORDINATION');
    expect(followUpKindOfState('INTERVIEWED')).toBe('PROPOSAL_FOLLOW_UP');
    expect(followUpKindOfState('RESULT_PENDING')).toBe('PROPOSAL_FOLLOW_UP');
    expect(followUpKindOfState('APPROVAL_PENDING')).toBeNull();
  });

  it('🔴 `返信待ち` の行は操作を持たない（催促のボタンをホームに置かない）', () => {
    const row = toFollowUpActionRow(hostItem({ id: 'p-1', state: 'SUBMITTED' }));
    expect(row?.action).toBeNull();
    // 行のクリック先は提案詳細（履歴と相手が在る場所）。
    expect(row?.href).toBe('/proposals/p-1');
  });

  it('🔴 `面談調整中` / `提案後フォロー` の操作は `RECORD`（`S-024` への**遷移**）', () => {
    for (const state of ['INTERVIEW_SCHEDULED', 'INTERVIEWED', 'RESULT_PENDING'] as const) {
      const row = toFollowUpActionRow(hostItem({ id: 'p-2', state }));
      expect(row?.action).toEqual({ kind: 'RECORD', href: '/proposals/p-2/interview' });
      expect(row?.href).toBe('/proposals/p-2/interview');
    }
  });

  it('🔴 行のキーは要対応キューと同じ 10 個（優先度・件数・順位のキーを足していない）', () => {
    const row = toFollowUpActionRow(hostItem({ id: 'p-3', state: 'SUBMITTED' }));
    expect(Object.keys(row ?? {}).sort()).toEqual([
      'action',
      'counterpartyLabel',
      'deadline',
      'href',
      'kind',
      'rowVersion',
      'since',
      'stateBadge',
      'subjectLabel',
      'targetId',
    ]);
  });

  it('🔴 期限を持たない（提案に期限の列が無い。架空の期限を作らない）', () => {
    expect(toFollowUpActionRow(hostItem({ id: 'p-4', state: 'SUBMITTED' }))?.deadline).toBeNull();
  });

  it('状態バッジは実状態を返す（種別ではない）', () => {
    expect(toFollowUpActionRow(hostItem({ id: 'p-5', state: 'RESULT_PENDING' }))?.stateBadge).toEqual({
      entity: 'PROPOSAL',
      state: 'RESULT_PENDING',
    });
  });
});

describe('🔴 FOLLOW_UP の並び（セクションの順 → 放置が長い順 → targetId）', () => {
  const rows = [
    toFollowUpActionRow(hostItem({ id: 'b', state: 'INTERVIEWED', updatedAt: '2026-10-01T00:00:00.000Z' })),
    toFollowUpActionRow(hostItem({ id: 'a', state: 'SUBMITTED', updatedAt: '2026-10-05T00:00:00.000Z' })),
    toFollowUpActionRow(hostItem({ id: 'c', state: 'SUBMITTED', updatedAt: '2026-09-28T00:00:00.000Z' })),
    toFollowUpActionRow(hostItem({ id: 'd', state: 'INTERVIEW_SCHEDULED', updatedAt: '2026-10-02T00:00:00.000Z' })),
  ].filter((row): row is ActionQueueRow => row !== null);

  it('セクションの順は 返信待ち → 面談調整中 → 提案後フォロー（人間の仕様の順）', () => {
    expect(FOLLOW_UP_KIND_ORDER).toEqual([
      'AWAITING_REPLY',
      'INTERVIEW_COORDINATION',
      'PROPOSAL_FOLLOW_UP',
    ]);
    const sorted = sortFollowUpRows(rows);
    expect(sorted.map((row) => row.kind)).toEqual([
      'AWAITING_REPLY',
      'AWAITING_REPLY',
      'INTERVIEW_COORDINATION',
      'PROPOSAL_FOLLOW_UP',
    ]);
  });

  it('🔴 セクションの中は放置が長い順（= 優先度が高い順）', () => {
    expect(sortFollowUpRows(rows).map((row) => row.targetId)).toEqual(['c', 'a', 'd', 'b']);
  });

  it('🔴 ブロックは 3 キーだけで、`targetIds` が `items` の順と一致する（毎回全量）', () => {
    const block = buildFollowUpBlock(sortFollowUpRows(rows));
    expect(Object.keys(block).sort()).toEqual(['items', 'kind', 'targetIds']);
    expect(block.targetIds).toEqual(block.items.map((row) => row.targetId));
    // 🔴 `actionAvailability` を持たない（`ACTION_QUEUE` が全量で返すものを 2 箇所に置かない）。
    expect(block).not.toHaveProperty('actionAvailability');
  });
});

describe('🔴 セクションの組み立て（`toHomeSections`）', () => {
  const queue: readonly ActionQueueRow[] = [
    toProposalActionRow(hostItem({ id: 'q1', state: 'APPROVAL_PENDING' })),
    toProposalActionRow(hostItem({ id: 'q2', state: 'GATE_FAILED' })),
  ].filter((row): row is ActionQueueRow => row !== null);
  const followUp = sortFollowUpRows(
    [
      toFollowUpActionRow(hostItem({ id: 'f1', state: 'SUBMITTED', updatedAt: '2026-10-01T00:00:00.000Z' })),
      toFollowUpActionRow(hostItem({ id: 'f2', state: 'INTERVIEWED', updatedAt: '2026-09-01T00:00:00.000Z' })),
    ].filter((row): row is ActionQueueRow => row !== null),
  );

  it('4 セクションが**常に**返る（0 件でも捨てない。描く判断は画面側の 1 箇所）', () => {
    const sections = toHomeSections(queue, followUp, NOW);
    expect(sections.map((section) => section.section)).toEqual([...HOME_SECTIONS]);
    expect(HOME_SECTIONS).toEqual([
      'TODAY',
      'AWAITING_REPLY',
      'INTERVIEW_COORDINATION',
      'PROPOSAL_FOLLOW_UP',
    ]);
    expect(sections.find((section) => section.section === 'INTERVIEW_COORDINATION')?.rows).toEqual([]);
  });

  it('🔴 `今日やること` はサーバの順をそのまま保つ（クライアントで並べ替えない）', () => {
    const today = toHomeSections(queue, followUp, NOW).find((section) => section.section === 'TODAY');
    expect(today?.rows.map((entry) => entry.row.targetId)).toEqual(['q1', 'q2']);
  });

  it('🔴 行に優先度が付く（導出。`./priority.ts`）', () => {
    const sections = toHomeSections(queue, followUp, NOW);
    // `f2` は 2026-09-01 更新 = 40 日放置 → HIGH。`f1` は 10 日放置 → HIGH。
    expect(sections.find((s) => s.section === 'PROPOSAL_FOLLOW_UP')?.rows[0]?.priority).toBe('HIGH');
    // 要対応キューの行は 2026-09-16 更新（25 日放置）→ HIGH。
    expect(sections.find((s) => s.section === 'TODAY')?.rows[0]?.priority).toBe('HIGH');
  });

  it('アンカー id はフラグメント用の 1 実装から来る', () => {
    const sections = toHomeSections(queue, followUp, NOW);
    expect(sections.map((section) => section.anchorId)).toEqual([
      homeSectionAnchorId('TODAY'),
      homeSectionAnchorId('AWAITING_REPLY'),
      homeSectionAnchorId('INTERVIEW_COORDINATION'),
      homeSectionAnchorId('PROPOSAL_FOLLOW_UP'),
    ]);
    expect(homeSectionAnchorId('AWAITING_REPLY')).toBe('home-section-awaiting-reply');
  });

  it('🔴 タブの件数は `今日やること` の件数だけ（性質の違う仕事を 1 つの合計に丸めない）', () => {
    // 🔴 `queue` は 2 件 / `followUp` は 2 件だが、タブの数は **2** である。
    expect(homeActionsTabCount(toHomeSections(queue, followUp, NOW))).toBe(2);
    expect(homeActionsTabCount(toHomeSections([], followUp, NOW))).toBe(0);
    expect(homeActionsTabCount(toHomeSections([], [], NOW))).toBe(0);
  });

  it('🔴 タブの件数が KPI カード 1（`今日やること`）と必ず一致する（同じ画面で矛盾しない）', () => {
    const sections = toHomeSections(queue, followUp, NOW);
    const today = sections.find((section) => section.section === 'TODAY');
    expect(homeActionsTabCount(sections)).toBe(today?.rows.length);
  });

  it('🔴 種別 → セクションは 1 対 1 で、要対応キューの 5 種別は FOLLOW_UP に入らない', () => {
    expect(Object.keys(FOLLOW_UP_SECTION_OF_KIND).sort()).toEqual([
      'AWAITING_REPLY',
      'INTERVIEW_COORDINATION',
      'PROPOSAL_FOLLOW_UP',
    ]);
    for (const kind of [
      'SEND_FAILED',
      'APPROVAL_PENDING',
      'GATE_FAILED',
      'SEND_HELD',
      'PROPOSAL_REQUEST_PENDING',
    ] as const) {
      expect(isFollowUpKind(kind)).toBe(false);
    }
  });
});

describe('🔴 セクションの `すべて見る` は母集団と同じフィルタを開く', () => {
  it('遷移先の状態フィルタが `FOLLOW_UP_PROPOSAL_STATES` と一致する', () => {
    expect(FOLLOW_UP_SECTION_SEE_ALL_HREFS.AWAITING_REPLY).toBe('/proposals?state=SUBMITTED');
    expect(FOLLOW_UP_SECTION_SEE_ALL_HREFS.INTERVIEW_COORDINATION).toBe(
      '/proposals?state=INTERVIEW_SCHEDULED',
    );
    expect(FOLLOW_UP_SECTION_SEE_ALL_HREFS.PROPOSAL_FOLLOW_UP).toBe(
      '/proposals?state=INTERVIEWED&state=RESULT_PENDING',
    );
  });

  it('アイコンは `docs/04` §4.1 の指定どおり（比喩アイコンを使わない）', () => {
    expect(FOLLOW_UP_SECTION_ICONS).toEqual({
      AWAITING_REPLY: 'clock',
      INTERVIEW_COORDINATION: 'calendar-clock',
      PROPOSAL_FOLLOW_UP: 'send',
    });
  });
});
