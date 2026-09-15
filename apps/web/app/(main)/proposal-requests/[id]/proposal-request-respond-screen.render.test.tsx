// apps/web/app/(main)/proposal-requests/[id]/proposal-request-respond-screen.render.test.tsx
// `ProposalRequestRespondScreen`（`S-018`）の状態別描画テスト。T-08-07。
//
// 🔴 ここで固定するもの（「描かれていること / 描かれていないこと」が要件であり、API のテストでは示せない）:
//   ①判断材料（案件名・見出し・条件・必須 / 尚可要件・依頼メッセージ・期限・開示される 3 項目）が 1 画面に描かれる
//     （`CLAUDE.md` §13.3。折りたたみ・省略の枝が無い）
//   ②🔴 案件が公開されていない（`project: null`）ときは応諾のボタンが**無く**、辞退のボタンは**ある**（`BR-57`）
//   ③状態が `REQUESTED` 以外なら応諾・辞退のボタンが無く、専用の文言が描かれる（`F-018 AC-5`）
//   ④`VIEWER`（`canRespond=false`）と停止中（`denialMessage`）には操作が無い（拒否の本体は API のガード）
//   ⑤辞退済みの画面は自社の記録として理由を再表示する（ホストの画面にはこの枝が存在しない —— 型に無い）
//
// 🔴 `react-dom/server` の `renderToStaticMarkup` を使う（他の render テストと同じ）。`useEffect` は走らない。
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { ProposalRequestDetailRows } from '../../../../lib/proposal-requests/detail-rows';
import {
  ProposalRequestRespondScreen,
  type ProposalRequestRespondScreenMessages,
  type ProposalRequestRespondScreenProps,
} from './proposal-request-respond-screen';

const NOW_MS = Date.parse('2026-09-15T03:00:00.000Z');
const REQUEST_ID = '01930000-0000-7000-8000-000000000201';
const PROJECT_ID = '01930000-0000-7000-8000-0000000000f1';
const ENGINEER_ID = '01930000-0000-7000-8000-0000000000e2';

const messages: ProposalRequestRespondScreenMessages = {
  backToList: '提案依頼の一覧に戻る',
  sectionRequest: '依頼の内容',
  sectionEngineer: '対象の自社エンジニア',
  sectionDisclosure: '応諾するとどうなるか',
  sectionActions: '返答',
  fieldProject: '案件',
  fieldMessage: '依頼メッセージ',
  fieldExpiresAt: '返答期限',
  fieldCreatedAt: '依頼日時',
  fieldRespondedAt: '返答日時',
  requirementsMust: '必須要件',
  requirementsNice: '尚可要件',
  requirementsEmpty: '登録された要件はありません。',
  requirementColumnRequirement: '要件',
  requirementColumnYears: '経験年数',
  openProject: '案件詳細を開く',
  openEngineer: 'エンジニア詳細を開く',
  engineerMissing: '対象のエンジニアは台帳から削除されています。',
  projectNotShared: 'この案件は御社に公開されていないため、応諾できません（辞退は可能です）。',
  disclosureLead: '応諾すると、この人材の氏名・貴社名・スキルシートがホストに開示され、提案（下書き）が作成されます。',
  disclosureItems: ['氏名', '貴社名（所属会社名）', 'スキルシート（最新の検査済みの版）'],
  accept: '応諾する',
  acceptConfirmTitle: '応諾して、次の項目をホストに開示しますか',
  acceptConfirmLead: '応諾は取り消せません。',
  acceptConfirmSubmit: '開示して応諾する',
  acceptConfirmCancel: 'やめる',
  acceptSubmitting: '提案の下書きを作成しています…',
  acceptDone: '応諾しました。',
  acceptDoneProposalId: '提案の下書き ID',
  acceptDoneNext: '提案先はまだ設定されていません。編集画面で整えてからレビューに出せます。',
  openProposal: '提案の編集画面を開く',
  decline: '辞退する',
  declineReasonLabel: '辞退の理由（社内向けの記録。任意）',
  declineReasonNote: 'この理由はホストには開示されません。',
  declineSubmit: '辞退を確定する',
  declineCancel: 'やめる',
  declineSubmitting: '辞退を記録しています…',
  declineDone: '辞退しました。',
  declineRecordedReason: '記録した理由（社内限定）',
  declineRecordedReasonNone: '（理由は記録されていません）',
  errorState: 'この依頼は既に返答待ちではありません。',
  errorProjectNotShared: 'この案件は御社に公開されていないため、応諾できません。',
  errorGeneric: '処理できませんでした。',
  viewerNotice: '応諾・辞退は営業担当・管理者が行います。',
  deniedTitle: '提案依頼の操作を行えません。',
  remaining: { prefix: '残り ', days: ' 日', hours: ' 時間', minutes: ' 分', lessThanMinute: '1 分未満', expired: '期限を過ぎました' },
  remainingNone: '—',
  valueNone: '—',
};

