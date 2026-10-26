import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { t } from '@ses/i18n';
import { ChatConversation } from './chat-conversation';
import { chatConversationMessages } from './chat-props';
import ChatLoading from './loading';

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: () => undefined }) }));
// 閉じている確認画面の確定ボタンも描き、表示する文字を検査する。
vi.mock('@ses/ui/client', async (importOriginal) => {
  const original = await importOriginal<typeof import('@ses/ui/client')>();
  return { ...original, Dialog: ({ confirm }: { confirm?: React.ReactNode }) => confirm ?? null };
});

function render(kind: 'DM' | 'GROUP' | 'COMPANY' | 'PROJECT', tiled = false, active = false) {
  return renderToStaticMarkup(createElement(ChatConversation, {
    threadId: 'room', threadKind: kind, canPost: true,
    initialMessages: [], initialNextCursor: null,
    messages: chatConversationMessages(), prefs: { pinned: active, muted: active },
    infoHref: '/chat?info=1', infoLabel: t('chat.panel.open'),
    ...(tiled ? { closeHref: '/chat' } : {}),
  }));
}

describe('会話の操作と公開範囲の文言', () => {
  it.each([false, true])('見出しのメニューは印と文字を並べる（並置=%s）', (tiled) => {
    const html = render('COMPANY', tiled);
    for (const label of ['chat.export.link', 'chat.thread.pin', 'chat.thread.mute', 'chat.panel.open'] as const) {
      expect(html).toContain(`<span${tiled ? '' : ' class="md:sr-only"'}>${t(label)}</span>`);
    }
    expect(html).toContain('aria-expanded="false"');
  });

  it('ピン留め中・ミュート中は解除の文字を出す', () => {
    const html = render('COMPANY', true, true);
    expect(html).toContain(`<span>${t('chat.thread.unpin')}</span>`);
    expect(html).toContain(`<span>${t('chat.thread.unmute')}</span>`);
  });

  it('削除の確定ボタンは文字で表示する', () => {
    expect(render('COMPANY')).toMatch(new RegExp(`data-testid="chat-message-delete-yes-none"[^>]*>${t('chat.message.deleteConfirmYes')}</button>`));
  });

  it.each(['DM', 'GROUP', 'COMPANY', 'PROJECT'] as const)('%s の読める範囲を入力欄に出す', (kind) => {
    const html = render(kind);
    const members = kind === 'DM' || kind === 'GROUP';
    expect(html).toContain(t(members ? 'chat.compose.memberHint' : 'chat.compose.hint'));
    expect(html).not.toContain(t(members ? 'chat.compose.hint' : 'chat.compose.memberHint'));
  });

  it('読み込み中も見出しは読み上げ用で通常と同じ上余白にする', () => {
    const html = renderToStaticMarkup(createElement(ChatLoading));
    expect(html).toContain(`<h1 class="sr-only">${t('chat.title')}</h1>`);
    expect(html).toContain('py-3 md:flex md:flex-col');
    expect(html).toContain('md:w-44');
  });
});
