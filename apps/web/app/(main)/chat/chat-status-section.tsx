// apps/web/app/(main)/chat/chat-status-section.tsx
// ✅ 2026-10-19（#128 §7.1 ①）: ひとこと状態の入口（サーバ側の包み）。
// 🔴 閲覧専用（投稿できないロール。`lib/chat/policy.ts` の CHAT_POST_ROLES 外）には入口を描かない
//    （押せない入口を置かない。拒否の本体は API の `requireRole` / `requireNotViewer`）。
// 🔴 サーバコンポーネント（`'use client'` を宣言しない）。文言はここで引いて渡す。
import { t } from '@ses/i18n';
import { CHAT_USER_STATUS_MAX_LENGTH } from '../../../lib/chat/schemas';
import { ChatStatusEditor } from './chat-status-editor';

export type ChatStatusSectionProps = {
  readonly canPost: boolean;
  /** 自分の今の状態（無ければ空文字）。 */
  readonly text: string;
};

export function ChatStatusSection({ canPost, text }: ChatStatusSectionProps) {
  if (!canPost) return null;
  return (
    <ChatStatusEditor
      initialText={text}
      maxLength={CHAT_USER_STATUS_MAX_LENGTH}
      labels={{
        open: t('chat.status.open'),
        current: t('chat.status.current'),
        label: t('chat.status.label'),
        placeholder: t('chat.status.placeholder'),
        note: t('chat.status.note'),
        save: t('chat.status.save'),
        clear: t('chat.status.clear'),
        failed: t('chat.status.failed'),
        savedToast: t('chat.toast.statusSaved'),
        clearedToast: t('chat.toast.statusCleared'),
        toastLink: t('chat.toast.backToChat'),
      }}
    />
  );
}