const rows: ProposalRequestDetailRows = {
  id: REQUEST_ID,
  state: 'REQUESTED',
  stateLabel: '返答待ち',
  message: '11 月開始を希望します。',
  expiresAtIso: '2026-09-22T14:59:59.000Z',
  expiresAt: '2026-09-22 23:59 JST',
  createdAt: '2026-09-15 10:00 JST',
  respondedAt: null,
  project: {
    id: PROJECT_ID,
    name: '架空案件',
    headline: [
      { key: 'status', label: '案件の状態', value: '募集中' },
      { key: 'headcount', label: '募集人数', value: '2 名' },
      { key: 'startDate', label: '稼働開始日', value: '2026-11-01' },
    ],
    conditions: [
      { key: 'unitPrice', label: '単価レンジ', value: '600,000〜700,000 円' },
      { key: 'prefecture', label: '勤務地', value: '東京都' },
      { key: 'remoteMode', label: 'リモート', value: '一部リモート可' },
    ],
    mustRequirements: [{ key: 'MUST-0', requirement: 'TypeScript', years: '3 年' }],
    niceRequirements: [{ key: 'NICE-0', requirement: 'AWS の運用経験', years: '—' }],
    publicSummary: '公開用の概要',
    href: `/projects/${PROJECT_ID}`,
  },
  engineer: { id: ENGINEER_ID, displayName: '山田 太郎', href: `/engineers/${ENGINEER_ID}` },
  declineReason: null,
  proposalId: null,
  canAccept: true,
  canDecline: true,
  closedNotice: null,
  listHref: '/proposal-requests',
};

function render(overrides: Partial<ProposalRequestRespondScreenProps> = {}): string {
  const props: ProposalRequestRespondScreenProps = {
    rows,
    canRespond: true,
    denialMessage: null,
    nowMs: NOW_MS,
    messages,
    ...overrides,
  };
  return renderToStaticMarkup(createElement(ProposalRequestRespondScreen, props));
}

describe('🔴 CLAUDE.md §13.3 / docs/04 §S-018: 判断材料が 1 画面に描かれる', () => {
  it('案件名・見出し・条件・必須 / 尚可要件・依頼メッセージ・期限・開示 3 項目・対象エンジニアがすべて描かれる', () => {
    const html = render();
    expect(html).toContain('data-testid="proposal-request-respond-screen"');
    expect(html).toContain('data-request-state="REQUESTED"');
    expect(html).toContain('架空案件');
    for (const value of ['募集中', '2 名', '2026-11-01', '600,000〜700,000 円', '東京都', '一部リモート可']) {
      expect(html).toContain(value);
    }
    expect(html).toContain('data-testid="proposal-request-respond-requirements-MUST"');
    expect(html).toContain('TypeScript');
    expect(html).toContain('data-testid="proposal-request-respond-requirements-NICE"');
    expect(html).toContain('AWS の運用経験');
    expect(html).toContain('11 月開始を希望します。');
    expect(html).toContain('2026-09-22 23:59 JST');
    // 🔴 残り時間はサーバ時刻（`nowMs`）で描かれる（期限は 7 日後）。
    expect(html).toMatch(/残り 7 日/);
    // 🔴 `F-018 AC-3`: 開示される 3 項目と、開示が起きる旨。
    expect(html).toContain('data-testid="proposal-request-respond-disclosure-items"');
    for (const item of messages.disclosureItems) expect(html).toContain(item);
    expect(html).toContain('山田 太郎');
    expect(html).toContain(`href="/engineers/${ENGINEER_ID}"`);
    expect(html).toContain(`href="/projects/${PROJECT_ID}"`);
    // 操作: 応諾と辞退が同じ行にある。
    expect(html).toContain('data-testid="proposal-request-respond-accept"');
    expect(html).toContain('data-testid="proposal-request-respond-decline"');
    // 🔴 「折りたたむ」「もっと見る」に相当する要素が無い（省略の枝を持たない）。
    expect(html).not.toMatch(/<details/);
  });

  it('🔴 案件が公開されていない（project: null）ときは応諾のボタンが無く、辞退のボタンはある（BR-57）', () => {
    const html = render({ rows: { ...rows, project: null, canAccept: false } });
    expect(html).toContain('data-testid="proposal-request-respond-project-not-shared"');
    expect(html).toContain('応諾できません');
    expect(html).not.toContain('data-testid="proposal-request-respond-accept"');
    expect(html).toContain('data-testid="proposal-request-respond-decline"');
    // 依頼メッセージ・期限・対象エンジニアは引き続き描かれる（隠さない）。
    expect(html).toContain('11 月開始を希望します。');
    expect(html).toContain('山田 太郎');
  });
});

