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
import { formatDateTimeJst } from '../../../lib/format/datetime';
import { displayInitials } from '../../../lib/format/initials';
import type { ChatContact, ChatPeopleData } from '../../../lib/chat/people';
import { chatHref } from '../../../lib/chat/screen-query';
import { ChatOpenDmButton } from './chat-open-dm-button';

export type ChatPeopleSectionProps = {
  readonly people: ChatPeopleData;
  readonly selectedThreadId: string | null;
  readonly canPost: boolean;
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
          {contact.status == null || contact.status === '' ? null : (
            <span className="min-w-0 truncate text-xs text-fg-placeholder" data-testid={`chat-contact-status-${contact.userId}`}>
              {contact.status}
            </span>
          )}
        </span>
      </ChatOpenDmButton>
    </li>
  );
}

export function ChatPeopleSection({ people, selectedThreadId, canPost }: ChatPeopleSectionProps) {
  const pinned = new Set(people.pinnedIds);
  const muted = new Set(people.mutedIds);
  const favorites = people.rooms.filter((room) => pinned.has(room.id));
  const nameOf = (name: string | null) => name ?? t('chat.thread.unknownName');

  return (
    <div className="flex flex-col" data-testid="chat-people">
      {favorites.length === 0 ? null : (
        <section data-testid="chat-favorites">
          <h3 className={SECTION_LABEL_CLASSES}>{t('chat.people.favorites')}</h3>
          <ul className="m-0 grid list-none grid-cols-5 gap-1 px-2 pb-2">
            {favorites.map((room) => {
              const unread = people.unreadCounts[room.id] ?? 0;
              return (
                <li key={room.id} className="min-w-0">
                  <Link
                    href={chatHref({ thread: room.id })}
                    aria-current={room.id === selectedThreadId ? 'page' : undefined}
                    className={cn('flex flex-col items-center gap-1 rounded-md py-1', ROW_HOVER_CLASSES)}
                    data-testid={`chat-favorite-${room.id}`}
                  >
                    <Avatar size="md" initials={displayInitials(nameOf(room.name))} title={nameOf(room.name)} />
                    <span className="w-full truncate text-center text-xs text-fg-muted">{nameOf(room.name)}</span>
                    {unread > 0 && !muted.has(room.id) ? <Badge variant="brand">{String(unread)}</Badge> : null}
                  </Link>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {canPost ? (
        <details className="px-1" data-testid="chat-contacts">
          <summary className="cursor-pointer px-2 py-2 text-xs text-fg-muted">{t('chat.people.contacts')}</summary>
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

      <section data-testid="chat-rooms">
        <h3 className={SECTION_LABEL_CLASSES}>{t('chat.people.rooms')}</h3>
        {people.rooms.length === 0 ? (
          <p className="m-0 px-3 pb-2 text-xs text-fg-muted" data-testid="chat-rooms-empty">
            {t('chat.people.roomsEmpty')}
          </p>
        ) : (
          <ul className="m-0 list-none p-0">
            {people.rooms.map((room) => {
              const unread = people.unreadCounts[room.id] ?? 0;
              const name = nameOf(room.name);
              const open = room.id === selectedThreadId;
              return (
                <li key={room.id} data-testid={`chat-room-${room.id}`} data-kind={room.kind}>
                  <Link
                    href={chatHref({ thread: room.id })}
                    aria-current={open ? 'page' : undefined}
                    className={cn('flex items-center gap-3 px-3 py-2', open ? 'bg-brand-bg' : ROW_HOVER_CLASSES)}
                  >
                    <Avatar size="md" initials={displayInitials(name)} title={name} />
                    <span className="min-w-0 flex-1">
                      <span className={cn('block truncate text-row text-fg', unread > 0 && !muted.has(room.id) ? 'font-bold' : 'font-normal')}>
                        {name}
                      </span>
                      <span className="flex items-center gap-2 text-xs text-fg-placeholder">
                        {room.kind === 'GROUP' ? (
                          <span>{`${t('chat.thread.kind.GROUP')} ${String(room.memberCount)}${t('chat.people.memberUnit')}`}</span>
                        ) : (
                          <span>{t('chat.thread.kind.DM')}</span>
                        )}
                        <span className="ml-auto shrink-0">
                          {room.lastMessageAt === null ? t('chat.thread.noMessages') : formatDateTimeJst(room.lastMessageAt)}
                        </span>
                      </span>
                    </span>
                    {unread > 0 ? (
                      <Badge variant={muted.has(room.id) ? 'neutral' : 'brand'} data-testid={`chat-room-unread-${room.id}`}>
                        {String(unread)}
                      </Badge>
                    ) : null}
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
