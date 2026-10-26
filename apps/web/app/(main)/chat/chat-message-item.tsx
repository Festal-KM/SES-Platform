'use client';

import { CHAT_MESSAGE_MAX_LENGTH } from '@ses/config';
import { Alert, Avatar, Button, CHAT_BUBBLE_MAX_WIDTH_CLASS, Icon, IconButton, Textarea, cn } from '@ses/ui';
import { formatChatTime } from '../../../lib/chat/day-separators';
import { collapsedMessageText, isLongMessage } from '../../../lib/chat/message-text';
import { CHAT_REACTION_EMOJI } from '../../../lib/chat/reactions';
import { CHAT_REACTION_EMOJI_KINDS, CHAT_REACTION_WORD_KINDS, type ChatMessageView } from '../../../lib/chat/views';
import { formatDateTimeJst } from '../../../lib/format/datetime';
import { displayInitials } from '../../../lib/format/initials';
import { ChatMessageMarkdown } from './chat-message-markdown';
import { ChatProjectCard } from './chat-project-card';
import type { ChatConversationState } from './use-chat-conversation';

type ChatMessageItemState = Pick<ChatConversationState,
  | 'layout'
  | 'canPost'
  | 'messages'
  | 'copiedId'
  | 'expanded'
  | 'announcement'
  | 'mentionCandidates'
  | 'quoteIntoCompose'
  | 'fadeClass'
  | 'copyBody'
  | 'readReceiptId'
  | 'toggleReaction'
  | 'toggleSaved'
  | 'editingId'
  | 'setEditingId'
  | 'editText'
  | 'setEditText'
  | 'editFailed'
  | 'setEditFailed'
  | 'confirmDeleteId'
  | 'setConfirmDeleteId'
  | 'hoveredId'
  | 'setHoveredId'
  | 'reactionPickerId'
  | 'setReactionPickerId'
  | 'reactionText'
  | 'selectOnTouch'
  | 'keyboardNav'
  | 'changeAnnouncement'
  | 'saveEdit'
  | 'markUnread'
  | 'toggleExpanded'
>;

export function ChatMessageItem({ item, continued, conversation }: { readonly item: ChatMessageView; readonly continued: boolean; readonly conversation: ChatMessageItemState }) {
  const {
    layout,
    canPost,
    messages,
    copiedId,
    expanded,
    announcement,
    mentionCandidates,
    quoteIntoCompose,
    fadeClass,
    copyBody,
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
    saveEdit,
    markUnread,
    toggleExpanded,
  } = conversation;
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
            {/* ✅ 2026-10-26（紺野の決定 2026-10-22）: アナウンスにする / 外す（部屋のメンバーなら誰でも。閲覧専用には出さない）。
                🔴 消えた発言はアナウンスにできない（API も 404）ので、外す以外は出さない。 */}
            {canPost && (announcement?.messageId === item.id || (item.body !== null && item.deleted !== true)) ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                aria-pressed={announcement?.messageId === item.id}
                onClick={() => void changeAnnouncement(announcement?.messageId === item.id ? 'DELETE' : 'PUT', item.id)}
                data-testid={`chat-message-announce-${item.id}`}
              >
                {announcement?.messageId === item.id ? messages.announcementUnset : messages.announcementSet}
              </Button>
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
                    <p className="m-0 flex flex-wrap items-baseline gap-x-2 gap-y-1">
                      <span className="text-body font-bold text-fg" data-testid={`chat-message-sender-${item.id}`}>
                        {item.senderName ?? messages.unknownName}
                      </span>
                      <span className="min-w-0 text-xs text-fg-muted">
                        <span>{item.senderCompanyName ?? messages.unknownName}</span>
                        {item.own ? <span className="ml-2">{messages.own}</span> : null}
                        {/* 会社と状態を同じ行に流し、狭い画面でも補助情報の段を増やさない。 */}
                        {item.senderStatus == null || item.senderStatus === '' ? null : (
                          <span className="ml-2 text-xs text-fg-muted" data-testid={`chat-message-status-${item.id}`}>
                            {item.senderStatus}
                          </span>
                        )}
                      </span>
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
}
