// apps/web/app/(main)/chat/chat-read-receipt.render.test.tsx
// ✅ 2026-10-19（#128）: DM の既読表示の描画テスト。
// 🔴 固定すること: ① DM で相手が読んだ位置の自分の発言 1 件の下にだけ「既読」が出る
//                  ② グループ（相手の既読位置を渡さない）では 1 つも出ない
//                  ③ page.tsx は DM のときだけ相手の既読位置を渡す
import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { t } from '@ses/i18n';
import type { ChatMessageView } from '../../../lib/chat/views';
import { ChatConversation, type ChatConversationProps } from './chat-conversation';
import { chatConversationMessages } from './chat-props';

const THREAD = '01930000-0000-7000-8000-0000000000e1';

function message(id: string, mine: boolean, minute: number): ChatMessageView {
  return {
    id,
    sentAt: `2026-10-19T01:${String(minute).padStart(2, '0')}:00.000Z`,
    senderName: mine ? '山田 太郎' : '鈴木 花子',
    senderCompanyName: mine ? '合成ホスト株式会社' : '架空パートナー A',
    own: mine,
    mine,
    body: `合成の発言 ${id}`,
  };
}

const M1 = message('01930000-0000-7000-8000-0000000000f1', true, 0);
const M2 = message('01930000-0000-7000-8000-0000000000f2', true, 10);
const M3 = message('01930000-0000-7000-8000-0000000000f3', false, 20);
const M4 = message('01930000-0000-7000-8000-0000000000f4', true, 30);
const ITEMS = [M1, M2, M3, M4];

function render(overrides: Partial<ChatConversationProps> = {}): string {
  const props: ChatConversationProps = {
    layout: 'chat',
    threadId: THREAD,
    initialMessages: ITEMS,
    initialNextCursor: null,
    canPost: true,
    messages: chatConversationMessages(),
    ...overrides,
  };
  return renderToStaticMarkup(createElement(ChatConversation, props));
}

function countOf(html: string, needle: string): number {
  return html.split(needle).length - 1;
}

describe('DM の既読表示', () => {
  it('文言は packages/i18n の「既読」', () => {
    expect(t('chat.message.read')).toBe('既読');
  });

  it('DM: 相手が読んだ位置（相手の発言）以前で最後の自分の発言の下に 1 つだけ出る', () => {
    const html = render({ peerReadMessageId: M3.id });
    expect(html).toContain(`data-testid="chat-message-read-${M2.id}"`);
    expect(countOf(html, 'data-testid="chat-message-read-')).toBe(1);
    expect(countOf(html, '>既読<')).toBe(1);
    // 既読の印は、その発言の行（li）の中にある。
    const row = new RegExp(`data-testid="chat-message-${M2.id}"[\\s\\S]*?</li>`).exec(html)?.[0] ?? '';
    expect(row).toContain(`chat-message-read-${M2.id}`);
  });

  it('DM: 相手が最新の自分の発言まで読んでいれば、そこに出る', () => {
    const html = render({ peerReadMessageId: M4.id });
    expect(html).toContain(`data-testid="chat-message-read-${M4.id}"`);
    expect(countOf(html, 'data-testid="chat-message-read-')).toBe(1);
  });

  it('DM: 相手がまだ読んでいなければ出ない', () => {
    const html = render({ peerReadMessageId: null });
    expect(html).not.toContain('chat-message-read-');
    expect(html).not.toContain('既読');
  });

  it('🔴 グループ・会社グループ（相手の既読位置を渡さない）では 1 つも出ない', () => {
    for (const layout of ['chat', 'topic'] as const) {
      const html = render({ layout });
      expect(html).not.toContain('chat-message-read-');
      expect(html).not.toContain('既読');
    }
  });

  it('🔴 page.tsx は DM のときだけ相手の既読位置を渡す（左端と右の列の両方）', () => {
    const source = readFileSync(new URL('./page.tsx', import.meta.url), 'utf8');
    const passes = source.match(/peerReadMessageId:/g) ?? [];
    expect(passes.length).toBe(2);
    expect(source).toContain("selected.kind === 'DM' ? { peerReadMessageId:");
    expect(source).toContain("pane.thread.kind === 'DM' ? { peerReadMessageId:");
    expect(source).not.toMatch(/peerReadMessageId=\{/);
  });
});
