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
  CHAT_THREAD_ROW_HEIGHT_CLASS,
  EmptyState,
  ROW_HOVER_CLASSES,
  SECONDARY_LINK_CLASSES,
  cn,
} from '@ses/ui';
import { formatDateTimeJst } from '../../../lib/format/datetime';
import { displayInitials } from '../../../lib/format/initials';
import { canAddPane, openThreadIds, withPaneAdded, withThreadSelected } from '../../../lib/chat/panes';
import { chatHref } from '../../../lib/chat/screen-query';
import type { ChatThreadListItem, ChatThreadKind } from '../../../lib/chat/views';

const KIND_MESSAGE_KEYS = {
  PROJECT: 'chat.thread.kind.PROJECT',
  COMPANY: 'chat.thread.kind.COMPANY',
} as const satisfies Readonly<Record<ChatThreadKind, 'chat.thread.kind.PROJECT' | 'chat.thread.kind.COMPANY'>>;

export type ChatThreadListProps = {
  readonly items: readonly ChatThreadListItem[];
  readonly selectedThreadId: string | null;
  readonly nextCursor: string | null;
  /** ✅ 2026-10-14: 右に並べて開いている会話（左から順。`?pane=`）。 */
  readonly paneThreadIds?: readonly string[];
  /** ✅ 2026-10-14: 「右に並べる」の語（`chat.pane.openBeside`）。 */
  readonly openBesideLabel?: string;
};

/** 行 1 つ（60px）。🔴 高さが内容量で変わらないよう、2 段とも 1 行に切り詰める。 */
const ROW_CLASSES = `flex min-w-0 flex-1 items-center gap-3 px-3 ${CHAT_THREAD_ROW_HEIGHT_CLASS}`;

export function ChatThreadList({
  items,
  selectedThreadId,
  nextCursor,
  paneThreadIds = [],
  openBesideLabel,
}: ChatThreadListProps) {
  const paneState = { thread: selectedThreadId, panes: paneThreadIds };
  const openIds = openThreadIds(paneState);
  if (items.length === 0) {
    return (
      <div className="p-4" data-testid="chat-threads">
        <EmptyState description={t('chat.threads.empty')} testIdPrefix="chat-threads-empty-" />
      </div>
    );
  }
  return (
    <div className="flex min-h-0 flex-col" data-testid="chat-threads">
      <ul className="m-0 flex list-none flex-col overflow-y-auto p-0" aria-label={t('chat.threads.label')}>
        {items.map((item) => {
          const selected = item.id === selectedThreadId;
          // ✅ 2026-10-14: 開いている会話（左端か右の列）は選択中と同じ面の色で示す。
          const open = openIds.includes(item.id);
          // ✅ 2026-10-14: 「右に並べる」は、何かを開いていて・まだ足せて・この会話が開いていないときだけ。
          //    🔴 押して何も起きない導線を置かない（上限に達したら描かない）。
          const besideHref =
            openBesideLabel !== undefined && !open && canAddPane(paneState)
              ? chatHref(withPaneAdded(paneState, item.id))
              : null;
          const rowHref = chatHref(withThreadSelected(paneState, item.id));
          // 🔴 対象の名前。**案件名が読めないときは種別の語**（`null` を「案件が無い」と
          //    書き分けない。`lib/chat/views.ts` の 🔴）。
          const target = item.project === null ? t(KIND_MESSAGE_KEYS[item.kind]) : item.project.name;
          const counterparty = item.counterpartyName ?? t('chat.thread.unknownName');
          return (
            <li
              key={item.id}
              data-testid={`chat-thread-row-${item.id}`}
              data-selected={selected ? 'true' : 'false'}
              className={`flex border-b border-border-row ${open ? 'bg-brand-bg' : ROW_HOVER_CLASSES}`}
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
                <Avatar size="md" initials={displayInitials(counterparty)} title={counterparty} />
                <span className="min-w-0 flex-1">
                  {/* 🔴 1 段目は**対象の名前だけ**に全幅を使う。✅ 2026-10-13 の実測で、最終更新を
                      同じ行の右端に置くと（`2026-10-13 11:00 JST` = 約 140px）、319px の柱では
                      名前が `金融系 Web 基...` まで詰まった。**時刻の書式が長いのであって、
                      名前が長いのではない。** 時刻は 2 段目の右端へ移した（情報は減っていない）。 */}
                  <span className="block truncate text-row font-medium text-fg">
                    <span className="sr-only">{t('chat.threads.column.target')}</span>
                    {target}
                  </span>
                  <span className="flex items-center gap-2">
                    <Badge variant="neutral">{t(KIND_MESSAGE_KEYS[item.kind])}</Badge>
                    <span
                      className="min-w-0 flex-1 truncate text-cell text-fg-muted"
                      data-testid={`chat-thread-counterparty-${item.id}`}
                    >
                      {counterparty}
                    </span>
                    <span className="shrink-0 text-xs text-fg-placeholder">
                      <span className="sr-only">{t('chat.threads.column.lastMessage')}</span>
                      {item.lastMessageAt === null
                        ? t('chat.thread.noMessages')
                        : formatDateTimeJst(item.lastMessageAt)}
                    </span>
                  </span>
                </span>
              </Link>
              {/* ✅ 2026-10-14: ドラッグの代わりの導線（キーボード・ドラッグが苦手な人向け）。
                  🔴 一覧の中で `hidden` を使わない（下の ③ の検査）。`md` 未満では会話を開いている間
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
        })}
      </ul>
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
