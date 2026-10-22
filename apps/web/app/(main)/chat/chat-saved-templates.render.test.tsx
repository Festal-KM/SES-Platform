// ✅ 2026-10-22（紺野）: 「要返信」を外す / 保存済み / 自分の定型文 の描画テスト。
// 🔴 固定すること:
//   ① 左の列に「要返信」が無い。「保存済み」は保存できる人（投稿できる人）にだけ出る
//   ② 発言の操作に「保存」/「保存を外す」がある（閲覧専用には出さない）。保存した発言には「保存済み」の印
//   ③ 保存済みの一覧: 部屋の名前・抜粋・日時。押すとその会話を開く（一覧は保存済みのまま）。消えた発言は事実を書く
//   ④ 入力欄の「定型文を選ぶ」: 自分の定型文 → 固定の文面 → 末尾に「定型文を編集…」
//   ⑤ 定型文の管理画面: 注意書き（単価・エンド企業名を書かない）を常に出す / 押せないボタンを置かない / 閲覧専用には出さない
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { t } from '@ses/i18n';
import type { ChatMessageView, ChatThreadListItem } from '../../../lib/chat/views';
import { buildThreadTree } from '../../../lib/chat/thread-tree';

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: () => undefined, refresh: () => undefined }) }));

const { ChatRail } = await import('./chat-rail');
const { ChatThreadList } = await import('./chat-thread-list');
const { ChatConversation } = await import('./chat-conversation');
const { chatConversationMessages } = await import('./chat-props');

const THREAD = '01930000-0000-7000-8000-0000000000c1';
const MESSAGE_SAVED = '01930000-0000-7000-8000-0000000000d1';
const MESSAGE_GONE = '01930000-0000-7000-8000-0000000000d2';
const TEMPLATE = '01930000-0000-7000-8000-0000000000e1';

const ROWS: readonly ChatThreadListItem[] = [
  { id: THREAD, kind: 'COMPANY', project: null, counterpartyName: '架空パートナー A', lastMessageAt: '2026-10-22T01:00:00.000Z' },
];
const GROUPS = buildThreadTree(
  ROWS.map((item) => ({ groupKey: item.counterpartyName ?? item.id, item })),
  { sort: 'recent', q: null },
);

function message(id: string, saved: boolean): ChatMessageView {
  return {
    id,
    sentAt: '2026-10-22T01:00:00.000Z',
    senderName: '鈴木 花子',
    senderCompanyName: '架空パートナー A',
    own: false,
    mine: false,
    body: `合成の発言 ${id}`,
    saved,
  };
}

function renderConversation(canPost: boolean, ownTemplates: readonly { id: string; label: string; body: string }[] = []): string {
  return renderToStaticMarkup(
    createElement(ChatConversation, {
      threadId: THREAD,
      initialMessages: [message(MESSAGE_SAVED, true), message(MESSAGE_GONE, false)],
      initialNextCursor: null,
      canPost,
      messages: chatConversationMessages(),
      ownTemplates,
    }),
  );
}

describe('① 左の列', () => {
  const base = { groups: GROUPS, rooms: [], unreadCounts: {}, filter: { kind: 'all' } as const, showContacts: true };

  it('「要返信」が無い（2026-10-22 に外した）', () => {
    const html = renderToStaticMarkup(createElement(ChatRail, { ...base, showSaved: true }));
    expect(html).not.toContain('chat-rail-awaiting');
    expect(html).not.toContain(t('chat.rail.awaiting'));
  });

  it('「保存済み」は保存できる人にだけ出る（f=saved へのリンク）', () => {
    const html = renderToStaticMarkup(createElement(ChatRail, { ...base, showSaved: true }));
    expect(html).toContain('data-testid="chat-rail-saved"');
    expect(html).toContain('href="/chat?f=saved"');
    expect(html).toContain(t('chat.rail.saved'));
    expect(renderToStaticMarkup(createElement(ChatRail, { ...base, showSaved: false }))).not.toContain('chat-rail-saved');
  });
});

describe('② 発言の保存', () => {
  it('投稿できる人には「保存」「保存を外す」があり、保存した発言には印が付く', () => {
    const html = renderConversation(true);
    expect(html).toContain(`data-testid="chat-message-bookmark-${MESSAGE_SAVED}"`);
    expect(html).toContain(`data-testid="chat-message-bookmark-${MESSAGE_GONE}"`);
    expect(html).toContain(t('chat.message.unbookmark'));
    expect(html).toContain(t('chat.message.bookmark'));
    expect(html).toContain(`data-testid="chat-message-saved-${MESSAGE_SAVED}"`);
    expect(html).not.toContain(`data-testid="chat-message-saved-${MESSAGE_GONE}"`);
  });

  it('🔴 閲覧専用には保存のボタンを描かない', () => {
    const html = renderConversation(false);
    expect(html).not.toContain('chat-message-bookmark-');
  });
});

