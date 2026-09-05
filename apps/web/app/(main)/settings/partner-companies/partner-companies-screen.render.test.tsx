// apps/web/app/(main)/settings/partner-companies/partner-companies-screen.render.test.tsx
// `PartnerCompaniesScreen`（`S-014`）の状態別描画テスト。T-04-07。
//
// 🔴 なぜこの粒度で要るか（`sending-domain-screen.render.test.tsx` と同じ理由）:
//    E2E は `development` 固定であり `sendingDomainRuntime().verificationRequired` は常に
//    `false` になるため、**「未検証だから招待できない」表示（`F-007 AC-5` / `docs/04` §S-014）は
//    ブラウザ E2E から 1 度も観測できない**。props を直構築するこのテストだけがその粒度を担保する。
//    同じく `PARTNER_ADMIN` 視点（`canManage=false`）の描画も、E2E の seed 依存を避けてここで固定する。
//
// 🔴 `@testing-library/react` を使わず `react-dom/server` の `renderToStaticMarkup` を使う
//    （新規依存を増やさない）。JSX を書かず `createElement` を直接呼ぶのも同じ理由。
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type {
  PartnerCompanyListView,
  PartnerCompanyView,
} from '../../../../lib/partner-companies/service';
import {
  PartnerCompaniesScreen,
  SandboxInviteLinkPanel,
  type PartnerCompaniesScreenMessages,
} from './partner-companies-screen';

const PARTNER_A = '01930000-0000-7000-8000-0000000000c1';
const PARTNER_B = '01930000-0000-7000-8000-0000000000c2';

function company(overrides: Partial<PartnerCompanyView> = {}): PartnerCompanyView {
  return {
    id: PARTNER_A,
    name: '架空テック株式会社',
    contactName: '架空 太郎',
    contactEmail: 'contact@partner.example',
    status: 'ACTIVE',
    invitedAt: '2026-05-12T00:00:00.000Z',
    suspendedAt: null,
    accountCount: 4,
    pendingInvitationCount: 1,
    openProjectCount: 3,
    proposalCount: 12,
    lastActivityAt: '2026-08-31T00:41:00.000Z',
    ...overrides,
  };
}

const messages: PartnerCompaniesScreenMessages = {
  partnerScopeNotice: 'この画面には御社の情報のみが表示されます。',
  readOnlyNote: '閲覧のみの権限のため、登録・招待・停止は行えません。',

  sectionList: '取引先一覧',
  columnName: '企業名',
  columnStatus: '状態',
  columnAccountCount: 'アカウント数',
  columnOpenProjectCount: '公開中の案件数',
  columnProposalCount: '提案数',
  columnLastActivity: '最終アクティビティ',
  statusLabels: { ACTIVE: '有効', SUSPENDED: '停止' },
  valueNone: '—',
  select: '選択',
  empty: '取引先が登録されていません。取引先を招待すると、案件を公開して提案を受け取れるようになります。',

  sectionRegister: '取引先の登録',
  registerNameLabel: '企業名',
  registerContactNameLabel: '担当者名（任意）',
  registerContactEmailLabel: '担当者メールアドレス（任意）',
  registerSubmit: '登録する',
  registerSubmitting: '登録しています…',
  registerDone: '取引先を登録しました。',
  registerError: '登録できませんでした。',

  sectionDetail: '取引先の詳細',
  detailSelectPrompt: '一覧から取引先を選ぶと、招待の発行と停止の操作が行えます。',
  detailContactName: '担当者',
  detailContactEmail: '担当者メールアドレス',
  detailInvitedAt: '登録日',
  detailPendingInvitations: '未受諾の招待',
  detailSuspendedAt: '停止日時',

  sectionInvite: '招待の発行',
  inviteEmailLabel: 'メールアドレス',
  inviteRoleLabel: 'ロール',
  inviteRoleValue: 'PARTNER_ADMIN（取引先の管理者）',
  inviteSubmit: '招待を作成',
  inviteSubmitting: '作成しています…',
  inviteQueued: '送信を受け付けました。',
  inviteHeld: '招待を作成しました。送信元ドメインの検証が完了してから送達されます。',
  inviteError: '招待を作成できませんでした。',
  inviteBlocked: '送信元ドメインの検証が完了するまで、取引先を招待できません。',
  inviteBlockedLink: '送信ドメインを設定する',
  inviteBlockedMemberInviteNote: '※ 自社メンバーの招待は検証の完了を待たずに実行できます。',

  inviteLinkHeading: '招待リンク',
  inviteLinkNotice: 'サンドボックス環境では招待メールが送信されません。このリンクをお渡しください。',
  inviteLinkOnceOnly: '※ 有効期限があり、受諾は 1 回限りです。この画面を離れると再表示できません。',
  inviteLinkLabel: '受諾リンク',
  inviteLinkCopy: 'リンクをコピー',
  inviteLinkCopied: 'コピーしました。',
  inviteLinkCopyFailed: 'コピーできませんでした。',
  inviteLinkPreNotice:
    'サンドボックス環境では、取引先の担当者宛のメールは送信されません。招待を作成すると受諾リンクが表示されます。',

  sectionSuspension: '取引先の停止',
  suspensionReasonLabel: '理由（任意）',
  suspendSubmit: 'この取引先を停止する',
  suspendConfirmTitle: '停止の確認',
  suspendConfirmText:
    '配下アカウントは提案の作成・送信・チャット投稿ができなくなります。データは削除されません。',
  suspendConfirm: '停止する',
  suspendCancel: 'キャンセル',
  suspendSubmitting: '停止しています…',
  resumeSubmit: 'この取引先の停止を解除する',
  resumeSubmitting: '解除しています…',
  suspensionError: '実行できませんでした。',
};

