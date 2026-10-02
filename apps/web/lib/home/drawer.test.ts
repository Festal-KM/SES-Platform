// apps/web/lib/home/drawer.test.ts
// 🔴 T-22-10: 要対応キューの行の `内容を見る`（`Drawer`）の中身。
//
// 固定するもの（`docs/04` §4.1 `S-003` 操作表 / §S-004 / §5-13 / §11-25 / docs/05 §6.11.3 /
// `SP-22` §6 の `T-22-10` 受け入れ基準 1・2）:
//   ① 🔴 **実行系のアクションを置けない** —— 戻り値の型に `action` のキーが無い（型 + 実体の両方）
//   ② 🔴 **依頼の行に凍結情報の欄と履歴が無い** —— 型として持たない（凍結は応諾で初めて起きる）
//   ③ 🔴 **実名・所属会社名・スキルシート・凍結情報のキーを持たない**（経路 4。`CLAUDE.md` §7 の 0 件）
//   ④ 出す項目は `docs/04` §4.1 の列挙そのまま（対象 / 相手 / 状態 / 経過時間 / 期限 + 履歴 3 行）
//   ⑤ 履歴は **日時 / 出来事 / 遷移**だけで、**メモ・理由・失敗種別の本文を含めない**
//   ⑥ 履歴の「読み込み中」「取得できなかった」「0 件」が**別の語**になる（失敗を空に見せない）
import { describe, expect, it } from 'vitest';
import {
  ACTION_QUEUE_DRAWER_HISTORY_LIMIT,
  actionQueueDrawerView,
  hasProposalDrawerHistory,
  proposalDrawerHistoryLines,
  type ActionQueueDrawerEvent,
  type ActionQueueDrawerHistoryMessages,
  type ActionQueueDrawerMessages,
  type ActionQueueDrawerValues,
  type ActionQueueDrawerView,
} from './drawer';
import type { ActionQueueKind, ActionQueueRow } from './types';
import type { ProposalEventView } from '../proposals/views';

const MESSAGES: ActionQueueDrawerMessages = {
  fieldSubject: 'F_SUBJECT',
  fieldCounterparty: 'F_COUNTERPARTY',
  fieldState: 'F_STATE',
  fieldTime: 'F_TIME',
  fieldDeadline: 'F_DEADLINE',
  detailLink: 'DETAIL_LINK',
  historyLoading: 'HISTORY_LOADING',
  historyFailed: 'HISTORY_FAILED',
  valueNone: 'NONE',
};

const VALUES: ActionQueueDrawerValues = { kind: 'KIND', state: 'STATE', time: 'TIME' };

const HISTORY_MESSAGES: ActionQueueDrawerHistoryMessages = {
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
  states: { DRAFT: 'S_DRAFT', APPROVAL_PENDING: 'S_APPROVAL_PENDING', APPROVED: 'S_APPROVED' },
  arrow: '>',
  valueNone: 'NONE',
};

function row(kind: ActionQueueKind, overrides: Partial<ActionQueueRow> = {}): ActionQueueRow {
  return {
    kind,
    targetId: 'target-1',
    subjectLabel: 'SUBJECT',
    counterpartyLabel: 'COUNTERPARTY',
    since: '2026-09-15T03:00:00.000Z',
    deadline: null,
    rowVersion: Date.parse('2026-09-15T03:00:00.000Z'),
    href: '/proposals/target-1/approve',
    stateBadge: { entity: 'PROPOSAL', state: 'APPROVAL_PENDING' },
    action: { kind: 'APPROVE', href: '/proposals/target-1/approve' },
    ...overrides,
  };
}

/** 入れ子を含めてキーを全部集める（③ の走査）。 */
function allKeys(value: unknown, found: Set<string> = new Set()): Set<string> {
  if (Array.isArray(value)) {
    for (const item of value) allKeys(item, found);
    return found;
  }
  if (value !== null && typeof value === 'object') {
    for (const [key, child] of Object.entries(value)) {
      found.add(key);
      allKeys(child, found);
    }
  }
  return found;
}

