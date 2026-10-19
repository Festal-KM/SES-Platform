// apps/web/app/(main)/chat/chat-thread-list.tsx
// `S-031` のスレッド一覧（左の 320px の柱）。
//
// ============================================================================
// 🔴 この画面が守るもの
// ============================================================================
// 1. 🔴 **✅ 2026-10-13: 表（`DataTable`）をやめ、60px の行の一覧にした**
//    （`docs/design-system.md` §4.5。人間のデザインシステム定義 v1.0 §3.12）。
//    理由: **320px の柱に 2 列の表を置くと、列ヘッダ 2 行ぶんの高さが毎回失われ、
//    長い案件名が折り返して行の高さが行ごとに変わる**（高さが内容量で変わるのは
//    `HANDOFF.md` §3.3 の 🔴 と同じ性質の問題である）。行は**固定 60px**にして、
//    溢れるものは切り詰める。
// 2. 🔴 **列の名前を捨てない。** 表をやめても「何の値か」は要る。`chat.threads.column.*`
//    を `sr-only` で各行に残した —— 読み上げでは列名が消えず、文言キーも生き続ける
//    （未使用キーの検査が落ちる＝キーは凍結されていて消せない）。
// 3. 🔴 **未読を出さない。** `Message` に既読の列が無く、**未読という状態が存在しない**
//    （`docs/design-system.md` §6 ⑬）。定義書の「未読カウント」「未読タブ」は実体が
//    できるまで置かない —— **近似を入れない。**
// 4. 🔴 **プレビュー（最後の発言の抜粋）も出さない。** `ChatThreadListItem` に本文が無く、
//    足すには読み取り経路（RLS を通る問い合わせ）を変える必要がある。**UI の段で
//    境界の経路を広げない**（`CLAUDE.md` §8.3 の上段に当たる変更になる）。
//    代わりに 2 段目には**相手の会社名**を置く（既に出している値であり、増やしていない）。
// 5. 🔴 **選択中の行は面の色で示す**（`--color-brand-bg`）。枠線や太字で示さない。
import Link from 'next/link';
import { t } from '@ses/i18n';
import {
  Avatar,
  Badge,
  Button,
  CHAT_THREAD_ROW_HEIGHT_CLASS,
  EmptyState,
  Input,
  ROW_HOVER_CLASSES,
  SECONDARY_LINK_CLASSES,
  Select,
  cn,
} from '@ses/ui';
import { formatDateTimeJst } from '../../../lib/format/datetime';
import { displayInitials } from '../../../lib/format/initials';
import { canAddPane, openThreadIds, withPaneAdded, withThreadSelected, type ChatPaneState } from '../../../lib/chat/panes';
import {
  CHAT_PANE_PARAM,
  CHAT_PATH,
  CHAT_Q_PARAM,
  CHAT_SORT_PARAM,
  CHAT_THREAD_PARAM,
  CHAT_UNREAD_PARAM,
  chatHref,
} from '../../../lib/chat/screen-query';
import {
  CHAT_THREAD_SORT_DEFAULT,
  type ChatThreadGroup,
  type ChatThreadSort,
} from '../../../lib/chat/thread-tree';
import type { ChatRoomListItem, ChatThreadListItem, ChatThreadKind } from '../../../lib/chat/views';
import type { ChatPeopleData } from '../../../lib/chat/people';
import { formatListTime } from '../../../lib/chat/day-separators';
import { ChatPeopleSection } from './chat-people-section';
import type { ChatMessageHit } from '../../../lib/chat/read';
import { ChatDraftMark } from './chat-draft-mark';

const KIND_MESSAGE_KEYS = {
  PROJECT: 'chat.thread.kind.PROJECT',
  COMPANY: 'chat.thread.kind.COMPANY',
  DM: 'chat.thread.kind.DM',
  GROUP: 'chat.thread.kind.GROUP',
} as const satisfies Readonly<Record<ChatThreadKind, `chat.thread.kind.${ChatThreadKind}`>>;

const SORT_MESSAGE_KEYS = {
  recent: 'chat.threads.sort.recent',
  company: 'chat.threads.sort.company',
} as const satisfies Readonly<Record<ChatThreadSort, 'chat.threads.sort.recent' | 'chat.threads.sort.company'>>;

