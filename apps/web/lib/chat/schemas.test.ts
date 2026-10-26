// apps/web/lib/chat/schemas.test.ts
// `S-031` の API 境界（`lib/chat/schemas.ts`）。`docs/05` §6.5 #50 / #51 / §6.1 / `CLAUDE.md` §3.1。
import { describe, expect, it } from 'vitest';
import { CHAT_MESSAGE_MAX_LENGTH, CHAT_MESSAGE_PAGE_SIZE, PAGE_SIZE_MAX } from '@ses/config';
import { ISOLATION_KEYS } from '../api/isolation-keys';
import {
  chatAnnouncementBodySchema,
  chatMessageBodySchema,
  chatMessagePostBodySchema,
  chatProjectCandidateQuerySchema,
  chatMessageListQuerySchema,
  chatThreadListQuerySchema,
  chatThreadParamsSchema,
} from './schemas';

const UUID = '01930000-0000-7000-8000-000000000121';

describe('chatMessageBodySchema（投稿。#51）', () => {
  it('前後の空白を落とす', () => {
    const parsed = chatMessageBodySchema.safeParse({ body: '  候補日をお送りします  ' });
    expect(parsed.success && parsed.data.body).toBe('候補日をお送りします');
  });

  it('🔴 空・空白だけは通さない（空の吹き出しを相手に届けない）', () => {
    expect(chatMessageBodySchema.safeParse({ body: '' }).success).toBe(false);
    expect(chatMessageBodySchema.safeParse({ body: '   ' }).success).toBe(false);
    expect(chatMessageBodySchema.safeParse({}).success).toBe(false);
    expect(chatMessageBodySchema.safeParse(null).success).toBe(false);
  });

  it('🔴 上限を超える本文は 400 になる（`messages.body` は `text` で DB 側に上限が無い）', () => {
    expect(chatMessageBodySchema.safeParse({ body: 'あ'.repeat(CHAT_MESSAGE_MAX_LENGTH) }).success).toBe(true);
    expect(chatMessageBodySchema.safeParse({ body: 'あ'.repeat(CHAT_MESSAGE_MAX_LENGTH + 1) }).success).toBe(false);
  });

  it('🔴 添付の口が無い（`attachmentKey` を渡しても検証後の値に残らない）', () => {
    const parsed = chatMessageBodySchema.safeParse({ body: 'x', attachmentKey: 't/abc/def.pdf' });
    expect(parsed.success).toBe(true);
    expect(Object.keys(parsed.success ? parsed.data : {})).toEqual(['body']);
  });
});

describe('✅ 2026-10-23 chatMessagePostBodySchema（投稿 + 案件を貼る。#51）', () => {
  const PROJECT = '01930000-0000-7000-8000-0000000000f1';

  it('本文だけの投稿は従来どおり通る（前後の空白を落とす）', () => {
    const parsed = chatMessagePostBodySchema.safeParse({ body: '  候補日をお送りします  ' });
    expect(parsed.success && parsed.data).toEqual({ body: '候補日をお送りします' });
  });

  it('案件を貼るときは本文を省略できる（カードだけの発言）', () => {
    const parsed = chatMessagePostBodySchema.safeParse({ projectId: PROJECT });
    expect(parsed.success && parsed.data).toEqual({ body: '', projectId: PROJECT });
    expect(chatMessagePostBodySchema.safeParse({ body: '   ', projectId: PROJECT }).success).toBe(true);
  });

  it('🔴 本文も案件も無い・本文が空白だけで案件も無いなら 400', () => {
    expect(chatMessagePostBodySchema.safeParse({}).success).toBe(false);
    expect(chatMessagePostBodySchema.safeParse({ body: '   ' }).success).toBe(false);
    expect(chatMessagePostBodySchema.safeParse(null).success).toBe(false);
  });

  it('🔴 案件の ID は UUID の形だけ', () => {
    expect(chatMessagePostBodySchema.safeParse({ body: 'x', projectId: 'project-1' }).success).toBe(false);
  });

  it('🔴 本文の上限は従来と同じ', () => {
    expect(chatMessagePostBodySchema.safeParse({ body: 'あ'.repeat(CHAT_MESSAGE_MAX_LENGTH + 1), projectId: PROJECT }).success).toBe(false);
  });

  it('🔴 取引先・テナントのキーや添付を渡しても検証後の値に残らない', () => {
    const parsed = chatMessagePostBodySchema.safeParse({
      body: 'x',
      projectId: PROJECT,
      partnerCompanyId: '01930000-0000-7000-8000-0000000000c2',
      tenantId: '01930000-0000-7000-8000-0000000000b1',
      attachmentKey: 't/abc/def.pdf',
    });
    expect(parsed.success).toBe(true);
    expect(Object.keys(parsed.success ? parsed.data : {}).sort()).toEqual(['body', 'projectId']);
  });

  it('貼る案件の候補（#51n）は絞り込み語だけを受け、空の語は無いのと同じ', () => {
    expect(Object.keys(chatProjectCandidateQuerySchema.shape)).toEqual(['q']);
    const blank = chatProjectCandidateQuerySchema.safeParse({ q: '  ' });
    expect(blank.success && blank.data.q).toBeUndefined();
    const parsed = chatProjectCandidateQuerySchema.safeParse({ q: ' 基幹 ' });
    expect(parsed.success && parsed.data.q).toBe('基幹');
    expect(chatProjectCandidateQuerySchema.safeParse({ q: 'あ'.repeat(201) }).success).toBe(false);
  });
});

