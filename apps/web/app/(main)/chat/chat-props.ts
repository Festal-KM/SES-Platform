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
  readonly composeLegend: string;
  readonly composeLabel: string;
  readonly composePlaceholder: string;
  readonly composeHint: string;
  readonly composeSubmit: string;
  readonly composeSubmitting: string;
  readonly composeFailed: string;
  readonly composeThreadMissing: string;
  readonly composeNotAllowed: string;
};

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
    composeLegend: t('chat.compose.legend'),
    composeLabel: t('chat.compose.label'),
    composePlaceholder: t('chat.compose.placeholder'),
    composeHint: t('chat.compose.hint'),
    composeSubmit: t('chat.compose.submit'),
    composeSubmitting: t('chat.compose.submitting'),
    composeFailed: t('chat.compose.failed'),
    composeThreadMissing: t('chat.compose.threadMissing'),
    composeNotAllowed: t('chat.compose.notAllowed'),
  };
}
