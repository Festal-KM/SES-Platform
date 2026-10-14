// apps/web/app/(main)/chat/chat-props.ts
// `S-031` の文言の束（`packages/i18n` で解決し、`'use client'` の島へ**解決済みの文字列**で渡す）。
//
// 🔴 **島が `t()` を呼ばない**（`@ses/i18n` のカタログを丸ごとクライアントへ運ばない。
//    `S-015` の `EngineerShareScreenMessages` と同じ作法）。
// 🔴 **文言をコンポーネントにベタ書きしない**（`CLAUDE.md` §3.5 / `BR-32`）。
import { t } from '@ses/i18n';

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
