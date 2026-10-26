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
import { t } from '@ses/i18n';
import type { ChatPeopleData } from '../../../lib/chat/people';
import type { ChatThreadDetailView } from '../../../lib/chat/views';

// 🔴 `useRouter` はアプリのルーターの中でしか動かない。押した後の遷移はここでは確かめない（E2E の範囲）。
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: () => undefined, refresh: () => undefined }) }));

const { ChatThreadPanel } = await import('./chat-thread-panel');
const { ChatThreadList } = await import('./chat-thread-list');

/** 一覧ごと（DM・グループの行は一覧に混ざる）。 */
function renderList(canPost: boolean, people: ChatPeopleData = PEOPLE): string {
  return renderToStaticMarkup(
    createElement(ChatThreadList, { groups: [], selectedThreadId: null, nextCursor: null, people, canPost, now: new Date('2026-10-19T03:00:00.000Z') }),
  );
}

const ROOM_DM = '01930000-0000-7000-8000-00000000e001';
const ROOM_GROUP = '01930000-0000-7000-8000-00000000e002';
const HOST_PERSON = '01930000-0000-7000-8000-00000000e101';
const PARTNER_PERSON = '01930000-0000-7000-8000-00000000e102';
const SELF = '01930000-0000-7000-8000-00000000e103';
const COMPANY_KEY = '01930000-0000-7000-8000-00000000e201';

