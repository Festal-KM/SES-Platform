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
//   ③ 🔴 **二重送信を作らない** —— `createSubmitGuard` で実行を 1 回に畳み、送信中はボタンを
//      送信中表示に置き換える（`docs/04` の共通規律）。
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
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import {
  Alert,
  Avatar,
  Button,
  CHAT_BUBBLE_MAX_WIDTH_CLASS,
  CHAT_COMPOSER_HEIGHT_CLASS,
  EmptyState,
  Field,
  HEADER_HEIGHT_CLASS,
  Icon,
  IconButton,
  SECONDARY_LINK_CLASSES,
  Select,
  Textarea,
  cn,
} from '@ses/ui';
import { CHAT_MESSAGE_MAX_LENGTH } from '@ses/config';
import { createSubmitGuard } from '../../../lib/forms/submit-guard';
import { formatDateTimeJst } from '../../../lib/format/datetime';
import { displayInitials } from '../../../lib/format/initials';
import {
  chatExportApiPath,
  chatHref,
  chatMessageApiPath,
  chatMessagesApiPath,
  chatReactionApiPath,
  chatReadApiPath,
  chatSaveApiPath,
  chatUnreadApiPath,
} from '../../../lib/chat/screen-query';
import {
  CHAT_REACTION_EMOJI_KINDS,
  CHAT_REACTION_WORD_KINDS,
  type ChatMessageView,
  type ChatReactionKind,
  type ChatReactionSummary,
} from '../../../lib/chat/views';
import type { ChatConversationMessages } from './chat-props';
import { ChatThreadPrefsToggle } from './chat-thread-prefs-toggle';
import { Dialog } from '@ses/ui/client';
import { formatChatTime, withDaySeparators } from '../../../lib/chat/day-separators';
import {
  CHAT_DRAFT_EVENT,
  chatDraftKey,
  collapsedMessageText,
  isAwayFromLatest,
  isLongMessage,
  remainingChars,
} from '../../../lib/chat/message-text';
import { CHAT_FORMATS, applyChatFormat, insertChatMention, type ChatEdit, type ChatFormat } from '../../../lib/chat/markdown';
import { ChatMessageMarkdown } from './chat-message-markdown';
import { ChatProjectCard } from './chat-project-card';
import { ChatProjectPicker, type ChatPickedProject } from './chat-project-picker';
import { appendQuote, slashCommandRange } from '../../../lib/chat/project-card-text';
import { CHAT_REACTION_EMOJI, chatReactionEmoji } from '../../../lib/chat/reactions';
import {
  CHAT_POLL_INTERVAL_MS,
  CHAT_UNDO_SEND_MS,
  hasOthersMessage,
  mergeLatestMessages,
  withLatestReactions,
} from '../../../lib/chat/live';
import { unreadMarkerId, withUnreadMarker } from '../../../lib/chat/unread-marker';
import { readReceiptMessageId } from '../../../lib/chat/read-receipt';
import {
  isSendKey,
  type ChatConversationLayout,
  type ChatConversationTitle,
} from '../../../lib/chat/layout';

/**
 * ✅ 2026-10-22: ひとこと状態の札（名前の続きに見えないよう、薄い面の札にする（角は Badge と同じ `rounded-xs`。円はアバターとカウンタだけ））。
 * 🔴 どの部屋でも同じ形（会話の見出し・発言の名前の横）。長い状態は 1 行で切る。
 */
const STATUS_CHIP_CLASSES = 'truncate rounded-xs bg-bg-inset px-1 text-xs text-fg-muted';

/** 開いたときに「ここから未読」の線を会話の上端からどれだけ下に置くか（直前の発言が少し見える）。 */
const UNREAD_MARKER_TOP_GAP_PX = 48;

export type ChatConversationProps = {
  /**
   * 会話の見出し（Lark の会話ヘッダ。`lib/chat/layout.ts` の `conversationTitleFor`）。
   * 省略時・名前が読めないときは既定の見出し（`messages.heading`）を出す。
   */
  readonly title?: ChatConversationTitle;
  /**
   * 並べ方（2026-10-13、Lark 寄せ。`lib/chat/layout.ts`）。案件スレッド = `topic`（全員左寄せ）/
   * 企業スレッド = `chat`（自分は右）。省略時は `topic`（従来の表示）。
   */
  readonly layout?: ChatConversationLayout;
  readonly threadId: string;
  /** 直近 50 件（古い順。`lib/chat/read.ts` が並べ替えて渡す）。 */
  readonly initialMessages: readonly ChatMessageView[];
  /** 🔴 **さらに過去**のカーソル。無ければ `null`。 */
  readonly initialNextCursor: string | null;
  /** 🔴 拒否の本体は API の `requireRole` / `requireNotViewer` であり、ここは導線の出し分けである。 */
  readonly canPost: boolean;
  readonly messages: ChatConversationMessages;
  /**
   * ✅ 2026-10-14（チャットレーン）: 会話を並べて開いているときの「閉じる」の行き先
   * （`lib/chat/panes.ts` の `withPaneClosed` で組んだ URL）。並べていなければ省略（描かない）。
   */
  readonly closeHref?: string;
  /**
   * ✅ 2026-10-16: 開いた時点の既読位置（`chat_read_states`。無ければ `null`）。
   * 「ここから未読」の線をこの後ろの最初の相手の発言に引く。線は開いている間は動かさない（Slack と同じ）。
   */
  readonly lastReadMessageId?: string | null;
  /** ✅ 2026-10-16: 自分のピン留め・ミュート（見出しの切り替えボタン）。省略時は出さない。 */
  readonly prefs?: { readonly pinned: boolean; readonly muted: boolean };
  /** ✅ 2026-10-19（v2）: 右の情報欄を開く・閉じる行き先と語。省略時は出さない。 */
  readonly infoHref?: string;
  readonly infoLabel?: string;
  /**
   * ✅ 2026-10-19（#128）: DM の相手が最後に読んだ発言（`readChatScreen` の `peerReadMessageIds`）。
   * 🔴 **DM のときだけ渡す**（グループ・会社グループ・スレッドでは省略する = 「既読」を出さない）。
   */
  readonly peerReadMessageId?: string | null;
  /**
   * ✅ 2026-10-22（紺野「自分だけ」）: 自分の定型文（`chat_message_templates`。本人の行だけ）。入力欄の「定型文を選ぶ」に固定の文面と並べる。
   */
  readonly ownTemplates?: readonly { readonly id: string; readonly label: string; readonly body: string }[];
  /**
   * ✅ 2026-10-22: `@名前` の候補（DM・グループのメンバー）。会話に出てきた送信者の名前は部品の中で足す。
   * 🔴 名前だけ（利用者 ID を島に渡さない）。
   */
  readonly mentionNames?: readonly string[];
};

/** ✅ 2026-10-22: 定型文の選択肢の値。自分の定型文と固定の文面の ID がぶつからないよう頭を分ける。 */
const OWN_TEMPLATE_PREFIX = 'own:';
const MANAGE_TEMPLATES_VALUE = 'manage';

/** ✅ 2026-10-23: 送信待ちの中身（本文と、貼る案件）。 */
type PendingSend = { readonly body: string; readonly project: ChatPickedProject | null };

/** 投稿の応答（`docs/05` §6.5 #51 の上位互換。`route.ts` の 🔴）。 */
type SendResponseBody = { readonly message: ChatMessageView };
/** 会話の取得（#50）。 */
type MessagePageBody = { readonly items: readonly ChatMessageView[]; readonly nextCursor: string | null };

