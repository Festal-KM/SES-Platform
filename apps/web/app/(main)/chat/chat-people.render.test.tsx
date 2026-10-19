// apps/web/app/(main)/chat/chat-people.render.test.tsx
// ✅ 2026-10-19（#128）: 一覧の上の欄（お気に入り・連絡先・DM・グループ）と、右の欄のメンバー。
//
// 🔴 固定すること
//   ① 閲覧専用（投稿できない人）には「DM を開く」を 1 つも描かない（押せないボタンを置かない。
//      `chat-screen.render.test.tsx` の ② と同じ規律）。`disabled` / `aria-disabled` / `opacity` も無い。
//   ② 一覧の中に `hidden` の表示ユーティリティを使わない（開閉は `<details>`）。
//   ③ お気に入りはピン留めした部屋だけ。右の欄は自分に「DM を開く」を出さない。
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { ChatPeopleData } from '../../../lib/chat/people';
import type { ChatThreadDetailView } from '../../../lib/chat/views';

// 🔴 `useRouter` はアプリのルーターの中でしか動かない。押した後の遷移はここでは確かめない（E2E の範囲）。
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: () => undefined, refresh: () => undefined }) }));

const { ChatPeopleSection } = await import('./chat-people-section');
const { ChatThreadPanel } = await import('./chat-thread-panel');

const ROOM_DM = '01930000-0000-7000-8000-00000000e001';
const ROOM_GROUP = '01930000-0000-7000-8000-00000000e002';
const HOST_PERSON = '01930000-0000-7000-8000-00000000e101';
const PARTNER_PERSON = '01930000-0000-7000-8000-00000000e102';
const SELF = '01930000-0000-7000-8000-00000000e103';

const PEOPLE: ChatPeopleData = {
  rooms: [
    { id: ROOM_DM, kind: 'DM', name: '見本 太郎', memberCount: 2, lastMessageAt: '2026-10-19T01:00:00.000Z' },
    { id: ROOM_GROUP, kind: 'GROUP', name: '案件の相談', memberCount: 3, lastMessageAt: null },
  ],
  contacts: {
    recent: [{ userId: HOST_PERSON, name: '見本 太郎', companyName: '自社', isHost: true }],
    companies: [
      { companyName: '自社', isHost: true, people: [{ userId: HOST_PERSON, name: '見本 太郎', companyName: '自社', isHost: true }] },
      { companyName: '株式会社ダミー', isHost: false, people: [{ userId: PARTNER_PERSON, name: '仮名 花子', companyName: '株式会社ダミー', isHost: false }] },
    ],
  },
  unreadCounts: { [ROOM_DM]: 2 },
  pinnedIds: [ROOM_DM],
  mutedIds: [],
};

function renderSection(canPost: boolean): string {
  return renderToStaticMarkup(createElement(ChatPeopleSection, { people: PEOPLE, selectedThreadId: null, canPost }));
}

function classTokens(html: string): string[] {
  return [...html.matchAll(/class="([^"]*)"/g)].flatMap((match) => (match[1] ?? '').split(/\s+/));
}

describe('🔴 ① 閲覧専用には「DM を開く」を描かない', () => {
  it('canPost: false では連絡先の欄も「DM を開く」も無く、disabled / opacity も無い', () => {
    const html = renderSection(false);
    expect(html).not.toContain('data-testid="chat-contacts"');
    expect(html).not.toContain('chat-open-dm-');
    expect(html).not.toContain('disabled');
    expect(html).not.toContain('aria-disabled');
    expect(html).not.toContain('opacity');
    // 対照: DM・グループの一覧は見える（読むことはできる）。
    expect(html).toContain(`data-testid="chat-room-${ROOM_DM}"`);
  });

  it('canPost: true では連絡先に 1 人ずつ「DM を開く」がある（最近 + 会社ごと）', () => {
    const html = renderSection(true);
    expect(html).toContain('data-testid="chat-contacts"');
    expect(html).toContain(`data-testid="chat-open-dm-${HOST_PERSON}"`);
    expect(html).toContain(`data-testid="chat-open-dm-${PARTNER_PERSON}"`);
    expect(html).toContain('data-testid="chat-contacts-recent"');
  });
});

describe('🔴 ② 一覧の中に hidden を使わない', () => {
  it('表示を消すユーティリティ（hidden / *:hidden）が 1 つも無い', () => {
    const tokens = classTokens(renderSection(true));
    expect(tokens.filter((token) => token === 'hidden' || /:hidden$/.test(token))).toEqual([]);
  });
});

describe('③ お気に入り・未読・メンバー', () => {
  it('お気に入りはピン留めした部屋だけ。未読の数が出る', () => {
    const html = renderSection(true);
    expect(html).toContain(`data-testid="chat-favorite-${ROOM_DM}"`);
    expect(html).not.toContain(`data-testid="chat-favorite-${ROOM_GROUP}"`);
    expect(html).toContain(`data-testid="chat-room-unread-${ROOM_DM}"`);
  });

  it('部屋が無いときは始め方の案内を出す', () => {
    const html = renderToStaticMarkup(
      createElement(ChatPeopleSection, { people: { ...PEOPLE, rooms: [], pinnedIds: [] }, selectedThreadId: null, canPost: true }),
    );
    expect(html).toContain('data-testid="chat-rooms-empty"');
  });

  it('右の欄はメンバーを出し、自分には「DM を開く」を出さない。閲覧専用には 1 つも出さない', () => {
    const thread: ChatThreadDetailView = {
      id: ROOM_GROUP,
      kind: 'GROUP',
      project: null,
      counterpartyName: '案件の相談',
      participants: [],
      members: [
        { userId: SELF, name: '自分の名前', companyName: '自社', isHost: true, self: true },
        { userId: PARTNER_PERSON, name: '仮名 花子', companyName: '株式会社ダミー', isHost: false, self: false },
      ],
    };
    const html = renderToStaticMarkup(createElement(ChatThreadPanel, { thread, canPost: true }));
    expect(html).toContain('data-testid="chat-panel-members"');
    expect(html).toContain(`data-testid="chat-open-dm-${PARTNER_PERSON}"`);
    expect(html).not.toContain(`data-testid="chat-open-dm-${SELF}"`);
    expect(html).not.toContain('data-testid="chat-panel-participants"');
    const viewer = renderToStaticMarkup(createElement(ChatThreadPanel, { thread, canPost: false }));
    expect(viewer).not.toContain('chat-open-dm-');
  });
});
