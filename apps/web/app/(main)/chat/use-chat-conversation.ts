'use client';

// apps/web/app/(main)/chat/chat-conversation.tsx
// `S-031` セクション 2「メッセージ（中央）」+ 入力欄（`docs/04` §S-031 / `F-038` / `docs/05` §6.5 #51）。
//
// ============================================================================
// 🔴 この島が守るもの
// ============================================================================
//   ① 🔴 **添付の口（ボタン）を 1 つも描かない。** `CLAUDE.md` §3.4「ウイルススキャンが `CLEAN` に
//      なるまで共有 URL を発行しない」/ §3.3「チャット添付は `ReviewGate` を通す」の配線が無い。
//      **押して何も起きない導線を作らない**（絵文字 / メンション / 書式 / 通話も同じ理由で描かない）。
//   ② 🔴 **投稿できないロールにはボタンを描かず、理由テキストを置く**（`UI_GUIDELINES` §7 / `BR-44`。
//      `disabled` で残すのは分離・権限の後退である）。
//   ③ 🔴 **二重送信を作らない** —— 押した 1 回を送信箱（`lib/chat/outbox.ts`）の 1 件にし、`createSubmitGuard` で
//      同時に送るのを 1 件に畳む。✅ 2026-10-29（F-038 ⑮）: 押したその場で「送信中」の吹き出しを出す（取り消し待ちをやめた）。
//      🔴 吹き出しは手元だけ（他の人には見えない）。正はサーバの応答で、届いたら仮の ID の吹き出しをサーバの発言に置き換える。
//   ④ ~~既読・未読を描かない~~ → ✅ 2026-10-16 に自分の既読位置（`chat_read_states`）、2026-10-19（#128）に
//      DM の相手の既読（`peerReadMessageId`）ができた。🔴 相手の既読は **DM だけ**（グループ等には渡さない）。
//   ⑤ 🔴 **接続状態インジケータ（SSE の `接続中` / `再接続中`）を描かない。** `docs/04` §S-031 は
//      これを求めているが、**`GET /api/realtime/threads/{id}`（`docs/05` §6.5 #52）が未実装**である。
//      実体の無い「接続中」を常時表示すると、**切れていないのに切れていない振りをする**ことになり、
//      §S-031 の目的（「気づかないまま返信を待つ状態を作らない」）と逆に働く。
//      **したがって出さない。** 自動更新も無いので、新着は画面の再読込で現れる。
//   ⑥ 🔴 **`@ses/db` / `@ses/i18n` を値 import しない**（`tests/static/client-db-boundary.test.ts`）。
//      型は `lib/chat/views.ts`（純粋モジュール）から、文言は props から受け取る。
//   ⑦ 🔴 **`<form>` に `method="post"` を付ける** —— 水和前の送信がブラウザの既定 GET で
//      **本文を URL に載せる**のを塞ぐ（`tests/static/form-method-required.test.ts`。実害が 1 度出ている）。
import { CHAT_MESSAGE_MAX_LENGTH } from '@ses/config';
import { useEffect, useRef, useState } from 'react';
import { applyChatFormat, insertChatMention, type ChatEdit, type ChatFormat } from '../../../lib/chat/markdown';
import { CHAT_DRAFT_EVENT, chatDraftKey, restoreUnsentText } from '../../../lib/chat/message-text';
import {
  chatTempId,
  enqueueOutbox,
  isOutboxShadowed,
  nextOutboxToSend,
  placeSentMessage,
  removeOutbox,
  requeueOutbox,
  updateOutbox,
  type ChatOutboxEntry,
  type ChatOutboxFailure,
} from '../../../lib/chat/outbox';
import { appendQuote, slashCommandRange } from '../../../lib/chat/project-card-text';
import { buildQuotedBody, chatQuoteDraft, replyMaxLength, type ChatQuoteDraft } from '../../../lib/chat/quote';
import { mentionsName } from '../../../lib/chat/mention';
import { chatReactionEmoji } from '../../../lib/chat/reactions';
import { chatMessageApiPath, chatMessagesApiPath, chatReactionApiPath, chatSaveApiPath } from '../../../lib/chat/screen-query';
import { acceptChatAttachment, uploadChatAttachment, browserFetch } from '../../../lib/chat/attachment-client';
import type { ChatAttachmentContentType } from '@ses/domain';
import { chatAnnouncementSnippet, type ChatMessageView, type ChatReactionKind, type ChatReactionSummary } from '../../../lib/chat/views';
import { createSubmitGuard } from '../../../lib/forms/submit-guard';
import type { ChatConversationProps } from './chat-conversation';
import { type ChatPickedProject } from './chat-project-picker';
import { useChatMessages } from './use-chat-messages';
import { useChatRead } from './use-chat-read';
import { useChatSearch } from './use-chat-search';

/** 開いたときに「ここから未読」の線を会話の上端からどれだけ下に置くか（直前の発言が少し見える）。 */
const UNREAD_MARKER_TOP_GAP_PX = 48;
/** ✅ 2026-10-29: 検索・一覧から移った発言を目立たせておく時間。 */
const JUMP_HIGHLIGHT_MS = 2_000;

