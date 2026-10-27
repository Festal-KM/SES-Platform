// apps/web/lib/chat/attachment-token.test.ts
// ✅ 2026-10-27: チャットの添付の札（`docs/05` §6.5 #51p / #51）。
import { describe, expect, it } from 'vitest';
import { CHAT_ATTACHMENT_TOKEN_TTL_MS, ChatAttachmentTokenKeyError, createChatAttachmentTokenCodec, type ChatAttachmentUploadClaims } from './attachment-token';

const SECRET = Buffer.alloc(32, 7).toString('base64');
const OTHER_SECRET = Buffer.alloc(32, 9).toString('base64');
const NOW = new Date('2026-10-27T00:00:00.000Z');
const CLAIMS: ChatAttachmentUploadClaims = {
  tenantId: '01930000-0000-7000-8000-000000000001',
  threadId: '01930000-0000-7000-8000-0000000000c1',
  userId: '01930000-0000-7000-8000-0000000000b1',
  messageId: '01930000-0000-7000-8000-0000000000d1',
  objectKey: 't/01930000-0000-7000-8000-000000000001/chat/01930000-0000-7000-8000-0000000000c1/01930000-0000-7000-8000-0000000000d1/01930000-0000-7000-8000-0000000000a1.pdf',
  contentType: 'application/pdf',
  byteSize: 1234,
  expiresAt: NOW.getTime() + CHAT_ATTACHMENT_TOKEN_TTL_MS,
};

describe('チャットの添付の札', () => {
  const codec = createChatAttachmentTokenCodec(SECRET);

  it('署名した札は同じ鍵で確かめられ、焼き込んだ値がそのまま戻る', () => {
    expect(codec.verify(codec.sign(CLAIMS), NOW)).toEqual(CLAIMS);
  });

  it('🔴 中身を 1 文字でも書き換えた札は受け付けない（キー・大きさの差し替えを防ぐ）', () => {
    const token = codec.sign(CLAIMS);
    const [version, body, signature] = token.split('.') as [string, string, string];
    const tampered = Buffer.from(JSON.stringify({ ...CLAIMS, byteSize: 1 }), 'utf8').toString('base64url');
    expect(codec.verify(`${version}.${tampered}.${signature}`, NOW)).toBeNull();
    expect(codec.verify(`${version}.${body}.${signature.slice(0, -2)}AA`, NOW)).toBeNull();
  });

  it('🔴 別の鍵で署名した札・期限切れの札・形の違う札は受け付けない', () => {
    const other = createChatAttachmentTokenCodec(OTHER_SECRET);
    expect(codec.verify(other.sign(CLAIMS), NOW)).toBeNull();
    expect(codec.verify(codec.sign({ ...CLAIMS, expiresAt: NOW.getTime() }), NOW)).toBeNull();
    expect(codec.verify('v1.abc', NOW)).toBeNull();
    expect(codec.verify('v2.abc.def', NOW)).toBeNull();
    expect(codec.verify('x'.repeat(5000), NOW)).toBeNull();
  });

  it('🔴 短い鍵では組み立てない（既定の鍵に倒さない）', () => {
    expect(() => createChatAttachmentTokenCodec(Buffer.alloc(16).toString('base64'))).toThrow(ChatAttachmentTokenKeyError);
  });
});
