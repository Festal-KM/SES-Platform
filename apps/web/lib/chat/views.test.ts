// apps/web/lib/chat/views.test.ts
// `S-031` の応答の形（`lib/chat/views.ts`）。`CLAUDE.md` §3.1 **越境経路 3** / `F-038 AC-1` / `BR-67`。
//
// 🔴 ここで固定するのは「**何を返すか**」ではなく「**何を返さないか**」である ——
//    未読 / 添付 / 他社の ID / 商流（単価・エンド企業名）を**型にも実行時の形にも持たない**こと。
import { describe, expect, it } from 'vitest';
import {
  asChatThreadKind,
  chatMessageView,
  chatThreadDetailView,
  chatThreadListItem,
  CHAT_FORBIDDEN_RESPONSE_KEYS,
  CHAT_MESSAGE_VIEW_KEYS,
  CHAT_PARTICIPANT_VIEW_KEYS,
  CHAT_THREAD_DETAIL_VIEW_KEYS,
  CHAT_THREAD_KINDS,
  CHAT_THREAD_LIST_ITEM_KEYS,
  type ChatMessageRow,
  type ChatThreadRow,
} from './views';

const THREAD_ROW: ChatThreadRow = {
  id: '01930000-0000-7000-8000-000000000121',
  kind: 'COMPANY',
  projectId: null,
  lastMessageAt: new Date('2026-10-01T02:30:00.000Z'),
};

const MESSAGE_ROW: ChatMessageRow = {
  id: '01930000-0000-7000-8000-000000000123',
  senderUserId: '01930000-0000-7000-8000-0000000000d2',
  senderPartnerCompanyId: '01930000-0000-7000-8000-0000000000c1',
  body: '来週の面談の候補日をお送りします。',
  sentAt: new Date('2026-10-01T02:30:00.000Z'),
};

describe('asChatThreadKind（CHECK を信じず未知の値で落とす）', () => {
  it.each([...CHAT_THREAD_KINDS])('%s を通す', (kind) => {
    expect(asChatThreadKind(kind)).toBe(kind);
  });

  it('🔴 未知の値は握り潰さず RangeError にする', () => {
    expect(() => asChatThreadKind('GROUP')).toThrow(RangeError);
  });

  it('種別は 2 値だけである（勝手に増やさない）', () => {
    expect([...CHAT_THREAD_KINDS]).toEqual(['PROJECT', 'COMPANY']);
  });
});

describe('chatThreadListItem（スレッド一覧の 1 行）', () => {
  it('キー集合が凍結どおりである', () => {
    const item = chatThreadListItem(THREAD_ROW, { project: null, counterpartyName: '株式会社ダミーアルファ' });
    expect(Object.keys(item).sort()).toEqual([...CHAT_THREAD_LIST_ITEM_KEYS].sort());
  });

  it('🔴 未読・件数・添付・他社の ID・商流のキーを 1 つも持たない', () => {
    const item = chatThreadListItem(THREAD_ROW, {
      project: { id: '01930000-0000-7000-8000-0000000000f1', name: '基幹刷新' },
      counterpartyName: '株式会社ダミーアルファ',
    });
    for (const forbidden of CHAT_FORBIDDEN_RESPONSE_KEYS) {
      expect(Object.keys(item), forbidden).not.toContain(forbidden);
    }
  });

  it('最終更新は ISO 8601。メッセージが無い（`null`）ときは `null` のまま', () => {
    expect(chatThreadListItem(THREAD_ROW, { project: null, counterpartyName: 'x' }).lastMessageAt).toBe(
      '2026-10-01T02:30:00.000Z',
    );
    expect(
      chatThreadListItem({ ...THREAD_ROW, lastMessageAt: null }, { project: null, counterpartyName: 'x' })
        .lastMessageAt,
    ).toBeNull();
  });

  it('🔴 案件名が読めないときは `null` を既定値で埋めない（RLS が 0 件にした事実を消さない）', () => {
    const item = chatThreadListItem(
      { ...THREAD_ROW, kind: 'PROJECT', projectId: '01930000-0000-7000-8000-0000000000f2' },
      { project: null, counterpartyName: null },
    );
    expect(item.project).toBeNull();
    expect(item.counterpartyName).toBeNull();
    expect(item.kind).toBe('PROJECT');
  });
});

