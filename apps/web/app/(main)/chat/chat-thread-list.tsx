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
import { CHAT_PANE_PARAM, CHAT_PATH, CHAT_Q_PARAM, CHAT_SORT_PARAM, CHAT_THREAD_PARAM, chatHref } from '../../../lib/chat/screen-query';
import {
  CHAT_THREAD_SORT_DEFAULT,
  type ChatThreadGroup,
  type ChatThreadSort,
} from '../../../lib/chat/thread-tree';
import type { ChatThreadListItem, ChatThreadKind } from '../../../lib/chat/views';

const KIND_MESSAGE_KEYS = {
  PROJECT: 'chat.thread.kind.PROJECT',
  COMPANY: 'chat.thread.kind.COMPANY',
} as const satisfies Readonly<Record<ChatThreadKind, 'chat.thread.kind.PROJECT' | 'chat.thread.kind.COMPANY'>>;

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
};

/** 行 1 つ（60px）。🔴 高さが内容量で変わらないよう、2 段とも 1 行に切り詰める。 */
const ROW_CLASSES = `flex min-w-0 flex-1 items-center gap-3 px-3 ${CHAT_THREAD_ROW_HEIGHT_CLASS}`;

type RowContext = {
  readonly paneState: ChatPaneState;
  readonly openIds: readonly string[];
  readonly selectedThreadId: string | null;
  readonly openBesideLabel: string | undefined;
  readonly listQuery: { readonly q: string | null; readonly sort: ChatThreadSort };
  readonly awaitingReplyIds: ReadonlySet<string>;
};

/**
 * 1 行。`COMPANY` = 会社とのチャット（親）、`PROJECT` = 案件スレッド（子。字下げする）。
 */
