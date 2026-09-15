// apps/web/lib/proposals/editor-rows.test.ts
// `S-020` の表示値の組み立てを固定する（docs/04 §S-020 改訂 10 / `F-019 AC-2` `AC-3` / `F-008 AC-5`）。T-09-01。
import { describe, expect, it } from 'vitest';
import { t } from '@ses/i18n';
import { proposalCreateRows, proposalEditRows, proposalSendingDomainRows } from './editor-rows';
import type { ProposalCreationTargetView, ProposalEditorView } from './service';
import type { HostProposalView, PartnerProposalView } from './views';

const PROJECT = '01930000-0000-7000-8000-0000000000f1';
const ENGINEER = '01930000-0000-7000-8000-0000000000e2';
const SHEET = '01930000-0000-7000-8000-000000000501';

const base = {
  id: '01930000-0000-7000-8000-000000000301',
  state: 'DRAFT' as const,
  origin: 'OWN' as const,
  project: { id: PROJECT, name: '架空案件' },
  recipient: { companyName: '架空エンド株式会社', email: 'to@example.test' },
  terms: { offeredUnitPrice: 650000, offeredStartDate: '2026-11-01', workStyle: null },
  content: { subject: null, body: null, bodyOrigin: 'MANUAL' as const },
  snapshot: {
    frozenAt: '2026-09-15T01:00:00.000Z',
    displayName: '山田 太郎',
    affiliationLabel: null,
    skills: [{ skillId: 's1', name: 'Java', years: 5, level: null }],
    careerCount: 4,
    unitPriceMin: 600000,
    unitPriceMax: 800000,
    availableFrom: '2026-11-01',
    prefecture: '13',
    remoteMode: null,
  },
  attachment: { skillSheetId: SHEET },
  contentHash: 'h',
  createdAt: '2026-09-15T01:00:00.000Z',
  updatedAt: '2026-09-15T01:00:00.000Z',
};

const partnerView: PartnerProposalView = { audience: 'PARTNER', ...base };
const hostView: HostProposalView = { audience: 'HOST', owner: { kind: 'PARTNER', partnerCompanyName: 'Partner A1' }, ...base };

function editor(view: PartnerProposalView | HostProposalView, overrides: Partial<ProposalEditorView> = {}): ProposalEditorView {
  return {
    view,
    canEdit: true,
    attachableSkillSheets: [{ id: SHEET, version: 2, uploadedAt: '2026-09-10T00:00:00.000Z' }],
    ownedEngineerId: ENGINEER,
    ...overrides,
  };
}

describe('proposalEditRows（編集）', () => {
  it('🔴 提案先が未設定（経路 4 由来）なら recipientMissing と originNotice を立て、入力欄は空で開く', () => {
    const rows = proposalEditRows(
      editor({ ...partnerView, origin: 'PROPOSAL_REQUEST', recipient: null }),
    );
    expect(rows.recipientMissing).toBe(true);
    expect(rows.originNotice).toBe(t('proposals.editor.recipient.originRequest'));
    expect(rows.initial.recipientCompanyName).toBe('');
    expect(rows.initial.recipientEmail).toBe('');
    expect(rows.readOnlyNotice).toBeNull();
  });

  it('#36 で作った提案は提案先が決まった状態で開く', () => {
    const rows = proposalEditRows(editor(partnerView));
    expect(rows.recipientMissing).toBe(false);
    expect(rows.originNotice).toBeNull();
    expect(rows.initial).toEqual({
      recipientCompanyName: '架空エンド株式会社',
      recipientEmail: 'to@example.test',
      offeredUnitPrice: '650000',
      offeredStartDate: '2026-11-01',
      workStyle: '',
      subject: '',
      body: '',
      skillSheetId: SHEET,
    });
  });

  it('🔴 DRAFT 以外は読み取り専用の理由（状態の語を含む）を持つ', () => {
    const rows = proposalEditRows(editor({ ...partnerView, state: 'GATE_RUNNING' }));
    expect(rows.readOnlyNotice).toContain(t('proposals.state.GATE_RUNNING'));
    expect(rows.stateLabel).toBe(t('proposals.state.GATE_RUNNING'));
  });

  it('🔴 F-019 AC-2: 凍結情報は凍結時点の値で、経験内容の行数を伴う', () => {
    const rows = proposalEditRows(editor(hostView));
    expect(rows.freeze.kind).toBe('FROZEN');
    if (rows.freeze.kind !== 'FROZEN') throw new Error('unreachable');
    expect(rows.freeze.notice).toContain('2026-09-15 10:00 JST');
    expect(rows.freeze.careers).toBe(`${t('proposals.editor.freeze.frozenCareersPrefix')}4${t('proposals.editor.freeze.frozenCareersSuffix')}`);
    expect(rows.target.engineerName).toBe('山田 太郎');
    expect(rows.target.owner).toBe('Partner A1');
    expect(rows.target.unitPriceRange).toContain('600,000');
  });

  it('取引先の view には作成した会社の行が無い（型に owner が無い）', () => {
    expect(proposalEditRows(editor(partnerView)).target.owner).toBeNull();
  });

  it('🔴 F-019 AC-3: 添付の選択肢は渡された CLEAN の版だけで、凍結された版が選択肢に無ければその旨を出す', () => {
    const known = proposalEditRows(editor(hostView));
    expect(known.attachment.options.map((option) => option.id)).toEqual([SHEET]);
    expect(known.attachment.frozenUnknownNotice).toBeNull();
    expect(known.attachment.emptyNotice).toBeNull();

    // ホストがパートナー作成の提案を開いた（他社の台帳は読めず選択肢 0 件、凍結された版はある）。
    const unknown = proposalEditRows(editor(hostView, { attachableSkillSheets: [], ownedEngineerId: null }));
    expect(unknown.attachment.options).toEqual([]);
    expect(unknown.attachment.frozenUnknownNotice).toBe(t('proposals.editor.attachment.frozenUnknown'));
    expect(unknown.attachment.emptyNotice).toBeNull();
    expect(unknown.attachment.sheetsHref).toBeNull();

    // 自社の台帳だが CLEAN の版が無く、凍結もされていない → 空の案内 + S-008 への導線。
    const empty = proposalEditRows(
      editor({ ...partnerView, attachment: { skillSheetId: null } }, { attachableSkillSheets: [] }),
    );
    expect(empty.attachment.emptyNotice).toBe(t('proposals.editor.attachment.empty'));
    expect(empty.attachment.sheetsHref).toBe(`/engineers/${ENGINEER}/skill-sheets`);
  });

  it('取引先で公開が解除された案件は案件名が null で、戻り先は S-017', () => {
    const rows = proposalEditRows(editor({ ...partnerView, project: null }));
    expect(rows.target.projectName).toBeNull();
    expect(rows.cancelHref).toBe('/proposal-requests');
  });
});

