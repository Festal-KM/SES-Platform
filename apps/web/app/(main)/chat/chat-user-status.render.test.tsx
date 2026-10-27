// apps/web/app/(main)/chat/chat-user-status.render.test.tsx
// ✅ 2026-10-19（#128 §7.1 ①）: ひとこと状態の入口と表示。
//
// 🔴 固定すること
//   ① 閲覧専用（投稿できない人）には入口を描かない。`disabled` / `aria-disabled` / `opacity` でも表さない
//   ② 入口には注意書き（単価・エンド企業名を書かない）が常にある
//   ③ 状態は DM の見出し（相手の名前の横）/ 右の欄のメンバー / 連絡先 に出る。無い人には何も描かない
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { t } from '@ses/i18n';
import { conversationTitleFor } from '../../../lib/chat/layout';
import type { ChatPeopleData } from '../../../lib/chat/people';
import type { ChatThreadDetailView } from '../../../lib/chat/views';
import { chatConversationMessages } from './chat-props';

// 🔴 `useRouter` はアプリのルーターの中でしか動かない。保存後の再描画はここでは確かめない（E2E の範囲）。
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: () => undefined, refresh: () => undefined }) }));

const { ChatStatusSection } = await import('./chat-status-section');
// ✅ 2026-10-19（v2）: 連絡先は一覧の列の「連絡先」（`f=contacts`）の画面に移った。
const { ChatContactsView } = await import('./chat-people-section');
const { ChatThreadPanel } = await import('./chat-thread-panel');
const { ChatConversation } = await import('./chat-conversation');

const ROOM_DM = '01930000-0000-7000-8000-00000000f001';
const SELF = '01930000-0000-7000-8000-00000000f101';
const PEER = '01930000-0000-7000-8000-00000000f102';
const QUIET = '01930000-0000-7000-8000-00000000f103';
const STATUS = '移動中・16 時以降に返信';

describe('🔴 ① 閲覧専用には入口を描かない', () => {
  it('canPost: false では何も描かない', () => {
    const html = renderToStaticMarkup(createElement(ChatStatusSection, { canPost: false, text: STATUS }));
    expect(html).toBe('');
  });

  it('canPost: true では入口・入力欄・保存があり、押せない表現（disabled / opacity）が無い', () => {
    const html = renderToStaticMarkup(createElement(ChatStatusSection, { canPost: true, text: '' }));
    expect(html).toContain('data-testid="chat-status"');
    expect(html).toContain('data-testid="chat-status-input"');
    expect(html).toContain('data-testid="chat-status-save"');
    expect(html).toContain('maxLength="60"');
    expect(html).toContain(t('chat.status.open'));
    // 部品の基底クラスに `disabled:` の変種があるので、属性として付いていないことを見る。
    expect(html).not.toMatch(/\sdisabled(=|\s|>|\/)/);
    expect(html).not.toContain('aria-disabled');
    expect(html).not.toContain('opacity');
    // 状態が無いときは「消す」を出さない。
    expect(html).not.toContain('data-testid="chat-status-clear"');
  });

  it('設定済みなら今の状態を見せ、「消す」を出す', () => {
    const html = renderToStaticMarkup(createElement(ChatStatusSection, { canPost: true, text: STATUS }));
    expect(html).toContain(STATUS);
    expect(html).toContain('data-testid="chat-status-clear"');
  });
});

describe('🔴 ② 注意書き', () => {
  it('入力欄の下に「単価・エンド企業名などは書かないでください」がある', () => {
    const html = renderToStaticMarkup(createElement(ChatStatusSection, { canPost: true, text: '' }));
    expect(html).toContain('data-testid="chat-status-note"');
    expect(html).toContain(t('chat.status.note'));
    expect(t('chat.status.note')).toContain('単価');
    expect(t('chat.status.note')).toContain('エンド企業名');
  });
});