describe('ページング（#50）', () => {
  it('会話の既定は 50 件（`docs/04` §10.4 `S-031`「直近 50 件」）', () => {
    const parsed = chatMessageListQuerySchema.safeParse({});
    expect(parsed.success && parsed.data.limit).toBe(CHAT_MESSAGE_PAGE_SIZE);
    expect(CHAT_MESSAGE_PAGE_SIZE).toBe(50);
  });

  it('🔴 `limit` の上限を超えたら 400（黙って丸めない）', () => {
    expect(chatMessageListQuerySchema.safeParse({ limit: String(PAGE_SIZE_MAX) }).success).toBe(true);
    expect(chatMessageListQuerySchema.safeParse({ limit: String(PAGE_SIZE_MAX + 1) }).success).toBe(false);
  });

  it('🔴 会話のカーソルは UUID の形だけ（行の ID。形が違えば 400 で、500 にしない）', () => {
    expect(chatMessageListQuerySchema.safeParse({ cursor: UUID }).success).toBe(true);
    expect(chatMessageListQuerySchema.safeParse({ cursor: 'cursor-1' }).success).toBe(false);
  });

  it('🔴 スレッド一覧のカーソルは**複合**である（行の ID 単体は受けない）', () => {
    // 🔴 `last_message_at` が `NULL` を取りうるため、行の ID 単体では 2 ページ目以降から
    //    行が静かに落ちる（`thread-cursor.ts` の 🔴）。したがって ID 単体は **400** である。
    expect(chatThreadListQuerySchema.safeParse({ cursor: UUID }).success).toBe(false);
    expect(chatThreadListQuerySchema.safeParse({ cursor: 'cursor-1' }).success).toBe(false);
    expect(chatThreadListQuerySchema.safeParse({ cursor: `2026-10-01T02:30:00.000Z~${UUID}` }).success).toBe(true);
    expect(chatThreadListQuerySchema.safeParse({ cursor: `-~${UUID}` }).success).toBe(true);
  });

  it('🔴 検索・絞り込みの口を持たない（実体の無いタブを受けない）', () => {
    expect(Object.keys(chatThreadListQuerySchema.shape).sort()).toEqual(['cursor', 'limit']);
    expect(Object.keys(chatMessageListQuerySchema.shape).sort()).toEqual(['cursor', 'limit']);
  });
});

describe('chatThreadParamsSchema', () => {
  it('UUID だけを受ける', () => {
    expect(chatThreadParamsSchema.safeParse({ id: UUID }).success).toBe(true);
    expect(chatThreadParamsSchema.safeParse({ id: 'x' }).success).toBe(false);
  });
});

describe('🔴 分離キーが 1 つも入っていない（`CLAUDE.md` §3.1 / `BR-03`）', () => {
  it.each([
    ['chatThreadListQuerySchema', Object.keys(chatThreadListQuerySchema.shape)],
    ['chatMessageListQuerySchema', Object.keys(chatMessageListQuerySchema.shape)],
    ['chatThreadParamsSchema', Object.keys(chatThreadParamsSchema.shape)],
    ['chatMessageBodySchema', Object.keys(chatMessageBodySchema.shape)],
    ['chatAnnouncementBodySchema', Object.keys(chatAnnouncementBodySchema.shape)],
    ['chatMessagePostBodySchema', Object.keys(chatMessagePostBodySchema.shape)],
    ['chatProjectCandidateQuerySchema', Object.keys(chatProjectCandidateQuerySchema.shape)],
  ])('%s', (_label, keys) => {
    for (const forbidden of ISOLATION_KEYS) {
      expect(keys, forbidden).not.toContain(forbidden);
    }
  });
});

// ✅ 2026-10-26: アナウンス（`PUT` / `DELETE /api/threads/{id}/announcement`）。
describe('chatAnnouncementBodySchema', () => {
  it('発言の ID（UUID）だけを受ける', () => {
    expect(chatAnnouncementBodySchema.safeParse({ messageId: UUID }).success).toBe(true);
    expect(chatAnnouncementBodySchema.safeParse({ messageId: 'x' }).success).toBe(false);
    expect(chatAnnouncementBodySchema.safeParse({}).success).toBe(false);
  });

  it('🔴 ほかのキー（部屋・テナント・取引先・設定した人）を受けない（`.strict()`）', () => {
    for (const extra of ['threadId', 'tenantId', 'partnerCompanyId', 'setByUserId']) {
      expect(chatAnnouncementBodySchema.safeParse({ messageId: UUID, [extra]: UUID }).success, extra).toBe(false);
    }
  });
});
