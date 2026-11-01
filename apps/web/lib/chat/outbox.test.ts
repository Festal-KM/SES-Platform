// apps/web/lib/chat/outbox.test.ts
// ✅ 2026-10-29（F-038 ⑮）: 送った発言をその場で出す送信箱（`lib/chat/outbox.ts`）。
import { describe, expect, it } from 'vitest';
import {
  canResendOutbox,
  chatTempId,
  enqueueOutbox,
  isChatTempId,
  nextOutboxToSend,
  isOutboxShadowed,
  placeSentMessage,
  removeOutbox,
  requeueOutbox,
  updateOutbox,
  type ChatOutboxEntry,
} from './outbox';
import type { ChatMessageView } from './views';

type Payload = { readonly body: string };

function message(id: string, sentAt: string): ChatMessageView {
  return { id, sentAt, senderName: '佐藤', senderCompanyName: '株式会社サンプル', own: true, mine: true, body: '本文' };
}

const EMPTY: readonly ChatOutboxEntry<Payload>[] = [];

function add(entries: readonly ChatOutboxEntry<Payload>[], tempId: string, text: string, items: readonly ChatMessageView[] = []) {
  return enqueueOutbox(entries, { tempId, text, items, payload: { body: text } });
}

describe('仮の ID', () => {
  it('サーバの発言の ID（UUID）と取り違えない形', () => {
    const id = chatTempId(3, 1_700_000_000_000);
    expect(isChatTempId(id)).toBe(true);
    expect(isChatTempId('01930000-0000-7000-8000-000000000121')).toBe(false);
    expect(chatTempId(1, 5)).not.toBe(chatTempId(2, 5));
  });
});

describe('🔴 1 件ずつ順に送る', () => {
  it('足した順に QUEUED で並び、いちばん古いものから送る', () => {
    const entries = add(add(EMPTY, 't1', '一'), 't2', '二');
    expect(entries.map((entry) => entry.status)).toEqual(['QUEUED', 'QUEUED']);
    expect(nextOutboxToSend(entries)?.tempId).toBe('t1');
  });

  it('送っている最中（アップロード中を含む）の発言があれば、次を送らない', () => {
    const base = add(add(EMPTY, 't1', '一'), 't2', '二');
    expect(nextOutboxToSend(updateOutbox(base, 't1', 'SENDING'))).toBeNull();
    expect(nextOutboxToSend(updateOutbox(base, 't1', 'UPLOADING'))).toBeNull();
  });

  it('失敗した発言は止めて残し、後ろの発言は先に送る', () => {
    const base = add(add(EMPTY, 't1', '一'), 't2', '二');
    const failed = updateOutbox(base, 't1', 'FAILED', 'FAILED');
    expect(failed[0]).toMatchObject({ status: 'FAILED', failure: 'FAILED' });
    expect(nextOutboxToSend(failed)?.tempId).toBe('t2');
  });
});

describe('送れたら置き換える', () => {
  it('🔴 送れた発言は会話に 1 行で置かれ、送信箱からは外れる', () => {
    const sent = message('m1', '2026-10-29T01:00:00.000Z');
    expect(placeSentMessage([], sent).map((item) => item.id)).toEqual(['m1']);
    const entries = updateOutbox(add(EMPTY, 't1', '本文'), 't1', 'SENDING');
    expect(removeOutbox(entries, 't1')).toEqual([]);
  });

  it('🔴 新着の取得が先に同じ発言を持ってきていても、二重に並べない', () => {
    const sent = message('m1', '2026-10-29T01:00:00.000Z');
    expect(placeSentMessage([sent], sent).map((item) => item.id)).toEqual(['m1']);
  });

  it('外す（取り消す）と、その 1 件だけが消える', () => {
    const entries = add(add(EMPTY, 't1', '一'), 't2', '二');
    expect(removeOutbox(entries, 't1').map((entry) => entry.tempId)).toEqual(['t2']);
  });
});

describe('🔴 応答より先に新着の取得が同じ発言を持ってきたら、「送信中」を隠す（二重に見せない）', () => {
  const before = message('m0', '2026-10-29T00:59:00.000Z');

  it('足した時点より後ろの、自分の・同じ本文の発言があれば隠す', () => {
    const entries = updateOutbox(add(EMPTY, 't1', '本文', [before]), 't1', 'SENDING');
    const arrived = { ...message('m1', '2026-10-29T01:00:00.000Z'), body: '本文' };
    expect(isOutboxShadowed(entries[0] as ChatOutboxEntry<Payload>, [before, arrived])).toBe(true);
  });

  it('前からあった同じ本文の発言・相手の発言・送る前の段階では隠さない', () => {
    const same = { ...before, body: '本文' };
    const queued = add(EMPTY, 't1', '本文', [same]);
    const sending = updateOutbox(queued, 't1', 'SENDING');
    expect(isOutboxShadowed(sending[0] as ChatOutboxEntry<Payload>, [same])).toBe(false);
    const theirs = { ...message('m2', '2026-10-29T01:00:00.000Z'), body: '本文', mine: false };
    expect(isOutboxShadowed(sending[0] as ChatOutboxEntry<Payload>, [same, theirs])).toBe(false);
    const arrived = { ...message('m1', '2026-10-29T01:00:00.000Z'), body: '本文' };
    expect(isOutboxShadowed(queued[0] as ChatOutboxEntry<Payload>, [same, arrived])).toBe(false);
  });
});

describe('送り直し', () => {
  it('失敗した発言は QUEUED に戻せる', () => {
    const failed = updateOutbox(add(EMPTY, 't1', '一'), 't1', 'FAILED', 'ATTACHMENT');
    expect(canResendOutbox(failed[0] as ChatOutboxEntry<Payload>)).toBe(true);
    expect(requeueOutbox(failed, 't1')[0]).toMatchObject({ status: 'QUEUED', failure: null });
  });

  it('🔴 貼れない案件で断られた発言は送り直させない（同じ失敗を繰り返す）', () => {
    const failed = updateOutbox(add(EMPTY, 't1', '一'), 't1', 'FAILED', 'PROJECT');
    expect(canResendOutbox(failed[0] as ChatOutboxEntry<Payload>)).toBe(false);
    expect(requeueOutbox(failed, 't1')).toBe(failed);
  });

  it('送っている最中の発言は送り直せない（二重に送らない）', () => {
    const sending = updateOutbox(add(EMPTY, 't1', '一'), 't1', 'SENDING');
    expect(requeueOutbox(sending, 't1')).toBe(sending);
  });
});
