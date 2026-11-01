// apps/web/lib/chat/screen-query.test.ts
// `S-031` の URL（`lib/chat/screen-query.ts`）。
import { describe, expect, it } from 'vitest';
import {
  CHAT_PATH,
  chatHref,
  chatMessageSearchApiPath,
  chatMessagesApiPath,
  chatSaveApiPath,
  chatScreenQuerySchema,
  chatTemplateApiPath,
  parseChatFilter,
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
    expect(Object.keys(chatScreenQuerySchema.shape).sort()).toEqual(['f', 'info', 'msg', 'pane', 'q', 'sort', 'thread', 'threads', 'unread']);
  });
});

describe('右に並べる会話（`pane`。2026-10-14）', () => {
  const PANE_1 = '01930000-0000-7000-8000-000000000131';
  const PANE_2 = '01930000-0000-7000-8000-000000000132';
  const PANE_3 = '01930000-0000-7000-8000-000000000133';

  it('1 本は文字列、2 本は配列で届く。どちらも配列に揃える', () => {
    const one = chatScreenQuerySchema.safeParse({ thread: THREAD, pane: PANE_1 });
    expect(one.success ? one.data.pane : null).toEqual([PANE_1]);
    const two = chatScreenQuerySchema.safeParse({ thread: THREAD, pane: [PANE_1, PANE_2] });
    expect(two.success ? two.data.pane : null).toEqual([PANE_1, PANE_2]);
  });

  it('🔴 壊れた並びは失敗（= 画面は `/chat` へ戻す）: 上限超え・重複・左端なし・UUID でない', () => {
    expect(chatScreenQuerySchema.safeParse({ thread: THREAD, pane: [PANE_1, PANE_2, PANE_3] }).success).toBe(false);
    expect(chatScreenQuerySchema.safeParse({ thread: THREAD, pane: [PANE_1, PANE_1] }).success).toBe(false);
    expect(chatScreenQuerySchema.safeParse({ thread: THREAD, pane: THREAD }).success).toBe(false);
    expect(chatScreenQuerySchema.safeParse({ pane: PANE_1 }).success).toBe(false);
    expect(chatScreenQuerySchema.safeParse({ thread: THREAD, pane: 'not-a-uuid' }).success).toBe(false);
  });

  it('chatHref は `pane` を左から順に載せ、`thread` が無ければ載せない', () => {
    const href = chatHref({ thread: THREAD, panes: [PANE_1, PANE_2] });
    expect(new URL(href, 'https://app.test').searchParams.getAll('pane')).toEqual([PANE_1, PANE_2]);
    expect(chatHref({ thread: null, panes: [PANE_1] })).toBe(CHAT_PATH);
    expect(chatHref({ thread: THREAD, panes: [] })).toBe(`/chat?thread=${THREAD}`);
  });
});

describe('chatMessagesApiPath', () => {
  it('`docs/05` §6.5 #50 / #51 の URL を 1 箇所で組む（画面に書き写さない）', () => {
    expect(chatMessagesApiPath(THREAD)).toBe(`/api/threads/${THREAD}/messages`);
  });
});

describe('一覧の検索語と並べ方（`q` / `sort`。2026-10-14）', () => {
  it('検索語は前後の空白を落とし、空なら指定なしと同じ', () => {
    const parsed = chatScreenQuerySchema.safeParse({ q: '  金融  ' });
    expect(parsed.success ? parsed.data.q : null).toBe('金融');
    const empty = chatScreenQuerySchema.safeParse({ q: '   ' });
    expect(empty.success).toBe(true);
    expect(empty.success ? empty.data.q : 'x').toBeUndefined();
  });

  it('🔴 長すぎる検索語・知らない並べ方は壊れた値（画面は /chat へ戻す）', () => {
    expect(chatScreenQuerySchema.safeParse({ q: 'あ'.repeat(101) }).success).toBe(false);
    expect(chatScreenQuerySchema.safeParse({ sort: 'name' }).success).toBe(false);
    expect(chatScreenQuerySchema.safeParse({ sort: 'company' }).success).toBe(true);
  });

  it('chatHref は検索語と並べ方を保ち、既定の並べ方（recent）は載せない', () => {
    const href = chatHref({ thread: THREAD, q: '金融', sort: 'company' });
    const url = new URL(href, 'https://app.test');
    expect(url.searchParams.get('q')).toBe('金融');
    expect(url.searchParams.get('sort')).toBe('company');
    expect(chatHref({ thread: THREAD, sort: 'recent', q: '' })).toBe(`/chat?thread=${THREAD}`);
  });
});

