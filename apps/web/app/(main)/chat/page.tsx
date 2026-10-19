// apps/web/app/(main)/chat/page.tsx
// `S-031` チャット（`docs/04` §S-031 / `F-038` `F-011` `F-020` / **Tier 1** / `CLAUDE.md` §3.1 経路 3）。
//
// ============================================================================
// 🔴 3 カラムをどう収めたか（`docs/04` §7.1 / §S-031「デスクトップ = 3 カラム」）
// ============================================================================
// §7.1 の幅クラス B（`split`）は**副カラム 1 本**しか持たない（`PageBody` の `aside`）。`S-031` は
// 「スレッド一覧（左）/ メッセージ（中央）/ スレッド情報（右）」の 3 面なので、**1 本足りない。**
//
//   - **右（スレッド情報）** … `PageBody` の `aside`。🔴 **`asideFrom="main-min"`** を選ぶ
//     （`packages/ui/src/components/page-body.tsx` の `PageBodyAsideFrom` の 🔴）。既定の `'lg'` に
//     すると、`lg`（1024px）で主カラムが `752 − 24 − 360 = 368px` になり、**左の柱 320px を引くと
//     会話が 32px になる** —— 「幅を広げると悪化する」崖そのものである。`'main-min'` は
//     「主カラムが下限を保てるときだけ並置する」判定なので崖が起きない。⚠️ **代償**: 右パネルが
//     横に並ぶのは器が 1,824px 以上（ビューポート ≒ 2,096px）になってからで、それ未満では
//     **2 カラムの下に積まれる**（`docs/04` §S-031 は「タブレット = 右パネルはシート」と書いているが、
//     シートは overlay であり**判断材料を隠す**側に倒れるため、積む形にした。申し送り）。
//   - **左（スレッド一覧）と中央（メッセージ）** … 主カラムの中で `flex` の 2 列。
//     🔴 **`md` 未満では「一覧 → 会話」の 2 画面遷移**（`docs/04` §S-031 デバイス別）。選択中は
//     一覧を畳み、会話に「スレッド一覧へ戻る」を置く（**遮断ではなく切替**。`CLAUDE.md` §13.3）。
//
// ============================================================================
// 🔴 境界（レビューの焦点）
// ============================================================================
//   - 🔴 **ロールで到達を止めない**（`docs/04` §S-031 の必要ロールは全ロール）。見えるものを決めるのは
//     `thread_participants` の行の有無（RLS の C6）であり、`VIEWER` も取引先も到達してよい。
//     投稿だけがロールで分かれる（`canPostChatMessage`）。
//   - 🔴 **自己 fetch しない。** API（`docs/05` §6.5 #50）と**同じ関数**（`readChatScreen`）を通る。
//   - 🔴 **`AuditLog` を書かない**（`CLAUDE.md` §3.5 / `BR-27` の列挙に「チャットの閲覧」は無い）。
//   - 🔴 **件数を 1 つも出さない**（総件数・未読・他社の件数。`F-038 AC-1`）。
import Link from 'next/link';
import { redirect } from 'next/navigation';
import type { Metadata } from 'next';
import { CHAT_MESSAGE_PAGE_SIZE, PAGE_SIZE_DEFAULT } from '@ses/config';
import { t } from '@ses/i18n';
import { Alert, Card, CONTENT_PADDING_Y_CLASS, PageBody, SECONDARY_LINK_CLASSES, cn } from '@ses/ui';
import { resolveTenantCtxOutcome } from '../../../lib/auth/session';
import { canPostChatMessage } from '../../../lib/chat/policy';
import { conversationLayoutFor, conversationTitleFor } from '../../../lib/chat/layout';
import { canAddPane, withPaneClosed, type ChatPaneState } from '../../../lib/chat/panes';
import { readChatScreen } from '../../../lib/chat/read';
import { CHAT_PATH, chatHref, chatScreenQuerySchema } from '../../../lib/chat/screen-query';
import { CHAT_THREAD_SORT_DEFAULT } from '../../../lib/chat/thread-tree';
import { CHAT_TRAIL } from '../../../lib/shell/page-trail';
import { PageHeading } from '../_shell/page-heading';
import { ChatConversation } from './chat-conversation';
import { ChatPaneDropZone } from './chat-pane-drop-zone';
import { chatConversationMessages, chatPaneDropMessages } from './chat-props';
import { ChatThreadList } from './chat-thread-list';
import { ChatThreadPanel } from './chat-thread-panel';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const metadata: Metadata = { title: t('chat.title') };

