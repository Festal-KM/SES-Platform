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
import { Alert, Card, CHAT_SCREEN_HEIGHT_CLASS, PageBody, SECONDARY_LINK_CLASSES, cn } from '@ses/ui';
import { resolveTenantCtxOutcome } from '../../../lib/auth/session';
import { canPostChatMessage } from '../../../lib/chat/policy';
import { conversationLayoutFor, conversationTitleFor } from '../../../lib/chat/layout';
import { canAddPane, withPaneClosed, type ChatPaneState } from '../../../lib/chat/panes';
import { readChatScreen } from '../../../lib/chat/read';
import { listChatAttachments, readAttachableThreadIds } from '../../../lib/chat/attachments';
import { CHAT_PATH, chatHref, chatScreenQuerySchema, parseChatFilter } from '../../../lib/chat/screen-query';
import { ChatResizablePane } from './chat-resizable-pane';
import { ChatRail } from './chat-rail';
import { ChatRailToggle } from './chat-rail-toggle';
import { ChatToastHost } from './chat-toast-host';
import { ChatAutoRefresh } from './chat-auto-refresh';
import { ChatViewportHeight } from './chat-viewport-height';
import { CHAT_THREAD_SORT_DEFAULT } from '../../../lib/chat/thread-tree';
import { readMyChatUserStatus } from '../../../lib/chat/user-status';
import { readMySavedList } from '../../../lib/chat/saved';
import { readMyChatTemplates } from '../../../lib/chat/templates';
import { CHAT_TRAIL } from '../../../lib/shell/page-trail';
import { PageHeading } from '../_shell/page-heading';
import { ChatStatusSection } from './chat-status-section';
import { ChatConversation } from './chat-conversation';
import { ChatPaneDropZone } from './chat-pane-drop-zone';
import { chatAttachmentLabels, chatConversationMessages, chatPaneDropMessages } from './chat-props';
import { ChatThreadList } from './chat-thread-list';
import { ChatThreadPanel } from './chat-thread-panel';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const metadata: Metadata = { title: t('chat.title') };

