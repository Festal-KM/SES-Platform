// apps/web/lib/format/datetime.test.ts
// 申し送り解消（invite-form.tsx の `formatExpiresAt` がサーバローカル TZ 依存だった件）。
// UTC/JST を明示する共通フォーマッタであることを検証する。
import { describe, expect, it } from 'vitest';
import { formatDateTimeJst } from './datetime';

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
