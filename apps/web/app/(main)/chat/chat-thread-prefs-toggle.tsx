'use client';

// apps/web/app/(main)/chat/chat-thread-prefs-toggle.tsx
// ✅ 2026-10-16（チャットレーン）: 会話の見出しの「ピン留め」「ミュート」の切り替え（自分の表示の設定）。
//
// 🔴 変えたら一覧を描き直す（`router.refresh()`。一覧はサーバで描いているため）。
// 🔴 `@ses/db` / `@ses/i18n` を値 import しない。語は props から。
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Icon, IconButton } from '@ses/ui';
import { chatThreadPrefsApiPath } from '../../../lib/chat/screen-query';

export type ChatThreadPrefsToggleProps = {
  readonly labelDisplay?: 'icon' | 'menu' | 'responsive';
  readonly threadId: string;
  readonly prefs: { readonly pinned: boolean; readonly muted: boolean };
  readonly labels: { readonly pin: string; readonly unpin: string; readonly mute: string; readonly unmute: string };
};

export function ChatThreadPrefsToggle({ threadId, prefs, labels, labelDisplay = 'icon' }: ChatThreadPrefsToggleProps) {
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
    <span className={labelDisplay === 'menu' ? 'flex shrink-0 flex-col items-stretch gap-1' : 'flex shrink-0 flex-col items-stretch gap-1 md:ml-auto md:flex-row md:items-center'}>
      <IconButton
        type="button"
        variant={current.pinned ? 'secondary' : 'ghost'}
        className={labelDisplay === 'icon' ? 'h-11 w-11 px-0' : labelDisplay === 'responsive' ? 'h-11 w-auto justify-start gap-2 px-4 md:w-11 md:justify-center md:px-0' : 'h-11 w-auto justify-start gap-2 px-4'}
        aria-label={current.pinned ? labels.unpin : labels.pin}
        title={current.pinned ? labels.unpin : labels.pin}
        aria-pressed={current.pinned}
        onClick={() => void toggle('pinned')}
        data-testid={`chat-thread-pin-${threadId}`}
        icon={<>
          <Icon name="chat-pin" />
          <span className={labelDisplay === 'icon' ? 'sr-only' : labelDisplay === 'responsive' ? 'md:sr-only' : undefined}>{current.pinned ? labels.unpin : labels.pin}</span>
        </>}
      />
      <IconButton
        type="button"
        variant={current.muted ? 'secondary' : 'ghost'}
        className={labelDisplay === 'icon' ? 'h-11 w-11 px-0' : labelDisplay === 'responsive' ? 'h-11 w-auto justify-start gap-2 px-4 md:w-11 md:justify-center md:px-0' : 'h-11 w-auto justify-start gap-2 px-4'}
        aria-label={current.muted ? labels.unmute : labels.mute}
        title={current.muted ? labels.unmute : labels.mute}
        aria-pressed={current.muted}
        onClick={() => void toggle('muted')}
        data-testid={`chat-thread-mute-${threadId}`}
        icon={<>
          <Icon name="chat-mute" />
          <span className={labelDisplay === 'icon' ? 'sr-only' : labelDisplay === 'responsive' ? 'md:sr-only' : undefined}>{current.muted ? labels.unmute : labels.mute}</span>
        </>}
      />
    </span>
  );
}
