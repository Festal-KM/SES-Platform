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
//   ④ 🔴 **既読・未読を描かない**（`messages` に列が無い。`lib/chat/views.ts` の ④）。
//   ⑤ 🔴 **接続状態インジケータ（SSE の `接続中` / `再接続中`）を描かない。** `docs/04` §S-031 は
//      これを求めているが、**`GET /api/realtime/threads/{id}`（`docs/05` §6.5 #52）が未実装**である。
//      実体の無い「接続中」を常時表示すると、**切れていないのに切れていない振りをする**ことになり、
//      §S-031 の目的（「気づかないまま返信を待つ状態を作らない」）と逆に働く。
//      **したがって出さない。** 自動更新も無いので、新着は画面の再読込で現れる。
//   ⑥ 🔴 **`@ses/db` / `@ses/i18n` を値 import しない**（`tests/static/client-db-boundary.test.ts`）。
//      型は `lib/chat/views.ts`（純粋モジュール）から、文言は props から受け取る。
//   ⑦ 🔴 **`<form>` に `method="post"` を付ける** —— 水和前の送信がブラウザの既定 GET で
//      **本文を URL に載せる**のを塞ぐ（`tests/static/form-method-required.test.ts`。実害が 1 度出ている）。
import { useState } from 'react';
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
  SECONDARY_LINK_CLASSES,
  Textarea,
  cn,
} from '@ses/ui';
import { CHAT_MESSAGE_MAX_LENGTH } from '@ses/config';
import { createSubmitGuard } from '../../../lib/forms/submit-guard';
import { formatDateTimeJst } from '../../../lib/format/datetime';
import { displayInitials } from '../../../lib/format/initials';
import { chatHref, chatMessagesApiPath } from '../../../lib/chat/screen-query';
import type { ChatMessageView } from '../../../lib/chat/views';
import type { ChatConversationMessages } from './chat-props';
import { formatChatTime, withDaySeparators } from '../../../lib/chat/day-separators';
import {
  isSendKey,
  type ChatConversationLayout,
  type ChatConversationTitle,
} from '../../../lib/chat/layout';

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
};

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
}: ChatConversationProps) {
  // 🔴 ガードは**インスタンスごと**に持つ（モジュール変数にすると、別のスレッドを開いた島が
  //    同じガードを共有し「前の送信が終わるまで送れない」状態になる）。
  const [sendGuard] = useState(() => createSubmitGuard<'SENT' | 'MISSING' | 'FAILED'>());
  const [olderGuard] = useState(() => createSubmitGuard<'LOADED' | 'FAILED'>());
  const [items, setItems] = useState<readonly ChatMessageView[]>(initialMessages);
  const [nextCursor, setNextCursor] = useState<string | null>(initialNextCursor);
  const [body, setBody] = useState('');
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<'NONE' | 'FAILED' | 'MISSING'>('NONE');
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [olderFailed, setOlderFailed] = useState(false);

  async function submit(): Promise<void> {
    const trimmed = body.trim();
    if (!canPost || trimmed === '' || sending) return;
    setSending(true);
    setSendError('NONE');
    const outcome = await sendGuard.run(async () => {
      try {
        const response = await fetch(chatMessagesApiPath(threadId), {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ body: trimmed }),
        });
        // 🔴 404 = スレッドが見えなくなった（不存在・退出・他社化を区別しない。`docs/05` §4.8）。
        if (response.status === 404) return 'MISSING' as const;
        if (!response.ok) return 'FAILED' as const;
        const payload = (await response.json()) as SendResponseBody;
        // 🔴 手元で先に書き換える楽観更新をしない（サーバの応答だけが正。`S-015` の ⑦ と同じ規律）。
        setItems((current) => [...current, payload.message]);
        setBody('');
        return 'SENT' as const;
      } catch {
        return 'FAILED' as const;
      }
    });
    setSending(false);
    if (outcome === 'MISSING') setSendError('MISSING');
    else if (outcome === 'FAILED') setSendError('FAILED');
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
    <section data-testid="chat-conversation" className="flex min-h-0 flex-1 flex-col">
      <div className={`flex shrink-0 items-center gap-4 border-b border-border px-5 ${HEADER_HEIGHT_CLASS}`}>
        {/* ✅ 2026-10-13（Lark 寄せ）: 見出しに会話の相手（案件スレッドは案件名 + 相手の会社名）を出す。
            🔴 名前が読めなければ既定の見出しに戻す（空の見出しを作らない）。 */}
        <div className="flex min-w-0 items-baseline gap-2">
          <h2 className="m-0 truncate text-row font-medium text-fg" data-testid="chat-conversation-title">
            {title?.title ?? messages.heading}
          </h2>
          {title?.title != null && title.subtitle !== null ? (
            <span className="truncate text-xs text-fg-muted" data-testid="chat-conversation-subtitle">
              {title.subtitle}
            </span>
          ) : null}
        </div>
        {/* 🔴 モバイルは「一覧 → 会話」の 2 画面遷移（`docs/04` §S-031 デバイス別）。戻り道を必ず置く。 */}
        <Link
          href={chatHref({})}
          className={cn('md:hidden', SECONDARY_LINK_CLASSES)}
          data-testid="chat-back-to-list"
        >
          {messages.backToList}
        </Link>
      </div>

      {/* 🔴 本文の面。**下寄せ**（最新の発言がコンポーザーの直上に来る。定義書 §3.12）。 */}
      <div className="flex min-h-0 flex-1 flex-col justify-end gap-3 overflow-y-auto px-5 py-3">
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
          <EmptyState description={messages.empty} testIdPrefix="chat-messages-empty-" />
        ) : (
          <ol
            aria-label={messages.listLabel}
            className="m-0 flex list-none flex-col gap-3 p-0"
            data-testid="chat-messages"
          >
            {withDaySeparators(items).map((entry) => {
              // ✅ 2026-10-13: **日付の区切り**（定義書 §3.12「中央・24h の pill・地 `bg-subtle`・12」）。
              // 🔴 JST の暦日が変わる位置にだけ置く（`lib/chat/day-separators.ts`）。並び順は変えない。
              // 🔴 radius は `rounded-md` —— `rounded-full` はアバターとカウンタにしか使えない
              //    （`tests/static/design-tokens.test.ts` / `docs/04` §7.9）。
              if (entry.kind === 'day') {
                return (
                  <li
                    key={`day-${entry.day}`}
                    className="flex justify-center"
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
              if (layout === 'chat' && item.own) {
                return (
                  <li
                    key={item.id}
                    data-testid={`chat-message-${item.id}`}
                    data-own="true"
                    data-layout="chat"
                    data-continued={continued ? 'true' : 'false'}
                    className="flex flex-col items-end gap-1"
                  >
                    {continued ? (
                      <span className="sr-only">{messages.own}</span>
                    ) : (
                      <p className="m-0 flex items-baseline gap-2">
                        <span className="sr-only">{messages.own}</span>
                        {time}
                      </p>
                    )}
                    <p
                      className={cn(
                        'm-0 w-fit rounded-lg px-4 py-2 text-body whitespace-pre-wrap text-fg',
                        CHAT_BUBBLE_MAX_WIDTH_CLASS,
                        'bg-brand-bg',
                      )}
                      data-testid={`chat-message-body-${item.id}`}
                    >
                      {item.body ?? messages.purged}
                    </p>
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
                className="flex gap-3"
              >
                {/* 🔴 続きの発言はアバターを見えなくするが、幅は残す（本文の左端をそろえる）。 */}
                <Avatar
                  size="md"
                  initials={displayInitials(item.senderName ?? item.senderCompanyName ?? '?')}
                  title={item.senderName ?? messages.unknownName}
                  className={continued ? 'invisible' : undefined}
                />
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
                      {time}
                    </p>
                  )}
                  {/* 🔴 本文は `PURGED` / 保持期間削除で消える（`F-064 AC-2`）。空にせず事実を書く。
                      🔴 上限幅（560）は `packages/ui` の定数から取る —— `max-w-*` は画面に書けない
                         （`ui-screen-width.test.ts` (c)）。**読める行長の規約**であり、画面ごとに
                         決め直すものではない。 */}
                  <p
                    className={cn(
                      'm-0 w-fit rounded-lg px-4 py-2 text-body whitespace-pre-wrap text-fg',
                      CHAT_BUBBLE_MAX_WIDTH_CLASS,
                      item.own ? 'bg-brand-bg' : 'bg-bg-subtle',
                    )}
                    data-testid={`chat-message-body-${item.id}`}
                  >
                    {item.body ?? messages.purged}
                  </p>
                </div>
              </li>
              );
            })}
          </ol>
        )}
      </div>

      {/* 🔴 コンポーザー（64）。会話の下端に固定され、本文だけがその上で伸び縮みする。 */}
      {canPost ? (
        // 🔴 `method="post"` は水和前の送信を URL に載せないための壁である（上の ⑦）。
        <form
          method="post"
          action={chatMessagesApiPath(threadId)}
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
          className={`shrink-0 border-t border-border px-5 py-3 ${CHAT_COMPOSER_HEIGHT_CLASS}`}
          data-testid="chat-compose"
        >
          <Field label={messages.composeLabel} description={messages.composeHint}>
            <Textarea
              name="body"
              value={body}
              maxLength={CHAT_MESSAGE_MAX_LENGTH}
              placeholder={messages.composePlaceholder}
              onChange={(event) => setBody(event.target.value)}
              // ✅ 2026-10-13（Lark 寄せ）: Enter で送信、Shift+Enter で改行。
              // 🔴 日本語入力の変換確定の Enter では送らない（`lib/chat/layout.ts` の `isSendKey`）。
              onKeyDown={(event) => {
                if (
                  isSendKey({
                    key: event.key,
                    shiftKey: event.shiftKey,
                    isComposing: event.nativeEvent.isComposing,
                    keyCode: event.keyCode,
                  })
                ) {
                  event.preventDefault();
                  void submit();
                }
              }}
              data-testid="chat-compose-body"
            />
          </Field>
          {sendError === 'NONE' ? null : (
            <Alert variant="danger" data-testid="chat-compose-error">
              {sendError === 'MISSING' ? messages.composeThreadMissing : messages.composeFailed}
            </Alert>
          )}
          <div className="mt-4">
            <Button type="submit" variant="primary" data-testid="chat-compose-submit">
              {sending ? messages.composeSubmitting : messages.composeSubmit}
            </Button>
          </div>
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
    </section>
  );
}
