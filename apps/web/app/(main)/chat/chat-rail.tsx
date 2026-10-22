// apps/web/app/(main)/chat/chat-rail.tsx
// ✅ 2026-10-19（v2・紺野「左に割り込む」「会社から＞ 人から＞」）: 左の絞り込みの列（Lark の「フィルタ」）。
//   すべて / 未読 / 要返信 / DM / グループ / 取引先ごと（会社から）/ 案件スレッド / 連絡先（人から）。
//
// 🔴 ここが守るもの
//   ① 並べる会社・案件・件数は、一覧と同じ読み出し（RLS が決めた母集団）から数えるだけ。ここで足さない。
//   ② 会社の鍵は会社の会話の行の ID（`ChatThreadGroup.key`）。取引先の ID を URL に出さない。
//   ③ スマホでは横に流れる帯、`md` 以上では縦の列（隠さない。`CLAUDE.md` §13.3）。
import Link from 'next/link';
import { t } from '@ses/i18n';
import { ROW_HOVER_CLASSES, cn } from '@ses/ui';
import type { ChatThreadGroup } from '../../../lib/chat/thread-tree';
import type { ChatRoomListItem } from '../../../lib/chat/views';
import { chatHref, type ChatListFilter } from '../../../lib/chat/screen-query';

export type ChatRailProps = {
  readonly groups: readonly ChatThreadGroup[];
  readonly rooms: readonly ChatRoomListItem[];
  readonly unreadCounts: Readonly<Record<string, number>>;
  readonly awaitingReplyIds: readonly string[];
  readonly filter: ChatListFilter;
  readonly showContacts: boolean;
};

/** 種類の印（アバターと同じ形・色の小さな四角）。 */
type MarkKind = 'all' | 'unread' | 'awaiting' | 'dm' | 'group' | 'company' | 'project' | 'contacts';
// ✅ 2026-10-20: 一覧のアバターと同じ塗りつぶし（`chat-thread-list.tsx` の AVATAR_KIND_CLASSES）。
const MARK_CLASSES: Readonly<Record<MarkKind, string>> = {
  all: 'rounded-md bg-fg-muted text-bg',
  unread: 'rounded-md bg-info text-bg',
  awaiting: 'rounded-md bg-danger text-bg',
  dm: 'rounded-full bg-brand text-brand-fg',
  group: 'rounded-full bg-success text-bg',
  company: 'rounded-md bg-fg text-bg',
  project: 'rounded-md bg-warning text-bg',
  contacts: 'rounded-full bg-success text-bg',
};

function Mark({ kind, text }: { readonly kind: MarkKind; readonly text: string }) {
  return (
    <span aria-hidden="true" className={cn('inline-flex size-6 shrink-0 items-center justify-center text-xs font-bold', MARK_CLASSES[kind])}>
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
}) {
  return (
    <li className="shrink-0">
      <Link
        href={href}
        aria-current={active ? 'page' : undefined}
        className={cn(
          'flex items-center gap-2 rounded-md px-2 py-1 text-cell',
          active ? 'bg-bg text-brand' : cn('text-fg', ROW_HOVER_CLASSES),
        )}
        data-testid={`chat-rail-${testKey}`}
        title={title}
      >
        <Mark kind={mark} text={markText} />
        <span className="min-w-0 flex-1 truncate">{label}</span>
        {count === undefined || count === 0 ? null : <span className="shrink-0 text-xs text-fg-muted">{String(count)}</span>}
      </Link>
    </li>
  );
}

const HEADING_CLASSES = 'm-0 shrink-0 px-2 pt-3 pb-1 text-xs font-normal text-fg-muted';

export function ChatRail({ groups, rooms, unreadCounts, awaitingReplyIds, filter, showContacts }: ChatRailProps) {
  const unreadOf = (id: string) => unreadCounts[id] ?? 0;
  const items = groups.flatMap((group) => (group.chat === null ? group.threads : [group.chat, ...group.threads]));
  const unreadTotal = [...items.map((item) => item.id), ...rooms.map((room) => room.id)].filter((id) => unreadOf(id) > 0).length;
  const projects = items.filter((item) => item.kind === 'PROJECT');
  const is = (kind: ChatListFilter['kind']) => filter.kind === kind;
  return (
    <nav aria-label={t('chat.rail.label')} className="flex flex-col p-2" data-testid="chat-rail">
      <ul className="m-0 flex list-none gap-1 overflow-x-auto p-0 md:flex-col md:overflow-visible">
        <RailLink href={chatHref({})} active={is('all')} mark="all" markText={t('chat.rail.mark.all')} label={t('chat.rail.all')} count={unreadTotal} testKey="all" />
        <RailLink href={chatHref({ filter: { kind: 'unread' } })} active={is('unread')} mark="unread" markText={t('chat.rail.mark.unread')} label={t('chat.rail.unread')} count={unreadTotal} testKey="unread" />
        <RailLink href={chatHref({ filter: { kind: 'awaiting' } })} active={is('awaiting')} mark="awaiting" markText={t('chat.rail.mark.awaiting')} label={t('chat.rail.awaiting')} count={awaitingReplyIds.length} testKey="awaiting" />
        <RailLink href={chatHref({ filter: { kind: 'dm' } })} active={is('dm')} mark="dm" markText={t('chat.rail.mark.dm')} label={t('chat.rail.dm')} testKey="dm" />
        <RailLink href={chatHref({ filter: { kind: 'group' } })} active={is('group')} mark="group" markText={t('chat.rail.mark.group')} label={t('chat.rail.group')} testKey="group" />
      </ul>
      {groups.length === 0 ? null : (
        <>
          <h3 className={HEADING_CLASSES}>{t('chat.rail.companies')}</h3>
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
                  testKey={`company-${group.key}`}
                />
              );
            })}
          </ul>
        </>
      )}
      {projects.length === 0 ? null : (
        <>
          <h3 className={HEADING_CLASSES}>{t('chat.rail.projects')}</h3>
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
                testKey={`project-${item.id}`}
              />
            ))}
          </ul>
        </>
      )}
      {showContacts ? (
        <>
          <h3 className={HEADING_CLASSES}>{t('chat.people.contacts')}</h3>
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
        </>
      ) : null}
    </nav>
  );
}
