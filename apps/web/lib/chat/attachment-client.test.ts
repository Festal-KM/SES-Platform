// apps/web/lib/chat/attachment-client.test.ts
// ✅ 2026-10-27: ファイルの表示の語・受け付け・アップロードの手順（`docs/04` §S-031 改訂 44）。
import { describe, expect, it, vi } from 'vitest';
import {
  acceptChatAttachment,
  chatAttachmentSummary,
  fetchChatAttachmentUrl,
  formatChatAttachmentSize,
  uploadChatAttachment,
  type ChatAttachmentFormatLabels,
} from './attachment-client';

const LABELS: ChatAttachmentFormatLabels = {
  types: { image: '画像', pdf: 'PDF', docx: 'Word', xlsx: 'Excel', csv: 'CSV', txt: 'テキスト', other: 'ファイル' },
  units: { byte: 'B', kilo: 'KB', mega: 'MB' },
  separator: '・',
};

describe('種類と大きさの語', () => {
  it('「PDF・1.2 MB」のように出す（ファイル名を使わない）', () => {
    expect(chatAttachmentSummary({ contentType: 'application/pdf', byteSize: 1_258_291 }, LABELS)).toBe('PDF・1.2 MB');
    expect(chatAttachmentSummary({ contentType: 'image/png', byteSize: 500 }, LABELS)).toBe('画像・500 B');
    expect(chatAttachmentSummary({ contentType: 'text/csv', byteSize: 3000 }, LABELS)).toBe('CSV・3 KB');
    expect(formatChatAttachmentSize(15 * 1024 * 1024, LABELS)).toBe('15 MB');
  });
});

describe('受け付けるファイル', () => {
  it('許可した種類で 20 MiB まで。端末が種類を空で渡しても拡張子で決める', () => {
    expect(acceptChatAttachment({ type: 'application/pdf', size: 10, name: 'a.pdf' })).toBe('application/pdf');
    expect(acceptChatAttachment({ type: '', size: 10, name: 'list.CSV' })).toBe('text/csv');
    expect(acceptChatAttachment({ type: 'text/html', size: 10, name: 'x.html' })).toBeNull();
    expect(acceptChatAttachment({ type: 'image/png', size: 0, name: 'a.png' })).toBeNull();
    expect(acceptChatAttachment({ type: 'image/png', size: 20 * 1024 * 1024 + 1, name: 'a.png' })).toBeNull();
  });
});

describe('アップロードの手順', () => {
  it('#51p で札を受け取り、署名どおりのヘッダで PUT してから札を返す（ファイル名を送らない）', async () => {
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.endsWith('/upload-url')) {
        expect(JSON.parse(String(init?.body))).toEqual({ contentType: 'application/pdf', byteSize: 3 });
        return Response.json({ uploadUrl: 'https://s3.example/put', uploadToken: 'tok', requiredHeaders: { 'content-type': 'application/pdf' } });
      }
      expect(url).toBe('https://s3.example/put');
      expect(init?.method).toBe('PUT');
      expect(init?.headers).toEqual({ 'content-type': 'application/pdf' });
      return new Response(null, { status: 200 });
    });
    const outcome = await uploadChatAttachment({ threadId: 'room', contentType: 'application/pdf', body: new Blob(['abc']) }, { fetch: fetchMock as unknown as typeof fetch });
    expect(outcome).toEqual({ ok: true, uploadToken: 'tok' });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('🔴 転送に失敗したら札を返さない（実体が無いまま送らない）。部屋が見えなければ MISSING', async () => {
    const failing = vi.fn(async (url: string) =>
      url.endsWith('/upload-url') ? Response.json({ uploadUrl: 'https://s3.example/put', uploadToken: 'tok', requiredHeaders: {} }) : new Response(null, { status: 403 }),
    );
    expect(await uploadChatAttachment({ threadId: 'room', contentType: 'text/plain', body: new Blob(['a']) }, { fetch: failing as unknown as typeof fetch })).toEqual({ ok: false, reason: 'FAILED' });
    const missing = vi.fn(async () => new Response(null, { status: 404 }));
    expect(await uploadChatAttachment({ threadId: 'room', contentType: 'text/plain', body: new Blob(['a']) }, { fetch: missing as unknown as typeof fetch })).toEqual({ ok: false, reason: 'MISSING' });
  });

  it('共有 URL は押すたびに #51q で取り直す（取れなければ null）', async () => {
    const ok = vi.fn(async () => Response.json({ url: 'https://s3.example/get', expiresAt: 'x' }));
    expect(await fetchChatAttachmentUrl({ threadId: 'room', messageId: 'm1', disposition: 'inline' }, { fetch: ok as unknown as typeof fetch })).toBe('https://s3.example/get');
    const ng = vi.fn(async () => new Response(null, { status: 409 }));
    expect(await fetchChatAttachmentUrl({ threadId: 'room', messageId: 'm1', disposition: 'attachment' }, { fetch: ng as unknown as typeof fetch })).toBeNull();
  });
});
