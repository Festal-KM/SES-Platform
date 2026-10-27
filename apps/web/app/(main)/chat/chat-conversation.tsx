'use client';

import { Alert, Button, EmptyState, HEADER_HEIGHT_CLASS, Icon, IconButton, SECONDARY_LINK_CLASSES, cn } from '@ses/ui';
import { Dialog } from '@ses/ui/client';
import Link from 'next/link';
import { withDaySeparators } from '../../../lib/chat/day-separators';
import { type ChatConversationLayout, type ChatConversationTitle } from '../../../lib/chat/layout';
import { isAwayFromLatest } from '../../../lib/chat/message-text';
import { chatExportApiPath, chatHref } from '../../../lib/chat/screen-query';
import { withUnreadMarker } from '../../../lib/chat/unread-marker';
import { type ChatAnnouncementView, type ChatMessageView } from '../../../lib/chat/views';
import { ChatAnnouncementBar } from './chat-announcement-bar';
import { ChatComposer } from './chat-composer';
import { ChatMessageItem } from './chat-message-item';
import type { ChatConversationMessages } from './chat-props';
import { ChatThreadPrefsToggle } from './chat-thread-prefs-toggle';
import { useChatConversation } from './use-chat-conversation';

/**
 * ✅ 2026-10-22: ひとこと状態の札（名前の続きに見えないよう、薄い面の札にする（角は Badge と同じ `rounded-xs`。円はアバターとカウンタだけ））。
 * 🔴 どの部屋でも同じ形（会話の見出し・発言の名前の横）。長い状態は 1 行で切る。
 */
const STATUS_CHIP_CLASSES = 'truncate rounded-xs bg-bg-inset px-1 text-xs text-fg-muted';

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
  readonly threadKind?: 'DM' | 'GROUP' | 'COMPANY' | 'PROJECT';
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
  /**
   * ✅ 2026-10-26（紺野の決定 2026-10-22）: 部屋のアナウンス（1 部屋 1 件。`readChatScreen` の `announcements`）。無ければ `null` / 省略。
   * 🔴 読めるかは RLS（その部屋が読める人だけ）が決める。開いている間は新着と同じ間隔で読み直す。
   */
  readonly announcement?: ChatAnnouncementView | null;
  /**
   * ✅ 2026-10-27（改訂 44）: ファイルを添えられるか（投稿できる人で、取引先がいない部屋）。省略時は添えられない。
   * 🔴 拒否の本体は API（#51p / #51 の `chatRoomAcceptsAttachments` と DB のトリガ）。ここは印の出し分けだけ。
   */
  readonly canAttach?: boolean;
};