export type ChatThreadListProps = {
  /**
   * ✅ 2026-10-14（チャットレーン）: **会社ごとの木**（`lib/chat/thread-tree.ts`）。
   * 会社とのチャット（企業スレッド）が親、その会社との案件スレッドが子。更新があったものが上。
   */
  readonly groups: readonly ChatThreadGroup[];
  readonly selectedThreadId: string | null;
  readonly nextCursor: string | null;
  /** ✅ 2026-10-14: 右に並べて開いている会話（左から順。`?pane=`）。 */
  readonly paneThreadIds?: readonly string[];
  /** ✅ 2026-10-14: 「右に並べる」の語（`chat.pane.openBeside`）。 */
  readonly openBesideLabel?: string;
  /** ✅ 2026-10-14: 一覧の検索語と並べ方（URL の `q` / `sort`）。 */
  readonly q?: string | null;
  readonly sort?: ChatThreadSort;
  /** ✅ 2026-10-14: 上限を超えて古いスレッドを読んでいない（`read.ts` の `CHAT_THREAD_TREE_MAX`）。 */
  readonly truncated?: boolean;
  /** ✅ 2026-10-14: 要返信（最後の発言が相手から）のスレッド。 */
  readonly awaitingReplyIds?: readonly string[];
  /** ✅ 2026-10-14: 本文の検索で当たった発言（`read.ts` の `ChatMessageHit`）。 */
  readonly messageHits?: readonly ChatMessageHit[];
  /** ✅ 2026-10-16: 自分がピン留め・ミュートしているスレッド。 */
  readonly pinnedIds?: readonly string[];
  readonly mutedIds?: readonly string[];
  /** ✅ 2026-10-16: スレッドごとの未読の件数と、「未読のみ」の状態。 */
  readonly unreadCounts?: Readonly<Record<string, number>>;
  readonly unreadOnly?: boolean;
  /** ✅ 2026-10-19（#128）: DM・グループと連絡先。渡すと一覧に混ぜ、上にお気に入り・新しい会話を出す。 */
  readonly people?: ChatPeopleData | null;
  /** 投稿できる人か（閲覧専用には「新しい会話」を描かない）。 */
  readonly canPost?: boolean;
  /** ✅ 2026-10-19: 会社の部屋の最後の発言の冒頭。 */
  readonly lastSnippets?: Readonly<Record<string, string>>;
  /** 時刻の基準（テストで固定する）。 */
  readonly now?: Date;
};

/** 行 1 つ（60px）。🔴 高さが内容量で変わらないよう、2 段とも 1 行に切り詰める。 */
const ROW_CLASSES = `flex min-w-0 flex-1 items-center gap-3 px-3 ${CHAT_THREAD_ROW_HEIGHT_CLASS}`;

type RowContext = {
  readonly paneState: ChatPaneState;
  readonly openIds: readonly string[];
  readonly selectedThreadId: string | null;
  readonly openBesideLabel: string | undefined;
  readonly listQuery: { readonly q: string | null; readonly sort: ChatThreadSort; readonly unread: boolean };
  readonly awaitingReplyIds: ReadonlySet<string>;
  readonly unreadCounts: Readonly<Record<string, number>>;
  readonly mutedIds: ReadonlySet<string>;
  /** ✅ 2026-10-19: 一覧の 2 段目（最後の発言の冒頭）と、時刻の基準。 */
  readonly lastSnippets: Readonly<Record<string, string>>;
  readonly now: Date;
};

/**
 * ✅ 2026-10-19（紺野「何も進んでなくね？」→ 見た目の作り直し）: 一覧の 1 行の形を 1 つにする。
 *   1 段目 = 名前 + 時刻（右端）、2 段目 = 最後の発言の冒頭 + 未読の数（右端）。🔴 印を 2 段目に積まない。
 *   「チャット / スレッド」の文字は出さない（スレッドは字下げで分かる）。「要返信」は名前の前の小さな点。
 */
type RowView = {
  readonly id: string;
  readonly href: string;
  readonly name: string;
  readonly time: string | null;
  readonly snippet: string;
  readonly unread: number;
  readonly muted: boolean;
  readonly awaiting: boolean;
  readonly open: boolean;
  readonly selected: boolean;
  readonly indent: boolean;
  readonly besideHref: string | null;
  readonly besideLabel: string | undefined;
  /** 🔴 目印は種類で書き分ける（`data-testid` は静的に読めるテンプレートで書く。`testid-inventory.test.ts`）。 */
  readonly room: boolean;
  /** 会社の部屋の相手の会社名（読み上げ用）。 */
  readonly counterpartyName?: string;
  readonly kind: string;
};

