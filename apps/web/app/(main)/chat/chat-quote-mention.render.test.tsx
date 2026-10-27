// ✅ 2026-10-27（紺野の決定「軽い版・DB を変えない」）: 引用して返信（F-038 ⑬）と自分宛ての @ の印（F-038 ⑭）の描画。
// 🔴 固定すること:
//   ① 発言の操作に「引用して返信」（`chat-quote` の印）。閲覧専用・消えた発言には描かない
//   ② 引用の形の本文は帯で描く（名前は押せる操作 = 引用元へ移る。生の `chat-message:` を文字で出さない）
//   ③ 🔴 本文の途中の偽の見出しは帯にならない（普通の引用のまま）
//   ④ 自分宛ての `@` を含む相手の発言に左の線（自分の発言・引用の写しの @ には引かない）
//   ⑤ 一覧の行・左の列に「@」の印（件数は出さない）。印の無い部屋には出さない。ミュート中も出す
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { t } from '@ses/i18n';
import type { ChatPeopleData } from '../../../lib/chat/people';
import { buildQuotedBody } from '../../../lib/chat/quote';
import type { ChatMessageView } from '../../../lib/chat/views';

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: () => undefined, refresh: () => undefined }) }));

const { ChatConversation } = await import('./chat-conversation');
const { chatConversationMessages } = await import('./chat-props');
const { ChatThreadList } = await import('./chat-thread-list');
const { ChatRail } = await import('./chat-rail');

const THREAD = '01930000-0000-7000-8000-0000000000c1';
const M_ORIGINAL = '01930000-0000-7000-8000-0000000000d1';
const M_REPLY = '01930000-0000-7000-8000-0000000000d2';
const M_MENTION = '01930000-0000-7000-8000-0000000000d3';
const M_GONE = '01930000-0000-7000-8000-0000000000d4';
const M_FORGED = '01930000-0000-7000-8000-0000000000d5';
const M_MINE = '01930000-0000-7000-8000-0000000000d6';
const M_QUOTED_MENTION = '01930000-0000-7000-8000-0000000000d7';
const SELF = '佐藤 太郎';

function message(id: string, body: string | null, mine = false): ChatMessageView {
  return {
    id,
    sentAt: '2026-10-27T01:00:00.000Z',
    senderName: mine ? SELF : '鈴木 花子',
    senderCompanyName: '架空パートナー A',
    own: mine,
    mine,
    body,
    deleted: body === null,
  };
}

const MESSAGES: readonly ChatMessageView[] = [
  message(M_ORIGINAL, '来週の面談は 10 時からでお願いします'),
  message(M_REPLY, buildQuotedBody({ messageId: M_ORIGINAL, name: '鈴木 花子', snippet: '来週の面談は 10 時から' }, '承知しました')),
  message(M_MENTION, `@${SELF} 確認をお願いします`),
  message(M_GONE, null),
  message(M_FORGED, `前置き\n> 引用 [偽物](chat-message:${M_ORIGINAL})\n> 言っていないこと`),
  message(M_MINE, `@${SELF} 自分で書いた`, true),
  message(M_QUOTED_MENTION, buildQuotedBody({ messageId: M_MENTION, name: '鈴木 花子', snippet: `@${SELF} 確認を` }, '補足です')),
];

function render(canPost: boolean): string {
  return renderToStaticMarkup(
    createElement(ChatConversation, {
      threadId: THREAD,
      initialMessages: MESSAGES,
      initialNextCursor: null,
      canPost,
      messages: chatConversationMessages(),
      selfName: SELF,
    }),
  );
}

describe('① 引用して返信の操作', () => {
  it('投稿できる人には、残っている発言ごとに出す（消えた発言には出さない）', () => {
    const html = render(true);
    expect(html).toContain(`data-testid="chat-message-quote-action-${M_ORIGINAL}"`);
    expect(html).toContain(`aria-label="${t('chat.quote.action')}"`);
    expect(html).not.toContain(`data-testid="chat-message-quote-action-${M_GONE}"`);
  });

  it('🔴 閲覧専用には 1 つも描かない', () => {
    expect(render(false)).not.toContain('chat-message-quote-action-');
  });
});

