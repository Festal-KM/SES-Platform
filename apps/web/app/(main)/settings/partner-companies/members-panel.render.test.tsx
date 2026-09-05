// apps/web/app/(main)/settings/partner-companies/members-panel.render.test.tsx
// `MembersPanel`（`S-014` セクション 2 / `F-002 AC-4`）の視点別描画テスト。T-04-09。
//
// 🔴 なぜこの粒度で要るか（`partner-companies-screen.render.test.tsx` と同じ理由）:
//    「`PARTNER_ADMIN` には操作が出て、ホストには出ない」「自分自身の行には操作が出ない」は
//    **視点ごとの props でしか観測できない**。E2E は 1 度の実行で 1 視点しか見られないため、
//    組み合わせの網羅はここで固定する。
// 🔴 これは UI の担保であって境界の担保ではない。拒否の本体は `#84` / `#85` の
//    `decideMemberRoleChange` / `decideMemberRevoke` と RLS（C3）である
//    （`tests/isolation/members.test.ts` がそちらを見る）。
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { MemberView } from '../../../../lib/members/service';
import { MembersPanel, type MembersPanelMessages } from './members-panel';

const PARTNER_A = '01930000-0000-7000-8000-0000000000c1';
const ME = '01930000-0000-7000-8000-0000000000u1';
const OTHER = '01930000-0000-7000-8000-0000000000u2';

function member(overrides: Partial<MemberView> = {}): MemberView {
  return {
    id: '01930000-0000-7000-8000-0000000000m2',
    userId: OTHER,
    displayName: '架空 花子',
    email: 'hanako@partner.example',
    role: 'PARTNER_SALES',
    partnerCompanyId: PARTNER_A,
    partnerCompanyName: '架空テック株式会社',
    status: 'ACTIVE',
    joinedAt: '2026-06-01T00:00:00.000Z',
    revokedAt: null,
    lastLoginAt: '2026-09-01T02:00:00.000Z',
    ...overrides,
  };
}

const messages: MembersPanelMessages = {
  section: '配下アカウント',
  readOnlyNote: 'このお取引先のアカウントは、お取引先の管理者が管理します。',
  empty: 'このお取引先のアカウントはまだありません。',
  valueNone: '—',

  columnName: '氏名',
  columnEmail: 'メールアドレス',
  columnRole: 'ロール',
  columnStatus: '状態',
  columnLastLogin: '最終ログイン',
  columnActions: '操作',

  statusLabels: { ACTIVE: '有効', REVOKED: '無効' },
  roleLabels: {
    OWNER: 'オーナー',
    ADMIN: '管理者',
    SALES: '営業',
    PARTNER_ADMIN: '取引先管理者',
    PARTNER_SALES: '取引先営業',
    VIEWER: '閲覧のみ',
  },
  roleCapabilities: {
    OWNER: '組織の全権',
    ADMIN: 'メンバー管理・取引先の招待',
    SALES: '案件・エンジニア・提案の作成と編集',
    PARTNER_ADMIN: '自社の営業アカウントと登録エンジニアの管理',
    PARTNER_SALES: '自社エンジニアの更新、公開された案件の閲覧、提案、チャット',
    VIEWER: '閲覧のみ（承認・送信・ダウンロードは行えません）',
  },

  self: 'ご自身',

  roleChangeLabel: 'ロールを変更',
  roleChangeSubmit: 'ロールを変更する',
  roleChangeConfirmTitle: 'ロール変更の確認',
  roleChangeConfirmBefore: '変更前',
  roleChangeConfirmAfter: '変更後',
  roleChangeConfirm: 'この内容で変更する',
  roleChangeCancel: 'キャンセル',
  roleChangeSubmitting: '変更しています…',
  roleChangeDone: 'ロールを変更しました。',
  roleChangeError: '変更できませんでした。',

  revokeSubmit: '無効化',
  revokeConfirmTitle: '無効化の確認',
  revokeConfirmText:
    'このアカウントはサインインできなくなります。登録済みのエンジニア・提案・チャットは削除されません。',
  revokeConfirm: '無効化する',
  revokeCancel: 'キャンセル',
  revokeSubmitting: '無効化しています…',
  revokeDone: 'アカウントを無効化しました。',
  revokeError: '無効化できませんでした。',

  inviteSection: '自社アカウントの招待',
  inviteEmailLabel: 'メールアドレス',
  inviteRoleLabel: 'ロール',
  inviteSubmit: '招待を送る',
  inviteSubmitting: '送信しています…',
  inviteQueued: '招待の送信を受け付けました。',
  inviteHeld: '招待を作成しました。送信は保留しています。',
  inviteError: '招待できませんでした。',
  invitePreNotice: 'サンドボックス環境では招待メールが送信されません。',

  inviteLinkHeading: '招待リンク',
  inviteLinkNotice: 'このリンクをお渡しください。',
  inviteLinkOnceOnly: '受諾は 1 回限りです。',
  inviteLinkLabel: '受諾リンク',
  inviteLinkCopy: 'リンクをコピー',
  inviteLinkCopied: 'コピーしました。',
  inviteLinkCopyFailed: 'コピーできませんでした。',
};

