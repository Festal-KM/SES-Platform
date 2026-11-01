// ✅ 2026-11-01（F-038 改訂 17）: グループに人を足すときの「読める範囲の始まり」（純粋関数）。
// 境界（RLS・トリガ）は tests/isolation/chat-group-add-members.test.ts が実 DB で固定する。
import { describe, expect, it } from 'vitest';
import { ValidationError } from '../api/errors';
import { historyFromOf, jstStartOfDay, roomPartnerOf } from './rooms';
import { chatGroupMembersBodySchema } from './schemas';

const NOW = new Date('2026-11-01T03:00:00Z');

describe('historyFromOf', () => {
  it('すべて → null / 追加した時から → いま', () => {
    expect(historyFromOf({ history: 'ALL' }, NOW)).toBeNull();
    expect(historyFromOf({ history: 'JOINED' }, NOW)).toEqual(NOW);
  });

  it('日付を指定 → 日本時間のその日の 0 時（前日 15:00 UTC）', () => {
    expect(historyFromOf({ history: 'DATE', historyDate: '2026-02-01' }, NOW)?.toISOString()).toBe('2026-01-31T15:00:00.000Z');
    expect(jstStartOfDay('2026-11-01').toISOString()).toBe('2026-10-31T15:00:00.000Z');
    // 今日（日本時間）は選べる。
    expect(historyFromOf({ history: 'DATE', historyDate: '2026-11-01' }, NOW)).not.toBeNull();
  });

  it('🔴 未来の日付・存在しない日付・日付なしは 400', () => {
    expect(() => historyFromOf({ history: 'DATE', historyDate: '2026-11-02' }, NOW)).toThrow(ValidationError);
    expect(() => historyFromOf({ history: 'DATE', historyDate: '2026-02-30' }, NOW)).toThrow(ValidationError);
    expect(() => historyFromOf({ history: 'DATE' }, NOW)).toThrow(ValidationError);
  });
});

describe('chatGroupMembersBodySchema', () => {
  const id = '01930000-0000-7000-8000-000000000001';
  it('既定は「すべて」・日付は DATE のときだけ', () => {
    expect(chatGroupMembersBodySchema.parse({ userIds: [id] })).toEqual({ userIds: [id], history: 'ALL' });
    expect(chatGroupMembersBodySchema.safeParse({ userIds: [id], history: 'DATE' }).success).toBe(false);
    expect(chatGroupMembersBodySchema.safeParse({ userIds: [id], history: 'ALL', historyDate: '2026-01-01' }).success).toBe(false);
    expect(chatGroupMembersBodySchema.safeParse({ userIds: [id], history: 'DATE', historyDate: '2026-01-01' }).success).toBe(true);
  });
  it('🔴 部屋・取引先・テナントは受け取らない（未知のキーは 400）・空の人は 400', () => {
    expect(chatGroupMembersBodySchema.safeParse({ userIds: [id], partnerCompanyId: id }).success).toBe(false);
    expect(chatGroupMembersBodySchema.safeParse({ userIds: [id], tenantId: id }).success).toBe(false);
    expect(chatGroupMembersBodySchema.safeParse({ userIds: [] }).success).toBe(false);
  });
});

describe('roomPartnerOf（作るときの決まり。足すときも同じ考え方）', () => {
  it('取引先 2 社・取引先だけは例外', () => {
    expect(() => roomPartnerOf(['a', 'b', null])).toThrow(ValidationError);
    expect(() => roomPartnerOf(['a'])).toThrow(ValidationError);
    expect(roomPartnerOf([null, 'a'])).toBe('a');
  });
});
