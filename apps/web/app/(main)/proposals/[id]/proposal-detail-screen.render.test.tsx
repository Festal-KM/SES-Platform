// apps/web/app/(main)/proposals/[id]/proposal-detail-screen.render.test.tsx
// `ProposalDetailScreen`（`S-023`）の描画テスト。T-09-09。
//
// 🔴 ここで固定するもの:
//   ① 履歴の描き分け: 作成 / 下書きの更新 / 承認（検査 #）/ 送信失敗（種別）/ 再送（理由）/ メモ / 却下 が `data-event-kind` の別値で描かれる。
//      自動承認の主体は「システム（全層 PASS のため）」（`F-021 AC-5`）
//   ② 却下由来の `DRAFT` の導線に「内容を変更してからレビューに出してください」（T-09-03 の申し送り）
//   ③ 取引先の描画に承認者 / 送信試行 / 保留 / 作成会社 / 重複提案の欄が無い（`BR-08` / `F-037 AC-1`）
//   ④ メモの導線は「立場 × 非 VIEWER × 実行可」のときだけ。VIEWER / 立場外 / 停止中はそれぞれ理由が出る
//   ⑤ 固定ヘッダに状態 + 提案先 + 単価（折りたたみの外）。凍結された経歴の見出しに日時が付く
//   ⑥ 🔴 「無視して送信」「最新の情報に更新」に相当する語・testid が無い（`BR-18` / `F-019 AC-5`）
//   ⑦ ✅ T-12-14 ②③: セクション 4「ゲート結果の履歴」が**実行ごとに分かれ**、AI の警告が不合格の指摘と**別の見出し**で描かれ、
//      `aiFailed` の行が「検査を完了できなかった」になる。履歴タイムライン・履歴とも **11 件で直近 10 件 + 「すべて表示」、10 件以下は全件**
//      （docs/04 §10.3 の共通規約。`@ses/ui` の `FoldedList`）
//
// 🔴 `react-dom/server` の `renderToStaticMarkup` を使う（他の render テストと同じ）。
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { ApprovalGateRows } from '../../../../lib/proposals/approval-rows';
import type { ProposalDetailRows, ProposalGateHistoryItemRows, ProposalGateHistoryRows, ProposalTimelineRow } from '../../../../lib/proposals/detail-rows';
import { ProposalDetailScreen, type ProposalDetailScreenMessages, type ProposalDetailScreenProps } from './proposal-detail-screen';

// 🔴 `useRouter`（メモの追加後に `router.refresh()`）は App Router の外では mount されていない（`S-021` の render テストと同じ措置）。
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: () => undefined, refresh: () => undefined }),
}));

const ID = '01930000-0000-7000-8000-000000000a01';

function timeline(overrides: Partial<ProposalTimelineRow> & Pick<ProposalTimelineRow, 'id' | 'kind' | 'title'>): ProposalTimelineRow {
  return {
    occurredAt: '2026-09-15 10:00 JST',
    actor: '担当 太郎',
    actorKind: 'USER',
    transition: null,
    detail: null,
    attachment: null,
    ...overrides,
  };
}

const TIMELINE: readonly ProposalTimelineRow[] = [
  timeline({ id: 'e1', kind: 'CREATED', title: '提案を作成' }),
  timeline({ id: 'e2', kind: 'DRAFT_UPDATED', title: '下書きを更新', detail: '変更した項目: 件名 / 本文' }),
  timeline({ id: 'e3', kind: 'TRANSITION', title: '状態の変更', transition: '下書き → 検査中' }),
  timeline({ id: 'e4', kind: 'APPROVAL', title: '承認', actor: 'システム（全層 PASS のため）', actorKind: 'SYSTEM', transition: '承認待ち → 承認済み', detail: '検査 #gate-1' }),
  timeline({ id: 'e5', kind: 'SEND_FAILURE', title: '送信失敗', actor: 'システム', actorKind: 'SYSTEM', transition: '送信中 → 送信失敗', detail: '種別: UNKNOWN:TimeoutError' }),
  timeline({ id: 'e6', kind: 'RESEND', title: '再送', transition: '送信失敗 → 承認済み', detail: '理由: 電話で未着を確認' }),
  timeline({ id: 'e7', kind: 'NOTE', title: 'メモ', detail: '先方に電話済み' }),
  timeline({ id: 'e8', kind: 'REJECT', title: '却下（下書きに差し戻し）', actor: '承認 花子', transition: '承認待ち → 下書き', detail: '単価を見直してください' }),
];