function render(
  members: readonly MemberView[],
  options: { canManage?: boolean; sandboxLinkHandover?: boolean } = {},
): string {
  return renderToStaticMarkup(
    createElement(MembersPanel, {
      members,
      canManage: options.canManage ?? true,
      assignableRoles: ['PARTNER_ADMIN', 'PARTNER_SALES'],
      currentUserId: ME,
      sandboxLinkHandover: options.sandboxLinkHandover ?? false,
      messages,
      onChanged: async () => {},
    }),
  );
}

describe('🔴 F-002 AC-4: PARTNER_ADMIN が自社配下のアカウントを管理する視点', () => {
  it('一覧の列と、ロール変更・無効化・招待の導線が出る', () => {
    const html = render([member()]);

    expect(html).toContain('data-testid="members-table"');
    for (const label of [
      messages.columnName,
      messages.columnEmail,
      messages.columnRole,
      messages.columnStatus,
      messages.columnLastLogin,
      messages.columnActions,
    ]) {
      expect(html).toContain(label);
    }
    expect(html).toContain('data-testid="member-role-select-01930000-0000-7000-8000-0000000000m2"');
    expect(html).toContain('data-testid="member-revoke-start-01930000-0000-7000-8000-0000000000m2"');
    expect(html).toContain('data-testid="members-invite-form"');
  });

  it('🔴 ロール変更・無効化は確認ステップを経る（いきなり実行するボタンを出さない）', () => {
    const html = render([member()]);

    expect(html).not.toContain('data-testid="member-role-confirm"');
    expect(html).not.toContain('data-testid="member-revoke-confirm"');
    expect(html).not.toContain('data-testid="member-action-confirm"');
  });

  it('🔴 自分自身の行には操作を出さない（自己昇格・自己ロックアウトの導線を作らない）', () => {
    const html = render([member({ userId: ME })]);

    expect(html).toContain('data-testid="member-self-01930000-0000-7000-8000-0000000000m2"');
    expect(html).toContain(messages.self);
    expect(html).not.toContain('data-testid="member-role-select-01930000-0000-7000-8000-0000000000m2"');
    expect(html).not.toContain('data-testid="member-revoke-start-01930000-0000-7000-8000-0000000000m2"');
  });

  it('無効化済みの行には操作を出さない（復帰は招待の再発行である）', () => {
    const html = render([member({ status: 'REVOKED', revokedAt: '2026-09-02T00:00:00.000Z' })]);

    expect(html).toContain(messages.statusLabels.REVOKED);
    expect(html).not.toContain('data-testid="member-revoke-start-01930000-0000-7000-8000-0000000000m2"');
  });

  it('付与できるロールにホストロールが 1 つも現れない（`memberships` の CHECK 制約と同じ規律）', () => {
    const html = render([member()]);

    for (const hostRole of [messages.roleLabels.OWNER, messages.roleLabels.ADMIN, messages.roleLabels.SALES]) {
      expect(html).not.toContain(`>${hostRole}</option>`);
    }
    expect(html).toContain(`>${messages.roleLabels.PARTNER_ADMIN}</option>`);
    expect(html).toContain(`>${messages.roleLabels.PARTNER_SALES}</option>`);
  });

  it('🔴 sandbox では招待操作の隣に「メールは送られない」旨を再掲する（docs/04 §3.5）', () => {
    const html = render([member()], { sandboxLinkHandover: true });

    expect(html).toContain('data-testid="members-invite-sandbox-notice"');
    expect(html).toContain(messages.invitePreNotice);
  });

  it('production では sandbox の予告を出さない', () => {
    const html = render([member()], { sandboxLinkHandover: false });

    expect(html).not.toContain('data-testid="members-invite-sandbox-notice"');
  });
});

describe('🔴 ホスト（OWNER / ADMIN）視点 — 配下アカウントは閲覧のみ', () => {
  it('操作列・ロール変更・無効化・招待の導線が 1 つも出ない', () => {
    const html = render([member()], { canManage: false });

    expect(html).toContain('data-testid="members-table"');
    expect(html).toContain('data-testid="members-read-only-note"');
    expect(html).not.toContain(messages.columnActions);
    expect(html).not.toContain('data-testid="member-role-select-01930000-0000-7000-8000-0000000000m2"');
    expect(html).not.toContain('data-testid="member-revoke-start-01930000-0000-7000-8000-0000000000m2"');
    expect(html).not.toContain('data-testid="members-invite-form"');
  });
});

describe('空の状態', () => {
  it('アカウントが 0 件なら一覧ではなく説明を出す', () => {
    const html = render([]);

    expect(html).toContain('data-testid="members-empty"');
    expect(html).toContain(messages.empty);
    expect(html).not.toContain('data-testid="members-table"');
  });
});
