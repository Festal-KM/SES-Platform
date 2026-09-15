// apps/web/app/(main)/proposals/[id]/approve/proposal-approval-screen.render.test.tsx
// `ProposalApprovalScreen`（`S-021`）の状態別描画テスト。T-09-03。
//
// 🔴 ここで固定するもの（「描かれていること / 描かれていないこと」が要件であり、API のテストでは示せない）:
//   ①🔴 判断ヘッダ（提案先・エンジニア・案件・単価・開始日・作成者・経過時間）・ゲート結果・プレビューが**同じ 1 つの
//     出力**に描かれ、折りたたみ（`<details>`）やタブの中に入っていない（`F-021 AC-4` / `BR-49`）
//   ②🔴 承認・却下のボタンは**プレビューの末尾を観測するまで disabled**（`renderToStaticMarkup` では `useEffect` が走らない
//     ＝ 観測前の描画そのもの）で、押せない理由が描かれる（`docs/04` §S-021 デバイス別）
//   ③🔴 不合格の指摘と警告が別の枠（`data-tone="danger"` / `"warning"`）に描かれ、警告だけなら承認の形（ボタンあり）のまま
//   ④🔴 `GATE_FAILED` では承認・却下のボタンが 1 つも描かれず、「検査で不合格のため承認できません」+ 指摘が描かれる
//   ⑤🔴 `APPROVED` / `DRAFT` / `GATE_RUNNING` / その他でも承認ボタンが無い
//   ⑥🔴 取引先（`canApprove=false` + 注記）・`VIEWER`・停止中（`denialMessage`）には操作が無い
//   ⑦🔴 「無視して承認」「警告を無視して進む」「一括承認」に相当する語・ボタンが無い（`F-020 AC-2` / `BR-50`）
//   ⑧ 自動承認の承認者欄と監査ログへの導線（`F-021 AC-5`）
//
// 🔴 `react-dom/server` の `renderToStaticMarkup` を使う（他の render テストと同じ）。`useEffect` は走らない。
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { ProposalApprovalRows } from '../../../../../lib/proposals/approval-rows';
import { ProposalApprovalScreen, type ProposalApprovalScreenMessages, type ProposalApprovalScreenProps } from './proposal-approval-screen';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: () => undefined, refresh: () => undefined }),
}));

const PROPOSAL_ID = '01930000-0000-7000-8000-000000000301';

const messages: ProposalApprovalScreenMessages = {
  sectionHeader: '判断材料',
  sectionGate: 'ゲート結果',
  sectionPreview: '送信先別プレビュー',
  sectionAttachment: '添付',
  sectionSendingDomain: '送信元ドメインの状態',
  sectionActions: '承認',
  fieldState: '状態',
  fieldApprover: '承認者',
  gateRunning: '検査中です。',
  gateHeld: 'AI が上限到達で停止しています。',
  gateHeldResetAtPrefix: '再開予定: ',
  gateAiFailed: '検査を完了できなかったため承認できません。',
  gateFindingsTitle: '指摘（不合格の原因）',
  gateFindingsEmpty: '指摘はありません。',
  gateWarningsTitle: '警告（合否には影響しません）',
  gateWarningsEmpty: '警告はありません。',
  gateWarningLabel: '警告',
  gateWarningsNote: '警告は承認を止めません。',
  gateNotRequested: 'まだレビューに出されていません。',
  previewLead: '提案先に届く内容です。',
  previewSubject: '件名',
  previewBody: '本文',
  previewSubjectEmpty: '（件名がありません）',
  previewBodyEmpty: '（本文がありません）',
  previewAttachmentLabel: '添付',
  previewAttachmentNone: '添付はありません。',
  previewHighlightBlock: '指摘（不合格）',
  previewHighlightWarn: '警告',
  previewEnd: 'プレビューはここまでです。',
  attachmentViewNote: '閲覧は監査ログに記録されます。',
  sendingDomainUnverifiedNote: '承認はできますが送信はできません。',
  auditLink: '監査ログを開く',
  approve: '承認する',
  approving: '承認しています…',
  approved: '承認しました。',
  reject: '却下（差し戻し）',
  rejectReasonLabel: '却下の理由',
  rejectSubmit: '却下して差し戻す',
  rejecting: '差し戻しています…',
  rejected: '却下しました。',
  rejectCancel: '却下をやめる',
  scrollRequired: '承認・却下は、プレビューの末尾まで確認すると選べるようになります。',
  openEditor: '提案の内容を開く',
  backHome: 'ホームに戻る',
  viewerNotice: '承認・却下はホストの営業担当・管理者が行います。',
  deniedTitle: '承認・却下を行えません。',
  errorValidation: '却下の理由を入力してください。',
  errorStale: '内容が変更されたため再検証が必要です。',
  errorState: 'この提案は承認待ちではありません。',
  errorForbidden: '権限がありません。',
  errorGeneric: '処理できませんでした。',
};

