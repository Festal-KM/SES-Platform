// apps/web/lib/chat/screen-query.test.ts
// `S-031` の URL（`lib/chat/screen-query.ts`）。
import { describe, expect, it } from 'vitest';
import {
  CHAT_PATH,
  chatHref,
  chatMessagesApiPath,
  chatScreenQuerySchema,
} from './screen-query';

const THREAD = '01930000-0000-7000-8000-000000000121';
/** 🔴 スレッド一覧のカーソルは**複合**（`thread-cursor.ts`）。UUID 単体ではない。 */
const CURSOR = '2026-10-01T02:30:00.000Z~01930000-0000-7000-8000-000000000122';

describe('chatHref', () => {
  it('何も指定しなければ素の `/chat`（空のクエリを付けない）', () => {
    expect(chatHref({})).toBe(CHAT_PATH);
    expect(chatHref({ thread: null, threadsCursor: null })).toBe(CHAT_PATH);
  });

  it('スレッドの選択を `?thread=` に載せる（共有・再読込・戻るで同じ会話に戻れる）', () => {
    expect(chatHref({ thread: THREAD })).toBe(`/chat?thread=${THREAD}`);
  });

  it('一覧のカーソルと選択を同時に保つ（ページを繰っても選択中の会話が消えない）', () => {
    // 🔴 複合カーソルは `:` を含むため、URL では百分率エンコードされる（`URLSearchParams`）。
    const href = chatHref({ thread: THREAD, threadsCursor: CURSOR });
    expect(new URL(href, 'https://app.test').searchParams.get('threads')).toBe(CURSOR);
    expect(new URL(href, 'https://app.test').searchParams.get('thread')).toBe(THREAD);
  });

  it('選択なしでカーソルだけを載せられる', () => {
    const href = chatHref({ threadsCursor: CURSOR });
    expect(new URL(href, 'https://app.test').searchParams.get('threads')).toBe(CURSOR);
    expect(new URL(href, 'https://app.test').searchParams.get('thread')).toBeNull();
  });
});

describe('chatScreenQuerySchema', () => {
  it('`thread` は UUID、`threads` は複合カーソルだけを受ける（壊れた値は失敗 = 画面は `/chat` へ戻す）', () => {
    expect(chatScreenQuerySchema.safeParse({ thread: THREAD }).success).toBe(true);
    expect(chatScreenQuerySchema.safeParse({ thread: 'not-a-uuid' }).success).toBe(false);
    expect(chatScreenQuerySchema.safeParse({ threads: '1' }).success).toBe(false);
    // 🔴 UUID 単体のカーソルは受けない（`thread-cursor.ts` の 🔴）。
    expect(chatScreenQuerySchema.safeParse({ threads: THREAD }).success).toBe(false);
    expect(chatScreenQuerySchema.safeParse({ threads: CURSOR }).success).toBe(true);
  });

  it('未指定を許す（選択なしで一覧だけを見る状態がある）', () => {
    const parsed = chatScreenQuerySchema.safeParse({});
    expect(parsed.success).toBe(true);
    expect(parsed.success ? parsed.data.thread : 'x').toBeUndefined();
  });

  it('🔴 分離キーをスキーマが持たない（`tenantId` / `partnerCompanyId` の口が無い）', () => {
    expect(Object.keys(chatScreenQuerySchema.shape).sort()).toEqual(['thread', 'threads']);
  });
});

describe('chatMessagesApiPath', () => {
  it('`docs/05` §6.5 #50 / #51 の URL を 1 箇所で組む（画面に書き写さない）', () => {
    expect(chatMessagesApiPath(THREAD)).toBe(`/api/threads/${THREAD}/messages`);
  });
});
