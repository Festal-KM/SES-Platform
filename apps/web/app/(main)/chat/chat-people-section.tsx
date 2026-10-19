// apps/web/app/(main)/chat/chat-people-section.tsx
// ✅ 2026-10-19（#128 で合意 / `docs/04` S-031 改訂 39）: 一覧の上の欄 —— お気に入り・連絡先（開閉式）・DM・グループ。
//
// 🔴 ここが守るもの
//   ① 母集団は読みの関数（`lib/chat/people.ts`）が RLS で決めたものだけ。画面で人や部屋を足さない。
//   ② 閲覧専用（投稿できない人）には「DM を開く」を描かない（押せないボタンを置かない。render テスト ②）。
//      連絡先の欄ごと出さない（押せない一覧を見せても使い道が無い）。
//   ③ 罫線を引かない・太字は未読だけ（2026-10-16 紺野。一覧と同じ見た目の決まり）。
//   ④ 一覧の中で `hidden` を使わない（render テスト ③）。開閉は `<details>` に任せる。
import Link from 'next/link';
import { t } from '@ses/i18n';
import { Avatar, Badge, ROW_HOVER_CLASSES, cn } from '@ses/ui';
import { displayInitials } from '../../../lib/format/initials';
import type { ChatContact, ChatPeopleData } from '../../../lib/chat/people';
import { chatHref } from '../../../lib/chat/screen-query';
import { ChatOpenDmButton } from './chat-open-dm-button';

export type ChatPeopleSectionProps = {
  readonly people: ChatPeopleData;
  readonly selectedThreadId: string | null;
  readonly canPost: boolean;
  /** ✅ 2026-10-19: お気に入り（ピン留めした DM・グループと会社の会話）。一覧が組んで渡す。 */
  readonly favorites?: readonly { readonly id: string; readonly name: string | null }[];
  readonly unreadCounts?: Readonly<Record<string, number>>;
};

const SECTION_LABEL_CLASSES = 'm-0 px-3 pt-3 pb-1 text-xs font-normal text-fg-muted';

function ContactRow({ contact }: { readonly contact: ChatContact }) {
  const name = contact.name ?? t('chat.thread.unknownName');
  return (
    <li data-testid={`chat-contact-${contact.userId}`}>
      <ChatOpenDmButton userId={contact.userId} label={`${name} ${t('chat.people.openDm')}`} failedLabel={t('chat.people.openDmFailed')}>
        <span className="flex min-w-0 items-center gap-2">
          <Avatar size="sm" initials={displayInitials(name)} title={name} />
          <span className="min-w-0 truncate text-cell text-fg">{name}</span>
          <span className="shrink-0 truncate text-xs text-fg-muted">{contact.companyName ?? ''}</span>
        </span>
      </ChatOpenDmButton>
    </li>
  );
}

/**
 * 一覧の上の欄。✅ 2026-10-19: DM・グループの行は一覧（`chat-thread-list.tsx`）に混ぜたので、ここは
 * **お気に入り**（常に出す。無ければ案内）と **＋ 新しい会話**（連絡先）だけ。
 */
export function ChatPeopleSection({ people, selectedThreadId, canPost, favorites, unreadCounts }: ChatPeopleSectionProps) {
  const muted = new Set(people.mutedIds);
  const counts = unreadCounts ?? people.unreadCounts;
  const items =
    favorites ?? people.rooms.filter((room) => people.pinnedIds.includes(room.id)).map((room) => ({ id: room.id, name: room.name }));
  const nameOf = (name: string | null) => name ?? t('chat.thread.unknownName');

  return (
    <div className="flex flex-col" data-testid="chat-people">
      <section data-testid="chat-favorites">
        <h3 className={SECTION_LABEL_CLASSES}>{t('chat.people.favorites')}</h3>
        {items.length === 0 ? (
          <p className="m-0 px-3 pb-2 text-xs text-fg-placeholder" data-testid="chat-favorites-empty">
            {t('chat.people.favoritesEmpty')}
          </p>
        ) : (
          <ul className="m-0 grid list-none grid-cols-5 gap-1 px-2 pb-2" data-testid="chat-threads-pinned">
            {items.map((item) => {
              const unread = counts[item.id] ?? 0;
              return (
                <li key={item.id} className="min-w-0" data-testid={`chat-favorite-${item.id}`}>
                  <Link
                    href={chatHref({ thread: item.id })}
                    aria-current={item.id === selectedThreadId ? 'page' : undefined}
                    className={cn('relative flex flex-col items-center gap-1 rounded-md py-1', ROW_HOVER_CLASSES)}
                    data-testid={`chat-thread-pinned-${item.id}`}
                  >
                    <Avatar size="md" initials={displayInitials(nameOf(item.name))} title={nameOf(item.name)} />
                    <span className="w-full truncate text-center text-xs text-fg-muted">{nameOf(item.name)}</span>
                    {unread > 0 && !muted.has(item.id) ? <Badge variant="brand">{String(unread)}</Badge> : null}
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {canPost ? (
        <details className="px-2 pb-1" data-testid="chat-contacts">
          <summary
            className="cursor-pointer list-none rounded-md border border-border bg-bg px-3 py-2 text-center text-cell text-fg"
            data-testid="chat-new-conversation"
          >
            {t('chat.people.newConversation')}
          </summary>
          {people.contacts.recent.length === 0 ? null : (
            <section data-testid="chat-contacts-recent">
              <h4 className={SECTION_LABEL_CLASSES}>{t('chat.people.recent')}</h4>
              <ul className="m-0 list-none p-0">
                {people.contacts.recent.map((contact) => (
                  <ContactRow key={`recent-${contact.userId}`} contact={contact} />
                ))}
              </ul>
            </section>
          )}
          {people.contacts.companies.map((company, index) => (
            <section key={`${company.companyName ?? ''}-${String(index)}`} data-testid={`chat-contacts-company-${String(index)}`}>
              <h4 className={SECTION_LABEL_CLASSES}>{company.companyName ?? t('chat.thread.unknownName')}</h4>
              <ul className="m-0 list-none p-0">
                {company.people.map((contact) => (
                  <ContactRow key={contact.userId} contact={contact} />
                ))}
              </ul>
            </section>
          ))}
        </details>
      ) : null}
    </div>
  );
}
