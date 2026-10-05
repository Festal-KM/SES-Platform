// apps/web/lib/chat/thread-cursor.test.ts
// `S-031` スレッド一覧の複合カーソル（`lib/chat/thread-cursor.ts`）。
//
// 🔴 ここが守るのは **「2 ページ目以降で行が静かに落ちない」** ことである
//    （`last_message_at` が `NULL` を取りうるため、行の ID を単体のカーソルにできない）。
//    並びを模した並べ替えに述語を適用して、**全件がちょうど 1 度ずつ現れる**ことを固定する。
import { describe, expect, it } from 'vitest';
import {
  chatThreadCursorWhere,
  decodeChatThreadCursor,
  encodeChatThreadCursor,
  isChatThreadCursor,
} from './thread-cursor';

const ID_A = '01930000-0000-7000-8000-0000000000a1';
const ID_B = '01930000-0000-7000-8000-0000000000b1';
const AT = new Date('2026-10-01T02:30:00.000Z');

describe('encode / decode', () => {
  it('発言ありの行は ISO 8601 と UUID を往復できる', () => {
    const encoded = encodeChatThreadCursor({ lastMessageAt: AT, id: ID_A });
    expect(encoded).toBe(`2026-10-01T02:30:00.000Z~${ID_A}`);
    expect(decodeChatThreadCursor(encoded)).toEqual({ lastMessageAt: AT, id: ID_A });
  });

  it('🔴 発言なし（`NULL`）の行も表せる（並びでは最後に来る行）', () => {
    const encoded = encodeChatThreadCursor({ lastMessageAt: null, id: ID_A });
    expect(encoded).toBe(`-~${ID_A}`);
    expect(decodeChatThreadCursor(encoded)).toEqual({ lastMessageAt: null, id: ID_A });
  });

  it('🔴 区切りは `~`（ISO 8601 が `:` を含むため、`:` では時刻と区別できない）', () => {
    expect(encodeChatThreadCursor({ lastMessageAt: AT, id: ID_A })).toContain('~');
    expect(decodeChatThreadCursor(`2026-10-01T02:30:00.000Z:${ID_A}`)).toBeNull();
  });

  it('🔴 形が違えば `null`（呼び出し側が 400 にする。黙って無指定扱いにしない）', () => {
    for (const broken of [
      '',
      '~',
      `~${ID_A}`,
      ID_A,
      `2026-10-01T02:30:00.000Z~not-a-uuid`,
      `2026-10-99T02:30:00.000Z~${ID_A}`,
      // 🔴 `Date` の寛容な解釈に委ねない（ISO 8601 に正規化できない表記は受けない）。
      `2026/10/01~${ID_A}`,
      `2026-10-01T02:30:00Z~${ID_A}`,
    ]) {
      expect(decodeChatThreadCursor(broken), broken).toBeNull();
      expect(isChatThreadCursor(broken), broken).toBe(false);
    }
  });
});

// ---------------------------------------------------------------------------
// 🔴 述語の正しさ（並びを模して「ちょうど 1 度ずつ」を確かめる）
// ---------------------------------------------------------------------------

type Row = { readonly lastMessageAt: Date | null; readonly id: string };

/** `last_message_at DESC NULLS LAST, id DESC` を模した並べ替え。 */
function sortLikeDb(rows: readonly Row[]): readonly Row[] {
  return [...rows].sort((a, b) => {
    if (a.lastMessageAt === null && b.lastMessageAt === null) return a.id < b.id ? 1 : -1;
    if (a.lastMessageAt === null) return 1;
    if (b.lastMessageAt === null) return -1;
    const diff = b.lastMessageAt.getTime() - a.lastMessageAt.getTime();
    return diff !== 0 ? diff : a.id < b.id ? 1 : -1;
  });
}

