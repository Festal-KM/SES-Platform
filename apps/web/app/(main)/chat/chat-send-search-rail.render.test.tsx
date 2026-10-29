// ✅ 2026-10-29（F-038 ⑮ ⑯ ⑰）: 送った発言の吹き出し・会話の中の検索・左の列の並び替えの描画。
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ChatRail } from './chat-rail';
import { ChatConversation } from './chat-conversation';
import { ChatOutboxBubble } from './chat-outbox-item';
import { ChatSearchPanel } from './chat-search-panel';
import { chatConversationMessages } from './chat-props';
import type { ChatOutboxItem } from './use-chat-conversation';

const THREAD = '01930000-0000-7000-8000-000000000121';
const MESSAGE = '01930000-0000-7000-8000-000000000201';
const messages = chatConversationMessages();

function outboxEntry(overrides: Partial<ChatOutboxItem>): ChatOutboxItem {
  return {
    tempId: 'chat-tmp-1-1',
    status: 'SENDING',
    failure: null,
    text: '来週の面談の件です',
    after: null,
    payload: { body: '来週の面談の件です', project: null, file: null, quote: null },
    ...overrides,
  };
}

function bubble(entry: ChatOutboxItem): string {
  return renderToStaticMarkup(
    createElement(ChatOutboxBubble, {
      entry,
      conversation: { messages, mentionCandidates: [], resendOutbox: () => undefined, discardOutbox: () => undefined },
    }),
  );
}

describe('⑮ 送った発言をその場で出す', () => {
  it('送っている間は自分の吹き出しに「送信中」を出し、操作（再送・取り消す）を描かない', () => {
    const html = bubble(outboxEntry({}));
    expect(html).toContain('来週の面談の件です');
    expect(html).toContain(messages.outbox.sending);
    expect(html).toContain('data-status="SENDING"');
    expect(html).toContain('bg-brand text-brand-fg');
    expect(html).not.toContain('chat-outbox-resend-');
    expect(html).not.toContain('chat-outbox-discard-');
    // 🔴 手元だけの吹き出しに、サーバの発言の操作（リアクション・保存・編集）を付けない。
    expect(html).not.toContain('chat-message-');
  });

  it('ファイルを置いている間は「アップロード中」', () => {
    expect(bubble(outboxEntry({ status: 'UPLOADING' }))).toContain(messages.outbox.uploading);
  });

  it('送れなかったら「送れませんでした」と「再送」「取り消す」', () => {
    const html = bubble(outboxEntry({ status: 'FAILED', failure: 'FAILED' }));
    expect(html).toContain(messages.outbox.failed);
    expect(html).toContain('data-testid="chat-outbox-resend-chat-tmp-1-1"');
    expect(html).toContain('data-testid="chat-outbox-discard-chat-tmp-1-1"');
  });

  it('🔴 貼れない案件で断られた発言には「再送」を描かない（取り消すだけ）', () => {
    const html = bubble(outboxEntry({ status: 'FAILED', failure: 'PROJECT' }));
    expect(html).toContain(messages.pasteProject.notPastable);
    expect(html).not.toContain('chat-outbox-resend-');
    expect(html).toContain('chat-outbox-discard-');
  });

  it('入力欄に 5 秒の取り消し待ち（「取り消す」「今すぐ送る」）を描かない', () => {
    const html = renderToStaticMarkup(
      createElement(ChatConversation, { threadId: THREAD, initialMessages: [], initialNextCursor: null, canPost: true, messages }),
    );
    expect(html).toContain('data-testid="chat-compose-submit"');
    expect(html).not.toContain('chat-compose-undo');
    expect(html).not.toContain('chat-compose-send-now');
    expect(html).not.toContain('chat-compose-pending');
  });
});

describe('⑰ 会話の中の検索', () => {
  const base = {
    threadId: THREAD,
    messages,
    setSearchQuery: () => undefined,
    closeSearch: () => undefined,
    jumpAndHighlight: async () => undefined,
    jumpNotLoaded: false,
  };

  it('見出しに検索の印（閲覧専用にも）がある', () => {
    const html = renderToStaticMarkup(
      createElement(ChatConversation, { threadId: THREAD, initialMessages: [], initialNextCursor: null, canPost: false, messages }),
    );
    expect(html).toContain(`data-testid="chat-search-toggle-${THREAD}"`);
    expect(html).toContain(`aria-label="${messages.search.open}"`);
  });

  it('結果は送った人・日時・冒頭を並べ、🔴 件数を出さない', () => {
    const html = renderToStaticMarkup(
      createElement(ChatSearchPanel, {
        conversation: {
          ...base,
          searchQuery: '面談',
          searchResult: { kind: 'done', items: [{ messageId: MESSAGE, sentAt: '2026-10-29T01:00:00.000Z', senderName: '佐藤', snippet: '…来週の面談の件…' }] },
        },
      }),
    );
    expect(html).toContain(`data-testid="chat-search-hit-${MESSAGE}"`);
    expect(html).toContain('佐藤');
    expect(html).toContain('…来週の面談の件…');
    expect(html).not.toMatch(/\d+\s*件(?!まで)/);
  });

  it('2 文字未満では案内だけ・0 件は「見つかりませんでした」', () => {
    const short = renderToStaticMarkup(createElement(ChatSearchPanel, { conversation: { ...base, searchQuery: '面', searchResult: { kind: 'idle' } } }));
    expect(short).toContain(messages.search.hint);
    const empty = renderToStaticMarkup(
      createElement(ChatSearchPanel, { conversation: { ...base, searchQuery: '面談', searchResult: { kind: 'done', items: [] } } }),
    );
    expect(empty).toContain(messages.search.empty);
  });
});

describe('⑯ 左の列の並び替え', () => {
  it('最初は元の並びで、「並び替え」の入口がある（編集の欄はまだ出さない）', () => {
    const html = renderToStaticMarkup(
      createElement(ChatRail, { groups: [], rooms: [], unreadCounts: {}, filter: { kind: 'all' }, showContacts: true, showSaved: true }),
    );
    expect(html).toContain('data-testid="chat-rail-reorder-toggle"');
    expect(html).not.toContain('data-testid="chat-rail-reorder"');
    const order = ['all', 'unread', 'dm', 'group', 'saved', 'contacts'].map((key) => html.indexOf(`data-testid="chat-rail-${key}"`));
    expect(order.every((index) => index >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });

  it('🔴 閲覧専用の「保存済み」は並び替えでも増えない', () => {
    const html = renderToStaticMarkup(
      createElement(ChatRail, { groups: [], rooms: [], unreadCounts: {}, filter: { kind: 'all' }, showContacts: false, showSaved: false }),
    );
    expect(html).not.toContain('chat-rail-saved');
  });
});
