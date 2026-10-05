'use client';

// apps/web/app/(main)/chat/chat-conversation.tsx
// `S-031` セクション 2「メッセージ（中央）」+ 入力欄（`docs/04` §S-031 / `F-038` / `docs/05` §6.5 #51）。
//
// ============================================================================
// 🔴 この島が守るもの
// ============================================================================
//   ① 🔴 **添付の口（ボタン）を 1 つも描かない。** `CLAUDE.md` §3.4「ウイルススキャンが `CLEAN` に
//      なるまで共有 URL を発行しない」/ §3.3「チャット添付は `ReviewGate` を通す」の配線が無い。
//      **押して何も起きない導線を作らない**（絵文字 / メンション / 書式 / 通話も同じ理由で描かない）。
//   ② 🔴 **投稿できないロールにはボタンを描かず、理由テキストを置く**（`UI_GUIDELINES` §7 / `BR-44`。
//      `disabled` で残すのは分離・権限の後退である）。
//   ③ 🔴 **二重送信を作らない** —— `createSubmitGuard` で実行を 1 回に畳み、送信中はボタンを
//      送信中表示に置き換える（`docs/04` の共通規律）。
//   ④ 🔴 **既読・未読を描かない**（`messages` に列が無い。`lib/chat/views.ts` の ④）。
//   ⑤ 🔴 **接続状態インジケータ（SSE の `接続中` / `再接続中`）を描かない。** `docs/04` §S-031 は
//      これを求めているが、**`GET /api/realtime/threads/{id}`（`docs/05` §6.5 #52）が未実装**である。
//      実体の無い「接続中」を常時表示すると、**切れていないのに切れていない振りをする**ことになり、
//      §S-031 の目的（「気づかないまま返信を待つ状態を作らない」）と逆に働く。
//      **したがって出さない。** 自動更新も無いので、新着は画面の再読込で現れる。
//   ⑥ 🔴 **`@ses/db` / `@ses/i18n` を値 import しない**（`tests/static/client-db-boundary.test.ts`）。
//      型は `lib/chat/views.ts`（純粋モジュール）から、文言は props から受け取る。
//   ⑦ 🔴 **`<form>` に `method="post"` を付ける** —— 水和前の送信がブラウザの既定 GET で
//      **本文を URL に載せる**のを塞ぐ（`tests/static/form-method-required.test.ts`。実害が 1 度出ている）。
import { useState } from 'react';
import Link from 'next/link';
import { Alert, Avatar, Button, EmptyState, Field, SECONDARY_LINK_CLASSES, Textarea, cn } from '@ses/ui';
import { CHAT_MESSAGE_MAX_LENGTH } from '@ses/config';
import { createSubmitGuard } from '../../../lib/forms/submit-guard';
import { formatDateTimeJst } from '../../../lib/format/datetime';
import { displayInitials } from '../../../lib/format/initials';
import { chatHref, chatMessagesApiPath } from '../../../lib/chat/screen-query';
import type { ChatMessageView } from '../../../lib/chat/views';
import type { ChatConversationMessages } from './chat-props';

export type ChatConversationProps = {
  readonly threadId: string;
  /** 直近 50 件（古い順。`lib/chat/read.ts` が並べ替えて渡す）。 */
  readonly initialMessages: readonly ChatMessageView[];
  /** 🔴 **さらに過去**のカーソル。無ければ `null`。 */
  readonly initialNextCursor: string | null;
  /** 🔴 拒否の本体は API の `requireRole` / `requireNotViewer` であり、ここは導線の出し分けである。 */
  readonly canPost: boolean;
  readonly messages: ChatConversationMessages;
};

/** 投稿の応答（`docs/05` §6.5 #51 の上位互換。`route.ts` の 🔴）。 */
type SendResponseBody = { readonly message: ChatMessageView };
/** 会話の取得（#50）。 */
type MessagePageBody = { readonly items: readonly ChatMessageView[]; readonly nextCursor: string | null };