function rows(overrides: Partial<ProposalDetailRows> = {}): ProposalDetailRows {
  return {
    id: ID,
    state: 'APPROVAL_PENDING',
    stateLabel: '承認待ち',
    tone: 'warning',
    failureKind: null,
    fixed: { recipient: '架空エンド株式会社', unitPrice: '650,000' },
    header: [
      { field: 'recipient', label: '提案先', value: '架空エンド株式会社 / to@example.test', emphasis: 'NONE' },
      { field: 'engineer', label: 'エンジニア', value: '佐藤 花子（株式会社パートナー）', emphasis: 'NONE' },
      { field: 'owner', label: '作成した会社', value: 'Partner A1', emphasis: 'NONE' },
      { field: 'project', label: '案件', value: '基幹刷新', emphasis: 'NONE' },
      { field: 'unit-price', label: '提示単価（月額・円）', value: '650,000', emphasis: 'NONE' },
      { field: 'start-date', label: '開始日', value: '2026-11-01', emphasis: 'NONE' },
      { field: 'created-by', label: '作成者', value: '担当 太郎', emphasis: 'NONE' },
      { field: 'elapsed', label: '経過時間', value: '2 時間', emphasis: 'NONE' },
    ],
    approver: '承認 花子 / 2026-09-16 10:00 JST',
    submittedAt: null,
    sendHold: null,
    sendAttempts: { count: '1 回', last: '最終: 応答不明（UNKNOWN:TimeoutError）', items: [{ attemptSeq: 1, statusLabel: '応答不明', status: 'UNKNOWN', failureKind: 'UNKNOWN:TimeoutError', settledAt: '2026-09-16 10:31 JST' }] },
    lastFailureReason: 'UNKNOWN:TimeoutError',
    timeline: TIMELINE,
    frozen: {
      notice: 'ここに表示する内容は 2026-09-15 10:00 JST 時点で凍結された情報です。',
      subject: 'ご提案',
      body: '本文',
      attachment: '添付なし',
      careersTitle: '2026-09-15 10:00 JST 時点の経験内容 — 1 行',
      careers: [{ key: 'career-0', period: '2024-04〜継続中', role: 'PL', description: '基幹刷新', technologies: 'Java' }],
      careersEmpty: null,
    },
    gate: {
      execution: 'DONE',
      layers: [
        { key: 'pii', label: 'PII 層', state: 'PASS', verdictLabel: '合格' },
        { key: 'commerce', label: '商流層', state: 'PASS', verdictLabel: '合格' },
        { key: 'consistency', label: '整合層', state: 'PASS', verdictLabel: '合格' },
      ],
      findings: [],
      warnings: [],
      failed: false,
      allPassed: true,
      aiFailed: false,
      heldResetAt: null,
      lead: '全層 PASS',
    },
    actions: [{ key: 'APPROVAL', href: `/proposals/${ID}/approve`, label: '承認画面を開く', lead: null }],
    actionsEmpty: null,
    canAddNote: true,
    audienceNotice: null,
    ...overrides,
  };
}

const PASSED_GATE: ApprovalGateRows = {
  execution: 'DONE',
  layers: [
    { key: 'pii', label: 'PII 層', state: 'PASS', verdictLabel: '合格' },
    { key: 'commerce', label: '商流層', state: 'PASS', verdictLabel: '合格' },
    { key: 'consistency', label: '整合層', state: 'PASS', verdictLabel: '合格' },
  ],
  findings: [],
  warnings: [],
  failed: false,
  allPassed: true,
  aiFailed: false,
  heldResetAt: null,
  lead: '全層 PASS',
};

