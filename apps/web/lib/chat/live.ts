// apps/web/lib/chat/live.ts
// ✅ 2026-10-14（チャットレーン）: `S-031` の新着の自動表示と送信の取り消し（純粋関数と定数）。
//
// 🔴 新着は**既存の API（`GET /api/threads/{id}/messages`。#50）を一定間隔で呼ぶだけ**である。境界は
//    その API の RLS（C6）が決め、ここは「手元の一覧にまだ無い行を足す」だけを行う。
//    方式（ポーリング / SSE）は `CLAUDE.md` §9-10 で未決 —— チャットの暫定値として紺野が決めた
//    （2026-10-14。`docs/chat-lane/roadmap.md` §4）。
// 🔴 本モジュールは `@ses/db` / `@ses/i18n` / React に依存しない。
import type { ChatMessageView } from './views';

/** 新着を取りに行く間隔（画面が見えているときだけ）。 */
export const CHAT_POLL_INTERVAL_MS = 15_000;

/** 送信を取り消せる時間（押してからこの時間だけ待って送る）。 */
export const CHAT_UNDO_SEND_MS = 5_000;

/** 並び（`sentAt` → `id`。`read.ts` が返す古い順と同じ）。 */
function compareOldest(a: ChatMessageView, b: ChatMessageView): number {
  if (a.sentAt !== b.sentAt) return a.sentAt < b.sentAt ? -1 : 1;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/**
 * 手元の一覧に、取り直した最新の行を足す。
 * - 🔴 **手元にある行は置き換えない**（過去を読み込んだ分・自分が送った分を消さない）
 * - 足すのは手元に無い行だけ。並びは古い順に揃える
 * - 何も足さなければ**同じ配列**を返す（再描画を起こさない）
 */
export function mergeLatestMessages(
  current: readonly ChatMessageView[],
  latest: readonly ChatMessageView[],
): { readonly items: readonly ChatMessageView[]; readonly added: readonly ChatMessageView[] } {
  const seen = new Set(current.map((item) => item.id));
  const added = latest.filter((item) => !seen.has(item.id));
  if (added.length === 0) return { items: current, added };
  return { items: [...current, ...added].sort(compareOldest), added };
}

/** 足した行のうち、相手（自分以外）の発言があるか。（「新しいメッセージがあります」を出すかどうか） */
export function hasOthersMessage(added: readonly ChatMessageView[]): boolean {
  return added.some((item) => !item.mine);
}

/**
 * ✅ 2026-10-16: 取り直した行のリアクションを、手元の同じ発言に写す（本文・並びは変えない）。
 * 何も変わらなければ同じ配列を返す。
 */
export function withLatestReactions(
  current: readonly ChatMessageView[],
  latest: readonly ChatMessageView[],
): readonly ChatMessageView[] {
  const byId = new Map(latest.map((item) => [item.id, item]));
  let changed = false;
  const next = current.map((item) => {
    const fresh = byId.get(item.id);
    if (fresh === undefined || JSON.stringify(fresh.reactions ?? []) === JSON.stringify(item.reactions ?? [])) return item;
    changed = true;
    return { ...item, reactions: fresh.reactions ?? [] };
  });
  return changed ? next : current;
}