const baseRows: ProposalApprovalRows = {
  id: PROPOSAL_ID,
  state: 'APPROVAL_PENDING',
  stateLabel: '承認待ち',
  header: [
    { field: 'recipient', label: '提案先', value: '架空エンド株式会社 / recipient@example.test', emphasis: 'NONE' },
    { field: 'engineer', label: 'エンジニア', value: '佐藤 花子（取引先）', emphasis: 'NONE' },
    { field: 'project', label: '案件', value: '基幹刷新', emphasis: 'NONE' },
    { field: 'unit-price', label: '提示単価', value: '650,000', emphasis: 'NONE' },
    { field: 'start-date', label: '開始日', value: '2026-11-01', emphasis: 'NONE' },
    { field: 'created-by', label: '作成者', value: 'Partner A1', emphasis: 'NONE' },
    { field: 'elapsed', label: '経過時間', value: '3 時間', emphasis: 'NONE' },
  ],
  frozenNotice: '2026-09-15 09:00 JST 時点で凍結された情報です。',
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
    lead: '全層が合格しています。',
  },
  preview: {
    subject: 'ご提案',
    body: 'ご提案します。Kotlin の経験が 6 年あります。',
    subjectHighlights: [],
    bodyHighlights: [],
    attachment: '検査済みの版が添付されています。',
  },
  attachmentNotice: '検査済みの版が添付されています。',
  approver: null,
  disposition: { kind: 'PENDING' },
  canApprove: true,
  audienceNotice: null,
  editorHref: `/proposals/${PROPOSAL_ID}/edit`,
};

function render(overrides: Partial<ProposalApprovalScreenProps> = {}, rowsOverrides: Partial<ProposalApprovalRows> = {}): string {
  return renderToStaticMarkup(
    createElement(ProposalApprovalScreen, {
      proposalId: PROPOSAL_ID,
      rows: { ...baseRows, ...rowsOverrides },
      denialMessage: null,
      sendingDomain: { kind: 'VERIFIED', label: '送信元: @example.co.jp（検証済み）' },
      auditHref: '/audit-logs',
      homeHref: '/',
      messages,
      ...overrides,
    }),
  );
}

const WARNING_ROW = { key: 'w-1', fieldLabel: '本文', kind: 'SKILL_SHEET_MISMATCH' as const, excerpt: '経験が 6 年', locationNote: null };
const BLOCK_ROW = { key: 'f-1', fieldLabel: '本文', kind: 'FULL_NAME' as const, excerpt: '佐藤 花子', locationNote: null };

describe('S-021 ①: 判断材料が同一画面に、折りたたまれずに描かれる（F-021 AC-4 / BR-49）', () => {
  it('判断ヘッダ 7 欄・ゲート結果・プレビュー・添付・送信元ドメインが 1 つの出力に描かれる', () => {
    const html = render();
    for (const field of ['recipient', 'engineer', 'project', 'unit-price', 'start-date', 'created-by', 'elapsed']) {
      expect(html).toContain(`data-testid="proposal-approval-header-row-${field}"`);
    }
    expect(html).toContain('架空エンド株式会社 / recipient@example.test');
    expect(html).toContain('650,000');
    expect(html).toContain('data-testid="proposal-approval-gate"');
    expect(html).toContain('data-testid="proposal-approval-preview-body"');
    expect(html).toContain('Kotlin の経験が 6 年あります。');
    expect(html).toContain('data-testid="proposal-approval-attachment"');
    expect(html).toContain('data-testid="proposal-approval-sending-domain"');
    expect(html).toContain('data-testid="proposal-approval-frozen-notice"');
    // 🔴 折りたたみ・タブに入れない。
    expect(html).not.toContain('<details');
    expect(html).not.toContain('role="tab"');
  });
});

