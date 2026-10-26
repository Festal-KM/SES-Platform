// apps/web/lib/chat/screen-query.ts
// `S-031` の URL（純粋関数 + Zod）。
//
// 🔴 **スレッドの選択を URL に載せる**（`/chat?thread=<id>`）。理由は 2 つ:
//   ① 共有・再読込・戻るで同じ会話に戻れる（`S-005` / `S-015` の検索条件が URL に載るのと同じ規律）。
//   ② 動的ルート（`/chat/[id]`）を作らないため、**`/chat` が静的ルートのまま**になり、
//      ナビの到達集合（`tests/static/nav-reach.test.ts`）に 1 件として現れる。
// 🔴 **壊れた値は素の `/chat` へ戻す**（握り潰して `undefined` 扱いにしない。`S-019` と同じ判断）。
// 🔴 本モジュールは `@ses/db` / `@ses/i18n` / React に依存しない（クライアントの島からも呼べる）。
import { PAGE_CURSOR_MAX_LENGTH } from '@ses/config';
import { z } from 'zod';
import { isChatThreadCursor } from './thread-cursor';
import { CHAT_THREAD_SORTS, CHAT_THREAD_SORT_DEFAULT, type ChatThreadSort } from './thread-tree';

export const CHAT_PATH = '/chat';

/** 選択中のスレッド。 */
export const CHAT_THREAD_PARAM = 'thread';
/** スレッド一覧のカーソル（会話のカーソルは URL に載せない = 島が `fetch` で追う）。 */
export const CHAT_THREADS_CURSOR_PARAM = 'threads';
/**
 * ✅ 2026-10-14（チャットレーン）: **右に並べて開いている会話**（`?pane=<id>&pane=<id>`）。
 * `thread`（いちばん左の会話）に加えて最大 `CHAT_MAX_EXTRA_PANES` 本。🔴 URL に載せるので、
 * 再読込・戻る・共有で同じ並びに戻る（ブラウザの保存領域に置かない）。
 */
export const CHAT_PANE_PARAM = 'pane';
/** 🔴 並べて開ける追加の会話の上限（`thread` と合わせて 3 列）。 */
export const CHAT_MAX_EXTRA_PANES = 2;
/** ✅ 2026-10-14: 一覧の検索語（相手の会社名・案件名の部分一致。`thread-tree.ts`）。 */
export const CHAT_Q_PARAM = 'q';
/** ✅ 2026-10-14: 一覧の並べ方（`recent` = 更新があったものが上 / `company` = 会社名順）。 */
export const CHAT_SORT_PARAM = 'sort';
/** ✅ 2026-10-16: 一覧を未読のスレッドだけにする（`unread=1`）。 */
export const CHAT_UNREAD_PARAM = 'unread';
/**
 * ✅ 2026-10-19（v2・紺野「会社から＞ 人から＞ 行けるならOK」）: 左の絞り込みの列の選択（`f=`）。
 *   `unread` / `awaiting` / `dm` / `group` / `contacts`（連絡先）/ `newgroup`（新しいグループ。2026-10-22）/ `co.<会社の鍵>` / `person.<利用者の ID>`。
 * 🔴 会社の鍵は**その会社の会話の行の ID**（取引先の ID を URL に出さない）。値は読み出しの母集団の中でだけ効く。
 * ✅ 2026-10-22（紺野）: `saved`（保存済み）/ `templates`（定型文の管理）を足した。
 *    `awaiting`（要返信）は左の列から外したが、古いリンクのために受け付けたまま「すべて」と同じに扱う（壊れた値にしない）。
 */
export const CHAT_FILTER_PARAM = 'f';
/** ✅ 2026-10-19（v2）: 右の情報欄を開く（`info=1`）。既定は閉じる（会話の幅を確保する）。 */
export const CHAT_INFO_PARAM = 'info';
const UUID_PATTERN = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
export const CHAT_FILTER_PATTERN = new RegExp(
  '^(unread|awaiting|dm|group|contacts|newgroup|saved|templates|co\\.' + UUID_PATTERN + '|person\\.' + UUID_PATTERN + ')$',
);
export type ChatListFilter =
  | { readonly kind: 'all' }
  | { readonly kind: 'unread' | 'dm' | 'group' | 'contacts' | 'newgroup' | 'saved' | 'templates' }
  | { readonly kind: 'company'; readonly key: string }
  | { readonly kind: 'person'; readonly userId: string };

