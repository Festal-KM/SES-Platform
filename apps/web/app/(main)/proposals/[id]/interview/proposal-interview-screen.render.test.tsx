// apps/web/app/(main)/proposals/[id]/interview/proposal-interview-screen.render.test.tsx
// `ProposalInterviewScreen`（`S-024`）の描画テスト。T-09-10。
//
// 🔴 ここで固定するもの:
//   ① 状態ごとの操作の出し分け（props の `operations` をそのまま描く。SUBMITTED = 日程 + 辞退 / RESULT_PENDING = 決定 + 見送り + 辞退）。
//      終端の操作は `data-terminal="true"`
//   ② 🔴 取引先の rows（辞退だけ）では面談日程の確定・決定・見送りの testid が**存在しない**（`docs/04` §S-024 権限差分）
//   ③ VIEWER / 停止中はボタンを描かず理由を出す。未送信・終端は注記だけ（`WON` は Phase 2 の注記）
//   ④ 判断材料（提案先 / エンジニア / 案件 / 単価 / 開始日 / 現在の状態 / 直近の履歴）が同じ画面にあり、折りたたみ（`<details>`）・タブが無い
//   ⑤ 🔴 「自動で確定」「期限で見送り」「一括」に相当する語・testid が無い（`F-025 AC-1` / `BR-50`）
//
// 🔴 `react-dom/server` の `renderToStaticMarkup` を使う（他の render テストと同じ）。フォーム・確認ステップは操作後の状態なので E2E の射程。
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { ProposalTimelineRow } from '../../../../../lib/proposals/detail-rows';
import type { ProposalInterviewOperation, ProposalInterviewRows } from '../../../../../lib/proposals/interview-rows';
import { ProposalInterviewScreen, type ProposalInterviewScreenMessages, type ProposalInterviewScreenProps } from './proposal-interview-screen';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: () => undefined, refresh: () => undefined }),
}));

const ID = '01930000-0000-7000-8000-000000000a24';

const RECENT: readonly ProposalTimelineRow[] = [
  { id: 'e7', occurredAt: '2026-09-16 10:00 JST', actor: '担当 太郎', actorKind: 'USER', kind: 'TRANSITION', title: '状態の変更', transition: '送信済み → 面談日程調整中', detail: '面談日程: 2026-10-01 14:00', attachment: null },
  { id: 'e6', occurredAt: '2026-09-15 12:00 JST', actor: 'システム', actorKind: 'SYSTEM', kind: 'TRANSITION', title: '状態の変更', transition: '送信中 → 送信済み', detail: null, attachment: null },
  { id: 'e5', occurredAt: '2026-09-15 11:00 JST', actor: 'システム', actorKind: 'SYSTEM', kind: 'TRANSITION', title: '状態の変更', transition: '承認済み → 送信中', detail: null, attachment: null },
];

function operation(kind: ProposalInterviewOperation['kind'], to: ProposalInterviewOperation['to'], terminal: boolean): ProposalInterviewOperation {
  return {
    kind,
    to,
    label: `op:${kind}`,
    terminal,
    emphasis: kind === 'WITHDRAWN' || kind === 'LOST' ? 'SECONDARY' : 'PRIMARY',
    inputs: { scheduledAt: kind === 'SCHEDULE', interviewedOn: kind === 'INTERVIEWED', memo: terminal ? 'REASON' : 'MEMO' },
    confirmLead: terminal ? `confirm:${kind}` : null,
  };
}

const SCHEDULE = operation('SCHEDULE', 'INTERVIEW_SCHEDULED', false);
const WITHDRAWN = operation('WITHDRAWN', 'WITHDRAWN', true);
const WON = operation('WON', 'WON', true);
const LOST = operation('LOST', 'LOST', true);

function rows(overrides: Partial<ProposalInterviewRows> = {}): ProposalInterviewRows {
  return {
    id: ID,
    state: 'SUBMITTED',
    stateLabel: '送信済み',
    tone: 'success',
    audience: 'HOST',
    phase: 'RECORDABLE',
    header: [
      { field: 'recipient', label: '提案先', value: '架空エンド株式会社 / to@example.test', emphasis: 'NONE' },
      { field: 'engineer', label: 'エンジニア', value: '佐藤 花子（株式会社パートナー）', emphasis: 'NONE' },
      { field: 'project', label: '案件', value: '基幹刷新', emphasis: 'NONE' },
      { field: 'unit-price', label: '提示単価（月額・円）', value: '650,000', emphasis: 'NONE' },
      { field: 'start-date', label: '開始日', value: '2026-11-01', emphasis: 'NONE' },
    ],
    recent: RECENT,
    operations: [SCHEDULE, WITHDRAWN],
    closedNotice: null,
    assignmentNote: null,
    notRecordableNotice: null,
    audienceNotice: null,
    detailHref: `/proposals/${ID}`,
    ...overrides,
  };
}

