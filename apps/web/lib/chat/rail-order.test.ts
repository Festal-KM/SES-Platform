// apps/web/lib/chat/rail-order.test.ts
// ✅ 2026-10-29（F-038 ⑯）: 左の列の並び替え（`lib/chat/rail-order.ts`）。
import { describe, expect, it } from 'vitest';
import {
  applyChatRailOrder,
  moveChatRailItem,
  parseChatRailOrder,
  serializeChatRailOrder,
  type ChatRailItemKey,
} from './rail-order';

const item = (key: ChatRailItemKey) => ({ key });
const DEFAULT = (['all', 'unread', 'dm', 'group', 'saved', 'companies', 'projects', 'contacts'] as const).map(item);
const keysOf = (items: readonly { readonly key: ChatRailItemKey }[]) => items.map((entry) => entry.key);

describe('parseChatRailOrder', () => {
  it('保存した並びを読み戻せる', () => {
    expect(parseChatRailOrder(serializeChatRailOrder(['projects', 'all']))).toEqual(['projects', 'all']);
  });

  it('🔴 壊れた値・配列でない値・未保存は null（最初の並びに戻す）', () => {
    expect(parseChatRailOrder(null)).toBeNull();
    expect(parseChatRailOrder('')).toBeNull();
    expect(parseChatRailOrder('{oops')).toBeNull();
    expect(parseChatRailOrder('{"a":1}')).toBeNull();
  });

  it('🔴 知らない鍵・文字列でない値・重複は捨てる', () => {
    expect(parseChatRailOrder(JSON.stringify(['unread', 'awaiting', 3, 'unread', 'company-xyz', 'all']))).toEqual(['unread', 'all']);
  });
});

describe('applyChatRailOrder', () => {
  it('覚えた並びが無ければ元の順', () => {
    expect(applyChatRailOrder(DEFAULT, null)).toBe(DEFAULT);
  });

  it('覚えた順に並べ、覚えていない項目は元の順のまま末尾に足す', () => {
    expect(keysOf(applyChatRailOrder(DEFAULT, ['projects', 'dm']))).toEqual([
      'projects', 'dm', 'all', 'unread', 'group', 'saved', 'companies', 'contacts',
    ]);
  });

  it('🔴 いま出ていない項目（閲覧専用の「保存済み」など）は並びに現れない（項目を増やさない）', () => {
    const viewer = DEFAULT.filter((entry) => entry.key !== 'saved');
    expect(keysOf(applyChatRailOrder(viewer, ['saved', 'contacts', 'all']))).toEqual([
      'contacts', 'all', 'unread', 'dm', 'group', 'companies', 'projects',
    ]);
  });
});

describe('moveChatRailItem', () => {
  const keys: readonly ChatRailItemKey[] = ['all', 'unread', 'dm'];

  it('1 つ上・下へ入れ替える', () => {
    expect(moveChatRailItem(keys, 'dm', -1)).toEqual(['all', 'dm', 'unread']);
    expect(moveChatRailItem(keys, 'all', 1)).toEqual(['unread', 'all', 'dm']);
  });

  it('端では動かさない（同じ配列）', () => {
    expect(moveChatRailItem(keys, 'all', -1)).toBe(keys);
    expect(moveChatRailItem(keys, 'dm', 1)).toBe(keys);
    expect(moveChatRailItem(keys, 'contacts', 1)).toBe(keys);
  });
});
