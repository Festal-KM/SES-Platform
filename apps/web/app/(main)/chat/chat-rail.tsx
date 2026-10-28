// apps/web/app/(main)/chat/chat-rail.tsx
// ✅ 2026-10-19（v2・紺野「左に割り込む」「会社から＞ 人から＞」）: 左の絞り込みの列（Lark の「フィルタ」）。
//   すべて / 未読 / DM / グループ / 保存済み / 取引先ごと（会社から）/ 案件スレッド / 連絡先（人から）。
// ✅ 2026-10-22（紺野）: 「要返信」を外し、「保存済み」（本人だけの栞。`f=saved`）を足した。
//
// 🔴 ここが守るもの
//   ① 並べる会社・案件・件数は、一覧と同じ読み出し（RLS が決めた母集団）から数えるだけ。ここで足さない。
//   ② 会社の鍵は会社の会話の行の ID（`ChatThreadGroup.key`）。取引先の ID を URL に出さない。
//   ③ スマホでは横に流れる帯、`md` 以上では縦の列（隠さない。`CLAUDE.md` §13.3）。
//   ④ ✅ 2026-10-22: 「取引先」「案件スレッド」「連絡先」は見出しで開閉できる（`chat-rail-section.tsx`。閉じても未読の件数は出す）。
import { UNREAD_DOT_CLASSES } from './chat-unread-dot';
import Link from 'next/link';
import { t } from '@ses/i18n';
import { ROW_HOVER_CLASSES, cn } from '@ses/ui';
import type { ChatThreadGroup } from '../../../lib/chat/thread-tree';
import type { ChatRoomListItem } from '../../../lib/chat/views';
import { chatHref, type ChatListFilter } from '../../../lib/chat/screen-query';
import { ChatRailSection } from './chat-rail-section';

export type ChatRailProps = {
  readonly groups: readonly ChatThreadGroup[];
  readonly rooms: readonly ChatRoomListItem[];
  readonly unreadCounts: Readonly<Record<string, number>>;
  /** ✅ 2026-10-27（F-038 ⑭）: 未読に自分宛ての `@` がある部屋。省略時は印を出さない。 */
  readonly mentionUnreadIds?: readonly string[];
  readonly filter: ChatListFilter;
  readonly showContacts: boolean;
  /** ✅ 2026-10-22: 「保存済み」を出すか（保存できる人 = 投稿できる人だけ。閲覧専用には出さない）。 */
  readonly showSaved?: boolean;
};

/** 会社の印は列を畳んだときだけ残す。開いた列では社名で見分ける。 */
type MarkKind = 'all' | 'unread' | 'dm' | 'group' | 'saved' | 'company' | 'project' | 'contacts';
const MARK_CLASSES: Readonly<Record<MarkKind, string>> = {
  all: 'hidden md:in-[[data-collapsed=true]]:inline-flex',
  unread: 'hidden md:in-[[data-collapsed=true]]:inline-flex',
  dm: 'hidden md:in-[[data-collapsed=true]]:inline-flex',
  group: 'hidden md:in-[[data-collapsed=true]]:inline-flex',
  saved: 'hidden md:in-[[data-collapsed=true]]:inline-flex',
  company: 'hidden rounded-md bg-neutral-bg text-fg-muted md:in-[[data-collapsed=true]]:inline-flex',
  project: 'inline-flex rounded-md bg-neutral-bg text-fg-muted',
  contacts: 'hidden md:in-[[data-collapsed=true]]:inline-flex',
};

function Mark({ kind, text }: { readonly kind: MarkKind; readonly text: string }) {
  return (
    <span aria-hidden="true" className={cn('h-6 w-6 shrink-0 items-center justify-center text-xs font-bold', MARK_CLASSES[kind])}>
      {text}
    </span>
  );
}

