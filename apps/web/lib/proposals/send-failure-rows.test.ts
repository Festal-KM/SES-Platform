// apps/web/lib/proposals/send-failure-rows.test.ts
// `S-022` の表示値（`docs/04` §S-022 / `F-023` / `F-024 AC-2` / docs/05 §15.4 / §10.6）。T-09-08。
//
// 🔴 固定するもの:
//   ① 「応答不明」は「失敗」と同じ語にならず、行が `deliveryUnknown` で区別される
//   ② `failureKind` の畳み込み（docs/05 §15.4 の 3 分類 + 送信ジョブ固有の値）が `docs/04` の 6 語 + 競合に落ちる
//   ③ 3 回超で「繰り返し失敗しています。運営に問い合わせてください」が付く
//   ④ `RESERVATION_CONFLICT` は「試行の記録を確認してから再送」を促す
//   ⑤ 要約（件数 / 最も古い経過）
//   ⑥ 試行ごとの記録（`attempts`）が `attemptSeq` 昇順で組まれ、`externalId` を持つ
//   ⑦ 🔴 `RESERVATION_CONFLICT` で既存の試行が `SUCCEEDED` なら `deliveryUnknown` が `true`（競合で負けた側でも「勝った側」が届いている可能性がある）
import { describe, expect, it } from 'vitest';
import { t } from '@ses/i18n';
import {
  classifySendFailureKind,
  REPEATED_FAILURE_THRESHOLD,
  sendFailureRow,
  sendFailureRows,
  sendFailureSummary,
  type SendFailureCategory,
} from './send-failure-rows';
import type { ProposalSendFailureView, SendFailureAttemptView } from './send-failures';

const NOW = new Date('2026-09-16T03:00:00.000Z');
const ID = '01930000-0000-7000-8000-000000000901';

function attempt(
  seq: number,
  status: string,
  failureKind: string | null,
  settledAt: string | null,
  externalId: string | null = null,
): SendFailureAttemptView {
  return { attemptSeq: seq, status, failureKind, startedAt: '2026-09-16T00:00:00.000Z', settledAt, externalId };
}

function item(overrides: Partial<ProposalSendFailureView> = {}): ProposalSendFailureView {
  return {
    id: ID,
    recipientCompanyName: '架空エンド株式会社',
    projectName: '基幹刷新',
    engineerDisplayName: '佐藤 花子',
    offeredUnitPrice: 650000,
    lastFailureReason: 'PERMANENT:MessageRejected',
    failedAt: '2026-09-16T01:00:00.000Z',
    attempts: [attempt(1, 'FAILED', 'PERMANENT:MessageRejected', '2026-09-16T01:00:00.000Z')],
    ...overrides,
  };
}

describe('failureKind の畳み込み（docs/04 §S-022 の語）', () => {
  it.each<[string | null, SendFailureCategory]>([
    [null, 'NONE'],
    ['', 'NONE'],
    ['UNKNOWN', 'UNKNOWN'],
    ['UNKNOWN:TimeoutError', 'UNKNOWN'],
    ['UNKNOWN:ServiceUnavailable', 'UNKNOWN'],
    ['DOMAIN_UNVERIFIED', 'DOMAIN_UNVERIFIED'],
    ['PERMANENT:MailFromDomainNotVerifiedException', 'DOMAIN_UNVERIFIED'],
    ['RESERVATION_CONFLICT', 'RESERVATION_CONFLICT'],
    ['PROVIDER_QUOTA', 'RATE'],
    ['TRANSIENT:ThrottlingException', 'RATE'],
    ['TRANSIENT:TooManyRequestsException', 'RATE'],
    ['TRANSIENT:LimitExceededException', 'RATE'],
    ['TRANSIENT:InternalFailure', 'PROVIDER'],
    ['PERMANENT:AccountSuspendedException', 'AUTH'],
    ['PERMANENT:SendingPausedException', 'AUTH'],
    ['PERMANENT:MessageRejected', 'RECIPIENT'],
    ['PERMANENT:BadRequestException', 'RECIPIENT'],
    ['PERMANENT:NotFoundException', 'RECIPIENT'],
    ['PERMANENT:SomethingElse', 'OTHER'],
    ['WHATEVER', 'OTHER'],
  ])('%s → %s', (kind, expected) => {
    expect(classifySendFailureKind(kind)).toBe(expected);
  });

  it('🔴 応答不明の語は「失敗」を含まず、他の 8 区分と語が重ならない', () => {
    const rows = (['UNKNOWN', 'DOMAIN_UNVERIFIED', 'AUTH', 'RECIPIENT', 'RATE', 'PROVIDER', 'RESERVATION_CONFLICT', 'OTHER', 'NONE'] as const).map(
      (category) => sendFailureRow(item({ lastFailureReason: sampleKindOf(category) }), NOW),
    );
    const labels = rows.map((row) => row.failureLabel);
    expect(new Set(labels).size).toBe(labels.length);
    const unknown = rows.find((row) => row.failureCategory === 'UNKNOWN');
    expect(unknown?.failureLabel).toBe(t('sendFailures.failureKind.UNKNOWN'));
    expect(unknown?.failureLabel).not.toContain('失敗');
    expect(unknown?.deliveryUnknown).toBe(true);
    // 🔴 応答不明（UNKNOWN）に加え、RESERVATION_CONFLICT も「勝った側が届いている可能性がある」ため deliveryUnknown。
    //    他の 7 区分は deliveryUnknown ではない。
    expect(rows.filter((row) => row.deliveryUnknown).map((row) => row.failureCategory).sort()).toEqual(
      ['RESERVATION_CONFLICT', 'UNKNOWN'].sort(),
    );
  });
});

