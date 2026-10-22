'use client';

// apps/web/app/(main)/chat/chat-status-editor.tsx
// ✅ 2026-10-19（#128 §7.1 ①）: 自分のひとこと状態を設定する入口（`PUT /api/chat/status`）。
//
// 🔴 入力欄の下に注意書き（単価・エンド企業名を書かない）を常に出す —— 自由文が商流情報の通り道にならないように。
// 🔴 押せない表現（`disabled` / `opacity`）を使わない。送信中の二度押しは関数の中で止める。
// 🔴 `@ses/db` / `@ses/i18n` を値 import しない。語は props から。
import { useId, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button, Input, cn } from '@ses/ui';
import { CHAT_PATH, CHAT_USER_STATUS_API_PATH } from '../../../lib/chat/screen-query';
import { showChatToast } from '../../../lib/chat/toast';

export type ChatStatusEditorLabels = {
  readonly open: string;
  readonly current: string;
  readonly label: string;
  readonly placeholder: string;
  readonly note: string;
  readonly save: string;
  readonly clear: string;
  readonly failed: string;
  /** ✅ 2026-10-20: 保存したときのトースト（`lib/chat/toast.ts`）。 */
  readonly savedToast: string;
  readonly clearedToast: string;
  readonly toastLink: string;
  /** ✅ 2026-10-22: 「よく使う」の見出し（読み上げ用）。 */
  readonly presets: string;
};

export type ChatStatusEditorProps = {
  readonly initialText: string;
  readonly maxLength: number;
  readonly labels: ChatStatusEditorLabels;
  /** ✅ 2026-10-22: よく使う言い回し（押すと入力欄に入る）。 */
  readonly presets: readonly string[];
};

export function ChatStatusEditor({ initialText, maxLength, labels, presets }: ChatStatusEditorProps) {
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
      showChatToast({ message: result.text === '' ? labels.clearedToast : labels.savedToast, href: CHAT_PATH, linkLabel: labels.toastLink });
      router.refresh();
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  }

  return (
    // ✅ 2026-10-22（紺野「ステータスなんかおかしくね」）: ページ見出しの下の文字だけの入口をやめ、**左の列のいちばん上**に置いた
    //    （開いても会話が下へ押されない）。今の状態は丸い札で見せ、よく使う言い回しは押すだけで入る。
    <details className="rounded-md bg-bg p-2" data-testid="chat-status">
      <summary className="flex cursor-pointer list-none flex-col gap-1" data-testid="chat-status-open">
        <span className="text-xs text-fg-muted">{labels.current}</span>
        {saved === '' ? (
          <span className="text-cell text-brand">{labels.open}</span>
        ) : (
          <span className="truncate rounded-full bg-bg-inset px-2 text-xs text-fg">{saved}</span>
        )}
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
        <label htmlFor={inputId} className="sr-only">
          {labels.label}
        </label>
        <Input
          id={inputId}
          type="text"
          value={draft}
          maxLength={maxLength}
          placeholder={labels.placeholder}
          onChange={(event) => setDraft(event.target.value)}
          data-testid="chat-status-input"
        />
        {/* よく使う言い回し（押すと入力欄に入る。保存は「保存」で） */}
        <ul className="m-0 flex list-none flex-wrap gap-1 p-0" aria-label={labels.presets} data-testid="chat-status-presets">
          {presets.map((preset) => (
            <li key={preset}>
              <button
                type="button"
                onClick={() => setDraft(preset)}
                className={cn('rounded-full px-2 py-1 text-xs', draft === preset ? 'bg-brand-bg text-brand' : 'bg-bg-inset text-fg-muted')}
              >
                {preset}
              </button>
            </li>
          ))}
        </ul>
        <p className="m-0 text-xs text-fg-muted" data-testid="chat-status-note">
          {labels.note}
        </p>
        <span className="flex items-center gap-2">
          <Button type="submit" size="sm" data-testid="chat-status-save">
            {labels.save}
          </Button>
          {saved === '' ? null : (
            <Button type="button" variant="ghost" size="sm" onClick={() => void save('')} data-testid="chat-status-clear">
              {labels.clear}
            </Button>
          )}
        </span>
        {failed ? (
          <p role="status" className="m-0 text-xs text-danger" data-testid="chat-status-failed">
            {labels.failed}
          </p>
        ) : null}
      </form>
    </details>
  );
}