describe('🔴 Drawer の中身（docs/04 §4.1 / §5-13 / docs/05 §6.11.3）', () => {
  it('④ 提案の行は 5 項目 + 履歴 + 遷移 1 本で、項目は docs/04 の列挙そのまま', () => {
    const view = actionQueueDrawerView(row('APPROVAL_PENDING'), VALUES, MESSAGES, {
      status: 'READY',
      lines: ['L1', 'L2'],
    });
    expect(view.variant).toBe('PROPOSAL');
    expect(view.title).toBe('KIND');
    expect(view.fields).toEqual([
      { label: 'F_SUBJECT', value: 'SUBJECT' },
      { label: 'F_COUNTERPARTY', value: 'COUNTERPARTY' },
      { label: 'F_STATE', value: 'STATE' },
      { label: 'F_TIME', value: 'TIME' },
      { label: 'F_DEADLINE', value: 'NONE' },
    ]);
    expect(view.detailLink).toEqual({ href: '/proposals/target-1/approve', label: 'DETAIL_LINK' });
    expect(view.variant === 'PROPOSAL' ? view.history : null).toEqual(['L1', 'L2']);
  });

  it('期限がある行は JST の整形済みの値を出す（相手が無ければ `—`）', () => {
    const view = actionQueueDrawerView(
      row('PROPOSAL_REQUEST_PENDING', { counterpartyLabel: null, deadline: '2026-09-20T03:00:00.000Z' }),
      VALUES,
      MESSAGES,
      { status: 'LOADING' },
    );
    expect(view.fields[1]).toEqual({ label: 'F_COUNTERPARTY', value: 'NONE' });
    expect(view.fields[4]).toEqual({ label: 'F_DEADLINE', value: '2026-09-20 12:00 JST' });
  });

  it('🔴 ② 依頼の行には `history` のキーが無い（凍結も履歴も「まだ入っていない」段階である）', () => {
    const view = actionQueueDrawerView(
      row('PROPOSAL_REQUEST_PENDING', { counterpartyLabel: null }),
      VALUES,
      MESSAGES,
      { status: 'READY', lines: ['L1'] },
    );
    expect(view.variant).toBe('PROPOSAL_REQUEST');
    expect('history' in view).toBe(false);
    // 型の側でも到達できない（`variant` で絞らないと `history` を読めない）。
    // @ts-expect-error 🔴 依頼の行のビューに `history` は存在しない
    expect(view.history).toBeUndefined();
  });

  it('🔴 ① 戻り値に `action` のキーが無い（実行系を置けないことを型と実体の両方で示す）', () => {
    for (const kind of ['APPROVAL_PENDING', 'GATE_FAILED', 'SEND_FAILED', 'SEND_HELD', 'PROPOSAL_REQUEST_PENDING'] as const) {
      const view = actionQueueDrawerView(row(kind), VALUES, MESSAGES, { status: 'READY', lines: [] });
      const keys = allKeys(view);
      expect([...keys].filter((key) => key === 'action'), kind).toEqual([]);
      // 型の側（`action` は `ActionQueueRow` が持つもので、ビューには無い）。
      // @ts-expect-error 🔴 Drawer のビューに `action` は存在しない（docs/05 §6.11.3）
      expect(view.action).toBeUndefined();
    }
  });

  it('🔴 ③ 実名 / 所属会社名 / 凍結情報 / スキルシートのキーが 1 つも現れない', () => {
    const forbidden = [
      'engineerId',
      'engineerName',
      'engineerDisplayName',
      'displayName',
      'companyName',
      'partnerCompanyId',
      'partnerCompanyName',
      'snapshotId',
      'engineerSnapshotId',
      'skillSheetId',
      'skillSheetUrl',
      'careers',
      'skills',
    ];
    for (const kind of ['APPROVAL_PENDING', 'PROPOSAL_REQUEST_PENDING'] as const) {
      const keys = allKeys(
        actionQueueDrawerView(row(kind), VALUES, MESSAGES, { status: 'READY', lines: ['L1'] }),
      );
      expect([...keys].filter((key) => forbidden.includes(key)), kind).toEqual([]);
    }
  });

  it('🔴 履歴を持つ種別は提案の 4 つだけ（列挙で判定する）', () => {
    expect(hasProposalDrawerHistory('APPROVAL_PENDING')).toBe(true);
    expect(hasProposalDrawerHistory('GATE_FAILED')).toBe(true);
    expect(hasProposalDrawerHistory('SEND_FAILED')).toBe(true);
    expect(hasProposalDrawerHistory('SEND_HELD')).toBe(true);
    expect(hasProposalDrawerHistory('PROPOSAL_REQUEST_PENDING')).toBe(false);
    // 🔴 Phase 2 が種別を足したとき、黙って「提案の行」側に倒れない（列挙に無い値は false）。
    expect(hasProposalDrawerHistory('EXTENSION_REVIEW' as ActionQueueKind)).toBe(false);
  });

  it('🔴 ⑥ 読み込み中 / 取得失敗 / 0 件が別の語になる', () => {
    const view = (history: Parameters<typeof actionQueueDrawerView>[3]) => {
      const built = actionQueueDrawerView(row('GATE_FAILED'), VALUES, MESSAGES, history);
      return built.variant === 'PROPOSAL' ? built.history : [];
    };
    expect(view({ status: 'LOADING' })).toEqual(['HISTORY_LOADING']);
    expect(view({ status: 'FAILED' })).toEqual(['HISTORY_FAILED']);
    expect(view({ status: 'READY', lines: [] })).toEqual(['NONE']);
  });
});

