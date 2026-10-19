'use client';

// apps/web/app/(main)/chat/chat-status-editor.tsx
// ✅ 2026-10-19（#128 §7.1 ①）: 自分のひとこと状態を設定する入口（`PUT /api/chat/status`）。
//
// 🔴 入力欄の下に注意書き（単価・エンド企業名を書かない）を常に出す —— 自由文が商流情報の通り道にならないように。
// 🔴 押せない表現（`disabled` / `opacity`）を使わない。送信中の二度押しは関数の中で止める。
// 🔴 `@ses/db` / `@ses/i18n` を値 import しない。語は props から。
import { useId, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button, Input } from '@ses/ui';
import { CHAT_USER_STATUS_API_PATH } from '../../../lib/chat/screen-query';

export type ChatStatusEditorLabels = {
  readonly open: string;
  readonly current: string;
  readonly label: string;
  readonly placeholder: string;
  readonly note: string;
  readonly save: string;
  readonly clear: string;
  readonly failed: string;
};

export type ChatStatusEditorProps = {
  readonly initialText: string;
  readonly maxLength: number;
  readonly labels: ChatStatusEditorLabels;
};

export function ChatStatusEditor({ initialText, maxLength, labels }: ChatStatusEditorProps) {
  const router = useRouter();
  const inputId = useId();
  const [saved, setSaved] = useState(initialText);
  const [draft, setDraft] = useState(initialText);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  async function save(text: string): Promise<void> {
    if (busy) return;
    setBusy(true);
    setFailed(false);
    try {
      const response = await fetch(CHAT_USER_STATUS_API_PATH, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ text: text.trim() }),
      });
      if (!response.ok) {
        setFailed(true);
        return;
      }
      const result = (await response.json()) as { readonly text: string };
      setSaved(result.text);
      setDraft(result.text);
      router.refresh();
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  }

  return (
    <details className="mb-4" data-testid="chat-status">
      <summary className="cursor-pointer text-cell text-fg-muted" data-testid="chat-status-open">
        {saved === '' ? labels.open : `${labels.current}: ${saved}`}
      </summary>
      {/* 🔴 `method="post"`: 水和前の送信が既定の GET で入力値を URL に載せるのを塞ぐ（tests/static/form-method-required.test.ts）。 */}
      <form
        method="post"
        className="flex flex-col gap-2 pt-2"
        onSubmit={(event) => {
          event.preventDefault();
          void save(draft);
        }}
      >
        <label htmlFor={inputId} className="text-xs text-fg-muted">
          {labels.label}
        </label>
        <span className="flex items-center gap-2">
          <Input
            id={inputId}
            type="text"
            value={draft}
            maxLength={maxLength}
            placeholder={labels.placeholder}
            onChange={(event) => setDraft(event.target.value)}
            className="min-w-0 flex-1"
            data-testid="chat-status-input"
          />
          <Button type="submit" size="sm" data-testid="chat-status-save">
            {labels.save}
          </Button>
          {saved === '' ? null : (
            <Button type="button" variant="ghost" size="sm" onClick={() => void save('')} data-testid="chat-status-clear">
              {labels.clear}
            </Button>
          )}
        </span>
        <p className="m-0 text-xs text-fg-muted" data-testid="chat-status-note">
          {labels.note}
        </p>
        {failed ? (
          <p role="status" className="m-0 text-xs text-fg-muted" data-testid="chat-status-failed">
            {labels.failed}
          </p>
        ) : null}
      </form>
    </details>
  );
}
