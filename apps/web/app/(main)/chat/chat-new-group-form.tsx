'use client';

// ✅ 2026-10-19（#128）: グループを作る。名前と、連絡先から選んだ人。
// ✅ 2026-10-22（紺野「グループ作るがダサい」）: 連絡先の中の畳み欄をやめ、**一覧の列がまるごと「新しいグループ」に切り替わる**
//    画面（`f=newgroup`）にした。顔のアイコン・会社ごとの区切り・絞り込み・選んだ人の並び・下に固定した作成ボタン。
//    🔴 モーダルにしない —— 入力が 2 つ（名前と人）あるフォームはモーダルに入れない（`Dialog` の `body` は文字列だけ。UI 規約 §7.2）。
// 🔴 部屋の取引先・テナントは送らない（名前と人の ID だけ。サーバがメンバーの所属から決める。`lib/chat/rooms.ts`）。
// 🔴 取引先は 1 社まで（サーバが 400 にする）。画面でも、取引先の人を 1 人選んだら**ほかの取引先の欄を出さず**、理由を 1 行で書く
//    （押してから失敗させない）。
// 🔴 送信中・未入力でもボタンを `disabled` にしない（render テスト ②の規律）。押したときに足りないものを言う。
import Link from 'next/link';
import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Avatar, Button, Input, ROW_HOVER_CLASSES, cn } from '@ses/ui';
import { displayInitials } from '../../../lib/format/initials';
import { CHAT_CREATE_GROUP_API_PATH, chatHref } from '../../../lib/chat/screen-query';
import { showChatToast } from '../../../lib/chat/toast';

export type ChatNewGroupPerson = {
  readonly userId: string;
  readonly name: string;
  readonly status?: string | null;
};

/** 会社ごとの候補（連絡先と同じ母集団。`lib/chat/people.ts` が RLS で決めたものだけ）。 */
export type ChatNewGroupCompany = {
  readonly companyName: string;
  readonly isHost: boolean;
  readonly people: readonly ChatNewGroupPerson[];
};

