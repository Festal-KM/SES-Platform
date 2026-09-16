// apps/web/lib/admin-audit-logs/period.test.ts
// `period.ts`（`A-006` の期間写像。画面とルートが共有する 1 実装）。T-11-03。
// 🔴 `validateAuditLogPeriod` の判定そのものは `schemas.test.ts` が固定する。ここは日付入力との写像だけ。
import { describe, expect, it } from 'vitest';
import {
  defaultAuditLogPeriod,
  toDateInputValue,
  toRangeEndIso,
  toRangeStartIso,
  validateAuditLogPeriod,
} from './period';

describe('日付入力 → ISO 日時（UTC の日境界）', () => {
  it('開始は 00:00:00.000Z、終了は 23:59:59.999Z', () => {
    expect(toRangeStartIso('2026-09-01')).toBe('2026-09-01T00:00:00.000Z');
    expect(toRangeEndIso('2026-09-07')).toBe('2026-09-07T23:59:59.999Z');
  });

  it('Date → YYYY-MM-DD', () => {
    expect(toDateInputValue(new Date('2026-09-16T12:34:56.000Z'))).toBe('2026-09-16');
  });
});

describe('既定の期間 = 直近 7 日（docs/04 §A-006）', () => {
  it('now から 7 日前 〜 now', () => {
    expect(defaultAuditLogPeriod(new Date('2026-09-16T12:00:00.000Z'), 7)).toEqual({
      from: '2026-09-09',
      to: '2026-09-16',
    });
  });

  it('🔴 既定の期間は上限（31 日）の内側にある（開いた直後に検索できる）', () => {
    const period = defaultAuditLogPeriod(new Date('2026-09-16T12:00:00.000Z'), 7);
    expect(
      validateAuditLogPeriod(
        { from: toRangeStartIso(period.from), to: toRangeEndIso(period.to) },
        31,
      ),
    ).toBe('OK');
  });

  it('🔴 暦日で 32 日（9/1〜10/2）は上限超過、31 日（9/1〜10/1）は内側', () => {
    expect(
      validateAuditLogPeriod(
        { from: toRangeStartIso('2026-09-01'), to: toRangeEndIso('2026-10-02') },
        31,
      ),
    ).toBe('TOO_LONG');
    expect(
      validateAuditLogPeriod(
        { from: toRangeStartIso('2026-09-01'), to: toRangeEndIso('2026-10-01') },
        31,
      ),
    ).toBe('OK');
  });

  it('不正な日付文字列は INVERTED（検索を実行しない側に倒す）', () => {
    expect(validateAuditLogPeriod({ from: 'x', to: '2026-09-01T00:00:00.000Z' }, 31)).toBe('INVERTED');
  });
});