describe('🔴 履歴 3 行の組み立て（docs/05 §6.11.3）', () => {
  function event(overrides: Partial<ActionQueueDrawerEvent> = {}): ActionQueueDrawerEvent {
    return {
      occurredAt: '2026-09-15T03:00:00.000Z',
      fromState: 'APPROVAL_PENDING',
      toState: 'APPROVED',
      entry: { kind: 'TRANSITION' },
      ...overrides,
    };
  }

  it('直近 3 件だけを古い順のまま出す（並べ替えない / 既定の上限は 3）', () => {
    expect(ACTION_QUEUE_DRAWER_HISTORY_LIMIT).toBe(3);
    const events = [1, 2, 3, 4, 5].map((n) =>
      event({ occurredAt: `2026-09-1${String(n)}T03:00:00.000Z` }),
    );
    expect(proposalDrawerHistoryLines(events, HISTORY_MESSAGES)).toEqual([
      '2026-09-13 12:00 JST K_TRANSITION S_APPROVAL_PENDING>S_APPROVED',
      '2026-09-14 12:00 JST K_TRANSITION S_APPROVAL_PENDING>S_APPROVED',
      '2026-09-15 12:00 JST K_TRANSITION S_APPROVAL_PENDING>S_APPROVED',
    ]);
  });

  it('作成（null → DRAFT）と却下（APPROVAL_PENDING → DRAFT）は遷移の中でも語が分かれる', () => {
    expect(
      proposalDrawerHistoryLines([event({ fromState: null, toState: 'DRAFT' })], HISTORY_MESSAGES),
    ).toEqual(['2026-09-15 12:00 JST K_CREATED NONE>S_DRAFT']);
    expect(
      proposalDrawerHistoryLines(
        [event({ fromState: 'APPROVAL_PENDING', toState: 'DRAFT' })],
        HISTORY_MESSAGES,
      ),
    ).toEqual(['2026-09-15 12:00 JST K_REJECT S_APPROVAL_PENDING>S_DRAFT']);
  });

  it('状態を動かさない出来事は遷移を出さない（メモ / 下書きの更新）', () => {
    expect(
      proposalDrawerHistoryLines(
        [event({ fromState: null, toState: null, entry: { kind: 'NOTE' } })],
        HISTORY_MESSAGES,
      ),
    ).toEqual(['2026-09-15 12:00 JST K_NOTE']);
    expect(
      proposalDrawerHistoryLines(
        [event({ fromState: null, toState: null, entry: { kind: 'DRAFT_UPDATED' } })],
        HISTORY_MESSAGES,
      ),
    ).toEqual(['2026-09-15 12:00 JST K_DRAFT_UPDATED']);
  });

  it('🔴 ⑤ メモ・再送理由・失敗種別の本文を 1 文字も含めない（要約であり、本文は `S-023` で読む）', () => {
    const detailed: readonly ProposalEventView[] = [
      {
        id: 'e1',
        occurredAt: '2026-09-15T03:00:00.000Z',
        actor: { kind: 'USER', displayName: '山田 太郎' },
        kind: 'NOTE',
        fromState: null,
        toState: null,
        entry: { kind: 'NOTE', note: '単価は 85 万円で調整中。エンド企業は架空商事' },
        attachmentKey: 'skill-sheet-1',
      },
      {
        id: 'e2',
        occurredAt: '2026-09-15T04:00:00.000Z',
        actor: { kind: 'SYSTEM' },
        kind: 'STATE',
        fromState: 'SUBMIT_FAILED',
        toState: 'APPROVED',
        entry: { kind: 'RESEND', reason: '宛先の誤りを修正したため' },
        attachmentKey: null,
      },
    ];
    // 🔴 `ProposalEventView`（#46 の応答）がそのまま材料として渡せる（型の突き合わせ）。
    const lines = proposalDrawerHistoryLines(detailed, HISTORY_MESSAGES);
    expect(lines).toEqual([
      '2026-09-15 12:00 JST K_NOTE',
      // `SUBMIT_FAILED` は合成の写像に無いので生値のまま（語を作らず握り潰さない）。
      '2026-09-15 13:00 JST K_RESEND SUBMIT_FAILED>S_APPROVED',
    ]);
    const joined = lines.join('\n');
    for (const leak of ['85 万円', '架空商事', '宛先の誤り', '山田 太郎', 'skill-sheet-1']) {
      expect(joined, `要約に本文が混ざりました: ${leak}`).not.toContain(leak);
    }
  });

  it('上限 0 なら 1 行も出さない（0 件の扱いは呼び出し側が決める）', () => {
    expect(proposalDrawerHistoryLines([event()], HISTORY_MESSAGES, 0)).toEqual([]);
  });

  it('未知の状態は語を作らずそのまま出す（握り潰さない）', () => {
    const view: ActionQueueDrawerView = actionQueueDrawerView(
      row('APPROVAL_PENDING'),
      VALUES,
      MESSAGES,
      {
        status: 'READY',
        lines: proposalDrawerHistoryLines(
          [event({ fromState: null, toState: 'SUBMITTING' })],
          HISTORY_MESSAGES,
        ),
      },
    );
    expect(view.variant === 'PROPOSAL' ? view.history : []).toEqual([
      '2026-09-15 12:00 JST K_TRANSITION NONE>SUBMITTING',
    ]);
  });
});
