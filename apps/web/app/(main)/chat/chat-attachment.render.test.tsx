// ✅ 2026-10-27（紺野。`docs/04` §S-031 改訂 44 / `F-038` 改訂 12 ⑫）: ファイル（社内だけの部屋から）の描画テスト。
// 🔴 固定すること:
//   ① 添えられる部屋では入力欄にファイルの印と「個人情報（氏名・連絡先など）の扱いに注意してください」を常に出す
//   ② 🔴 添えられない人（canAttach = false。閲覧専用）にはファイルの印も注意書きも描かない（✅ 2026-10-27 #182: 取引先がいる部屋でも添えられる）
//   ③ 送った本人に届いた「検査中」は「ファイルを検査しています」と種類・大きさ、問題ありは送れなかった旨（開く導線なし）
//   ④ CLEAN の画像・PDF はプレビューの枠、そのほかは札だけ。どれにも「開く」「別タブで開く」
//   ⑤ 閲覧専用（開けない人）には「開く」を描かず、プレビューも取りに行かない
//   ⑥ 🔴 ファイル名を出さない（そもそも持たない）。URL を初期の描画に含めない（押すたびに取り直す）
//   ⑦ 右の欄の「ファイル」: 0 件の文言 / 一覧の行（種類・大きさ・送った人）
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { t } from '@ses/i18n';
import type { ChatAttachmentView, ChatMessageView } from '../../../lib/chat/views';

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: () => undefined, refresh: () => undefined }) }));

const { ChatConversation } = await import('./chat-conversation');
const { ChatAttachmentFiles } = await import('./chat-attachment');
const { chatAttachmentLabels, chatConversationMessages } = await import('./chat-props');

const THREAD = '01930000-0000-7000-8000-0000000000c1';
const M_IMAGE = '01930000-0000-7000-8000-0000000000d1';
const M_PDF = '01930000-0000-7000-8000-0000000000d2';
const M_DOCX = '01930000-0000-7000-8000-0000000000d3';
const M_SCANNING = '01930000-0000-7000-8000-0000000000d4';
const M_INFECTED = '01930000-0000-7000-8000-0000000000d5';
const M_FAILED = '01930000-0000-7000-8000-0000000000d6';

function message(id: string, attachment: ChatAttachmentView, mine = false): ChatMessageView {
  return {
    id,
    sentAt: '2026-10-27T01:00:00.000Z',
    senderName: '鈴木 花子',
    senderCompanyName: '架空 SES',
    own: true,
    mine,
    body: '',
    attachment,
  };
}

