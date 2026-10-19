'use client';

// ✅ 2026-10-19（#128）: その人との DM を開く（無ければ作る）。連絡先・メンバーの欄から使う。
// 🔴 部屋の取引先・テナントは送らない（相手の ID だけ。サーバがメンバーの所属から決める。`lib/chat/rooms.ts`）。
// 🔴 失敗したら黙らず、押した場所に一言出す（相手が見えない・取引先どうしなど。理由は書き分けない）。
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@ses/ui';
import { CHAT_OPEN_DM_API_PATH, chatHref } from '../../../lib/chat/screen-query';

export type ChatOpenDmButtonProps = {
  readonly userId: string;
  readonly label: string;
  readonly failedLabel: string;
  /** 一覧の行として出すときは名前を本文にする（`label` は読み上げ用）。 */
  readonly children?: React.ReactNode;
};

export function ChatOpenDmButton({ userId, label, failedLabel, children }: ChatOpenDmButtonProps) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  async function open(): Promise<void> {
    if (busy) return;
    setBusy(true);
    setFailed(false);
    try {
      const response = await fetch(CHAT_OPEN_DM_API_PATH, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ userId }),
      });
      if (!response.ok) {
        setFailed(true);
        return;
      }
      const { id } = (await response.json()) as { readonly id: string };
      router.push(chatHref({ thread: id }));
      router.refresh();
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  }

  return (
    <span className="flex min-w-0 flex-col">
      <Button
        type="button"
        variant="ghost"
        size="sm"
        aria-label={label}
        onClick={() => void open()}
        className="min-w-0 justify-start"
        data-testid={`chat-open-dm-${userId}`}
      >
        {children ?? label}
      </Button>
      {failed ? (
        <span role="status" className="px-3 text-xs text-fg-muted">
          {failedLabel}
        </span>
      ) : null}
    </span>
  );
}