function render(
  initial: PartnerCompanyListView,
  options: {
    canManage?: boolean;
    invitationBlocked?: boolean;
    sandboxLinkHandover?: boolean;
  } = {},
): string {
  return renderToStaticMarkup(
    createElement(PartnerCompaniesScreen, {
      initial,
      canManage: options.canManage ?? true,
      invitationBlocked: options.invitationBlocked ?? false,
      sandboxLinkHandover: options.sandboxLinkHandover ?? false,
      messages,
    }),
  );
}

describe('S-014 ホストの ADMIN 視点（docs/04 §S-014）', () => {
  it('一覧の 6 列と、先頭の取引先を選択した詳細・招待・停止のセクションが出る', () => {
    const html = render({ items: [company(), company({ id: PARTNER_B, name: '架空ソリューション' })], total: 2 });

    expect(html).toContain('data-testid="partner-companies-table"');
    for (const label of [
      messages.columnName,
      messages.columnStatus,
      messages.columnAccountCount,
      messages.columnOpenProjectCount,
      messages.columnProposalCount,
      messages.columnLastActivity,
    ]) {
      expect(html).toContain(label);
    }
    expect(html).toContain(`data-testid="partner-company-row-${PARTNER_A}"`);
    expect(html).toContain(`data-testid="partner-company-row-${PARTNER_B}"`);
    expect(html).toContain('data-testid="partner-companies-register-section"');
    expect(html).toContain('data-testid="partner-company-invite-form"');
    expect(html).toContain('data-testid="partner-company-suspension-section"');
    // 🔴 停止は必ず確認ステップを経る（いきなり停止するボタンを出さない）。
    expect(html).toContain('data-testid="partner-company-suspend-start"');
    expect(html).not.toContain('data-testid="partner-company-suspend-confirm-submit"');
  });

  it('🔴 空の一覧では業務価値を添えた文言が出る（docs/04 §S-014「初回空」）', () => {
    const html = render({ items: [], total: 0 });

    expect(html).toContain('data-testid="partner-companies-empty"');
    expect(html).toContain(messages.empty);
    // 選択対象が無いので詳細は促し文言になる（招待・停止の導線を出さない）。
    expect(html).toContain('data-testid="partner-company-detail-prompt"');
    expect(html).not.toContain('data-testid="partner-company-invite-form"');
    expect(html).not.toContain('data-testid="partner-company-suspension-section"');
    // 🔴 登録フォームは出す（ここが最初の一歩である）。
    expect(html).toContain('data-testid="partner-company-register-form"');
  });

  it('🔴 F-007 AC-5 / docs/04 §S-014: 未検証では招待フォームを描画せず、理由と S-036 導線を置く', () => {
    const html = render({ items: [company()], total: 1 }, { invitationBlocked: true });

    expect(html).toContain('data-testid="partner-company-invite-blocked"');
    expect(html).toContain(messages.inviteBlocked);
    expect(html).toContain('href="/settings/sending-domains"');
    // 🔴 `F-001 AC-5`: 自社メンバー招待とは扱いが違うことを、この画面でも書き分ける。
    expect(html).toContain(messages.inviteBlockedMemberInviteNote);
    // 🔴 失敗しうる操作を最初から描画しない。
    expect(html).not.toContain('data-testid="partner-company-invite-submit"');
  });

  it('停止中の取引先では、停止ボタンではなく解除ボタンが出る', () => {
    const html = render({
      items: [company({ status: 'SUSPENDED', suspendedAt: '2026-09-01T00:00:00.000Z' })],
      total: 1,
    });

    expect(html).toContain('data-testid="partner-company-resume-submit"');
    expect(html).not.toContain('data-testid="partner-company-suspend-start"');
    expect(html).toContain(messages.statusLabels.SUSPENDED);
  });

  it('最終アクティビティが無い取引先は「—」になる（0 や現在時刻で埋めない）', () => {
    const html = render({ items: [company({ lastActivityAt: null })], total: 1 });
    expect(html).toContain(messages.valueNone);
  });
});

