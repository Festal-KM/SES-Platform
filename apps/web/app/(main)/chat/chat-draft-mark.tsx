'use client';

// apps/web/app/(main)/chat/chat-draft-mark.tsx
// ✅ 2026-10-16（チャットレーン）: 一覧の行の「下書き」の印（#110 ロードマップの 28。Slack に寄せる）。
//
// 🔴 下書きは `sessionStorage`（タブを閉じたら消える。`lib/chat/message-text.ts` の `chatDraftKey`）にしか無く、
//    サーバは知らない。したがって印もクライアントでだけ決める（水和の前は描かない = 印が無い状態から始まる）。
// 🔴 `@ses/db` / `@ses/i18n` を値 import しない（`tests/static/client-db-boundary.test.ts`）。語は props から。
import { useEffect, useState } from 'react';
import { Badge } from '@ses/ui';
import { CHAT_DRAFT_EVENT, hasChatDraft } from '../../../lib/chat/message-text';

export type ChatDraftMarkProps = {
  readonly threadId: string;
  readonly label: string;
};

// 色は UI_GUIDELINES §3.3「無彩 neutral = 状態なし・下書き」。
export function ChatDraftMark({ threadId, label }: ChatDraftMarkProps) {
  const [draft, setDraft] = useState(false);
  useEffect(() => {
    const refresh = (): void => setDraft(hasChatDraft(threadId));
    refresh();
    window.addEventListener(CHAT_DRAFT_EVENT, refresh);
    return () => window.removeEventListener(CHAT_DRAFT_EVENT, refresh);
  }, [threadId]);
  if (!draft) return null;
  return (
    <Badge variant="neutral" data-testid={`chat-thread-draft-${threadId}`}>
      {label}
    </Badge>
  );
}
