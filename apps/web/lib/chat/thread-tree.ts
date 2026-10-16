// apps/web/lib/chat/thread-tree.ts
// ✅ 2026-10-14（チャットレーン）: `S-031` のスレッド一覧を**会社ごとの木**にする（純粋関数）。
//
//   チャット（A社）                ← 企業スレッド（`COMPANY`）。親
//    ├ スレッド: 案件 X            ← 案件スレッド（`PROJECT`）。その会社との案件ごと
//    └ スレッド: 案件 Y
//   チャット（B社）
//
// 🔴 **境界を判定しない。** 入力は RLS（C6）を通って読めた行だけであり、ここは並べ替えと絞り込みだけを
//    行う。検索の対象も**読めた名前**（相手の会社名・読めた案件名）だけなので、検索の当たり外れから
//    読めない案件の名前を探れない。
// 🔴 **会社の ID を外へ出さない。** まとめる鍵（`groupKey`）は `read.ts` が渡し、出力の型には載せない。
// 🔴 本モジュールは `@ses/db` / `@ses/i18n` / React に依存しない。
import type { ChatThreadListItem } from './views';

/** 並べ方。`recent` = 更新があったものが上（既定）/ `company` = 相手の会社名順。 */
export const CHAT_THREAD_SORTS = ['recent', 'company'] as const;
export type ChatThreadSort = (typeof CHAT_THREAD_SORTS)[number];
export const CHAT_THREAD_SORT_DEFAULT: ChatThreadSort = 'recent';

/** 会社 1 社ぶん。 */
export type ChatThreadGroup = {
  /** 相手の会社名（読めなければ `null`。画面は「表示できません」を出す）。 */
  readonly counterpartyName: string | null;
  /** その会社とのチャット（企業スレッド）。まだ無ければ `null`。 */
  readonly chat: ChatThreadListItem | null;
  /** その会社との案件スレッド（更新があったものが上）。 */
  readonly threads: readonly ChatThreadListItem[];
  /** ✅ 2026-10-14: 返信が早い取引先（上位 10%。🔴 ホストにだけ真になりうる。`reply-speed.ts`）。 */
  readonly fastReply: boolean;
};

export type ChatThreadTreeInput = {
  /** 🔴 まとめる鍵（`chat_threads.partner_company_id`）。出力には載せない。 */
  readonly groupKey: string;
  readonly item: ChatThreadListItem;
};

/** 最終更新の新しい順に比べる（発言なし = `null` は後ろ。同時刻は ID の大きい順 = `read.ts` と同じ）。 */
function compareRecent(a: ChatThreadListItem, b: ChatThreadListItem): number {
  if (a.lastMessageAt !== b.lastMessageAt) {
    if (a.lastMessageAt === null) return 1;
    if (b.lastMessageAt === null) return -1;
    return a.lastMessageAt < b.lastMessageAt ? 1 : -1;
  }
  return a.id < b.id ? 1 : a.id > b.id ? -1 : 0;
}

/** 会社の中でいちばん新しい行（チャットとスレッドの両方から）。 */
function latestOf(group: ChatThreadGroup): ChatThreadListItem {
  const all = group.chat === null ? group.threads : [group.chat, ...group.threads];
  return [...all].sort(compareRecent)[0] as ChatThreadListItem;
}

/** 検索語に当たるか（大文字小文字を区別しない部分一致）。 */
function matches(value: string | null, needle: string): boolean {
  return value !== null && value.toLocaleLowerCase('ja').includes(needle);
}

/**
 * 木を組む。
 * - 会社ごとにまとめ、企業スレッドを親、案件スレッドを子にする
 * - `recent`: 会社の並びは、その会社のチャットとスレッドのうち**いちばん新しい更新**の順
 * - `company`: 相手の会社名順（読めない名前は最後）
 * - `q`: 相手の会社名に当たれば会社ごと出す。当たらなければ、案件名が当たるスレッドだけを残す
 */
export function buildThreadTree(
  input: readonly ChatThreadTreeInput[],
  options: {
    readonly sort: ChatThreadSort;
    readonly q: string | null;
    /** 返信が早い取引先の鍵（`reply-speed.ts`。省略 = 無し）。 */
    readonly fastReplyKeys?: ReadonlySet<string>;
    /** ✅ 2026-10-16: この ID のスレッドだけを残す（「未読のみ」）。親のチャットは文脈として残す（検索と同じ）。 */
    readonly onlyThreadIds?: ReadonlySet<string>;
  },
): readonly ChatThreadGroup[] {
  const byKey = new Map<
    string,
    { counterpartyName: string | null; chat: ChatThreadListItem | null; threads: ChatThreadListItem[]; fastReply: boolean }
  >();
  for (const { groupKey, item } of input) {
    const group = byKey.get(groupKey) ?? {
      counterpartyName: item.counterpartyName,
      chat: null,
      threads: [],
      fastReply: options.fastReplyKeys?.has(groupKey) ?? false,
    };
    if (group.counterpartyName === null) group.counterpartyName = item.counterpartyName;
    if (item.kind === 'COMPANY' && group.chat === null) group.chat = item;
    else group.threads.push(item);
    byKey.set(groupKey, group);
  }

  const needle = options.q === null ? '' : options.q.trim().toLocaleLowerCase('ja');
  const groups: ChatThreadGroup[] = [];
  const only = options.onlyThreadIds;
  for (const group of byKey.values()) {
    if (only !== undefined) {
      const chatHit = group.chat !== null && only.has(group.chat.id);
      const threadHits = group.threads.filter((thread) => only.has(thread.id));
      if (!chatHit && threadHits.length === 0) continue;
      group.threads = threadHits;
    }
    const threads = [...group.threads].sort(compareRecent);
    if (needle === '' || matches(group.counterpartyName, needle)) {
      groups.push({ counterpartyName: group.counterpartyName, chat: group.chat, threads, fastReply: group.fastReply });
      continue;
    }
    const hits = threads.filter((thread) => matches(thread.project?.name ?? null, needle));
    if (hits.length > 0) {
      groups.push({ counterpartyName: group.counterpartyName, chat: group.chat, threads: hits, fastReply: group.fastReply });
    }
  }

  if (options.sort === 'company') {
    return groups.sort((a, b) => {
      if (a.counterpartyName === b.counterpartyName) return compareRecent(latestOf(a), latestOf(b));
      if (a.counterpartyName === null) return 1;
      if (b.counterpartyName === null) return -1;
      return a.counterpartyName.localeCompare(b.counterpartyName, 'ja');
    });
  }
  return groups.sort((a, b) => compareRecent(latestOf(a), latestOf(b)));
}

/** ✅ 2026-10-14: 本文の検索を始める最短の語の長さ（短すぎる語で全文を走査しない）。 */
export const MESSAGE_SEARCH_MIN_LENGTH = 2;
/** 本文の検索で返す最大件数。 */
export const MESSAGE_SEARCH_LIMIT = 20;

/**
 * 本文の当たった箇所の前後だけを切り出す（前後 `radius` 文字。切ったら「…」）。改行は空白にする。
 * 当たらなければ先頭から。
 */
export function messageSnippet(body: string, q: string, radius = 40): string {
  const flat = body.replace(/\s+/g, ' ').trim();
  const index = flat.toLocaleLowerCase('ja').indexOf(q.trim().toLocaleLowerCase('ja'));
  const start = Math.max(0, (index < 0 ? 0 : index) - radius);
  const end = Math.min(flat.length, (index < 0 ? 0 : index + q.trim().length) + radius);
  return `${start > 0 ? '…' : ''}${flat.slice(start, end)}${end < flat.length ? '…' : ''}`;
}