describe('未読のみ（`unread`。2026-10-16）', () => {
  it('unread=1 だけを受け、chatHref は真のときだけ載せる', () => {
    expect(chatScreenQuerySchema.safeParse({ unread: '1' }).success).toBe(true);
    expect(chatScreenQuerySchema.safeParse({ unread: 'yes' }).success).toBe(false);
    expect(new URL(chatHref({ thread: THREAD, unread: true }), 'https://app.test').searchParams.get('unread')).toBe('1');
    expect(chatHref({ thread: THREAD, unread: false })).toBe(`/chat?thread=${THREAD}`);
  });
});

describe('左の列の絞り込み（`f=`。2026-10-22）', () => {
  it('保存済み（saved）と定型文の管理（templates）を読み、URL に戻せる', () => {
    expect(parseChatFilter('saved')).toEqual({ kind: 'saved' });
    expect(parseChatFilter('templates')).toEqual({ kind: 'templates' });
    expect(chatHref({ filter: { kind: 'saved' } })).toBe(`${CHAT_PATH}?f=saved`);
    expect(chatHref({ filter: { kind: 'templates' } })).toBe(`${CHAT_PATH}?f=templates`);
  });

  it('🔴 旧「要返信」（awaiting）は古いリンクのために受け付け、「すべて」として読む（壊れた値にしない）', () => {
    expect(chatScreenQuerySchema.safeParse({ f: 'awaiting' }).success).toBe(true);
    expect(parseChatFilter('awaiting')).toEqual({ kind: 'all' });
    expect(chatHref({ filter: parseChatFilter('awaiting') })).toBe(CHAT_PATH);
  });

  it('知らない値は「すべて」', () => {
    expect(chatScreenQuerySchema.safeParse({ f: 'saved-x' }).success).toBe(false);
    expect(parseChatFilter('saved-x')).toEqual({ kind: 'all' });
  });

  it('保存・定型文の API の URL を 1 箇所で組む', () => {
    expect(chatSaveApiPath(THREAD, '01930000-0000-7000-8000-000000000123')).toBe(
      `/api/threads/${THREAD}/messages/01930000-0000-7000-8000-000000000123/save`,
    );
    expect(chatTemplateApiPath('01930000-0000-7000-8000-000000000124')).toBe('/api/chat/templates/01930000-0000-7000-8000-000000000124');
  });
});

describe('✅ 2026-10-29（F-038 ⑰）: 発言へ移る `msg` と、この会話の中の検索', () => {
  const MESSAGE = '01930000-0000-7000-8000-000000000123';

  it('`msg` は部屋（`thread`）があるときだけ載る', () => {
    expect(chatHref({ thread: THREAD, message: MESSAGE })).toBe(`/chat?thread=${THREAD}&msg=${MESSAGE}`);
    expect(chatHref({ thread: null, message: MESSAGE })).toBe(CHAT_PATH);
  });

  it('`msg` は UUID だけを受ける（壊れた値は素の `/chat` へ戻す）', () => {
    expect(chatScreenQuerySchema.safeParse({ thread: THREAD, msg: MESSAGE }).success).toBe(true);
    expect(chatScreenQuerySchema.safeParse({ thread: THREAD, msg: 'x' }).success).toBe(false);
  });

  it('検索の API の URL は部屋 1 つと検索語だけ（語はエンコードする）', () => {
    expect(chatMessageSearchApiPath(THREAD, ' 面談 &日程 ')).toBe(
      `/api/threads/${THREAD}/messages/search?q=${encodeURIComponent('面談 &日程')}`,
    );
  });
});
