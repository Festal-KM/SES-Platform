// apps/web/app/(main)/chat/chat-props.ts
// `S-031` の文言の束（`packages/i18n` で解決し、`'use client'` の島へ**解決済みの文字列**で渡す）。
//
// 🔴 **島が `t()` を呼ばない**（`@ses/i18n` のカタログを丸ごとクライアントへ運ばない。
//    `S-015` の `EngineerShareScreenMessages` と同じ作法）。
// 🔴 **文言をコンポーネントにベタ書きしない**（`CLAUDE.md` §3.5 / `BR-32`）。
import { t } from '@ses/i18n';
import type { ChatFormat } from '../../../lib/chat/markdown';
import type { ChatReactionKind } from '../../../lib/chat/views';

/** 会話（中央）の島が使う語。 */
export type ChatConversationMessages = {
  readonly heading: string;
  readonly listLabel: string;
  readonly empty: string;
  readonly older: string;
  readonly olderLoading: string;
  readonly olderFailed: string;
  readonly purged: string;
  readonly own: string;
  readonly unknownName: string;
  readonly backToList: string;
  readonly composeLabel: string;
  readonly composePlaceholder: string;
  readonly composeHint: string;
  /** ✅ 2026-10-22: 書式ボタン・書く／プレビュー・@（GitHub のコメント欄に寄せた）。 */
  readonly composeToolbar: string;
  readonly composeFormats: Readonly<Record<ChatFormat, string>>;
  readonly composeMention: string;
  readonly composeMentionEmpty: string;
  readonly composeWrite: string;
  readonly composePreview: string;
  readonly composePreviewEmpty: string;
  readonly composeMarkdownHint: string;
  readonly composeSubmit: string;
  readonly composeSubmitting: string;
  readonly composeFailed: string;
  readonly composeThreadMissing: string;
  readonly composeNotAllowed: string;
  /** ✅ 2026-10-14: 並べて開いた会話を閉じる。 */
  readonly closePane: string;
  /** ✅ 2026-10-14: 会話の操作の改修。 */
  readonly copy: string;
  readonly copied: string;
  readonly readMore: string;
  readonly readLess: string;
  readonly messageActions: string;
  readonly toLatest: string;
  readonly firstMessage: string;
  readonly remainingBefore: string;
  readonly remainingAfter: string;
  readonly retry: string;
  readonly newArrived: string;
  readonly pending: string;
  readonly undo: string;
  readonly sendNow: string;
  /** ✅ 2026-10-16: 既読・未読。 */
  readonly unreadFrom: string;
  readonly markUnread: string;
  /** ✅ 2026-10-19（#128）: DM の既読表示。 */
  readonly read: string;
  /** ✅ 2026-10-16: リアクションの語（4 つ）と「リアクション」。 */
  readonly reactions: Readonly<Record<ChatReactionKind, string>>;
  readonly reactionAdd: string;
  /** ✅ 2026-10-16: 編集・削除。 */
  readonly edit: string;
  readonly remove: string;
  readonly edited: string;
  readonly deleted: string;
  readonly save: string;
  readonly cancel: string;
  readonly deleteTitle: string;
  readonly deleteConfirm: string;
  readonly deleteConfirmYes: string;
  readonly editFailed: string;
  /** ✅ 2026-10-16: ピン留め・ミュート。 */
  readonly pin: string;
  readonly unpin: string;
  readonly mute: string;
  readonly unmute: string;
  /** ✅ 2026-10-16: 会話の書き出し。 */
  readonly exportLink: string;
  readonly templateLabel: string;
  readonly templatePlaceholder: string;
  /** 定型文（固定の文面。🔴 個人情報・単価を含めない）。 */
  readonly templates: readonly { readonly id: string; readonly label: string; readonly body: string }[];
};

/** ✅ 2026-10-14: ドラッグで会話を右に並べる受け口の語。 */
export type ChatPaneDropMessages = {
  readonly drop: string;
};

export function chatPaneDropMessages(): ChatPaneDropMessages {
  return { drop: t('chat.pane.drop') };
}

