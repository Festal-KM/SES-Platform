'use client';

// ✅ 2026-10-22（紺野「自分だけ」）: 自分の定型文の管理画面（`f=templates`）。一覧の列がまるごと切り替わる（「新しいグループ」と同じ作り）。
//    上 = 作った定型文の一覧（直す・削除）、下 = 作る / 直す欄。
// 🔴 自分の定型文だけ（会社共通は作らない）。誰の定型文かは送らない（サーバが認証コンテキストの本人に書く）。
// 🔴 入力欄の下に注意書き（単価・エンド企業名を書かない）を常に出す —— 自由文が商流情報の通り道にならないように（ひとこと状態と同じ）。
// 🔴 押せない表現（`disabled`）を使わない。送信中の二度押しは関数の中で止め、足りないものは押したときに言う。
// 🔴 削除の確認はモーダル（`Dialog`）。確定の操作は 1 つ。
// 🔴 `@ses/db` / `@ses/i18n` を値 import しない。語は props から。
import Link from 'next/link';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button, Input, ROW_HOVER_CLASSES, Textarea, cn } from '@ses/ui';
import { Dialog } from '@ses/ui/client';
import { CHAT_TEMPLATES_API_PATH, chatTemplateApiPath } from '../../../lib/chat/screen-query';
import { showChatToast } from '../../../lib/chat/toast';

export type ChatTemplateItem = { readonly id: string; readonly label: string; readonly body: string };

export type ChatTemplateManagerProps = {
  readonly templates: readonly ChatTemplateItem[];
  /** 一覧（「すべて」）に戻る行き先（開いている会話は残す）。 */
  readonly backHref: string;
  readonly limits: { readonly label: number; readonly body: number; readonly count: number };
  readonly labels: {
    readonly back: string;
    readonly title: string;
    readonly description: string;
    readonly countUnit: string;
    readonly empty: string;
    readonly newHeading: string;
    readonly editHeading: string;
    readonly label: string;
    readonly labelPlaceholder: string;
    readonly body: string;
    readonly bodyPlaceholder: string;
    readonly note: string;
    readonly create: string;
    readonly update: string;
    readonly cancel: string;
    readonly edit: string;
    readonly remove: string;
    readonly deleteTitle: string;
    readonly deleteConfirm: string;
    readonly deleteYes: string;
    readonly needLabel: string;
    readonly needBody: string;
    readonly limit: string;
    readonly failed: string;
    readonly savedToast: string;
    readonly deletedToast: string;
    readonly toastLink: string;
  };
};

const LABEL_CLASSES = 'm-0 text-xs text-fg-muted';