function historyItem(overrides: Partial<ProposalGateHistoryItemRows> & Pick<ProposalGateHistoryItemRows, 'reviewGateId'>): ProposalGateHistoryItemRows {
  return {
    execution: 'DONE',
    title: '実行日時: 2026-09-16 09:00 JST',
    contentNote: '以前の内容に対する結果',
    matchesCurrentContent: false,
    gate: PASSED_GATE,
    ...overrides,
  };
}

const GATE_HISTORY: ProposalGateHistoryRows = {
  items: [
    historyItem({ reviewGateId: 'gate-2', title: '実行日時: 2026-09-16 09:30 JST', contentNote: '現在の内容に対する結果', matchesCurrentContent: true }),
    historyItem({
      reviewGateId: 'gate-1',
      gate: {
        ...PASSED_GATE,
        layers: [
          { key: 'pii', label: 'PII 層', state: 'FAIL', verdictLabel: '不合格' },
          { key: 'commerce', label: '商流層', state: 'PASS', verdictLabel: '合格' },
          { key: 'consistency', label: '整合層', state: 'FAIL', verdictLabel: '不合格' },
        ],
        findings: [
          { key: 'f-pii', fieldLabel: '本文', kind: 'FULL_NAME', excerpt: '[氏名が残っています]', locationNote: null },
          { key: 'f-cons', fieldLabel: '凍結情報（経験内容）', kind: 'MUST_REQUIREMENT_MISMATCH', excerpt: 'TypeScript -/3.0', locationNote: null },
        ],
        warnings: [{ key: 'w-1', fieldLabel: '本文', kind: 'SKILL_SHEET_MISMATCH', excerpt: 'AI 警告の抜粋', locationNote: null }],
        failed: true,
        allPassed: false,
        lead: '検査で不合格',
      },
    }),
  ],
  empty: null,
};

const messages: ProposalDetailScreenMessages = {
  sectionHeader: '概要',
  sectionHold: '送信の保留',
  sectionTimeline: '履歴',
  sectionFrozen: '凍結内容',
  sectionGate: 'ゲート結果',
  sectionGateHistory: 'ゲート結果の履歴',
  gateHistoryLead: '実行ごとの層別結果です。',
  showAll: 'すべて表示',
  gateHeld: 'AI が上限到達で停止しているため検査を実行できません。',
  gateHeldResetAtPrefix: '再開予定: ',
  gateAiFailed: '検査を完了できなかったため承認できません。',
  gateHistoryAiFailed: '検査を完了できなかった実行です。',
  sectionActions: '次の操作',
  sectionNote: 'メモを追加',
  fieldState: '状態',
  fieldApprover: '承認者',
  fieldSubmittedAt: '送信日時',
  fieldSendAttempts: '送信試行',
  fieldLastFailure: '最終失敗理由',
  sendAttemptsNone: '送信試行はありません。',
  frozenSubject: '件名',
  frozenBody: '本文',
  frozenAttachment: '添付',
  careerColumnPeriod: '期間',
  careerColumnRole: '役割',
  careerColumnDescription: '業務内容',
  careerColumnTechnologies: '使用技術',
  gateNotRequested: 'レビューはまだ依頼されていません。',
  gateWarningsTitle: 'AI の警告（合否に影響しません）',
  gateFindingsTitle: '不合格の指摘',
  gateFindingsEmpty: '指摘はありません。',
  gateWarningsEmpty: '警告はありません。',
  noteLabel: 'メモ（提案の履歴に残ります）',
  noteLead: 'メモは状態を変えません。',
  noteSubmit: 'メモを追加する',
  noteSubmitting: '追加しています…',
  noteAdded: 'メモを追加しました。',
  noteViewerNotice: '閲覧専用のロールではメモを追加できません。',
  noteForbiddenNotice: 'この提案にメモを残せるのは、作成者とホストの営業担当・管理者です。',
  noteErrorValidation: 'メモを入力してください。',
  noteErrorForbidden: 'この提案にメモを残す権限がありません。',
  noteErrorGeneric: 'メモを追加できませんでした。',
  deniedTitle: 'メモの追加を行えません。',
  backToList: '提案一覧',
};