function RailLink({
  href,
  active,
  mark,
  markText,
  label,
  count,
  testKey,
  title,
  mention = false,
}: {
  readonly href: string;
  readonly active: boolean;
  readonly mark: MarkKind;
  readonly markText: string;
  readonly label: string;
  readonly count?: number;
  /** 目印の後半（`chat-rail-<ここ>`）。 */
  readonly testKey: string;
  /** 省略していない正式な名前（ポインタを置いたときに出す）。 */
  readonly title?: string;
  /** ✅ 2026-10-27（F-038 ⑭）: 中の会話の未読に自分宛ての `@` がある。 */
  readonly mention?: boolean;
}) {
  return (
    <li className="shrink-0">
      <Link
        href={href}
        aria-current={active ? 'page' : undefined}
        className={cn(
          'relative flex min-h-11 items-center gap-2 rounded-md px-2 py-1 text-cell',
          active ? 'bg-bg text-brand' : cn('text-fg', ROW_HOVER_CLASSES),
        )}
        data-testid={`chat-rail-${testKey}`}
        aria-label={label}
        title={title ?? label}
      >
        <Mark kind={mark} text={markText} />
        <span className="min-w-0 flex-1 truncate md:in-[[data-collapsed=true]]:sr-only">{label}</span>
        {mention ? (
          <span
            className="shrink-0 rounded-xs bg-brand-bg px-1 text-xs font-bold text-brand md:in-[[data-collapsed=true]]:hidden"
            title={t('chat.mention.unread')}
            data-testid={`chat-rail-mention-${testKey}`}
          >
            <span aria-hidden="true">{t('chat.mention.mark')}</span>
            <span className="sr-only">{t('chat.mention.unread')}</span>
          </span>
        ) : null}
        {/* ✅ 2026-10-26: 開いている列では横に数字、畳んだ列（印だけ）では印の右上に赤丸で出す（見落とさせない）。 */}
        {count === undefined || count === 0 ? null : (
          <>
            <span className="shrink-0 text-xs text-fg-muted md:in-[[data-collapsed=true]]:hidden">{String(count)}</span>
            <span className={cn(UNREAD_DOT_CLASSES, 'hidden bg-danger md:in-[[data-collapsed=true]]:flex')}>{String(count)}</span>
          </>
        )}
      </Link>
    </li>
  );
}


