// apps/web/app/(main)/settings/sending-domains/sending-domain-screen.render.test.tsx
// `SendingDomainScreen`（`S-036`）の状態別描画テスト（T-04-06 Iteration 3。e2e-tester 報告）。
//
// 🔴 なぜこの粒度で要るか: E2E は `development` 固定であり、`sendingDomainRuntime()` の
//    `verificationRequired` は常に `false`（`apps/web/lib/db/bootstrap.ts` の
//    `env.APP_ENV === 'staging' || env.APP_ENV === 'production'` によってのみ `true` になる
//    設計。これはドキュメント整合でありバグではない）。したがって `required=true` の
//    4 状態（`REGISTERED` / `PENDING` / `VERIFIED` / `FAILED`）と `UNSET` は、
//    ブラウザ E2E からは 1 つも実描画を観測できない。props を直構築して与える
//    コンポーネントレンダーテストだけがこの粒度を担保できる。
//
// 🔴 新規依存を避けるため `@testing-library/react` は使わない。`react-dom/server` の
//    `renderToStaticMarkup`（Next.js が既に依存に持つ `react-dom` のサブパス）で静的 HTML を
//    得て、`data-testid` と文言の出現を文字列アサーションで確認する。`'use client'` 指令は
//    Next.js のバンドラ向けの目印であり、Node 上で直接 import しても実行時には何の効果も
//    持たない（`useEffect` は静的レンダーでは走らないため、`beforeunload` 等の副作用は
//    ここでは検証しない。イベントハンドラの単体テストが要る場合は別途 `lib/**` 側に
//    ロジックを切り出す）。
// 🔴 JSX 構文を使わず `React.createElement` を直接呼ぶ（この 1 ファイルのためだけに
//    `@vitejs/plugin-react` 等の新規依存を追加しないため。本リポジトリの Vitest 設定は
//    JSX トランスフォームを構成していない）。
//
// 🔴 `vitest.config.ts` の `apps/*/app/**/*.render.test.tsx` 例外にだけ乗る（`app/**` は
//    原則ユニットテスト対象外のまま。理由は同ファイルのコメント参照）。
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { SendingDomainDnsRecord } from '@ses/connectors';
import type { SendingDomainListView, SendingDomainView } from '../../../../lib/settings/sending-domains';
import { SendingDomainScreen, type SendingDomainScreenMessages } from './sending-domain-screen';

const DKIM_RECORDS: readonly SendingDomainDnsRecord[] = [
  { type: 'CNAME', name: 's1._domainkey.example.co.jp', value: 's1.dkim.amazonses.com', purposeKey: 'DKIM' },
  { type: 'CNAME', name: 's2._domainkey.example.co.jp', value: 's2.dkim.amazonses.com', purposeKey: 'DKIM' },
];

const MAIL_FROM_RECORDS: readonly SendingDomainDnsRecord[] = [
  {
    type: 'MX',
    name: 'mail.example.co.jp',
    value: 'feedback-smtp.ap-northeast-1.amazonses.com',
    priority: 10,
    purposeKey: 'MAIL_FROM_MX',
  },
  { type: 'TXT', name: 'mail.example.co.jp', value: 'v=spf1 include:amazonses.com ~all', purposeKey: 'MAIL_FROM_SPF' },
];

function domain(overrides: Partial<SendingDomainView> = {}): SendingDomainView {
  return {
    id: 'dom-1',
    domain: 'example.co.jp',
    state: 'PENDING',
    dkimRecords: DKIM_RECORDS,
    mailFromRecords: MAIL_FROM_RECORDS,
    verifiedAt: null,
    lastCheckedAt: null,
    failureReasonKey: null,
    affects: ['S-021', 'S-024', 'S-026', 'S-014'],
    ...overrides,
  };
}

const FAILURE_REASON_KEY = 'settings.sendingDomain.failure.DKIM_NOT_VERIFIED';