function Row({ view }: { readonly view: RowView }) {
  const strong = view.unread > 0 && !view.muted;
  return (
    <li
      data-testid={view.room ? `chat-room-${view.id}` : `chat-thread-row-${view.id}`}
      data-selected={view.selected ? 'true' : 'false'}
      data-kind={view.kind}
      className={cn('flex rounded-md', view.indent ? 'pl-6' : null, view.open ? 'bg-brand-bg' : ROW_HOVER_CLASSES)}
    >
      <Link
        href={view.href}
        aria-current={view.selected ? 'page' : undefined}
        className={ROW_CLASSES}
        data-testid={view.room ? `chat-room-link-${view.id}` : `chat-thread-link-${view.id}`}
      >
        <Avatar size="md" initials={displayInitials(view.name)} title={view.name} />
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-2">
            {view.awaiting ? (
              <span className="shrink-0 text-xs text-brand" data-testid={`chat-thread-awaiting-${view.id}`}>
                {t('chat.thread.awaitingReply')}
              </span>
            ) : null}
            <span className={cn('min-w-0 flex-1 truncate text-row text-fg', strong ? 'font-bold' : 'font-normal')}>
              <span className="sr-only">{t('chat.threads.column.target')}</span>
              {view.name}
            </span>
            <span className="shrink-0 text-xs text-fg-placeholder">
              <span className="sr-only">{t('chat.threads.column.lastMessage')}</span>
              {view.time ?? ''}
            </span>
          </span>
          <span className="flex items-center gap-2">
            <span className="min-w-0 flex-1 truncate text-xs text-fg-muted">{view.snippet === '' ? '\u00a0' : view.snippet}</span>
            {view.counterpartyName === undefined ? null : (
              <span className="sr-only" data-testid={`chat-thread-counterparty-${view.id}`}>
                {view.counterpartyName}
              </span>
            )}
            <ChatDraftMark threadId={view.id} label={t('chat.thread.draft')} />
            {view.unread > 0 ? (
              <Badge
                variant={view.muted ? 'neutral' : 'brand'}
                data-testid={view.room ? `chat-room-unread-${view.id}` : `chat-thread-unread-${view.id}`}
              >
                {String(view.unread)}
              </Badge>
            ) : null}
          </span>
        </span>
      </Link>
      {view.besideHref === null || view.besideLabel === undefined ? null : (
        <Link
          href={view.besideHref}
          // 🔴 `cn` は後勝ち。共通の語の `inline-block` / `text-body` をこちらの指定で上書きする。
          className={cn(SECONDARY_LINK_CLASSES, 'flex shrink-0 items-center whitespace-nowrap px-2 text-xs')}
          data-testid={`chat-thread-open-beside-${view.id}`}
        >
          {view.besideLabel}
        </Link>
      )}
    </li>
  );
}

/** 会社の部屋（会社チャット・スレッド）の 1 行の表示値。 */
function threadRowView(item: ChatThreadListItem, context: RowContext): RowView {
  const { paneState, openIds, selectedThreadId, openBesideLabel, listQuery } = context;
  const open = openIds.includes(item.id);
  const isChat = item.kind === 'COMPANY';
  const counterparty = item.counterpartyName ?? t('chat.thread.unknownName');
  // 🔴 チャットは相手の会社名、スレッドは案件名。**案件名が読めないときは種別の語**（`views.ts` の 🔴）。
  const name = isChat ? counterparty : item.project === null ? t(KIND_MESSAGE_KEYS[item.kind]) : item.project.name;
  return {
    id: item.id,
    href: chatHref({ ...withThreadSelected(paneState, item.id), ...listQuery }),
    name,
    time: item.lastMessageAt === null ? t('chat.thread.noMessages') : formatListTime(item.lastMessageAt, context.now),
    snippet: context.lastSnippets[item.id] ?? '',
    unread: context.unreadCounts[item.id] ?? 0,
    muted: context.mutedIds.has(item.id),
    awaiting: context.awaitingReplyIds.has(item.id),
    open,
    selected: item.id === selectedThreadId,
    indent: !isChat,
    // ✅ 2026-10-14: 「右に並べる」は、何かを開いていて・まだ足せて・この会話が開いていないときだけ（押して何も起きない導線を置かない）。
    besideHref:
      openBesideLabel !== undefined && !open && canAddPane(paneState)
        ? chatHref({ ...withPaneAdded(paneState, item.id), ...listQuery })
        : null,
    besideLabel: openBesideLabel,
    room: false,
    // ✅ 2026-10-14: 相手の会社名は読み上げにだけ残す（見た目は名前の欄が受け持つ）。
    counterpartyName: counterparty,
    kind: item.kind,
  };
}