const messages: ProposalInterviewScreenMessages = {
  lead: 'システムが結果を自動で確定することはありません。',
  sectionSummary: '対象の提案',
  sectionRecent: '直近の履歴',
  sectionOperations: '次に記録できる操作',
  fieldState: '現在の状態',
  recentEmpty: '履歴はまだありません。',
  recentOpenDetail: '履歴をすべて見る',
  backToDetail: '提案の詳細へ戻る',
  inputScheduledAt: '面談日時',
  inputInterviewedOn: '面談実施日',
  inputMemo: '要点（任意）',
  inputReason: '理由の要点（任意）',
  inputMemoHint: 'ここに書いた内容だけが履歴に残ります。',
  notePreview: '履歴に残る記録',
  notePreviewNone: '（記録の本文なし）',
  submit: '記録する',
  submitting: '記録しています…',
  cancel: 'キャンセル',
  confirmTitle: 'この記録は取り消せません',
  confirmSubmit: '確定する',
  confirmCancel: '戻る',
  recorded: '記録しました。',
  recordedStatePrefix: '現在の状態: ',
  operationsNone: 'いまの立場で記録できる操作はありません。',
  viewerNotice: '閲覧専用のロールでは商談結果を記録できません。',
  deniedTitle: '商談結果の記録を行えません。',
  errorValidation: '入力内容をご確認ください。',
  errorStatePrefix: 'この操作はいまの状態では実行できません（現在: ',
  errorStateSuffix: '）。',
  errorForbidden: 'この操作を行う権限がありません。',
  errorConflict: 'いまは記録を行えません。',
  errorGeneric: '記録できませんでした。',
};

const STATE_LABELS = {
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
} as const;

function render(overrides: Partial<ProposalInterviewScreenProps> = {}): string {
  const props: ProposalInterviewScreenProps = {
    proposalId: ID,
    rows: rows(),
    isViewer: false,
    denialMessage: null,
    noteLabels: { scheduled: '面談日程: ', interviewed: '面談実施: ', won: '結果: 決定', lost: '結果: 見送り', withdrawn: '辞退', separator: ' / ', reasonOpen: '（', reasonClose: '）' },
    memoMaxLength: 1000,
    stateLabels: STATE_LABELS,
    messages,
    ...overrides,
  };
  return renderToStaticMarkup(createElement(ProposalInterviewScreen, props));
}

const testids = (html: string): string[] => [...html.matchAll(/data-testid="([^"]+)"/g)].map((match) => match[1] ?? '');

describe('① 状態ごとの操作の出し分け（docs/04 §S-024）', () => {
  it('SUBMITTED（ホスト）: 面談日程の確定 + 辞退のボタン。実施・結果待ち・決定・見送りは無い', () => {
    const html = render();
    const ids = testids(html);
    expect(html).toContain('data-proposal-state="SUBMITTED"');
    expect(html).toContain('data-can-record="true"');
    expect(ids).toContain('proposal-interview-operations');
    expect(ids).toContain('proposal-interview-operation-SCHEDULE');
    expect(ids).toContain('proposal-interview-operation-WITHDRAWN');
    for (const kind of ['INTERVIEWED', 'RESULT_PENDING', 'WON', 'LOST']) expect(ids).not.toContain(`proposal-interview-operation-${kind}`);
    expect(html).toContain('data-testid="proposal-interview-operation-SCHEDULE" data-to="INTERVIEW_SCHEDULED" data-terminal="false"');
    expect(html).toContain('data-testid="proposal-interview-operation-WITHDRAWN" data-to="WITHDRAWN" data-terminal="true"');
    // フォーム・確認ステップは操作前には無い。
    expect(ids).not.toContain('proposal-interview-form');
    expect(ids).not.toContain('proposal-interview-confirm');
  });

  it('RESULT_PENDING（ホスト）: 決定 / 見送り / 辞退の 3 つがすべて終端（確認ステップ付き）', () => {
    const html = render({ rows: rows({ state: 'RESULT_PENDING', stateLabel: '結果待ち', tone: 'progress', operations: [WON, LOST, WITHDRAWN] }) });
    for (const kind of ['WON', 'LOST', 'WITHDRAWN']) {
      expect(html).toContain(`data-testid="proposal-interview-operation-${kind}" data-to="${kind}" data-terminal="true"`);
    }
    expect(testids(html)).not.toContain('proposal-interview-operation-SCHEDULE');
  });
});

describe('② 🔴 取引先には面談日程の確定・決定・見送りのボタンが描かれない', () => {
  it('取引先の rows（辞退だけ）: SCHEDULE / WON / LOST の testid が無く、注記が出る', () => {
    const html = render({
      rows: rows({ audience: 'PARTNER', state: 'RESULT_PENDING', stateLabel: '結果待ち', tone: 'progress', operations: [WITHDRAWN], audienceNotice: '御社が作成した提案について…' }),
    });
    const ids = testids(html);
    expect(html).toContain('data-audience="PARTNER"');
    expect(ids).toContain('proposal-interview-partner-notice');
    expect(ids).toContain('proposal-interview-operation-WITHDRAWN');
    for (const kind of ['SCHEDULE', 'WON', 'LOST']) expect(ids).not.toContain(`proposal-interview-operation-${kind}`);
  });
});