describe('chatMessageView（会話の 1 件）', () => {
  it('キー集合が凍結どおりで、送信者の ID を含まない', () => {
    const view = chatMessageView(MESSAGE_ROW, {
      senderName: '仮名 一郎',
      senderCompanyName: '株式会社ダミーアルファ',
      viewerPartnerCompanyId: null,
    });
    expect(Object.keys(view).sort()).toEqual([...CHAT_MESSAGE_VIEW_KEYS].sort());
    for (const forbidden of CHAT_FORBIDDEN_RESPONSE_KEYS) {
      expect(Object.keys(view), forbidden).not.toContain(forbidden);
    }
  });

  it('🔴 `own` は会社で決まる（利用者単位にしない。スレッドには 2 社しか居ない）', () => {
    // 取引先の文脈: 自社が送った行は `own`。
    expect(
      chatMessageView(MESSAGE_ROW, {
        senderName: null,
        senderCompanyName: null,
        viewerPartnerCompanyId: '01930000-0000-7000-8000-0000000000c1',
      }).own,
    ).toBe(true);
    // ホストの文脈（`viewerPartnerCompanyId === null`）では、取引先の行は `own` ではない。
    expect(
      chatMessageView(MESSAGE_ROW, { senderName: null, senderCompanyName: null, viewerPartnerCompanyId: null }).own,
    ).toBe(false);
    // ホストが送った行（`senderPartnerCompanyId === null`）はホストにとって `own`。
    expect(
      chatMessageView(
        { ...MESSAGE_ROW, senderPartnerCompanyId: null },
        { senderName: null, senderCompanyName: null, viewerPartnerCompanyId: null },
      ).own,
    ).toBe(true);
    // 🔴 その行は取引先にとって `own` ではない。
    expect(
      chatMessageView(
        { ...MESSAGE_ROW, senderPartnerCompanyId: null },
        { senderName: null, senderCompanyName: null, viewerPartnerCompanyId: '01930000-0000-7000-8000-0000000000c1' },
      ).own,
    ).toBe(false);
  });

  it('🔴 本文が削除された行（`PURGED`）は `null` のまま返す（空文字で埋めない）', () => {
    expect(
      chatMessageView(
        { ...MESSAGE_ROW, body: null },
        { senderName: null, senderCompanyName: null, viewerPartnerCompanyId: null },
      ).body,
    ).toBeNull();
  });

  it('送信日時は ISO 8601 である', () => {
    expect(
      chatMessageView(MESSAGE_ROW, { senderName: null, senderCompanyName: null, viewerPartnerCompanyId: null }).sentAt,
    ).toBe('2026-10-01T02:30:00.000Z');
  });
});

describe('chatThreadDetailView（右の関連情報）', () => {
  it('キー集合が凍結どおりで、参加会社の行も凍結どおりである', () => {
    const view = chatThreadDetailView(THREAD_ROW, {
      project: null,
      counterpartyName: '株式会社ダミーアルファ',
      participants: [{ companyName: 'サンプル商事', isHost: true, joinedAt: '2026-09-01T00:00:00.000Z', leftAt: null }],
    });
    expect(Object.keys(view).sort()).toEqual([...CHAT_THREAD_DETAIL_VIEW_KEYS].sort());
    expect(Object.keys(view.participants[0] ?? {}).sort()).toEqual([...CHAT_PARTICIPANT_VIEW_KEYS].sort());
  });

  it('🔴 参加会社は渡された行だけ（見えない行を補わない）', () => {
    const view = chatThreadDetailView(THREAD_ROW, {
      project: null,
      counterpartyName: null,
      participants: [
        { companyName: '株式会社ダミーアルファ', isHost: false, joinedAt: '2026-09-01T00:00:00.000Z', leftAt: null },
      ],
    });
    expect(view.participants.length).toBe(1);
    expect(view.participants[0]?.isHost).toBe(false);
  });
});

describe('🔴 禁止キーの一覧そのものの対照（検査が空振りしていない）', () => {
  it('商流・未読・添付・他社の ID を名指しで含む', () => {
    for (const key of ['unitPrice', 'endClientName', 'unread', 'attachmentKey', 'partnerCompanyId', 'total']) {
      expect([...CHAT_FORBIDDEN_RESPONSE_KEYS]).toContain(key);
    }
  });

  it('応答のキー集合と禁止キーが 1 つも重なっていない（表が自己矛盾していない）', () => {
    const allowed = new Set<string>([
      ...CHAT_THREAD_LIST_ITEM_KEYS,
      ...CHAT_MESSAGE_VIEW_KEYS,
      ...CHAT_PARTICIPANT_VIEW_KEYS,
      ...CHAT_THREAD_DETAIL_VIEW_KEYS,
    ]);
    expect([...CHAT_FORBIDDEN_RESPONSE_KEYS].filter((key) => allowed.has(key))).toEqual([]);
  });
});
