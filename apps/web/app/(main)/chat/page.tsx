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
import { redirect } from 'next/navigation';
import type { Metadata } from 'next';
import { CHAT_MESSAGE_PAGE_SIZE, PAGE_SIZE_DEFAULT } from '@ses/config';
import { t } from '@ses/i18n';
import { Alert, PageBody } from '@ses/ui';
import { resolveTenantCtxOutcome } from '../../../lib/auth/session';
import { canPostChatMessage } from '../../../lib/chat/policy';
import { readChatScreen } from '../../../lib/chat/read';
import { CHAT_PATH, chatScreenQuerySchema } from '../../../lib/chat/screen-query';
import { CHAT_TRAIL } from '../../../lib/shell/page-trail';
import { PageHeading } from '../_shell/page-heading';
import { ChatConversation } from './chat-conversation';
import { chatConversationMessages } from './chat-props';
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
    threadsQuery: { limit: PAGE_SIZE_DEFAULT, ...(query.threads === undefined ? {} : { cursor: query.threads }) },
    messagesQuery: { limit: CHAT_MESSAGE_PAGE_SIZE },
  });
  const selected = data.thread;

  return (
    <main className="py-6">
      <PageBody
        widthClass="split"
        asideFrom="main-min"
        aside={selected === null ? undefined : <ChatThreadPanel thread={selected} />}
      >
        <PageHeading trail={CHAT_TRAIL} title={t('chat.title')} />
        <p className="mb-4 text-body text-fg-muted">{t('chat.threads.population')}</p>
        {/* 🔴 不存在・他社・他テナントで同じ文言（`docs/05` §4.8） */}
        {data.requestedThreadMissing ? (
          <Alert variant="warning" className="mb-4" data-testid="chat-thread-missing">
            {t('chat.thread.missing')}
          </Alert>
        ) : null}
        <div className="flex gap-4">
          {/* 左: スレッド一覧。🔴 `md` 未満で会話を開いているときは畳む（2 画面遷移） */}
          <div className={selected === null ? 'w-full md:w-80 md:shrink-0' : 'hidden md:block md:w-80 md:shrink-0'}>
            <ChatThreadList
              items={data.threads.items}
              selectedThreadId={selected?.id ?? null}
              nextCursor={data.threads.nextCursor}
            />
          </div>
          {/* 中央: 会話。🔴 選択が無いときは `md` 以上でだけ案内を出す（モバイルは一覧が全幅） */}
          <div className={selected === null ? 'hidden min-w-0 flex-1 md:block' : 'min-w-0 flex-1'}>
            {selected === null ? (
              <p className="text-body text-fg-muted" data-testid="chat-select-prompt">
                {t('chat.select.prompt')}
              </p>
            ) : (
              <ChatConversation
                threadId={selected.id}
                initialMessages={data.messages.items}
                initialNextCursor={data.messages.nextCursor}
                canPost={canPostChatMessage(ctx.role)}
                messages={chatConversationMessages()}
              />
            )}
          </div>
        </div>
      </PageBody>
    </main>
  );
}