describe('proposalCreateRows（新規）', () => {
  const target: ProposalCreationTargetView = {
    project: { id: PROJECT, name: '架空案件' },
    engineer: {
      id: ENGINEER,
      displayName: '山田 太郎',
      affiliationLabel: null,
      skillNames: ['Java', 'AWS'],
      careerCount: 0,
      latestCleanSkillSheet: null,
    },
  };

  it('🔴 F-008 AC-5: 経験内容 0 行は注意を出すだけで、作成の導線を止める材料を持たない', () => {
    const rows = proposalCreateRows(target);
    expect(rows.freeze.kind).toBe('PREVIEW');
    if (rows.freeze.kind !== 'PREVIEW') throw new Error('unreachable');
    expect(rows.freeze.careers).toBe(`${t('proposals.editor.freeze.careersPrefix')}0${t('proposals.editor.freeze.careersSuffix')}`);
    expect(rows.freeze.zeroCareersNotice).toBe(t('proposals.editor.freeze.careersZero'));
    expect(rows.freeze.engineerEditHref).toBe(`/engineers/${ENGINEER}/edit`);
    expect(rows.initial.recipientCompanyName).toBe('');
    expect(rows.editHrefPattern).toBe('/proposals/{id}/edit');
    expect(rows.cancelHref).toBe(`/projects/${PROJECT}/candidates`);
  });

  it('経験内容が 1 行以上なら注意は無く、最新の CLEAN 版が添付の初期値になる', () => {
    const rows = proposalCreateRows({
      ...target,
      engineer: { ...target.engineer, careerCount: 3, latestCleanSkillSheet: { id: SHEET, version: 2 } },
    });
    if (rows.freeze.kind !== 'PREVIEW') throw new Error('unreachable');
    expect(rows.freeze.zeroCareersNotice).toBeNull();
    expect(rows.attachment.options).toHaveLength(1);
    expect(rows.attachment.emptyNotice).toBeNull();
    expect(rows.initial.skillSheetId).toBe(SHEET);
  });

  it('CLEAN の版が無ければ空の案内と S-008 への導線', () => {
    const rows = proposalCreateRows(target);
    expect(rows.attachment.options).toEqual([]);
    expect(rows.attachment.emptyNotice).toBe(t('proposals.editor.attachment.empty'));
    expect(rows.attachment.sheetsHref).toBe(`/engineers/${ENGINEER}/skill-sheets`);
  });
});

describe('proposalSendingDomainRows', () => {
  it('4 状態を別々の形に写す', () => {
    expect(proposalSendingDomainRows({ kind: 'PARTNER' }).kind).toBe('PARTNER');
    expect(proposalSendingDomainRows({ kind: 'NOT_REQUIRED' }).kind).toBe('NOT_REQUIRED');
    const unverified = proposalSendingDomainRows({ kind: 'UNVERIFIED' });
    expect(unverified.kind === 'UNVERIFIED' && unverified.href).toBe('/settings/sending-domains');
    const verified = proposalSendingDomainRows({ kind: 'VERIFIED', domain: 'example.co.jp' });
    expect(verified.kind === 'VERIFIED' && verified.label).toContain('@example.co.jp');
  });
});