/** `f=` の値を読む（壊れた値は「すべて」）。 */
export function parseChatFilter(value: string | undefined): ChatListFilter {
  if (value === undefined || !CHAT_FILTER_PATTERN.test(value)) return { kind: 'all' };
  // ✅ 2026-10-22: 旧「要返信」は古いリンクのために受け付け、「すべて」として読む。
  if (value === 'awaiting') return { kind: 'all' };
  if (value.startsWith('co.')) return { kind: 'company', key: value.slice(3) };
  if (value.startsWith('person.')) return { kind: 'person', userId: value.slice(7) };
  return { kind: value as 'unread' | 'dm' | 'group' | 'contacts' | 'newgroup' | 'saved' | 'templates' };
}

/** `f=` の値に戻す（「すべて」は付けない）。 */
export function chatFilterValue(filter: ChatListFilter): string | null {
  if (filter.kind === 'all') return null;
  if (filter.kind === 'company') return 'co.' + filter.key;
  if (filter.kind === 'person') return 'person.' + filter.userId;
  return filter.kind;
}

/** 検索語の上限（会社名・案件名より十分長い）。 */
export const CHAT_Q_MAX_LENGTH = 100;

/**
 * 🔴 **形だけを受ける**（形が違えば `safeParse` が失敗し、画面は素の `/chat` へ戻す）。
 *    形の妥当な ID が母集団に無ければ「見えない」= 一覧へ戻す（`docs/05` §4.8）。
 *  - `thread` … スレッドの行の UUID
 *  - `threads` … 🔴 **スレッド一覧の複合カーソル**（`thread-cursor.ts`。UUID ではない）
 *  - `pane` … 右に並べる会話の UUID（0〜2 本。1 本なら文字列、2 本なら配列で届く）。
 *    🔴 **`thread` なしの `pane`・重複・上限超えは壊れた値として扱う**（画面は `/chat` へ戻す）。
 */
export const chatScreenQuerySchema = z
  .object({
    [CHAT_THREAD_PARAM]: z.uuid().optional(),
    [CHAT_THREADS_CURSOR_PARAM]: z
      .string()
      .trim()
      .min(1)
      .max(PAGE_CURSOR_MAX_LENGTH)
      .refine(isChatThreadCursor)
      .optional(),
    [CHAT_PANE_PARAM]: z
      .union([z.uuid(), z.array(z.uuid()).max(CHAT_MAX_EXTRA_PANES)])
      .transform((value) => (typeof value === 'string' ? [value] : value))
      .optional(),
    // 🔴 空の検索語は「指定なし」と同じ（フォームの送信で `q=` が付いても壊れた値にしない）。
    [CHAT_Q_PARAM]: z
      .string()
      .trim()
      .max(CHAT_Q_MAX_LENGTH)
      .transform((value) => (value === '' ? undefined : value))
      .optional(),
    [CHAT_SORT_PARAM]: z.enum(CHAT_THREAD_SORTS).optional(),
    [CHAT_UNREAD_PARAM]: z.literal('1').optional(),
    [CHAT_FILTER_PARAM]: z.string().regex(CHAT_FILTER_PATTERN).optional(),
    [CHAT_INFO_PARAM]: z.literal('1').optional(),
  })
  .refine((query) => {
    const panes = query.pane ?? [];
    if (panes.length === 0) return true;
    if (query.thread === undefined) return false;
    const ids = [query.thread, ...panes];
    return new Set(ids).size === ids.length;
  });

export type ChatScreenQuery = z.infer<typeof chatScreenQuerySchema>;

/** `/chat` の URL を組む（空のクエリを付けない）。 */
export function chatHref(input: {
  readonly thread?: string | null;
  readonly threadsCursor?: string | null;
  /** 右に並べる会話（`thread` があるときだけ載せる）。 */
  readonly panes?: readonly string[];
  /** ✅ 2026-10-14: 一覧の検索語と並べ方（既定値は載せない）。 */
  readonly q?: string | null;
  readonly sort?: ChatThreadSort | null;
  /** ✅ 2026-10-16: 未読のスレッドだけ。 */
  readonly unread?: boolean;
  /** ✅ 2026-10-19: 左の列の絞り込み（`f=`）。 */
  readonly filter?: ChatListFilter | null;
  /** ✅ 2026-10-19: 右の情報欄を開く。 */
  readonly info?: boolean;
}): string {
  const params = new URLSearchParams();
  if (input.thread !== null && input.thread !== undefined) {
    params.set(CHAT_THREAD_PARAM, input.thread);
    for (const pane of input.panes ?? []) params.append(CHAT_PANE_PARAM, pane);
  }
  if (input.threadsCursor !== null && input.threadsCursor !== undefined) {
    params.set(CHAT_THREADS_CURSOR_PARAM, input.threadsCursor);
  }
  if (input.q !== null && input.q !== undefined && input.q.trim() !== '') params.set(CHAT_Q_PARAM, input.q.trim());
  if (input.sort !== null && input.sort !== undefined && input.sort !== CHAT_THREAD_SORT_DEFAULT) {
    params.set(CHAT_SORT_PARAM, input.sort);
  }
  if (input.unread === true) params.set(CHAT_UNREAD_PARAM, '1');
  const filter = input.filter === null || input.filter === undefined ? null : chatFilterValue(input.filter);
  if (filter !== null) params.set(CHAT_FILTER_PARAM, filter);
  if (input.info === true) params.set(CHAT_INFO_PARAM, '1');
  const query = params.toString();
  return query === '' ? CHAT_PATH : `${CHAT_PATH}?${query}`;
}

