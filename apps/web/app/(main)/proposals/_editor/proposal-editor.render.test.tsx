// apps/web/app/(main)/proposals/_editor/proposal-editor.render.test.tsx
// `ProposalEditor`（`S-020`）の状態別描画テスト。T-09-01。
//
// 🔴 ここで固定するもの（「描かれていること / 描かれていないこと」が要件であり、API のテストでは示せない）:
//   ①🔴 提案先が未設定（経路 4 由来）なら「提案先が未設定です」が欄の直上に描かれ、「レビューに出す」は押せず、
//     押せない理由が描かれる（`docs/04` §S-020 改訂 10）。提案先が決まっていれば描かれない
//   ②🔴 `DRAFT` 以外は入力欄が disabled で、状態と理由が描かれ、「レビューに出す」が無い
//   ③凍結の予告（新規）に経験内容の行数と 0 行の注意が描かれ、作成ボタンは押せる（`F-008 AC-5`）
//   ④添付の選択肢は props の `attachment.options` だけ（`CLEAN` の版だけが渡る）。空なら案内
//   ⑤本文の由来が本文ブロックの直上に描かれる
//   ⑥`VIEWER`（`canEdit=false`）と停止中（`denialMessage`）には操作が無い
//   ⑦🔴 「無視して送信」「警告を無視して進む」に相当する語・ボタンが無い（`F-020 AC-2`）
//
// 🔴 `react-dom/server` の `renderToStaticMarkup` を使う（他の render テストと同じ）。`useEffect` は走らない。
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { ProposalAttachmentRows, ProposalEditorTargetRows, ProposalFormValues } from '../../../../lib/proposals/editor-rows';
import { toProposalCreateBody, toProposalPatchBody } from '../../../../lib/proposals/form-body';
import { ProposalEditor, type ProposalEditorMessages, type ProposalEditorProps } from './proposal-editor';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: () => undefined, refresh: () => undefined }),
}));

const PROPOSAL_ID = '01930000-0000-7000-8000-000000000301';
const SHEET = '01930000-0000-7000-8000-000000000501';

const messages: ProposalEditorMessages = {
  sectionTarget: '対象',
  sectionTerms: '提案条件',
  sectionContent: '本文',
  sectionAttachment: '添付（スキルシートの版）',
  sectionGate: 'ゲート結果',
  sectionSendingDomain: '送信元ドメインの状態',
  fieldProject: '案件',
  fieldEngineer: 'エンジニア',
  fieldAffiliation: '所属',
  fieldOwner: '作成した会社',
  fieldSkills: 'スキル（凍結）',
  fieldUnitPriceRange: '単価レンジ（凍結）',
  fieldAvailableFrom: '稼働可能時期（凍結）',
  fieldCareerCount: '経験内容（凍結）',
  fieldState: '状態',
  fieldRecipientCompanyName: '提案先の会社名',
  fieldRecipientEmail: '提案先の担当者メールアドレス',
  fieldOfferedUnitPrice: '提示単価',
  fieldOfferedStartDate: '開始日',
  fieldWorkStyle: '稼働形態',
  fieldSubject: '件名',
  fieldBody: '本文',
  required: '必須',
  projectNotShared: '（案件名は公開されていません）',
  recipientMissing: '提案先が未設定です。ゲート実行の前に設定してください。',
  recipientNote: '提案先は下書きの間だけ設定・変更できます。',
  bodyOriginLabel: '本文の由来',
  bodyOriginManual: '手入力',
  bodyMobileNote: 'モバイルでも編集できますが推奨しません。',
  attachmentNone: '添付しない',
  attachmentOpenSheets: 'スキルシートの取込を開く',
  attachmentFrozenNone: '添付はありません。',
  openEngineer: 'エンジニアの編集画面を開く',
  create: '提案を作成する',
  creating: '作成しています…',
  save: '下書きを保存',
  saving: '保存しています…',
  saved: '下書きを保存しました。',
  requestGate: 'レビューに出す',
  requestingGate: 'レビューを依頼しています…',
  gateRequested: 'レビューを依頼しました。',
  unsavedNote: '保存していない変更があります。',
  viewerNotice: '提案の編集・レビュー依頼は営業担当・管理者が行います。',
  deniedTitle: '提案の操作を行えません。',
  errorValidation: '入力内容をご確認ください。',
  errorNotEditable: '下書きではないため保存できません。',
  errorGeneric: '処理できませんでした。',
  errorNotClean: '検査済みではないため添付できません。',
  errorGateAlreadyCompleted: '検査はすでに完了しています。',
  errorRecipientMissing: '提案先が未設定です。',
  gateNotRequested: 'まだレビューに出していません。',
  gateRunning: '検査中',
  gateHeld: 'AI が上限到達で停止しています。',
  gateHeldResetAtPrefix: '再開予定: ',
  gateLayerPii: 'PII 層',
  gateLayerCommerce: '商流層',
  gateLayerConsistency: '整合層',
  gateVerdict: { PASS: '合格', FAIL: '不合格', RUNNING: '検査中', HELD: '検査中' },
  gateAiFailed: '検査を完了できなかったため送信できません。',
  gateFindingsTitle: '指摘',
  gateWarningsTitle: '警告（合否には影響しません）',
  gateWarningLabel: '警告',
  gateFindingsEmpty: '指摘はありません。',
  gateField: {
    subject: '件名',
    body: '本文',
    snapshot: '凍結情報',
    attachment: '添付',
    public_summary: '公開用の記載',
    project_name: '案件名',
    requirement: '要件',
    contract_document: '契約書',
  },
  gateFailedLead: '1 層でも不合格の提案は承認・送信へ進めません。',
  gatePassedLead: '全層が合格しました。',
};

