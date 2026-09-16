// apps/web/app/(main)/proposals/send-failures/send-failure-screen.render.test.tsx
// `SendFailureScreen`（`S-022`）の状態別描画テスト。T-09-08。
//
// 🔴 ここで固定するもの（「描かれていること / 描かれていないこと」が要件であり、API のテストでは示せない）:
//   ① 空状態は「送信に失敗した提案はありません」+「空であることが正常」の説明（`docs/04` §S-022）
//   ② 一覧は提案先 / エンジニア / 失敗理由を描き、応答不明の行は `data-delivery-unknown="true"` で失敗と区別される
//   ③ 再送の導線は「ホストの 3 ロール × 実行可」のときだけ。`VIEWER` / 停止中には無い（`F-023` 関連ロール / `F-004 AC-7`）
//   ④ 🔴 **一括再送・自動再送・force・override に相当する testid と語が 1 つも無い**（`F-023 AC-1` / `BR-50`）
//   ⑤ 初期描画（行を選ぶ前）では確認ダイアログも「再送する」も描かれない（選択は client の状態。SSR では選択なし）
//
// 🔴 `react-dom/server` の `renderToStaticMarkup` を使う（他の render テストと同じ）。
// ⚠️ 確認ダイアログの中身（「届いている可能性があります」+ 再掲 + チェック + 理由）は client の状態遷移で開くため、
//    静的描画では固定できない。E2E（`tests/e2e/home.mobile.spec.ts`。T-09-08 で追加）が実ブラウザで確かめる。
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { SendFailureAttemptRowView, SendFailureRowView, SendFailureSummaryView } from '../../../../lib/proposals/send-failure-rows';
import { SendFailureAttemptList, SendFailureScreen, type SendFailureScreenMessages, type SendFailureScreenProps } from './send-failure-screen';

// 🔴 `useRouter`（202 の後に `S-021` へ遷移する）は App Router の外では mount されていない（`S-021` の render テストと同じ措置）。
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: () => undefined, refresh: () => undefined }),
}));

const FAILED_ID = '01930000-0000-7000-8000-000000000a01';
const UNKNOWN_ID = '01930000-0000-7000-8000-000000000a02';

function row(overrides: Partial<SendFailureRowView> & Pick<SendFailureRowView, 'id'>): SendFailureRowView {
  return {
    recipient: '架空エンド株式会社',
    engineer: '佐藤 花子',
    project: '基幹刷新',
    unitPrice: '650,000',
    failureCategory: 'RECIPIENT',
    failureLabel: '宛先アドレスが無効',
    failureKindRaw: 'PERMANENT:MessageRejected',
    deliveryUnknown: false,
    lastAttemptAtIso: '2026-09-16T01:00:00.000Z',
    lastAttemptAt: '2026-09-16 10:00 JST',
    elapsed: '2 時間',
    attemptCount: 1,
    attemptCountLabel: '1 回',
    attempts: [],
    repeated: false,
    notes: [],
    approveHref: `/proposals/${overrides.id}/approve`,
    sendingDomainHref: null,
    ...overrides,
  };
}

const rows: readonly SendFailureRowView[] = [
  row({ id: FAILED_ID }),
  row({
    id: UNKNOWN_ID,
    recipient: '架空商事株式会社',
    failureCategory: 'UNKNOWN',
    failureLabel: '応答不明（到達したか確認できない）',
    failureKindRaw: 'UNKNOWN:TimeoutError',
    deliveryUnknown: true,
    notes: ['応答不明は「失敗」とは別です。'],
  }),
];

const summary: SendFailureSummaryView = { count: 2, countLabel: '未対応: 2 件', oldestElapsed: '最も古い失敗からの経過: 2 時間' };

const messages: SendFailureScreenMessages = {
  lead: '送信に失敗した提案（送信失敗）だけを表示します。',
  columnRecipient: '提案先',
  columnEngineer: 'エンジニア',
  columnProject: '案件',
  columnFailureKind: '失敗理由',
  columnLastAttemptAt: '最終試行日時',
  columnElapsed: '経過時間',
  columnAttemptCount: '試行回数',
  emptyTitle: '送信に失敗した提案はありません。',
  emptyLead: 'この一覧が空であることが正常な状態です。',
  detailTitle: '選択した提案',
  detailSelect: '行を選ぶと、ここに失敗の理由と再送の操作を表示します。',
  detailFailureKind: '失敗理由',
  detailFailureKindRaw: '種別コード',
  detailLastAttemptAt: '最終試行日時',
  detailAttemptCount: '試行回数',
  detailUnitPrice: '提示単価',
  detailAttemptsTitle: '試行ごとの記録',
  detailOpenApproval: '提案の内容を確認する',
  detailOpenSendingDomain: '送信元ドメインを設定する',
  resend: '再送する',
  resendConfirmTitle: 'この提案は先方に届いている可能性があります。',
  resendConfirmLead: '届いていないことを確認してから再送してください。',
  resendAcknowledge: '先方に届いていないことを確認しました',
  resendReasonLabel: '再送の理由',
  resendConfirmSubmit: '確認のうえ再送する',
  resendConfirmCancel: 'やめる',
  resendSubmitting: '再送を受け付けています…',
  resendErrorValidation: '確認のチェックと再送の理由の両方が必要です。',
  resendErrorState: 'この提案は送信失敗の状態ではありません。',
  resendErrorForbidden: '再送を行う権限がありません。',
  resendErrorSendBlocked: '送信ジョブを積めませんでした。',
  resendErrorGeneric: '再送を受け付けられませんでした。',
  viewerNotice: '再送はホストの営業担当・管理者が行います。',
  deniedTitle: '再送を行えません。',
};