export type ChatNewGroupFormProps = {
  readonly companies: readonly ChatNewGroupCompany[];
  readonly labels: {
    readonly title: string;
    readonly back: string;
    readonly name: string;
    readonly namePlaceholder: string;
    readonly search: string;
    readonly selected: string;
    readonly selectedNone: string;
    readonly self: string;
    readonly remove: string;
    readonly partnerLimit: string;
    readonly noMatch: string;
    readonly external: string;
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

const LABEL_CLASSES = 'm-0 text-xs text-fg-muted';

export function ChatNewGroupForm({ companies, labels }: ChatNewGroupFormProps) {
  const router = useRouter();
  const [title, setTitle] = useState('');
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<readonly string[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const byId = useMemo(() => {
    const map = new Map<string, { readonly person: ChatNewGroupPerson; readonly company: ChatNewGroupCompany }>();
    for (const company of companies) for (const person of company.people) map.set(person.userId, { person, company });
    return map;
  }, [companies]);

  // 選んだ人の中の取引先（0 か 1 社）。会社の名前で見分ける（取引先の ID は画面に持たない）。
  const chosenPartner = selected.map((id) => byId.get(id)?.company).find((company) => company !== undefined && !company.isHost) ?? null;

  const needle = query.trim().toLowerCase();
  const visible = companies
    .filter((company) => company.isHost || chosenPartner === null || company === chosenPartner)
    .map((company) => ({
      company,
      people:
        needle === '' || company.companyName.toLowerCase().includes(needle)
          ? company.people
          : company.people.filter((person) => person.name.toLowerCase().includes(needle)),
    }))
    .filter((entry) => entry.people.length > 0);
  const hiddenPartners = chosenPartner !== null && companies.some((company) => !company.isHost && company !== chosenPartner);

  function toggle(userId: string): void {
    setMessage(null);
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
    <section className="flex min-h-0 flex-1 flex-col" data-testid="chat-new-group">
      {/* 見出し（戻る + 表題） */}
      <div className="flex items-center gap-2 px-3 pt-3">
        <Link
          href={chatHref({ filter: { kind: 'contacts' } })}
          className={cn('rounded-md px-2 py-1 text-cell text-fg-muted', ROW_HOVER_CLASSES)}
          data-testid="chat-new-group-back"
        >
          {labels.back}
        </Link>
      </div>
      <h3 className="m-0 px-4 pt-1 pb-3 text-lg font-semibold text-fg">{labels.title}</h3>

      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-4 pb-4">
        {/* 名前 */}
        <div className="flex flex-col gap-1">
          <label className={LABEL_CLASSES} htmlFor="chat-new-group-title">
            {labels.name}
          </label>
          <Input
            id="chat-new-group-title"
            value={title}
            maxLength={GROUP_TITLE_MAX}
            placeholder={labels.namePlaceholder}
            onChange={(event) => {
              setMessage(null);
              setTitle(event.target.value);
            }}
            data-testid="chat-new-group-title"
          />
        </div>

        {/* 選んだ人（自分 + 選んだ人。押すと外せる） */}
        <div className="flex flex-col gap-2" data-testid="chat-new-group-selected">
          <p className={LABEL_CLASSES}>
            {labels.selected}
            <span className="ml-1 text-fg">{String(selected.length + 1)}</span>
          </p>
          <ul className="m-0 flex list-none flex-wrap gap-1 p-0">
            <li className="flex items-center gap-1 rounded-full bg-bg p-1 pr-3 text-cell text-fg-muted">
              <Avatar initials={displayInitials(labels.self)} title={labels.self} className="h-6 w-6 text-xs" />
              {labels.self}
            </li>
            {selected.map((id) => {
              const entry = byId.get(id);
              if (entry === undefined) return null;
              return (
                <li key={id}>
                  <button
                    type="button"
                    onClick={() => toggle(id)}
                    aria-label={`${entry.person.name}${labels.remove}`}
                    className="flex items-center gap-1 rounded-full bg-brand-bg p-1 pr-2 text-cell text-fg"
                    data-testid={`chat-new-group-chip-${id}`}
                  >
                    <Avatar initials={displayInitials(entry.person.name)} title={entry.person.name} className="h-6 w-6 text-xs" />
                    {entry.person.name}
                    <span aria-hidden="true" className="text-fg-muted">
                      ×
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
          {selected.length === 0 ? <p className="m-0 text-xs text-fg-placeholder">{labels.selectedNone}</p> : null}
        </div>

        {/* 絞り込み + 会社ごとの候補 */}
        <div className="flex flex-col gap-2">
          <label className="sr-only" htmlFor="chat-new-group-search">
            {labels.search}
          </label>
          <Input
            id="chat-new-group-search"
            type="search"
            value={query}
            placeholder={labels.search}
            onChange={(event) => setQuery(event.target.value)}
            data-testid="chat-new-group-search"
          />
          {visible.length === 0 ? <p className="m-0 py-2 text-cell text-fg-muted">{labels.noMatch}</p> : null}
          {visible.map(({ company, people }) => (
            <section key={company.companyName} className="flex flex-col">
              <h4 className="m-0 flex items-center gap-2 pt-2 pb-1 text-xs font-normal text-fg-muted">
                {company.companyName}
                {company.isHost ? null : <span className="rounded-xs bg-info-bg px-1 text-info">{labels.external}</span>}
              </h4>
              <ul className="m-0 list-none p-0">
                {people.map((person) => {
                  const on = selected.includes(person.userId);
                  return (
                    <li key={person.userId}>
                      <button
                        type="button"
                        role="checkbox"
                        aria-checked={on}
                        onClick={() => toggle(person.userId)}
                        className={cn(
                          'flex min-h-11 w-full items-center gap-3 rounded-md px-2 py-1 text-left',
                          on ? 'bg-brand-bg' : ROW_HOVER_CLASSES,
                        )}
                        data-testid={`chat-new-group-member-${person.userId}`}
                      >
                        <Avatar initials={displayInitials(person.name)} title={person.name} />
                        <span className="flex min-w-0 flex-1 flex-col">
                          <span className="truncate text-cell text-fg">{person.name}</span>
                          {person.status == null || person.status === '' ? null : (
                            <span className="truncate text-xs text-fg-placeholder">{person.status}</span>
                          )}
                        </span>
                        {/* 選んだかどうか（丸の中の ✓）。色だけに頼らず形でも分ける。 */}
                        <span
                          aria-hidden="true"
                          className={cn(
                            'flex h-5 w-5 shrink-0 items-center justify-center rounded-full border text-xs',
                            on ? 'border-brand bg-brand text-brand-fg' : 'border-border-strong bg-bg text-bg',
                          )}
                        >
                          ✓
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}
          {hiddenPartners ? (
            <p className="m-0 rounded-md bg-bg px-3 py-2 text-xs text-fg-muted" data-testid="chat-new-group-partner-limit">
              {labels.partnerLimit}
            </p>
          ) : null}
        </div>
      </div>

      {/* 下に固定した作成ボタン（候補が長くても常に見える） */}
      <div className="flex flex-col gap-2 border-t border-border bg-bg-subtle px-4 py-3">
        {message === null ? null : (
          <p role="status" className="m-0 text-xs text-danger" data-testid="chat-new-group-message">
            {message}
          </p>
        )}
        <Button type="button" onClick={() => void submit()} className="w-full" data-testid="chat-new-group-submit">
          {labels.submit}
        </Button>
      </div>
    </section>
  );
}