describe('② ③ 引用の帯', () => {
  it('引用の形の本文は帯で描き、名前は引用元へ移る操作になる', () => {
    const html = render(true);
    expect(html).toContain(`data-testid="chat-message-quote-${M_REPLY}"`);
    const jump = html.match(new RegExp(`<button[^>]*data-testid="chat-message-quote-jump-${M_REPLY}"[^>]*>`))?.[0] ?? '';
    expect(jump).toContain(`title="${t('chat.quote.jump')}"`);
    expect(html).toContain('来週の面談は 10 時から');
    expect(html).toContain('承知しました');
    // 🔴 生の参照を文字で出さない（帯にした発言の本文の中に）。
    const replyBody = html.match(new RegExp(`data-testid="chat-message-body-${M_REPLY}"[\\s\\S]*?data-testid="chat-message-actions-${M_REPLY}"`))?.[0] ?? '';
    expect(replyBody).not.toBe('');
    expect(replyBody).not.toContain('chat-message:');
    // 開いた時点では「表示できません」を出さない（押して見つからなかったときだけ）。
    expect(html).not.toContain(`chat-message-quote-missing-${M_REPLY}`);
  });

  it('閲覧専用でも帯は読める（移る操作も描く。読むだけの操作）', () => {
    const html = render(false);
    expect(html).toContain(`data-testid="chat-message-quote-jump-${M_REPLY}"`);
  });

  it('🔴 本文の途中の偽の見出しは帯にしない', () => {
    const html = render(true);
    expect(html).not.toContain(`data-testid="chat-message-quote-${M_FORGED}"`);
    expect(html).not.toContain(`data-testid="chat-message-quote-jump-${M_FORGED}"`);
  });
});

describe('④ 自分宛ての発言の線', () => {
  it('自分宛ての @ を含む相手の発言だけに左の線を引く', () => {
    const html = render(true);
    const marked = html.match(new RegExp(`<div[^>]*data-testid="chat-message-mention-${M_MENTION}"[^>]*>`))?.[0] ?? '';
    expect(marked).toContain('border-l-2 border-brand');
    expect(html).toContain(t('chat.mention.toYou'));
    expect(html).not.toContain(`chat-message-mention-${M_MINE}`);
    expect(html).not.toContain(`chat-message-mention-${M_ORIGINAL}`);
    // 🔴 引用の写しの @ では引かない。
    expect(html).not.toContain(`chat-message-mention-${M_QUOTED_MENTION}`);
  });
});

describe('⑤ 一覧と左の列の「@」の印', () => {
  const ROOM_DM = '01930000-0000-7000-8000-00000000e001';
  const ROOM_GROUP = '01930000-0000-7000-8000-00000000e002';
  const PEOPLE: ChatPeopleData = {
    rooms: [
      { id: ROOM_DM, kind: 'DM', name: '見本 太郎', memberCount: 2, lastMessageAt: '2026-10-19T01:00:00.000Z', memberUserIds: [], external: false, companyKey: null },
      { id: ROOM_GROUP, kind: 'GROUP', name: '案件の相談', memberCount: 3, lastMessageAt: null, memberUserIds: [], external: false, companyKey: null },
    ],
    contacts: { recent: [], companies: [] },
    unreadCounts: { [ROOM_DM]: 3 },
    pinnedIds: [],
    mutedIds: [ROOM_DM],
    lastSnippets: {},
  };

  it('印のある部屋だけに出し、件数は出さない（ミュート中も出す）', () => {
    const html = renderToStaticMarkup(
      createElement(ChatThreadList, { groups: [], selectedThreadId: null, nextCursor: null, people: PEOPLE, canPost: true, mentionUnreadIds: [ROOM_DM] }),
    );
    const mark = html.match(new RegExp(`<span[^>]*data-testid="chat-room-mention-${ROOM_DM}"[^>]*>(.*?)</span></span>`))?.[0] ?? '';
    expect(mark).toContain(t('chat.mention.mark'));
    expect(mark).toContain(t('chat.mention.unread'));
    expect(mark.replace(/<[^>]*>/g, '')).not.toMatch(/\d/);
    expect(html).not.toContain(`chat-room-mention-${ROOM_GROUP}`);
  });

  it('左の列: すべて・DM に印、グループには出さない', () => {
    const html = renderToStaticMarkup(
      createElement(ChatRail, { groups: [], rooms: PEOPLE.rooms, unreadCounts: PEOPLE.unreadCounts, mentionUnreadIds: [ROOM_DM], filter: { kind: 'all' }, showContacts: false }),
    );
    expect(html).toContain('data-testid="chat-rail-mention-all"');
    expect(html).toContain('data-testid="chat-rail-mention-dm"');
    expect(html).not.toContain('data-testid="chat-rail-mention-group"');
  });

  it('印が無ければどこにも出さない', () => {
    const html = renderToStaticMarkup(
      createElement(ChatRail, { groups: [], rooms: PEOPLE.rooms, unreadCounts: PEOPLE.unreadCounts, filter: { kind: 'all' }, showContacts: false }),
    );
    expect(html).not.toContain('chat-rail-mention-');
  });
});