const target: ProposalEditorTargetRows = {
  projectName: '架空案件',
  projectHref: '/projects/x',
  engineerName: '山田 太郎',
  affiliation: '株式会社パートナー',
  owner: null,
  skills: 'Java / AWS',
  unitPriceRange: '600,000〜800,000 円',
  availableFrom: '2026-11-01',
};

const attachment: ProposalAttachmentRows = {
  options: [{ id: SHEET, label: '版 2（2026-09-10 09:00 JST）' }],
  cleanOnlyNote: '検査済み（CLEAN）の版だけが選択肢に現れます。',
  emptyNotice: null,
  sheetsHref: null,
  frozenUnknownNotice: null,
};

const filled: ProposalFormValues = {
  recipientCompanyName: '架空エンド株式会社',
  recipientEmail: 'to@example.test',
  offeredUnitPrice: '650000',
  offeredStartDate: '2026-11-01',
  workStyle: '',
  subject: 'ご提案',
  body: '本文',
  skillSheetId: SHEET,
};

const empty: ProposalFormValues = { ...filled, recipientCompanyName: '', recipientEmail: '' };

function render(overrides: Partial<ProposalEditorProps> = {}): string {
  const props: ProposalEditorProps = {
    mode: 'EDIT',
    proposalId: PROPOSAL_ID,
    create: null,
    state: 'DRAFT',
    stateLabel: '下書き',
    target,
    freeze: { kind: 'FROZEN', notice: 'この提案には 2026-09-15 10:00 JST 時点の情報が使われます。', careers: '経験内容 4 行を凍結済み' },
    attachment,
    initial: filled,
    recipientMissing: false,
    originNotice: null,
    readOnlyNotice: null,
    canEdit: true,
    denialMessage: null,
    sendingDomain: { kind: 'VERIFIED', label: '送信元: @example.co.jp（検証済み）' },
    cancelHref: '/projects/x/candidates',
    approveHref: null,
    approveLabel: '承認画面を開く',
    cancelLabel: '候補検索に戻る',
    messages,
    ...overrides,
  };
  return renderToStaticMarkup(createElement(ProposalEditor, props));
}

function attr(html: string, testid: string): string {
  const index = html.indexOf(`data-testid="${testid}"`);
  if (index < 0) return '';
  const start = html.lastIndexOf('<', index);
  const end = html.indexOf('>', index);
  return html.slice(start, end + 1);
}

/** 🔴 属性としての `disabled`（Tailwind の `disabled:` 修飾子と区別する）。 */
function isDisabled(html: string, testid: string): boolean {
  const tag = attr(html, testid);
  expect(tag, `${testid} が描かれていない`).not.toBe('');
  return /\sdisabled(=""|\s|>)/.test(tag);
}

function hasRequired(html: string, testid: string): boolean {
  return /\srequired(=""|\s|>)/.test(attr(html, testid));
}

