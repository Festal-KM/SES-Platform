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
import { UNREAD_DOT_MAX } from './chat-unread-dot';
import { ChatRailSection } from './chat-rail-section';
import type { ChatContact, ChatPeopleData } from '../../../lib/chat/people';
import {
  ChatContactRow,
  ChatPeoplePicker,
  type ChatPeoplePickerLabels,
  type ChatPickerCompany,
  type ChatPickerPerson,
} from './chat-people-picker';
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
  if (favorites.length === 0) {
    return (
      <section className="flex items-baseline gap-2 px-3 py-2" data-testid="chat-favorites">
        <h3 className="m-0 shrink-0 text-xs font-normal text-fg-muted">{t('chat.people.favorites')}</h3>
        <p className="m-0 text-xs text-fg-placeholder" data-testid="chat-favorites-empty">
          {t('chat.people.favoritesEmpty')}
        </p>
      </section>
    );
  }
  // ✅ 2026-10-27（紺野「お気に入りスペース広すぎる。トグル＋もっとすっきり」）: 見出しで開閉できるようにし（閉じた状態は
  //    この端末に覚える。閉じていても未読の合計は見出しの横に出す）、中身は「小さなアイコン＋名前 1 行」の札を詰めて並べる。
  const unreadTotal = favorites.reduce((sum, item) => sum + (mutedIds.has(item.id) ? 0 : (unreadCounts[item.id] ?? 0)), 0);
  return (
    <div data-testid="chat-favorites">
      <ChatRailSection sectionKey="favorites" heading={t('chat.people.favorites')} unread={unreadTotal} inRail={false}>
        <ul className="m-0 flex list-none flex-wrap gap-1 px-2 pb-2" data-testid="chat-threads-pinned">
          {favorites.map((item) => {
            const unread = mutedIds.has(item.id) ? 0 : (unreadCounts[item.id] ?? 0);
            return (
              <li key={item.id} className="w-36 min-w-0" data-testid={`chat-favorite-${item.id}`}>
                <Link
                  href={chatHref({ thread: item.id })}
                  aria-current={item.id === selectedThreadId ? 'page' : undefined}
                  title={nameOf(item.name)}
                  className={cn('flex min-h-11 min-w-0 items-center gap-2 rounded-md px-2 md:min-h-8', ROW_HOVER_CLASSES)}
                  data-testid={`chat-thread-pinned-${item.id}`}
                >
                  <Avatar size="sm" initials={item.initials} title={nameOf(item.name)} className={item.avatarClass} />
                  <span className="min-w-0 truncate text-xs text-fg">{nameOf(item.name)}</span>
                  {unread > 0 ? (
                    <span className="shrink-0 rounded-full bg-danger px-1 text-xs font-semibold text-bg">
                      {unread > UNREAD_DOT_MAX ? `${String(UNREAD_DOT_MAX)}+` : String(unread)}
                    </span>
                  ) : null}
                </Link>
              </li>
            );
          })}
        </ul>
      </ChatRailSection>
    </div>
  );
}

/** 連絡先の 1 人を、選び方の部品（クライアント）に渡す形にする（名前・会社名が読めなければ「表示できません」）。 */
function toPickerCompanies(people: ChatPeopleData): ChatPickerCompany[] {
  return people.contacts.companies.map((company) => ({
    companyName: company.companyName ?? t('chat.thread.unknownName'),
    isHost: company.isHost,
    people: company.people.map(toPickerPerson),
  }));
}

function toPickerPerson(contact: ChatContact): ChatPickerPerson {
  return { userId: contact.userId, name: contact.name ?? t('chat.thread.unknownName'), status: contact.status ?? null };
}

/**
 * 連絡先（`f=contacts`）。押すと「その人との会話」へ。
 * ✅ 2026-10-30（紺野の決定。F-038 改訂 16 ⑲）: 「会社から探す」「名前から探す」の 2 つのタブ（LINE と同じ。既定は会社から）。
 *    「最近やり取りした人」は会社のタブのいちばん上。上の検索欄の語（`q`）で名前・会社名を絞り込む。
 */
export function ChatContactsView({
  people,
  query = '',
  children,
}: {
  readonly people: ChatPeopleData;
  readonly query?: string;
  readonly children?: React.ReactNode;
}) {
  const recent =
    people.contacts.recent.length === 0 ? null : (
      <section data-testid="chat-contacts-recent">
        <h4 className={SECTION_LABEL_CLASSES}>{t('chat.people.recent')}</h4>
        <ul className="m-0 list-none p-0">
          {people.contacts.recent.map((contact) => (
            <ChatContactRow
              key={`recent-${contact.userId}`}
              person={toPickerPerson(contact)}
              companyName={contact.companyName ?? ''}
              isHost={contact.isHost}
              externalLabel={t('chat.tag.external')}
            />
          ))}
        </ul>
      </section>
    );
  return (
    <div className="flex flex-col" data-testid="chat-contacts">
      <h3 className="m-0 px-3 py-2 text-body font-bold text-fg">{t('chat.people.contacts')}</h3>
      {children}
      <div className="px-2 pt-2">
        <ChatPeoplePicker
          mode="link"
          companies={toPickerCompanies(people)}
          query={query}
          testIdPrefix="chat-contacts"
          companyTop={recent}
          labels={chatPeoplePickerLabels()}
        />
      </div>
      {/* ✅ 2026-10-26（#166 の 7）: 上限で読み切れなかったら、その旨を出す（黙って消さない）。 */}
      {people.contactsTruncated === true ? (
        <p className="m-0 px-3 py-2 text-xs text-fg-muted" data-testid="chat-contacts-truncated">
          {t('chat.people.contactsTruncated')}
        </p>
      ) : null}
    </div>
  );
}

/** 人の選び方の部品の文言（連絡先と「新しいグループ」で同じ）。 */
export function chatPeoplePickerLabels(): ChatPeoplePickerLabels {
  return {
    tabs: t('chat.people.tabs.label'),
    byCompany: t('chat.people.tab.company'),
    byName: t('chat.people.tab.name'),
    noMatch: t('chat.people.noMatch'),
    external: t('chat.tag.external'),
    memberUnit: t('chat.people.memberUnit'),
  };
}
