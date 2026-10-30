// apps/web/lib/chat/outbox.ts
// ✅ 2026-10-29（紺野の決定・`docs/02` F-038 ⑮）: 送った発言を**押したその場で**会話に出す（5 秒の取り消し待ちをやめた）。
//
// 送信待ちの発言は「送信箱（outbox）」として手元にだけ持ち、会話の末尾に「送信中」の吹き出しで描く。
// サーバの応答が来たら、その吹き出しを**サーバの発言に置き換える**（仮の ID で引き当てる）。
//
// 🔴 ここが守るもの
//   ① **送信箱は手元だけのもの**。他の人には見えず、サーバにも保存しない（読み込み直すと消える。文章は下書きに残る）。
//   ② **正はサーバの応答だけ**。送信箱の吹き出しをサーバの発言として扱わない（ID・既読・リアクションを持たない）。
//      置き換えは `mergeLatestMessages` を通す —— 新着の取得が先にその発言を持ってきていても 1 行に畳む（二重に出さない）。
//   ③ **1 件ずつ順に送る**（押した順に会話へ並ぶ）。失敗した発言は止めて残し、後ろの発言は先に進める。
//   ④ 純粋関数（I/O なし・React に依存しない）。
import { mergeLatestMessages } from './live';
import type { ChatMessageView } from './views';

/** 送信箱の 1 件の状態。`QUEUED` = 前の送信の終わりを待っている / `UPLOADING` = ファイルを置いている / `SENDING` = 送っている。 */
export type ChatOutboxStatus = 'QUEUED' | 'UPLOADING' | 'SENDING' | 'FAILED';

/** 送れなかった理由（`FAILED` のときだけ）。`PROJECT` = この部屋に貼れない案件 / `ATTACHMENT` = ファイルを置けなかった。 */
export type ChatOutboxFailure = 'FAILED' | 'PROJECT' | 'ATTACHMENT';

export type ChatOutboxEntry<P> = {
  /** 手元だけの仮の ID（サーバの発言の ID とは別の形。`chat-tmp-` で始まる）。 */
  readonly tempId: string;
  readonly status: ChatOutboxStatus;
  readonly failure: ChatOutboxFailure | null;
  /** サーバに送る本文（引用つきなら引用の頭を含む）。吹き出しに出す文字でもある。 */
  readonly text: string;
  /**
   * 足した時点の会話の最後の発言（無ければ `null`）。新着の取得が先に同じ発言を持ってきたかを見分ける境目
   * （サーバの時刻どうしで比べる。手元の時計と比べない）。
   */
  readonly after: { readonly sentAt: string; readonly id: string } | null;
  /** 送る中身（本文・貼る案件・ファイル・引用。形は呼び出し側が決める）。 */
  readonly payload: P;
};

/** 仮の ID の頭（サーバの発言の ID〔UUID〕と取り違えない）。 */
export const CHAT_TEMP_ID_PREFIX = 'chat-tmp-';

/** 仮の ID を作る（同じ画面の中で重ならなければよい）。 */
export function chatTempId(sequence: number, nowMs: number): string {
  return `${CHAT_TEMP_ID_PREFIX}${String(nowMs)}-${String(sequence)}`;
}

/** 仮の ID か（手元だけの吹き出しか）。 */
export function isChatTempId(id: string): boolean {
  return id.startsWith(CHAT_TEMP_ID_PREFIX);
}

/** 送信箱の末尾に 1 件足す（前の送信が終わるまで `QUEUED`）。`items` は足した時点の会話。 */
export function enqueueOutbox<P>(
  entries: readonly ChatOutboxEntry<P>[],
  input: { readonly tempId: string; readonly text: string; readonly items: readonly ChatMessageView[]; readonly payload: P },
): readonly ChatOutboxEntry<P>[] {
  const last = input.items.at(-1);
  return [
    ...entries,
    {
      tempId: input.tempId,
      status: 'QUEUED',
      failure: null,
      text: input.text,
      after: last === undefined ? null : { sentAt: last.sentAt, id: last.id },
      payload: input.payload,
    },
  ];
}

/** 次に送る 1 件（いちばん古い `QUEUED`）。送っている最中の発言があれば `null`（③ 1 件ずつ）。 */
export function nextOutboxToSend<P>(entries: readonly ChatOutboxEntry<P>[]): ChatOutboxEntry<P> | null {
  if (entries.some((entry) => entry.status === 'UPLOADING' || entry.status === 'SENDING')) return null;
  return entries.find((entry) => entry.status === 'QUEUED') ?? null;
}

/** 1 件の状態を変える（無ければ同じ配列）。 */
export function updateOutbox<P>(
  entries: readonly ChatOutboxEntry<P>[],
  tempId: string,
  status: ChatOutboxStatus,
  failure: ChatOutboxFailure | null = null,
): readonly ChatOutboxEntry<P>[] {
  if (!entries.some((entry) => entry.tempId === tempId)) return entries;
  return entries.map((entry) => (entry.tempId === tempId ? { ...entry, status, failure: status === 'FAILED' ? failure ?? 'FAILED' : null } : entry));
}

/** 1 件を外す（送れた・取り消した）。 */
export function removeOutbox<P>(entries: readonly ChatOutboxEntry<P>[], tempId: string): readonly ChatOutboxEntry<P>[] {
  return entries.filter((entry) => entry.tempId !== tempId);
}

/**
 * 送れた発言を会話に置く（② 送信箱から外すのは呼び出し側。`removeOutbox`）。
 * 🔴 新着の取得が先に同じ発言を持ってきていても、会話には 1 行だけ（`mergeLatestMessages` が ID で畳む）。
 */
export function placeSentMessage(items: readonly ChatMessageView[], message: ChatMessageView): readonly ChatMessageView[] {
  return mergeLatestMessages(items, [message]).items;
}

function isLater(item: ChatMessageView, after: ChatOutboxEntry<unknown>['after']): boolean {
  if (after === null) return true;
  if (item.sentAt !== after.sentAt) return item.sentAt > after.sentAt;
  return item.id > after.id;
}

/**
 * 送っている最中に、新着の取得が**応答より先に**その発言を持ってきたか（そのときは「送信中」の吹き出しを隠す = 二重に見せない）。
 * 足した時点より後ろの、自分の・同じ本文の発言があれば真。応答が来たら吹き出しは送信箱から外れる。
 */
export function isOutboxShadowed<P>(entry: ChatOutboxEntry<P>, items: readonly ChatMessageView[]): boolean {
  if (entry.status !== 'SENDING') return false;
  return items.some((item) => item.mine && item.deleted !== true && (item.body ?? '') === entry.text && isLater(item, entry.after));
}

/** 失敗した発言を送り直せるか（🔴 貼れない案件で断られた発言は、同じ失敗を繰り返すので送り直させない）。 */
export function canResendOutbox<P>(entry: ChatOutboxEntry<P>): boolean {
  return entry.status === 'FAILED' && entry.failure !== 'PROJECT';
}

/** 送り直す（`FAILED` → `QUEUED`）。送り直せない 1 件なら同じ配列。 */
export function requeueOutbox<P>(entries: readonly ChatOutboxEntry<P>[], tempId: string): readonly ChatOutboxEntry<P>[] {
  const entry = entries.find((candidate) => candidate.tempId === tempId);
  if (entry === undefined || !canResendOutbox(entry)) return entries;
  return updateOutbox(entries, tempId, 'QUEUED');
}