function sampleKindOf(category: SendFailureCategory): string | null {
  switch (category) {
    case 'UNKNOWN':
      return 'UNKNOWN:TimeoutError';
    case 'DOMAIN_UNVERIFIED':
      return 'DOMAIN_UNVERIFIED';
    case 'AUTH':
      return 'PERMANENT:AccountSuspendedException';
    case 'RECIPIENT':
      return 'PERMANENT:MessageRejected';
    case 'RATE':
      return 'PROVIDER_QUOTA';
    case 'PROVIDER':
      return 'TRANSIENT:InternalFailure';
    case 'RESERVATION_CONFLICT':
      return 'RESERVATION_CONFLICT';
    case 'OTHER':
      return 'PERMANENT:SomethingElse';
    case 'NONE':
      return null;
  }
}

describe('行の組み立て', () => {
  it('提案先 / エンジニア（凍結側）/ 案件 / 失敗理由 / 最終試行日時 / 経過時間 / 試行回数 / 単価 / S-021 への導線', () => {
    const row = sendFailureRow(item(), NOW);
    expect(row).toMatchObject({
      id: ID,
      recipient: '架空エンド株式会社',
      engineer: '佐藤 花子',
      project: '基幹刷新',
      unitPrice: '650,000',
      failureCategory: 'RECIPIENT',
      failureLabel: t('sendFailures.failureKind.RECIPIENT'),
      failureKindRaw: 'PERMANENT:MessageRejected',
      deliveryUnknown: false,
      lastAttemptAtIso: '2026-09-16T01:00:00.000Z',
      attemptCount: 1,
      attemptCountLabel: `1${t('sendFailures.attemptCountSuffix')}`,
      repeated: false,
      notes: [],
      approveHref: `/proposals/${ID}/approve`,
      sendingDomainHref: null,
    });
    expect(row.lastAttemptAt).toContain('2026-09-16');
    // 失敗の確定（01:00Z）から NOW（03:00Z）= 2 時間。
    expect(row.elapsed).toBe(`2${t('proposals.approval.elapsed.hoursSuffix')}`);
  });

  it('最終試行日時は最新の試行の確定時刻 → 開始時刻 → 失敗の確定時刻の順で取る', () => {
    const settled = sendFailureRow(
      item({ attempts: [attempt(1, 'FAILED', 'x', '2026-09-15T10:00:00.000Z'), attempt(2, 'UNKNOWN', 'UNKNOWN:Timeout', '2026-09-16T02:30:00.000Z')] }),
      NOW,
    );
    expect(settled.lastAttemptAtIso).toBe('2026-09-16T02:30:00.000Z');
    expect(settled.attemptCount).toBe(2);
    const reserved = sendFailureRow(item({ attempts: [attempt(1, 'RESERVED', null, null)] }), NOW);
    expect(reserved.lastAttemptAtIso).toBe('2026-09-16T00:00:00.000Z');
    const none = sendFailureRow(item({ attempts: [] }), NOW);
    expect(none.lastAttemptAtIso).toBe('2026-09-16T01:00:00.000Z');
    expect(none.attemptCount).toBe(0);
  });

  it('🔴 応答不明の行には「届いている可能性」の注記が付き、失敗の行には付かない', () => {
    const unknown = sendFailureRow(item({ lastFailureReason: 'UNKNOWN:TimeoutError' }), NOW);
    expect(unknown.notes).toEqual([t('sendFailures.note.unknown')]);
    expect(sendFailureRow(item(), NOW).notes).toEqual([]);
  });

  it('🔴 RESERVATION_CONFLICT は「試行の記録を確認してから再送」を促す', () => {
    const row = sendFailureRow(item({ lastFailureReason: 'RESERVATION_CONFLICT' }), NOW);
    expect(row.failureCategory).toBe('RESERVATION_CONFLICT');
    expect(row.notes).toEqual([t('sendFailures.note.reservationConflict')]);
  });

  it(`🔴 試行回数が ${String(REPEATED_FAILURE_THRESHOLD)} 回を超えると「運営に問い合わせてください」が付く（ちょうどでは付かない）`, () => {
    const attemptsOf = (n: number) => Array.from({ length: n }, (_, i) => attempt(i + 1, 'FAILED', 'PERMANENT:MessageRejected', '2026-09-16T01:00:00.000Z'));
    const exact = sendFailureRow(item({ attempts: attemptsOf(REPEATED_FAILURE_THRESHOLD) }), NOW);
    expect(exact.repeated).toBe(false);
    expect(exact.notes).toEqual([]);
    const over = sendFailureRow(item({ attempts: attemptsOf(REPEATED_FAILURE_THRESHOLD + 1) }), NOW);
    expect(over.repeated).toBe(true);
    expect(over.notes).toEqual([t('sendFailures.note.repeated')]);
    // 応答不明 × 繰り返し = 2 つの注記（順序固定）。
    const both = sendFailureRow(item({ lastFailureReason: 'UNKNOWN:Timeout', attempts: attemptsOf(REPEATED_FAILURE_THRESHOLD + 1) }), NOW);
    expect(both.notes).toEqual([t('sendFailures.note.unknown'), t('sendFailures.note.repeated')]);
  });

  it('DOMAIN_UNVERIFIED のときだけ S-036 への導線が付く', () => {
    expect(sendFailureRow(item({ lastFailureReason: 'DOMAIN_UNVERIFIED' }), NOW).sendingDomainHref).toBe('/settings/sending-domains');
    expect(sendFailureRow(item({ lastFailureReason: 'PERMANENT:MailFromDomainNotVerifiedException' }), NOW).sendingDomainHref).toBe(
      '/settings/sending-domains',
    );
    expect(sendFailureRow(item({ lastFailureReason: 'PROVIDER_QUOTA' }), NOW).sendingDomainHref).toBeNull();
  });

  it('未設定・凍結なし・非公開の案件は「（不明）」の語（空欄を無言で描かない）', () => {
    const row = sendFailureRow(item({ recipientCompanyName: '  ', engineerDisplayName: null, projectName: null, offeredUnitPrice: null }), NOW);
    expect(row.recipient).toBe(t('sendFailures.valueNone'));
    expect(row.engineer).toBe(t('sendFailures.valueNone'));
    expect(row.project).toBe(t('sendFailures.valueNone'));
    expect(row.unitPrice).toBe(t('sendFailures.valueNone'));
  });

  it('⑥ 試行ごとの記録: attemptSeq 昇順で状態の語 / 個々の失敗理由 / externalId を持つ', () => {
    const row = sendFailureRow(
      item({
        attempts: [
          attempt(1, 'FAILED', 'PERMANENT:MessageRejected', '2026-09-15T19:00:00.000Z'),
          attempt(2, 'SUCCEEDED', null, '2026-09-16T02:30:00.000Z', 'mock-abc123'),
        ],
      }),
      NOW,
    );
    expect(row.attempts).toHaveLength(2);
    expect(row.attempts[0]).toMatchObject({
      seq: 1,
      status: 'FAILED',
      statusLabel: t('sendFailures.attempt.status.FAILED'),
      failureLabel: t('sendFailures.failureKind.RECIPIENT'),
      externalId: null,
    });
    expect(row.attempts[1]).toMatchObject({
      seq: 2,
      status: 'SUCCEEDED',
      statusLabel: t('sendFailures.attempt.status.SUCCEEDED'),
      failureLabel: null,
      externalId: 'mock-abc123',
    });
  });

  it('🔴 ⑦ RESERVATION_CONFLICT で既存の試行が SUCCEEDED なら deliveryUnknown は true（「勝った側」が届いている可能性がある）', () => {
    const row = sendFailureRow(
      item({
        lastFailureReason: 'RESERVATION_CONFLICT',
        attempts: [attempt(1, 'SUCCEEDED', null, '2026-09-16T00:30:00.000Z', 'mock-abc123')],
      }),
      NOW,
    );
    expect(row.attempts[0]?.status).toBe('SUCCEEDED');
    expect(row.deliveryUnknown).toBe(true);
  });
});

describe('要約（セクション 1）', () => {
  it('0 件: 件数 0 と経過なし', () => {
    const summary = sendFailureSummary([], NOW);
    expect(summary.count).toBe(0);
    expect(summary.countLabel).toBe(`${t('sendFailures.summary.countPrefix')}0${t('sendFailures.summary.countSuffix')}`);
    expect(summary.oldestElapsed).toBeNull();
  });

  it('複数件: 最も古い失敗からの経過（並びに依存しない）', () => {
    const items = [
      item({ id: '01930000-0000-7000-8000-000000000902', failedAt: '2026-09-16T02:00:00.000Z' }),
      item({ id: '01930000-0000-7000-8000-000000000903', failedAt: '2026-09-14T03:00:00.000Z' }),
      item({ id: '01930000-0000-7000-8000-000000000904', failedAt: '2026-09-16T01:00:00.000Z' }),
    ];
    const summary = sendFailureSummary(items, NOW);
    expect(summary.count).toBe(3);
    expect(summary.oldestElapsed).toBe(`${t('sendFailures.summary.oldestPrefix')}2${t('proposals.approval.elapsed.daysSuffix')}`);
    expect(sendFailureRows(items, NOW).map((row) => row.id)).toEqual(items.map((row) => row.id));
  });
});