/** 会話の取得・投稿先（`docs/05` §6.5 #50 / #51）。🔴 画面に URL を書き写さない。 */
export function chatMessagesApiPath(threadId: string): string {
  return `/api/threads/${threadId}/messages`;
}

/** ✅ 2026-10-16: 既読・未読の API（`PUT`）。🔴 画面に URL を書き写さない。 */
/** ✅ 2026-10-23: この部屋に貼れる案件の候補（#51n）。絞り込み語が空なら付けない。 */
export function chatProjectCandidatesApiPath(threadId: string, q: string): string {
  const trimmed = q.trim();
  return trimmed === '' ? `/api/threads/${threadId}/projects` : `/api/threads/${threadId}/projects?q=${encodeURIComponent(trimmed)}`;
}

export function chatReadApiPath(threadId: string): string {
  return `/api/threads/${threadId}/read`;
}

export function chatUnreadApiPath(threadId: string): string {
  return `/api/threads/${threadId}/unread`;
}

/** ✅ 2026-10-16: リアクションの API（`POST`）。 */
export function chatReactionApiPath(threadId: string, messageId: string): string {
  return `/api/threads/${threadId}/messages/${messageId}/reactions`;
}

/** ✅ 2026-10-16: 自分の発言の編集（`PATCH`）・削除（`DELETE`）の API。 */
export function chatMessageApiPath(threadId: string, messageId: string): string {
  return `/api/threads/${threadId}/messages/${messageId}`;
}

/** ✅ 2026-10-16: ピン留め・ミュートの API（`PUT`）。 */
export function chatThreadPrefsApiPath(threadId: string): string {
  return `/api/threads/${threadId}/prefs`;
}

/** ✅ 2026-10-16: 会話の書き出し（CSV。`GET`）。 */
export function chatExportApiPath(threadId: string): string {
  return `/api/threads/${threadId}/export`;
}

/** ✅ 2026-10-19（#128）: `POST /api/threads/dm`（その人との DM を開く。無ければ作る）。 */
export const CHAT_OPEN_DM_API_PATH = '/api/threads/dm';

/** ✅ 2026-10-19（#128）: `POST /api/threads/groups`（グループを作る。作成者は自動で入る）。 */
export const CHAT_CREATE_GROUP_API_PATH = '/api/threads/groups';

/** ✅ 2026-10-19: 自分のひとこと状態（`PUT`。`docs/05` §6.5 #51j）。 */
export const CHAT_USER_STATUS_API_PATH = '/api/chat/status';

/** ✅ 2026-10-22: 発言を保存する（`PUT`）/ 保存を外す（`DELETE`）。`docs/05` §6.5 #51l。 */
export function chatSaveApiPath(threadId: string, messageId: string): string {
  return `/api/threads/${threadId}/messages/${messageId}/save`;
}

/** ✅ 2026-10-22: 自分の定型文を作る（`POST`）。`docs/05` §6.5 #51m。 */
export const CHAT_TEMPLATES_API_PATH = '/api/chat/templates';

/** ✅ 2026-10-22: 自分の定型文を直す（`PATCH`）/ 消す（`DELETE`）。 */
export function chatTemplateApiPath(templateId: string): string {
  return `/api/chat/templates/${templateId}`;
}

/** ✅ 2026-10-26: 部屋のアナウンスを読む（`GET`）/ 設定する（`PUT`）/ 外す（`DELETE`）。`docs/05` §6.5 #51o。 */
export function chatAnnouncementApiPath(threadId: string): string {
  return `/api/threads/${threadId}/announcement`;
}