const messages: SendingDomainScreenMessages = {
  onboardingHeading: 'オンボーディングの位置づけ',
  onboardingSteps: ['テナントの開設', '招待の受諾', '組織設定', '本画面（送信ドメインの検証）'],
  onboardingGoal: '到達点は「取引先へ送信できる状態」です。',

  sectionStatus: '現在の状態',
  fact: {
    domainLabel: '送信元ドメイン',
    noneLabel: '未設定',
    notRequiredNotice: 'サンドボックス環境では検証は不要です。',
    stateLabels: {
      REGISTERED: '登録済み（DNS レコードの準備中）',
      PENDING: 'DNS の反映待ち',
      VERIFIED: '検証済み',
      FAILED: 'DNS レコードが確認できません',
    },
  },

  bannerUnset: '取引先へメールを送るには、御社のドメインの検証が必要です。',
  bannerFailed: 'DNS レコードが確認できなくなりました。送信は停止しています。',
  failureReasonLabels: {
    [FAILURE_REASON_KEY]: 'DKIM の CNAME レコードが確認できません。',
  },

  sectionRegister: 'ドメインの登録',
  registerDomainLabel: '送信元ドメイン',
  registerPlaceholder: 'example.co.jp',
  registerSubmit: '登録する',
  registerSubmitting: '登録しています…',
  registerError: '登録できませんでした。',
  registerOwnerOnlyNote: 'ドメインの登録はオーナーのみ行えます。',

  sectionRecords: 'DNS レコードの提示',
  recordsColumnType: '種別',
  recordsColumnName: '名前',
  recordsColumnValue: '値',
  recordsColumnCopy: 'コピー',
  recordsColumnResult: '確認結果',
  recordsResultConfirmed: '確認済み',
  recordsResultUnconfirmed: '未確認',
  recordsCopy: 'コピー',
  recordsCopied: 'コピーしました',
  recordsCopyFailed: 'コピーできませんでした',
  recordsDkimPending: 'DKIM のレコードは準備中です。',
  recordPurposeLabels: { DKIM: 'DKIM', MAIL_FROM_MX: 'MAIL FROM', MAIL_FROM_SPF: 'MAIL FROM' },

  verifySubmit: '検証を実行',
  verifySubmitting: '確認しています…',
  verifyRequested: '検証を実行しました。',
  verifyPending: '検証しています（DNS の反映に数分〜数時間かかることがあります）。',
  verifyPendingNote: '完了は通知でお知らせします。',
  verifyError: '確認できませんでした。',

  sectionAffects: 'この設定が影響する機能',
  affectsBlocked: 'これらは検証が完了するまで実行できません。',
  affectedFeatures: ['提案の送信', '面談調整の連絡', '契約書のメール添付での送付', '取引先の招待'],
  exclusionMemberInvite: '自社メンバーの招待は対象外です。',
  exclusionMemberInviteNote: '※ 取引先の招待とは扱いが違います。',
  exclusionEsign: '電子署名での契約書送付も対象外です。',
};

function render(initial: SendingDomainListView, canRegister = true): string {
  return renderToStaticMarkup(
    createElement(SendingDomainScreen, { initial, canRegister, messages }),
  );
}

function countOccurrences(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1;
}