describe('S-021 ②: 承認・却下はプレビューの末尾を確認するまで押せない', () => {
  it('観測前の描画ではボタンが disabled で、押せない理由が描かれる', () => {
    const html = render();
    expect(html).toContain('data-reached-end="false"');
    // 🔴 `<button … disabled="" data-testid="…">` の形（属性の並びは React が決める）。
    expect(html).toMatch(/<button[^>]*\sdisabled=""[^>]*data-testid="proposal-approval-approve"/);
    expect(html).toMatch(/<button[^>]*\sdisabled=""[^>]*data-testid="proposal-approval-reject"/);
    expect(html).toContain('data-testid="proposal-approval-scroll-required"');
    expect(html).toContain('data-testid="proposal-approval-preview-end"');
  });
});

describe('S-021 ③: 不合格と警告は視覚的に別物で、警告だけでは止めない', () => {
  it('警告のみ: 警告の枠（warning）に描かれ、指摘の枠（danger）は空。承認ボタンは描かれる', () => {
    const html = render({}, { gate: { ...baseRows.gate, warnings: [WARNING_ROW] } });
    expect(html).toMatch(/data-testid="proposal-approval-gate-warnings"[^>]*data-tone="warning"/);
    expect(html).toMatch(/data-testid="proposal-approval-gate-findings"[^>]*data-tone="danger"/);
    expect(html).toContain('経験が 6 年');
    expect(html).toContain(messages.gateFindingsEmpty);
    expect(html).toContain(messages.gateWarningsNote);
    expect(html).toContain('data-testid="proposal-approval-approve"');
  });

  it('本文のハイライト: BLOCK と WARN で別の色（別の testid）になる', () => {
    const html = render(
      {},
      {
        preview: {
          ...baseRows.preview,
          bodyHighlights: [
            { start: 0, end: 5, severity: 'BLOCK', kind: 'FULL_NAME' },
            { start: 15, end: 22, severity: 'WARN', kind: 'SKILL_SHEET_MISMATCH' },
          ],
        },
      },
    );
    expect(html).toContain('data-testid="proposal-approval-preview-highlight-block"');
    expect(html).toContain('data-testid="proposal-approval-preview-highlight-warn"');
  });
});

describe('S-021 ④⑤: APPROVAL_PENDING 以外では承認・却下のボタンを描かない', () => {
  it('GATE_FAILED: 承認・却下が無く、不合格の案内と指摘が描かれる', () => {
    const html = render(
      {},
      {
        state: 'GATE_FAILED',
        stateLabel: '差し戻し（検査で不合格）',
        disposition: { kind: 'GATE_FAILED', notice: '検査で不合格のため承認できません。' },
        gate: {
          ...baseRows.gate,
          layers: [
            { key: 'pii', label: 'PII 層', state: 'FAIL', verdictLabel: '不合格' },
            { key: 'commerce', label: '商流層', state: 'PASS', verdictLabel: '合格' },
            { key: 'consistency', label: '整合層', state: 'PASS', verdictLabel: '合格' },
          ],
          findings: [BLOCK_ROW],
          failed: true,
          allPassed: false,
          lead: '検査で不合格のため承認できません。',
        },
      },
    );
    expect(html).not.toContain('data-testid="proposal-approval-approve"');
    expect(html).not.toContain('data-testid="proposal-approval-reject"');
    expect(html).toContain('data-testid="proposal-approval-notice"');
    expect(html).toContain('検査で不合格のため承認できません。');
    expect(html).toMatch(/data-testid="proposal-approval-gate-layer-pii"[^>]*data-layer-state="FAIL"/);
    expect(html).toContain('佐藤 花子');
    expect(html).toContain('data-actionable="false"');
  });

  it.each([
    ['APPROVED', { kind: 'APPROVED' as const, notice: 'この提案はすでに承認されました（Host A / 2026-09-16 10:00 JST）。' }],
    ['DRAFT', { kind: 'DRAFT' as const, notice: 'この提案は下書きです。' }],
    ['GATE_RUNNING', { kind: 'GATE_RUNNING' as const, notice: 'この提案は検査中です。' }],
    ['SUBMITTED', { kind: 'OTHER' as const, notice: 'この提案は「送信済み」のため、承認・却下の操作はありません。' }],
  ])('%s: 承認・却下のボタンが無く、案内が描かれる', (state, disposition) => {
    const html = render({}, { state: state as ProposalApprovalRows['state'], disposition });
    expect(html).not.toContain('data-testid="proposal-approval-approve"');
    expect(html).not.toContain('data-testid="proposal-approval-reject"');
    expect(html).toContain(disposition.notice);
  });

  it('GATE_RUNNING: 層は検査中で、指摘・警告の枠を描かない（確定していない）', () => {
    const html = render(
      {},
      {
        state: 'GATE_RUNNING',
        disposition: { kind: 'GATE_RUNNING', notice: '検査中です。' },
        gate: {
          ...baseRows.gate,
          execution: 'RUNNING',
          layers: baseRows.gate.layers.map((layer) => ({ ...layer, state: 'RUNNING' as const, verdictLabel: '検査中' })),
          allPassed: false,
          lead: null,
        },
      },
    );
    expect(html).toContain('data-testid="proposal-approval-gate-running"');
    expect(html).not.toContain('data-testid="proposal-approval-gate-findings"');
  });
});