const MESSAGES = [
  message(M_IMAGE, { kind: 'image', contentType: 'image/png', byteSize: 2048, scanStatus: 'CLEAN' }),
  message(M_PDF, { kind: 'pdf', contentType: 'application/pdf', byteSize: 1_258_291, scanStatus: 'CLEAN' }),
  message(M_DOCX, { kind: 'file', contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', byteSize: 10, scanStatus: 'CLEAN' }),
  message(M_SCANNING, { kind: 'pdf', contentType: 'application/pdf', byteSize: 1_258_291, scanStatus: 'SCANNING' }, true),
  message(M_INFECTED, { kind: 'file', contentType: 'text/plain', byteSize: 10, scanStatus: 'INFECTED' }, true),
  message(M_FAILED, { kind: 'file', contentType: 'text/plain', byteSize: 10, scanStatus: 'UNSCANNABLE' }, true),
];

function render(options: { readonly canPost: boolean; readonly canAttach: boolean }): string {
  return renderToStaticMarkup(
    createElement(ChatConversation, {
      threadId: THREAD,
      threadKind: 'GROUP',
      initialMessages: MESSAGES,
      initialNextCursor: null,
      canPost: options.canPost,
      canAttach: options.canAttach,
      messages: chatConversationMessages(),
    }),
  );
}

describe('① ② 入力欄のファイルの印と注意書き', () => {
  it('添えられる部屋では印（aria-label「ファイルを添える」）と注意書きを、選んでいなくても出す', () => {
    const html = render({ canPost: true, canAttach: true });
    expect(html).toContain('data-testid="chat-compose-attach"');
    expect(html).toContain(`aria-label="${t('chat.attachment.add')}"`);
    expect(html).toContain('data-testid="chat-compose-attach-note"');
    // ✅ 2026-10-27（#182）: 「スキルシートは提案から」を添えた注意書き。
    expect(html).toContain(t('chat.attachment.noteWithSkillSheet'));
    expect(html).toContain('type="file"');
    // 選んでいないので「添付: …」の札は無い。
    expect(html).not.toContain('data-testid="chat-compose-attached-file"');
  });

  it('🔴 添えられない人（閲覧専用など）には印も注意書きも描かない（押して断られる導線を置かない）', () => {
    const html = render({ canPost: true, canAttach: false });
    expect(html).not.toContain('data-testid="chat-compose-attach"');
    expect(html).not.toContain(t('chat.attachment.noteWithSkillSheet'));
    expect(html).not.toContain('type="file"');
  });
});

describe('③ ④ 発言の添付', () => {
  const html = render({ canPost: true, canAttach: true });

  it('送った本人に届いた検査中は「ファイルを検査しています（PDF・1.2 MB）」。開く導線は無い', () => {
    expect(html).toContain(`data-testid="chat-attachment-scanning-${M_SCANNING}"`);
    expect(html).toContain(`${t('chat.attachment.scanning')}（PDF${t('chat.attachment.separator')}1.2 MB）`);
    expect(html).not.toContain(`data-testid="chat-attachment-open-${M_SCANNING}"`);
  });

  it('問題が見つかったものは送れなかった旨だけ（開く導線は無い）', () => {
    expect(html).toContain(`data-testid="chat-attachment-blocked-${M_INFECTED}"`);
    expect(html).toContain(t('chat.attachment.blocked'));
    expect(html).not.toContain(`data-testid="chat-attachment-open-${M_INFECTED}"`);
  });

  it('検査そのものができなかったもの（UNSCANNABLE / FAILED）は「問題が見つかった」と書かない', () => {
    const failed = html.match(new RegExp(`data-testid="chat-attachment-blocked-${M_FAILED}"[^>]*>([^<]*)<`))?.[1];
    expect(failed).toBe(t('chat.attachment.unscannable'));
    expect(t('chat.attachment.unscannable')).not.toBe(t('chat.attachment.blocked'));
  });

  it('CLEAN の画像と PDF にはプレビューの枠、docx は札だけ。どれにも「開く」「別タブで開く」', () => {
    expect(html).toContain(`data-testid="chat-attachment-preview-${M_IMAGE}"`);
    expect(html).toContain(`data-testid="chat-attachment-preview-${M_PDF}"`);
    expect(html).not.toContain(`data-testid="chat-attachment-preview-${M_DOCX}"`);
    expect(html).toContain(`Word${t('chat.attachment.separator')}10 B`);
    for (const id of [M_IMAGE, M_PDF, M_DOCX]) {
      expect(html).toContain(`data-testid="chat-attachment-open-${id}"`);
      expect(html).toContain(`data-testid="chat-attachment-open-tab-${id}"`);
    }
    expect(html).toContain(t('chat.attachment.openNewTab'));
  });

  it('🔴 共有 URL を初期の描画に含めない（押すたび・表示のたびに取り直す）', () => {
    expect(html).not.toMatch(/<img[^>]*src=/);
    expect(html).not.toContain('<object');
    expect(html).not.toContain('s3');
  });
});

describe('✅ 2026-10-27（#182）取引先がいる部屋', () => {
  it('会社グループでも印と注意書きを出す（投稿できる人）', () => {
    const html = renderToStaticMarkup(
      createElement(ChatConversation, {
        threadId: THREAD,
        threadKind: 'COMPANY',
        initialMessages: [],
        initialNextCursor: null,
        canPost: true,
        canAttach: true,
        messages: chatConversationMessages(),
      }),
    );
    expect(html).toContain('data-testid="chat-compose-attach"');
    expect(html).toContain(t('chat.attachment.noteWithSkillSheet'));
  });
});

describe('⑤ 閲覧専用', () => {
  it('開く導線とプレビューを描かず、種類と大きさだけを出す', () => {
    const html = render({ canPost: false, canAttach: false });
    expect(html).toContain(`data-testid="chat-attachment-summary-${M_PDF}"`);
    expect(html).not.toContain(`data-testid="chat-attachment-open-${M_PDF}"`);
    expect(html).not.toContain(`data-testid="chat-attachment-preview-${M_PDF}"`);
  });
});

describe('⑦ 右の欄の「ファイル」', () => {
  it('0 件なら「まだファイルはありません」', () => {
    const html = renderToStaticMarkup(
      createElement(ChatAttachmentFiles, { threadId: THREAD, initialItems: [], initialNextCursor: null, labels: chatAttachmentLabels(), canOpen: true, unknownName: '?' }),
    );
    expect(html).toContain(t('chat.attachment.files.heading'));
    expect(html).toContain(t('chat.attachment.files.empty'));
  });

  it('行は種類・大きさ・送った人と「開く」「別タブで開く」。続きがあれば「さらに表示」', () => {
    const html = renderToStaticMarkup(
      createElement(ChatAttachmentFiles, {
        threadId: THREAD,
        initialItems: [{ messageId: M_PDF, kind: 'pdf', contentType: 'application/pdf', byteSize: 2048, senderName: '鈴木 花子', sentAt: '2026-10-27T01:00:00.000Z' }],
        initialNextCursor: M_PDF,
        labels: chatAttachmentLabels(),
        canOpen: true,
        unknownName: '?',
      }),
    );
    expect(html).toContain(`data-testid="chat-attachment-file-${M_PDF}"`);
    expect(html).toContain(`PDF${t('chat.attachment.separator')}2 KB`);
    expect(html).toContain('鈴木 花子');
    expect(html).toContain(`data-testid="chat-attachment-file-open-${M_PDF}"`);
    expect(html).toContain('data-testid="chat-panel-files-more"');
  });
});