function render(overrides: Partial<ProposalDetailScreenProps> = {}): string {
  const props: ProposalDetailScreenProps = {
    proposalId: ID,
    rows: rows(),
    gateHistory: GATE_HISTORY,
    isViewer: false,
    denialMessage: null,
    listHref: '/proposals',
    noteMaxLength: 2000,
    messages,
    ...overrides,
  };
  return renderToStaticMarkup(createElement(ProposalDetailScreen, props));
}

describe('🔴 ① 履歴の描き分け', () => {
  it('8 種の出来事が data-event-kind の別値で描かれ、自動承認の主体は「システム（全層 PASS のため）」', () => {
    const html = render();
    for (const row of TIMELINE) {
      expect(html).toMatch(new RegExp(`data-testid="proposal-detail-event-${row.id}"[^>]*data-event-kind="${row.kind}"`));
      expect(html).toContain(row.title);
    }
    expect(html).toContain('システム（全層 PASS のため）');
    expect(html).toContain('検査 #gate-1');
    expect(html).toContain('種別: UNKNOWN:TimeoutError');
    expect(html).toContain('理由: 電話で未着を確認');
    expect(html).toContain('変更した項目: 件名 / 本文');
    expect(html).toContain('単価を見直してください');
    expect(html).toMatch(/data-testid="proposal-detail-event-e4"[^>]*data-actor-kind="SYSTEM"/);
  });
});

describe('🔴 ② 却下由来の DRAFT / 状態に応じた導線', () => {
  it('DRAFT（却下由来）は S-020 への導線の前に「内容を変更してから」の説明', () => {
    const html = render({
      rows: rows({
        state: 'DRAFT',
        stateLabel: '下書き',
        actions: [{ key: 'EDITOR', href: `/proposals/${ID}/edit`, label: '下書きを編集する', lead: 'この提案は却下されて下書きに戻っています。内容を変更してからレビューに出してください。' }],
      }),
    });
    expect(html).toContain('data-testid="proposal-detail-action-lead-EDITOR"');
    expect(html).toContain('内容を変更してからレビューに出してください');
    expect(html).toMatch(/data-testid="proposal-detail-action-link-EDITOR"[^>]*href="\/proposals\/[^"]+\/edit"|href="\/proposals\/[^"]+\/edit"[^>]*data-testid="proposal-detail-action-link-EDITOR"/);
  });

  it('SUBMIT_FAILED は S-022 への導線。終端は「行える操作はありません」', () => {
    const failed = render({
      rows: rows({ state: 'SUBMIT_FAILED', stateLabel: '送信失敗', failureKind: 'SUBMIT_FAILED', actions: [{ key: 'SEND_FAILURES', href: '/proposals/send-failures', label: '送信失敗の一覧へ', lead: null }] }),
    });
    expect(failed).toMatch(/data-testid="proposal-detail"[^>]*data-proposal-state="SUBMIT_FAILED"[^>]*data-failure-kind="SUBMIT_FAILED"/);
    expect(failed).toContain('data-testid="proposal-detail-action-link-SEND_FAILURES"');
    const won = render({ rows: rows({ state: 'WON', stateLabel: '決定', actions: [], actionsEmpty: 'この状態で行える操作はありません。' }) });
    expect(won).toContain('data-testid="proposal-detail-actions-empty"');
  });
});