describe('🔴 状態別（F-018 AC-5: 終端は別々の文言で、操作は無い）', () => {
  it.each([
    ['ACCEPTED', 'この提案依頼は応諾済みです。'],
    ['DECLINED', 'この提案依頼は辞退済みです。'],
    ['EXPIRED', 'この提案依頼は期限が切れました。'],
    ['WITHDRAWN_BY_HOST', 'この提案依頼はホストにより取り下げられました。'],
  ] as const)('%s では応諾・辞退のボタンが無く、専用文言が描かれる', (state, notice) => {
    const html = render({
      rows: { ...rows, state, stateLabel: state, canAccept: false, canDecline: false, closedNotice: notice, respondedAt: '2026-09-16 11:00 JST' },
    });
    expect(html).toContain('data-testid="proposal-request-respond-closed"');
    expect(html).toContain(notice);
    expect(html).not.toContain('data-testid="proposal-request-respond-accept"');
    expect(html).not.toContain('data-testid="proposal-request-respond-decline"');
    // 終端では残り時間を出さない。
    expect(html).not.toMatch(/残り \d+ 日/);
  });

  it('辞退済みは自社の記録として理由を再表示し、理由が無ければその旨を出す', () => {
    const declined = render({
      rows: { ...rows, state: 'DECLINED', canAccept: false, canDecline: false, closedNotice: 'x', declineReason: '社内都合により辞退' },
    });
    expect(declined).toContain('data-testid="proposal-request-respond-recorded-reason-value"');
    expect(declined).toContain('社内都合により辞退');
    const noReason = render({
      rows: { ...rows, state: 'DECLINED', canAccept: false, canDecline: false, closedNotice: 'x', declineReason: null },
    });
    expect(noReason).toContain('（理由は記録されていません）');
  });

  it('応諾済みは下書きの ID を示し、S-020（編集画面）への導線を出す（✅ T-09-01）', () => {
    const html = render({
      rows: { ...rows, state: 'ACCEPTED', canAccept: false, canDecline: false, closedNotice: 'x', proposalId: '01930000-0000-7000-8000-000000000301' },
    });
    expect(html).toContain('data-testid="proposal-request-respond-accepted-before"');
    expect(html).toContain('01930000-0000-7000-8000-000000000301');
    expect(html).toContain('data-testid="proposal-request-respond-open-proposal"');
    expect(html).toContain('href="/proposals/01930000-0000-7000-8000-000000000301/edit"');
    expect(html).not.toContain('後続のリリース');
  });
});

describe('権限差分と停止中', () => {
  it('VIEWER（canRespond=false）には操作が無く、閲覧はできる', () => {
    const html = render({ canRespond: false });
    expect(html).toContain('data-testid="proposal-request-respond-viewer"');
    expect(html).not.toContain('data-testid="proposal-request-respond-accept"');
    expect(html).not.toContain('data-testid="proposal-request-respond-decline"');
    expect(html).toContain('架空案件');
  });

  it('停止中（denialMessage）は理由が出て、操作が無い', () => {
    const html = render({ denialMessage: 'この組織は現在停止中です。' });
    expect(html).toContain('data-testid="proposal-request-respond-denied"');
    expect(html).toContain('この組織は現在停止中です。');
    expect(html).not.toContain('data-testid="proposal-request-respond-accept"');
    expect(html).not.toContain('data-testid="proposal-request-respond-decline"');
  });

  it('台帳の行が消えた競合では文言で示す（落とさない）', () => {
    expect(render({ rows: { ...rows, engineer: null } })).toContain('data-testid="proposal-request-respond-engineer-missing"');
  });
});