// 🔴 T-04-08（`F-007 AC-4` / docs/04 §S-014 セクション 4 / §3.5 / `U-07`）。
//    E2E は `development` 固定で `sandbox` を再現できないため、この粒度はここでしか押さえられない。
describe('🔴 S-014 sandbox の招待リンク（T-04-08）', () => {
  it('sandbox では招待フォームの隣に予告を再掲する（操作の隣に置く。docs/04 §3.5）', () => {
    const html = render({ items: [company()], total: 1 }, { sandboxLinkHandover: true });

    expect(html).toContain('data-testid="partner-company-invite-sandbox-notice"');
    expect(html).toContain(messages.inviteLinkPreNotice);
  });

  it('🔴 production では予告もリンクも 1 つも描画されない', () => {
    const html = render({ items: [company()], total: 1 }, { sandboxLinkHandover: false });

    expect(html).not.toContain('data-testid="partner-company-invite-sandbox-notice"');
    // 発行前なので当然だが、`sandbox` でも発行前は出ないことを対称に固定する。
    expect(html).not.toContain('data-testid="partner-company-invite-link"');
  });

  it('🔴 発行直後でもリンクは自動では出ない（応答に `inviteUrl` があるときだけ出る）', () => {
    const html = render({ items: [company()], total: 1 }, { sandboxLinkHandover: true });

    expect(html).not.toContain('data-testid="partner-company-invite-link"');
  });

  it('リンクの表示・コピー導線・「1 回限り / 再表示不可」の注意書きが揃う', () => {
    const inviteUrl = 'https://sandbox.example.com/invite/plain-token-0001';
    const html = renderToStaticMarkup(
      createElement(SandboxInviteLinkPanel, { inviteUrl, messages }),
    );

    expect(html).toContain('data-testid="partner-company-invite-link"');
    // 🔴 コピーだけにしない（clipboard が使えない文脈では手で選べる必要がある）。
    expect(html).toContain(inviteUrl);
    expect(html).toContain('data-testid="partner-company-invite-link-copy"');
    expect(html).toContain(messages.inviteLinkNotice);
    // 🔴 本番の招待と同一の規律（期限 / 1 回限り / 受諾後の失効）を文言で明示する。
    expect(html).toContain(messages.inviteLinkOnceOnly);
    // コピー結果は操作前には出ない。
    expect(html).not.toContain('data-testid="partner-company-invite-link-copy-status"');
  });
});

describe('🔴 S-014 パートナー / 閲覧のみの視点（F-007 AC-1 / docs/04 §S-014 権限差分）', () => {
  it('自社 1 行だけが出て、登録・招待・停止の導線が 1 つも無い', () => {
    const html = render({ items: [company()], total: 1 }, { canManage: false });

    expect(html).toContain(`data-testid="partner-company-row-${PARTNER_A}"`);
    expect(html).toContain('data-testid="partner-companies-scope-notice"');
    expect(html).toContain(messages.partnerScopeNotice);
    expect(html).not.toContain('data-testid="partner-companies-register-section"');
    expect(html).not.toContain('data-testid="partner-company-invite-form"');
    expect(html).not.toContain('data-testid="partner-company-suspension-section"');
  });

  it('🔴 詳細は出るが、他社の存在を示唆する表示が無い（件数は自社の値のみ）', () => {
    const html = render({ items: [company()], total: 1 }, { canManage: false });

    expect(html).toContain('data-testid="partner-company-detail"');
    expect(html).toContain(`data-partner-company-id="${PARTNER_A}"`);
    expect(html).not.toContain(PARTNER_B);
  });
});