export function ChatTemplateManager({ templates, backHref, limits, labels }: ChatTemplateManagerProps) {
  const router = useRouter();
  const [items, setItems] = useState<readonly ChatTemplateItem[]>(templates);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [label, setLabel] = useState('');
  const [body, setBody] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  function startEdit(item: ChatTemplateItem): void {
    setEditingId(item.id);
    setLabel(item.label);
    setBody(item.body);
    setMessage(null);
    document.getElementById('chat-template-label')?.focus();
  }

  function resetForm(): void {
    setEditingId(null);
    setLabel('');
    setBody('');
    setMessage(null);
  }

  async function submit(): Promise<void> {
    if (busy) return;
    const trimmedLabel = label.trim();
    const trimmedBody = body.trim();
    if (trimmedLabel === '') {
      setMessage(labels.needLabel);
      return;
    }
    if (trimmedBody === '') {
      setMessage(labels.needBody);
      return;
    }
    if (editingId === null && items.length >= limits.count) {
      setMessage(labels.limit);
      return;
    }
    setBusy(true);
    setMessage(null);
    try {
      const response = await fetch(editingId === null ? CHAT_TEMPLATES_API_PATH : chatTemplateApiPath(editingId), {
        method: editingId === null ? 'POST' : 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ label: trimmedLabel, body: trimmedBody }),
      });
      if (!response.ok) {
        setMessage(response.status === 409 ? labels.limit : labels.failed);
        return;
      }
      const { template } = (await response.json()) as { readonly template: ChatTemplateItem };
      setItems((current) =>
        editingId === null ? [...current, template] : current.map((entry) => (entry.id === template.id ? template : entry)),
      );
      resetForm();
      showChatToast({ message: labels.savedToast, href: backHref, linkLabel: labels.toastLink });
      router.refresh();
    } catch {
      setMessage(labels.failed);
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string): Promise<void> {
    setConfirmDeleteId(null);
    try {
      const response = await fetch(chatTemplateApiPath(id), { method: 'DELETE' });
      if (!response.ok) {
        setMessage(labels.failed);
        return;
      }
      setItems((current) => current.filter((entry) => entry.id !== id));
      if (editingId === id) resetForm();
      showChatToast({ message: labels.deletedToast, href: backHref, linkLabel: labels.toastLink });
      router.refresh();
    } catch {
      setMessage(labels.failed);
    }
  }

  return (
    <section className="flex min-h-0 flex-1 flex-col" data-testid="chat-templates">
      <div className="flex items-center gap-2 px-3 pt-3">
        <Link href={backHref} className={cn('rounded-md px-2 py-1 text-cell text-fg-muted', ROW_HOVER_CLASSES)} data-testid="chat-templates-back">
          {labels.back}
        </Link>
      </div>
      <h3 className="m-0 flex items-baseline gap-2 px-4 pt-1 text-lg font-semibold text-fg">
        {labels.title}
        <span className="text-xs font-normal text-fg-muted" data-testid="chat-templates-count">
          {`${String(items.length)} / ${String(limits.count)} ${labels.countUnit}`}
        </span>
      </h3>
      <p className="m-0 px-4 pt-1 pb-3 text-xs text-fg-muted">{labels.description}</p>

      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-4 pb-4">
        {items.length === 0 ? (
          <p className="m-0 text-cell text-fg-muted" data-testid="chat-templates-empty">
            {labels.empty}
          </p>
        ) : (
          <ul className="m-0 flex list-none flex-col gap-1 p-0" data-testid="chat-templates-list">
            {items.map((item) => (
              <li
                key={item.id}
                className={cn('flex items-start gap-2 rounded-md px-2 py-2', editingId === item.id ? 'bg-brand-bg' : ROW_HOVER_CLASSES)}
                data-testid={`chat-template-${item.id}`}
              >
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate text-cell text-fg">{item.label}</span>
                  <span className="truncate text-xs text-fg-muted">{item.body}</span>
                </span>
                <Button type="button" variant="ghost" size="sm" onClick={() => startEdit(item)} data-testid={`chat-template-edit-${item.id}`}>
                  {labels.edit}
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => setConfirmDeleteId(item.id)}
                  data-testid={`chat-template-delete-${item.id}`}
                >
                  {labels.remove}
                </Button>
              </li>
            ))}
          </ul>
        )}

        {/* 作る / 直す欄。🔴 `method="post"`: 水和前の送信が既定の GET で入力値を URL に載せるのを塞ぐ（tests/static/form-method-required.test.ts）。 */}
        <form
          method="post"
          className="flex flex-col gap-2 border-t border-border pt-4"
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
          data-testid="chat-template-form"
        >
          <p className="m-0 text-cell font-medium text-fg">{editingId === null ? labels.newHeading : labels.editHeading}</p>
          <label className={LABEL_CLASSES} htmlFor="chat-template-label">
            {labels.label}
          </label>
          <Input
            id="chat-template-label"
            value={label}
            maxLength={limits.label}
            placeholder={labels.labelPlaceholder}
            onChange={(event) => {
              setMessage(null);
              setLabel(event.target.value);
            }}
            data-testid="chat-template-label"
          />
          <label className={LABEL_CLASSES} htmlFor="chat-template-body">
            {labels.body}
          </label>
          <Textarea
            id="chat-template-body"
            value={body}
            maxLength={limits.body}
            placeholder={labels.bodyPlaceholder}
            className="min-h-12 max-h-40 overflow-y-auto"
            onChange={(event) => {
              setMessage(null);
              setBody(event.target.value);
            }}
            data-testid="chat-template-body"
          />
          <p className="m-0 text-xs text-fg-muted" data-testid="chat-template-note">
            {labels.note}
          </p>
          {message === null ? null : (
            <p role="status" className="m-0 text-xs text-danger" data-testid="chat-template-message">
              {message}
            </p>
          )}
          <div className="flex items-center gap-2">
            <Button type="submit" size="sm" data-testid="chat-template-submit">
              {editingId === null ? labels.create : labels.update}
            </Button>
            {editingId === null ? null : (
              <Button type="button" variant="ghost" size="sm" onClick={resetForm} data-testid="chat-template-cancel">
                {labels.cancel}
              </Button>
            )}
          </div>
        </form>
      </div>

      <Dialog
        open={confirmDeleteId !== null}
        onOpenChange={(next) => {
          if (!next) setConfirmDeleteId(null);
        }}
        title={labels.deleteTitle}
        body={labels.deleteConfirm}
        cancelLabel={labels.cancel}
        confirm={
          <Button
            type="button"
            variant="primary"
            onClick={() => {
              if (confirmDeleteId !== null) void remove(confirmDeleteId);
            }}
            data-testid={`chat-template-delete-yes-${confirmDeleteId ?? 'none'}`}
          >
            {labels.deleteYes}
          </Button>
        }
      />
    </section>
  );
}
