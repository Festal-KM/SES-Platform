// apps/web/app/(main)/chat/chat-announcement-bar.tsx
// ✅ 2026-10-26（紺野の決定 2026-10-22）: 部屋のアナウンスの帯（LINE のアナウンス）。会話の見出しの下に出す。
//
// 🔴 ここが守るもの
//   ① 🔴 **スマホでも同じ帯を出す**（隠さない。`CLAUDE.md` §13.3。チャットはスマホで完結する画面 = Tier 1）。指で押す操作は 44px。
//   ② 🔴 消えた発言（送った本人が消した・保持期限で消えた）は本文を出さず「この発言は削除されました」と書く。
//   ③ 🔴 「外す」は投稿できる人にだけ描く（閲覧専用には押せない導線を置かない。拒否の本体は API）。
//   ①' 本文の冒頭は 2 行までに収める（スマホの狭い幅でも帯が会話を押しのけない）。全文は帯を押した先の発言で読める。
//   ④ 帯を押すと、その発言が読み込み済みならそこへ移る。読み込んでいなければ「いつの発言か」を書くだけ（遠い過去を勝手に読み込み続けない）。
//   ⑤ 状態は持たない（会話の島 `chat-conversation.tsx` が持つ）。文言は props から受け取る（`@ses/i18n` を値 import しない）。
import { Button } from '@ses/ui';
import { formatDateTimeJst } from '../../../lib/format/datetime';
import type { ChatAnnouncementView } from '../../../lib/chat/views';
import type { ChatConversationMessages } from './chat-props';

export type ChatAnnouncementBarProps = {
  readonly threadId: string;
  readonly announcement: ChatAnnouncementView;
  readonly canPost: boolean;
  /** 帯を押したが、その発言がまだ読み込まれていなかった（「いつの発言か」を出す）。 */
  readonly notLoaded: boolean;
  readonly onJump: () => void;
  readonly onClear: () => void;
  readonly messages: Pick<
    ChatConversationMessages,
    | 'announcementLabel'
    | 'announcementClear'
    | 'announcementJump'
    | 'announcementSetBySuffix'
    | 'announcementNotLoadedSuffix'
    | 'deleted'
    | 'unknownName'
  >;
};

export function ChatAnnouncementBar({
  threadId,
  announcement,
  canPost,
  notLoaded,
  onJump,
  onClear,
  messages,
}: ChatAnnouncementBarProps) {
  return (
    <section
      aria-label={messages.announcementLabel}
      className="flex shrink-0 flex-col gap-1 border-b border-border bg-bg-subtle px-3 py-2 md:px-5"
      data-testid={`chat-announcement-${threadId}`}
      data-message-id={announcement.messageId}
    >
      <div className="flex items-start gap-2">
        <span className="shrink-0 py-2 text-xs font-medium text-fg-muted">{messages.announcementLabel}</span>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          title={messages.announcementJump}
          onClick={onJump}
          className="h-auto min-h-11 min-w-0 flex-1 flex-col items-start justify-center gap-1 py-1 text-left whitespace-normal md:min-h-8"
          data-testid={`chat-announcement-jump-${threadId}`}
        >
          {announcement.snippet === null ? (
            <span className="text-body text-fg-muted" data-testid={`chat-announcement-removed-${threadId}`}>
              {messages.deleted}
            </span>
          ) : (
            <span className="line-clamp-2 break-words text-body text-fg" data-testid={`chat-announcement-body-${threadId}`}>
              {announcement.snippet}
            </span>
          )}
          <span className="text-xs font-normal text-fg-muted" data-testid={`chat-announcement-meta-${threadId}`}>
            {announcement.setByName ?? messages.unknownName}
            {messages.announcementSetBySuffix}
            {' · '}
            <time dateTime={announcement.setAt}>{formatDateTimeJst(announcement.setAt)}</time>
          </span>
        </Button>
        {canPost ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={onClear}
            className="min-h-11 md:min-h-8"
            data-testid={`chat-announcement-clear-${threadId}`}
          >
            {messages.announcementClear}
          </Button>
        ) : null}
      </div>
      {notLoaded ? (
        <p className="m-0 text-xs text-fg-muted" data-testid={`chat-announcement-not-loaded-${threadId}`}>
          <time dateTime={announcement.messageSentAt}>{formatDateTimeJst(announcement.messageSentAt)}</time>
          {messages.announcementNotLoadedSuffix}
        </p>
      ) : null}
    </section>
  );
}
