// apps/web/lib/chat/rail-order.ts
// ✅ 2026-10-29（紺野の決定・`docs/02` F-038 ⑯）: 左の列（すべて・未読・DM・グループ・保存済み・取引先・案件スレッド・連絡先）の
// 並びを利用者が変えられるようにする（純粋関数）。並びは**この端末**に覚える（`localStorage`）。
//
// 🔴 ここが守るもの
//   ① 覚えるのは**項目の鍵の並びだけ**（会社・案件・人の ID や件数を保存しない）。
//   ② 読めない・壊れた値は無視して最初の並びに戻す（例外で画面を止めない）。
//   ③ 知らない鍵（消えた項目・別の権限で出ていた項目）は捨て、覚えていない項目（新しく増えた・権限で出るようになった）は**末尾に足す**。
//   ④ 並べ替えで項目を増やしも減らしもしない（並べる母集団は画面が決める）。
//   ⑤ React・ブラウザに依存しない（保存領域の読み書きは呼び出し側）。

/** 保存する鍵（この端末に 1 つ）。 */
export const CHAT_RAIL_ORDER_STORAGE_KEY = 'ses.chat.rail.order';

/** 並べ替えられる項目の鍵。 */
export const CHAT_RAIL_ITEM_KEYS = ['all', 'unread', 'dm', 'group', 'saved', 'companies', 'projects', 'contacts'] as const;
export type ChatRailItemKey = (typeof CHAT_RAIL_ITEM_KEYS)[number];

const KNOWN = new Set<string>(CHAT_RAIL_ITEM_KEYS);

/** 保存された文字列を読む（JSON の文字列の配列で、知っている鍵だけ。壊れていれば `null`）。 */
export function parseChatRailOrder(raw: string | null): readonly ChatRailItemKey[] | null {
  if (raw === null || raw === '') return null;
  try {
    const value: unknown = JSON.parse(raw);
    if (!Array.isArray(value)) return null;
    const keys = value.filter((entry): entry is ChatRailItemKey => typeof entry === 'string' && KNOWN.has(entry));
    return [...new Set(keys)];
  } catch {
    return null;
  }
}

/** 保存する文字列。 */
export function serializeChatRailOrder(keys: readonly ChatRailItemKey[]): string {
  return JSON.stringify(keys);
}

/**
 * 覚えた並びを、いま出ている項目に当てる。
 * 覚えた順に並べ、覚えていない項目は元の順のまま末尾に足す。覚えた並びが無ければ元の順。
 */
export function applyChatRailOrder<T extends { readonly key: ChatRailItemKey }>(
  items: readonly T[],
  saved: readonly ChatRailItemKey[] | null,
): readonly T[] {
  if (saved === null || saved.length === 0) return items;
  const byKey = new Map(items.map((item) => [item.key, item] as const));
  const ordered = saved.flatMap((key) => {
    const item = byKey.get(key);
    return item === undefined ? [] : [item];
  });
  const placed = new Set(ordered.map((item) => item.key));
  return [...ordered, ...items.filter((item) => !placed.has(item.key))];
}

/** 1 つ上（`-1`）/ 下（`+1`）へ動かす。端では動かさない（同じ配列）。 */
export function moveChatRailItem(
  keys: readonly ChatRailItemKey[],
  key: ChatRailItemKey,
  delta: -1 | 1,
): readonly ChatRailItemKey[] {
  const index = keys.indexOf(key);
  const target = index + delta;
  if (index < 0 || target < 0 || target >= keys.length) return keys;
  const next = [...keys];
  next[index] = keys[target] as ChatRailItemKey;
  next[target] = key;
  return next;
}