describe('🔴 ③ 取引先の描画', () => {
  it('承認者 / 送信試行 / 最終失敗理由 / 保留 / 作成会社の行が無く、取引先向けの注記がある', () => {
    const html = render({
      rows: rows({
        approver: null,
        sendAttempts: null,
        lastFailureReason: null,
        sendHold: null,
        header: rows().header.filter((row) => row.field !== 'owner'),
        audienceNotice: 'この画面には、御社が作成した提案の内容と履歴が表示されます。',
      }),
    });
    expect(html).toContain('data-testid="proposal-detail-partner-notice"');
    expect(html).not.toContain('data-testid="proposal-detail-approver"');
    expect(html).not.toContain('data-testid="proposal-detail-send-attempts"');
    expect(html).not.toContain('data-testid="proposal-detail-last-failure"');
    expect(html).not.toContain('data-testid="proposal-detail-send-hold"');
    expect(html).not.toContain('data-testid="proposal-detail-header-row-owner"');
    expect(html).not.toContain('Partner A1');
    expect(html).not.toMatch(/重複|duplicate/);
  });

  it('ホストの描画: 承認者 / 送信試行 / 最終失敗理由 / 作成会社の行がある。保留は別枠', () => {
    const html = render();
    expect(html).toContain('data-testid="proposal-detail-approver"');
    expect(html).toContain('data-testid="proposal-detail-send-attempts"');
    expect(html).toContain('最終: 応答不明（UNKNOWN:TimeoutError）');
    expect(html).toContain('data-testid="proposal-detail-last-failure"');
    expect(html).toContain('data-testid="proposal-detail-header-row-owner"');
    const held = render({
      rows: rows({
        state: 'APPROVED',
        stateLabel: '承認済み',
        sendHold: { reasonKey: 'RATE_LIMIT', title: '送信の保留', message: '上限に達しているため保留中です。', since: '保留開始: 2026-09-16 09:00 JST', autoRelease: true, settingsLink: { href: '/settings/usage', label: '利用量を確認する' } },
      }),
    });
    expect(held).toMatch(/data-testid="proposal-detail-send-hold"[^>]*data-hold-reason="RATE_LIMIT"/);
    expect(held).toContain('data-testid="proposal-detail-send-hold-settings"');
  });
});

describe('④ メモの導線 / ⑤ 固定ヘッダと凍結 / ⑥ 無い語', () => {
  it('立場 × 非 VIEWER × 実行可 のときだけフォーム。VIEWER / 立場外 / 停止中は理由', () => {
    expect(render()).toContain('data-testid="proposal-detail-note-form"');
    expect(render()).toMatch(/data-testid="proposal-detail"[^>]*data-can-add-note="true"/);
    const viewer = render({ isViewer: true });
    expect(viewer).toContain('data-testid="proposal-detail-note-viewer"');
    expect(viewer).not.toContain('data-testid="proposal-detail-note-form"');
    const forbidden = render({ rows: rows({ canAddNote: false }) });
    expect(forbidden).toContain('data-testid="proposal-detail-note-forbidden"');
    expect(forbidden).not.toContain('data-testid="proposal-detail-note-form"');
    const denied = render({ denialMessage: 'このテナントは停止中です。' });
    expect(denied).toContain('data-testid="proposal-detail-note-denied"');
    expect(denied).toContain('このテナントは停止中です。');
    expect(denied).not.toContain('data-testid="proposal-detail-note-form"');
  });

  it('固定ヘッダに状態 + 提案先 + 単価。凍結の経歴の見出しに日時、4 列の行。ゲート結果は 3 層', () => {
    const html = render();
    expect(html).toContain('data-testid="proposal-detail-fixed"');
    expect(html).toMatch(/data-testid="proposal-detail-state"[^>]*>[^<]*承認待ち/);
    expect(html).toContain('data-testid="proposal-detail-fixed-recipient"');
    expect(html).toContain('data-testid="proposal-detail-fixed-unit-price"');
    expect(html).toContain('2026-09-15 10:00 JST 時点の経験内容 — 1 行');
    expect(html).toContain('data-testid="proposal-detail-frozen-career-career-0"');
    for (const layer of ['pii', 'commerce', 'consistency']) {
      expect(html).toMatch(new RegExp(`data-testid="proposal-detail-gate-layer-${layer}"[^>]*data-layer-state="PASS"`));
    }
    const notRequested = render({ rows: rows({ gate: { ...rows().gate, execution: 'RUNNING', layers: rows().gate.layers.map((layer) => ({ ...layer, state: 'RUNNING' as const })), lead: null, allPassed: false } }) });
    expect(notRequested).toContain('data-testid="proposal-detail-gate-not-requested"');
  });

  it('🔴 「無視して送信」「最新の情報に更新」「一括」に相当する語・testid が無い', () => {
    const html = render();
    expect(html).not.toMatch(/無視して|最新の情報に更新|一括承認|一括送信|自動再送/);
    expect(html).not.toMatch(/data-testid="[^"]*(force|override|bulk|refresh-snapshot)[^"]*"/);
  });
});

