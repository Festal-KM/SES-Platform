'use client';

// ✅ 2026-10-20（紺野「トースト」）: チャット画面のトーストの置き場（`lib/chat/toast.ts`）。
// 🔴 1 件だけ。新しいものが来たら置き換える。閉じたら保存した分も消す。
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Toast } from '@ses/ui/client';
import { CHAT_TOAST_EVENT, CHAT_TOAST_STORAGE_KEY, parseChatToast, type ChatToastPayload } from '../../../lib/chat/toast';

export type ChatToastHostProps = {
  readonly kindLabel: string;
  readonly dismissLabel: string;
};

export function ChatToastHost({ kindLabel, dismissLabel }: ChatToastHostProps) {
  const [toast, setToast] = useState<ChatToastPayload | null>(null);

  useEffect(() => {
    try {
      setToast(parseChatToast(window.sessionStorage.getItem(CHAT_TOAST_STORAGE_KEY)));
    } catch {
      // 読めないときは出さない。
    }
    const onToast = (event: Event) => setToast(parseChatToast(JSON.stringify((event as CustomEvent<unknown>).detail)));
    window.addEventListener(CHAT_TOAST_EVENT, onToast);
    return () => window.removeEventListener(CHAT_TOAST_EVENT, onToast);
  }, []);

  function dismiss(): void {
    setToast(null);
    try {
      window.sessionStorage.removeItem(CHAT_TOAST_STORAGE_KEY);
    } catch {
      // 消せなくても表示は閉じる。
    }
  }

  return (
    <Toast
      open={toast !== null}
      kind="completed"
      kindLabel={kindLabel}
      message={toast?.message ?? ''}
      subject={{ href: toast?.href ?? '/chat', label: toast?.linkLabel ?? '' }}
      linkComponent={Link}
      dismissLabel={dismissLabel}
      onDismiss={dismiss}
      data-testid="chat-toast"
    />
  );
}
