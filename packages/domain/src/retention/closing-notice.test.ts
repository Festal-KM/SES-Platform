// packages/domain/src/retention/closing-notice.test.ts
// 🔴 T-10-12: 削除予告の判定（docs/05 §9.7 / `F-064 AC-10`）を純粋関数として固定する。
//   ① 期日計算（JST 暦日キーの整数演算。月末・年末・猶予 ≤ 7 日の丸め）
//   ② 起票条件は「期限を過ぎ、かつ未処理」（日付一致ではない）
//   ③ 🔴 配送済み判定: 保留が 1 件でも残れば false / `MOCKED` は引数が true のときだけ配送済み
//   ④ `dedupeKey` の `targetId` の往復
import { describe, expect, it } from 'vitest';
import {
  classifyClosingNoticeDelivery,
  CLOSING_NOTICE_FILED_STATUSES,
  closingNoticeSchedule,
  closingNoticeTargetId,
  closingNoticeTargetIdPrefix,
  dueClosingNoticePhases,
  isClosingNoticePhaseFiled,
  parseClosingNoticeDedupeKey,
  TENANT_CLOSING_NOTICE_PHASES,
  TENANT_CLOSING_NOTICE_TEMPLATE_KEY,
} from './closing-notice.js';

const TENANT = '01930000-0000-7000-8000-0000000000a1';

describe('① closingNoticeSchedule — 削除予定日と 2 段の期日（暦日キー）', () => {
  it('既定 30 日: 削除予定日 = +30 日 / D7 = +23 日 / ENTERED = 入った日', () => {
    expect(closingNoticeSchedule({ closingEnteredDayKey: '2026-09-01', graceDays: 30 })).toEqual({
      purgeScheduledOn: '2026-10-01',
      dueOn: { ENTERED: '2026-09-01', D7: '2026-09-24' },
    });
  });

  it('月末・年末をまたいでも正しい（閏年を含む）', () => {
    expect(closingNoticeSchedule({ closingEnteredDayKey: '2027-12-15', graceDays: 30 }).purgeScheduledOn).toBe('2028-01-14');
    expect(closingNoticeSchedule({ closingEnteredDayKey: '2028-02-01', graceDays: 30 }).purgeScheduledOn).toBe('2028-03-02');
  });

  it('猶予が 7 日以下なら D7 の期日は入った日に丸める（期日が過去に出ない）', () => {
    expect(closingNoticeSchedule({ closingEnteredDayKey: '2026-09-01', graceDays: 7 }).dueOn.D7).toBe('2026-09-01');
    expect(closingNoticeSchedule({ closingEnteredDayKey: '2026-09-01', graceDays: 3 }).dueOn.D7).toBe('2026-09-01');
    expect(closingNoticeSchedule({ closingEnteredDayKey: '2026-09-01', graceDays: 8 }).dueOn.D7).toBe('2026-09-02');
  });

  it('猶予日数が 1 以上の整数でなければ例外', () => {
    expect(() => closingNoticeSchedule({ closingEnteredDayKey: '2026-09-01', graceDays: 0 })).toThrow(RangeError);
    expect(() => closingNoticeSchedule({ closingEnteredDayKey: '2026-09-01', graceDays: 1.5 })).toThrow(RangeError);
  });
});