describe('S-021 ⑥: 立場・停止中では操作が無い', () => {
  it('取引先（canApprove=false + 注記）: ボタンが無く、内容とゲート結果は描かれる', () => {
    const html = render({ auditHref: null }, { canApprove: false, audienceNotice: 'ホスト宛の最終承認・却下はホスト側が行います。' });
    expect(html).not.toContain('data-testid="proposal-approval-approve"');
    expect(html).toContain('data-testid="proposal-approval-partner-notice"');
    expect(html).toContain('data-testid="proposal-approval-gate"');
    expect(html).toContain('data-testid="proposal-approval-preview-body"');
    expect(html).not.toContain('data-testid="proposal-approval-viewer"');
  });

  it('VIEWER（canApprove=false）: ボタンが無く、閲覧専用の注記', () => {
    const html = render({}, { canApprove: false });
    expect(html).not.toContain('data-testid="proposal-approval-approve"');
    expect(html).toContain('data-testid="proposal-approval-viewer"');
  });

  it('停止中（denialMessage）: ボタンが無く、理由が描かれる（F-004 AC-7）', () => {
    const html = render({ denialMessage: 'テナントは停止中です。' });
    expect(html).not.toContain('data-testid="proposal-approval-approve"');
    expect(html).toContain('data-testid="proposal-approval-denied"');
    expect(html).toContain('テナントは停止中です。');
  });
});

describe('S-021 ⑦: 迂回・一括の導線が無い', () => {
  it('「無視」「一括」「全て承認」に相当する語・testid が無い', () => {
    const html = render({}, { gate: { ...baseRows.gate, warnings: [WARNING_ROW] } });
    expect(html).not.toMatch(/無視/);
    expect(html).not.toMatch(/一括/);
    expect(html).not.toMatch(/すべて承認|全て承認|まとめて承認/);
    expect(html).not.toMatch(/data-testid="[^"]*bulk[^"]*"/);
    expect(html).not.toMatch(/data-testid="[^"]*(force|override|skip)[^"]*"/);
  });
});

describe('S-021 ⑧: 承認者欄（F-021 AC-5）', () => {
  it('自動承認は「システム（全層 PASS のため自動承認）」と監査ログへの導線', () => {
    const html = render(
      {},
      {
        state: 'APPROVED',
        approver: 'システム（全層 PASS のため自動承認） / 2026-09-16 10:00 JST',
        disposition: { kind: 'APPROVED', notice: 'この提案はすでに承認されました。' },
      },
    );
    expect(html).toContain('data-testid="proposal-approval-approver"');
    expect(html).toContain('システム（全層 PASS のため自動承認）');
    expect(html).toContain('data-testid="proposal-approval-audit-link"');
  });

  it('監査ログに到達できない立場では導線が無い', () => {
    const html = render({ auditHref: null }, { state: 'APPROVED', approver: 'Host A / 2026-09-16 10:00 JST', disposition: { kind: 'APPROVED', notice: 'x' } });
    expect(html).toContain('data-testid="proposal-approval-approver"');
    expect(html).not.toContain('data-testid="proposal-approval-audit-link"');
  });
});