export function chatConversationMessages(): ChatConversationMessages {
  return {
    heading: t('chat.messages.heading'),
    listLabel: t('chat.messages.label'),
    empty: t('chat.messages.empty'),
    older: t('chat.messages.older'),
    olderLoading: t('chat.messages.olderLoading'),
    olderFailed: t('chat.messages.olderFailed'),
    purged: t('chat.message.purged'),
    own: t('chat.message.own'),
    unknownName: t('chat.thread.unknownName'),
    backToList: t('chat.backToList'),
    composeLabel: t('chat.compose.label'),
    composePlaceholder: t('chat.compose.placeholder'),
    composeHint: t('chat.compose.hint'),
    composeToolbar: t('chat.compose.toolbar'),
    composeFormats: {
      bold: t('chat.compose.format.bold'),
      italic: t('chat.compose.format.italic'),
      code: t('chat.compose.format.code'),
      link: t('chat.compose.format.link'),
      bullet: t('chat.compose.format.bullet'),
      ordered: t('chat.compose.format.ordered'),
      quote: t('chat.compose.format.quote'),
    },
    composeMention: t('chat.compose.mention'),
    composeMentionEmpty: t('chat.compose.mentionEmpty'),
    composeWrite: t('chat.compose.write'),
    composePreview: t('chat.compose.preview'),
    composePreviewEmpty: t('chat.compose.previewEmpty'),
    composeMarkdownHint: t('chat.compose.markdownHint'),
    composeSubmit: t('chat.compose.submit'),
    composeSubmitting: t('chat.compose.submitting'),
    composeFailed: t('chat.compose.failed'),
    composeThreadMissing: t('chat.compose.threadMissing'),
    composeNotAllowed: t('chat.compose.notAllowed'),
    closePane: t('chat.pane.close'),
    copy: t('chat.message.copy'),
    copied: t('chat.message.copied'),
    readMore: t('chat.message.readMore'),
    readLess: t('chat.message.readLess'),
    messageActions: t('chat.message.actions'),
    toLatest: t('chat.messages.toLatest'),
    firstMessage: t('chat.messages.first'),
    remainingBefore: t('chat.compose.remainingBefore'),
    remainingAfter: t('chat.compose.remainingAfter'),
    retry: t('chat.compose.retry'),
    newArrived: t('chat.messages.newArrived'),
    pending: t('chat.compose.pending'),
    undo: t('chat.compose.undo'),
    sendNow: t('chat.compose.sendNow'),
    unreadFrom: t('chat.messages.unreadFrom'),
    markUnread: t('chat.message.markUnread'),
    read: t('chat.message.read'),
    reactions: {
      OK: t('chat.reaction.OK'),
      THANKS: t('chat.reaction.THANKS'),
      CHECKING: t('chat.reaction.CHECKING'),
      DONE: t('chat.reaction.DONE'),
    },
    reactionAdd: t('chat.reaction.add'),
    edit: t('chat.message.edit'),
    remove: t('chat.message.delete'),
    edited: t('chat.message.edited'),
    deleted: t('chat.message.deleted'),
    save: t('chat.message.save'),
    cancel: t('chat.message.cancel'),
    deleteTitle: t('chat.message.deleteTitle'),
    deleteConfirm: t('chat.message.deleteConfirm'),
    deleteConfirmYes: t('chat.message.deleteConfirmYes'),
    editFailed: t('chat.message.editFailed'),
    pin: t('chat.thread.pin'),
    unpin: t('chat.thread.unpin'),
    mute: t('chat.thread.mute'),
    unmute: t('chat.thread.unmute'),
    exportLink: t('chat.export.link'),
    templateLabel: t('chat.compose.template.label'),
    templatePlaceholder: t('chat.compose.template.placeholder'),
    templates: [
      { id: 'interview', label: t('chat.compose.template.interview'), body: t('chat.compose.template.interview.body') },
      { id: 'extension', label: t('chat.compose.template.extension'), body: t('chat.compose.template.extension.body') },
      { id: 'status', label: t('chat.compose.template.status'), body: t('chat.compose.template.status.body') },
      { id: 'thanks', label: t('chat.compose.template.thanks'), body: t('chat.compose.template.thanks.body') },
    ],
  };
}
