'use client';

// ✅ 2026-10-29（紺野の決定・`docs/02` F-038 ⑮）: 送った発言の「送信中」「アップロード中」「送れませんでした」の吹き出し。
//
// 🔴 ここが守るもの
//   ① **手元だけの吹き出し**（他の人には見えない・サーバに無い）。発言の操作（リアクション・保存・編集…）を付けない。
//   ② 自分の発言と同じ場所・同じ面に置き、状態の語をはっきり出す（読み上げにも届く `role="status"`）。
//   ③ 送れなかったら「再送」「取り消す」をその吹き出しに付ける。🔴 貼れない案件で断られた発言には「再送」を描かない
//      （同じ失敗を繰り返す。押して断られる導線を置かない）。
//   ④ ファイル名は出さない（種類と大きさだけ。保存しない約束と同じ）。
import { Button, CHAT_BUBBLE_MAX_WIDTH_CLASS, Icon, cn } from '@ses/ui';
import { chatAttachmentSummary } from '../../../lib/chat/attachment-client';
import { canResendOutbox } from '../../../lib/chat/outbox';
import { ChatMessageMarkdown } from './chat-message-markdown';
import { MINE_SURFACE_CLASSES } from './chat-message-item';
import type { ChatConversationState, ChatOutboxItem } from './use-chat-conversation';

type ChatOutboxItemState = Pick<ChatConversationState, 'messages' | 'mentionCandidates' | 'resendOutbox' | 'discardOutbox'>;

export function ChatOutboxBubble({ entry, conversation }: { readonly entry: ChatOutboxItem; readonly conversation: ChatOutboxItemState }) {
  const { messages, mentionCandidates, resendOutbox, discardOutbox } = conversation;
  const failed = entry.status === 'FAILED';
  const statusText = failed ? messages.outbox.failed : entry.status === 'UPLOADING' ? messages.outbox.uploading : messages.outbox.sending;
  const reason =
    entry.failure === 'PROJECT' ? messages.pasteProject.notPastable : entry.failure === 'ATTACHMENT' ? messages.attachment.uploadFailed : null;
  const { payload } = entry;
  return (
    <li
      className="relative mt-3 flex flex-col items-end gap-1"
      data-testid={`chat-outbox-${entry.tempId}`}
      data-status={entry.status}
      aria-busy={failed ? undefined : true}
    >
      <span className="sr-only">{messages.own}</span>
      {entry.text === '' ? null : (
        <div
          className={cn(
            'm-0 flex w-fit flex-col gap-2 rounded-lg px-3 py-3 md:px-4 md:py-2 text-body break-words',
            CHAT_BUBBLE_MAX_WIDTH_CLASS,
            MINE_SURFACE_CLASSES,
          )}
          data-testid={`chat-outbox-body-${entry.tempId}`}
        >
          <ChatMessageMarkdown
            text={entry.text}
            messageId={null}
            mentionNames={mentionCandidates}
            tone="inverse"
            {...(messages.quote === undefined ? {} : { quote: { labels: messages.quote, missing: false } })}
          />
        </div>
      )}
      {payload.project === null ? null : (
        <span className="flex items-center gap-1 text-xs text-fg-muted">
          <Icon name="briefcase" />
          {payload.project.name}
        </span>
      )}
      {payload.file === null ? null : (
        <span className="flex items-center gap-1 text-xs text-fg-muted">
          <Icon name="chat-attach" />
          {chatAttachmentSummary({ contentType: payload.file.contentType, byteSize: payload.file.file.size }, messages.attachment)}
        </span>
      )}
      <p className={cn('m-0 text-xs', failed ? 'text-danger' : 'text-fg-muted')} role="status" data-testid={`chat-outbox-status-${entry.tempId}`}>
        {statusText}
        {reason === null ? null : <span>{` ${reason}`}</span>}
      </p>
      {failed ? (
        <div className="flex flex-wrap items-center gap-2">
          {canResendOutbox(entry) ? (
            <Button
              type="button"
              variant="secondary"
              size="sm"
              className="min-h-11 md:min-h-8"
              onClick={() => resendOutbox(entry.tempId)}
              data-testid={`chat-outbox-resend-${entry.tempId}`}
            >
              {messages.outbox.resend}
            </Button>
          ) : null}
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="min-h-11 md:min-h-8"
            onClick={() => discardOutbox(entry.tempId)}
            data-testid={`chat-outbox-discard-${entry.tempId}`}
          >
            {messages.outbox.discard}
          </Button>
        </div>
      ) : null}
    </li>
  );
}
