// apps/web/app/(main)/chat/chat-thread-list.tsx
// `S-031` セクション 1「スレッド一覧（左）」（`docs/04` §S-031 / `F-038`）。
//
// ============================================================================
// 🔴 この一覧が守るもの
// ============================================================================
//   ① 🔴 **件数を 1 つも出さない**（総件数 / 未読件数 / 相手ごとの件数）。件数は「見えていない
//      スレッドが在るか」の手がかりになる（`F-038 AC-1` / `docs/05` §4.8 / `HANDOFF.md` §3.3）。
//      このため `Pagination`（件数つき）ではなく「以前のスレッドを読み込む」の 1 本のリンクを置く。
//   ② 🔴 **未読バッジを出さない**（`messages` に既読の列が無い。`lib/chat/views.ts` の ④）。
//   ③ 🔴 **検索・フィルタのタブを置かない**（「すべて / 未読 / グループ / お気に入り」は実体が無く、
//      置くと押せるのに何も変わらない要素になる）。母集団の 1 行（`Toolbar` 相当）は
//      画面側（`page.tsx`）が `PageHeader` の説明で述べる。
//   ④ 🔴 **同型データなのでテーブルで並べる**（`UI_GUIDELINES` §1「同型データの一覧はテーブル。
//      カードで並べない」）。現在地は `TableRow` の `data-state="selected"`（`SELECTED_ROW_CLASSES`）
//      であり、**画面側で色を書かない**（§7.10 の 8 状態は部品が持つ）。
//   ⑤ 🔴 **行そのものがリンクである**（語だけをリンクにして押す的を小さくしない）。
//
// 🔴 サーバコンポーネント（`'use client'` を宣言しない）。
import Link from 'next/link';
import { t } from '@ses/i18n';
import {
  Badge,
  EmptyState,
  SECONDARY_LINK_CLASSES,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@ses/ui';
import { formatDateTimeJst } from '../../../lib/format/datetime';
import { chatHref } from '../../../lib/chat/screen-query';
import type { ChatThreadListItem, ChatThreadKind } from '../../../lib/chat/views';

/**
 * 🔴 対象の語（`案件` / `企業間`）。**色を持たせない**（業務上の状態ではなく「種別」であり、
 *    `StatusBadge`（§5-1 の 36 状態）の対象でもない。無彩色の `Badge` 1 種だけを使う）。
 */
const KIND_MESSAGE_KEYS = {
  PROJECT: 'chat.thread.kind.PROJECT',
  COMPANY: 'chat.thread.kind.COMPANY',
} as const satisfies Readonly<Record<ChatThreadKind, 'chat.thread.kind.PROJECT' | 'chat.thread.kind.COMPANY'>>;

export type ChatThreadListProps = {
  readonly items: readonly ChatThreadListItem[];
  /** 選択中のスレッド（`null` なら選択なし）。 */
  readonly selectedThreadId: string | null;
  /** 次ページ（🔴 **さらに過去**のスレッド）。無ければ `null`。 */
  readonly nextCursor: string | null;
};

export function ChatThreadList({ items, selectedThreadId, nextCursor }: ChatThreadListProps) {
  if (items.length === 0) {
    return (
      <div data-testid="chat-threads">
        <EmptyState description={t('chat.threads.empty')} testIdPrefix="chat-threads-empty-" />
      </div>
    );
  }
  return (
    <div data-testid="chat-threads">
      <Table aria-label={t('chat.threads.label')}>
        <TableHeader>
          <TableRow>
            <TableHead>{t('chat.threads.column.target')}</TableHead>
            <TableHead>{t('chat.threads.column.lastMessage')}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {items.map((item) => (
            <TableRow
              key={item.id}
              align="top"
              // 🔴 現在地の見た目は部品が持つ（`SELECTED_ROW_CLASSES`）。画面で色を書かない。
              data-state={item.id === selectedThreadId ? 'selected' : undefined}
              data-testid={`chat-thread-row-${item.id}`}
            >
              {/* 🔴 セルは折り返す（長い案件名で横スクロールを起こさない。狭い柱に置く表である） */}
              <TableCell whitespace="normal">
                <Link
                  href={chatHref({ thread: item.id })}
                  className={SECONDARY_LINK_CLASSES}
                  data-testid={`chat-thread-link-${item.id}`}
                >
                  {item.project === null ? t(KIND_MESSAGE_KEYS[item.kind]) : item.project.name}
                </Link>
                <span className="mt-1 flex items-center gap-2">
                  <Badge variant="neutral">{t(KIND_MESSAGE_KEYS[item.kind])}</Badge>
                  <span className="text-micro text-fg-muted" data-testid={`chat-thread-counterparty-${item.id}`}>
                    {item.counterpartyName ?? t('chat.thread.unknownName')}
                  </span>
                </span>
              </TableCell>
              <TableCell whitespace="normal" className="text-micro text-fg-muted">
                {item.lastMessageAt === null ? t('chat.thread.noMessages') : formatDateTimeJst(item.lastMessageAt)}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      {nextCursor === null ? null : (
        <Link
          href={chatHref({ thread: selectedThreadId, threadsCursor: nextCursor })}
          className={SECONDARY_LINK_CLASSES}
          data-testid="chat-threads-more"
        >
          {t('chat.threads.more')}
        </Link>
      )}
    </div>
  );
}