/** ✅ 2026-10-22: `@名前` の候補（DM・グループのメンバーから自分を除いた名前。会社グループ・スレッドは会話の送信者から部品が足す）。 */
function mentionNamesOf(thread: { readonly members?: readonly { readonly name: string | null; readonly self: boolean }[] }): readonly string[] {
  return (thread.members ?? []).filter((member) => !member.self && member.name !== null).map((member) => member.name as string);
}

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
  const infoOpen = query.info === '1';
  const conversationMessages = chatConversationMessages();
  const canPost = canPostChatMessage(ctx.role);
  // ✅ 2026-10-27（改訂 44）: 開いている部屋のうちファイルを添えられる部屋（取引先がいない部屋）。印は投稿できる人にだけ出す。
  const attachableIds = await readAttachableThreadIds(ctx, [
    ...(selected === null ? [] : [selected.id]),
    ...data.panes.flatMap((pane) => (pane.thread === null ? [] : [pane.thread.id])),
  ]);
  // ✅ 2026-10-27: 右の欄の「ファイル」（開いているときだけ読む。`CLEAN` だけ・新しい順）。
  const panelFiles =
    selected !== null && !tiled && infoOpen && attachableIds.has(selected.id) ? await listChatAttachments(ctx, selected.id, {}) : null;
  // ✅ 2026-10-19（#128 §7.1 ①）: 自分のひとこと状態（入口の初期値）。閲覧専用には入口を描かないので読まない。
  const myStatus = canPost ? await readMyChatUserStatus(ctx) : '';
  // ✅ 2026-10-14: 会話を開く・閉じる URL に一覧の検索語と並べ方を引き継ぐ（開くたびに検索が消えない）。
  // ✅ 2026-10-19（v2）: 左の列の絞り込み（`f=`）。旧「未読のみ」（`unread=1`）は「未読」の絞り込みとして読む。
  const filter = query.f === undefined && query.unread === '1' ? parseChatFilter('unread') : parseChatFilter(query.f);
  // ✅ 2026-10-22（紺野）: 自分の定型文（入力欄の選択肢と管理画面）と、保存済み（左の列で選んだときだけ読む）。
  //    閲覧専用は書けないので読まない。🔴 どちらも本人の行だけ（RLS）。
  const ownTemplates = canPost ? await readMyChatTemplates(ctx) : [];
  const saved = filter.kind === 'saved' ? await readMySavedList(ctx) : null;
  // ✅ 2026-10-20: スマホの「絞り込み」ボタンに、いまの絞り込みの名前を出す。
  const filterLabel =
    filter.kind === 'company'
      ? (data.tree?.groups.find((group) => group.key === filter.key)?.counterpartyName ?? t('chat.thread.unknownName'))
      : filter.kind === 'person' || filter.kind === 'contacts' || filter.kind === 'newgroup'
        ? t('chat.people.contacts')
        : filter.kind === 'templates'
          ? t('chat.template.title')
          : t(`chat.rail.${filter.kind}`);
  const listQuery = { q: query.q ?? null, sort: query.sort ?? CHAT_THREAD_SORT_DEFAULT, filter };
  const tree = data.tree ?? {
    groups: [],
    truncated: false,
    messageHits: [],
    unreadCounts: {},
    pinnedIds: [],
    mutedIds: [],
    lastSnippets: {},
  };

  return (
    // スマホは上部の帯と下部ナビの実寸を引き、履歴だけをスクロールさせる。
    // 共通の高さ定数は変更せず、PC は従来の計算を使う。
    <main data-chat-screen className={cn('flex h-[var(--chat-mobile-height,100dvh)] flex-col py-3', CHAT_SCREEN_HEIGHT_CLASS)}>
      <ChatViewportHeight />
      {/* 🔴 ✅ **2026-10-13: `main-min` から既定（`lg` で並置）に変えた。** `main-min` は
          「主カラムが 1320px に届くまで副カラムを下へ落とす」挙動であり、**基準の 1672px でも
          関連情報が会話の下に回り込んでいた**（実機の実測）。デザインシステム v1.0 §3.12 は
          `Main 1018 = 一覧 320 + 会話 698` と `Right 388` の**並置**を定めている。
          ✅ 2026-10-14: **会話を並べているときは右のスレッド情報を出さない**（どの会話の情報か
          決まらず、会話の幅も足りなくなる）。対象と相手は各会話の見出しに出ている。 */}
      <PageBody
        widthClass="split"
        className="min-h-0 flex-1 [&>div]:min-h-0"
        // ✅ 2026-10-19（v2）: 右の情報欄は既定で閉じる（左に絞り込みの列が増えたので、会話の幅を確保する）。
        //    会話の見出しの「情報」で開く（`info=1`）。
        aside={selected === null || tiled || !infoOpen ? undefined : <ChatThreadPanel
              thread={selected}
              canPost={canPost}
              {...(panelFiles === null
                ? {}
                : { files: { items: panelFiles.items, nextCursor: panelFiles.nextCursor, labels: chatAttachmentLabels(), canOpen: canPost } })}
            />}
      >
        {/* 見出し・説明・器を縦に積み、器（Card）が残りの高さを全部使う。 */}
        <div className="flex h-full min-h-0 flex-col">
        {/* ✅ 2026-10-22（紺野「これいらない」）: 見出しの帯（パンくず・タイトル）と説明文を画面から消し、器を上まで使う
            （Teams と同じく会話に高さを回す）。🔴 帯そのものは全画面に 1 つ置く決まり（`tests/static/page-heading-single.test.ts`）
            なので、**読み上げ用にだけ残す**（`sr-only`）。説明文は消した。 */}
        <div className="sr-only">
          <PageHeading trail={CHAT_TRAIL} title={t('chat.title')} />
        </div>
        {/* ✅ 2026-10-20（紺野「トースト」）: 操作の結果を右下に出す（行き先つき・自動で消えない）。 */}
        <ChatToastHost kindLabel={t('chat.toast.kind')} dismissLabel={t('chat.toast.dismiss')} />
        {/* ✅ 2026-10-26（#164 の 3）: 一覧・左の列・右の欄を 60 秒ごとに描き直す（読めなくなったものを残さない）。 */}
        <ChatAutoRefresh />
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
            'flex min-h-0 flex-1 flex-col overscroll-contain p-0 md:flex-row',
            tiled ? 'overflow-x-auto overflow-y-hidden' : 'overflow-hidden',
          )}
        >
          {/* ✅ 2026-10-19（v2）: 左の絞り込みの列（会社から・人から）。🔴 `md` 未満で会話を開いているときは一覧と一緒に畳む。 */}
          <div
            data-chat-rail-container
            className={
              selected === null
                ? 'w-full shrink-0 bg-bg-subtle md:w-44 md:data-[collapsed=true]:w-16 md:overflow-y-auto overscroll-contain'
                : 'hidden shrink-0 bg-bg-subtle md:block md:w-44 md:data-[collapsed=true]:w-16 md:overflow-y-auto overscroll-contain'
            }
          >
            {/* ✅ 2026-10-22: 自分のひとこと状態は左の列のいちばん上（ページ見出しの下から移した）。
                🔴 スマホの「絞り込み」ボタン（畳む部分）の外に置く —— 閉じていても状態を変えられるように。 */}
            {canPost ? (
              <div className="p-2 pb-0 md:in-[[data-collapsed=true]]:hidden">
                <ChatStatusSection canPost={canPost} text={myStatus} />
              </div>
            ) : null}
            {/* ✅ 2026-10-22（Lark の参考）: スマホの上部は「すべて／未読 N／保存済み」の切り替え + 「≡ 絞り込み」。
                ≡ の文字は、今の絞り込みが 3 つ以外（取引先・グループなど）のときだけその名前を出す。 */}
            <ChatRailToggle
              collapseLabel={t('chat.rail.collapseToggle')}
              label={filter.kind === 'all' || filter.kind === 'unread' || filter.kind === 'saved' ? t('chat.rail.menu') : filterLabel}
              closeLabel={t('chat.rail.menuClose')}
              tabs={[
                { key: 'all', href: chatHref({}), label: t('chat.rail.all'), active: filter.kind === 'all' },
                {
                  key: 'unread',
                  href: chatHref({ filter: { kind: 'unread' } }),
                  label: t('chat.rail.unread'),
                  active: filter.kind === 'unread',
                  count: Object.entries({ ...tree.unreadCounts, ...(data.people?.unreadCounts ?? {}) })
                    .filter(([id]) => !tree.mutedIds.includes(id))
                    .reduce((sum, [, count]) => sum + count, 0),
                },
                ...(canPost
                  ? [{ key: 'saved' as const, href: chatHref({ filter: { kind: 'saved' } }), label: t('chat.rail.saved'), active: filter.kind === 'saved' }]
                  : []),
              ]}
            >
            <ChatRail
              groups={tree.groups}
              rooms={data.people?.rooms ?? []}
              unreadCounts={{ ...tree.unreadCounts, ...(data.people?.unreadCounts ?? {}) }}
              mentionUnreadIds={data.mentionUnreadIds}
              filter={filter}
              showContacts={data.people !== null}
              showSaved={canPost}
            />
            </ChatRailToggle>
          </div>
          {/* ✅ 2026-10-16（紺野）: 一覧は薄いグレーの面、会話は白。
              ✅ 2026-10-22（紺野「周りの色を軽く（白）でもいいかも」）: 一覧も白にし、左の列は薄い灰色に。一覧と会話は白どうしなので
              細い線 1 本で区切る（開いている会話の青がはっきり見える）。 */}
          {/* 左: スレッド一覧（320）。🔴 `md` 未満で会話を開いているときは畳む（2 画面遷移） */}
          <div
            className={
              selected === null
                ? 'min-h-0 w-full flex-1 overflow-y-auto bg-bg md:w-96 md:flex-none md:shrink-0 overscroll-contain md:border-r md:border-border'
                : 'hidden bg-bg md:block md:w-96 md:shrink-0 md:overflow-y-auto overscroll-contain md:border-r md:border-border'
            }
          >
            <ChatThreadList
              groups={tree.groups}
              truncated={tree.truncated}
              messageHits={tree.messageHits}
              saved={saved}
              templates={ownTemplates}
              unreadCounts={tree.unreadCounts}
              mentionUnreadIds={data.mentionUnreadIds}
              pinnedIds={tree.pinnedIds}
              mutedIds={tree.mutedIds}
              people={data.people}
              canPost={canPost}
              lastSnippets={tree.lastSnippets}
              filter={filter}
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
          <ChatResizablePane enabled={tiled} storageKey="primary" resizeLabel={t('chat.pane.resize')}
            className={cn(
              selected === null ? 'hidden min-h-0 min-w-0 flex-1 md:flex md:flex-col' : 'flex min-h-0 min-w-0 flex-1 flex-col',
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
                // ✅ 2026-10-26（Codex のレビュー）: 🔴 部屋ごとに作り直す。同じ部品を使い回すと、前の部屋のアナウンス・発言・
                //    入力の状態が、新しい部屋の取得が終わるまで残る（他の部屋のものを一瞬でも見せない）。
                key={selected.id}
                layout={conversationLayoutFor(selected.kind)}
                title={conversationTitleFor(selected)}
                threadId={selected.id}
                threadKind={selected.kind}
                initialMessages={data.messages.items}
                initialNextCursor={data.messages.nextCursor}
                ownTemplates={ownTemplates}
                lastReadMessageId={data.lastReadMessageIds[selected.id] ?? null}
                prefs={data.threadPrefs[selected.id] ?? { pinned: false, muted: false }}
                // ✅ 2026-10-19（#128）: 相手の既読は DM だけ（グループ・会社グループ・スレッドには渡さない）。
                {...(selected.kind === 'DM' ? { peerReadMessageId: data.peerReadMessageIds[selected.id] ?? null } : {})}
                mentionNames={mentionNamesOf(selected)}
                announcement={data.announcements[selected.id] ?? null}
                selfName={data.viewerName}
                // ✅ 2026-10-29（F-038 ⑰）: 一覧の「本文で見つかった発言」から開いたら、その発言へ移る（この部屋の中だけ）。
                jumpToMessageId={query.msg ?? null}
                canPost={canPost}
                canAttach={canPost && attachableIds.has(selected.id)}
                messages={conversationMessages}
                {...(tiled ? { closeHref: chatHref({ ...withPaneClosed(paneState, selected.id), ...listQuery }) } : {})}
                {...(tiled
                  ? {}
                  : {
                      infoHref: chatHref({ ...paneState, ...listQuery, info: !infoOpen }),
                      infoLabel: infoOpen ? t('chat.panel.close') : t('chat.panel.open'),
                    })}
              />
            )}
          </ChatResizablePane>
          {/* ✅ 2026-10-14: 右に並べた会話（最大 2 本）。🔴 `md` 未満では出さない —— モバイルは
              「一覧 → 会話」の 1 列の切替のまま（左端の会話は上で出ている。`docs/04` §S-031 デバイス別）。
              1 列の下限は 320px。足りない幅では器の中で横に送る（ページ全体は横に送らない）。 */}
          {data.panes.map((pane) => (
            <ChatResizablePane enabled storageKey={`pane-${data.panes.indexOf(pane)}`} resizeLabel={t('chat.pane.resize')}
              key={pane.requestedThreadId}
              className={'hidden min-h-0 min-w-0 flex-1 flex-col overscroll-contain border-l border-border md:flex'}
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
                  key={pane.thread.id}
                  layout={conversationLayoutFor(pane.thread.kind)}
                  title={conversationTitleFor(pane.thread)}
                  threadId={pane.thread.id}
                  threadKind={pane.thread.kind}
                  initialMessages={pane.messages.items}
                  initialNextCursor={pane.messages.nextCursor}
                  ownTemplates={ownTemplates}
                  lastReadMessageId={data.lastReadMessageIds[pane.thread.id] ?? null}
                  prefs={data.threadPrefs[pane.thread.id] ?? { pinned: false, muted: false }}
                  {...(pane.thread.kind === 'DM' ? { peerReadMessageId: data.peerReadMessageIds[pane.thread.id] ?? null } : {})}
                  mentionNames={mentionNamesOf(pane.thread)}
                  announcement={data.announcements[pane.thread.id] ?? null}
                  selfName={data.viewerName}
                  canPost={canPost}
                  canAttach={canPost && attachableIds.has(pane.thread.id)}
                  messages={conversationMessages}
                  closeHref={chatHref({ ...withPaneClosed(paneState, pane.thread.id), ...listQuery })}
                />
              )}
            </ChatResizablePane>
          ))}
          {/* ✅ 2026-10-14: ドラッグの受け口（ドラッグ中だけ現れる。`md` 以上）。上限に達したら置かない。 */}
          {canAddPane(paneState) ? (
            <div className={'hidden md:flex'}>
              <ChatPaneDropZone state={paneState} listQuery={listQuery} messages={chatPaneDropMessages()} />
            </div>
          ) : null}
        </Card>
        </div>
      </PageBody>
    </main>
  );
}