describe('SendingDomainScreen の状態別描画（S-036。4 状態 + UNSET + NOT_REQUIRED）', () => {
  it('REGISTERED: DKIM 未生成の補足と検証待ちの持続表示が出る（DNS レコード自体は MAIL FROM 分だけ表示）', () => {
    const html = render({ required: true, domains: [domain({ state: 'REGISTERED', dkimRecords: [] })] });

    expect(html).toContain('data-fact-kind="REGISTERED"');
    expect(html).toContain('data-testid="sending-domain-records-table"');
    expect(html).toContain('data-testid="sending-domain-dkim-pending"');
    expect(html).toContain('data-testid="sending-domain-verify-pending"');
    expect(html).toContain('data-testid="sending-domain-verify-submit"');
    // 🔴 MAIL FROM の MX / TXT の 2 行のみ（DKIM はまだ 0 行）。
    expect(countOccurrences(html, 'data-testid="sending-domain-record-copy-')).toBe(2);
    expect(html).not.toContain('data-testid="sending-domain-failed-banner"');
    expect(html).not.toContain('data-testid="sending-domain-unset-banner"');
  });

  it('PENDING: DNS レコード表の全 4 行 + 検証待ちの持続表示が出る', () => {
    const html = render({ required: true, domains: [domain({ state: 'PENDING' })] });

    expect(html).toContain('data-fact-kind="PENDING"');
    expect(html).toContain('data-testid="sending-domain-records-table"');
    expect(countOccurrences(html, 'data-testid="sending-domain-record-copy-')).toBe(4);
    expect(html).toContain('data-testid="sending-domain-verify-pending"');
    expect(html).toContain(messages.recordsResultUnconfirmed);
    expect(html).not.toContain('data-testid="sending-domain-dkim-pending"');
    expect(html).not.toContain('data-testid="sending-domain-failed-banner"');
  });

  it('VERIFIED: 確認結果が「確認済み」になり、検証待ち表示・影響機能の「実行できません」注記が消える', () => {
    const html = render({ required: true, domains: [domain({ state: 'VERIFIED', verifiedAt: new Date().toISOString() })] });

    expect(html).toContain('data-fact-kind="VERIFIED"');
    expect(countOccurrences(html, messages.recordsResultConfirmed)).toBeGreaterThanOrEqual(4);
    expect(html).not.toContain('data-testid="sending-domain-verify-pending"');
    expect(html).not.toContain('data-testid="sending-domain-failed-banner"');
    expect(html).not.toContain('data-testid="sending-domain-unset-banner"');
    expect(html).not.toContain(messages.affectsBlocked);
    // 🔴 検証済みでも「検証を実行（再確認）」ボタン自体は残る（#72 は回数制限なし）。
    expect(html).toContain('data-testid="sending-domain-verify-submit"');
  });

  it('FAILED: 失敗理由バナーが出て、影響機能の「実行できません」注記が残る', () => {
    const html = render({
      required: true,
      domains: [domain({ state: 'FAILED', failureReasonKey: FAILURE_REASON_KEY })],
    });

    expect(html).toContain('data-fact-kind="FAILED"');
    expect(html).toContain('data-testid="sending-domain-failed-banner"');
    expect(html).toContain('data-testid="sending-domain-failure-reason"');
    expect(html).toContain(messages.failureReasonLabels[FAILURE_REASON_KEY] ?? '');
    expect(html).toContain(messages.affectsBlocked);
    expect(html).not.toContain('data-testid="sending-domain-verify-pending"');
  });

  it('UNSET（未登録・初回）: 未設定バナー + 登録フォーム（OWNER）が出て、DNS レコード表は出ない', () => {
    const html = render({ required: true, domains: [] }, true);

    expect(html).toContain('data-fact-kind="UNSET"');
    expect(html).toContain('data-testid="sending-domain-unset-banner"');
    expect(html).toContain('data-testid="sending-domain-register-form"');
    expect(html).toContain('data-testid="sending-domain-register-input"');
    expect(html).toContain('data-testid="sending-domain-register-submit"');
    expect(html).not.toContain('data-testid="sending-domain-records-table"');
    expect(html).not.toContain('data-testid="sending-domain-verify-submit"');
  });

  it('UNSET（未登録） + ADMIN（canRegister=false）: 登録フォームの代わりにオーナー限定の注記が出る', () => {
    const html = render({ required: true, domains: [] }, false);

    expect(html).toContain('data-testid="sending-domain-register-owner-only"');
    expect(html).not.toContain('data-testid="sending-domain-register-form"');
  });

  it('NOT_REQUIRED（sandbox / demo / development）: 検証不要の注記のみで、登録・DNS・影響機能セクションは出ない', () => {
    const html = render({ required: false, domains: [] });

    expect(html).toContain('data-fact-kind="NOT_REQUIRED"');
    expect(html).toContain(messages.fact.notRequiredNotice);
    expect(html).not.toContain('data-testid="sending-domain-register-form"');
    expect(html).not.toContain('data-testid="sending-domain-records-table"');
    expect(html).not.toContain('data-testid="sending-domain-affects"');
  });
});
