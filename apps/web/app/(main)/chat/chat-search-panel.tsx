'use client';

// ✅ 2026-10-29（紺野の決定・`docs/02` F-038 ⑰）: この会話の中の検索の欄（会話の見出しの下に開く）。
//
// 🔴 ここが守るもの
//   ① 結果は**この部屋の発言だけ**（`use-chat-search.ts`）。押すとこの部屋の中でその発言へ移る（`jumpAndHighlight`）。
//   ② 件数を出さない（「◯件」を描かない。上限 50 件は語で添えるだけ）。
//   ③ スマホでも同じ欄を出す（隠さない。指で押す行は 44px 以上）。状態は会話の島が持つ。文言は props から受ける。
import { Button, Icon, IconButton, Input } from '@ses/ui';
import { formatDateTimeJst } from '../../../lib/format/datetime';
import { MESSAGE_SEARCH_MIN_LENGTH } from '../../../lib/chat/thread-tree';
import type { ChatConversationState } from './use-chat-conversation';

type ChatSearchPanelState = Pick<
  ChatConversationState,
  'threadId' | 'messages' | 'searchQuery' | 'setSearchQuery' | 'searchResult' | 'closeSearch' | 'jumpAndHighlight' | 'jumpNotLoaded'
>;

export function ChatSearchPanel({ conversation }: { readonly conversation: ChatSearchPanelState }) {
  const { threadId, messages, searchQuery, setSearchQuery, searchResult, closeSearch, jumpAndHighlight, jumpNotLoaded } = conversation;
  const labels = messages.search;
  const inputId = `chat-search-q-${threadId}`;
  return (
    <section
      aria-label={labels.label}
      className="flex shrink-0 flex-col gap-2 border-b border-border bg-bg-subtle px-3 py-2 md:px-5"
      data-testid={`chat-search-${threadId}`}
    >
      <div className="flex items-center gap-2">
        <label className="sr-only" htmlFor={inputId}>
          {labels.label}
        </label>
        <Input
          id={inputId}
          type="search"
          value={searchQuery}
          autoFocus
          placeholder={labels.placeholder}
          className="min-w-0 flex-1"
          onChange={(event) => setSearchQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              event.preventDefault();
              closeSearch();
            }
          }}
          data-testid={`chat-search-input-${threadId}`}
        />
        <IconButton
          type="button"
          variant="ghost"
          className="h-11 w-11 shrink-0"
          icon={<Icon name="x" />}
          aria-label={labels.close}
          title={labels.close}
          onClick={closeSearch}
          data-testid={`chat-search-close-${threadId}`}
        />
      </div>
      <div aria-live="polite">
        {searchQuery.trim().length < MESSAGE_SEARCH_MIN_LENGTH ? (
          <p className="m-0 text-xs text-fg-muted">{labels.hint}</p>
        ) : searchResult.kind === 'loading' || searchResult.kind === 'idle' ? (
          <p className="m-0 text-xs text-fg-muted" data-testid={`chat-search-loading-${threadId}`}>
            {labels.loading}
          </p>
        ) : searchResult.kind === 'failed' ? (
          <p className="m-0 text-xs text-danger" data-testid={`chat-search-failed-${threadId}`}>
            {labels.failed}
          </p>
        ) : searchResult.items.length === 0 ? (
          <p className="m-0 text-xs text-fg-muted" data-testid={`chat-search-empty-${threadId}`}>
            {labels.empty}
          </p>
        ) : (
          <div className="flex flex-col gap-1">
            <p className="m-0 text-xs text-fg-muted">{labels.results}</p>
            <ol className="m-0 flex max-h-[45vh] list-none flex-col overflow-y-auto overscroll-contain p-0" data-testid={`chat-search-results-${threadId}`}>
              {searchResult.items.map((hit) => (
                <li key={hit.messageId} className="border-b border-border-row last:border-b-0">
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-auto min-h-11 w-full flex-col items-start gap-1 py-2 text-left whitespace-normal"
                    onClick={() => void jumpAndHighlight(hit.messageId)}
                    data-testid={`chat-search-hit-${hit.messageId}`}
                  >
                    <span className="flex w-full items-baseline gap-2">
                      <span className="min-w-0 flex-1 truncate text-cell font-medium text-fg">{hit.senderName ?? messages.unknownName}</span>
                      <time dateTime={hit.sentAt} className="shrink-0 text-xs font-normal text-fg-placeholder">
                        {formatDateTimeJst(hit.sentAt)}
                      </time>
                    </span>
                    <span className="w-full break-words text-xs font-normal text-fg-muted">{hit.snippet}</span>
                  </Button>
                </li>
              ))}
            </ol>
          </div>
        )}
        {jumpNotLoaded ? (
          <p className="m-0 pt-1 text-xs text-fg-muted" data-testid={`chat-search-not-loaded-${threadId}`}>
            {labels.notLoaded}
          </p>
        ) : null}
      </div>
    </section>
  );
}