export function ChatRail({ groups, rooms, unreadCounts, mentionUnreadIds = [], filter, showContacts, showSaved = false }: ChatRailProps) {
  const unreadOf = (id: string) => unreadCounts[id] ?? 0;
  const mentioned = new Set(mentionUnreadIds);
  const items = groups.flatMap((group) => (group.chat === null ? group.threads : [group.chat, ...group.threads]));
  const unreadTotal = [...items.map((item) => item.id), ...rooms.map((room) => room.id)].filter((id) => unreadOf(id) > 0).length;
  const projects = items.filter((item) => item.kind === 'PROJECT');
  const is = (kind: ChatListFilter['kind']) => filter.kind === kind;
  // ✅ 2026-10-22: 見出しを閉じたときに出す未読の件数（会話の数）。
  const companiesUnread =
    groups.flatMap((group) => [...(group.chat === null ? [] : [group.chat.id]), ...group.threads.map((item) => item.id)]).filter((id) => unreadOf(id) > 0).length +
    rooms.filter((room) => room.companyKey !== null && unreadOf(room.id) > 0).length;
  const projectsUnread = projects.filter((item) => unreadOf(item.id) > 0).length;
  return (
    <nav aria-label={t('chat.rail.label')} className="flex flex-col p-2" data-testid="chat-rail">
      <ul className="m-0 flex list-none gap-1 overflow-x-auto p-0 md:flex-col md:overflow-visible">
        <RailLink href={chatHref({})} active={is('all')} mark="all" markText={t('chat.rail.mark.all')} label={t('chat.rail.all')} count={unreadTotal} mention={mentioned.size > 0} testKey="all" />
        <RailLink href={chatHref({ filter: { kind: 'unread' } })} active={is('unread')} mark="unread" markText={t('chat.rail.mark.unread')} label={t('chat.rail.unread')} count={unreadTotal} testKey="unread" />
        <RailLink href={chatHref({ filter: { kind: 'dm' } })} active={is('dm')} mark="dm" markText={t('chat.rail.mark.dm')} label={t('chat.rail.dm')} mention={rooms.some((room) => room.kind === 'DM' && mentioned.has(room.id))} testKey="dm" />
        <RailLink href={chatHref({ filter: { kind: 'group' } })} active={is('group')} mark="group" markText={t('chat.rail.mark.group')} label={t('chat.rail.group')} mention={rooms.some((room) => room.kind === 'GROUP' && mentioned.has(room.id))} testKey="group" />
        {showSaved ? (
          <RailLink href={chatHref({ filter: { kind: 'saved' } })} active={is('saved')} mark="saved" markText={t('chat.rail.mark.saved')} label={t('chat.rail.saved')} testKey="saved" />
        ) : null}
      </ul>
      {groups.length === 0 ? null : (
        <ChatRailSection sectionKey="companies" heading={t('chat.rail.companies')} unread={companiesUnread}>
          <ul className="m-0 flex list-none gap-1 overflow-x-auto p-0 md:flex-col md:overflow-visible" data-testid="chat-rail-companies">
            {groups.map((group) => {
              const name = group.counterpartyName ?? t('chat.thread.unknownName');
              const ids = [...(group.chat === null ? [] : [group.chat.id]), ...group.threads.map((item) => item.id)];
              const unread = ids.filter((id) => unreadOf(id) > 0).length + rooms.filter((room) => room.companyKey === group.key && unreadOf(room.id) > 0).length;
              return (
                <RailLink
                  key={group.key}
                  href={chatHref({ filter: { kind: 'company', key: group.key } })}
                  active={filter.kind === 'company' && filter.key === group.key}
                  mark="company"
                  markText={name.replace(/^株式会社/, '').slice(0, 1)}
                  // ✅ 2026-10-20: 「株式会社」を省く（狭い列で全社が「株式会社ダミ…」になって区別できない）。正式名は title に残す。
                  label={name.replace(/^株式会社/, '').replace(/株式会社$/, '') || name}
                  title={name}
                  count={unread}
                  mention={ids.some((id) => mentioned.has(id)) || rooms.some((room) => room.companyKey === group.key && mentioned.has(room.id))}
                  testKey={`company-${group.key}`}
                />
              );
            })}
          </ul>
        </ChatRailSection>
      )}
      {projects.length === 0 ? null : (
        <ChatRailSection sectionKey="projects" heading={t('chat.rail.projects')} unread={projectsUnread}>
          <ul className="m-0 flex list-none gap-1 overflow-x-auto p-0 md:flex-col md:overflow-visible" data-testid="chat-rail-projects">
            {projects.map((item) => (
              <RailLink
                key={item.id}
                href={chatHref({ thread: item.id })}
                active={false}
                mark="project"
                markText="#"
                label={item.project?.name ?? t('chat.thread.kind.PROJECT')}
                count={unreadOf(item.id)}
                mention={mentioned.has(item.id)}
                testKey={`project-${item.id}`}
              />
            ))}
          </ul>
        </ChatRailSection>
      )}
      {showContacts ? (
        <ChatRailSection sectionKey="contacts" heading={t('chat.people.contacts')} unread={0}>
          <ul className="m-0 flex list-none gap-1 p-0 md:flex-col">
            <RailLink
              href={chatHref({ filter: { kind: 'contacts' } })}
              active={is('contacts') || is('person') || is('newgroup')}
              mark="contacts"
              markText={t('chat.rail.mark.contacts')}
              label={t('chat.rail.openContacts')}
              testKey="contacts"
            />
          </ul>
        </ChatRailSection>
      ) : null}
    </nav>
  );
}