/** `chatThreadCursorWhere` が返す述語を、そのまま行に適用する（Prisma の評価を模す）。 */
function matches(row: Row, where: ReturnType<typeof chatThreadCursorWhere>): boolean {
  return where.OR.some((clause) => {
    const expected = clause.lastMessageAt;
    if (expected === null) {
      if (row.lastMessageAt !== null) return false;
    } else if (expected instanceof Date) {
      if (row.lastMessageAt === null || row.lastMessageAt.getTime() !== expected.getTime()) return false;
    } else {
      if (row.lastMessageAt === null || row.lastMessageAt.getTime() >= expected.lt.getTime()) return false;
    }
    const idClause = 'id' in clause ? clause.id : null;
    return idClause === null ? true : row.id < idClause.lt;
  });
}

const ROWS: readonly Row[] = [
  { lastMessageAt: new Date('2026-10-03T00:00:00.000Z'), id: '01930000-0000-7000-8000-000000000001' },
  { lastMessageAt: new Date('2026-10-02T00:00:00.000Z'), id: '01930000-0000-7000-8000-000000000002' },
  // 🔴 同時刻のタイブレーク（`id` 降順）。
  { lastMessageAt: new Date('2026-10-02T00:00:00.000Z'), id: '01930000-0000-7000-8000-000000000003' },
  // 🔴 発言なしが 2 件（並びでは最後。ここが単体 ID のカーソルで落ちていた行である）。
  { lastMessageAt: null, id: '01930000-0000-7000-8000-000000000004' },
  { lastMessageAt: null, id: '01930000-0000-7000-8000-000000000005' },
];

/** ページサイズ `limit` で全件を辿り、現れた順に ID を集める。 */
function paginate(limit: number): readonly string[] {
  const ordered = sortLikeDb(ROWS);
  const seen: string[] = [];
  let cursor: Row | null = null;
  for (let page = 0; page < 10; page += 1) {
    const where = cursor === null ? null : chatThreadCursorWhere(cursor);
    const candidates = where === null ? ordered : ordered.filter((row) => matches(row, where));
    const items = candidates.slice(0, limit);
    if (items.length === 0) break;
    seen.push(...items.map((row) => row.id));
    if (candidates.length <= limit) break;
    cursor = items[items.length - 1] as Row;
  }
  return seen;
}

describe('🔴 並びの中の位置（全件がちょうど 1 度ずつ現れる）', () => {
  it('並びは「最終更新の新しい順、発言なしは最後、同時刻は id 降順」である（対照）', () => {
    expect(sortLikeDb(ROWS).map((row) => row.id.slice(-1))).toEqual(['1', '3', '2', '5', '4']);
  });

  it.each([1, 2, 3, 4, 5])('ページサイズ %i で重複も欠落も無い', (limit) => {
    const seen = paginate(limit);
    expect(seen).toEqual(sortLikeDb(ROWS).map((row) => row.id));
    expect(new Set(seen).size).toBe(ROWS.length);
  });

  it('🔴 発言ありのカーソルの後ろには「発言なし」が必ず含まれる（NULLS LAST）', () => {
    const where = chatThreadCursorWhere({ lastMessageAt: new Date('2026-10-03T00:00:00.000Z'), id: ID_A });
    const nullRow: Row = { lastMessageAt: null, id: ID_B };
    expect(matches(nullRow, where)).toBe(true);
  });

  it('🔴 発言なしのカーソルの後ろには「発言あり」が 1 件も含まれない', () => {
    const where = chatThreadCursorWhere({ lastMessageAt: null, id: '01930000-0000-7000-8000-000000000005' });
    for (const row of ROWS.filter((candidate) => candidate.lastMessageAt !== null)) {
      expect(matches(row, where), row.id).toBe(false);
    }
    // 自分より `id` が小さい「発言なし」だけが残る。
    expect(ROWS.filter((row) => matches(row, where)).map((row) => row.id.slice(-1))).toEqual(['4']);
  });

  it('🔴 述語に分離キーが 1 つも含まれない（境界は RLS が決める）', () => {
    const where = chatThreadCursorWhere({ lastMessageAt: AT, id: ID_A });
    const json = JSON.stringify(where);
    for (const forbidden of ['tenantId', 'tenant_id', 'partnerCompanyId', 'partner_company_id']) {
      expect(json, forbidden).not.toContain(forbidden);
    }
    expect(Object.keys(where)).toEqual(['OR']);
  });
});