const PEOPLE: ChatPeopleData = {
  rooms: [
    { id: ROOM_DM, kind: 'DM', name: '見本 太郎', memberCount: 2, lastMessageAt: '2026-10-19T01:00:00.000Z', memberUserIds: [SELF, HOST_PERSON], external: false, companyKey: null },
    { id: ROOM_GROUP, kind: 'GROUP', name: '案件の相談', memberCount: 3, lastMessageAt: null, memberUserIds: [SELF, HOST_PERSON, PARTNER_PERSON], external: true, companyKey: COMPANY_KEY },
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
  lastSnippets: { [ROOM_DM]: 'よろしくお願いします' },
};

function renderSection(canPost: boolean): string {
  return renderList(canPost);
}

function classTokens(html: string): string[] {
  return [...html.matchAll(/class="([^"]*)"/g)].flatMap((match) => (match[1] ?? '').split(/\s+/));
}

describe('🔴 ① 閲覧専用には「DM を開く」を描かない', () => {
  it('canPost: false では連絡先の欄も「DM を開く」も無く、disabled / opacity も無い', () => {
    const html = renderSection(false);
    expect(html).not.toContain('data-testid="chat-contacts"');
    expect(html).not.toContain('chat-open-dm-');
    // 🔴 属性として（検索欄の部品のクラスに `disabled:` の見た目の指定はあるが、属性は無い）。
    expect(html).not.toMatch(/\sdisabled(=|\s|>)/);
    expect(html).not.toContain('aria-disabled');
    expect(html).not.toContain('opacity');
    // 対照: DM・グループの一覧は見える（読むことはできる）。
    expect(html).toContain(`data-testid="chat-room-${ROOM_DM}"`);
  });

  it('canPost: true では「＋ 新規」から連絡先（f=contacts）に行け、連絡先の人を押すと「その人との会話」へ行く', () => {
    const list = renderSection(true);
    expect(list).toContain('data-testid="chat-new-conversation"');
    const contacts = renderToStaticMarkup(
      createElement(ChatThreadList, { groups: [], selectedThreadId: null, nextCursor: null, people: PEOPLE, canPost: true, filter: { kind: 'contacts' } }),
    );
    expect(contacts).toContain('data-testid="chat-contacts"');
    expect(contacts).toContain(`data-testid="chat-contact-link-${HOST_PERSON}"`);
    expect(contacts).toContain(`data-testid="chat-contact-link-${PARTNER_PERSON}"`);
    expect(contacts).toContain(`f=person.${PARTNER_PERSON}`);
    expect(contacts).toContain('data-testid="chat-contacts-recent"');
  });
});

describe('🔴 ② 一覧の中に hidden を使わない', () => {
  it('表示を消すユーティリティ（hidden / *:hidden）が 1 つも無い', () => {
    const tokens = classTokens(renderSection(true));
    expect(tokens.filter((token) => token === 'hidden' || /:hidden$/.test(token))).toEqual([]);
  });
});

describe('③ お気に入り・未読・メンバー', () => {
  it('お気に入りはピン留めした部屋だけ。DM・グループは一覧に混ざり、未読の数と最後の発言の冒頭が出る', () => {
    const html = renderSection(true);
    expect(html).toContain('よろしくお願いします');
    expect(html).toContain(`data-testid="chat-room-${ROOM_GROUP}"`);
    expect(html).toContain(`data-testid="chat-favorite-${ROOM_DM}"`);
    expect(html).toContain('<section data-testid="chat-favorites">');
    expect(html).not.toContain(`data-testid="chat-favorite-${ROOM_GROUP}"`);
    expect(html).toContain(`data-testid="chat-room-unread-${ROOM_DM}"`);
  });

  it('お気に入りが無いときは案内を出し、「＋ 新しい会話」は常にある', () => {
    const html = renderList(true, { ...PEOPLE, rooms: [], pinnedIds: [] });
    expect(html).toContain('data-testid="chat-favorites-empty"');
    expect(html).toMatch(/<section class="flex items-baseline gap-2 px-3 py-2" data-testid="chat-favorites">/);
    expect(html).not.toContain('data-testid="chat-threads-pinned"');
    expect(html).toContain('data-testid="chat-new-conversation"');
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

describe('✅ v2: 左の列から「会社から＞」「人から＞」辿る', () => {
  function renderWith(filter: Parameters<typeof ChatThreadList>[0]['filter']) {
    return renderToStaticMarkup(
      createElement(ChatThreadList, { groups: [], selectedThreadId: null, nextCursor: null, people: PEOPLE, canPost: true, filter }),
    );
  }
  it('人から: その人が入っている会話だけが並び、見出しに「DM を開く」と「すべてに戻る」', () => {
    const html = renderWith({ kind: 'person', userId: PARTNER_PERSON });
    expect(html).toContain(`data-testid="chat-room-${ROOM_GROUP}"`);
    expect(html).not.toContain(`data-testid="chat-room-${ROOM_DM}"`);
    expect(html).toContain('data-testid="chat-scope"');
    expect(html).toContain(`data-testid="chat-open-dm-${PARTNER_PERSON}"`);
    expect(html).toContain('data-testid="chat-scope-clear"');
  });
  it('会社から: その会社の鍵を持つ DM・グループが並ぶ（社内の部屋は出ない）', () => {
    const html = renderWith({ kind: 'company', key: COMPANY_KEY });
    expect(html).toContain(`data-testid="chat-room-${ROOM_GROUP}"`);
    expect(html).not.toContain(`data-testid="chat-room-${ROOM_DM}"`);
  });
  it('グループ: グループだけ／DM: DM だけ', () => {
    expect(renderWith({ kind: 'group' })).not.toContain(`data-testid="chat-room-${ROOM_DM}"`);
    expect(renderWith({ kind: 'dm' })).not.toContain(`data-testid="chat-room-${ROOM_GROUP}"`);
  });
  it('種類は無彩色のアバターで示す（取引先との部屋には「外部」）', () => {
    const html = renderWith({ kind: 'all' });
    const group = new RegExp(`<li data-testid="chat-room-${ROOM_GROUP}"[\\s\\S]*?</li>`).exec(html)?.[0] ?? '';
    expect(group).toContain('bg-neutral-bg');
    expect(group).not.toContain('bg-success');
    expect(group).toContain(t('chat.tag.external'));
  });
});

describe('✅ グループを作る（連絡先の入口 → 「新しいグループ」画面）', () => {
  const view = (canPost: boolean, kind: 'contacts' | 'newgroup') =>
    renderToStaticMarkup(
      createElement(ChatThreadList, { groups: [], selectedThreadId: null, nextCursor: null, people: PEOPLE, canPost, filter: { kind } }),
    );
  it('連絡先には入口の 1 行だけが出る（フォームは出さない）。閲覧専用には入口も出ない', () => {
    expect(view(true, 'contacts')).toContain('data-testid="chat-new-group-toggle"');
    expect(view(true, 'contacts')).not.toContain('data-testid="chat-new-group"');
    expect(view(false, 'contacts')).not.toContain('chat-new-group');
  });
  it('「新しいグループ」画面には連絡先の人が候補に出る。閲覧専用にはフォームを出さない', () => {
    expect(view(true, 'newgroup')).toContain('data-testid="chat-new-group"');
    expect(view(true, 'newgroup')).toContain(`data-testid="chat-new-group-member-${PARTNER_PERSON}"`);
    expect(view(false, 'newgroup')).not.toContain('chat-new-group');
  });
});

describe('✅ 2026-10-26（#166 の 7）上限で読み切れなかった DM・グループと連絡先は、黙って消さず案内を出す', () => {
  function render(filter: Parameters<typeof ChatThreadList>[0]['filter'], people: ChatPeopleData): string {
    return renderToStaticMarkup(
      createElement(ChatThreadList, { groups: [], selectedThreadId: null, nextCursor: null, people, canPost: true, filter }),
    );
  }

  it('DM・グループの絞り込みで、切れていれば案内を出し、切れていなければ出さない', () => {
    expect(render({ kind: 'dm' }, { ...PEOPLE, roomsTruncated: true })).toContain('data-testid="chat-rooms-truncated"');
    expect(render({ kind: 'group' }, { ...PEOPLE, roomsTruncated: true })).toContain(t('chat.people.roomsTruncated'));
    expect(render({ kind: 'dm' }, PEOPLE)).not.toContain('chat-rooms-truncated');
  });

  it('連絡先は、切れていれば案内を出す', () => {
    expect(render({ kind: 'contacts' }, { ...PEOPLE, contactsTruncated: true })).toContain('data-testid="chat-contacts-truncated"');
    expect(render({ kind: 'contacts' }, PEOPLE)).not.toContain('chat-contacts-truncated');
  });
});
