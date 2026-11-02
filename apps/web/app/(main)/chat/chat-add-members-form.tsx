'use client';

// apps/web/app/(main)/chat/chat-add-members-form.tsx
// ✅ 2026-11-01（紺野の決定。F-038 改訂 17 / S-031 改訂 48）: グループに後から人を足す画面（`add=1`）。
// 会話の列がこの画面に切り替わる（スマホでも同じ 1 列。モーダルにしない —— 入力が 2 つ〔人と範囲〕あるフォームのため）。
//
// 🔴 ここが守るもの
//   ① 送るのは人の ID と範囲の選び方だけ（部屋・テナント・取引先は送らない。サーバが部屋から決める。`lib/chat/rooms.ts` ⑤）。
//   ② 候補はサーバが部屋の取引先の決まりで絞ったものだけ（社内だけの部屋はホストだけ、取引先との部屋はホストとその取引先）。
//      いまのメンバーは「参加中」として出し、選べない。
//   ③ 送信中・未選択でもボタンを `disabled` にしない。押したときに足りないものを言う。
//   ④ 文言は持たない（`@ses/i18n` を読まない。サーバの部品が渡す）。
import Link from 'next/link';
import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Avatar, Button, Input, Radio, ROW_HOVER_CLASSES, cn } from '@ses/ui';
import { displayInitials } from '../../../lib/format/initials';
import { CHAT_GROUP_MAX_MEMBERS } from '../../../lib/chat/policy';
import { chatGroupMembersApiPath } from '../../../lib/chat/screen-query';
import { showChatToast } from '../../../lib/chat/toast';
import { ChatPeoplePicker, type ChatPeoplePickerLabels, type ChatPickerCompany, type ChatPickerPerson } from './chat-people-picker';

export type ChatAddMembersHistory = 'ALL' | 'JOINED' | 'DATE';

export type ChatAddMembersFormProps = {
  readonly threadId: string;
  readonly companies: readonly ChatPickerCompany[];
  /** いまのメンバー（選べない）。 */
  readonly memberUserIds: readonly string[];
  /** 会話に戻る行き先。 */
  readonly backHref: string;
  /** 日本時間の今日（`YYYY-MM-DD`）。日付の上限。 */
  readonly todayJst: string;
  /** 部屋の取引先の決まりの説明（社内だけ / 取引先との部屋）。 */
  readonly ruleNote: string;
  readonly truncated: boolean;
  readonly labels: {
    readonly title: string;
    readonly back: string;
    readonly search: string;
    readonly selected: string;
    readonly selectedNone: string;
    readonly remove: string;
    readonly history: string;
    readonly historyAll: string;
    readonly historyJoined: string;
    readonly historyDate: string;
    readonly historyDateLabel: string;
    readonly historyNote: string;
    readonly quoteNote: string;
    readonly submit: string;
    readonly needMembers: string;
    readonly needDate: string;
    readonly futureDate: string;
    readonly limit: string;
    readonly failed: string;
    readonly rejected: string;
    readonly truncated: string;
    readonly addedToast: string;
    readonly openGroup: string;
  };
  readonly pickerLabels: ChatPeoplePickerLabels;
};

const LABEL_CLASSES = 'm-0 text-xs text-fg-muted';

/** 押したときの検査（純粋関数。足りないものを 1 つ返す。良ければ `null`）。 */
export function addMembersProblem(input: {
  readonly selectedCount: number;
  readonly memberCount: number;
  readonly history: ChatAddMembersHistory;
  readonly historyDate: string;
  readonly todayJst: string;
}): 'needMembers' | 'limit' | 'needDate' | 'futureDate' | null {
  if (input.selectedCount === 0) return 'needMembers';
  if (input.memberCount + input.selectedCount > CHAT_GROUP_MAX_MEMBERS) return 'limit';
  if (input.history === 'DATE') {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(input.historyDate)) return 'needDate';
    if (input.historyDate > input.todayJst) return 'futureDate';
  }
  return null;
}