describe('③ VIEWER / 停止中 / 未送信 / 終端', () => {
  it('VIEWER はボタンを描かず理由を出す', () => {
    const html = render({ isViewer: true });
    const ids = testids(html);
    expect(html).toContain('data-can-record="false"');
    expect(ids).toContain('proposal-interview-viewer');
    expect(ids.filter((id) => id.startsWith('proposal-interview-operation-'))).toEqual([]);
  });

  it('停止中（denialMessage）はボタンを描かず理由を出す', () => {
    const html = render({ denialMessage: 'この組織は停止中です。' });
    const ids = testids(html);
    expect(ids).toContain('proposal-interview-denied');
    expect(html).toContain('この組織は停止中です。');
    expect(ids.filter((id) => id.startsWith('proposal-interview-operation-'))).toEqual([]);
  });

  it('未送信（DRAFT）は注記だけ', () => {
    const html = render({ rows: rows({ state: 'DRAFT', stateLabel: '下書き', tone: 'neutral', phase: 'NOT_YET_SUBMITTED', operations: [], notRecordableNotice: 'まだ送信されていません。' }) });
    const ids = testids(html);
    expect(ids).toContain('proposal-interview-not-recordable');
    expect(ids).not.toContain('proposal-interview-operations');
    expect(ids).not.toContain('proposal-interview-viewer');
  });

  it('🔴 WON は終端の注記 + Phase 2 の注記。稼働を登録する導線・Assignment に相当する testid は無い（F-025 AC-2）', () => {
    const html = render({
      rows: rows({ state: 'WON', stateLabel: '決定', tone: 'success', phase: 'CLOSED', operations: [], closedNotice: '「決定」として記録されています。', assignmentNote: '稼働の登録は Phase 2 で接続されます。' }),
    });
    const ids = testids(html);
    expect(html).toContain('data-testid="proposal-interview-closed" data-closed-state="WON"');
    expect(ids).toContain('proposal-interview-won-note');
    expect(ids.filter((id) => id.startsWith('proposal-interview-operation-'))).toEqual([]);
    expect(ids.filter((id) => /assignment|稼働/.test(id))).toEqual([]);
    expect(html).not.toMatch(/稼働を登録する/);
  });

  it('LOST は終端の注記だけ（Phase 2 の注記は無い）', () => {
    const html = render({ rows: rows({ state: 'LOST', stateLabel: '見送り', tone: 'neutral', phase: 'CLOSED', operations: [], closedNotice: '「見送り」として記録されています。' }) });
    const ids = testids(html);
    expect(html).toContain('data-closed-state="LOST"');
    expect(ids).not.toContain('proposal-interview-won-note');
  });
});

describe('④ 判断材料が同じ画面にあり、折りたたみ・タブが無い（Tier 1 / CLAUDE.md §13.3）', () => {
  it('提案先 / エンジニア / 案件 / 単価 / 開始日 / 現在の状態 / 直近の履歴 3 件 / 詳細への導線', () => {
    const html = render();
    const ids = testids(html);
    for (const field of ['recipient', 'engineer', 'project', 'unit-price', 'start-date', 'state']) expect(ids).toContain(`proposal-interview-header-row-${field}`);
    expect(html).toContain('架空エンド株式会社');
    expect(html).toContain('650,000');
    expect(ids.filter((id) => id.startsWith('proposal-interview-recent-event-'))).toHaveLength(3);
    expect(html).toContain('面談日程: 2026-10-01 14:00');
    expect(ids).toContain('proposal-interview-recent-open-detail');
    expect(ids).toContain('proposal-interview-back-to-detail');
    expect(ids).toContain('proposal-interview-lead');
    expect(html).not.toContain('<details');
    expect(html).not.toContain('role="tab"');
  });

  it('履歴が 0 件なら空の注記', () => {
    const html = render({ rows: rows({ recent: [] }) });
    expect(testids(html)).toContain('proposal-interview-recent-empty');
  });
});

describe('⑤ 🔴 自動確定・一括に相当する語・testid が無い（F-025 AC-1 / BR-50）', () => {
  it.each([
    ['SUBMITTED', rows()],
    ['RESULT_PENDING', rows({ state: 'RESULT_PENDING', operations: [WON, LOST, WITHDRAWN] })],
    ['WON', rows({ state: 'WON', phase: 'CLOSED', operations: [], closedNotice: '決定', assignmentNote: 'Phase 2' })],
  ] as const)('%s', (_label, value) => {
    const html = render({ rows: value });
    const ids = testids(html);
    expect(ids.filter((id) => /auto|bulk|force|override|skip|expire/.test(id))).toEqual([]);
    // 🔴 肯定形（「自動で確定します」）だけを禁じる。先頭の説明文は「自動で確定することはありません」と否定形で書いてある。
    expect(html).not.toMatch(/自動(で|的に)(確定|見送り|辞退)(します|されます|した|する仕組み)|期限で(自動|見送り)|一括/);
  });
});
