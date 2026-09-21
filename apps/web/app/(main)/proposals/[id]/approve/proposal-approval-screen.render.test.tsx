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
//   ⑨🔴 T-12-13 ⑤: `APPROVED` で送信の確定を待っている間（`awaitingSendSettlement` = 試行の末尾が未確定 `RESERVED`）は #46 の
//     読み直しが走り（`data-send-polling="true"`）、「送信する」（`proposal-approval-submit`）を描かない。確定後（`SUBMITTED` /
//     `SUBMIT_FAILED`）は読まず「送信する」も無い。保留中も読む。🔴 `APPROVED` + `awaitingSendSettlement: false`（= #44 の CAS 後に
//     ジョブが無い行 / 409 / failed job もこの形）は読まず「送信する」を描く —— #44 の受け付け直後の窓は `S-022` が残すセッションの印
//     （`lib/proposals/submit-intent.ts`）が `SUBMIT_REQUESTED` で埋めるので、サーバ描画（印は `useEffect` でしか読まない）では
//     「送信する」がある
//   ⑩🔴 T-12-13 ⑥: `data-can-approve`（立場）と `data-can-approve-now`（この瞬間に #41 を呼べるか）の差。`GATE_FAILED` は前者だけ `true`、
//     `APPROVAL_PENDING` は末尾の確認済みで両方 `true`（末尾の観測は `renderToStaticMarkup` では起きないので、その部分は画面が使う
//     同じ純粋関数 `canApproveNow` で固定する）
//
// 🔴 `react-dom/server` の `renderToStaticMarkup` を使う（他の render テストと同じ）。`useEffect` は走らない。
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { ProposalApprovalRows } from '../../../../../lib/proposals/approval-rows';
import {
  canApproveNow,
  ProposalApprovalScreen,
  shouldPollSendSettlement,
  type ProposalApprovalScreenMessages,
  type ProposalApprovalScreenProps,
} from './proposal-approval-screen';

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
  rejectCancel: 'キャンセル',
  scrollRequired: '承認・却下は、プレビューの末尾まで確認すると選べるようになります。',
  openEditor: '提案の内容を開く',
  backHome: 'ホームに戻る',
  openSendFailures: '送信失敗の一覧へ',
  viewerNotice: '承認・却下はホストの営業担当・管理者が行います。',
  deniedTitle: '承認・却下を行えません。',
  submit: '送信する',
  submitting: '送信を受け付けています…',
  submitRequested: '送信を受け付けました。送信中です。',
  submitLead: '承認済みの内容をそのまま提案先へ送信します。',
  submitScrollRequired: '送信は、プレビューの末尾まで確認すると選べるようになります。',
  errorSubmitState: 'この提案は承認済みではないため送信できません。',
  errorSendBlocked: '送信ジョブを積めませんでした。',
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
  canSubmit: true,
  sendHold: null,
  awaitingSendSettlement: false,
  audienceNotice: null,
  editorHref: `/proposals/${PROPOSAL_ID}/edit`,
};

