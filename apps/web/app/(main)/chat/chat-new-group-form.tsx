'use client';

// ✅ 2026-10-19（#128）: グループを作る（「＋ 新しい会話」の中）。名前と、連絡先から選んだ人。
// 🔴 部屋の取引先・テナントは送らない（名前と人の ID だけ。サーバがメンバーの所属から決める。`lib/chat/rooms.ts`）。
// 🔴 取引先が 2 社以上混ざる・取引先の人だけ、はサーバが 400 にする。画面は理由を書き分けず「作れませんでした」と出す。
// 🔴 送信中・未入力でもボタンを `disabled` にしない（render テスト ②の規律）。押したときに足りないものを言う。
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button, Checkbox, Input } from '@ses/ui';
import { CHAT_CREATE_GROUP_API_PATH, chatHref } from '../../../lib/chat/screen-query';
import { showChatToast } from '../../../lib/chat/toast';

export type ChatNewGroupFormProps = {
  readonly people: readonly { readonly userId: string; readonly name: string; readonly companyName: string | null }[];
  readonly labels: {
    readonly heading: string;
    readonly name: string;
    readonly namePlaceholder: string;
    readonly members: string;
    readonly submit: string;
    readonly needName: string;
    readonly needMembers: string;
    readonly failed: string;
    /** ✅ 2026-10-20: 作ったときのトースト（`lib/chat/toast.ts`）。 */
    readonly createdToast: string;
    readonly openGroup: string;
  };
};

/** グループの名前の上限（DB の CHECK と同じ）。 */
const GROUP_TITLE_MAX = 100;

export function ChatNewGroupForm({ people, labels }: ChatNewGroupFormProps) {
  const router = useRouter();
  const [title, setTitle] = useState('');
  const [selected, setSelected] = useState<readonly string[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function toggle(userId: string): void {
    setSelected((current) => (current.includes(userId) ? current.filter((id) => id !== userId) : [...current, userId]));
  }

  async function submit(): Promise<void> {
    if (busy) return;
    const name = title.trim();
    if (name === '') {
      setMessage(labels.needName);
      return;
    }
    if (selected.length === 0) {
      setMessage(labels.needMembers);
      return;
    }
    setBusy(true);
    setMessage(null);
    try {
      const response = await fetch(CHAT_CREATE_GROUP_API_PATH, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ title: name, userIds: selected }),
      });
      if (!response.ok) {
        setMessage(labels.failed);
        return;
      }
      const { id } = (await response.json()) as { readonly id: string };
      setTitle('');
      setSelected([]);
      showChatToast({ message: labels.createdToast, href: chatHref({ thread: id }), linkLabel: labels.openGroup });
      router.push(chatHref({ thread: id }));
      router.refresh();
    } catch {
      setMessage(labels.failed);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="flex flex-col gap-2 px-3 pt-3 pb-2" data-testid="chat-new-group">
      <h4 className="m-0 text-xs font-normal text-fg-muted">{labels.heading}</h4>
      <label className="sr-only" htmlFor="chat-new-group-title">
        {labels.name}
      </label>
      <Input
        id="chat-new-group-title"
        value={title}
        maxLength={GROUP_TITLE_MAX}
        placeholder={labels.namePlaceholder}
        onChange={(event) => setTitle(event.target.value)}
        data-testid="chat-new-group-title"
      />
      <fieldset className="m-0 flex flex-col gap-1 border-0 p-0">
        <legend className="text-xs text-fg-muted">{labels.members}</legend>
        {people.map((person) => (
          <label key={person.userId} className="flex items-center gap-2 text-cell text-fg">
            <Checkbox
              checked={selected.includes(person.userId)}
              onChange={() => toggle(person.userId)}
              data-testid={`chat-new-group-member-${person.userId}`}
            />
            <span className="min-w-0 truncate">{person.name}</span>
            <span className="shrink-0 truncate text-xs text-fg-muted">{person.companyName ?? ''}</span>
          </label>
        ))}
      </fieldset>
      {message === null ? null : (
        <p role="status" className="m-0 text-xs text-fg-muted" data-testid="chat-new-group-message">
          {message}
        </p>
      )}
      <Button type="button" variant="secondary" size="sm" onClick={() => void submit()} data-testid="chat-new-group-submit">
        {labels.submit}
      </Button>
    </section>
  );
}