describe('③ 保存済みの一覧', () => {
  function renderSaved(items: Parameters<typeof ChatThreadList>[0]['saved']): string {
    return renderToStaticMarkup(
      createElement(ChatThreadList, {
        groups: GROUPS,
        selectedThreadId: null,
        nextCursor: null,
        canPost: true,
        filter: { kind: 'saved' },
        saved: items,
      }),
    );
  }

  it('部屋の名前・抜粋・日時を出し、押すとその会話を開く（一覧は保存済みのまま）', () => {
    const html = renderSaved({
      items: [
        { messageId: MESSAGE_SAVED, threadId: THREAD, sentAt: '2026-10-22T01:00:00.000Z', savedAt: '2026-10-22T02:00:00.000Z', snippet: '面談の候補日' },
        { messageId: MESSAGE_GONE, threadId: THREAD, sentAt: '2026-10-22T01:30:00.000Z', savedAt: '2026-10-22T02:10:00.000Z', snippet: null },
      ],
      truncated: false,
    });
    expect(html).toContain('data-testid="chat-saved"');
    expect(html).toContain(`data-testid="chat-saved-item-${MESSAGE_SAVED}"`);
    expect(html).toContain('架空パートナー A');
    expect(html).toContain('面談の候補日');
    expect(html).toContain(t('chat.saved.removedBody'));
    expect(html).toContain(`href="/chat?thread=${THREAD}&amp;f=saved"`);
    // 会話の一覧（行）は出さない（列がまるごと切り替わる）。
    expect(html).not.toContain(`chat-thread-link-${THREAD}`);
  });

  it('空のときは案内を書く。上限を超えたら黙って落とさない', () => {
    expect(renderSaved({ items: [], truncated: false })).toContain('data-testid="chat-saved-empty"');
    expect(renderSaved({ items: [], truncated: true })).toContain(t('chat.saved.truncated'));
  });
});

describe('④ 入力欄の「定型文を選ぶ」', () => {
  it('自分の定型文 → 固定の文面 → 末尾に「定型文を編集…」', () => {
    const html = renderConversation(true, [{ id: TEMPLATE, label: '自分の見出し', body: '自分の本文' }]);
    const own = html.indexOf(t('chat.compose.template.own'));
    const fixed = html.indexOf(t('chat.compose.template.fixed'));
    const manage = html.indexOf(t('chat.compose.template.manage'));
    expect(own).toBeGreaterThan(0);
    expect(html).toContain(`value="own:${TEMPLATE}"`);
    expect(html).toContain('自分の見出し');
    expect(fixed).toBeGreaterThan(own);
    expect(manage).toBeGreaterThan(fixed);
  });

  it('自分の定型文が無ければ見出しごと出さない（固定の文面と「定型文を編集…」は出す）', () => {
    const html = renderConversation(true);
    expect(html).not.toContain('chat-compose-template-own');
    expect(html).toContain(t('chat.compose.template.fixed'));
    expect(html).toContain(t('chat.compose.template.manage'));
  });
});

describe('⑤ 定型文の管理画面（f=templates）', () => {
  function renderManager(canPost: boolean): string {
    return renderToStaticMarkup(
      createElement(ChatThreadList, {
        groups: GROUPS,
        selectedThreadId: THREAD,
        nextCursor: null,
        canPost,
        filter: { kind: 'templates' },
        templates: [{ id: TEMPLATE, label: '自分の見出し', body: '自分の本文' }],
      }),
    );
  }

  it('一覧・作る欄・注意書きを出し、押せないボタンを置かない。戻ると開いていた会話は残る', () => {
    const html = renderManager(true);
    expect(html).toContain('data-testid="chat-templates"');
    expect(html).toContain(`data-testid="chat-template-${TEMPLATE}"`);
    expect(html).toContain(`data-testid="chat-template-edit-${TEMPLATE}"`);
    expect(html).toContain(`data-testid="chat-template-delete-${TEMPLATE}"`);
    expect(html).toContain('data-testid="chat-template-note"');
    expect(html).toContain(t('chat.template.note'));
    expect(html).toContain('1 / 50');
    expect(html).toContain(`href="/chat?thread=${THREAD}"`);
    expect(html).not.toMatch(/\sdisabled(=|\s|>)/);
  });

  it('🔴 閲覧専用には管理画面を出さない', () => {
    expect(renderManager(false)).not.toContain('data-testid="chat-templates"');
  });
});