describe('🔴 ⑦ セクション 4「ゲート結果の履歴」（T-12-14 ②。docs/05 §6.5「#40b と S-023 セクション 4 の設計」）', () => {
  it('履歴が実行ごとに分かれ（1 実行 = 1 ブロック）、現在 / 以前の内容の印と実行日時の見出しを持つ', () => {
    const html = render();
    expect(html).toMatch(/data-testid="proposal-detail-section-gate-history"[^>]*data-history-count="2"/);
    expect(html).toContain('ゲート結果の履歴');
    // 降順（新しい実行が先）: gate-2 → gate-1。
    const indexOf2 = html.indexOf('data-testid="proposal-detail-gate-history-item-gate-2"');
    const indexOf1 = html.indexOf('data-testid="proposal-detail-gate-history-item-gate-1"');
    expect(indexOf2).toBeGreaterThan(-1);
    expect(indexOf1).toBeGreaterThan(indexOf2);
    expect(html).toMatch(/data-testid="proposal-detail-gate-history-item-gate-2"[^>]*data-gate-execution="DONE"[^>]*data-matches-current-content="true"/);
    expect(html).toMatch(/data-testid="proposal-detail-gate-history-item-gate-1"[^>]*data-matches-current-content="false"/);
    expect(html).toContain('現在の内容に対する結果');
    expect(html).toContain('以前の内容に対する結果');
    expect(html).toContain('実行日時: 2026-09-16 09:30 JST');
    // 各ブロックが 3 層を持つ（現在の結果と同じ描画部品）。
    for (const layer of ['pii', 'commerce', 'consistency']) {
      expect(html).toContain(`data-testid="proposal-detail-gate-history-layer-gate-2-${layer}"`);
      expect(html).toContain(`data-testid="proposal-detail-gate-history-layer-gate-1-${layer}"`);
    }
    expect(html).toMatch(/data-testid="proposal-detail-gate-history-layer-gate-1-pii"[^>]*data-layer-state="FAIL"/);
    expect(html).toMatch(/data-testid="proposal-detail-gate-history-layer-gate-2-pii"[^>]*data-layer-state="PASS"/);
    // 現在の結果（#46 の gate）の testid はそのまま（履歴と混ざらない）。
    expect(html).toContain('data-testid="proposal-detail-gate-layer-pii"');
  });

  it('🔴 整合層の機械照合の不合格（findings）と AI の警告（aiWarnings）が別の見出し・別のリストで描かれる', () => {
    const html = render();
    const start = html.indexOf('data-testid="proposal-detail-gate-history-item-gate-1"');
    const block = html.slice(start, html.indexOf('</li>', html.indexOf('data-testid="proposal-detail-gate-history-warnings-gate-1"')));
    const findingsIndex = block.indexOf('data-testid="proposal-detail-gate-history-findings-gate-1"');
    const warningsIndex = block.indexOf('data-testid="proposal-detail-gate-history-warnings-gate-1"');
    expect(findingsIndex).toBeGreaterThan(-1);
    expect(warningsIndex).toBeGreaterThan(findingsIndex);
    // 不合格の指摘（機械照合。整合層の MUST_REQUIREMENT_MISMATCH を含む）は「不合格の指摘」の見出しの下、AI の警告は別の見出しの下。
    expect(block.indexOf('不合格の指摘')).toBeLessThan(findingsIndex);
    expect(block.indexOf('AI の警告（合否に影響しません）')).toBeGreaterThan(findingsIndex);
    expect(block.indexOf('AI の警告（合否に影響しません）')).toBeLessThan(warningsIndex);
    const findingsList = block.slice(findingsIndex, block.indexOf('</ul>', findingsIndex));
    const warningsList = block.slice(warningsIndex);
    expect(findingsList).toContain('TypeScript -/3.0');
    expect(findingsList).toContain('[氏名が残っています]');
    expect(findingsList).not.toContain('AI 警告の抜粋');
    expect(warningsList).toContain('AI 警告の抜粋');
    expect(warningsList).not.toContain('TypeScript -/3.0');
  });

  it('aiFailed の行は「検査を完了できなかった」の文言（PII / 商流の FAIL と別物）。HELD の行は「上限到達で未実行」+ 再開予定', () => {
    const html = render({
      gateHistory: {
        items: [
          historyItem({
            reviewGateId: 'gate-held',
            execution: 'HELD_AI_COST_LIMIT',
            title: '上限到達で未実行（保留開始: 2026-09-16 10:00 JST）',
            contentNote: '現在の内容に対する結果',
            matchesCurrentContent: true,
            gate: {
              ...PASSED_GATE,
              execution: 'HELD_AI_COST_LIMIT',
              layers: [
                { key: 'pii', label: 'PII 層', state: 'HELD', verdictLabel: '検査中' },
                { key: 'commerce', label: '商流層', state: 'HELD', verdictLabel: '検査中' },
                { key: 'consistency', label: '整合層', state: 'PASS', verdictLabel: '合格' },
              ],
              allPassed: false,
              heldResetAt: '2026-09-17 00:00 JST',
              lead: null,
            },
          }),
          historyItem({
            reviewGateId: 'gate-ai-failed',
            gate: {
              ...PASSED_GATE,
              layers: [
                { key: 'pii', label: 'PII 層', state: 'FAIL', verdictLabel: '不合格' },
                { key: 'commerce', label: '商流層', state: 'FAIL', verdictLabel: '不合格' },
                { key: 'consistency', label: '整合層', state: 'PASS', verdictLabel: '合格' },
              ],
              failed: true,
              allPassed: false,
              aiFailed: true,
              lead: '検査で不合格',
            },
          }),
        ],
        empty: null,
      },
    });
    expect(html).toMatch(/data-testid="proposal-detail-gate-history-item-gate-ai-failed"[^>]*data-gate-execution="DONE"/);
    expect(html).toContain('data-testid="proposal-detail-gate-history-ai-failed-gate-ai-failed"');
    expect(html).toContain('検査を完了できなかった実行です。');
    expect(html).toMatch(/data-testid="proposal-detail-gate-history-item-gate-held"[^>]*data-gate-execution="HELD_AI_COST_LIMIT"/);
    expect(html).toContain('上限到達で未実行（保留開始: 2026-09-16 10:00 JST）');
    expect(html).toContain('data-testid="proposal-detail-gate-history-held-gate-held"');
    expect(html).toContain('再開予定: 2026-09-17 00:00 JST');
    // 🔴 HELD に `S-038` への導線・金額が無い（Issue #70 既定 / `F-027 AC-6`）。
    expect(html).not.toContain('/settings/usage');
    expect(html.toLowerCase()).not.toContain('usd');
    // aiFailed でない行に「検査を完了できなかった」が出ない。
    expect(html).not.toContain('data-testid="proposal-detail-gate-history-ai-failed-gate-held"');
  });

  it('0 件（まだ一度も依頼していない）は空の文言、現在の結果の「レビューはまだ依頼されていません」とは別 testid', () => {
    const html = render({ gateHistory: { items: [], empty: 'この提案はまだレビューに出されていません。' } });
    expect(html).toContain('data-testid="proposal-detail-gate-history-empty"');
    expect(html).not.toContain('data-testid="proposal-detail-gate-history"');
    expect(html).toMatch(/data-testid="proposal-detail-section-gate-history"[^>]*data-history-count="0"/);
  });
});

