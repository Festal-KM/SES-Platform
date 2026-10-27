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
 * - 🔴 **手元にある行は置き換えない**（過去を読み込んだ分・自分が送った分を消さない）。✅ 2026-10-27: 位置（sentAt）だけは揃えて並べ直す
 * - 足すのは手元に無い行だけ。並びは古い順に揃える
 * - 何も足さなければ**同じ配列**を返す（再描画を起こさない）
 */
export function mergeLatestMessages(
  current: readonly ChatMessageView[],
  latest: readonly ChatMessageView[],
): { readonly items: readonly ChatMessageView[]; readonly added: readonly ChatMessageView[] } {
  // ✅ 2026-10-27: 手元にある行でも、位置（sentAt）が動いていれば取り直した値に揃える（検査が CLEAN になった添付の発言）。
  //    本文などの中身は置き換えない（`withLatestReactions` の役目）。
  const byId = new Map(latest.map((item) => [item.id, item]));
  let moved = false;
  const base = current.map((item) => {
    const fresh = byId.get(item.id);
    if (fresh === undefined || fresh.sentAt === item.sentAt) return item;
    moved = true;
    return { ...item, sentAt: fresh.sentAt };
  });
  const seen = new Set(current.map((item) => item.id));
  // 🔴 取り直した行どうしの重なり（読み足した分と直近のページ）も 1 行に畳む。
  const added = latest.filter((item) => {
    if (seen.has(item.id)) return false;
    seen.add(item.id);
    return true;
  });
  if (added.length === 0) return { items: moved ? [...base].sort(compareOldest) : current, added };
  return { items: [...base, ...added].sort(compareOldest), added };
}

/**
 * ✅ 2026-10-27（Codex レビュー 3 回目）: 位置（sentAt）が動いた行を除いた、つながりの判定に使える行。
 * 検査が CLEAN になった添付の発言は公開した時点（最後尾）へ移る。手元にある行が直近のページの末尾に移って現れても、
 * それは「つながっている」証拠にならない（その前に届いた発言を取りこぼしている）。
 */
function stableOverlap(
  current: readonly ChatMessageView[],
  latest: readonly ChatMessageView[],
): { readonly localStable: readonly ChatMessageView[]; readonly latestStable: readonly ChatMessageView[] } {
  const localById = new Map(current.map((item) => [item.id, item]));
  const latestById = new Map(latest.map((item) => [item.id, item]));
  return {
    localStable: current.filter((item) => {
      const fresh = latestById.get(item.id);
      return fresh === undefined || fresh.sentAt === item.sentAt;
    }),
    latestStable: latest.filter((item) => {
      const local = localById.get(item.id);
      return local === undefined || local.sentAt === item.sentAt;
    }),
  };
}

/**
 * ✅ 2026-10-26（#166 の 4）: 直近のページが手元の最後の発言と**つながっていない**か。
 * 直近のページが満杯（`pageSize` 件）で、手元の発言と 1 件も重ならず、しかも全部が手元の最後より新しいなら、
 * その間に取りこぼしがある（バックグラウンド中に `pageSize` 件を超えて届いた）。
 * 🔴 そのまま足すと会話の途中が黙って抜ける。呼び出し側は `gapAnchor` から `after` で読み足す。
 * ✅ 2026-10-27: 🔴 位置が動いた行（`stableOverlap`）は重なりの証拠にも「手元の最後」にも使わない。`current` は
 *    **取り直す前の**手元の行を渡す（並べ直した後の行を渡すと、動いた行が手元の最後に見えて取りこぼしを見逃す）。
 */
export function hasGapBefore(
  current: readonly ChatMessageView[],
  latest: readonly ChatMessageView[],
  pageSize: number,
): boolean {
  if (latest.length < pageSize) return false;
  const { localStable, latestStable } = stableOverlap(current, latest);
  const last = localStable.at(-1);
  const oldest = latestStable[0];
  if (last === undefined || oldest === undefined) return false;
  const seen = new Set(localStable.map((item) => item.id));
  if (latestStable.some((item) => seen.has(item.id))) return false;
  return compareOldest(oldest, last) > 0;
}

/**
 * ✅ 2026-10-27: 取りこぼしを読み足す起点（`after` に渡す ID）。位置が動いていない手元の最後の行。無ければ `undefined`。
 */
export function gapAnchor(current: readonly ChatMessageView[], latest: readonly ChatMessageView[]): string | undefined {
  return stableOverlap(current, latest).localStable.at(-1)?.id;
}