describe('② dueClosingNoticePhases — 「期限を過ぎた」段（日付一致にしない）', () => {
  const entered = { closingEnteredDayKey: '2026-09-01', graceDays: 30 };

  it('入った日は ENTERED だけ', () => {
    expect(dueClosingNoticePhases({ ...entered, todayKey: '2026-09-01' })).toEqual(['ENTERED']);
  });

  it('🔴 翌日以降も ENTERED は期限を過ぎたままである（ジョブが止まった日を翌日に取り返す）', () => {
    expect(dueClosingNoticePhases({ ...entered, todayKey: '2026-09-02' })).toEqual(['ENTERED']);
    expect(dueClosingNoticePhases({ ...entered, todayKey: '2026-09-23' })).toEqual(['ENTERED']);
  });

  it('+23 日で D7 も期限を過ぎる（両段が返る。未処理判定は段ごと）', () => {
    expect(dueClosingNoticePhases({ ...entered, todayKey: '2026-09-24' })).toEqual(['ENTERED', 'D7']);
    expect(dueClosingNoticePhases({ ...entered, todayKey: '2026-10-05' })).toEqual(['ENTERED', 'D7']);
  });

  it('入った日より前（時計の巻き戻し等）は何も返さない', () => {
    expect(dueClosingNoticePhases({ ...entered, todayKey: '2026-08-31' })).toEqual([]);
  });

  it('返る順序は段の定義順である', () => {
    expect(TENANT_CLOSING_NOTICE_PHASES).toEqual(['ENTERED', 'D7']);
  });
});

describe('② isClosingNoticePhaseFiled — 未処理判定', () => {
  it('行が無ければ未処理', () => {
    expect(isClosingNoticePhaseFiled([])).toBe(false);
  });

  it.each(['QUEUED', 'HELD_PROVIDER_QUOTA', 'HELD_DOMAIN_UNVERIFIED', 'SENT', 'MOCKED'])(
    '%s があれば起票済み（積み増さない）',
    (status) => {
      expect(isClosingNoticePhaseFiled([status])).toBe(true);
    },
  );

  it('🔴 FAILED / SUPPRESSED だけなら未処理（翌日に再起票される）', () => {
    expect(isClosingNoticePhaseFiled(['FAILED'])).toBe(false);
    expect(isClosingNoticePhaseFiled(['SUPPRESSED'])).toBe(false);
    expect(isClosingNoticePhaseFiled(['FAILED', 'SUPPRESSED'])).toBe(false);
  });

  it('FAILED と SENT が混在すれば起票済み（宛先 1 人の不達で全員に再送しない）', () => {
    expect(isClosingNoticePhaseFiled(['FAILED', 'SENT'])).toBe(true);
  });

  it('対照: 起票済みとみなす明示の集合は QUEUED / SENT / MOCKED（HELD_* は接頭辞）', () => {
    expect(CLOSING_NOTICE_FILED_STATUSES).toEqual(['QUEUED', 'SENT', 'MOCKED']);
  });
});