export function ChatAddMembersForm({
  threadId,
  companies,
  memberUserIds,
  backHref,
  todayJst,
  ruleNote,
  truncated,
  labels,
  pickerLabels,
}: ChatAddMembersFormProps) {
  const router = useRouter();
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<readonly string[]>([]);
  const [history, setHistory] = useState<ChatAddMembersHistory>('ALL');
  const [historyDate, setHistoryDate] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const byId = useMemo(() => {
    const map = new Map<string, ChatPickerPerson>();
    for (const company of companies) for (const person of company.people) map.set(person.userId, person);
    return map;
  }, [companies]);

  function toggle(userId: string): void {
    if (memberUserIds.includes(userId)) return;
    setMessage(null);
    setSelected((current) => (current.includes(userId) ? current.filter((id) => id !== userId) : [...current, userId]));
  }

  async function submit(): Promise<void> {
    if (busy) return;
    const problem = addMembersProblem({ selectedCount: selected.length, memberCount: memberUserIds.length, history, historyDate, todayJst });
    if (problem !== null) {
      setMessage(labels[problem]);
      return;
    }
    setBusy(true);
    setMessage(null);
    try {
      const response = await fetch(chatGroupMembersApiPath(threadId), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ userIds: selected, history, ...(history === 'DATE' ? { historyDate } : {}) }),
      });
      if (!response.ok) {
        setMessage(response.status === 400 || response.status === 404 ? labels.rejected : labels.failed);
        return;
      }
      setSelected([]);
      showChatToast({ message: labels.addedToast, href: backHref, linkLabel: labels.openGroup });
      router.push(backHref);
      router.refresh();
    } catch {
      setMessage(labels.failed);
    } finally {
      setBusy(false);
    }
  }

  const options: readonly { readonly value: ChatAddMembersHistory; readonly label: string }[] = [
    { value: 'ALL', label: labels.historyAll },
    { value: 'JOINED', label: labels.historyJoined },
    { value: 'DATE', label: labels.historyDate },
  ];

  return (
    <section className="flex min-h-0 flex-1 flex-col" data-testid="chat-add-members">
      <div className="flex items-center gap-2 px-3 pt-3">
        <Link
          href={backHref}
          className={cn('flex min-h-11 items-center rounded-md px-2 py-1 text-cell text-fg-muted', ROW_HOVER_CLASSES)}
          data-testid="chat-add-members-back"
        >
          {labels.back}
        </Link>
      </div>
      <h3 className="m-0 px-4 pt-1 pb-3 text-lg font-semibold text-fg">{labels.title}</h3>

      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-4 pb-4">
        {/* 選んだ人（押すと外せる） */}
        <div className="flex flex-col gap-2" data-testid="chat-add-members-selected">
          <p className={LABEL_CLASSES}>
            {labels.selected}
            <span className="ml-1 text-fg">{String(selected.length)}</span>
          </p>
          {selected.length === 0 ? (
            <p className="m-0 text-xs text-fg-placeholder">{labels.selectedNone}</p>
          ) : (
            <ul className="m-0 flex list-none flex-wrap gap-1 p-0">
              {selected.map((id) => {
                const person = byId.get(id);
                if (person === undefined) return null;
                return (
                  <li key={id}>
                    <Button
                      type="button"
                      variant="secondary"
                      size="sm"
                      onClick={() => toggle(id)}
                      aria-label={`${person.name}${labels.remove}`}
                      className="gap-1"
                      data-testid={`chat-add-members-chip-${id}`}
                    >
                      <Avatar initials={displayInitials(person.name)} title={person.name} className="h-6 w-6 text-xs" />
                      {person.name}
                      <span aria-hidden="true" className="text-fg-muted">
                        ×
                      </span>
                    </Button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        {/* 読める過去の範囲 */}
        <fieldset className="m-0 flex flex-col gap-2 border-0 p-0" data-testid="chat-add-members-history">
          <legend className={cn(LABEL_CLASSES, 'pb-1')}>{labels.history}</legend>
          {options.map((option) => (
            <label key={option.value} className="flex min-h-11 items-center gap-2 text-cell text-fg">
              <Radio
                name={`chat-add-members-history-${threadId}`}
                value={option.value}
                checked={history === option.value}
                onChange={() => {
                  setMessage(null);
                  setHistory(option.value);
                }}
                data-testid={`chat-add-members-history-${option.value}`}
              />
              {option.label}
            </label>
          ))}
          {history === 'DATE' ? (
            <div className="flex flex-col gap-1 pl-6">
              <label className={LABEL_CLASSES} htmlFor={`chat-add-members-date-${threadId}`}>
                {labels.historyDateLabel}
              </label>
              <Input
                id={`chat-add-members-date-${threadId}`}
                type="date"
                value={historyDate}
                max={todayJst}
                onChange={(event) => {
                  setMessage(null);
                  setHistoryDate(event.target.value);
                }}
                data-testid="chat-add-members-date"
              />
            </div>
          ) : null}
          {history === 'ALL' ? null : (
            <p className="m-0 text-xs text-fg-muted" data-testid="chat-add-members-history-note">
              {labels.historyNote} {labels.quoteNote}
            </p>
          )}
        </fieldset>

        {/* 絞り込み + 候補（いまのメンバーは「参加中」） */}
        <div className="flex flex-col gap-2">
          <p className="m-0 rounded-md bg-bg px-3 py-2 text-xs text-fg-muted" data-testid="chat-add-members-rule">
            {ruleNote}
          </p>
          <label className="sr-only" htmlFor={`chat-add-members-search-${threadId}`}>
            {labels.search}
          </label>
          <Input
            id={`chat-add-members-search-${threadId}`}
            type="search"
            value={query}
            placeholder={labels.search}
            onChange={(event) => setQuery(event.target.value)}
            data-testid="chat-add-members-search"
          />
          <ChatPeoplePicker
            mode="select"
            companies={companies}
            query={query}
            selected={selected}
            onToggle={toggle}
            fixed={memberUserIds}
            testIdPrefix="chat-add-members"
            labels={pickerLabels}
          />
          {truncated ? (
            <p className="m-0 text-xs text-fg-muted" data-testid="chat-add-members-truncated">
              {labels.truncated}
            </p>
          ) : null}
        </div>
      </div>

      {/* 下に固定した追加ボタン（候補が長くても常に見える） */}
      <div className="flex flex-col gap-2 border-t border-border bg-bg-subtle px-4 py-3">
        {message === null ? null : (
          <p role="status" className="m-0 text-xs text-danger" data-testid="chat-add-members-message">
            {message}
          </p>
        )}
        <Button type="button" onClick={() => void submit()} className="w-full" data-testid="chat-add-members-submit">
          {labels.submit}
        </Button>
      </div>
    </section>
  );
}