function ThreadRow({ item, context }: { readonly item: ChatThreadListItem; readonly context: RowContext }) {
  const { paneState, openIds, selectedThreadId, openBesideLabel, listQuery, awaitingReplyIds } = context;
  const awaiting = awaitingReplyIds.has(item.id);
  const selected = item.id === selectedThreadId;
  // ✅ 2026-10-14: 開いている会話（左端か右の列）は選択中と同じ面の色で示す。
  const open = openIds.includes(item.id);
  // ✅ 2026-10-14: 「右に並べる」は、何かを開いていて・まだ足せて・この会話が開いていないときだけ。
  //    🔴 押して何も起きない導線を置かない（上限に達したら描かない）。
  const besideHref =
    openBesideLabel !== undefined && !open && canAddPane(paneState)
      ? chatHref({ ...withPaneAdded(paneState, item.id), ...listQuery })
      : null;
  const rowHref = chatHref({ ...withThreadSelected(paneState, item.id), ...listQuery });
  const counterparty = item.counterpartyName ?? t('chat.thread.unknownName');
  const isChat = item.kind === 'COMPANY';
  // 🔴 対象の名前。チャットは相手の会社名、スレッドは案件名。**案件名が読めないときは種別の語**
  //    （`null` を「案件が無い」と書き分けない。`lib/chat/views.ts` の 🔴）。
  const target = isChat ? counterparty : item.project === null ? t(KIND_MESSAGE_KEYS[item.kind]) : item.project.name;
  return (
    <li
      data-testid={`chat-thread-row-${item.id}`}
      data-selected={selected ? 'true' : 'false'}
      data-kind={item.kind}
      // ✅ 2026-10-14: スレッド（子）は字下げして、どの会社のチャットに含まれるかを位置で示す。
      className={cn('flex border-b border-border-row', isChat ? null : 'pl-6', open ? 'bg-brand-bg' : ROW_HOVER_CLASSES)}
    >
      {/* 🔴 行のリンクはそのままドラッグできる（ブラウザがリンクの URL を運ぶ）。受け口は
          `chat-pane-drop-zone.tsx` で、`lib/chat/panes.ts` の `threadIdFromDroppedUrl` が URL を検める。 */}
      <Link
        href={rowHref}
        aria-current={selected ? 'page' : undefined}
        className={ROW_CLASSES}
        data-testid={`chat-thread-link-${item.id}`}
      >
        {/* 🔴 印であって意味ではない（`aria-hidden` は `Avatar` が立てる）。 */}
        <Avatar size="md" initials={displayInitials(isChat ? counterparty : target)} title={target} />
        <span className="min-w-0 flex-1">
          {/* 🔴 1 段目は**対象の名前だけ**に全幅を使う（時刻は 2 段目の右端。2026-10-13 の実測）。 */}
          <span className="block truncate text-row font-medium text-fg">
            <span className="sr-only">{t('chat.threads.column.target')}</span>
            {target}
          </span>
          <span className="flex items-center gap-2">
            <Badge variant="neutral">{t(KIND_MESSAGE_KEYS[item.kind])}</Badge>
            {/* ✅ 2026-10-14: 要返信（最後の発言が相手から）。色は §3.3「次はあなたの番」= brand。 */}
            {awaiting ? (
              <Badge variant="brand" data-testid={`chat-thread-awaiting-${item.id}`}>
                {t('chat.thread.awaitingReply')}
              </Badge>
            ) : null}
            {/* ✅ 2026-10-14: スレッドは親の会社の下にあるので、相手の会社名は読み上げにだけ残す。 */}
            <span
              className={isChat ? 'min-w-0 flex-1 truncate text-cell text-fg-muted' : 'sr-only'}
              data-testid={`chat-thread-counterparty-${item.id}`}
            >
              {counterparty}
            </span>
            <span className={cn('shrink-0 text-xs text-fg-placeholder', isChat ? null : 'ml-auto')}>
              <span className="sr-only">{t('chat.threads.column.lastMessage')}</span>
              {item.lastMessageAt === null ? t('chat.thread.noMessages') : formatDateTimeJst(item.lastMessageAt)}
            </span>
          </span>
        </span>
      </Link>
      {/* ✅ 2026-10-14: ドラッグの代わりの導線（キーボード・ドラッグが苦手な人向け）。
          🔴 一覧の中で `hidden` を使わない（render テストの ③）。`md` 未満では会話を開いている間
             一覧ごと畳まれる（`page.tsx`）ので、この導線が出るのは実質 `md` 以上だけになる。 */}
      {besideHref === null ? null : (
        <Link
          href={besideHref}
          // 🔴 `cn` は後勝ち。共通の語の `inline-block` / `text-body` をこちらの指定で上書きする。
          className={cn(SECONDARY_LINK_CLASSES, 'flex shrink-0 items-center px-3 text-xs')}
          data-testid={`chat-thread-open-beside-${item.id}`}
        >
          {openBesideLabel}
        </Link>
      )}
    </li>
  );
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
}: ChatThreadListProps) {
  const paneState: ChatPaneState = { thread: selectedThreadId, panes: paneThreadIds };
  const context: RowContext = {
    paneState,
    openIds: openThreadIds(paneState),
    selectedThreadId,
    openBesideLabel,
    listQuery: { q, sort },
    awaitingReplyIds: new Set(awaitingReplyIds),
  };
  const searching = q !== null && q !== '';
  if (groups.length === 0 && !searching) {
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
        className="flex flex-col gap-2 border-b border-border p-3"
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
          <Button type="submit" variant="secondary" size="sm" data-testid="chat-threads-search-submit">
            {t('chat.threads.search.submit')}
          </Button>
        </div>
      </form>
      {groups.length === 0 ? (
        <div className="flex flex-col gap-2 p-4" data-testid="chat-threads-search-empty">
          <p className="m-0 text-body text-fg-muted">{t('chat.threads.search.empty')}</p>
          <Link
            href={chatHref({ ...paneState, sort })}
            className={SECONDARY_LINK_CLASSES}
            data-testid="chat-threads-search-clear"
          >
            {t('chat.threads.search.clear')}
          </Link>
        </div>
      ) : (
        <ul className="m-0 flex list-none flex-col overflow-y-auto p-0" aria-label={t('chat.threads.label')}>
          {groups.map((group, index) => {
            const name = group.counterpartyName ?? t('chat.thread.unknownName');
            return (
              <li key={group.chat?.id ?? `group-${String(index)}`} data-testid={`chat-thread-group-${String(index)}`}>
                {/* ✅ 2026-10-14: 返信が早い取引先（上位 10%）。🔴 ホストにだけ真になる（`read.ts`）。良いところだけを出す。 */}
                {group.fastReply ? (
                  <p className="m-0 flex items-center gap-2 px-3 pt-2" data-testid={`chat-thread-group-fast-${String(index)}`}>
                    <Badge variant="success">{t('chat.tree.fastReply')}</Badge>
                    <span className="truncate text-xs text-fg-muted">{name}</span>
                  </p>
                ) : null}
                <ul className="m-0 list-none p-0" aria-label={name}>
                  {group.chat === null ? (
                    // 🔴 まだチャットが無い会社も、スレッドの親として名前だけを出す（押せない行は作らない）。
                    <li
                      className={`flex items-center gap-3 border-b border-border-row px-3 ${CHAT_THREAD_ROW_HEIGHT_CLASS}`}
                      data-testid={`chat-thread-group-header-${String(index)}`}
                    >
                      <Avatar size="md" initials={displayInitials(name)} title={name} />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-row font-medium text-fg">{name}</span>
                        <span className="block truncate text-xs text-fg-placeholder">{t('chat.tree.noChat')}</span>
                      </span>
                    </li>
                  ) : (
                    <ThreadRow item={group.chat} context={context} />
                  )}
                  {group.threads.map((item) => (
                    <ThreadRow key={item.id} item={item} context={context} />
                  ))}
                </ul>
              </li>
            );
          })}
        </ul>
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
