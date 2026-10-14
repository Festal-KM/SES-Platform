// apps/web/lib/chat/panes.ts
// ✅ 2026-10-14（チャットレーン）: `S-031` の**会話を右に並べて開く**（Slack の分割表示に寄せる）。純粋関数。
//
// 🔴 並びは URL だけが持つ（`?thread=<左>&pane=<2 列目>&pane=<3 列目>`。`screen-query.ts`）。
//    ここは「足す」「閉じる」「選び直す」で次の並びを決めるだけで、**読める・読めないは判定しない**
//    （判定は `read.ts` の RLS。見えない ID を足しても画面は「表示できません」を出すだけで、
//    中身には 1 文字も届かない）。
// 🔴 本モジュールは `@ses/db` / `@ses/i18n` / React に依存しない（クライアントの島からも呼べる）。
import { z } from 'zod';
import { CHAT_MAX_EXTRA_PANES, CHAT_PATH, CHAT_THREAD_PARAM } from './screen-query';

/** 開いている会話の並び。`thread` が左端、`panes` がその右。 */
export type ChatPaneState = {
  readonly thread: string | null;
  readonly panes: readonly string[];
};

/** 開いている会話を左から順に。 */
export function openThreadIds(state: ChatPaneState): readonly string[] {
  return state.thread === null ? [] : [state.thread, ...state.panes];
}

/** まだ右に足せるか（上限に達していない・何かを開いている）。 */
export function canAddPane(state: ChatPaneState): boolean {
  return state.thread !== null && state.panes.length < CHAT_MAX_EXTRA_PANES;
}

/**
 * 会話を右端に足す。🔴 **すでに開いているものは足さない**（同じ会話を 2 列に出さない）。
 * 何も開いていなければ左端に開く。上限に達していれば並びを変えない。
 */
export function withPaneAdded(state: ChatPaneState, threadId: string): ChatPaneState {
  if (state.thread === null) return { thread: threadId, panes: [] };
  if (openThreadIds(state).includes(threadId)) return state;
  if (!canAddPane(state)) return state;
  return { thread: state.thread, panes: [...state.panes, threadId] };
}

/**
 * 会話を閉じる。🔴 左端を閉じたら、次の列が左端に繰り上がる（右の会話を巻き添えで閉じない）。
 */
export function withPaneClosed(state: ChatPaneState, threadId: string): ChatPaneState {
  const rest = openThreadIds(state).filter((id) => id !== threadId);
  return { thread: rest[0] ?? null, panes: rest.slice(1) };
}

/**
 * 一覧で会話を選び直す（行をクリック）。左端を差し替え、右の並びは残す。
 * 🔴 選んだ会話がすでに右に開いていれば、その列を左端へ移す（同じ会話を 2 列に出さない）。
 */
export function withThreadSelected(state: ChatPaneState, threadId: string): ChatPaneState {
  return { thread: threadId, panes: state.panes.filter((id) => id !== threadId) };
}

const droppedThreadIdSchema = z.uuid();

/**
 * 一覧の行をドラッグしたときに運ばれる URL（`text/uri-list`）から会話の ID を取り出す。
 * 🔴 **同じ画面（`/chat`）の `?thread=<UUID>` だけを受ける。** 他の URL・他のオリジン・
 *    形の違う ID は `null`（外から何かを落とされても、並びに入れない）。
 */
export function threadIdFromDroppedUrl(raw: string, origin: string): string | null {
  const first = raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line !== '' && !line.startsWith('#'));
  if (first === undefined) return null;
  let url: URL;
  try {
    url = new URL(first, origin);
  } catch {
    return null;
  }
  if (url.origin !== origin || url.pathname !== CHAT_PATH) return null;
  const parsed = droppedThreadIdSchema.safeParse(url.searchParams.get(CHAT_THREAD_PARAM));
  return parsed.success ? parsed.data : null;
}
