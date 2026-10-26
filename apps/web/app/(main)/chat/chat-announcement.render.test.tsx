// ✅ 2026-10-26（紺野の決定 2026-10-22）: 部屋のアナウンスの描画テスト。
// 🔴 固定すること:
//   ① アナウンスがあれば会話の見出しの下に帯を出す（本文の冒頭・設定した人・日時）。無ければ帯を描かない
//   ② 🔴 スマホでも同じ帯を出す（帯の外側に `hidden` / `md:` で隠す語を持たない）
//   ③ 🔴 消えた発言は本文を出さず「この発言は削除されました」と書く
//   ④ 「外す」と発言の操作の「アナウンスにする / 外す」は投稿できる人にだけ描く（閲覧専用には押せない導線を置かない）
//   ⑤ 消えた発言には「アナウンスにする」を出さない（API も 404）
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { t } from '@ses/i18n';
import type { ChatAnnouncementView, ChatMessageView } from '../../../lib/chat/views';

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: () => undefined, refresh: () => undefined }) }));

const { ChatConversation } = await import('./chat-conversation');
const { chatConversationMessages } = await import('./chat-props');

const THREAD = '01930000-0000-7000-8000-0000000000c1';
const MESSAGE_PINNED = '01930000-0000-7000-8000-0000000000d1';
const MESSAGE_OTHER = '01930000-0000-7000-8000-0000000000d2';
const MESSAGE_GONE = '01930000-0000-7000-8000-0000000000d3';

function message(id: string, body: string | null): ChatMessageView {
  return {
    id,
    sentAt: '2026-10-22T01:00:00.000Z',
    senderName: '鈴木 花子',
    senderCompanyName: '架空パートナー A',
    own: false,
    mine: false,
    body,
    deleted: body === null,
  };
}

const ANNOUNCEMENT: ChatAnnouncementView = {
  messageId: MESSAGE_PINNED,
  messageSentAt: '2026-10-22T01:00:00.000Z',
  snippet: '来週から面談の受付は 17 時までです',
  setByName: '佐藤 太郎',
  setAt: '2026-10-26T02:00:00.000Z',
};

function render(canPost: boolean, announcement: ChatAnnouncementView | null): string {
  return renderToStaticMarkup(
    createElement(ChatConversation, {
      threadId: THREAD,
      initialMessages: [message(MESSAGE_PINNED, '来週から面談の受付は 17 時までです'), message(MESSAGE_OTHER, '了解です'), message(MESSAGE_GONE, null)],
      initialNextCursor: null,
      canPost,
      messages: chatConversationMessages(),
      announcement,
    }),
  );
}

/** 帯（section）の開始タグ。 */
function barTag(html: string): string {
  const match = html.match(new RegExp(`<section[^>]*data-testid="chat-announcement-${THREAD}"[^>]*>`));
  return match?.[0] ?? '';
}

describe('① 帯の中身', () => {
  it('本文の冒頭・設定した人・日時を出し、見出しの下・会話の上に置く', () => {
    const html = render(true, ANNOUNCEMENT);
    expect(barTag(html)).not.toBe('');
    expect(html).toContain(`data-testid="chat-announcement-body-${THREAD}"`);
    expect(html).toContain('来週から面談の受付は 17 時までです');
    expect(html).toContain(`佐藤 太郎${t('chat.announcement.setBySuffix')}`);
    expect(html).toContain('dateTime="2026-10-26T02:00:00.000Z"');
    expect(html).toContain(`data-testid="chat-announcement-jump-${THREAD}"`);
    // 見出しの後、会話の面の前。
    const title = html.indexOf('data-testid="chat-conversation-title"');
    const bar = html.indexOf(`data-testid="chat-announcement-${THREAD}"`);
    const scroll = html.indexOf('data-testid="chat-messages-scroll"');
    expect(title).toBeLessThan(bar);
    expect(bar).toBeLessThan(scroll);
  });

  it('アナウンスが無ければ帯を描かない', () => {
    expect(render(true, null)).not.toContain(`chat-announcement-${THREAD}`);
  });

  it('設定した人の名前が読めなければ「表示できません」と書く（空にしない）', () => {
    const html = render(true, { ...ANNOUNCEMENT, setByName: null });
    expect(html).toContain(`${t('chat.thread.unknownName')}${t('chat.announcement.setBySuffix')}`);
  });
});

describe('② 🔴 スマホでも同じ帯を出す', () => {
  it('帯の外側に隠す語（hidden / md:flex など）を持たない', () => {
    const tag = barTag(render(true, ANNOUNCEMENT));
    expect(tag).not.toMatch(/\bhidden\b/);
    expect(tag).not.toMatch(/\b(sm|md|lg):(flex|block)\b/);
  });

  it('指で押す操作は 44px（min-h-11）を持つ', () => {
    const html = render(true, ANNOUNCEMENT);
    for (const id of [`chat-announcement-jump-${THREAD}`, `chat-announcement-clear-${THREAD}`]) {
      const tag = html.match(new RegExp(`<button[^>]*data-testid="${id}"[^>]*>`))?.[0] ?? '';
      expect(tag, id).toContain('min-h-11');
    }
  });
});

describe('③ 🔴 消えた発言', () => {
  it('本文を出さず「この発言は削除されました」と書く', () => {
    const html = render(true, { ...ANNOUNCEMENT, snippet: null });
    expect(html).toContain(`data-testid="chat-announcement-removed-${THREAD}"`);
    expect(html).not.toContain(`data-testid="chat-announcement-body-${THREAD}"`);
    expect(html).toContain(t('chat.message.deleted'));
  });
});

describe('④ 操作は投稿できる人にだけ', () => {
  it('投稿できる人: 帯の「外す」と、発言ごとの「アナウンスにする / 外す」', () => {
    const html = render(true, ANNOUNCEMENT);
    expect(html).toContain(`data-testid="chat-announcement-clear-${THREAD}"`);
    expect(html).toContain(`data-testid="chat-message-announce-${MESSAGE_PINNED}"`);
    expect(html).toContain(`data-testid="chat-message-announce-${MESSAGE_OTHER}"`);
    expect(html).toContain(t('chat.announcement.unset'));
    expect(html).toContain(t('chat.announcement.set'));
  });

  it('🔴 閲覧専用: 帯は出すが、外す・アナウンスにするは描かない', () => {
    const html = render(false, ANNOUNCEMENT);
    expect(barTag(html)).not.toBe('');
    expect(html).not.toContain('chat-announcement-clear-');
    expect(html).not.toContain('chat-message-announce-');
  });

  it('押せないボタンを置かない（disabled を使わない）', () => {
    expect(render(true, ANNOUNCEMENT)).not.toMatch(/\sdisabled(=|\s|>)/);
  });
});

describe('⑤ 消えた発言はアナウンスにできない', () => {
  it('「アナウンスにする」を出さない', () => {
    expect(render(true, null)).not.toContain(`data-testid="chat-message-announce-${MESSAGE_GONE}"`);
  });
});