describe('🔴 ⑦ 折りたたみ（T-12-14 ③。docs/04 §10.3 の共通規約: 11 件以上で直近 10 件 + 「すべて表示」、10 件以下は全件）', () => {
  function timelineOf(count: number): readonly ProposalTimelineRow[] {
    return Array.from({ length: count }, (_, index) =>
      timeline({
        id: `t${String(index + 1)}`,
        kind: index === 0 ? 'TRANSITION' : 'NOTE',
        title: index === 0 ? '状態の変更' : 'メモ',
        occurredAt: `2026-09-15 ${String(10 + index).padStart(2, '0')}:00 JST`,
      }),
    );
  }

  it('履歴タイムライン: 11 行で直近 10 行が折りたたみの外、11 行目が「すべて表示」の中。全行が DOM にある（打ち切らない）', () => {
    const html = render({ rows: rows({ timeline: timelineOf(11) }) });
    expect(html).toMatch(/data-testid="proposal-detail-timeline"[^>]*data-folded="true"[^>]*data-total-count="11"[^>]*data-hidden-count="1"/);
    const detailsIndex = html.indexOf('<details', html.indexOf('data-testid="proposal-detail-timeline"'));
    expect(detailsIndex).toBeGreaterThan(-1);
    // 先頭 10 行（t1〜t10）は <details> より前、11 行目（t11）は <details> の中。順序は保たれる（t1 が最初 = 最新行）。
    for (let index = 1; index <= 10; index += 1) {
      expect(html.indexOf(`data-testid="proposal-detail-event-t${String(index)}"`)).toBeLessThan(detailsIndex);
    }
    expect(html.indexOf('data-testid="proposal-detail-event-t11"')).toBeGreaterThan(detailsIndex);
    expect(html.indexOf('data-testid="proposal-detail-event-t1"')).toBeLessThan(html.indexOf('data-testid="proposal-detail-event-t2"'));
    expect(html).toContain('<summary');
    expect(html).toContain('すべて表示');
    // 🔴 「他 N 件」等の見えない件数の示唆を作らない（`F-004 AC-3` / `AC-4` の走査と同じ語）。
    expect(html).not.toMatch(/他\s*[0-9]+\s*件|ほか\s*[0-9]+\s*件|[0-9]+\s*件中/);
  });

  it('履歴タイムライン: 10 行以下は全件で、折りたたみ（<details>）が無い', () => {
    const html = render({ rows: rows({ timeline: timelineOf(10) }) });
    expect(html).toMatch(/data-testid="proposal-detail-timeline"[^>]*data-folded="false"[^>]*data-total-count="10"/);
    const section = html.slice(html.indexOf('data-testid="proposal-detail-section-timeline"'), html.indexOf('data-testid="proposal-detail-section-note"'));
    expect(section).not.toContain('<details');
    expect(section).not.toContain('すべて表示');
    for (let index = 1; index <= 10; index += 1) expect(section).toContain(`data-testid="proposal-detail-event-t${String(index)}"`);
  });

  it('ゲート結果の履歴: 11 件で直近 10 件 + 「すべて表示」（同じ共通部品）', () => {
    const items = Array.from({ length: 11 }, (_, index) => historyItem({ reviewGateId: `g${String(index + 1)}` }));
    const html = render({ gateHistory: { items, empty: null } });
    expect(html).toMatch(/data-testid="proposal-detail-gate-history"[^>]*data-folded="true"[^>]*data-total-count="11"[^>]*data-hidden-count="1"/);
    const detailsIndex = html.indexOf('<details', html.indexOf('data-testid="proposal-detail-gate-history"'));
    expect(html.indexOf('data-testid="proposal-detail-gate-history-item-g10"')).toBeLessThan(detailsIndex);
    expect(html.indexOf('data-testid="proposal-detail-gate-history-item-g11"')).toBeGreaterThan(detailsIndex);
    const ten = render({ gateHistory: { items: items.slice(0, 10), empty: null } });
    expect(ten).toMatch(/data-testid="proposal-detail-gate-history"[^>]*data-folded="false"/);
  });
});
