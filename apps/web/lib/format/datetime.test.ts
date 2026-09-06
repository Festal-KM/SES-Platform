// apps/web/lib/format/datetime.test.ts
// 申し送り解消（invite-form.tsx の `formatExpiresAt` がサーバローカル TZ 依存だった件）。
// UTC/JST を明示する共通フォーマッタであることを検証する。
import { describe, expect, it } from 'vitest';
import { formatDateTimeJst, toJstIsoDay } from './datetime';

describe('formatDateTimeJst（実行環境の暗黙のローカル TZ に依存しない共通フォーマッタ）', () => {
  it('UTC の ISO 文字列を JST（UTC+9）に変換し、末尾に JST を明示する', () => {
    expect(formatDateTimeJst('2026-09-04T15:30:00.000Z')).toBe('2026-09-05 00:30 JST');
  });

  it('日付をまたがない場合も同じ形式で変換する', () => {
    expect(formatDateTimeJst('2026-01-01T00:00:00.000Z')).toBe('2026-01-01 09:00 JST');
  });

  it('不正な日時はそのまま返す（解析失敗を握りつぶさない）', () => {
    expect(formatDateTimeJst('not-a-date')).toBe('not-a-date');
  });
});

describe('toJstIsoDay（🔴 日単位の丸めは JST 基準。`S-005` の更新日。T-05-09）', () => {
  it('🔴 UTC では前日でも、JST の暦日で切り出す（UTC 15:00 以降は翌日）', () => {
    // JST 2026-09-06 08:30 —— UTC 切り出しなら「2026-09-05」になってしまう境界。
    expect(toJstIsoDay(new Date('2026-09-05T23:30:00.000Z'))).toBe('2026-09-06');
  });

  it('同じ日のうちの時刻は日付を動かさない', () => {
    // JST 2026-09-05 23:30。
    expect(toJstIsoDay(new Date('2026-09-05T14:30:00.000Z'))).toBe('2026-09-05');
  });

  it('JST の 0:00 ちょうど（UTC 前日 15:00）は当日になる', () => {
    expect(toJstIsoDay(new Date('2026-09-05T15:00:00.000Z'))).toBe('2026-09-06');
  });

  it('JST の 23:59:59.999（UTC 14:59:59.999）はまだ当日である', () => {
    expect(toJstIsoDay(new Date('2026-09-05T14:59:59.999Z'))).toBe('2026-09-05');
  });

  it('月またぎ・年またぎでも桁が落ちない（`YYYY-MM-DD` 固定長）', () => {
    expect(toJstIsoDay(new Date('2025-12-31T15:00:00.000Z'))).toBe('2026-01-01');
    expect(toJstIsoDay(new Date('2026-01-31T15:00:00.000Z'))).toBe('2026-02-01');
  });

  it('🔴 `Date#toISOString().slice(0, 10)`（UTC 切り出し）と一致しない時間帯がある（退行の検知）', () => {
    const value = new Date('2026-09-05T23:30:00.000Z');
    expect(toJstIsoDay(value)).not.toBe(value.toISOString().slice(0, 10));
  });
});