describe('🔴 docs/04 §S-020 改訂 10: 提案先が未設定なら明示し、レビューに出せない', () => {
  it('経路 4 由来の DRAFT: 「提案先が未設定です」+ 由来の説明が欄の直上に描かれ、「レビューに出す」は disabled で理由が描かれる', () => {
    const html = render({
      initial: empty,
      recipientMissing: true,
      originNotice: 'この提案は提案依頼の応諾で作成されました。',
    });
    expect(html).toContain('data-testid="proposal-editor-recipient-missing"');
    expect(html).toContain('提案先が未設定です。ゲート実行の前に設定してください。');
    expect(html).toContain('data-testid="proposal-editor-origin-notice"');
    expect(isDisabled(html, 'proposal-editor-request-gate')).toBe(true);
    expect(html).toContain('data-testid="proposal-editor-request-gate-blocked"');
    // 入力欄自体は編集できる（ここで埋める）。
    expect(isDisabled(html, 'proposal-editor-recipient-company-name')).toBe(false);
  });

  it('#36 で作った提案（提案先あり）: 未設定の表示が無く、「レビューに出す」が押せる', () => {
    const html = render();
    expect(html).not.toContain('proposal-editor-recipient-missing');
    expect(html).not.toContain('proposal-editor-origin-notice');
    expect(isDisabled(html, 'proposal-editor-request-gate')).toBe(false);
    expect(html).not.toContain('proposal-editor-request-gate-blocked');
    expect(html).toContain('value="架空エンド株式会社"');
  });
});

describe('🔴 DRAFT 以外は読み取り専用', () => {
  it('GATE_RUNNING: 状態と理由が描かれ、入力欄は disabled、「レビューに出す」が無い', () => {
    const html = render({ state: 'GATE_RUNNING', stateLabel: '検査中', readOnlyNotice: 'この提案は「検査中」のため、内容を編集できません。' });
    expect(html).toContain('data-testid="proposal-editor-read-only"');
    expect(html).toContain('data-proposal-state="GATE_RUNNING"');
    expect(isDisabled(html, 'proposal-editor-subject')).toBe(true);
    expect(isDisabled(html, 'proposal-editor-body')).toBe(true);
    expect(isDisabled(html, 'proposal-editor-save')).toBe(true);
    expect(html).not.toContain('proposal-editor-request-gate"');
    // ゲート結果は読み込み中（ポーリングは useEffect。静的描画では走らない）。
    expect(html).toContain('data-testid="proposal-editor-gate-loading"');
  });
});

describe('新規（CREATE）: 凍結の予告と作成', () => {
  const createProps: Partial<ProposalEditorProps> = {
    mode: 'CREATE',
    proposalId: null,
    create: { projectId: 'p', engineerId: 'e', editHrefPattern: '/proposals/{id}/edit' },
    state: null,
    stateLabel: null,
    initial: empty,
  };

  it('🔴 F-008 AC-5: 経験内容 0 行の注意が描かれるが、作成ボタンは押せる', () => {
    const html = render({
      ...createProps,
      freeze: { kind: 'PREVIEW', lead: '作成すると凍結されます。', careers: '経験内容 0 行を凍結します。', zeroCareersNotice: '経験内容が 0 行です。', engineerEditHref: '/engineers/e/edit' },
    });
    expect(html).toContain('data-testid="proposal-editor-freeze-preview"');
    expect(html).toContain('経験内容 0 行を凍結します。');
    expect(html).toContain('data-testid="proposal-editor-freeze-zero-careers"');
    expect(html).toContain('href="/engineers/e/edit"');
    expect(isDisabled(html, 'proposal-editor-create')).toBe(false);
    expect(html).not.toContain('proposal-editor-request-gate');
    expect(html).not.toContain('proposal-editor-section-gate');
    // 提案先は必須入力（`required`）。
    expect(hasRequired(html, 'proposal-editor-recipient-company-name')).toBe(true);
    expect(hasRequired(html, 'proposal-editor-recipient-email')).toBe(true);
  });

  it('経験内容が 1 行以上なら注意は無い', () => {
    const html = render({
      ...createProps,
      freeze: { kind: 'PREVIEW', lead: '作成すると凍結されます。', careers: '経験内容 4 行を凍結します。', zeroCareersNotice: null, engineerEditHref: '/engineers/e/edit' },
    });
    expect(html).not.toContain('proposal-editor-freeze-zero-careers');
    expect(html).toContain('経験内容 4 行を凍結します。');
  });
});