export function ChatConversation({
  layout = 'topic',
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
}: ChatConversationProps) {
  // 🔴 ガードは**インスタンスごと**に持つ（モジュール変数にすると、別のスレッドを開いた島が
  //    同じガードを共有し「前の送信が終わるまで送れない」状態になる）。
  const [sendGuard] = useState(() => createSubmitGuard<'SENT' | 'MISSING' | 'FAILED' | 'PROJECT'>());
  const [olderGuard] = useState(() => createSubmitGuard<'LOADED' | 'FAILED'>());
  const [items, setItems] = useState<readonly ChatMessageView[]>(initialMessages);
  const [nextCursor, setNextCursor] = useState<string | null>(initialNextCursor);
  const [body, setBody] = useState('');
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<'NONE' | 'FAILED' | 'MISSING' | 'PROJECT'>('NONE');
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [olderFailed, setOlderFailed] = useState(false);
  // ✅ 2026-10-14（チャットレーン）: 会話の操作の改修。
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set());
  const [awayFromLatest, setAwayFromLatest] = useState(false);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const scrollToLatestOnRender = useRef(true);
  // ✅ 2026-10-14: 新着の自動表示（`lib/chat/live.ts`）と送信の取り消し。
  const [newArrived, setNewArrived] = useState(false);
  const [pendingSend, setPendingSend] = useState<PendingSend | null>(null);
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
  const pendingTimer = useRef<number | null>(null);
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

  // 新着を取りに行く。🔴 既存の API（#50）を呼ぶだけ（境界は API の RLS が決める）。画面が見えているときだけ。
  //    🔴 手元の行は置き換えない（過去を読み込んだ分・送った分を消さない）。
  useEffect(() => {
    let active = true;
    const poll = async (): Promise<void> => {
      if (document.visibilityState !== 'visible') return;
      try {
        const response = await fetch(chatMessagesApiPath(threadId), { cache: 'no-store' });
        if (!active || !response.ok) return;
        const payload = (await response.json()) as MessagePageBody;
        // ✅ 2026-10-16: 手元の発言のリアクションも取り直した値に揃える。
        const refreshed = withLatestReactions(itemsRef.current, payload.items);
        const merged = mergeLatestMessages(refreshed, payload.items);
        if (merged.added.length === 0) {
          if (refreshed !== itemsRef.current) setItems(refreshed);
          return;
        }
        if (awayRef.current) {
          if (hasOthersMessage(merged.added)) setNewArrived(true);
        } else {
          scrollToLatestOnRender.current = true;
        }
        setItems(merged.items);
      } catch {
        // 取れなければ次の回に任せる（画面は再読込でも最新になる）。
      }
    };
    const timer = window.setInterval(() => void poll(), CHAT_POLL_INTERVAL_MS);
    const onVisible = (): void => {
      if (document.visibilityState === 'visible') void poll();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      active = false;
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [threadId]);

  // 待っている送信は、画面を離れたら取りやめる（🔴 下書きは送れるまで消さないので、戻れば文章は残っている）。
  useEffect(
    () => () => {
      if (pendingTimer.current !== null) window.clearTimeout(pendingTimer.current);
    },
    [],
  );
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

  /** ✅ 2026-10-23: 案件カードの「条件を引用」。入力欄の末尾に引用を足す。 */
  function quoteIntoCompose(quote: string): void {
    const next = appendQuote(bodyRef.current, quote).slice(0, CHAT_MESSAGE_MAX_LENGTH);
    applyComposeEdit({ text: next, selectionStart: next.length, selectionEnd: next.length });
  }

  function updateBody(value: string): void {
    setBody(value);
    try {
      if (value === '') window.sessionStorage.removeItem(chatDraftKey(threadId));
      else window.sessionStorage.setItem(chatDraftKey(threadId), value);
    } catch {
      // 同上。
    }
    // ✅ 2026-10-16: 一覧の「下書き」の印に知らせる（同じタブには `storage` イベントが届かない）。
    window.dispatchEvent(new Event(CHAT_DRAFT_EVENT));
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

  // ✅ 2026-10-16: 既読・未読（`lib/chat/read-state.ts` / `unread-marker.ts`）。
  //    線は開いた時点で決め、読んでも動かさない。「ここから未読にする」を押したらその発言へ動かす。
  const [markerId, setMarkerId] = useState<string | null>(() => unreadMarkerId(initialMessages, lastReadMessageId));
  const lastMarkedRef = useRef<string | null>(lastReadMessageId);
  // ✅ 2026-10-19（#128）: DM の「既読」は、相手が最後に読んだ位置にある自分の発言 1 件の下だけ。
  const readReceiptId = readReceiptMessageId(items, peerReadMessageId);
  // 「未読にする」を押した会話では、自動で既読に戻さない（押した意味が消えるため）。
  const suppressAutoReadRef = useRef(false);

  // 一番下（最新）が見えていて、画面が見えているときは、最新の発言まで既読にする。
  // 🔴 既読は戻す方向に動かない（API 側でも守る）。送れなくても次の機会に任せる（画面は壊さない）。
  useEffect(() => {
    const latest = items.at(-1);
    if (latest === undefined || awayFromLatest || suppressAutoReadRef.current) return;
    if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return;
    if (lastMarkedRef.current === latest.id) return;
    lastMarkedRef.current = latest.id;
    void fetch(chatReadApiPath(threadId), {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ upToMessageId: latest.id }),
    }).catch(() => {
      lastMarkedRef.current = null;
    });
  }, [items, awayFromLatest, threadId]);

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
  }

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

  async function markUnread(item: ChatMessageView): Promise<void> {
    suppressAutoReadRef.current = true;
    setMarkerId(item.id);
    try {
      await fetch(chatUnreadApiPath(threadId), {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ fromMessageId: item.id }),
      });
    } catch {
      // 送れなければ次の再読込で元の状態に戻る（画面の線は押した位置のまま）。
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
   * 吹き出しと、その下の操作（続きを読む・コピー）。🔴 自分 / 相手の吹き出しの差は**面の色だけ**
   * （render テストの ④）なので、色は呼び出し側が渡す。
   */
  function renderBody(item: ChatMessageView, surfaceClass: 'bg-brand-bg' | 'bg-bg-subtle') {
    const text = item.body;
    const long = text !== null && isLongMessage(text);
    const open = expanded.has(item.id);
    const shown = text === null ? null : long && !open ? collapsedMessageText(text) : text;
    if (editingId === item.id) {
      return (
        <div className="flex w-full flex-col gap-2" data-testid={`chat-message-editing-${item.id}`}>
          <label className="sr-only" htmlFor={`chat-edit-${item.id}`}>
            {messages.edit}
          </label>
          <Textarea
            id={`chat-edit-${item.id}`}
            value={editText}
            maxLength={CHAT_MESSAGE_MAX_LENGTH}
            className="min-h-12 max-h-40 overflow-y-auto overscroll-contain"
            onChange={(event) => setEditText(event.target.value)}
          />
          {editFailed ? <Alert variant="danger">{messages.editFailed}</Alert> : null}
          <div className="flex gap-2">
            <Button type="button" variant="primary" size="sm" onClick={() => void saveEdit(item)} data-testid={`chat-message-save-${item.id}`}>
              {messages.save}
            </Button>
            <Button type="button" variant="ghost" size="sm" onClick={() => setEditingId(null)}>
              {messages.cancel}
            </Button>
          </div>
        </div>
      );
    }
    return (
      <>
        {/* ✅ 2026-10-22: 本文は書式つきで描く（`chat-message-markdown.tsx`。HTML は通さない）。段落・箇条書きを入れるので `div`。
            ✅ 2026-10-23: 案件カードだけの発言（本文が空）は吹き出しを描かない。 */}
        {text === '' ? null : (
        <div
          className={cn(
            'm-0 flex w-fit flex-col gap-2 rounded-lg px-4 py-2 text-body break-words text-fg',
            CHAT_BUBBLE_MAX_WIDTH_CLASS,
            surfaceClass,
          )}
          data-testid={`chat-message-body-${item.id}`}
        >
          {shown === null ? (
            item.deleted === true ? (
              messages.deleted
            ) : (
              messages.purged
            )
          ) : (
            <ChatMessageMarkdown text={shown} messageId={item.id} mentionNames={mentionCandidates} />
          )}
        </div>
        )}
        {/* ✅ 2026-10-23（紺野）: 貼られた案件のカード。🔴 見る人の権限で読み直した値（読めなければ「表示できません」だけ）。 */}
        {item.attachedProject == null ? null : (
          <ChatProjectCard
            messageId={item.id}
            project={item.attachedProject}
            labels={messages.projectCard}
            {...(canPost ? { onQuote: quoteIntoCompose } : {})}
          />
        )}
        {text === null ? null : (item.reactions ?? []).length > 0 || item.edited === true || item.saved === true ? (
          // ✅ 2026-10-16: 付いているリアクションの数と「編集済み」は**常に見せる**（中身の一部なので隠さない）。
          <div className="flex flex-wrap items-center gap-2" data-testid={`chat-message-info-${item.id}`}>
            {item.edited === true ? <span className="text-xs text-fg-placeholder">{messages.edited}</span> : null}
            {/* ✅ 2026-10-22: 自分が保存した発言の印（本人にだけ見える）。 */}
            {item.saved === true ? (
              <span className="text-xs text-fg-muted" data-testid={`chat-message-saved-${item.id}`}>
                {messages.bookmarked}
              </span>
            ) : null}
            {/* ✅ 2026-10-16: リアクション（件数と自分が付けたか）。投稿できる人は押して付け外しでき、
                閲覧専用には件数だけを文字で出す（押せないボタンを描かない）。 */}
            {(item.reactions ?? []).map((summary) =>
              canPost ? (
                <Button
                  key={summary.reaction}
                  type="button"
                  variant={summary.mine ? 'secondary' : 'ghost'}
                  size="sm"
                  aria-pressed={summary.mine}
                  aria-label={`${messages.reactions[summary.reaction]} ${String(summary.count)}`}
                  onClick={() => void toggleReaction(item, summary.reaction)}
                  data-testid={`chat-message-reaction-${item.id}-${summary.reaction}`}
                >
                  {reactionText(summary.reaction, summary.count)}
                </Button>
              ) : (
                <span key={summary.reaction} className="text-xs text-fg-muted" data-testid={`chat-message-reaction-${item.id}-${summary.reaction}`}>
                  {reactionText(summary.reaction, summary.count)}
                </span>
              ),
            )}
          </div>
        ) : null}
        {/* ✅ 2026-10-22: 「続きを読む」は操作の並びから出して常に見せる（スマホでは操作の並びを隠すため）。 */}
        {text !== null && long ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="w-fit"
            onClick={() => toggleExpanded(item.id)}
            aria-expanded={open}
            data-testid={`chat-message-expand-${item.id}`}
          >
            {open ? messages.readLess : messages.readMore}
          </Button>
        ) : null}
        {text === null ? null : (
          // ✅ 2026-10-16（紺野）: 発言の操作は**カーソルを当てたときだけ**出す（常に出ていて煩雑だった）。
          // ✅ 2026-10-22（紺野「スマホ版おわってる」）: スマホ（指）では**発言を押した（長押しした）ときだけ**出す
          //    （LINE と同じ）。押していない発言の操作は場所も取らない（`pointer-coarse:hidden`）。
          //    🔴 マウスの機器（`pointer-fine`）だけで隠す。スマホ（指）にはカーソルが無いので**常に出す**。
          //    🔴 キーボードで操作している間（`keyboardNav`）と、削除の確認中も出す。
          //    🔴 `opacity` で隠さない（render テストの ②）。`invisible` は場所を取ったまま見えなくするだけで、
          //       カーソルを当てても行がずれない。
          <div
            role="group"
            aria-label={messages.messageActions}
            className={cn(
              'flex flex-wrap items-center gap-2',
              keyboardNav
                ? null
                : hoveredId === item.id || confirmDeleteId === item.id || reactionPickerId === item.id
                  ? // ✅ 2026-10-22（Teams・Slack の参考）: マウスの機器では発言の右上に浮かべる（場所を取らない = 発言の間が空かない）。
                    //    指の機器では従来どおり発言の下に並べる。
                    'pointer-fine:absolute pointer-fine:-top-4 pointer-fine:right-0 pointer-fine:z-10 pointer-fine:gap-1 pointer-fine:rounded-md pointer-fine:border pointer-fine:border-border pointer-fine:bg-bg pointer-fine:px-1'
                  : 'hidden',
            )}
            data-testid={`chat-message-actions-${item.id}`}
          >
            {/* ✅ 2026-10-16: 自分の発言の編集・削除（投稿できる人だけ）。
                ✅ 2026-10-20（紺野「モーダル」）: 削除の確認はモーダル（`Dialog`）で出す（下の `ChatDeleteDialog`）。 */}
            {canPost && item.mine ? (
                <>
                  <IconButton type="button" variant="ghost" onClick={() => {
                    setEditingId(item.id);
                    setEditText(item.body ?? '');
                    setEditFailed(false);
                  }} data-testid={`chat-message-edit-${item.id}`}
                    aria-label={messages.edit}
                    className="h-11 w-11"
                    title={messages.edit} icon={<Icon name="chat-edit" />} />
                  <IconButton type="button" variant="ghost" onClick={() => setConfirmDeleteId(item.id)} data-testid={`chat-message-delete-${item.id}`}
                    aria-label={messages.remove}
                    className="h-11 w-11"
                    title={messages.remove} icon={<Icon name="chat-delete" />} />
                </>
            ) : null}
            {/* ✅ 2026-10-22（紺野「リアクションのスタンプとかもちゃんと入れて」）: 選択欄をやめ、押すと絵文字 12 種と語 4 種が並ぶ。
                絵文字は読み上げ名（`aria-label`）を持つ。 */}
            {canPost ? (
              <IconButton
                type="button"
                variant={reactionPickerId === item.id ? 'secondary' : 'ghost'}
                aria-expanded={reactionPickerId === item.id}
                aria-controls={`chat-reaction-picker-${item.id}`}
                onClick={() => setReactionPickerId((current) => (current === item.id ? null : item.id))}
                data-testid={`chat-message-reaction-add-${item.id}`}
                aria-label={messages.reactionAdd}
                className="h-11 w-11"
                title={messages.reactionAdd} icon={<Icon name="chat-reaction" />} />
            ) : null}
            {canPost && reactionPickerId === item.id ? (
              <div
                id={`chat-reaction-picker-${item.id}`}
                role="group"
                aria-label={messages.reactionAdd}
                className="flex w-full flex-wrap items-center gap-1 rounded-md border border-border bg-bg p-1"
                data-testid={`chat-message-reaction-picker-${item.id}`}
              >
                {CHAT_REACTION_EMOJI_KINDS.map((kind) => (
                  <IconButton
                    key={kind}
                    type="button"
                    variant="ghost"
                    icon={<span className="text-lg">{CHAT_REACTION_EMOJI[kind]}</span>}
                    aria-label={messages.reactions[kind]}
                    title={messages.reactions[kind]}
                    onClick={() => {
                      setReactionPickerId(null);
                      void toggleReaction(item, kind);
                    }}
                    data-testid={`chat-message-reaction-pick-${item.id}-${kind}`}
                  />
                ))}
                {CHAT_REACTION_WORD_KINDS.map((kind) => (
                  <Button
                    key={kind}
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      setReactionPickerId(null);
                      void toggleReaction(item, kind);
                    }}
                    data-testid={`chat-message-reaction-pick-${item.id}-${kind}`}
                  >
                    {messages.reactions[kind]}
                  </Button>
                ))}
              </div>
            ) : null}
            {/* ✅ 2026-10-22（紺野）: 保存 / 保存を外す（本人だけの栞。左の列の「保存済み」に集まる）。 */}
            {canPost ? (
              <IconButton
                type="button"
                variant={item.saved === true ? 'secondary' : 'ghost'}
                aria-pressed={item.saved === true}
                onClick={() => void toggleSaved(item)}
                data-testid={`chat-message-bookmark-${item.id}`}
                aria-label={item.saved === true ? messages.unbookmark : messages.bookmark}
                className="h-11 w-11"
                title={item.saved === true ? messages.unbookmark : messages.bookmark} icon={<Icon name="chat-bookmark" />} />
            ) : null}
            {/* ✅ 2026-10-16: 相手の発言から未読にする（自分の発言は未読にならない）。 */}
            {item.mine ? null : (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="min-h-11"
                onClick={() => void markUnread(item)}
                data-testid={`chat-message-mark-unread-${item.id}`}
              >
                {messages.markUnread}
              </Button>
            )}
            {text === '' ? null : (
              <IconButton
                type="button"
                variant="ghost"
                onClick={() => void copyBody(item)}
                data-testid={`chat-message-copy-${item.id}`}
                aria-label={copiedId === item.id ? messages.copied : messages.copy}
                className="h-11 w-11"
                title={copiedId === item.id ? messages.copied : messages.copy} icon={<Icon name="chat-copy" />} />
            )}
          </div>
        )}
      </>
    );
  }

  /**
   * 送信を予約する。✅ 2026-10-14: **押してから `CHAT_UNDO_SEND_MS` 待ってから送る**（その間は取り消せる）。
   * 🔴 待っている間に下書き（`sessionStorage`）は消さない —— 画面を離れても文章が失われない。
   */
  function submit(): void {
    const trimmed = body.trim();
    // ✅ 2026-10-23: 案件を貼っていれば本文は空でも送れる（カードだけの発言）。
    if (!canPost || (trimmed === '' && attachedProject === null) || sending || pendingSend !== null) return;
    const next: PendingSend = { body: trimmed, project: attachedProject };
    setSendError('NONE');
    setPendingSend(next);
    setBody('');
    setAttachedProject(null);
    setSlashRange(null);
    setPickerOpen(false);
    pendingTimer.current = window.setTimeout(() => {
      pendingTimer.current = null;
      void deliver(next);
    }, CHAT_UNDO_SEND_MS);
  }

  /** 送信の取り消し（文章を入力欄に戻す）。 */
  function undoSend(): void {
    if (pendingTimer.current !== null) window.clearTimeout(pendingTimer.current);
    pendingTimer.current = null;
    if (pendingSend !== null) {
      setBody(pendingSend.body);
      setAttachedProject(pendingSend.project);
    }
    setPendingSend(null);
    document.getElementById(composeId)?.focus();
  }

  /** 待たずに今すぐ送る。 */
  function sendNow(): void {
    if (pendingSend === null) return;
    if (pendingTimer.current !== null) window.clearTimeout(pendingTimer.current);
    pendingTimer.current = null;
    void deliver(pendingSend);
  }

  async function deliver(pending: PendingSend): Promise<void> {
    const trimmed = pending.body;
    setPendingSend(null);
    setSending(true);
    setSendError('NONE');
    const outcome = await sendGuard.run(async () => {
      try {
        const response = await fetch(chatMessagesApiPath(threadId), {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(pending.project === null ? { body: trimmed } : { body: trimmed, projectId: pending.project.id }),
        });
        // 🔴 404 = スレッドが見えなくなった（不存在・退出・他社化を区別しない。`docs/05` §4.8）。
        if (response.status === 404) return 'MISSING' as const;
        // ✅ 2026-10-23: 400 で `body.projectId` = この部屋に貼れない案件（理由はサーバが書き分けない）。
        if (response.status === 400 && pending.project !== null) {
          const failure = (await response.json().catch(() => null)) as { readonly error?: { readonly details?: readonly string[] } } | null;
          if (failure?.error?.details?.includes('body.projectId') === true) return 'PROJECT' as const;
        }
        if (!response.ok) return 'FAILED' as const;
        const payload = (await response.json()) as SendResponseBody;
        // 🔴 手元で先に書き換える楽観更新をしない（サーバの応答だけが正。`S-015` の ⑦ と同じ規律）。
        scrollToLatestOnRender.current = true;
        setItems((current) => mergeLatestMessages(current, [payload.message]).items);
        // 下書きは送れた時点で消す（待っている間に次の文章を書き始めていたら、そちらを残す）。
        if (bodyRef.current === '') updateBody('');
        return 'SENT' as const;
      } catch {
        return 'FAILED' as const;
      }
    });
    setSending(false);
    // 🔴 送れなかった文章は入力欄に戻す（再送・修正ができるように）。
    if (outcome !== 'SENT' && bodyRef.current === '') setBody(trimmed);
    // ✅ 2026-10-23: 貼る案件も戻す。🔴 「貼れない案件」だったときだけは戻さない（同じ失敗を繰り返さない）。
    if (outcome !== 'SENT' && outcome !== 'PROJECT' && pending.project !== null) setAttachedProject((current) => current ?? pending.project);
    if (outcome === 'MISSING') setSendError('MISSING');
    else if (outcome === 'FAILED') setSendError('FAILED');
    else if (outcome === 'PROJECT') setSendError('PROJECT');
  }

  async function loadOlder(): Promise<void> {
    if (nextCursor === null || loadingOlder) return;
    setLoadingOlder(true);
    setOlderFailed(false);
    const outcome = await olderGuard.run(async () => {
      try {
        const response = await fetch(
          `${chatMessagesApiPath(threadId)}?cursor=${encodeURIComponent(nextCursor)}`,
          {
            cache: 'no-store',
          },
        );
        if (!response.ok) return 'FAILED' as const;
        const payload = (await response.json()) as MessagePageBody;
        // 🔴 取得済みの**上**に足す（置き換えない）。同じ行が再び来たら 1 行に畳む。
        setItems((current) => {
          const seen = new Set(current.map((item) => item.id));
          return [...payload.items.filter((item) => !seen.has(item.id)), ...current];
        });
        setNextCursor(payload.nextCursor);
        return 'LOADED' as const;
      } catch {
        return 'FAILED' as const;
      }
    });
    setLoadingOlder(false);
    if (outcome === 'FAILED') setOlderFailed(true);
  }

  return (
    // ✅ **2026-10-13（`docs/design-system.md` §4.5）: ヘッダ 56 / 本文 / コンポーザー 64 の
    //    3 段にした。** 本文だけが伸び縮みし、上下 2 段は動かない。
    <section data-testid="chat-conversation" data-thread-id={threadId} className="flex min-h-0 flex-1 flex-col">
      {/* ✅ 2026-10-22（紺野「スマホ版おわってる」）: スマホでは「‹ 戻る」と名前だけを出し、書き出し・ピン留め・ミュート・情報は
          「…」の中にしまう（横幅を取り合って「一覧へ戻る」が縦 1 文字ずつに潰れていた）。`md` 以上は従来どおり横に並べる。
          🔴 操作は 1 つずつしか描かない（スマホとパソコンで 2 回描くと目印が重複する）。並べ方だけをクラスで変える。 */}
      <div className={`relative flex shrink-0 items-center gap-3 border-b border-border px-3 md:gap-4 md:px-5 ${HEADER_HEIGHT_CLASS}`}>
        {/* 🔴 モバイルは「一覧 → 会話」の 2 画面遷移（`docs/04` §S-031 デバイス別）。戻り道を必ず置く。 */}
        <Link
          href={chatHref({})}
          aria-label={messages.backToList}
          title={messages.backToList}
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-md text-fg md:hidden"
          data-testid="chat-back-to-list"
        >
          <Icon name="chat-back" />
        </Link>
        {/* ✅ 2026-10-13（Lark 寄せ）: 見出しに会話の相手（案件スレッドは案件名 + 相手の会社名）を出す。
            🔴 名前が読めなければ既定の見出しに戻す（空の見出しを作らない）。 */}
        <div className="flex min-w-0 flex-1 items-baseline gap-2">
          <h2 className="m-0 truncate text-row font-medium text-fg" data-testid="chat-conversation-title">
            {title?.title ?? messages.heading}
          </h2>
          {title?.title != null && title.subtitle !== null ? (
            <span className="hidden truncate text-xs text-fg-muted md:inline" data-testid="chat-conversation-subtitle">
              {title.subtitle}
            </span>
          ) : null}
          {/* ✅ 2026-10-19（#128 §7.1 ①）: DM の相手のひとこと状態（名前の横）。 */}
          {title?.title != null && title.status != null && title.status !== '' ? (
            <span className={STATUS_CHIP_CLASSES} data-testid="chat-conversation-status">
              {title.status}
            </span>
          ) : null}
        </div>
        {/* ✅ 2026-10-14: 並べて開いているときだけ「閉じる」を置く（`md` 以上。モバイルは 1 列の切替のまま）。
            ✅ 2026-10-26: 並べているときに操作を「…」にしまっても、「閉じる」だけは外に出したままにする（すぐ押せるように）。 */}
        {closeHref === undefined ? null : (
          <Link
            href={closeHref}
            // 🔴 `cn` は後勝ち。共通の語（`inline-block` を含む）を先に置き、`hidden` が消されないようにする。
            className={cn(SECONDARY_LINK_CLASSES, 'hidden shrink-0 text-xs md:inline-block')}
            data-testid={`chat-pane-close-${threadId}`}
          >
            {messages.closePane}
          </Link>
        )}
        {/* スマホだけの「…」。押すと下の操作の並びが縦に開く。
            🔴 閲覧専用（書き出し・ピン留めが無い）には「…」を出さず、残る操作（情報）をそのまま並べる。 */}
        {headerMenuUsed ? (
        <IconButton
          type="button"
          variant="ghost"
          className={cn("min-h-11 min-w-11 shrink-0", closeHref === undefined ? "md:hidden" : null)}
          aria-label={messages.headerMenu}
          aria-expanded={headerMenuOpen}
          aria-controls={`chat-header-actions-${threadId}`}
          onClick={() => setHeaderMenuOpen((open) => !open)}
          data-testid={`chat-header-menu-${threadId}`}

          title={messages.headerMenu} icon={<Icon name="chat-more" />} />
        ) : null}
        <div
          id={`chat-header-actions-${threadId}`}
          className={cn(
            !headerMenuUsed ? 'flex items-center' : headerMenuOpen ? 'flex' : 'hidden',
            'absolute top-full right-2 z-10 flex-col items-stretch gap-1 rounded-md border border-border-strong bg-bg p-2',
            closeHref === undefined ? 'md:static md:z-auto md:flex md:flex-row md:items-center md:justify-end md:gap-4 md:border-0 md:bg-transparent md:p-0' : null,
          )}
          data-testid={`chat-header-actions-${threadId}`}
        >
          {/* ✅ 2026-10-16: 会話の書き出し（CSV）。🔴 閲覧専用には出さない（ダウンロード不可。API も 403）。 */}
          {canPost ? (
            <a
              href={chatExportApiPath(threadId)}
              download
              aria-label={messages.exportLink}
              title={messages.exportLink}
              className={cn(SECONDARY_LINK_CLASSES, 'inline-flex min-h-11 min-w-11 shrink-0 items-center justify-center')}
              data-testid={`chat-thread-export-${threadId}`}
            >
              <Icon name="chat-export" /><span className="sr-only">{messages.exportLink}</span>
            </a>
          ) : null}
          {/* ✅ 2026-10-16: ピン留め・ミュート（自分の表示の設定）。 */}
          {prefs === undefined ? null : (
            <ChatThreadPrefsToggle
              threadId={threadId}
              prefs={prefs}
              labels={{ pin: messages.pin, unpin: messages.unpin, mute: messages.mute, unmute: messages.unmute }}
            />
          )}
          {infoHref === undefined || infoLabel === undefined ? null : (
            <Link
              href={infoHref}
              aria-label={infoLabel}
              title={infoLabel}
              className={cn(SECONDARY_LINK_CLASSES, 'inline-flex min-h-11 min-w-11 shrink-0 items-center justify-center')}
              data-testid={`chat-thread-info-${threadId}`}
            >
              <Icon name="chat-info" /><span className="sr-only">{infoLabel}</span>
            </Link>
          )}
        </div>
      </div>

      {/* 🔴 本文の面。**下寄せ**（最新の発言がコンポーザーの直上に来る。定義書 §3.12）。
          ✅ 2026-10-14: 上へ読み進めたら右下に「最新のメッセージへ」を出す。 */}
      <div className="relative flex min-h-0 flex-1 flex-col">
      <div
        ref={scrollRef}
        onScroll={(event) => setAwayFromLatest(isAwayFromLatest(event.currentTarget))}
        className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto overscroll-contain px-5 py-3"
        data-testid="chat-messages-scroll"
      >
        {/* ✅ 2026-10-22: 発言が少ないときに下へ寄せる詰め物。🔴 `justify-end` を使わない —— 中身が枠からあふれると
            上側がスクロールで届かなくなる（flexbox の既知の挙動）。会話の枠の中だけでスクロールするようにしたので効いてくる。 */}
        <div aria-hidden="true" className="mt-auto" />
        {nextCursor === null ? null : (
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={() => void loadOlder()}
            data-testid="chat-messages-older"
          >
            {loadingOlder ? messages.olderLoading : messages.older}
          </Button>
        )}
        {olderFailed ? (
          <Alert variant="danger" data-testid="chat-messages-older-error">
            {messages.olderFailed}
          </Alert>
        ) : null}
        {items.length === 0 ? (
          <EmptyState description={canPost ? messages.firstMessage : messages.empty} testIdPrefix="chat-messages-empty-" />
        ) : (
          <ol
            aria-label={messages.listLabel}
            // ✅ 2026-10-22（Teams の参考）: 発言どうしの間隔を詰める。同じ人の続きは 4px、別の人の発言の前だけ 12px 空ける（li の mt）。
            className="m-0 flex list-none flex-col gap-1 p-0"
            data-testid="chat-messages"
            onMouseLeave={() => setHoveredId(null)}
          >
            {withUnreadMarker(withDaySeparators(items), markerId).map((entry) => {
              // ✅ 2026-10-16: 「ここから未読」の線。
              if (entry.kind === 'unread') {
                return (
                  <li key="unread-marker" className="flex items-center gap-3" data-testid="chat-unread-marker">
                    <span aria-hidden="true" className="h-px flex-1 bg-brand" />
                    <span className="text-xs font-medium text-brand">{messages.unreadFrom}</span>
                    <span aria-hidden="true" className="h-px flex-1 bg-brand" />
                  </li>
                );
              }
              // ✅ 2026-10-13: **日付の区切り**（定義書 §3.12「中央・24h の pill・地 `bg-subtle`・12」）。
              // 🔴 JST の暦日が変わる位置にだけ置く（`lib/chat/day-separators.ts`）。並び順は変えない。
              // 🔴 radius は `rounded-md` —— `rounded-full` はアバターとカウンタにしか使えない
              //    （`tests/static/design-tokens.test.ts` / `docs/04` §7.9）。
              if (entry.kind === 'day') {
                return (
                  <li
                    key={`day-${entry.day}`}
                    // ✅ 2026-10-14: 読み進めても、いま読んでいる日付が上端に残る。
                    className="sticky top-0 z-10 flex justify-center"
                    data-testid={`chat-day-separator-${entry.day}`}
                  >
                    <time dateTime={entry.day} className="rounded-md bg-bg-subtle px-3 py-1 text-xs text-fg-muted">
                      {entry.day}
                    </time>
                  </li>
                );
              }
              const item = entry.message;
              // ✅ 2026-10-13（Lark 寄せ）: 時刻は `HH:MM` だけを出し（日付は区切りが受け持つ）、
              //    日付つきの完全な時刻は `title`（ホバー）と `dateTime` に残す。
              const time = (
                <time
                  dateTime={item.sentAt}
                  title={formatDateTimeJst(item.sentAt)}
                  className="text-xs text-fg-placeholder"
                >
                  {formatChatTime(item.sentAt)}
                </time>
              );
              // ✅ 2026-10-13（Lark 寄せ）: **同じ人の連続した発言（5 分以内）は名前とアバターを省く**
              //    （`entry.continued`。`lib/chat/day-separators.ts`）。🔴 名前が読めない発言はまとめない。
              const continued = entry.continued;
              // ✅ 2026-10-13（Lark 寄せ。`lib/chat/layout.ts`）: **企業スレッド（会話型）の自分の発言は
              //    右に置く。** 名前とアバターは出さない（自分であることは位置で分かる）。
              //    読み上げには「自社」を残す（位置は目でしか分からないため）。
              // 🔴 参加会社は常に 2 社なので、左右の 2 方向で表しきれる（下の「右寄せにしない」の理由は
              //    案件スレッド＝話題型にだけ残る）。
              // ✅ 2026-10-14（チャット担当の決定）: **右に寄せるのは自分の発言だけ**（`item.mine`）。
              //    同僚（同じ会社の別の人）の発言は `own` でも左に置き、名前を出す（Lark と同じ見え方）。
              if (layout === 'chat' && item.mine) {
                return (
                  <li
                    key={item.id}
                    data-testid={`chat-message-${item.id}`}
                    data-own="true"
                    data-layout="chat"
                    data-continued={continued ? 'true' : 'false'}
                    className={cn('relative flex flex-col items-end gap-1', continued ? null : 'mt-3', fadeClass(item.id))}
                    onMouseEnter={() => setHoveredId(item.id)}
                    onClick={(event) => selectOnTouch(event, item.id)}
                  >
                    {continued ? (
                      <span className="sr-only">{messages.own}</span>
                    ) : (
                      <p className="m-0 flex items-baseline gap-2">
                        <span className="sr-only">{messages.own}</span>
                        {time}
                      </p>
                    )}
                    {renderBody(item, 'bg-brand-bg')}
                    {readReceiptId === item.id ? (
                      <span className="text-xs text-fg-muted" data-testid={`chat-message-read-${item.id}`}>
                        {messages.read}
                      </span>
                    ) : null}
                  </li>
                );
              }
              return (
              // 🔴 ✅ **2026-10-13: 全員を左に寄せる**（デザインシステム v1.0 §3.12「全員左寄せ・
              //    Slack 型」）。自社と相手の弁別は**バブルの地の色だけ**である。
              // 🔴 **右寄せにしない** —— 誰の発言かを「位置」で表すと、参加会社が 3 社以上に
              //    なったときに表しようがなくなる。名前と色なら素直に伸びる。
              // 🔴 **器（カード）をやめた** —— 1 件ずつに枠が付いていると、会話ではなく
              //    「カードの一覧」に見える（面の数が増えるほど、どこを読めばよいか分からなくなる）。
              <li
                key={item.id}
                data-testid={`chat-message-${item.id}`}
                data-own={item.own ? 'true' : 'false'}
                data-continued={continued ? 'true' : 'false'}
                className={cn('relative flex gap-3', continued ? null : 'mt-3', fadeClass(item.id))}
                onMouseEnter={() => setHoveredId(item.id)}
                onClick={(event) => selectOnTouch(event, item.id)}
              >
                {/* 🔴 続きの発言はアバターを出さず、幅だけ残す（本文の左端をそろえる）。
                    ✅ 2026-10-22: 見えないアバターで高さまで取っていたので、幅だけの詰め物にした（続きの行が詰まる）。 */}
                {continued ? (
                  <span aria-hidden="true" className="w-9 shrink-0" />
                ) : (
                  <Avatar
                    size="md"
                    initials={displayInitials(item.senderName ?? item.senderCompanyName ?? '?')}
                    title={item.senderName ?? messages.unknownName}
                  />
                )}
                <div className="flex min-w-0 flex-1 flex-col gap-1">
                  {continued ? (
                    // 🔴 読み上げでは誰の発言かを残す（見た目だけ省く）。
                    <span className="sr-only">{item.senderName ?? messages.unknownName}</span>
                  ) : (
                    <p className="m-0 flex flex-wrap items-baseline gap-2">
                      <span className="text-body font-bold text-fg" data-testid={`chat-message-sender-${item.id}`}>
                        {item.senderName ?? messages.unknownName}
                      </span>
                      <span className="text-xs text-fg-muted">
                        {item.senderCompanyName ?? messages.unknownName}
                      </span>
                      {item.own ? <span className="text-xs text-fg-muted">{messages.own}</span> : null}
                      {/* ✅ 2026-10-22（紺野「自分が入ってるチャットにも共通で表示しないと」）: 送信者の今のひとこと状態。
                          🔴 どの部屋でも同じ札（DM の見出し・会社グループ・スレッド・グループ）。読めるかは RLS が決める。 */}
                      {item.senderStatus == null || item.senderStatus === '' ? null : (
                        <span className={STATUS_CHIP_CLASSES} data-testid={`chat-message-status-${item.id}`}>
                          {item.senderStatus}
                        </span>
                      )}
                      {time}
                    </p>
                  )}
                  {/* 🔴 本文は `PURGED` / 保持期間削除で消える（`F-064 AC-2`）。空にせず事実を書く。
                      🔴 上限幅（560）は `packages/ui` の定数から取る —— `max-w-*` は画面に書けない
                         （`ui-screen-width.test.ts` (c)）。**読める行長の規約**であり、画面ごとに
                         決め直すものではない。 */}
                  {renderBody(item, item.own ? 'bg-brand-bg' : 'bg-bg-subtle')}
                  {readReceiptId === item.id ? (
                    <span className="text-xs text-fg-muted" data-testid={`chat-message-read-${item.id}`}>
                      {messages.read}
                    </span>
                  ) : null}
                </div>
              </li>
              );
            })}
          </ol>
        )}
      </div>
        {awayFromLatest ? (
          <div className="absolute right-5 bottom-3">
            <Button type="button" variant="secondary" size="sm" onClick={scrollToLatest} data-testid="chat-messages-to-latest">
              {newArrived ? messages.newArrived : messages.toLatest}
            </Button>
          </div>
        ) : null}
      </div>

      {/* 🔴 コンポーザー（64）。会話の下端に固定され、本文だけがその上で伸び縮みする。 */}
      {canPost ? (
        // 🔴 `method="post"` は水和前の送信を URL に載せないための壁である（上の ⑦）。
        <form
          method="post"
          action={chatMessagesApiPath(threadId)}
          onSubmit={(event) => {
            event.preventDefault();
            submit();
          }}
          // ✅ 2026-10-16（提案 I）: スマホでは画面ごとスクロールするので、入力欄を下端に貼り付ける（読み進めても書ける）。
          //    `md` 以上は器の高さが決まっているので、貼り付けても位置は変わらない。地の色は重なりの下を隠すため。
          className={`sticky bottom-0 shrink-0 border-t border-border bg-bg px-5 py-3 ${CHAT_COMPOSER_HEIGHT_CLASS}`}
          data-testid="chat-compose"
        >
          {/* ✅ 2026-10-22（紺野「こういうチャット枠が必要だよね」= GitHub のコメント欄）:
              上に「書く／プレビュー」と書式ボタン、下に入力欄。
              ✅ 2026-10-26（改訂 43）: 下段の印と送信も同じ枠に収め、入力に合わせて高さを伸ばす。
              🔴 書式は Markdown の一部だけ（`lib/chat/markdown.ts`）。HTML は通さない。 */}
          {/* 🔴 `as="div"`: 枠の中にボタンがあるので `<label>` で包まない（ラベルが最初のボタンに結び付く）。入力欄は `aria-label` で名付ける。 */}
          {/* ✅ 2026-10-22（紺野「スマホ版おわってる」・Teams の参考）: 入力欄は**普段は細い 1 行**。書式ボタンと「書く／プレビュー」は
              下の「書式」を押したときだけ出す（スマホで入力欄が画面の半分を占めていた）。見出し「メッセージ」は読み上げ用だけにした。 */}
          <Field as="div" label={messages.composeLabel} labelClassName="sr-only">
            <div className="flex flex-col rounded-md border border-border-strong bg-bg" data-testid="chat-compose-box">
              {formatOpen ? (
              <div className="flex flex-wrap items-center gap-1 border-b border-border bg-bg-subtle px-2 py-1">
                <Button
                  type="button"
                  // 開いている方を塗る（どちらを見ているかを形で分ける）。
                  variant={composeTab === 'write' ? 'secondary' : 'ghost'}
                  size="sm"
                  aria-pressed={composeTab === 'write'}
                  onClick={() => setComposeTab('write')}
                  data-testid="chat-compose-tab-write"
                >
                  {messages.composeWrite}
                </Button>
                <Button
                  type="button"
                  // 開いている方を塗る（どちらを見ているかを形で分ける）。
                  variant={composeTab === 'preview' ? 'secondary' : 'ghost'}
                  size="sm"
                  aria-pressed={composeTab === 'preview'}
                  onClick={() => {
                    setMentionOpen(false);
                    setComposeTab('preview');
                  }}
                  data-testid="chat-compose-tab-preview"
                >
                  {messages.composePreview}
                </Button>
                {composeTab === 'write' ? (
                  <div role="toolbar" aria-label={messages.composeToolbar} className="ml-auto flex flex-wrap items-center gap-1" data-testid="chat-compose-toolbar">
                    {CHAT_FORMATS.map((format) => (
                      <Button
                        key={format}
                        type="button"
                        variant="ghost"
                        size="sm"
                        // 🔴 押しても入力欄の選択を失わない（ボタンにフォーカスを移さない）。
                        onMouseDown={(event) => event.preventDefault()}
                        onClick={() => formatCompose(format)}
                        data-testid={`chat-compose-format-${format}`}
                      >
                        {messages.composeFormats[format]}
                      </Button>
                    ))}

                  </div>
                ) : null}
              </div>
              ) : null}
              {mentionOpen && composeTab === 'write' ? (
                <div className="flex flex-wrap gap-1 border-b border-border px-2 py-2" data-testid="chat-compose-mention-list">
                  {mentionCandidates.length === 0 ? (
                    <span className="text-xs text-fg-muted">{messages.composeMentionEmpty}</span>
                  ) : (
                    mentionCandidates.map((name) => (
                      <Button
                        key={name}
                        type="button"
                        variant="secondary"
                        size="sm"
                        onMouseDown={(event) => event.preventDefault()}
                        onClick={() => mentionCompose(name)}
                      >
                        {`@${name}`}
                      </Button>
                    ))
                  )}
                </div>
              ) : null}
              {/* ✅ 2026-10-23（紺野）: 行頭で「/」を打つと出る小さなメニュー（案件を貼る / 定型文）。 */}
              {slashRange !== null && composeTab === 'write' ? (
                <div
                  role="group"
                  aria-label={messages.slash.label}
                  className="flex flex-col gap-1 border-b border-border px-2 py-2"
                  data-testid="chat-compose-slash-menu"
                >
                  {slashTemplatesOpen ? (
                    <div className="flex flex-wrap gap-1" data-testid="chat-compose-slash-templates">
                      {[...ownTemplates, ...messages.templates].map((template) => (
                        <Button
                          key={`${template.id}-${template.label}`}
                          type="button"
                          variant="secondary"
                          size="sm"
                          onMouseDown={(event) => event.preventDefault()}
                          onClick={() => insertTemplateFromSlash(template.body)}
                        >
                          {template.label}
                        </Button>
                      ))}
                    </div>
                  ) : (
                    <div className="flex flex-wrap gap-1">
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onMouseDown={(event) => event.preventDefault()}
                        onClick={() => {
                          consumeSlash();
                          setPickerOpen(true);
                        }}
                        data-testid="chat-compose-slash-project"
                      >
                        <Icon name="briefcase" />
                        {messages.slash.project}
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onMouseDown={(event) => event.preventDefault()}
                        onClick={() => setSlashTemplatesOpen(true)}
                        data-testid="chat-compose-slash-template"
                      >
                        {messages.slash.template}
                      </Button>
                    </div>
                  )}
                </div>
              ) : null}
              {/* ✅ 2026-10-23: 貼る案件を選ぶ小窓（候補は #51n。最終の判定は投稿のサーバ側）。 */}
              {pickerOpen ? (
                <ChatProjectPicker
                  threadId={threadId}
                  labels={messages.pasteProject}
                  statuses={messages.projectCard.statuses}
                  onPick={(project) => {
                    setAttachedProject(project);
                    setPickerOpen(false);
                    if (sendError === 'PROJECT') setSendError('NONE');
                    composeTextarea()?.focus();
                  }}
                  onClose={() => setPickerOpen(false)}
                />
              ) : null}
              {/* ✅ 2026-10-23: 送信で一緒に送る案件（外せる）。 */}
              {attachedProject === null ? null : (
                <div className="flex items-center gap-2 border-b border-border px-3 py-1" data-testid="chat-compose-attached-project">
                  <Icon name="briefcase" className="text-fg-muted" />
                  <span className="shrink-0 text-xs text-fg-muted">{messages.pasteProject.attached}</span>
                  <span className="min-w-0 truncate text-xs font-medium text-fg">{attachedProject.name}</span>
                  <IconButton
                    type="button"
                    variant="ghost"
                    size="sm"
                    // ✅ 2026-10-26（Codex のレビュー）: スマホでは押せる大きさを 44px にする。
                    className="ml-auto h-11 w-11 md:h-8 md:w-8"
                    icon={<Icon name="x" />}
                    aria-label={messages.pasteProject.remove}
                    onClick={() => setAttachedProject(null)}
                    data-testid="chat-compose-attached-project-remove"
                  />
                </div>
              )}
              {composeTab === 'write' ? (
                <Textarea
                  id={composeId}
                  aria-label={messages.composeLabel}
                  rows={1}
                  name="body"
                  value={body}
                  maxLength={CHAT_MESSAGE_MAX_LENGTH}
                  placeholder={title?.title ? `${title.title}${messages.composePlaceholderSuffix}` : messages.composePlaceholder}
                  // ✅ 2026-10-14: 文章に合わせて伸び（`field-sizing-content`）、約 6 行で止めて欄の中でスクロールする。
                  className={cn(
                    'overflow-y-auto overscroll-contain rounded-none border-0',
                    'min-h-11 max-h-40 resize-none',
                  )}
                  onChange={(event) => {
                    updateBody(event.target.value);
                    trackSlash(event.target.value, event.target.selectionStart);
                  }}
                  // ✅ 2026-10-13（Lark 寄せ）: Enter で送信、Shift+Enter で改行。
                  // 🔴 日本語入力の変換確定の Enter では送らない（`lib/chat/layout.ts` の `isSendKey`）。
                  onKeyDown={(event) => {
                    // ✅ 2026-10-22: ⌘B / ⌘I（Ctrl も）で太字・斜体（GitHub と同じ）。
                    if ((event.metaKey || event.ctrlKey) && (event.key === 'b' || event.key === 'i')) {
                      event.preventDefault();
                      formatCompose(event.key === 'b' ? 'bold' : 'italic');
                      return;
                    }
                    // ✅ 2026-10-23: 「/」のメニューが出ていれば、Esc はメニューを閉じるだけ。
                    if (event.key === 'Escape' && slashRange !== null) {
                      event.preventDefault();
                      setSlashRange(null);
                      setSlashTemplatesOpen(false);
                      return;
                    }
                    // ✅ 2026-10-14: Esc で入力欄を離れる。
                    if (event.key === 'Escape') {
                      event.currentTarget.blur();
                      return;
                    }
                    if (
                      isSendKey({
                        key: event.key,
                        shiftKey: event.shiftKey,
                        isComposing: event.nativeEvent.isComposing,
                        keyCode: event.keyCode,
                      })
                    ) {
                      event.preventDefault();
                      submit();
                    }
                  }}
                  data-testid="chat-compose-body"
                />
              ) : (
                <div className="flex min-h-20 flex-col gap-2 px-3 py-2 text-body text-fg" data-testid="chat-compose-preview">
                  {body.trim() === '' ? (
                    <span className="text-fg-muted">{messages.composePreviewEmpty}</span>
                  ) : (
                    <ChatMessageMarkdown text={body} messageId={null} mentionNames={mentionCandidates} />
                  )}
                </div>
              )}
              {formatOpen ? (
                <p className="m-0 border-t border-border px-3 py-1 text-xs text-fg-muted">{messages.composeMarkdownHint}</p>
              ) : null}
              <div className="flex flex-wrap items-center gap-1 border-t border-border p-1">
                {/* ✅ 2026-10-22: 書式ボタン・プレビュー・@ 名前の帯を開く（普段は閉じて入力欄を細くする）。 */}
                <IconButton
                  icon={<Icon name="chat-format" />}
                  aria-label={messages.composeToolbar}
                  title={messages.composeToolbar}
                  className="h-11 w-11"
                  type="button"
                  variant={formatOpen ? 'secondary' : 'ghost'}
                  aria-pressed={formatOpen}
                  onClick={() => {
                    setFormatOpen((value) => !value);
                    setMentionOpen(false);
                    setComposeTab('write');
                  }}
                  data-testid="chat-compose-format-toggle"
                />
                <IconButton type="button" variant={mentionOpen ? 'secondary' : 'ghost'} className="h-11 w-11" icon={<Icon name="chat-mention" />} aria-label={messages.composeMention} title={messages.composeMention} aria-expanded={mentionOpen} onMouseDown={(event) => event.preventDefault()} onClick={() => { setComposeTab('write'); setMentionOpen((open) => !open); }} data-testid="chat-compose-mention" />
                <IconButton type="button" variant="ghost" className="h-11 w-11" icon={<Icon name="chat-slash" />} aria-label={messages.slash.label} title={messages.slash.label} aria-expanded={slashRange !== null} onClick={() => {
                  setComposeTab('write');
                  if (slashRange !== null) { setSlashRange(null); setSlashTemplatesOpen(false); return; }
                  const next = body === '' ? '/' : `${body}\n/`;
                  updateBody(next);
                  trackSlash(next, next.length);
                  composeTextarea()?.focus();
                }} data-testid="chat-compose-slash-toggle" />
                <IconButton type="button" variant={templateOpen ? 'secondary' : 'ghost'} className="h-11 w-11" icon={<Icon name="chat-template" />} aria-label={messages.templateLabel} title={messages.templateLabel} aria-expanded={templateOpen} aria-controls={`chat-compose-template-${threadId}`} onClick={() => setTemplateOpen((open) => !open)} data-testid="chat-compose-template-toggle" />
                {/* ✅ 2026-10-14: 送信に失敗したら、書いた文章を残したまま、その場で送り直せる
                    （🔴 二重送信の防止は `createSubmitGuard` のまま。見えなくなったスレッドには再送を出さない）。 */}
                {sendError === 'FAILED' && !sending ? (
                  <Button type="button" variant="secondary" onClick={submit} data-testid="chat-compose-retry">
                    {messages.retry}
                  </Button>
                ) : null}
                <Button type="submit" variant="primary" className="ml-auto min-h-11 shrink-0 gap-1" data-testid="chat-compose-submit">
                  <Icon name="chat-send" />
                  {sending ? messages.composeSubmitting : messages.composeSubmit}
                </Button>
                {/* ✅ 2026-10-14: 定型文（固定の文面）を入力欄の末尾に入れる。 */}
                <label className="sr-only" htmlFor={`chat-compose-template-${threadId}`}>
                  {messages.templateLabel}
                </label>
                <Select
                  id={`chat-compose-template-${threadId}`}
                  value=""
                  onChange={(event) => {
                    const value = event.target.value;
                    setTemplateOpen(false);
                    // ✅ 2026-10-22: 末尾の「定型文を編集…」は一覧の列を管理画面に切り替える。
                    //    幅のある画面では開いている会話を残し、スマホ（一覧と会話を切り替える）では一覧に戻る。
                    if (value === MANAGE_TEMPLATES_VALUE) {
                      const wide = window.matchMedia('(min-width: 768px)').matches;
                      window.location.assign(chatHref(wide ? { thread: threadId, filter: { kind: 'templates' } } : { filter: { kind: 'templates' } }));
                      return;
                    }
                    const template = value.startsWith(OWN_TEMPLATE_PREFIX)
                      ? ownTemplates.find((entry) => OWN_TEMPLATE_PREFIX + entry.id === value)
                      : messages.templates.find((entry) => entry.id === value);
                    if (template === undefined) return;
                    updateBody(body === '' ? template.body : `${body}\n${template.body}`);
                    document.getElementById(composeId)?.focus();
                  }}
                  className={cn("w-full", templateOpen ? null : "hidden")}
                  data-testid="chat-compose-template"
                >
                  <option value="">{messages.templatePlaceholder}</option>
                  {ownTemplates.length === 0 ? null : (
                    <optgroup label={messages.templateOwnGroup} data-testid="chat-compose-template-own">
                      {ownTemplates.map((template) => (
                        <option key={template.id} value={OWN_TEMPLATE_PREFIX + template.id}>
                          {template.label}
                        </option>
                      ))}
                    </optgroup>
                  )}
                  <optgroup label={messages.templateFixedGroup}>
                    {messages.templates.map((template) => (
                      <option key={template.id} value={template.id}>
                        {template.label}
                      </option>
                    ))}
                  </optgroup>
                  <option value={MANAGE_TEMPLATES_VALUE}>{messages.templateManage}</option>
                </Select>
                {/* ✅ 2026-10-14: 残り文字数（残り 200 文字を切ったら出す）。 */}
                {(() => {
                  const remaining = remainingChars(body, CHAT_MESSAGE_MAX_LENGTH);
                  return remaining === null ? null : (
                    <span className="ml-auto text-xs text-fg-muted" aria-live="polite" data-testid="chat-compose-remaining">
                      {`${messages.remainingBefore} ${String(remaining)} ${messages.remainingAfter}`}
                    </span>
                  );
                })()}
              </div>
            </div>
          </Field>
          {/* 誰に見えるか（取引先との部屋では大事な情報なので、小さく常に出す）。 */}
          <p className="m-0 mt-1 text-xs text-fg-muted">{messages.composeHint}</p>
          {/* ✅ 2026-10-14: 送信の取り消し（押してから数秒は送らずに待つ）。 */}
          {pendingSend === null ? null : (
            <div className="mb-2 flex flex-wrap items-center gap-2" aria-live="polite" data-testid="chat-compose-pending">
              <span className="text-body text-fg-muted">{messages.pending}</span>
              <Button type="button" variant="secondary" size="sm" onClick={undoSend} data-testid="chat-compose-undo">
                {messages.undo}
              </Button>
              <Button type="button" variant="ghost" size="sm" onClick={sendNow} data-testid="chat-compose-send-now">
                {messages.sendNow}
              </Button>
            </div>
          )}
          {sendError === 'NONE' ? null : (
            <Alert variant="danger" data-testid="chat-compose-error">
              {sendError === 'MISSING'
                ? messages.composeThreadMissing
                : sendError === 'PROJECT'
                  ? messages.pasteProject.notPastable
                  : messages.composeFailed}
            </Alert>
          )}

        </form>
      ) : (
        // 🔴 ボタンを描かず理由を置く（`disabled` にしない）。
        <p
          className={`m-0 shrink-0 border-t border-border px-5 py-3 text-body text-fg-muted ${CHAT_COMPOSER_HEIGHT_CLASS}`}
          data-testid="chat-compose-not-allowed"
        >
          {messages.composeNotAllowed}
        </p>
      )}
      {/* ✅ 2026-10-20（紺野「モーダル」）: 自分の発言の削除の確認。🔴 確認文は 1 文だけ（`Dialog` の body は string）。
          確定の操作は 1 つ。`Dialog` 自身は何も実行しない（実行は `removeMessage`）。 */}
      {canPost ? (
        <Dialog
          open={confirmDeleteId !== null}
          onOpenChange={(next) => {
            if (!next) setConfirmDeleteId(null);
          }}
          title={messages.deleteTitle}
          body={messages.deleteConfirm}
          cancelLabel={messages.cancel}
          confirm={
            <IconButton
              type="button"
              variant="primary"
              onClick={() => {
                const target = items.find((entry) => entry.id === confirmDeleteId);
                setConfirmDeleteId(null);
                if (target !== undefined) void removeMessage(target);
              }}
              data-testid={`chat-message-delete-yes-${confirmDeleteId ?? 'none'}`}

              aria-label={messages.deleteConfirmYes}
              className="h-11 w-11"
              title={messages.deleteConfirmYes} icon={<Icon name="chat-delete" />} />
          }
        />
      ) : null}
    </section>
  );
}
