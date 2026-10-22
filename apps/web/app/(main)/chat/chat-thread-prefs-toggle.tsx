'use client';

// apps/web/app/(main)/chat/chat-thread-prefs-toggle.tsx
// ✅ 2026-10-16（チャットレーン）: 会話の見出しの「ピン留め」「ミュート」の切り替え（自分の表示の設定）。
//
// 🔴 変えたら一覧を描き直す（`router.refresh()`。一覧はサーバで描いているため）。
// 🔴 `@ses/db` / `@ses/i18n` を値 import しない。語は props から。
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@ses/ui';
import { chatThreadPrefsApiPath } from '../../../lib/chat/screen-query';

export type ChatThreadPrefsToggleProps = {
  readonly threadId: string;
  readonly prefs: { readonly pinned: boolean; readonly muted: boolean };
  readonly labels: { readonly pin: string; readonly unpin: string; readonly mute: string; readonly unmute: string };
};

export function ChatThreadPrefsToggle({ threadId, prefs, labels }: ChatThreadPrefsToggleProps) {
  const router = useRouter();
  const [current, setCurrent] = useState(prefs);

  async function toggle(key: 'pinned' | 'muted'): Promise<void> {
    try {
      const response = await fetch(chatThreadPrefsApiPath(threadId), {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ [key]: !current[key] }),
      });
      if (!response.ok) return;
      setCurrent((await response.json()) as { readonly pinned: boolean; readonly muted: boolean });
      router.refresh();
    } catch {
      // 変えられなければ何も変えない。
    }
  }

  return (
    <span className="flex shrink-0 flex-col items-stretch gap-1 md:ml-auto md:flex-row md:items-center">
      <Button
        type="button"
        variant="ghost"
        size="sm"
        aria-pressed={current.pinned}
        onClick={() => void toggle('pinned')}
        data-testid={`chat-thread-pin-${threadId}`}
      >
        {current.pinned ? labels.unpin : labels.pin}
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        aria-pressed={current.muted}
        onClick={() => void toggle('muted')}
        data-testid={`chat-thread-mute-${threadId}`}
      >
        {current.muted ? labels.unmute : labels.mute}
      </Button>
    </span>
  );
}