/** DM・グループを読まない画面（テストなど）でも、お気に入りの欄は同じ部品で出す。 */
const EMPTY_PEOPLE: ChatPeopleData = {
  rooms: [],
  contacts: { recent: [], companies: [] },
  unreadCounts: {},
  pinnedIds: [],
  mutedIds: [],
  lastSnippets: {},
};

type ListEntry =
  | { readonly type: 'room'; readonly room: ChatRoomListItem; readonly at: string | null }
  | { readonly type: 'group'; readonly group: ChatThreadGroup; readonly index: number; readonly at: string | null };

/** 部屋（DM・グループ）と会社のまとまりを 1 本に並べる。更新順のときは新しい順、それ以外は部屋を先に。 */
function mergeEntries(groups: readonly ChatThreadGroup[], rooms: readonly ChatRoomListItem[], sort: ChatThreadSort): ListEntry[] {
  const latest = (values: readonly (string | null)[]) =>
    values.reduce<string | null>((max, value) => (value !== null && (max === null || value > max) ? value : max), null);
  const roomEntries: ListEntry[] = rooms.map((room) => ({ type: 'room', room, at: room.lastMessageAt }));
  const groupEntries: ListEntry[] = groups.map((group, index) => ({
    type: 'group',
    group,
    index,
    at: latest([group.chat?.lastMessageAt ?? null, ...group.threads.map((item) => item.lastMessageAt)]),
  }));
  if (sort !== 'recent') return [...roomEntries, ...groupEntries];
  // 🔴 安定な並べ替え（同時刻・発言なしは元の順）。発言の無いものは最後。
  return [...roomEntries, ...groupEntries]
    .map((entry, order) => ({ entry, order }))
    .sort((x, y) => {
      if (x.entry.at === y.entry.at) return x.order - y.order;
      if (x.entry.at === null) return 1;
      if (y.entry.at === null) return -1;
      return x.entry.at < y.entry.at ? 1 : -1;
    })
    .map(({ entry }) => entry);
}

/** DM・グループの 1 行の表示値。 */
function roomRowView(room: ChatRoomListItem, context: RowContext, people: ChatPeopleData | null): RowView {
  const open = context.openIds.includes(room.id);
  const name = room.name ?? t('chat.thread.unknownName');
  return {
    id: room.id,
    href: chatHref({ ...withThreadSelected(context.paneState, room.id), ...context.listQuery }),
    name: room.kind === 'GROUP' ? `${name}（${String(room.memberCount)}${t('chat.people.memberUnit')}）` : name,
    time: room.lastMessageAt === null ? t('chat.thread.noMessages') : formatListTime(room.lastMessageAt, context.now),
    snippet: context.lastSnippets[room.id] ?? '',
    unread: people?.unreadCounts[room.id] ?? 0,
    muted: context.mutedIds.has(room.id),
    awaiting: false,
    open,
    selected: room.id === context.selectedThreadId,
    indent: false,
    besideHref:
      context.openBesideLabel !== undefined && !open && canAddPane(context.paneState)
        ? chatHref({ ...withPaneAdded(context.paneState, room.id), ...context.listQuery })
        : null,
    besideLabel: context.openBesideLabel,
    room: true,
    kind: room.kind,
  };
}

