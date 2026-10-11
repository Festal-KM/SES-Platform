// apps/web/app/(main)/_home/messages-tab.tsx
// 🔴 ホームの `メッセージ` タブ（人間の仕様 2026-10-11 の 4 タブ目）。**サーバ描画**。
//
// ============================================================================
// 🔴 この面が守るもの
// ============================================================================
//   ① 🔴 **未読の件数を出さない。**
//      `Message` に**既読の列が無い**（`CLAUDE.md` §4.1 / `docs/04` §S-031 の 🔴 /
//      §4.1 改訂 27 の 🔴）。🔴 **近似（「最後の投稿が相手で N 時間経過」など）を黙って入れない**
//      —— **「見たのに消えない」行**を作る。未読の実体を作るにはモデルの追加が必要で、
//      それは人間の承認事項である（`CLAUDE.md` §8.6）。
//   ② 🔴 **本文の抜粋を出さない。**
//      スレッド一覧の 1 行（`ChatThreadListItem`）は **`id` / `kind` / `project` /
//      `counterpartyName` / `lastMessageAt` の 5 キーだけ**で、本文を持たない
//      （`lib/chat/views.ts` の `CHAT_THREAD_LIST_ITEM_KEYS`）。本文を足すには
//      **スレッドごとに 1 クエリ**が増え、ホームは 60 秒ごとに開かれる画面である
//      （`CLAUDE.md` §7 の p95）。したがって `docs/04` §S-031 の一覧と同じ 3 項目に揃える。
//   ③ 🔴 **他社を示唆する値を 1 つも出さない。** 母集団は `thread_participants` の RLS（C6）が
//      決める（越境経路 3）。社名は**自分が当事者である関係の相手**だけであり、第三者の社名は
//      型として存在しない（`lib/chat/views.ts`）。
//   ④ 🔴 **件数を出さない**（`F-038 AC-1` / `S-031` の 🔴「件数を 1 つも出さない」）。
//      したがって**タブの件数バッジも付けない**（`./home-screen.tsx`）。
//   ⑤ 🔴 **読めなかった値を既定値で埋めない**（`counterpartyName` が `null` のときは
//      専用の語を出す。埋めると「誰との会話か分からない」ことが画面から消える）。
//   ⑥ 🔴 **`AuditLog` を書かない**（`BR-27` の列挙に「チャットの閲覧」は無い。`S-031` と同じ）。
//   ⑦ 🔴 **行から投稿できない**（遷移だけ。`PARTNER_VIEWER` は投稿不可であり、
//      投稿の可否は `S-031` が `canPostChatMessage` で決める）。
import Link from 'next/link';
import type { ReactNode } from 'react';
import { t } from '@ses/i18n';
import {
  Card,
  CardContent,
  EmptyState,
  NAME_CELL_LINK_CLASSES,
  PRIMARY_LINK_CLASSES,
  SectionHeader,
} from '@ses/ui';
import type { ChatThreadListItem } from '../../../lib/chat/views';
import { CHAT_PATH, chatHref } from '../../../lib/chat/screen-query';
import { formatDateTimeJst } from '../../../lib/format/datetime';

/** 🔴 ホームに出すスレッドの本数（**最終更新の新しい順の先頭だけ**）。全体は `S-031` に在る。 */
export const HOME_MESSAGE_THREAD_LIMIT = 5;

export function MessagesTabPanel({ threads }: { readonly threads: readonly ChatThreadListItem[] }) {
  return (
    <div data-testid="home-messages-panel">
      <Card>
        <div className="border-b border-border px-4 pt-4 pb-3">
          <SectionHeader
            icon="message-square"
            title={t('home.tab.messages')}
            // 🔴 **件数を渡さない**（上の ④。`SectionHeader` は `null` で描かない）。
            count={null}
            link={{ href: CHAT_PATH, label: t('home.tab.messages.open') }}
            testIdPrefix="home-messages-panel-header-"
            linkComponent={ChatLink}
            className="mb-0"
          />
        </div>
        <CardContent className="pt-4">
          {threads.length === 0 ? (
            <EmptyState
              testIdPrefix="home-messages-panel-empty-"
              description={t('home.tab.messages.empty')}
              primary={
                <Link className={PRIMARY_LINK_CLASSES} href={CHAT_PATH} data-testid="home-messages-open">
                  {t('home.tab.messages.open')}
                </Link>
              }
              linkComponent={Link}
            />
          ) : (
            <ul className="flex flex-col divide-y divide-border" data-testid="home-messages-list">
              {threads.map((thread) => (
                <li
                  key={thread.id}
                  className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2 text-cell"
                  data-testid={`home-messages-row-${thread.id}`}
                  data-thread-kind={thread.kind}
                >
                  <Link
                    href={chatHref({ thread: thread.id })}
                    className={`${NAME_CELL_LINK_CLASSES} min-w-0 flex-1 basis-full font-medium whitespace-normal break-words sm:basis-auto lg:truncate`}
                    data-testid={`home-messages-counterparty-${thread.id}`}
                  >
                    {thread.counterpartyName ?? t('home.messages.counterparty.unknown')}
                  </Link>
                  {/* 🔴 対象（案件名）。**読めないときは出さない**（公開されていない案件の名は
                      `projects` の RLS〔C4〕が返さない。既定値で埋めない）。 */}
                  <span
                    className="min-w-0 text-xs text-fg-muted lg:truncate"
                    data-testid={`home-messages-subject-${thread.id}`}
                  >
                    {thread.project?.name ?? t('home.actionQueue.valueNone')}
                  </span>
                  {/* 🔴 最終更新。**本文の抜粋は出さない**（上の ②）。 */}
                  <span
                    className="ml-auto shrink-0 whitespace-nowrap text-xs text-fg-muted"
                    data-testid={`home-messages-last-at-${thread.id}`}
                  >
                    {thread.lastMessageAt === null
                      ? t('home.messages.lastMessage.none')
                      : formatDateTimeJst(thread.lastMessageAt)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

/** 🔴 `すべて見る` の testid は文字列リテラルで持つ（`testid-inventory` が静的に解けること）。 */
function ChatLink({
  href,
  className,
  children,
}: {
  readonly href: string;
  readonly className?: string;
  readonly children?: ReactNode;
}) {
  return (
    <Link href={href} className={className} data-testid="home-messages-see-all">
      {children}
    </Link>
  );
}
