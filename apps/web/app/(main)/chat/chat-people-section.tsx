// apps/web/app/(main)/chat/chat-people-section.tsx
// ✅ 2026-10-19（v2）: 一覧の列の中の 2 つの部品 —— お気に入り（丸いアイコンの並び）と、連絡先（「人から＞」）。
//
// 🔴 ここが守るもの
//   ① 母集団は読みの関数（`lib/chat/people.ts`）が RLS で決めたものだけ。画面で人や部屋を足さない。
//   ② 連絡先の人を押すと「その人との会話」（`f=person.<ID>`）に移る。DM を始めるのはその先（閲覧専用には出さない）。
//   ③ 罫線を引かない・太字は未読だけ。一覧の中で `hidden` を使わない（render テスト ③）。
import Link from 'next/link';
import { t } from '@ses/i18n';
import { Avatar, ROW_HOVER_CLASSES, cn } from '@ses/ui';
import { UNREAD_DOT_CLASSES, UNREAD_DOT_MAX } from './chat-unread-dot';
import { displayInitials } from '../../../lib/format/initials';
import type { ChatContact, ChatPeopleData } from '../../../lib/chat/people';
import { chatHref } from '../../../lib/chat/screen-query';

const SECTION_LABEL_CLASSES = 'm-0 px-3 pt-3 pb-1 text-xs font-normal text-fg-muted';

/** お気に入りの 1 つ（会話の種類でアバターの形と色を変える。`chat-thread-list.tsx` の `AVATAR_KIND_CLASSES` と同じ）。 */
export type ChatFavorite = { readonly id: string; readonly name: string | null; readonly avatarClass: string; readonly initials: string };

export function ChatFavorites({
  favorites,
  unreadCounts,
  mutedIds,
  selectedThreadId,
}: {
  readonly favorites: readonly ChatFavorite[];
  readonly unreadCounts: Readonly<Record<string, number>>;
  readonly mutedIds: ReadonlySet<string>;
  readonly selectedThreadId: string | null;
}) {
  const nameOf = (name: string | null) => name ?? t('chat.thread.unknownName');
  return (
    <section className={favorites.length === 0 ? 'flex items-baseline gap-2 px-3 py-2' : undefined} data-testid="chat-favorites">
      <h3 className={favorites.length === 0 ? 'm-0 shrink-0 text-xs font-normal text-fg-muted' : SECTION_LABEL_CLASSES}>{t('chat.people.favorites')}</h3>
      {favorites.length === 0 ? (
        <p className="m-0 text-xs text-fg-placeholder" data-testid="chat-favorites-empty">
          {t('chat.people.favoritesEmpty')}
        </p>
      ) : (
        // ✅ 2026-10-22（Lark の参考）: スマホでは横 1 列にして、多いときは横に送る（縦に場所を取らない）。`md` 以上は 5 列のまま。
        <ul className="m-0 flex list-none gap-1 overflow-x-auto px-2 pb-2 md:grid md:grid-cols-5 md:overflow-visible" data-testid="chat-threads-pinned">
          {favorites.map((item) => {
            const unread = unreadCounts[item.id] ?? 0;
            return (
              <li key={item.id} className="w-16 min-w-0 shrink-0 md:w-auto" data-testid={`chat-favorite-${item.id}`}>
                <Link
                  href={chatHref({ thread: item.id })}
                  aria-current={item.id === selectedThreadId ? 'page' : undefined}
                  className={cn('flex flex-col items-center gap-1 rounded-md py-1', ROW_HOVER_CLASSES)}
                  data-testid={`chat-thread-pinned-${item.id}`}
                >
                  {/* ✅ 2026-10-22: 未読は一覧の行と同じ、アバターの右上の赤丸。 */}
                  <span className="relative">
                    <Avatar size="md" initials={item.initials} title={nameOf(item.name)} className={item.avatarClass} />
                    {unread > 0 && !mutedIds.has(item.id) ? (
                      <span className={cn(UNREAD_DOT_CLASSES, 'bg-danger')}>{unread > UNREAD_DOT_MAX ? `${String(UNREAD_DOT_MAX)}+` : String(unread)}</span>
                    ) : null}
                  </span>
                  <span className="w-full truncate text-center text-xs text-fg-muted">{nameOf(item.name)}</span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

function ContactRow({ contact }: { readonly contact: ChatContact }) {
  const name = contact.name ?? t('chat.thread.unknownName');
  return (
    <li data-testid={`chat-contact-${contact.userId}`}>
      <Link
        href={chatHref({ filter: { kind: 'person', userId: contact.userId } })}
        className={cn('flex min-w-0 items-center gap-2 rounded-md px-3 py-2', ROW_HOVER_CLASSES)}
        data-testid={`chat-contact-link-${contact.userId}`}
      >
        <Avatar size="sm" initials={displayInitials(name)} title={name} />
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="truncate text-cell text-fg">{name}</span>
          {/* ✅ 2026-10-19（#140）: ひとこと状態（RLS で読めた人の、空でないものだけ）。 */}
          {contact.status == null || contact.status === '' ? null : (
            <span className="truncate text-xs text-fg-placeholder" data-testid={`chat-contact-status-${contact.userId}`}>
              {contact.status}
            </span>
          )}
        </span>
        {contact.isHost ? null : <span className="shrink-0 rounded-xs bg-info-bg px-1 text-xs text-info">{t('chat.tag.external')}</span>}
        <span className="shrink-0 truncate text-xs text-fg-muted">{contact.companyName ?? ''}</span>
      </Link>
    </li>
  );
}

/** 連絡先（`f=contacts`）。最近やり取りした人と、会社ごとの人。押すと「その人との会話」へ。 */
export function ChatContactsView({ people, children }: { readonly people: ChatPeopleData; readonly children?: React.ReactNode }) {
  return (
    <div className="flex flex-col" data-testid="chat-contacts">
      {children}
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
    </div>
  );
}