/**
 * ✅ 2026-10-27（Codex レビュー 3 回目）: 取り直した行を手元に当てる（中身・位置を揃え、足りない行を足し、並べ直す）。
 * 🔴 画面は `setItems((current) => applyLatestMessages(current, latest).items)` の形で**当てる時点の手元**に当てる
 *    （読み足しの待ち時間に「以前のメッセージ」が読み込まれても、その行を落とさない）。
 */
export function applyLatestMessages(
  current: readonly ChatMessageView[],
  latest: readonly ChatMessageView[],
): { readonly items: readonly ChatMessageView[]; readonly added: readonly ChatMessageView[] } {
  return mergeLatestMessages(withLatestReactions(current, latest), latest);
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
  let moved = false;
  const next = current.map((item) => {
    const fresh = byId.get(item.id);
    // ✅ 2026-10-16: 編集・削除（本文・印）も取り直した値に揃える。並び（sentAt / id）は変えない。
    // ✅ 2026-10-26（Codex のレビュー）: 貼られた案件のカード（`attachedProject`）も取り直した値に揃える。
    //    🔴 公開を取り消されたら、開いたままの画面からも案件名・リンク・引用を消す（サーバは `{ visible: false }` を返している）。
    // ✅ 2026-10-26（#164 の 5）: 保存済みの印と送信者のひとこと状態も揃える（別のタブで外した・状態を消した）。
    const pick = (m: ChatMessageView) =>
      JSON.stringify([m.sentAt, m.reactions ?? [], m.body, m.edited ?? false, m.deleted ?? false, m.attachedProject ?? null, m.saved ?? false, m.senderStatus ?? null, m.attachment ?? null]);
    if (fresh === undefined || pick(fresh) === pick(item)) return item;
    changed = true;
    if (fresh.sentAt !== item.sentAt) moved = true;
    const next: ChatMessageView = {
      ...item,
      // ✅ 2026-10-27: 検査が CLEAN になった添付の発言は、公開した時点の位置へ移る（サーバが sent_at を進める）。
      sentAt: fresh.sentAt,
      reactions: fresh.reactions ?? [],
      body: fresh.body,
      edited: fresh.edited ?? false,
      deleted: fresh.deleted ?? false,
      saved: fresh.saved ?? false,
      senderStatus: fresh.senderStatus ?? null,
      // ✅ 2026-10-27: 添付の検査の状態（送った本人の「検査中」→ プレビュー）も揃える。
      ...(fresh.attachment === undefined ? {} : { attachment: fresh.attachment }),
    };
    // 取り直した値にカードが無ければ、手元のカードも外す（前の名前・ID を残さない）。
    if (fresh.attachedProject === undefined) {
      const { attachedProject, ...withoutCard } = next;
      void attachedProject;
      return withoutCard;
    }
    return { ...next, attachedProject: fresh.attachedProject };
  });
  if (!changed) return current;
  // 🔴 位置が動いた行があれば (sentAt, id) で並べ直す（行は落とさない。最後の行も並べ直した後のものになる）。
  return moved ? [...next].sort(compareOldest) : next;
}

/** ✅ 2026-10-26（#166 の 4）: 読み足しの 1 回ぶんの結果。 */
export type GapChunk = { readonly items: readonly ChatMessageView[]; readonly hasMoreAfter: boolean };

/**
 * ✅ 2026-10-26（#166 の 4）: 手元の最後（`after`）から後ろを、`maxPages` 回まで読み足す。
 * `complete` は「最新まで読み切れた」か。🔴 読み切れていないとき、呼び出し側は直近のページを**足さない**
 * （足すと、読み足した分と直近のページの間が永久に抜ける。次の回に、新しい最後から続きを読む）。
 * 1 回でも読めなければ `null`（今回は何も足さない）。
 */
export async function readGapAfter(
  after: string,
  fetchChunk: (after: string) => Promise<GapChunk | null>,
  maxPages: number,
): Promise<{ readonly items: readonly ChatMessageView[]; readonly complete: boolean } | null> {
  const items: ChatMessageView[] = [];
  let cursor: string | undefined = after;
  for (let page = 0; page < maxPages && cursor !== undefined; page += 1) {
    const chunk = await fetchChunk(cursor);
    if (chunk === null) return null;
    items.push(...chunk.items);
    if (!chunk.hasMoreAfter) return { items, complete: true };
    cursor = chunk.items.at(-1)?.id;
  }
  return { items, complete: false };
}
