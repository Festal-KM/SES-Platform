// apps/web/lib/chat/day-separators.test.ts
// `withDaySeparators`（`S-031` の日付の区切り）の単体テスト。
import { describe, expect, it } from 'vitest';
import type { ChatMessageView } from './views';
import { formatChatTime, withDaySeparators } from './day-separators';

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

/** メッセージの `continued` を id 順に並べる（区切りは除く）。 */
function continuedOf(items: readonly ChatMessageView[]): readonly (readonly [string, boolean])[] {
  return withDaySeparators(items).flatMap((entry) =>
    entry.kind === 'message' ? [[entry.message.id, entry.continued] as const] : [],
  );
}

describe('同じ人の連続した発言をまとめる（continued）', () => {
  it('同じ人が 5 分以内に続けて書いたら 2 件目は続き', () => {
    expect(
      continuedOf([message('m1', '2026-10-13T01:00:00.000Z'), message('m2', '2026-10-13T01:04:00.000Z')]),
    ).toEqual([
      ['m1', false],
      ['m2', true],
    ]);
  });

  it('5 分を超えて空いたら、もう一度名前を出す', () => {
    expect(
      continuedOf([message('m1', '2026-10-13T01:00:00.000Z'), message('m2', '2026-10-13T01:06:00.000Z')]),
    ).toEqual([
      ['m1', false],
      ['m2', false],
    ]);
  });

  it('別の人の発言をはさんだら続きにしない', () => {
    const other: ChatMessageView = { ...message('o1', '2026-10-13T01:01:00.000Z'), senderName: '山田', own: true };
    expect(
      continuedOf([message('m1', '2026-10-13T01:00:00.000Z'), other, message('m2', '2026-10-13T01:02:00.000Z')]),
    ).toEqual([
      ['m1', false],
      ['o1', false],
      ['m2', false],
    ]);
  });

  it('🔴 名前が読めない発言（null）は、同じ会社でもまとめない（別人を 1 人に見せない）', () => {
    const unknown = (id: string, at: string): ChatMessageView => ({ ...message(id, at), senderName: null });
    expect(
      continuedOf([unknown('u1', '2026-10-13T01:00:00.000Z'), unknown('u2', '2026-10-13T01:01:00.000Z')]),
    ).toEqual([
      ['u1', false],
      ['u2', false],
    ]);
  });

  it('日付の区切りをまたいだら続きにしない', () => {
    // JST 10-12 23:58 と JST 10-13 00:01（3 分しか空いていないが、日付が変わる）。
    expect(
      continuedOf([message('m1', '2026-10-12T14:58:00.000Z'), message('m2', '2026-10-12T15:01:00.000Z')]),
    ).toEqual([
      ['m1', false],
      ['m2', false],
    ]);
  });
});

describe('formatChatTime', () => {
  it('JST の HH:MM を返す', () => {
    expect(formatChatTime('2026-10-13T09:57:00.000Z')).toBe('18:57');
  });

  it('🔴 UTC ではなく JST で出す（UTC 16:30 は JST 01:30）', () => {
    expect(formatChatTime('2026-10-12T16:30:00.000Z')).toBe('01:30');
  });

  it('解析できない日時はそのまま返す', () => {
    expect(formatChatTime('not-a-date')).toBe('not-a-date');
  });
});