/** ✅ 2026-10-27: 添えるファイル（送るまで手元に持つ。🔴 名前は送らない・保存しない）。 */
export type ChatPickedFile = { readonly file: File; readonly contentType: ChatAttachmentContentType };

/** ✅ 2026-10-23: 送信待ちの中身（本文と、貼る案件）。✅ 2026-10-27: 添えるファイル・引用（F-038 ⑬）。 */
export type PendingSend = {
  readonly body: string;
  readonly project: ChatPickedProject | null;
  readonly file: ChatPickedFile | null;
  readonly quote: ChatQuoteDraft | null;
};

/** 投稿の応答（`docs/05` §6.5 #51 の上位互換。`route.ts` の 🔴）。 */
type SendResponseBody = { readonly message: ChatMessageView };

/** ✅ 2026-10-29（F-038 ⑮）: 送信箱の 1 件（手元だけの「送信中」の吹き出し）。 */
export type ChatOutboxItem = ChatOutboxEntry<PendingSend>;

export function useChatConversation({
  layout = 'topic',
  threadKind,
  title,
  threadId,
  initialMessages,
  initialNextCursor,
  canPost,
  messages,
  closeHref,
  infoHref,
  infoLabel,
  lastReadMessageId = null,
  prefs,
  peerReadMessageId = null,
  ownTemplates = [],
  mentionNames = [],
  announcement: initialAnnouncement = null,
  canAttach = false,
  selfName = null,
  jumpToMessageId = null,
}: ChatConversationProps) {
  // 🔴 ガードは**インスタンスごと**に持つ（モジュール変数にすると、別のスレッドを開いた島が
  //    同じガードを共有し「前の送信が終わるまで送れない」状態になる）。
  const [sendGuard] = useState(() => createSubmitGuard<void>());
  const [items, setItems] = useState<readonly ChatMessageView[]>(initialMessages);
  /**
   * ✅ 2026-10-26（#164 の 2）: 開いている間に読めなくなった（部屋から外れた・公開が取り消された等）。
   * 🔴 一度立てたら戻さない（再び読めるかは画面の読み直しで決める）。本文・下書き・送信待ちを残さない。
   */
  const [unavailable, setUnavailable] = useState(false);
  /** ✅ 2026-10-26（#166 の 3）: この会話の列が実際に画面に見えているか（スマホで隠れた列・横スクロールの外は false）。 */
  const [onScreen, setOnScreen] = useState(true);
  const [body, setBody] = useState('');
  // ✅ 2026-10-29（F-038 ⑮）: 送信箱（押した順。🔴 `outboxRef` が正で、state は描画のため）。
  const [outbox, setOutbox] = useState<readonly ChatOutboxItem[]>([]);
  const outboxRef = useRef<readonly ChatOutboxItem[]>([]);
  const outboxSequence = useRef(0);
  /** 同じ押下・Enter の繰り返しを 1 件に畳む（次の描画まで閉じる）。 */
  const submitLock = useRef(false);
  const unavailableRef = useRef(false);
  // ✅ 2026-10-27（改訂 44）: 添えるファイルと、選んだファイルを受け付けなかったときの印。
  const [attachedFile, setAttachedFile] = useState<ChatPickedFile | null>(null);
  const [attachRejected, setAttachRejected] = useState(false);
  // ✅ 2026-10-27（F-038 ⑬）: 入力欄で選んでいる引用と、引用元へ移れなかった発言（「この発言は表示できません」を出す）。
  const [quoteDraft, setQuoteDraft] = useState<ChatQuoteDraft | null>(null);
  const [quoteMissingIds, setQuoteMissingIds] = useState<ReadonlySet<string>>(() => new Set());
  // ✅ 2026-10-14（チャットレーン）: 会話の操作の改修。
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set());
  const [awayFromLatest, setAwayFromLatest] = useState(false);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const scrollToLatestOnRender = useRef(true);
  // ✅ 2026-10-14: 新着の自動表示（`lib/chat/live.ts`）。
  const [newArrived, setNewArrived] = useState(false);
  // ✅ 2026-10-29（F-038 ⑰）: 検索・一覧から移った発言（少しの間だけ目立たせる）と、移れなかったときの一言。
  const [highlightId, setHighlightId] = useState<string | null>(null);
  const [jumpNotLoaded, setJumpNotLoaded] = useState(false);
  // ✅ 2026-10-23（紺野）: 案件を貼る。行頭の「/」で出るメニュー・案件を選ぶ小窓・貼る案件。
  const [slashRange, setSlashRange] = useState<{ readonly start: number; readonly end: number } | null>(null);
  const [slashTemplatesOpen, setSlashTemplatesOpen] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [attachedProject, setAttachedProject] = useState<ChatPickedProject | null>(null);
  // ✅ 2026-10-22: 「書く／プレビュー」と @ の候補の開閉。
  const [composeTab, setComposeTab] = useState<'write' | 'preview'>('write');
  // ✅ 2026-10-22: スマホの見出しの「…」（書き出し・ピン留め・ミュート・情報をしまう）の開閉。
  const [headerMenuOpen, setHeaderMenuOpen] = useState(false);
  const headerMenuUsed = closeHref !== undefined || canPost || prefs !== undefined;
  const [mentionOpen, setMentionOpen] = useState(false);
  // ✅ 2026-10-22: 書式ボタンの帯の開閉（既定は閉じる = 入力欄は細い 1 行）。
  const [formatOpen, setFormatOpen] = useState(false);
  const [templateOpen, setTemplateOpen] = useState(false);
  const itemsRef = useRef(items);
  const bodyRef = useRef(body);
  useEffect(() => {
    bodyRef.current = body;
  }, [body]);
  const awayRef = useRef(false);
  useEffect(() => {
    itemsRef.current = items;
  }, [items]);
  useEffect(() => {
    awayRef.current = awayFromLatest;
    if (!awayFromLatest) setNewArrived(false);
  }, [awayFromLatest]);

  // ✅ 2026-10-26（#166 の 3）: 列が見えているかを見張る。`display: none`（スマホで隠れた 2 列目以降）や
  //    横スクロールの外では交差しないので false になる。見張れない環境（テスト・古いブラウザ）では見えている扱い。
  useEffect(() => {
    const element = scrollRef.current;
    if (element === null || typeof IntersectionObserver === 'undefined') return;
    const observer = new IntersectionObserver((entries) => {
      const entry = entries[entries.length - 1];
      if (entry !== undefined) setOnScreen(entry.isIntersecting);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  /** ✅ 2026-10-26（#164 の 2）: 読めなくなった。🔴 手元の本文・下書き・送信待ち・貼る案件をすべて捨てる。 */
  function markUnavailable(): void {
    // ✅ 2026-10-26（レビュー）: 取得をその場で止める（送信の 404 から来たときも、届きかけの応答で行を戻さない）。
    stopMessages();
    unavailableRef.current = true;
    setUnavailable(true);
    setItems([]);
    itemsRef.current = [];
    setBody('');
    bodyRef.current = '';
    commitOutbox([]);
    closeSearch();
    setAttachedProject(null);
    setAttachedFile(null);
    setQuoteDraft(null);
    setEditingId(null);
    setEditText('');
    try {
      window.sessionStorage.removeItem(chatDraftKey(threadId));
      window.dispatchEvent(new Event(CHAT_DRAFT_EVENT));
    } catch {
      // 保存できない環境では何もしない。
    }
  }

  const active = onScreen && !unavailable;
  const { stopMessages, nextCursor, loadingOlder, olderFailed, loadOlder, loadOlderUntil, announcement, setAnnouncement,
    announcementNotLoaded, setAnnouncementNotLoaded, announcementFailed, changeAnnouncement } = useChatMessages({
    threadId, initialNextCursor, itemsRef, awayRef, scrollToLatestOnRender,
    setItems, setNewArrived, initialAnnouncement, active, onUnavailable: markUnavailable,
  });

  const { searchOpen, searchQuery, setSearchQuery, searchResult, toggleSearch, closeSearch } = useChatSearch({
    threadId,
    onUnavailable: markUnavailable,
  });
  const composeId = `chat-compose-body-${threadId}`;

  // 開いたとき・自分が送ったときは一番下（最新）を見せる。🔴 過去を読み込んだとき（上に足す）は動かさない。
  // ✅ 2026-10-22（紺野「会話の途中から表示されるようにしないと」）: **開いたときに未読があれば「ここから未読」の線を
  //    会話の上の方に出す**（読んでいない最初の発言から読める）。未読が無ければ従来どおり最新。
  const openedOnce = useRef(false);
  useEffect(() => {
    if (!scrollToLatestOnRender.current) return;
    scrollToLatestOnRender.current = false;
    const element = scrollRef.current;
    if (element === null) return;
    const first = !openedOnce.current;
    openedOnce.current = true;
    const marker = first ? element.querySelector('[data-testid="chat-unread-marker"]') : null;
    if (marker !== null) {
      const offset = marker.getBoundingClientRect().top - element.getBoundingClientRect().top;
      element.scrollTop += offset - UNREAD_MARKER_TOP_GAP_PX;
      return;
    }
    element.scrollTop = element.scrollHeight;
  }, [items]);

  // 下書き（🔴 `sessionStorage` = タブを閉じたら消える。`lib/chat/message-text.ts` の `chatDraftKey`）。
  useEffect(() => {
    try {
      const draft = window.sessionStorage.getItem(chatDraftKey(threadId));
      if (draft !== null && draft !== '') setBody((current) => (current === '' ? draft : current));
    } catch {
      // 保存領域が使えない環境（プライベートブラウズ等）では下書きを持たない。
    }
  }, [threadId]);

  // ✅ 2026-10-22: `@名前` の候補 = 渡された部屋のメンバー + この会話に出てきた送信者（自分は除く）。
  const mentionCandidates = [
    ...new Set([
      ...mentionNames,
      ...items.filter((item) => !item.mine && item.senderName !== null).map((item) => item.senderName as string),
    ]),
  ];

  function composeTextarea(): HTMLTextAreaElement | null {
    const element = document.getElementById(composeId);
    return element instanceof HTMLTextAreaElement ? element : null;
  }

  /** 書式ボタン・@ の結果を入力欄に戻し、選択位置を置き直す。 */
  function applyComposeEdit(edit: ChatEdit): void {
    updateBody(edit.text.slice(0, CHAT_MESSAGE_MAX_LENGTH));
    setComposeTab('write');
    window.requestAnimationFrame(() => {
      const element = composeTextarea();
      if (element === null) return;
      element.focus();
      element.setSelectionRange(edit.selectionStart, edit.selectionEnd);
    });
  }

  function formatCompose(format: ChatFormat): void {
    const element = composeTextarea();
    const start = element?.selectionStart ?? body.length;
    const end = element?.selectionEnd ?? body.length;
    applyComposeEdit(applyChatFormat(body, start, end, format));
  }

  function mentionCompose(name: string): void {
    const element = composeTextarea();
    const start = element?.selectionStart ?? body.length;
    const end = element?.selectionEnd ?? body.length;
    setMentionOpen(false);
    applyComposeEdit(insertChatMention(body, start, end, name));
  }

  /** ✅ 2026-10-23: 入力が変わるたびに、行頭の「/」のメニューを出すかを決める。 */
  function trackSlash(value: string, caret: number): void {
    const range = slashCommandRange(value, caret);
    setSlashRange(range);
    if (range === null) setSlashTemplatesOpen(false);
  }

  /** 行頭の「/…」を取り除いて、メニューを閉じる。 */
  function consumeSlash(): string {
    const range = slashRange;
    setSlashRange(null);
    setSlashTemplatesOpen(false);
    if (range === null) return body;
    const next = body.slice(0, range.start) + body.slice(range.end);
    updateBody(next);
    return next;
  }

  /** 「/」→「定型文」で選んだ文面を入れる（行頭の「/」を消してから）。 */
  function insertTemplateFromSlash(text: string): void {
    const rest = consumeSlash();
    updateBody(rest === '' ? text : `${rest.trimEnd()}\n${text}`);
    composeTextarea()?.focus();
  }

  /** ✅ 2026-10-27: ファイルを選んだ（種類・大きさを確かめる。受け付けなければ添えずに理由を出す）。 */
  function pickFile(file: File | null): void {
    if (file === null) return;
    const contentType = acceptChatAttachment(file);
    if (contentType === null) {
      setAttachRejected(true);
      return;
    }
    setAttachRejected(false);
    setAttachedFile({ file, contentType });
  }

  /** ✅ 2026-10-23: 案件カードの「条件を引用」。入力欄の末尾に引用を足す。 */
  function quoteIntoCompose(quote: string): void {
    const next = appendQuote(bodyRef.current, quote).slice(0, CHAT_MESSAGE_MAX_LENGTH);
    applyComposeEdit({ text: next, selectionStart: next.length, selectionEnd: next.length });
  }

  function updateBody(value: string): void {
    setBody(value);
    bodyRef.current = value;
    writeDraft(value);
  }

  /**
   * 下書き（`sessionStorage`）を書く。✅ 2026-10-29: 入力欄が空なら、まだ届いていない送信箱の本文を残す
   * （読み込み直すと「送信中」「送れませんでした」の吹き出しは消えるので、文章を失わないように）。
   */
  function writeDraft(value: string): void {
    const kept = value !== '' ? value : (outboxRef.current.find((entry) => entry.payload.body !== '')?.payload.body ?? '');
    try {
      if (kept === '') window.sessionStorage.removeItem(chatDraftKey(threadId));
      else window.sessionStorage.setItem(chatDraftKey(threadId), kept);
    } catch {
      // 同上。
    }
    // ✅ 2026-10-16: 一覧の「下書き」の印に知らせる（同じタブには `storage` イベントが届かない）。
    window.dispatchEvent(new Event(CHAT_DRAFT_EVENT));
  }

  function commitOutbox(next: readonly ChatOutboxItem[]): void {
    outboxRef.current = next;
    setOutbox(next);
  }

  // キーボードの近道: Cmd / Ctrl + K でスレッド一覧の検索欄へ（一覧に検索欄があるときだけ）。
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        const search = document.getElementById('chat-threads-q');
        if (search !== null) {
          event.preventDefault();
          search.focus();
        }
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, []);
  // ✅ 2026-10-16（提案 H）: 開いた後に届いた発言（新着・送信・過去の読み込み）を、ふわっと出す。
  //    🔴 動きは opacity だけ・既定の 150ms（`docs/04` §7.9）。最初から在る発言には付けない
  //       （サーバで描く markup に opacity が混ざらない。render テスト ②）。動きを減らす設定の人には動かさない。
  const initialIds = useRef(new Set(initialMessages.map((message) => message.id)));
  const [arrivedIds, setArrivedIds] = useState<ReadonlySet<string>>(() => new Set());
  useEffect(() => {
    const entering = items.filter((item) => !initialIds.current.has(item.id) && !arrivedIds.has(item.id)).map((item) => item.id);
    if (entering.length === 0) return;
    const frame = window.requestAnimationFrame(() => setArrivedIds((current) => new Set([...current, ...entering])));
    return () => window.cancelAnimationFrame(frame);
  }, [items, arrivedIds]);
  function fadeClass(id: string): string | null {
    if (initialIds.current.has(id)) return null;
    return arrivedIds.has(id) ? 'opacity-100 transition-opacity motion-reduce:transition-none' : 'opacity-0 transition-opacity motion-reduce:transition-none';
  }

  async function copyBody(item: ChatMessageView): Promise<void> {
    if (item.body === null) return;
    try {
      await navigator.clipboard.writeText(item.body);
      setCopiedId(item.id);
      window.setTimeout(() => setCopiedId((current) => (current === item.id ? null : current)), 2000);
    } catch {
      // クリップボードが使えない環境では何もしない（本文は選択してコピーできる）。
    }
  }

  const { markerId, readReceiptId, markUnread } = useChatRead({
    initialMessages, lastReadMessageId, items, peerReadMessageId, awayFromLatest, threadId, active,
  });

  // ✅ 2026-10-16: リアクションを付ける / 外す。🔴 手元で先に書き換えない（サーバの応答だけが正）。
  async function toggleReaction(item: ChatMessageView, reaction: ChatReactionKind): Promise<void> {
    try {
      const response = await fetch(chatReactionApiPath(threadId, item.id), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ reaction }),
      });
      if (!response.ok) return;
      const payload = (await response.json()) as { readonly reactions: readonly ChatReactionSummary[] };
      setItems((current) => current.map((entry) => (entry.id === item.id ? { ...entry, reactions: payload.reactions } : entry)));
    } catch {
      // 付けられなければ何も変えない（次の新着の取得で正しい状態に揃う）。
    }
  }

  // ✅ 2026-10-22: 発言を保存する / 保存を外す（本人だけの栞）。🔴 手元で先に書き換えない（サーバの応答だけが正）。
  async function toggleSaved(item: ChatMessageView): Promise<void> {
    try {
      const response = await fetch(chatSaveApiPath(threadId, item.id), { method: item.saved === true ? 'DELETE' : 'PUT' });
      if (!response.ok) return;
      const payload = (await response.json()) as { readonly saved: boolean };
      setItems((current) => current.map((entry) => (entry.id === item.id ? { ...entry, saved: payload.saved } : entry)));
    } catch {
      // 保存できなければ何も変えない（次の新着の取得で正しい状態に揃う）。
    }
  }

  // ✅ 2026-10-16: 自分の発言の編集・削除（送った本人だけ。API も本人以外は 404）。
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editText, setEditText] = useState('');
  const [editFailed, setEditFailed] = useState(false);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  // ✅ 2026-10-16（紺野）: 発言の操作は、マウスが乗っている発言にだけ出す。
  //    🔴 `group-hover:` は画面に書けない（`tests/static/ui-state-in-primitives.test.ts` (j)。押し心地の 8 状態は
  //       `packages/ui` が持つ）。ここで決めているのは「どの発言の操作を出すか」であって、押し心地ではない。
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  // ✅ 2026-10-22: リアクションの選択（絵文字 12 種 + 語 4 種）を開いている発言。
  const [reactionPickerId, setReactionPickerId] = useState<string | null>(null);
  /** 付いたリアクションの表示（絵文字は絵文字で、語は語で）。 */
  function reactionText(kind: ChatReactionKind, count: number): string {
    return `${chatReactionEmoji(kind) ?? messages.reactions[kind]} ${String(count)}`;
  }
  /**
   * ✅ 2026-10-22（紺野「スマホ版おわってる」）: 指で発言を押したら、その発言の操作を出す（もう一度押すと閉じる）。
   * 🔴 マウスの機器では何もしない（カーソルを当てれば出る）。リンク・ボタンなどを押したときも何もしない。
   */
  function selectOnTouch(event: { readonly target: EventTarget | null }, id: string): void {
    if (typeof window === 'undefined' || !window.matchMedia('(pointer: coarse)').matches) return;
    if (event.target instanceof Element && event.target.closest('a,button,select,textarea,input,label') !== null) return;
    setHoveredId((current) => (current === id ? null : id));
  }
  // 🔴 キーボードで操作している間は全部の発言の操作を出す（見えない操作にはキーボードで移れないため）。
  //    Tab を押したら入り、マウスを押したら抜ける。
  const [keyboardNav, setKeyboardNav] = useState(false);
  useEffect(() => {
    // 🔴 画面のどこから Tab で入ってきても効くよう、window で聞く。
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Tab') setKeyboardNav(true);
    };
    const onPointer = () => setKeyboardNav(false);
    window.addEventListener('keydown', onKey);
    window.addEventListener('pointerdown', onPointer);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('pointerdown', onPointer);
    };
  }, []);

  function replaceItem(next: ChatMessageView): void {
    setItems((current) => current.map((entry) => (entry.id === next.id ? next : entry)));
    // ✅ 2026-10-26: アナウンスにしている発言を直した・消したら、帯の本文も揃える（消したら本文を出さない）。
    setAnnouncement((current) =>
      current === null || current.messageId !== next.id
        ? current
        : { ...current, snippet: next.deleted === true ? null : chatAnnouncementSnippet(next.body) },
    );
  }

  /**
   * ✅ 2026-10-26: 帯を押したら、その発言へ移る。🔴 読み込み済みのときだけ動かし、読み込んでいなければ「いつの発言か」を出す
   * （過去を勝手に読み込み続けない。読み込みは「以前のメッセージを読み込む」に任せる）。
   */
  async function jumpToAnnouncement(): Promise<void> {
    if (announcement === null) return;
    const found = await jumpToMessage(announcement.messageId);
    setAnnouncementNotLoaded(!found);
  }

  /**
   * この部屋の発言へ移る（アナウンスの帯・引用元）。移れたら `true`。
   * 🔴 探すのは**開いているこの部屋の中だけ**（`loadOlderUntil` はこの部屋の過去を読むだけ。ほかの部屋を読みに行かない）。
   */
  async function jumpToMessage(targetId: string): Promise<boolean> {
    const scrollToTarget = (): boolean => {
      const element = scrollRef.current?.querySelector(`[data-testid="chat-message-${targetId}"]`);
      if (!(element instanceof HTMLElement)) return false;
      element.scrollIntoView({ block: 'center' });
      return true;
    };
    if (items.some((item) => item.id === targetId) && scrollToTarget()) return true;
    // ✅ 2026-10-26（#166 の 8）: 読み込んでいない古い発言なら、そこまで過去を続けて読んでから移る。
    if (await loadOlderUntil(targetId)) {
      // 足した行が描かれてから移る。
      return new Promise((resolve) => {
        window.requestAnimationFrame(() => resolve(scrollToTarget()));
      });
    }
    return false;
  }

  /**
   * ✅ 2026-10-27（F-038 ⑬）: 引用元へ移る。移れなければ、その引用の中に「この発言は表示できません」を出す
   * （消えた・この部屋に無い・読めない を区別しない）。
   */
  async function jumpToQuoted(fromMessageId: string, targetId: string): Promise<void> {
    const found = await jumpToMessage(targetId);
    setQuoteMissingIds((current) => {
      const next = new Set(current);
      if (found) next.delete(fromMessageId);
      else next.add(fromMessageId);
      return next;
    });
  }

  /**
   * ✅ 2026-10-29（F-038 ⑰）: 検索の結果・一覧の「本文で見つかった発言」からこの部屋の発言へ移り、少しの間だけ目立たせる。
   * 🔴 探すのはこの部屋の中だけ（`jumpToMessage`）。移れなければ一言出す（消えた・遠すぎる・読めないを区別しない）。
   */
  async function jumpAndHighlight(targetId: string): Promise<void> {
    const found = await jumpToMessage(targetId);
    setJumpNotLoaded(!found);
    if (!found) return;
    setHighlightId(targetId);
    window.setTimeout(() => setHighlightId((current) => (current === targetId ? null : current)), JUMP_HIGHLIGHT_MS);
  }

  // ✅ 2026-10-29: 一覧の「本文で見つかった発言」から開いた（`?msg=`）。開いた直後の位置決め（上の効果）の後に移る。
  //    同じ部屋のまま別の発言を選び直したとき（`msg` だけが変わる）も移る。同じ発言へは 1 度だけ。
  const jumpedFor = useRef<string | null>(null);
  useEffect(() => {
    if (jumpToMessageId === null || jumpedFor.current === jumpToMessageId) return;
    jumpedFor.current = jumpToMessageId;
    window.requestAnimationFrame(() => void jumpAndHighlight(jumpToMessageId));
    // 移る先が変わったときだけ動かす（`jumpAndHighlight` は描画ごとに作り直される）。
  }, [jumpToMessageId]);

  /** ✅ 2026-10-27（F-038 ⑬）: この発言を引用して入力欄に札を出す（送った時点の写し）。 */
  function quoteMessage(item: ChatMessageView): void {
    if (!canPost || item.body === null || item.deleted === true) return;
    setQuoteDraft(
      chatQuoteDraft({ id: item.id, senderName: item.senderName ?? (item.mine ? selfName : null), body: item.body }, messages.unknownName),
    );
    setComposeTab('write');
    window.requestAnimationFrame(() => composeTextarea()?.focus());
  }

  /** ✅ 2026-10-27（F-038 ⑭）: 自分宛ての `@` を含む相手の発言か（左の線を引く）。判定はサーバの印と同じ関数。 */
  function mentionsMe(item: ChatMessageView): boolean {
    return !item.mine && item.deleted !== true && mentionsName(item.body, selfName);
  }

  /** 返信に書ける文字数（引用を選んでいれば、その分を引く）。 */
  const composeMaxLength = replyMaxLength(CHAT_MESSAGE_MAX_LENGTH, quoteDraft);

  async function saveEdit(item: ChatMessageView): Promise<void> {
    const trimmed = editText.trim();
    if (trimmed === '') return;
    setEditFailed(false);
    try {
      const response = await fetch(chatMessageApiPath(threadId, item.id), {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ body: trimmed }),
      });
      if (!response.ok) {
        setEditFailed(true);
        return;
      }
      replaceItem(((await response.json()) as SendResponseBody).message);
      setEditingId(null);
    } catch {
      setEditFailed(true);
    }
  }

  async function removeMessage(item: ChatMessageView): Promise<void> {
    setConfirmDeleteId(null);
    try {
      const response = await fetch(chatMessageApiPath(threadId, item.id), { method: 'DELETE' });
      if (response.ok) replaceItem(((await response.json()) as SendResponseBody).message);
    } catch {
      // 消せなければ何も変えない（次の新着の取得で正しい状態に揃う）。
    }
  }

  function toggleExpanded(id: string): void {
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function scrollToLatest(): void {
    const element = scrollRef.current;
    if (element !== null) element.scrollTop = element.scrollHeight;
  }

  /**
   * 送る。✅ 2026-10-29（F-038 ⑮）: **押したその場で**送信箱に入れて「送信中」の吹き出しを出し、すぐに送る（取り消し待ちをやめた）。
   * 🔴 下書き（`sessionStorage`）は届くまで消さない —— 画面を離れても文章が失われない（`writeDraft`）。
   */
  function submit(): void {
    const trimmed = bodyRef.current.trim();
    const file = canAttach ? attachedFile : null;
    // ✅ 2026-10-23: 案件を貼っていれば本文は空でも送れる（カードだけの発言）。
    if (!canPost || unavailableRef.current || submitLock.current || (trimmed === '' && attachedProject === null && file === null)) return;
    submitLock.current = true;
    window.requestAnimationFrame(() => {
      submitLock.current = false;
    });
    const payload: PendingSend = { body: trimmed, project: attachedProject, file, quote: trimmed === '' ? null : quoteDraft };
    outboxSequence.current += 1;
    commitOutbox(
      enqueueOutbox(outboxRef.current, {
        tempId: chatTempId(outboxSequence.current, Date.now()),
        // ✅ 2026-10-27（F-038 ⑬）: 引用は本文の頭に決まった形で置く（`lib/chat/quote.ts`）。
        text: payload.quote === null ? trimmed : buildQuotedBody(payload.quote, trimmed),
        items: itemsRef.current,
        payload,
      }),
    );
    setBody('');
    bodyRef.current = '';
    writeDraft('');
    setAttachedProject(null);
    setAttachedFile(null);
    if (payload.quote !== null) setQuoteDraft(null);
    setSlashRange(null);
    setPickerOpen(false);
    scrollToLatestOnRender.current = true;
    void pumpOutbox();
  }

  /** 送信箱の次の 1 件を送る（🔴 同時に送るのは 1 件だけ。押した順に会話へ並ぶ）。 */
  async function pumpOutbox(): Promise<void> {
    if (unavailableRef.current) return;
    const entry = nextOutboxToSend(outboxRef.current);
    if (entry === null) return;
    const ran = await sendGuard.run(() => deliver(entry));
    if (ran !== null) void pumpOutbox();
  }

  /** 送れなかった発言をもう一度送る（貼れない案件で断られた発言は送り直させない）。 */
  function resendOutbox(tempId: string): void {
    const next = requeueOutbox(outboxRef.current, tempId);
    if (next === outboxRef.current) return;
    commitOutbox(next);
    void pumpOutbox();
  }

  /** 送れなかった発言を取り消す（文章・案件・ファイル・引用を入力欄に戻す）。 */
  function discardOutbox(tempId: string): void {
    const entry = outboxRef.current.find((candidate) => candidate.tempId === tempId);
    if (entry === undefined || entry.status !== 'FAILED') return;
    commitOutbox(removeOutbox(outboxRef.current, tempId));
    // ✅ 2026-10-26（#166 の 6）: 🔴 その後に書いた次の文章を上書きしない（両方残す）。
    updateBody(restoreUnsentText(entry.payload.body, bodyRef.current));
    // ✅ 2026-10-23: 🔴 「貼れない案件」だったときだけは戻さない（同じ失敗を繰り返さない）。
    if (entry.failure !== 'PROJECT' && entry.payload.project !== null) setAttachedProject((current) => current ?? entry.payload.project);
    if (entry.payload.file !== null) setAttachedFile((current) => current ?? entry.payload.file);
    if (entry.payload.quote !== null) setQuoteDraft((current) => current ?? entry.payload.quote);
    window.requestAnimationFrame(() => composeTextarea()?.focus());
  }

  async function deliver(entry: ChatOutboxItem): Promise<void> {
    const { tempId, payload, text } = entry;
    commitOutbox(updateOutbox(outboxRef.current, tempId, payload.file === null ? 'SENDING' : 'UPLOADING'));
    const outcome = await (async (): Promise<{ readonly sent: ChatMessageView } | 'MISSING' | ChatOutboxFailure> => {
      try {
        // ✅ 2026-10-27: ファイルがあれば先に置いて札を受け取る（#51p → ストレージ）。置けなければ送らない。
        let attachmentUploadToken: string | null = null;
        if (payload.file !== null) {
          const uploaded = await uploadChatAttachment(
            { threadId, contentType: payload.file.contentType, body: payload.file.file },
            { fetch: browserFetch },
          );
          if (!uploaded.ok) return uploaded.reason === 'MISSING' ? 'MISSING' : 'ATTACHMENT';
          attachmentUploadToken = uploaded.uploadToken;
          commitOutbox(updateOutbox(outboxRef.current, tempId, 'SENDING'));
        }
        const response = await fetch(chatMessagesApiPath(threadId), {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            body: text,
            ...(payload.project === null ? {} : { projectId: payload.project.id }),
            ...(attachmentUploadToken === null ? {} : { attachmentUploadToken }),
          }),
        });
        // ✅ 2026-10-27: 添付つきで断られた（部屋が変わった・札の期限切れなど）。
        if (attachmentUploadToken !== null && (response.status === 400 || response.status === 409)) return 'ATTACHMENT';
        // 🔴 404 = スレッドが見えなくなった（不存在・退出・他社化を区別しない。`docs/05` §4.8）。
        if (response.status === 404) return 'MISSING';
        // ✅ 2026-10-23: 400 で `body.projectId` = この部屋に貼れない案件（理由はサーバが書き分けない）。
        if (response.status === 400 && payload.project !== null) {
          const failure = (await response.json().catch(() => null)) as { readonly error?: { readonly details?: readonly string[] } } | null;
          if (failure?.error?.details?.includes('body.projectId') === true) return 'PROJECT';
        }
        if (!response.ok) return 'FAILED';
        return { sent: ((await response.json()) as SendResponseBody).message };
      } catch {
        return 'FAILED';
      }
    })();
    if (unavailableRef.current) return;
    // ✅ 2026-10-26（#164 の 2）: 🔴 送ろうとして 404 = 読めなくなった。手元の吹き出し・文章も含めて画面から消す。
    if (outcome === 'MISSING') {
      markUnavailable();
      return;
    }
    if (typeof outcome === 'string') {
      // 🔴 送れなかった発言は吹き出しに残す（「再送」「取り消す」。文章は取り消すと入力欄に戻る）。
      commitOutbox(updateOutbox(outboxRef.current, tempId, 'FAILED', outcome));
      writeDraft(bodyRef.current);
      return;
    }
    // 🔴 正はサーバの応答。仮の吹き出しを外し、サーバの発言を置く（新着の取得が先に持ってきていても 1 行）。
    scrollToLatestOnRender.current = true;
    setItems((current) => placeSentMessage(current, outcome.sent));
    commitOutbox(removeOutbox(outboxRef.current, tempId));
    // 下書きは届いた時点で消す（入力欄に次の文章・まだ届いていない発言があれば、そちらを残す）。
    writeDraft(bodyRef.current);
  }

  /** 描く送信箱（🔴 新着の取得が応答より先に同じ発言を持ってきたものは隠す = 二重に見せない）。 */
  const visibleOutbox = outbox.filter((entry) => !isOutboxShadowed(entry, items));

  return {
    unavailable,
    layout,
    threadKind,
    title,
    threadId,
    canPost,
    messages,
    closeHref,
    infoHref,
    infoLabel,
    prefs,
    ownTemplates,
    mentionNames,
    items,
    nextCursor,
    body,
    outbox: visibleOutbox,
    resendOutbox,
    discardOutbox,
    loadingOlder,
    olderFailed,
    copiedId,
    expanded,
    awayFromLatest,
    setAwayFromLatest,
    scrollRef,
    newArrived,
    slashRange,
    setSlashRange,
    slashTemplatesOpen,
    setSlashTemplatesOpen,
    pickerOpen,
    setPickerOpen,
    attachedProject,
    setAttachedProject,
    canAttach,
    attachedFile,
    setAttachedFile,
    attachRejected,
    pickFile,
    composeTab,
    setComposeTab,
    headerMenuOpen,
    setHeaderMenuOpen,
    headerMenuUsed,
    mentionOpen,
    setMentionOpen,
    formatOpen,
    setFormatOpen,
    templateOpen,
    setTemplateOpen,
    announcement,
    announcementNotLoaded,
    announcementFailed,
    composeId,
    mentionCandidates,
    composeTextarea,
    formatCompose,
    mentionCompose,
    trackSlash,
    consumeSlash,
    insertTemplateFromSlash,
    quoteIntoCompose,
    updateBody,
    fadeClass,
    copyBody,
    markerId,
    readReceiptId,
    toggleReaction,
    toggleSaved,
    editingId,
    setEditingId,
    editText,
    setEditText,
    editFailed,
    setEditFailed,
    confirmDeleteId,
    setConfirmDeleteId,
    hoveredId,
    setHoveredId,
    reactionPickerId,
    setReactionPickerId,
    reactionText,
    selectOnTouch,
    keyboardNav,
    changeAnnouncement,
    jumpToAnnouncement,
    quoteDraft,
    setQuoteDraft,
    quoteMissingIds,
    quoteMessage,
    jumpToQuoted,
    mentionsMe,
    composeMaxLength,
    saveEdit,
    removeMessage,
    markUnread,
    toggleExpanded,
    scrollToLatest,
    submit,
    loadOlder,
    selfName,
    highlightId,
    jumpNotLoaded,
    jumpAndHighlight,
    searchOpen,
    searchQuery,
    setSearchQuery,
    searchResult,
    toggleSearch,
    closeSearch,
  };
}

export type ChatConversationState = ReturnType<typeof useChatConversation>;