export function ChatConversation(props: ChatConversationProps) {
  const conversation = useChatConversation(props);
  const {
    title,
    threadId,
    canPost,
    messages,
    closeHref,
    infoHref,
    infoLabel,
    prefs,
    items,
    nextCursor,
    loadingOlder,
    olderFailed,
    awayFromLatest,
    setAwayFromLatest,
    scrollRef,
    newArrived,
    headerMenuOpen,
    setHeaderMenuOpen,
    headerMenuUsed,
    announcement,
    announcementNotLoaded,
    announcementFailed,
    markerId,
    confirmDeleteId,
    setConfirmDeleteId,
    setHoveredId,
    changeAnnouncement,
    jumpToAnnouncement,
    removeMessage,
    scrollToLatest,
    loadOlder,
  } = conversation;
  // 日付は発言の間だけに置き、スクロール中も本文に重ねない。
  const entries = withUnreadMarker(withDaySeparators(items), markerId);
  const days: { day: string; entries: (typeof entries)[number][] }[] = [];
  for (const entry of entries) {
    if (entry.kind === 'day') days.push({ day: entry.day, entries: [] });
    else days.at(-1)?.entries.push(entry);
  }
  // ✅ 2026-10-26（#164 の 2）: 開いている間に読めなくなったら、見出し（相手の名前）も本文も入力欄も描かない。
  //    🔴 戻り道だけを置く（一覧から選び直す）。
  if (conversation.unavailable) {
    return (
      <section data-testid="chat-conversation" data-thread-id={threadId} data-unavailable="true" className="flex min-h-0 flex-1 flex-col">
        <div className="flex flex-col gap-3 p-4" role="status" data-testid="chat-conversation-unavailable">
          <p className="m-0 text-body text-fg-muted">{messages.unavailable ?? messages.backToList}</p>
          <Link href={chatHref({})} className={SECONDARY_LINK_CLASSES} data-testid="chat-conversation-unavailable-back">
            {messages.backToList}
          </Link>
        </div>
      </section>
    );
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
              className={cn(SECONDARY_LINK_CLASSES, 'inline-flex min-h-11 min-w-11 shrink-0 items-center justify-center gap-2')}
              data-testid={`chat-thread-export-${threadId}`}
            >
              <Icon name="chat-export" /><span className={closeHref === undefined ? "md:sr-only" : undefined}>{messages.exportLink}</span>
            </a>
          ) : null}
          {/* ✅ 2026-10-16: ピン留め・ミュート（自分の表示の設定）。 */}
          {prefs === undefined ? null : (
            <ChatThreadPrefsToggle
              threadId={threadId}
              prefs={prefs}
              labelDisplay={closeHref === undefined ? 'responsive' : 'menu'}
              labels={{ pin: messages.pin, unpin: messages.unpin, mute: messages.mute, unmute: messages.unmute }}
            />
          )}
          {infoHref === undefined || infoLabel === undefined ? null : (
            <Link
              href={infoHref}
              aria-label={infoLabel}
              title={infoLabel}
              className={cn(SECONDARY_LINK_CLASSES, 'inline-flex min-h-11 min-w-11 shrink-0 items-center justify-center gap-2')}
              data-testid={`chat-thread-info-${threadId}`}
            >
              <Icon name="chat-info" /><span className={closeHref === undefined ? "md:sr-only" : undefined}>{infoLabel}</span>
            </Link>
          )}
        </div>
      </div>

      {/* ✅ 2026-10-26（紺野の決定 2026-10-22）: アナウンスの帯（会話の見出しの下）。🔴 スマホでも同じ帯を出す（隠さない）。 */}
      {announcement === null ? null : (
        <ChatAnnouncementBar
          threadId={threadId}
          announcement={announcement}
          canPost={canPost}
          notLoaded={announcementNotLoaded}
          onJump={jumpToAnnouncement}
          onClear={() => void changeAnnouncement('DELETE', announcement.messageId)}
          messages={messages}
        />
      )}
      {announcementFailed ? (
        <div className="shrink-0 px-3 py-2 md:px-5">
          <Alert variant="danger" data-testid={`chat-announcement-failed-${threadId}`}>
            {messages.announcementFailed}
          </Alert>
        </div>
      ) : null}

      {/* 🔴 本文の面。**下寄せ**（最新の発言がコンポーザーの直上に来る。定義書 §3.12）。
          ✅ 2026-10-14: 上へ読み進めたら右下に「最新のメッセージへ」を出す。 */}
      <div className="relative flex min-h-0 flex-1 flex-col">
      <div
        ref={scrollRef}
        onScroll={(event) => setAwayFromLatest(isAwayFromLatest(event.currentTarget))}
        className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto overscroll-contain px-4 py-3 md:px-5"
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
            className="m-0 flex shrink-0 list-none flex-col gap-1 p-0"
            data-testid="chat-messages"
            onMouseLeave={() => setHoveredId(null)}
          >
            {days.map((entry) => (
              <li key={entry.day} className="relative list-none" data-chat-day={entry.day}>
                {/* ✅ 2026-10-27（紺野「色分けとか、みづらい」）: 日付は灰色の箱をやめ、線と文字にする（吹き出しと見間違えない）。 */}
                <div className="flex items-center gap-3 py-2" data-testid={`chat-day-separator-${entry.day}`}>
                  <span aria-hidden="true" className="h-px flex-1 bg-border" />
                  <time dateTime={entry.day} className="text-xs font-medium text-fg-muted">
                    {entry.day}
                  </time>
                  <span aria-hidden="true" className="h-px flex-1 bg-border" />
                </div>
                <ol className="m-0 flex list-none flex-col gap-1 p-0">
                  {entry.entries.map((entry) => {
                    if (entry.kind === 'unread') {
                      return (
                        <li key="unread-marker" className="mt-1 flex items-center gap-3" data-testid="chat-unread-marker">
                          <span aria-hidden="true" className="h-px flex-1 bg-brand" />
                          <span className="text-xs font-medium text-brand">{messages.unreadFrom}</span>
                          <span aria-hidden="true" className="h-px flex-1 bg-brand" />
                        </li>
                      );
                    }
                    if (entry.kind !== 'message') return null;
                    return <ChatMessageItem key={entry.message.id} item={entry.message} continued={entry.continued && entry.message.id !== markerId} conversation={conversation} />;
                  })}
                </ol>
              </li>
            ))}
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

      <ChatComposer conversation={conversation} />
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
            <Button
              type="button"
              variant="secondary"
              onClick={() => {
                const target = items.find((entry) => entry.id === confirmDeleteId);
                setConfirmDeleteId(null);
                if (target !== undefined) void removeMessage(target);
              }}
              data-testid={`chat-message-delete-yes-${confirmDeleteId ?? 'none'}`}

              aria-label={messages.deleteConfirmYes}
              className="min-h-11"
            >
              {messages.deleteConfirmYes}
            </Button>
          }
        />
      ) : null}
    </section>
  );
}
