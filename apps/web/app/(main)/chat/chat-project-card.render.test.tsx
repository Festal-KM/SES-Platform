// ✅ 2026-10-23（紺野）: 案件をチャットに貼る（案件カード）の描画テスト。
// 🔴 固定すること:
//   ① 読めた案件は 案件名・状態・開始・勤務地 / リモート・必須の要件・尚可の件数・「案件詳細を開く」を出す
//   ② 🔴 単価・エンド企業名を出さない（カードの値にそもそも無いが、描画の結果でも確かめる）
//   ③ 🔴 読めない案件は「表示できません」だけ（案件名も ID もリンクも出さない）
//   ④ 「条件を引用」は投稿できる人にだけ描く（押せないボタンを置かない）
//   ⑤ 案件カードだけの発言（本文が空）は吹き出しを描かず、コピーも出さない
//   ⑥ 貼る案件を選ぶ小窓: 見出し・絞り込み欄・注意書き（取引先の部屋では公開済みだけ）。重なりを自作しない
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { t } from '@ses/i18n';
import type { ChatMessageView, ChatVisibleProjectCard } from '../../../lib/chat/views';

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: () => undefined, refresh: () => undefined }) }));

const { ChatConversation } = await import('./chat-conversation');
const { ChatProjectPicker } = await import('./chat-project-picker');
const { chatConversationMessages } = await import('./chat-props');

const THREAD = '01930000-0000-7000-8000-0000000000c1';
const MESSAGE_CARD = '01930000-0000-7000-8000-0000000000d1';
const MESSAGE_HIDDEN = '01930000-0000-7000-8000-0000000000d2';
const PROJECT = '01930000-0000-7000-8000-0000000000f1';
const HIDDEN_PROJECT_NAME = '見えてはいけない案件名';

const CARD: ChatVisibleProjectCard = {
  visible: true,
  id: PROJECT,
  name: '架空の基幹刷新案件',
  status: 'OPEN',
  startDate: '2026-11-01',
  prefecture: '13',
  remoteMode: 'PARTIAL_REMOTE',
  mustRequirements: [{ skillName: 'TypeScript', freeText: null, requiredYears: 3 }],
  niceRequirements: [
    { skillName: 'AWS', freeText: null, requiredYears: null },
    { skillName: null, freeText: '金融の経験', requiredYears: null },
  ],
};

function message(id: string, body: string, attachedProject: ChatMessageView['attachedProject']): ChatMessageView {
  return {
    id,
    sentAt: '2026-10-23T01:00:00.000Z',
    senderName: '鈴木 花子',
    senderCompanyName: '架空パートナー A',
    own: false,
    mine: false,
    body,
    attachedProject,
  };
}

function render(canPost: boolean): string {
  return renderToStaticMarkup(
    createElement(ChatConversation, {
      threadId: THREAD,
      initialMessages: [message(MESSAGE_CARD, '', CARD), message(MESSAGE_HIDDEN, 'こちらの件です', { visible: false })],
      initialNextCursor: null,
      canPost,
      messages: chatConversationMessages(),
    }),
  );
}

describe('① ② 読めた案件のカード', () => {
  const html = render(true);

  it('案件名・状態・開始・勤務地 / リモート・必須の要件・尚可の件数・案件詳細へのリンクを出す', () => {
    expect(html).toContain(`data-testid="chat-message-project-${MESSAGE_CARD}"`);
    expect(html).toContain(CARD.name);
    expect(html).toContain(t('projects.status.OPEN'));
    expect(html).toContain('2026-11-01');
    expect(html).toContain(`${t('prefecture.13')}・${t('projects.remoteMode.PARTIAL_REMOTE')}`);
    expect(html).toContain(`TypeScript 3 ${t('projects.list.requirements.yearsOrMore')}`);
    expect(html).toContain(`${t('chat.projectCard.nice')} 2 ${t('chat.projectCard.countUnit')}`);
    expect(html).toContain(`href="/projects/${PROJECT}"`);
    expect(html).toContain(t('chat.projectCard.open'));
  });

  it('🔴 尚可の中身はカードに並べない（件数に畳む）', () => {
    expect(html).not.toContain('金融の経験');
  });

  it('🔴 単価・エンド企業名の語を出さない', () => {
    expect(html).not.toContain(t('projects.list.column.unitPrice'));
    expect(html).not.toContain(t('projects.list.unitPrice.manYen'));
    expect(html).not.toContain(t('projects.endClientName.label'));
  });
});

describe('③ 読めない案件', () => {
  const html = render(true);

  it('🔴「表示できません」だけ（案件名・ID・リンクを出さない）', () => {
    expect(html).toContain(`data-testid="chat-message-project-hidden-${MESSAGE_HIDDEN}"`);
    expect(html).toContain(t('chat.projectCard.hidden'));
    expect(html).not.toContain(HIDDEN_PROJECT_NAME);
    expect(html).not.toContain(`chat-message-project-open-${MESSAGE_HIDDEN}`);
    expect(html).not.toContain(`chat-message-project-quote-${MESSAGE_HIDDEN}`);
  });
});

describe('④ 「条件を引用」', () => {
  it('投稿できる人にだけ描く', () => {
    expect(render(true)).toContain(`data-testid="chat-message-project-quote-${MESSAGE_CARD}"`);
    expect(render(false)).not.toContain(`chat-message-project-quote-${MESSAGE_CARD}`);
  });
});

describe('⑤ カードだけの発言', () => {
  const html = render(true);

  it('本文が空なら吹き出しとコピーを描かない（本文のある発言には描く）', () => {
    expect(html).not.toContain(`data-testid="chat-message-body-${MESSAGE_CARD}"`);
    expect(html).not.toContain(`data-testid="chat-message-copy-${MESSAGE_CARD}"`);
    expect(html).toContain(`data-testid="chat-message-body-${MESSAGE_HIDDEN}"`);
    expect(html).toContain(`data-testid="chat-message-copy-${MESSAGE_HIDDEN}"`);
  });
});

describe('⑥ 貼る案件を選ぶ小窓', () => {
  const messages = chatConversationMessages();
  const html = renderToStaticMarkup(
    createElement(ChatProjectPicker, {
      threadId: THREAD,
      labels: messages.pasteProject,
      statuses: messages.projectCard.statuses,
      onPick: () => undefined,
      onClose: () => undefined,
    }),
  );

  it('見出し・絞り込み欄・注意書き・閉じる（文字の無い操作は語を持つ）を出す', () => {
    expect(html).toContain(t('chat.compose.project.title'));
    expect(html).toContain('data-testid="chat-compose-project-search"');
    expect(html).toContain(`aria-label="${t('chat.compose.project.search')}"`);
    expect(html).toContain(t('chat.compose.project.hint'));
    expect(html).toContain(`aria-label="${t('chat.compose.project.close')}"`);
    expect(html).toContain(t('chat.compose.project.loading'));
  });

  it('🔴 重なり（role="dialog"）を自作しない', () => {
    expect(html).not.toContain('role="dialog"');
  });
});
