// packages/db/src/tenant-closing-notice.test.ts
// 🔴 T-10-12: 削除予告の判定（`@ses/domain`）と `packages/db` の状態集合・`A-005` 項目 15 の分類の**整合**を固定する。
//   ① domain が文字列で持つ状態は、CHECK の 7 値（`EMAIL_DISPATCH_STATUSES`）に含まれる（綴りのずれで判定が空振りしない）
//   ② 🔴 全モック環境では、削除可否（`classifyClosingNoticeDelivery`）と表示の分類（`classifyPurgeNotice`）が
//      「配送済み = 載せない」で食い違わない —— 7 値の全部分集合（128 通り）で確かめる
//   ③ 🔴 削除可否のほうが厳しい: 保留が残る限り `delivered` は偽（表示は `SENT` があれば載せない）
// DB を要らない（純粋関数どうしの突き合わせ）。実 DB での読み取りは `tests/isolation/tenant-closing-notify.test.ts`。
import { describe, expect, it } from 'vitest';
import {
  classifyClosingNoticeDelivery,
  CLOSING_NOTICE_FILED_STATUSES,
  isClosingNoticePhaseFiled,
} from '@ses/domain';
import { classifyPurgeNotice } from './platform/queries/monitoring.js';
import { EMAIL_DISPATCH_STATUSES, type EmailDispatchStatus } from './schema-value-sets.js';

function subsets<T>(items: readonly T[]): T[][] {
  const out: T[][] = [];
  for (let mask = 0; mask < 1 << items.length; mask += 1) {
    out.push(items.filter((_, index) => (mask & (1 << index)) !== 0));
  }
  return out;
}

describe('① domain の状態文字列は CHECK の 7 値に含まれる', () => {
  it('CLOSING_NOTICE_FILED_STATUSES ⊆ EMAIL_DISPATCH_STATUSES', () => {
    for (const status of CLOSING_NOTICE_FILED_STATUSES) {
      expect(EMAIL_DISPATCH_STATUSES as readonly string[]).toContain(status);
    }
  });

  it('判定が名指しする SENT / MOCKED / QUEUED / FAILED / SUPPRESSED と HELD_ 接頭辞の 2 値が 7 値にある', () => {
    expect([...EMAIL_DISPATCH_STATUSES].sort()).toEqual(
      ['FAILED', 'HELD_DOMAIN_UNVERIFIED', 'HELD_PROVIDER_QUOTA', 'MOCKED', 'QUEUED', 'SENT', 'SUPPRESSED'].sort(),
    );
  });

  it('7 値のそれぞれが、配送済み判定のいずれかの内訳に必ず数えられる（未知扱いになる値が無い）', () => {
    for (const status of EMAIL_DISPATCH_STATUSES) {
      const result = classifyClosingNoticeDelivery([status], { mockedCountsAsDelivered: false });
      const counted =
        result.deliveredCount + result.pendingCount + result.failedCount + result.suppressedCount + result.mockedIgnoredCount;
      expect(counted, status).toBe(1);
    }
  });
});

describe('② 🔴 全モック環境: 削除可否と A-005 項目 15 の分類が食い違わない（128 通り）', () => {
  const all = subsets<EmailDispatchStatus>([...EMAIL_DISPATCH_STATUSES]);

  it('delivered が真なら classifyPurgeNotice は null（載せない）', () => {
    for (const statuses of all) {
      const delivery = classifyClosingNoticeDelivery(statuses, { mockedCountsAsDelivered: true });
      if (delivery.delivered) expect(classifyPurgeNotice(statuses), statuses.join(',')).toBeNull();
    }
  });

  it('classifyPurgeNotice が NOTICE_PENDING / NOTICE_UNDELIVERED なら delivered は偽', () => {
    for (const statuses of all) {
      const cause = classifyPurgeNotice(statuses);
      if (cause !== null) {
        expect(classifyClosingNoticeDelivery(statuses, { mockedCountsAsDelivered: true }).delivered, statuses.join(',')).toBe(false);
      }
    }
  });

  it('③ 🔴 削除可否のほうが厳しい: null（表示上は配送済み）でも保留が残れば delivered は偽', () => {
    const withPending = classifyClosingNoticeDelivery(['SENT', 'HELD_PROVIDER_QUOTA'], { mockedCountsAsDelivered: true });
    expect(classifyPurgeNotice(['SENT', 'HELD_PROVIDER_QUOTA'])).toBeNull();
    expect(withPending.delivered).toBe(false);
    expect(withPending.pendingCount).toBe(1);
  });

  it('起票側の「未処理」と削除側の「保留」は同じ HELD_ 接頭辞を見る', () => {
    for (const status of EMAIL_DISPATCH_STATUSES) {
      if (!status.startsWith('HELD_')) continue;
      expect(isClosingNoticePhaseFiled([status])).toBe(true);
      expect(classifyClosingNoticeDelivery([status], { mockedCountsAsDelivered: true }).pendingCount).toBe(1);
    }
  });
});

describe('🔴 sandbox 相当（MOCKED を配送済みにしない）', () => {
  it('MOCKED だけの集合は表示上 null でも delivered は偽（環境で意味が変わるのは MOCKED だけ）', () => {
    expect(classifyPurgeNotice(['MOCKED'])).toBeNull();
    expect(classifyClosingNoticeDelivery(['MOCKED'], { mockedCountsAsDelivered: false }).delivered).toBe(false);
    expect(classifyClosingNoticeDelivery(['MOCKED'], { mockedCountsAsDelivered: true }).delivered).toBe(true);
  });

  it('MOCKED を含まない集合では環境によって結果が変わらない', () => {
    for (const statuses of subsets<EmailDispatchStatus>(EMAIL_DISPATCH_STATUSES.filter((status) => status !== 'MOCKED'))) {
      expect(classifyClosingNoticeDelivery(statuses, { mockedCountsAsDelivered: false }).delivered).toBe(
        classifyClosingNoticeDelivery(statuses, { mockedCountsAsDelivered: true }).delivered,
      );
    }
  });
});