describe('③ 🔴 classifyClosingNoticeDelivery — 配送済み判定（削除可否）', () => {
  const allMock = { mockedCountsAsDelivered: true };
  const realSend = { mockedCountsAsDelivered: false };

  it('行が無ければ配送済みではない（予告していないものは削除しない）', () => {
    expect(classifyClosingNoticeDelivery([], allMock).delivered).toBe(false);
    expect(classifyClosingNoticeDelivery([], realSend).delivered).toBe(false);
  });

  it('SENT が 1 件以上・保留 0 件で配送済み', () => {
    const result = classifyClosingNoticeDelivery(['SENT', 'SENT'], realSend);
    expect(result).toEqual({
      delivered: true,
      deliveredCount: 2,
      pendingCount: 0,
      failedCount: 0,
      suppressedCount: 0,
      mockedIgnoredCount: 0,
      total: 2,
    });
  });

  it.each(['QUEUED', 'HELD_PROVIDER_QUOTA', 'HELD_DOMAIN_UNVERIFIED'])(
    '🔴 %s が 1 件でも残れば、SENT があっても配送済みではない（保留は通知済みではない。docs/02 章 7.7-④）',
    (pending) => {
      const result = classifyClosingNoticeDelivery(['SENT', pending], realSend);
      expect(result.delivered).toBe(false);
      expect(result.pendingCount).toBe(1);
      expect(result.deliveredCount).toBe(1);
    },
  );

  it('FAILED だけなら配送済みではない（翌日の再起票を待つ）', () => {
    const result = classifyClosingNoticeDelivery(['FAILED'], realSend);
    expect(result.delivered).toBe(false);
    expect(result.failedCount).toBe(1);
  });

  it('SENT と FAILED の混在は配送済み（1 人に届いていれば予告は成立。不達分は再起票で補う）', () => {
    expect(classifyClosingNoticeDelivery(['SENT', 'FAILED'], realSend).delivered).toBe(true);
  });

  it('🔴 MOCKED は全モック環境（true）でだけ配送済みに数える', () => {
    const mock = classifyClosingNoticeDelivery(['MOCKED'], allMock);
    expect(mock.delivered).toBe(true);
    expect(mock.deliveredCount).toBe(1);
    expect(mock.mockedIgnoredCount).toBe(0);
  });

  it('🔴 sandbox 相当（false）では MOCKED を配送済みにしない（mockedIgnoredCount に数える）', () => {
    const real = classifyClosingNoticeDelivery(['MOCKED', 'MOCKED'], realSend);
    expect(real.delivered).toBe(false);
    expect(real.deliveredCount).toBe(0);
    expect(real.mockedIgnoredCount).toBe(2);
  });

  it('SUPPRESSED は配送済みでも保留でもない', () => {
    const result = classifyClosingNoticeDelivery(['SUPPRESSED'], allMock);
    expect(result.delivered).toBe(false);
    expect(result.suppressedCount).toBe(1);
    expect(result.pendingCount).toBe(0);
  });

  it('未知の状態は配送済みに倒さない', () => {
    expect(classifyClosingNoticeDelivery(['WHATEVER'], allMock).delivered).toBe(false);
  });
});

describe('④ dedupeKey の targetId（`{tenantId}#{phase}#{yyyy-mm-dd}`）', () => {
  it('組み立てと接頭辞', () => {
    expect(closingNoticeTargetId({ tenantId: TENANT, phase: 'ENTERED', dayKey: '2026-09-01' })).toBe(
      `${TENANT}#ENTERED#2026-09-01`,
    );
    expect(closingNoticeTargetIdPrefix({ tenantId: TENANT, phase: 'D7' })).toBe(`${TENANT}#D7#`);
  });

  it('区切りに `:` を使わない（dedupeKey の 3 分割を壊さない）', () => {
    expect(closingNoticeTargetId({ tenantId: TENANT, phase: 'D7', dayKey: '2026-09-24' })).not.toContain(':');
  });

  it('dedupeKey から段を復元できる（往復）', () => {
    const targetId = closingNoticeTargetId({ tenantId: TENANT, phase: 'D7', dayKey: '2026-09-24' });
    const dedupeKey = `${TENANT_CLOSING_NOTICE_TEMPLATE_KEY}:${targetId}:0123456789abcdef`;
    expect(parseClosingNoticeDedupeKey(dedupeKey)).toEqual({ tenantId: TENANT, phase: 'D7', dayKey: '2026-09-24' });
  });

  it('🔴 形が合わなければ null（黙って ENTERED に倒さない）', () => {
    expect(parseClosingNoticeDedupeKey('USAGE_LIMIT_NEARING:x#y#z:abc')).toBeNull();
    expect(parseClosingNoticeDedupeKey(`${TENANT_CLOSING_NOTICE_TEMPLATE_KEY}:${TENANT}#UNKNOWN#2026-09-01:abc`)).toBeNull();
    expect(parseClosingNoticeDedupeKey(`${TENANT_CLOSING_NOTICE_TEMPLATE_KEY}:${TENANT}#ENTERED:abc`)).toBeNull();
    expect(parseClosingNoticeDedupeKey(`${TENANT_CLOSING_NOTICE_TEMPLATE_KEY}:${TENANT}#ENTERED#:abc`)).toBeNull();
    expect(parseClosingNoticeDedupeKey('TENANT_CLOSING_NOTICE')).toBeNull();
  });
});