export default async function ChatPage({
  searchParams,
}: {
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const outcome = await resolveTenantCtxOutcome();
  if (outcome.status === 'UNAUTHENTICATED') redirect('/signin');
  if (outcome.status === 'TWO_FACTOR_REQUIRED') redirect('/signin?step=2fa');
  const ctx = outcome.ctx;

  // 🔴 壊れた条件は素の `/chat` へ戻す（握り潰して無指定扱いにしない。`S-019` と同じ判断）。
  const parsed = chatScreenQuerySchema.safeParse(await searchParams);
  if (!parsed.success) redirect(CHAT_PATH);
  const query = parsed.data;

  const data = await readChatScreen(ctx, {
    threadId: query.thread ?? null,
    // ✅ 2026-10-14（レビュー指摘）: 一覧は木で読むので、ページ単位のカーソル（`?threads=`）は使わない。
    threadsQuery: { limit: PAGE_SIZE_DEFAULT },
    messagesQuery: { limit: CHAT_MESSAGE_PAGE_SIZE },
    paneIds: query.pane ?? [],
    // ✅ 2026-10-14: 一覧は会社ごとの木（検索語と並べ方は URL の `q` / `sort`）。
    tree: { sort: query.sort ?? CHAT_THREAD_SORT_DEFAULT, q: query.q ?? null, unreadOnly: query.unread === '1' },
  });
  const selected = data.thread;
  // ✅ 2026-10-14（チャットレーン）: 右に並べて開いた会話（`lib/chat/panes.ts`）。
  //    左端が見えないときは並びも出さない（`read.ts` が空で返す）。
  const paneState: ChatPaneState = {
    thread: selected?.id ?? null,
    panes: selected === null ? [] : data.panes.map((pane) => pane.requestedThreadId),
  };
  const tiled = data.panes.length > 0;
  const conversationMessages = chatConversationMessages();
  const canPost = canPostChatMessage(ctx.role);
  // ✅ 2026-10-14: 会話を開く・閉じる URL に一覧の検索語と並べ方を引き継ぐ（開くたびに検索が消えない）。
  const listQuery = { q: query.q ?? null, sort: query.sort ?? CHAT_THREAD_SORT_DEFAULT, unread: query.unread === '1' };
  const tree = data.tree ?? {
    groups: [],
    truncated: false,
    awaitingReplyIds: [],
    messageHits: [],
    unreadCounts: {},
    pinnedIds: [],
    mutedIds: [],
    lastSnippets: {},
  };

  return (
    <main className={CONTENT_PADDING_Y_CLASS}>
      {/* 🔴 ✅ **2026-10-13: `main-min` から既定（`lg` で並置）に変えた。** `main-min` は
          「主カラムが 1320px に届くまで副カラムを下へ落とす」挙動であり、**基準の 1672px でも
          関連情報が会話の下に回り込んでいた**（実機の実測）。デザインシステム v1.0 §3.12 は
          `Main 1018 = 一覧 320 + 会話 698` と `Right 388` の**並置**を定めている。
          ✅ 2026-10-14: **会話を並べているときは右のスレッド情報を出さない**（どの会話の情報か
          決まらず、会話の幅も足りなくなる）。対象と相手は各会話の見出しに出ている。 */}
      <PageBody
        widthClass="split"
        aside={selected === null || tiled ? undefined : <ChatThreadPanel thread={selected} canPost={canPost} />}
      >
        <PageHeading trail={CHAT_TRAIL} title={t('chat.title')} />
        <p className="mb-4 text-body text-fg-muted">{t('chat.threads.population')}</p>
        {/* 🔴 不存在・他社・他テナントで同じ文言（`docs/05` §4.8） */}
        {data.requestedThreadMissing ? (
          <Alert variant="warning" className="mb-4" data-testid="chat-thread-missing">
            {t('chat.thread.missing')}
          </Alert>
        ) : null}
        {/* ✅ **2026-10-13（`docs/design-system.md` §4.5）: 一覧と会話を 1 枚の白い面に収めた。**
            🔴 従来は 2 つの器が 16px の隙間を挟んで並んでおり、**同じ 1 つの会話が 2 つの面に
               割れて見えていた**（定義書は Main 1018 を「スレッド一覧 320 + 会話 698」の
               1 枚として定義している）。区切りは**面の間の隙間ではなく 1px の罫線**である。 */}
        {/* ✅ 2026-10-14: 会話を並べているときは、幅が足りない分を**器の中で横に送る**（会話を潰さない）。 */}
        <Card
          className={cn(
            'flex min-h-0 flex-1 p-0',
            tiled ? 'overflow-x-auto overflow-y-hidden' : 'overflow-hidden',
          )}
        >
          {/* ✅ 2026-10-16（紺野）: 一覧は薄いグレーの面、会話は白。境の罫線はやめ、面の色の違いで分ける。 */}
          {/* 左: スレッド一覧（320）。🔴 `md` 未満で会話を開いているときは畳む（2 画面遷移） */}
          <div
            className={
              selected === null
                ? 'w-full bg-bg-subtle md:w-80 md:shrink-0'
                : 'hidden bg-bg-subtle md:block md:w-80 md:shrink-0'
            }
          >
            <ChatThreadList
              groups={tree.groups}
              truncated={tree.truncated}
              awaitingReplyIds={tree.awaitingReplyIds}
              messageHits={tree.messageHits}
              unreadCounts={tree.unreadCounts}
              pinnedIds={tree.pinnedIds}
              mutedIds={tree.mutedIds}
              people={data.people}
              canPost={canPost}
              lastSnippets={tree.lastSnippets}
              unreadOnly={listQuery.unread}
              q={listQuery.q}
              sort={listQuery.sort}
              selectedThreadId={selected?.id ?? null}
              // 🔴 木は全件を読むので、ページ送りは無い（上限を超えたら `truncated` が知らせる）。
              nextCursor={null}
              paneThreadIds={paneState.panes}
              openBesideLabel={t('chat.pane.openBeside')}
            />
          </div>
          {/* 中央: 会話（698）。🔴 選択が無いときは `md` 以上でだけ案内を出す（モバイルは一覧が全幅） */}
          <div
            className={cn(
              selected === null ? 'hidden min-w-0 flex-1 md:flex md:flex-col' : 'flex min-w-0 flex-1 flex-col',
              // ✅ 2026-10-14: 並べているときは右の列と同じ下限（320px。`md` 以上だけ）。
              tiled ? 'md:min-w-80' : null,
            )}
          >
            {selected === null ? (
              <p className="m-0 p-5 text-body text-fg-muted" data-testid="chat-select-prompt">
                {t('chat.select.prompt')}
              </p>
            ) : (
              <ChatConversation
                layout={conversationLayoutFor(selected.kind)}
                title={conversationTitleFor(selected)}
                threadId={selected.id}
                initialMessages={data.messages.items}
                initialNextCursor={data.messages.nextCursor}
                lastReadMessageId={data.lastReadMessageIds[selected.id] ?? null}
                prefs={data.threadPrefs[selected.id] ?? { pinned: false, muted: false }}
                // ✅ 2026-10-19（#128）: 相手の既読は DM だけ（グループ・会社グループ・スレッドには渡さない）。
                {...(selected.kind === 'DM' ? { peerReadMessageId: data.peerReadMessageIds[selected.id] ?? null } : {})}
                canPost={canPost}
                messages={conversationMessages}
                {...(tiled ? { closeHref: chatHref({ ...withPaneClosed(paneState, selected.id), ...listQuery }) } : {})}
              />
            )}
          </div>
          {/* ✅ 2026-10-14: 右に並べた会話（最大 2 本）。🔴 `md` 未満では出さない —— モバイルは
              「一覧 → 会話」の 1 列の切替のまま（左端の会話は上で出ている。`docs/04` §S-031 デバイス別）。
              1 列の下限は 320px。足りない幅では器の中で横に送る（ページ全体は横に送らない）。 */}
          {data.panes.map((pane) => (
            <div
              key={pane.requestedThreadId}
              className={'hidden min-w-80 flex-1 flex-col border-l border-border md:flex'}
              data-testid={`chat-pane-${pane.requestedThreadId}`}
            >
              {pane.thread === null ? (
                // 🔴 不存在・他社・他テナントで同じ文言（左端と同じ。`docs/05` §4.8）。
                <div className="flex flex-col gap-3 p-5">
                  <Alert variant="warning" data-testid={`chat-pane-missing-${pane.requestedThreadId}`}>
                    {t('chat.thread.missing')}
                  </Alert>
                  <Link
                    href={chatHref({ ...withPaneClosed(paneState, pane.requestedThreadId), ...listQuery })}
                    className={SECONDARY_LINK_CLASSES}
                    data-testid={`chat-pane-close-${pane.requestedThreadId}`}
                  >
                    {t('chat.pane.close')}
                  </Link>
                </div>
              ) : (
                <ChatConversation
                  layout={conversationLayoutFor(pane.thread.kind)}
                  title={conversationTitleFor(pane.thread)}
                  threadId={pane.thread.id}
                  initialMessages={pane.messages.items}
                  initialNextCursor={pane.messages.nextCursor}
                  lastReadMessageId={data.lastReadMessageIds[pane.thread.id] ?? null}
                  prefs={data.threadPrefs[pane.thread.id] ?? { pinned: false, muted: false }}
                  {...(pane.thread.kind === 'DM' ? { peerReadMessageId: data.peerReadMessageIds[pane.thread.id] ?? null } : {})}
                  canPost={canPost}
                  messages={conversationMessages}
                  closeHref={chatHref({ ...withPaneClosed(paneState, pane.thread.id), ...listQuery })}
                />
              )}
            </div>
          ))}
          {/* ✅ 2026-10-14: ドラッグの受け口（ドラッグ中だけ現れる。`md` 以上）。上限に達したら置かない。 */}
          {canAddPane(paneState) ? (
            <div className={'hidden md:flex'}>
              <ChatPaneDropZone state={paneState} listQuery={listQuery} messages={chatPaneDropMessages()} />
            </div>
          ) : null}
        </Card>
      </PageBody>
    </main>
  );
}