function render(overrides: Partial<SendFailureScreenProps> = {}): string {
  return renderToStaticMarkup(
    createElement(SendFailureScreen, {
      rows,
      summary,
      canResend: true,
      denialMessage: null,
      approveHrefPattern: '/proposals/{id}/approve',
      messages,
      ...overrides,
    }),
  );
}

describe('S-022 送信失敗一覧の描画', () => {
  it('① 空状態: 「送信に失敗した提案はありません」+ 空が正常である説明。テーブルは描かない', () => {
    const html = render({ rows: [], summary: { count: 0, countLabel: '未対応: 0 件', oldestElapsed: null } });
    expect(html).toContain('data-testid="send-failure-empty"');
    expect(html).toContain('送信に失敗した提案はありません。');
    expect(html).toContain('この一覧が空であることが正常な状態です。');
    expect(html).not.toContain('data-testid="send-failure-table"');
    expect(html).toContain('data-count="0"');
    expect(html).not.toContain('data-testid="send-failure-summary-oldest"');
  });

  it('② 一覧: 行ごとに提案先 / エンジニア / 失敗理由。応答不明の行は data-delivery-unknown="true" で失敗と区別される', () => {
    const html = render();
    expect(html).toContain('data-testid="send-failure-table"');
    expect(html).toContain(`data-testid="send-failure-row-${FAILED_ID}"`);
    expect(html).toContain(`data-testid="send-failure-row-${UNKNOWN_ID}"`);
    expect(html).toContain('架空エンド株式会社');
    expect(html).toContain('佐藤 花子');
    expect(html).toContain('宛先アドレスが無効');
    expect(html).toContain('応答不明（到達したか確認できない）');
    expect(html).toMatch(new RegExp(`data-testid="send-failure-row-${FAILED_ID}"[^>]*data-delivery-unknown="false"`));
    expect(html).toMatch(new RegExp(`data-testid="send-failure-row-${UNKNOWN_ID}"[^>]*data-delivery-unknown="true"`));
    expect(html).toContain('data-testid="send-failure-summary-count"');
    expect(html).toContain('未対応: 2 件');
    expect(html).toContain('最も古い失敗からの経過: 2 時間');
  });

  it('⑤ 初期描画では行が選ばれておらず、詳細パネルは案内だけ。確認ダイアログも「再送する」も無い', () => {
    const html = render();
    expect(html).toContain('data-testid="send-failure-detail-empty"');
    expect(html).not.toContain('data-testid="send-failure-detail"');
    expect(html).not.toContain('data-testid="send-failure-resend"');
    expect(html).not.toContain('data-testid="send-failure-resend-confirm"');
  });

  it('③ VIEWER（canResend=false）: 閲覧のみの案内が出る。再送の権限があってテナントが停止中なら理由が出る', () => {
    const viewer = render({ canResend: false });
    expect(viewer).toContain('data-testid="send-failure-viewer"');
    expect(viewer).toContain('再送はホストの営業担当・管理者が行います。');
    expect(viewer).not.toContain('data-testid="send-failure-denied"');
    expect(viewer).toContain('data-can-resend="false"');

    const denied = render({ denialMessage: '組織が停止中です。' });
    expect(denied).toContain('data-testid="send-failure-denied"');
    expect(denied).toContain('組織が停止中です。');
    expect(denied).not.toContain('data-testid="send-failure-viewer"');
  });

  it('🔴 ④ 一括再送 / 自動再送 / force / override に相当する testid・語が 1 つも無い（F-023 AC-1 / BR-50）', () => {
    for (const html of [render(), render({ rows: [] }), render({ canResend: false })]) {
      expect(html).not.toMatch(/data-testid="[^"]*(bulk|auto|force|override|skip|retry-all)[^"]*"/);
      expect(html).not.toMatch(/一括再送|自動で再送|自動再送|無視して|再試行/);
      expect(html).not.toContain('type="checkbox"');
    }
  });
});

// 🔴 詳細パネル / 再送の確認ステップは、行の選択（client の状態遷移）を経て初めて現れるため、
//    `renderToStaticMarkup` では固定できない（冒頭の注記と同じ理由）。両方が使う「試行ごとの記録」の
//    表示だけは、行を選択しなくても描画できる純粋なコンポーネント（`SendFailureAttemptList`）として
//    切り出してあるので、ここで直接描画して固定する。
describe('S-022 詳細パネル / 再送の確認ステップ: 試行ごとの記録（SendFailureAttemptList）', () => {
  const attempts: readonly SendFailureAttemptRowView[] = [
    { seq: 1, status: 'FAILED', statusLabel: '失敗', failureLabel: '宛先アドレスが無効', settledAt: '2026-09-15 19:00 JST', externalId: null },
    { seq: 2, status: 'SUCCEEDED', statusLabel: '成功（相手に届いています）', failureLabel: null, settledAt: '2026-09-16 10:30 JST', externalId: 'mock-abc123' },
  ];

  it('④ 試行ごとに seq / 状態の語 / 確定時刻を描き、externalId は無ければ省略する', () => {
    const html = renderToStaticMarkup(createElement(SendFailureAttemptList, { title: '試行ごとの記録', attempts }));
    expect(html).toContain('data-testid="send-failure-attempt-1"');
    expect(html).toContain('data-testid="send-failure-attempt-2"');
    expect(html).toContain('失敗');
    expect(html).toContain('成功（相手に届いています）');
    expect(html).toContain('mock-abc123');
  });

  it('0 件のときは何も描かない', () => {
    expect(renderToStaticMarkup(createElement(SendFailureAttemptList, { title: '試行ごとの記録', attempts: [] }))).toBe('');
  });
});