export function ChatConversation({
  threadId,
  initialMessages,
  initialNextCursor,
  canPost,
  messages,
}: ChatConversationProps) {
  // 🔴 ガードは**インスタンスごと**に持つ（モジュール変数にすると、別のスレッドを開いた島が
  //    同じガードを共有し「前の送信が終わるまで送れない」状態になる）。
  const [sendGuard] = useState(() => createSubmitGuard<'SENT' | 'MISSING' | 'FAILED'>());
  const [olderGuard] = useState(() => createSubmitGuard<'LOADED' | 'FAILED'>());
  const [items, setItems] = useState<readonly ChatMessageView[]>(initialMessages);
  const [nextCursor, setNextCursor] = useState<string | null>(initialNextCursor);
  const [body, setBody] = useState('');
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<'NONE' | 'FAILED' | 'MISSING'>('NONE');
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [olderFailed, setOlderFailed] = useState(false);

  async function submit(): Promise<void> {
    const trimmed = body.trim();
    if (!canPost || trimmed === '' || sending) return;
    setSending(true);
    setSendError('NONE');
    const outcome = await sendGuard.run(async () => {
      try {
        const response = await fetch(chatMessagesApiPath(threadId), {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ body: trimmed }),
        });
        // 🔴 404 = スレッドが見えなくなった（不存在・退出・他社化を区別しない。`docs/05` §4.8）。
        if (response.status === 404) return 'MISSING' as const;
        if (!response.ok) return 'FAILED' as const;
        const payload = (await response.json()) as SendResponseBody;
        // 🔴 手元で先に書き換える楽観更新をしない（サーバの応答だけが正。`S-015` の ⑦ と同じ規律）。
        setItems((current) => [...current, payload.message]);
        setBody('');
        return 'SENT' as const;
      } catch {
        return 'FAILED' as const;
      }
    });
    setSending(false);
    if (outcome === 'MISSING') setSendError('MISSING');
    else if (outcome === 'FAILED') setSendError('FAILED');
  }

  async function loadOlder(): Promise<void> {
    if (nextCursor === null || loadingOlder) return;
    setLoadingOlder(true);
    setOlderFailed(false);
    const outcome = await olderGuard.run(async () => {
      try {
        const response = await fetch(`${chatMessagesApiPath(threadId)}?cursor=${encodeURIComponent(nextCursor)}`, {
          cache: 'no-store',
        });
        if (!response.ok) return 'FAILED' as const;
        const payload = (await response.json()) as MessagePageBody;
        // 🔴 取得済みの**上**に足す（置き換えない）。同じ行が再び来たら 1 行に畳む。
        setItems((current) => {
          const seen = new Set(current.map((item) => item.id));
          return [...payload.items.filter((item) => !seen.has(item.id)), ...current];
        });
        setNextCursor(payload.nextCursor);
        return 'LOADED' as const;
      } catch {
        return 'FAILED' as const;
      }
    });
    setLoadingOlder(false);
    if (outcome === 'FAILED') setOlderFailed(true);
  }

  return (
    <section data-testid="chat-conversation" className="flex flex-col gap-4">
      <div className="flex items-center gap-4">
        <h2 className="text-lg font-semibold text-fg">{messages.heading}</h2>
        {/* 🔴 モバイルは「一覧 → 会話」の 2 画面遷移（`docs/04` §S-031 デバイス別）。戻り道を必ず置く。 */}
        <Link
          href={chatHref({})}
          className={cn('md:hidden', SECONDARY_LINK_CLASSES)}
          data-testid="chat-back-to-list"
        >
          {messages.backToList}
        </Link>
      </div>

      {nextCursor === null ? null : (
        <Button type="button" variant="secondary" size="sm" onClick={() => void loadOlder()} data-testid="chat-messages-older">
          {loadingOlder ? messages.olderLoading : messages.older}
        </Button>
      )}
      {olderFailed ? (
        <Alert variant="danger" data-testid="chat-messages-older-error">
          {messages.olderFailed}
        </Alert>
      ) : null}

      {items.length === 0 ? (
        <EmptyState description={messages.empty} testIdPrefix="chat-messages-empty-" />
      ) : (
        // 🔴 ビューポート基準の高さ（`max-h-[60vh]`）。`ui-shadow-and-size.test.ts` (b) の対象外であり、
        //    画面ごとの px を書いていない。長い会話でも入力欄が画面外に押し出されない。
        <ol
          aria-label={messages.listLabel}
          className="flex max-h-[60vh] flex-col gap-3 overflow-y-auto"
          data-testid="chat-messages"
        >
          {items.map((item) => (
            <li
              key={item.id}
              data-testid={`chat-message-${item.id}`}
              data-own={item.own ? 'true' : 'false'}
              className={cn(
                'flex gap-3 rounded-md border border-border p-3',
                // 🔴 自社と相手の弁別は面の色だけ（吹き出しの幅・形で区別しない。幅の指定は
                //    画面に書けない = `ui-screen-width.test.ts` (c)）。
                item.own ? 'bg-brand-bg' : 'bg-bg-subtle',
              )}
            >
              <Avatar
                initials={displayInitials(item.senderName ?? item.senderCompanyName ?? '?')}
                title={item.senderName ?? messages.unknownName}
              />
              <div className="min-w-0 flex-1">
                <p className="text-micro text-fg-muted">
                  <span data-testid={`chat-message-sender-${item.id}`}>
                    {item.senderName ?? messages.unknownName}
                  </span>
                  <span className="ml-2">{item.senderCompanyName ?? messages.unknownName}</span>
                  {item.own ? <span className="ml-2">{messages.own}</span> : null}
                  <span className="ml-2">{formatDateTimeJst(item.sentAt)}</span>
                </p>
                {/* 🔴 本文は `PURGED` / 保持期間削除で消える（`F-064 AC-2`）。空にせず事実を書く。 */}
                <p className="text-body whitespace-pre-wrap text-fg" data-testid={`chat-message-body-${item.id}`}>
                  {item.body ?? messages.purged}
                </p>
              </div>
            </li>
          ))}
        </ol>
      )}

      {canPost ? (
        // 🔴 `method="post"` は水和前の送信を URL に載せないための壁である（上の ⑦）。
        <form
          method="post"
          action={chatMessagesApiPath(threadId)}
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
          data-testid="chat-compose"
        >
          <Field label={messages.composeLabel} description={messages.composeHint}>
            <Textarea
              name="body"
              value={body}
              maxLength={CHAT_MESSAGE_MAX_LENGTH}
              placeholder={messages.composePlaceholder}
              onChange={(event) => setBody(event.target.value)}
              data-testid="chat-compose-body"
            />
          </Field>
          {sendError === 'NONE' ? null : (
            <Alert variant="danger" data-testid="chat-compose-error">
              {sendError === 'MISSING' ? messages.composeThreadMissing : messages.composeFailed}
            </Alert>
          )}
          <div className="mt-4">
            <Button type="submit" variant="primary" data-testid="chat-compose-submit">
              {sending ? messages.composeSubmitting : messages.composeSubmit}
            </Button>
          </div>
        </form>
      ) : (
        // 🔴 ボタンを描かず理由を置く（`disabled` にしない）。
        <p className="text-body text-fg-muted" data-testid="chat-compose-not-allowed">
          {messages.composeNotAllowed}
        </p>
      )}
    </section>
  );
}
