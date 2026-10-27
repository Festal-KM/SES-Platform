// packages/domain/src/storage/chat-attachment.test.ts
// ✅ 2026-10-27: チャットの添付（社内だけの部屋。docs/05 §14.1 / §3.7.1 / `F-038` 改訂 12）。
import { describe, expect, it } from 'vitest';
import {
  CHAT_ATTACHMENT_CONTENT_TYPES,
  CHAT_ATTACHMENT_MAX_BYTES,
  chatAttachmentExtensionOf,
  chatAttachmentKindOf,
  isChatAttachmentByteSize,
  isChatAttachmentContentType,
} from './chat-attachment.js';
import { buildChatAttachmentObjectKey, InvalidObjectKeyPartError, parseChatAttachmentObjectKey, parseSkillSheetObjectKey } from './object-key.js';

const TENANT = '01930000-0000-7000-8000-000000000001';
const THREAD = '01930000-0000-7000-8000-0000000000c1';
const MESSAGE = '01930000-0000-7000-8000-0000000000d1';
const OBJECT = '01930000-0000-7000-8000-0000000000a1';

describe('チャットの添付のキー（docs/05 §14.1）', () => {
  it('t/{tenantId}/chat/{threadId}/{messageId}/{uuid}.{ext} の形になり、分解すると元に戻る', () => {
    const key = buildChatAttachmentObjectKey({ tenantId: TENANT, threadId: THREAD, messageId: MESSAGE, objectId: OBJECT, extension: 'pdf' });
    expect(key).toBe(`t/${TENANT}/chat/${THREAD}/${MESSAGE}/${OBJECT}.pdf`);
    expect(parseChatAttachmentObjectKey(key)).toEqual({ tenantId: TENANT, threadId: THREAD, messageId: MESSAGE, objectId: OBJECT, extension: 'pdf' });
  });

  it('🔴 UUID でない部分・使えない拡張子は組み立てない', () => {
    expect(() => buildChatAttachmentObjectKey({ tenantId: TENANT, threadId: '../x', messageId: MESSAGE, objectId: OBJECT, extension: 'pdf' })).toThrow(InvalidObjectKeyPartError);
    expect(() => buildChatAttachmentObjectKey({ tenantId: TENANT, threadId: THREAD, messageId: MESSAGE, objectId: OBJECT, extension: 'p/f' })).toThrow(InvalidObjectKeyPartError);
  });

  it('🔴 形の違うキー（スキルシート・ファイル名入り・別の用途）は分解しない', () => {
    expect(parseChatAttachmentObjectKey(`t/${TENANT}/skill-sheets/${THREAD}/1/${OBJECT}.pdf`)).toBeNull();
    expect(parseChatAttachmentObjectKey(`t/${TENANT}/chat/${THREAD}/${MESSAGE}/山田太郎.pdf`)).toBeNull();
    expect(parseChatAttachmentObjectKey(`t/${TENANT}/chat/${THREAD}/${OBJECT}.pdf`)).toBeNull();
    expect(parseChatAttachmentObjectKey(`t/${TENANT}/chat/${THREAD}/${MESSAGE}/${OBJECT}.PDF`)).toBeNull();
    // スキルシートの分解はチャットのキーを受け付けない（用途が混ざらない）。
    expect(parseSkillSheetObjectKey(`t/${TENANT}/chat/${THREAD}/${MESSAGE}/${OBJECT}.pdf`)).toBeNull();
  });
});

describe('受け付ける種類と大きさ（F-038 改訂 12）', () => {
  it('画像（PNG / JPEG / WebP）・PDF・docx・xlsx・csv・txt の 8 種類だけ', () => {
    expect(CHAT_ATTACHMENT_CONTENT_TYPES).toHaveLength(8);
    expect(isChatAttachmentContentType('image/png')).toBe(true);
    expect(isChatAttachmentContentType('text/html')).toBe(false);
    expect(isChatAttachmentContentType('image/svg+xml')).toBe(false);
    expect(isChatAttachmentContentType('application/zip')).toBe(false);
  });

  it('種類から拡張子と表示の分類が決まる', () => {
    expect(chatAttachmentExtensionOf('image/jpeg')).toBe('jpg');
    expect(chatAttachmentKindOf('image/webp')).toBe('image');
    expect(chatAttachmentKindOf('application/pdf')).toBe('pdf');
    expect(chatAttachmentKindOf('text/csv')).toBe('file');
    expect(chatAttachmentExtensionOf('text/html')).toBeNull();
    expect(chatAttachmentKindOf('text/html')).toBeNull();
  });

  it('大きさは 1 バイト〜20 MiB の整数', () => {
    expect(CHAT_ATTACHMENT_MAX_BYTES).toBe(20 * 1024 * 1024);
    expect(isChatAttachmentByteSize(1)).toBe(true);
    expect(isChatAttachmentByteSize(CHAT_ATTACHMENT_MAX_BYTES)).toBe(true);
    expect(isChatAttachmentByteSize(0)).toBe(false);
    expect(isChatAttachmentByteSize(CHAT_ATTACHMENT_MAX_BYTES + 1)).toBe(false);
    expect(isChatAttachmentByteSize(1.5)).toBe(false);
  });
});
