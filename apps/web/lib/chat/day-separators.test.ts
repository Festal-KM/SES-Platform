// apps/web/lib/chat/day-separators.test.ts
// `withDaySeparators`（`S-031` の日付の区切り）の単体テスト。
import { describe, expect, it } from 'vitest';
import type { ChatMessageView } from './views';
import { withDaySeparators } from './day-separators';

function message(id: string, sentAt: string): ChatMessageView {
  return { id, sentAt, senderName: '佐藤', senderCompanyName: '株式会社サンプル', own: false, body: '本文' };
}

describe('withDaySeparators', () => {
  it('発言が無ければ区切りも出さない', () => {
    expect(withDaySeparators([])).toEqual([]);
  });

  it('先頭の発言の前に必ず 1 つ区切りを置き、同じ日の発言の間には置かない', () => {
    const entries = withDaySeparators([
      message('m1', '2026-10-13T01:00:00.000Z'),
      message('m2', '2026-10-13T05:00:00.000Z'),
    ]);
    expect(entries.map((entry) => (entry.kind === 'day' ? `day:${entry.day}` : entry.message.id))).toEqual([
      'day:2026-10-13',
      'm1',
      'm2',
    ]);
  });

  it('JST の暦日が変わる位置にだけ区切りを差し込む', () => {
    const entries = withDaySeparators([
      message('m1', '2026-10-12T10:00:00.000Z'), // JST 10-12 19:00
      message('m2', '2026-10-13T02:00:00.000Z'), // JST 10-13 11:00
    ]);
    expect(entries.map((entry) => (entry.kind === 'day' ? `day:${entry.day}` : entry.message.id))).toEqual([
      'day:2026-10-12',
      'm1',
      'day:2026-10-13',
      'm2',
    ]);
  });

  it('🔴 UTC ではなく JST で切る（JST 0:00〜8:59 の発言を前日の下に入れない）', () => {
    // UTC 10-12 16:30 = JST 10-13 01:30。UTC で切ると 10-12 になってしまう。
    const entries = withDaySeparators([message('m1', '2026-10-12T16:30:00.000Z')]);
    expect(entries[0]).toEqual({ kind: 'day', day: '2026-10-13' });
  });

  it('並び順を変えない（受け取った順のまま）', () => {
    const items = [message('b', '2026-10-13T03:00:00.000Z'), message('a', '2026-10-13T01:00:00.000Z')];
    const ids = withDaySeparators(items).flatMap((entry) => (entry.kind === 'message' ? [entry.message.id] : []));
    expect(ids).toEqual(['b', 'a']);
  });

  it('解析できない日時は握りつぶさず、その文字列のまま区切りに出す', () => {
    const entries = withDaySeparators([message('m1', 'not-a-date')]);
    expect(entries[0]).toEqual({ kind: 'day', day: 'not-a-date' });
  });
});