/** T-09-06: 承認済み（送信の対象）。 */
const approvedRows: Partial<ProposalApprovalRows> = {
  state: 'APPROVED',
  stateLabel: '承認済み',
  approver: '山田 太郎 / 2026-09-16 09:00 JST',
  disposition: { kind: 'APPROVED', notice: 'この提案はすでに承認されました（山田 太郎）。' },
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
      sendFailuresHref: '/proposals/send-failures',
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

describe('S-021 ⑨（T-09-06）: 承認後の primary は「送信する」で、押した瞬間に送信済みと見せない', () => {
  it('APPROVED × ホスト: 「送信する」が描かれ（観測前は disabled）、承認・却下は描かれない', () => {
    const html = render({}, approvedRows);
    expect(html).toContain('data-testid="proposal-approval-submit"');
    expect(html).toContain('送信する');
    expect(html).toContain('data-testid="proposal-approval-submit-scroll-required"');
    expect(html).not.toContain('data-testid="proposal-approval-approve"');
    expect(html).not.toContain('data-testid="proposal-approval-reject"');
    // 🔴 送信済み・送信中の語は描画直後に出ない。
    expect(html).not.toContain('送信を受け付けました');
    expect(html).not.toContain('送信済み');
    const button = /<button[^>]*data-testid="proposal-approval-submit"[^>]*>/.exec(html)?.[0] ?? '';
    expect(button).toContain('disabled');
  });

  it('取引先 / VIEWER（canSubmit=false）と停止中（denialMessage）では「送信する」が無い', () => {
    expect(render({}, { ...approvedRows, canApprove: false, canSubmit: false, audienceNotice: 'ホスト側が行います。' })).not.toContain(
      'data-testid="proposal-approval-submit"',
    );
    expect(render({ denialMessage: '停止中です。' }, approvedRows)).not.toContain('data-testid="proposal-approval-submit"');
  });

  it('🔴 自動復帰する保留（PROVIDER_QUOTA）: 理由と開始時刻が描かれ、S-038 の導線も「送信する」も無い', () => {
    const html = render(
      {},
      {
        ...approvedRows,
        sendHold: {
          reasonKey: 'PROVIDER_QUOTA',
          title: '送信は保留中です。',
          message: '送信基盤の混雑により保留中。お客様側の設定では解消しません。自動で再送されます。',
          since: '保留開始: 2026-09-16 09:00 JST',
          autoRelease: true,
          settingsLink: null,
        },
      },
    );
    expect(html).toContain('data-testid="proposal-approval-send-hold"');
    expect(html).toContain('data-reason-key="PROVIDER_QUOTA"');
    expect(html).toContain('お客様側の設定では解消しません');
    expect(html).not.toContain('data-testid="proposal-approval-send-hold-link"');
    expect(html).not.toContain('/settings/usage');
    expect(html).not.toContain('data-testid="proposal-approval-submit"');
  });

  it('RATE_LIMIT の保留: S-038 への導線がある（PROVIDER_QUOTA との違い）', () => {
    const html = render(
      {},
      {
        ...approvedRows,
        sendHold: {
          reasonKey: 'RATE_LIMIT',
          title: '送信は保留中です。',
          message: '本日のメール送信数が上限に達しているため保留中です。',
          since: '保留開始: 2026-09-16 09:00 JST',
          autoRelease: true,
          settingsLink: { href: '/settings/usage', label: '利用量と上限を確認する' },
        },
      },
    );
    expect(html).toContain('data-testid="proposal-approval-send-hold-link"');
    expect(html).toContain('href="/settings/usage"');
  });

  it('🔴 GATE_STALE の保留: 自動復帰しないので「送信する」を再び選べる', () => {
    const html = render(
      {},
      {
        ...approvedRows,
        sendHold: {
          reasonKey: 'GATE_STALE',
          title: '送信は保留中です。',
          message: '送信を保留しました。内容の確認後にあらためて送信してください。',
          since: '保留開始: 2026-09-16 09:00 JST',
          autoRelease: false,
          settingsLink: null,
        },
      },
    );
    expect(html).toContain('data-auto-release="false"');
    expect(html).toContain('data-testid="proposal-approval-submit"');
  });

  it('SUBMITTING / SUBMITTED / SUBMIT_FAILED: 「送信する」も承認も無く、それぞれの案内だけ', () => {
    for (const [kind, state, notice] of [
      ['SUBMITTING', 'SUBMITTING', 'この提案は送信中です。'],
      ['SUBMITTED', 'SUBMITTED', 'この提案は送信済みです（2026-09-16 09:01 JST）。'],
      ['SUBMIT_FAILED', 'SUBMIT_FAILED', '送信に失敗しました。自動では再送しません。'],
    ] as const) {
      const html = render({}, { state, stateLabel: state, disposition: { kind, notice } });
      expect(html).toContain(`data-disposition="${kind}"`);
      expect(html).toContain(notice);
      expect(html).not.toContain('data-testid="proposal-approval-submit"');
      expect(html).not.toContain('data-testid="proposal-approval-approve"');
      // 🔴 T-09-08: `S-022` への導線は SUBMIT_FAILED のときだけ（送信中・送信済みには出さない）。再送ボタンは S-021 に無い。
      expect(html.includes('data-testid="proposal-approval-open-send-failures"')).toBe(kind === 'SUBMIT_FAILED');
      expect(html).not.toContain('data-testid="proposal-approval-resend"');
    }
  });

  it('🔴 T-09-08: SUBMIT_FAILED でも取引先（sendFailuresHref = null）には S-022 への導線が出ない', () => {
    const html = render(
      { sendFailuresHref: null },
      { state: 'SUBMIT_FAILED', stateLabel: '送信失敗', disposition: { kind: 'SUBMIT_FAILED', notice: '送信に失敗しました。' } },
    );
    expect(html).toContain('data-disposition="SUBMIT_FAILED"');
    expect(html).not.toContain('data-testid="proposal-approval-open-send-failures"');
  });

  it('🔴 T-09-08: ホストの SUBMIT_FAILED には S-022 への導線が描かれ、href は /proposals/send-failures', () => {
    const html = render({}, { state: 'SUBMIT_FAILED', stateLabel: '送信失敗', disposition: { kind: 'SUBMIT_FAILED', notice: '送信に失敗しました。' } });
    expect(html).toContain('data-testid="proposal-approval-open-send-failures"');
    expect(html).toContain('href="/proposals/send-failures"');
    expect(html).toContain('送信失敗の一覧へ');
  });
});

describe('S-021 ⑨（T-12-13 ⑤）: APPROVED で送信の確定を待つ間は #46 を読み続け、「送信する」を描かない', () => {
  it('🔴 APPROVED + 未確定の送信試行（awaitingSendSettlement）: data-send-polling="true"、「送信する」は無く、受け付けの枠がある', () => {
    const html = render({}, { ...approvedRows, awaitingSendSettlement: true });
    expect(html).toContain('data-send-polling="true"');
    expect(html).not.toContain('data-testid="proposal-approval-submit"');
    expect(html).not.toContain('data-testid="proposal-approval-submit-block"');
    expect(html).toContain('data-testid="proposal-approval-send-pending"');
    expect(html).toContain('送信を受け付けました。送信中です。');
    // 🔴 送信済みとは見せない（確定は #46 の差分で拾う）。
    expect(html).not.toContain('送信済み');
  });

  it('APPROVED で確定待ちでない（awaitingSendSettlement=false・保留なし）: 読まず、「送信する」を描く（T-09-06 のまま）', () => {
    // 🔴 レビュー指摘（2026-09-18）: #44 の CAS 後に enqueue が 409 `SEND_JOB_BLOCKED` で止まった / seq N+1 のジョブが ③ CAS より前に
    //    落ちた行もこの形（`APPROVED` + 試行の末尾が確定済み）で描かれる。「送信する」が戻り、受け付けの枠を出さない（行き止まりにしない）。
    //    受け付け直後の窓はセッションの印（`submit-intent.ts`）が `useEffect` で埋めるので、サーバ描画には現れない。
    const html = render({}, approvedRows);
    expect(html).toContain('data-send-polling="false"');
    expect(html).toContain('data-testid="proposal-approval-submit"');
    expect(html).not.toContain('data-testid="proposal-approval-send-pending"');
    expect(html).not.toContain('data-result="SUBMIT_REQUESTED"');
  });

  it('🔴 確定後（SUBMITTED / SUBMIT_FAILED）: 読まず、「送信する」も受け付けの枠も無い（SUBMITTED = 完了の表示 / SUBMIT_FAILED = S-022 への導線）', () => {
    const submitted = render(
      {},
      { state: 'SUBMITTED', stateLabel: '送信済み', disposition: { kind: 'SUBMITTED', notice: 'この提案は送信済みです（2026-09-16 09:01 JST）。' }, awaitingSendSettlement: false },
    );
    expect(submitted).toContain('data-send-polling="false"');
    expect(submitted).not.toContain('data-testid="proposal-approval-submit"');
    expect(submitted).not.toContain('data-testid="proposal-approval-send-pending"');
    expect(submitted).toContain('data-disposition="SUBMITTED"');
    const failed = render({}, { state: 'SUBMIT_FAILED', stateLabel: '送信失敗', disposition: { kind: 'SUBMIT_FAILED', notice: '送信に失敗しました。' } });
    expect(failed).toContain('data-send-polling="false"');
    expect(failed).not.toContain('data-testid="proposal-approval-submit"');
    expect(failed).not.toContain('data-testid="proposal-approval-send-pending"');
    expect(failed).toContain('data-testid="proposal-approval-open-send-failures"');
  });

  it('SUBMITTING と保留中（sendHold）は読む。GATE_STALE の保留では「送信する」を再び選べるまま（消さない）', () => {
    const submitting = render({}, { state: 'SUBMITTING', stateLabel: '送信中', disposition: { kind: 'SUBMITTING', notice: 'この提案は送信中です。' } });
    expect(submitting).toContain('data-send-polling="true"');
    const hold = {
      reasonKey: 'GATE_STALE' as const,
      title: '送信は保留中です。',
      message: '送信を保留しました。内容の確認後にあらためて送信してください。',
      since: '保留開始: 2026-09-16 09:00 JST',
      autoRelease: false,
      settingsLink: null,
    };
    const held = render({}, { ...approvedRows, sendHold: hold, awaitingSendSettlement: false });
    expect(held).toContain('data-send-polling="true"');
    expect(held).toContain('data-testid="proposal-approval-submit"');
    expect(held).not.toContain('data-testid="proposal-approval-send-pending"');
  });

  it('shouldPollSendSettlement: 読む条件は 4 つ（SUBMIT_REQUESTED × APPROVED × 保留なし / SUBMITTING / APPROVED × 確定待ち / APPROVED × 保留）で、確定後は読まない', () => {
    expect(shouldPollSendSettlement({ phaseKind: 'SUBMIT_REQUESTED', dispositionKind: 'APPROVED', holdReasonKey: null, awaitingSendSettlement: false })).toBe(true);
    expect(shouldPollSendSettlement({ phaseKind: 'IDLE', dispositionKind: 'SUBMITTING', holdReasonKey: null, awaitingSendSettlement: false })).toBe(true);
    expect(shouldPollSendSettlement({ phaseKind: 'IDLE', dispositionKind: 'APPROVED', holdReasonKey: null, awaitingSendSettlement: true })).toBe(true);
    expect(shouldPollSendSettlement({ phaseKind: 'IDLE', dispositionKind: 'APPROVED', holdReasonKey: 'RATE_LIMIT', awaitingSendSettlement: false })).toBe(true);
    expect(shouldPollSendSettlement({ phaseKind: 'IDLE', dispositionKind: 'APPROVED', holdReasonKey: null, awaitingSendSettlement: false })).toBe(false);
    for (const dispositionKind of ['SUBMITTED', 'SUBMIT_FAILED', 'PENDING', 'GATE_FAILED', 'GATE_RUNNING', 'DRAFT', 'OTHER'] as const) {
      expect(shouldPollSendSettlement({ phaseKind: 'IDLE', dispositionKind, holdReasonKey: null, awaitingSendSettlement: true }), dispositionKind).toBe(false);
    }
  });
});

describe('S-021 ⑩（T-12-13 ⑥）: data-can-approve（立場）と data-can-approve-now（この瞬間に #41 を呼べるか）は別の属性', () => {
  it('🔴 GATE_FAILED: data-can-approve="true"（立場）かつ data-can-approve-now="false"（状態が承認待ちでない）', () => {
    const html = render({}, { state: 'GATE_FAILED', stateLabel: '不合格', disposition: { kind: 'GATE_FAILED', notice: '検査で不合格のため承認できません。' } });
    expect(html).toContain('data-can-approve="true"');
    expect(html).toContain('data-can-approve-now="false"');
    expect(html).not.toContain('data-testid="proposal-approval-approve"');
  });

  it('APPROVAL_PENDING の観測前（末尾に未到達）: data-can-approve="true" / data-can-approve-now="false"（ボタンの disabled と同じ値）', () => {
    const html = render();
    expect(html).toContain('data-can-approve="true"');
    expect(html).toContain('data-can-approve-now="false"');
    expect(html).toContain('data-reached-end="false"');
    expect(html).toMatch(/<button[^>]*\sdisabled=""[^>]*data-testid="proposal-approval-approve"/);
  });

  it('🔴 APPROVAL_PENDING + 末尾の確認済み: 両方 true（canApproveNow）。立場・状態・実行可・要求中 / 確定後のいずれか 1 つでも欠けると false', () => {
    const base = { canApprove: true, dispositionKind: 'PENDING', denialMessage: null, reachedEnd: true, phaseKind: 'IDLE' } as const;
    expect(canApproveNow(base)).toBe(true);
    expect(canApproveNow({ ...base, phaseKind: 'REJECT_FORM' })).toBe(true);
    expect(canApproveNow({ ...base, reachedEnd: false })).toBe(false);
    expect(canApproveNow({ ...base, canApprove: false })).toBe(false);
    expect(canApproveNow({ ...base, denialMessage: '停止中です。' })).toBe(false);
    for (const dispositionKind of ['GATE_FAILED', 'APPROVED', 'SUBMITTING', 'SUBMITTED', 'SUBMIT_FAILED', 'GATE_RUNNING', 'DRAFT', 'OTHER'] as const) {
      expect(canApproveNow({ ...base, dispositionKind }), dispositionKind).toBe(false);
    }
    for (const phaseKind of ['SUBMITTING', 'APPROVED', 'REJECTED'] as const) {
      expect(canApproveNow({ ...base, phaseKind }), phaseKind).toBe(false);
    }
  });

  it('取引先 / VIEWER（canApprove=false）と停止中（denialMessage）: data-can-approve-now="false"', () => {
    expect(render({}, { canApprove: false, canSubmit: false, audienceNotice: 'ホスト側が行います。' })).toContain('data-can-approve-now="false"');
    expect(render({ denialMessage: '停止中です。' })).toContain('data-can-approve-now="false"');
  });
});