describe('③ 状態の表示', () => {
  const dm: ChatThreadDetailView = {
    id: ROOM_DM,
    kind: 'DM',
    project: null,
    counterpartyName: '見本 太郎',
    participants: [],
    members: [
      { userId: SELF, name: '自分の名前', companyName: '自社', isHost: true, self: true, status: '自分の状態' },
      { userId: PEER, name: '見本 太郎', companyName: '株式会社ダミー', isHost: false, self: false, status: STATUS },
    ],
  };

  it('DM の見出しは相手の状態を名前の横に出す（自分の状態ではない）', () => {
    const title = conversationTitleFor(dm);
    expect(title).toEqual({ title: '見本 太郎', subtitle: null, status: STATUS });
    const html = renderToStaticMarkup(
      createElement(ChatConversation, {
        threadId: ROOM_DM,
        title,
        initialMessages: [],
        initialNextCursor: null,
        canPost: true,
        messages: chatConversationMessages(),
      }),
    );
    expect(html).toContain('data-testid="chat-conversation-status"');
    expect(html).toContain(STATUS);
    expect(html).not.toContain('自分の状態');
  });

  it('DM 以外の見出しには状態を出さない', () => {
    expect(conversationTitleFor({ ...dm, kind: 'GROUP' }).status).toBeUndefined();
    expect(conversationTitleFor({ kind: 'COMPANY', project: null, counterpartyName: 'A 社' }).status).toBeUndefined();
  });

  it('右の欄のメンバーは名前の下に状態を出す（投稿できる人・閲覧専用の両方）。状態が無い人には描かない', () => {
    const thread: ChatThreadDetailView = {
      ...dm,
      kind: 'GROUP',
      members: [...(dm.members ?? []), { userId: QUIET, name: '状態なし', companyName: '自社', isHost: true, self: false, status: null }],
    };
    for (const canPost of [true, false]) {
      const html = renderToStaticMarkup(createElement(ChatThreadPanel, { thread, canPost }));
      expect(html).toContain(`data-testid="chat-panel-member-status-${PEER}"`);
      expect(html).toContain(STATUS);
      expect(html).not.toContain(`data-testid="chat-panel-member-status-${QUIET}"`);
    }
  });

  it('連絡先の各人の横に状態を出す。状態が無い人には描かない', () => {
    // ⚠️ `as`: 一覧の作り直し（#138）で `ChatPeopleData` に項目が増えても、この検査の形を変えずに済むように。
    const people = {
      rooms: [],
      contacts: {
        recent: [],
        companies: [
          {
            companyName: '株式会社ダミー',
            isHost: false,
            people: [
              { userId: PEER, name: '見本 太郎', companyName: '株式会社ダミー', isHost: false, status: STATUS },
              { userId: QUIET, name: '状態なし', companyName: '株式会社ダミー', isHost: false, status: null },
            ],
          },
        ],
      },
      unreadCounts: {},
      pinnedIds: [],
      mutedIds: [],
      lastSnippets: {},
    } as ChatPeopleData;
    const html = renderToStaticMarkup(createElement(ChatContactsView, { people }));
    expect(html).toContain(`data-testid="chat-contact-status-${PEER}"`);
    expect(html).toContain(STATUS);
    expect(html).not.toContain(`data-testid="chat-contact-status-${QUIET}"`);
  });
});

// ✅ 2026-10-22（紺野「自分が入ってるチャットにも共通で表示しないと」）: どの部屋でも、発言の名前の横に送信者の状態を出す。
describe('④ 発言の名前の横の状態（どの部屋でも）', () => {
  const COMPANY_THREAD = '01930000-0000-7000-8000-00000000f201';
  const message = (id: string, senderStatus: string | null) => ({
    id,
    sentAt: '2026-10-22T01:00:00.000Z',
    senderName: '見本 太郎',
    senderCompanyName: '株式会社ダミー',
    senderStatus,
    own: false,
    mine: false,
    body: 'こんにちは',
    reactions: [],
  });
  const WITH = '01930000-0000-7000-8000-00000000f301';
  const WITHOUT = '01930000-0000-7000-8000-00000000f302';

  it('会社グループでも、状態のある送信者には背景のない補助文字を出し、無い送信者には何も描かない', () => {
    const html = renderToStaticMarkup(
      createElement(ChatConversation, {
        threadId: COMPANY_THREAD,
        title: { title: 'A 社', subtitle: null },
        initialMessages: [message(WITH, STATUS), { ...message(WITHOUT, null), senderName: '状態なし' }],
        initialNextCursor: null,
        canPost: true,
        messages: chatConversationMessages(),
      }),
    );
    expect(html).toContain(`data-testid="chat-message-status-${WITH}"`);
    // ✅ 2026-10-27: 区切りの「·」は目印の外。目印は状態の文字だけを持つ（E2E が文字と照合する）。
    expect(html).toContain(`<span data-testid="chat-message-status-${WITH}">${STATUS}</span>`);
    expect(html).toContain('class="text-micro leading-tight text-fg-muted"');
    expect(html).toContain('flex-wrap items-baseline gap-x-3');
    expect(html).toContain('order-2 shrink-0 text-xs text-fg-muted');
    expect(html).toContain('order-3 block w-full min-w-0 break-words text-xs leading-tight text-fg');
    expect(html).toContain(' · ');
    expect(html).not.toContain('md:order-2');
    expect(html).not.toContain('md:order-3');
    expect(html).toContain(STATUS);
    expect(html).not.toContain(`data-testid="chat-message-status-${WITHOUT}"`);
  });
});

describe('⑤ 入口のよく使う言い回し', () => {
  it('定型文が並び、押すと入力欄に入る（保存は「保存」で）', () => {
    const html = renderToStaticMarkup(createElement(ChatStatusSection, { canPost: true, text: '' }));
    expect(html).toContain('data-testid="chat-status-presets"');
    expect(html).toContain(t('chat.status.preset.meeting'));
    expect(html).toContain(t('chat.status.preset.moving'));
  });
});