export function ChatThreadList({
  groups,
  selectedThreadId,
  nextCursor,
  paneThreadIds = [],
  openBesideLabel,
  q = null,
  sort = CHAT_THREAD_SORT_DEFAULT,
  truncated = false,
  awaitingReplyIds = [],
  messageHits = [],
  unreadCounts = {},
  unreadOnly = false,
  pinnedIds = [],
  mutedIds = [],
  people = null,
  canPost = false,
  lastSnippets = {},
  now = new Date(),
}: ChatThreadListProps) {
  const paneState: ChatPaneState = { thread: selectedThreadId, panes: paneThreadIds };
  const context: RowContext = {
    paneState,
    openIds: openThreadIds(paneState),
    selectedThreadId,
    openBesideLabel,
    listQuery: { q, sort, unread: unreadOnly },
    awaitingReplyIds: new Set(awaitingReplyIds),
    unreadCounts,
    mutedIds: new Set([...mutedIds, ...(people?.mutedIds ?? [])]),
    lastSnippets: { ...lastSnippets, ...(people?.lastSnippets ?? {}) },
    now,
  };
  const rooms = people?.rooms ?? [];
  const searching = (q !== null && q !== '') || unreadOnly;
  if (groups.length === 0 && rooms.length === 0 && !searching && people === null) {
    return (
      <div className="p-4" data-testid="chat-threads">
        <EmptyState description={t('chat.threads.empty')} testIdPrefix="chat-threads-empty-" />
      </div>
    );
  }
  return (
    <div className="flex min-h-0 flex-col" data-testid="chat-threads">
      {/* ✅ 2026-10-14: 検索と並べ替え。🔴 `method="get"` —— 条件が URL になり、再読込・戻るで同じ一覧に戻る。
          開いている会話（`thread` / `pane`）は hidden で引き継ぐ（検索しても会話が閉じない）。 */}
      <form
        method="get"
        action={CHAT_PATH}
        className="flex flex-col gap-2 p-3"
        data-testid="chat-threads-search"
      >
        {paneState.thread === null ? null : <input type="hidden" name={CHAT_THREAD_PARAM} value={paneState.thread} />}
        {paneState.thread === null
          ? null
          : paneState.panes.map((pane) => <input key={pane} type="hidden" name={CHAT_PANE_PARAM} value={pane} />)}
        <label className="sr-only" htmlFor="chat-threads-q">
          {t('chat.threads.search.label')}
        </label>
        <Input
          id="chat-threads-q"
          type="search"
          name={CHAT_Q_PARAM}
          defaultValue={q ?? ''}
          placeholder={t('chat.threads.search.placeholder')}
          data-testid="chat-threads-q"
        />
        <div className="flex items-center gap-2">
          <label className="sr-only" htmlFor="chat-threads-sort">
            {t('chat.threads.sort.label')}
          </label>
          <Select id="chat-threads-sort" name={CHAT_SORT_PARAM} defaultValue={sort} data-testid="chat-threads-sort">
            {(Object.keys(SORT_MESSAGE_KEYS) as ChatThreadSort[]).map((value) => (
              <option key={value} value={value}>
                {t(SORT_MESSAGE_KEYS[value])}
              </option>
            ))}
          </Select>
          {/* ✅ 2026-10-16: 未読のスレッドだけにする。 */}
          <label className="flex shrink-0 items-center gap-1 text-cell text-fg-muted">
            <input type="checkbox" name={CHAT_UNREAD_PARAM} value="1" defaultChecked={unreadOnly} data-testid="chat-threads-unread" />
            {t('chat.threads.filter.unread')}
          </label>
          <Button type="submit" variant="secondary" size="sm" data-testid="chat-threads-search-submit">
            {t('chat.threads.search.submit')}
          </Button>
        </div>
      </form>
      {groups.length === 0 && rooms.length === 0 && messageHits.length === 0 && searching ? (
        <div className="flex flex-col gap-2 p-4" data-testid="chat-threads-search-empty">
          <p className="m-0 text-body text-fg-muted">{t('chat.threads.search.empty')}</p>
          <Link
            href={chatHref({ ...paneState, sort })}
            // 未読のみ・検索語の両方を外す（「該当なし」から全件に戻る）。
            className={SECONDARY_LINK_CLASSES}
            data-testid="chat-threads-search-clear"
          >
            {t('chat.threads.search.clear')}
          </Link>
        </div>
      ) : (
        <div className="flex min-h-0 flex-col overflow-y-auto">
        {/* ✅ 2026-10-19: お気に入り（ピン留めした会話を丸いアイコンで）と「＋ 新しい会話」（連絡先）。 */}
        {(
          <ChatPeopleSection
            people={people ?? EMPTY_PEOPLE}
            selectedThreadId={selectedThreadId}
            canPost={canPost}
            favorites={[
              ...rooms.filter((room) => (people?.pinnedIds ?? []).includes(room.id)).map((room) => ({ id: room.id, name: room.name })),
              ...groups
                .flatMap((group) => (group.chat === null ? group.threads : [group.chat, ...group.threads]))
                .filter((item) => pinnedIds.includes(item.id))
                .map((item) => ({ id: item.id, name: threadRowView(item, context).name })),
            ]}
            unreadCounts={{ ...unreadCounts, ...(people?.unreadCounts ?? {}) }}
          />
        )}
        {/* ✅ 2026-10-19: DM・グループと会社の会話を**1 本の一覧**にする（新しい順）。スレッドは親の会社チャットの下に字下げ。 */}
        <ul className="m-0 flex list-none flex-col  p-1" aria-label={t('chat.threads.label')}>
          {mergeEntries(groups, rooms, sort).map((entry, index) =>
            entry.type === 'room' ? (
              <Row key={entry.room.id} view={roomRowView(entry.room, context, people)} />
            ) : (
              <li key={entry.group.chat?.id ?? `group-${String(index)}`} data-testid={`chat-thread-group-${String(entry.index)}`}>
                {/* ✅ 2026-10-14: 返信が早い取引先（上位 10%）。🔴 ホストにだけ真になる（`read.ts`）。良いところだけを出す。 */}
                {entry.group.fastReply ? (
                  <p className="m-0 flex items-center gap-2 px-3 pt-2" data-testid={`chat-thread-group-fast-${String(entry.index)}`}>
                    <Badge variant="success">{t('chat.tree.fastReply')}</Badge>
                  </p>
                ) : null}
                <ul className="m-0 flex list-none flex-col  p-0" aria-label={entry.group.counterpartyName ?? t('chat.thread.unknownName')}>
                  {entry.group.chat === null ? (
                    // 🔴 まだチャットが無い会社も、スレッドの親として名前だけを出す（押せない行は作らない）。
                    <li
                      className={`flex items-center gap-3 px-3 ${CHAT_THREAD_ROW_HEIGHT_CLASS}`}
                      data-testid={`chat-thread-group-header-${String(entry.index)}`}
                    >
                      <Avatar
                        size="md"
                        initials={displayInitials(entry.group.counterpartyName ?? t('chat.thread.unknownName'))}
                        title={entry.group.counterpartyName ?? t('chat.thread.unknownName')}
                      />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-row font-normal text-fg">
                          {entry.group.counterpartyName ?? t('chat.thread.unknownName')}
                        </span>
                        <span className="block truncate text-xs text-fg-placeholder">{t('chat.tree.noChat')}</span>
                      </span>
                    </li>
                  ) : (
                    <Row view={threadRowView(entry.group.chat, context)} />
                  )}
                  {entry.group.threads.map((item) => (
                    <Row key={item.id} view={threadRowView(item, context)} />
                  ))}
                </ul>
              </li>
            ),
          )}
        </ul>
        </div>
      )}
      {/* ✅ 2026-10-14: 本文の検索で当たった発言（読めた発言だけ。前後の抜粋）。押すとそのスレッドを開く。 */}
      {messageHits.length === 0 ? null : (
        <section data-testid="chat-threads-message-hits">
          <h3 className="m-0 px-3 pt-3 pb-1 text-cell font-medium text-fg-muted">{t('chat.threads.search.messageHits')}</h3>
          <ul className="m-0 list-none p-0">
            {messageHits.map((hit) => (
              <li key={hit.messageId} className={ROW_HOVER_CLASSES}>
                <Link
                  href={chatHref({ ...withThreadSelected(context.paneState, hit.threadId), ...context.listQuery })}
                  className="flex flex-col gap-1 px-3 py-2"
                  data-testid={`chat-threads-message-hit-${hit.messageId}`}
                >
                  <span className="flex items-center gap-2">
                    <span className="min-w-0 flex-1 truncate text-cell font-normal text-fg">
                      {hit.threadTitle ?? t('chat.thread.unknownName')}
                    </span>
                    <span className="shrink-0 text-xs text-fg-placeholder">{formatDateTimeJst(hit.sentAt)}</span>
                  </span>
                  <span className="text-xs text-fg-muted">{hit.snippet}</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
      {truncated ? (
        <p className="m-0 p-3 text-xs text-fg-muted" data-testid="chat-threads-truncated">
          {t('chat.tree.truncated')}
        </p>
      ) : null}
      {nextCursor === null ? null : (
        <Link
          href={chatHref({ ...paneState, threadsCursor: nextCursor })}
          className={`${SECONDARY_LINK_CLASSES} p-3`}
          data-testid="chat-threads-more"
        >
          {t('chat.threads.more')}
        </Link>
      )}
    </div>
  );
}