describe('添付・本文の由来・送信元ドメイン', () => {
  it('🔴 F-019 AC-3: 添付の選択肢は渡された版だけで、注記「CLEAN の版だけ」が常に描かれる', () => {
    const html = render();
    expect(html).toContain('data-testid="proposal-editor-attachment"');
    expect(html).toContain(`value="${SHEET}"`);
    expect(html).toContain('data-testid="proposal-editor-attachment-clean-note"');
    const emptyHtml = render({ attachment: { ...attachment, options: [], emptyNotice: '共有できるスキルシートがありません。', sheetsHref: '/engineers/e/skill-sheets' } });
    expect(emptyHtml).toContain('data-testid="proposal-editor-attachment-empty"');
    expect(emptyHtml).toContain('href="/engineers/e/skill-sheets"');
    expect(emptyHtml).not.toContain('proposal-editor-attachment"');
  });

  it('本文の由来（手入力）が本文ブロックの直上に描かれる', () => {
    const html = render();
    const origin = html.indexOf('data-testid="proposal-editor-body-origin"');
    const body = html.indexOf('data-testid="proposal-editor-body"');
    expect(origin).toBeGreaterThan(-1);
    expect(origin).toBeLessThan(body);
    expect(html).toContain('本文の由来: 手入力');
  });

  it('送信元ドメイン: 未検証なら S-036 への導線、取引先は注記だけ', () => {
    const unverified = render({ sendingDomain: { kind: 'UNVERIFIED', notice: '送信元ドメインが未設定です。', href: '/settings/sending-domains', linkLabel: '送信ドメインの設定を開く' } });
    expect(unverified).toContain('data-testid="proposal-editor-sending-domain-open"');
    const partner = render({ sendingDomain: { kind: 'PARTNER', note: '送信元ドメインはホストが設定します。' } });
    expect(partner).toContain('送信元ドメインはホストが設定します。');
    expect(partner).not.toContain('proposal-editor-sending-domain-open');
  });
});

describe('権限差分と停止中', () => {
  it('VIEWER（canEdit=false）には操作が無く、閲覧はできる', () => {
    const html = render({ canEdit: false });
    expect(html).toContain('data-testid="proposal-editor-viewer"');
    expect(isDisabled(html, 'proposal-editor-save')).toBe(true);
    expect(isDisabled(html, 'proposal-editor-request-gate')).toBe(true);
    expect(isDisabled(html, 'proposal-editor-subject')).toBe(true);
    expect(html).toContain('山田 太郎');
  });

  it('停止中（denialMessage）は理由が描かれ、操作は押せない', () => {
    const html = render({ denialMessage: 'この組織は利用停止中です。' });
    expect(html).toContain('data-testid="proposal-editor-denied"');
    expect(isDisabled(html, 'proposal-editor-request-gate')).toBe(true);
  });

  it('🔴 F-020 AC-2: 「無視して送信」「警告を無視して進む」「強制」に相当する語が無い', () => {
    for (const html of [render(), render({ state: 'GATE_FAILED', stateLabel: '差し戻し', readOnlyNotice: 'x' })]) {
      expect(html).not.toMatch(/無視して/);
      expect(html).not.toMatch(/強制/);
      expect(html).not.toMatch(/force|override|skipLayers/);
    }
  });
});

describe('送信する body（`lib/proposals/form-body.ts`。画面と結合テストが同じ関数を使う）', () => {
  it('🔴 提案先の 2 列は空なら載せない（スキーマが空を受けないため）。その他は空 → null', () => {
    expect(toProposalCreateBody(empty)).toEqual({
      offeredUnitPrice: 650000,
      offeredStartDate: '2026-11-01',
      workStyle: null,
      subject: 'ご提案',
      body: '本文',
    });
    expect(toProposalCreateBody(filled)).toMatchObject({ recipientCompanyName: '架空エンド株式会社', recipientEmail: 'to@example.test' });
    expect(toProposalCreateBody({ ...filled, offeredUnitPrice: '1.5' }).offeredUnitPrice).toBeNull();
  });

  it('🔴 NG-1: 添付を変えていなければ PATCH の body に skillSheetId を含まない（キーごと無い。未指定 = 変更しない）', () => {
    const unchanged = toProposalPatchBody(filled, filled);
    expect(Object.keys(unchanged)).not.toContain('skillSheetId');
    expect(Object.keys(toProposalPatchBody({ ...filled, subject: '改訂' }, filled))).not.toContain('skillSheetId');
    // 添付を外す / 差し替えるときだけ載る。
    expect(toProposalPatchBody({ ...filled, skillSheetId: '' }, filled)).toMatchObject({ skillSheetId: null });
    const other = '01930000-0000-7000-8000-000000000502';
    expect(toProposalPatchBody({ ...filled, skillSheetId: other }, filled)).toMatchObject({ skillSheetId: other });
    // 空 → 空（添付なしのまま）も載せない。
    expect(Object.keys(toProposalPatchBody({ ...filled, skillSheetId: '' }, { ...filled, skillSheetId: '' }))).not.toContain('skillSheetId');
  });
});
