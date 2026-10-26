// apps/web/app/(main)/chat/chat-unavailable.render.test.tsx
// ✅ 2026-10-26（#164 の 2）: 開いている間に読めなくなった会話（部屋から外れた・公開が取り消された等）。
//
// 🔴 固定すること: 読めなくなったら、手元に残っている本文・相手の名前・入力欄を 1 つも描かない。
//    （状態に行が残っていても描かない = 描画の段で二重に止める。状態を空にするのはフック側の仕事）
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { ChatConversationProps } from './chat-conversation';
import { chatConversationMessages } from './chat-props';

const state = vi.hoisted(() => ({ unavailable: false }));
vi.mock('./use-chat-conversation', async (original) => {
  const actual = await original<typeof import('./use-chat-conversation')>();
  return {
    ...actual,
    useChatConversation: (props: ChatConversationProps) => ({ ...actual.useChatConversation(props), unavailable: state.unavailable }),
  };
});
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: () => undefined, refresh: () => undefined }) }));
const { ChatConversation } = await import('./chat-conversation');

const SECRET_BODY = '外されたあとに残ってはならない本文';
const SECRET_NAME = '外されたあとに残ってはならない相手';
const props: ChatConversationProps = {
  threadId: '01930000-0000-7000-8000-0000000000c1',
  canPost: true,
  messages: chatConversationMessages(),
  initialNextCursor: null,
  title: { title: SECRET_NAME, subtitle: null } as never,
  initialMessages: [
    { id: 'm1', body: SECRET_BODY, mine: false, own: false, senderName: SECRET_NAME, senderCompanyName: '取引先', sentAt: '2026-10-26T00:00:00.000Z' },
  ],
};

describe('🔴 読めなくなった会話は、本文・相手の名前・入力欄を描かない（#164 の 2）', () => {
  it('対照: 読めるときは本文が出る（検査が空振りしていない）', () => {
    state.unavailable = false;
    expect(renderToStaticMarkup(createElement(ChatConversation, props))).toContain(SECRET_BODY);
  });

  it('読めなくなったら、案内と一覧への戻り道だけを描く', () => {
    state.unavailable = true;
    const html = renderToStaticMarkup(createElement(ChatConversation, props));
    expect(html).toContain('data-testid="chat-conversation-unavailable"');
    expect(html).toContain('data-testid="chat-conversation-unavailable-back"');
    expect(html).not.toContain(SECRET_BODY);
    expect(html).not.toContain(SECRET_NAME);
    expect(html).not.toContain('chat-compose');
    expect(html).not.toContain('<textarea');
  });
});
