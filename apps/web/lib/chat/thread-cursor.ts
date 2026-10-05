// apps/web/lib/chat/thread-cursor.ts
// `S-031` スレッド一覧のカーソル（`docs/05` §6.5 #50 / §6.1「カーソル方式」）。純粋関数。
//
// ============================================================================
// 🔴 なぜ行の ID（`uuid(7)`）をそのままカーソルにできないのか
// ============================================================================
// スレッドの並びは **「最終更新の新しい順、発言なし（`NULL`）は最後」** である
// （`docs/04` §S-031 の「最終更新」列。`read.ts` の `orderBy`）。ところが
// **`chat_threads.last_message_at` は `NULL` を取りうる**（まだ 1 件も発言が無いスレッド）。
//
// 🔴 Prisma の `cursor: { id }` + `skip: 1` は、**並び順のキーが `NULL` を取らない**ことを前提に
//    「カーソル行の位置から先」を組み立てる。`NULL` を含む列で使うと、比較が `NULL`（= 偽）に
//    なる行が 2 ページ目以降から**静かに落ちる**。これは「取得できない行がある」という
//    気づきにくい壊れ方であり、`CLAUDE.md` §4.8 の「見えない ＝ 存在しない」とも別物である
//    （**見えてよい行が見えなくなる**）。他の一覧（`proposals.updated_at` は `NOT NULL`）では
//    起きないため、既存の作法をそのまま写せない。
//
// 🔴 そこで **並び順のキーをそのままカーソルに持つ**（`docs/05` §6.5 #30 の候補一覧が
//    `{bucket}:{YYYY-MM-DD}:{sortRef}` の複合カーソルを持つのと同じ構え）。形が違えば **400**
//    であり、500 にしない（形で落ちると「実在する ID か」を応答から探れる経路になる）。
//
// 形式: `<最終更新の ISO 8601 | '-'>~<行の UUID>`
//   - `-` は「発言なし（`NULL`）」を表す。🔴 **ISO 8601 は `:` を含むため、区切りは `~` を使う。**
//   - 🔴 **不透明な値である**（利用者が組み立てるものではなく、サーバが返した値の返送である）。

/** 区切り（🔴 ISO 8601 に現れない文字。`:` を使うと時刻と区別できない）。 */
const SEPARATOR = '~';
/** 「発言なし（`NULL`）」の印。 */
const NO_MESSAGE = '-';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type ChatThreadCursor = {
  /** 並び順の 1 つ目のキー。`null` = 発言なし（並びでは最後）。 */
  readonly lastMessageAt: Date | null;
  /** 並び順の 2 つ目のキー（同時刻のタイブレーク）。 */
  readonly id: string;
};

/** 行からカーソルを作る（🔴 `read.ts` の `orderBy` と**同じ 2 つのキー**で組む）。 */
export function encodeChatThreadCursor(row: ChatThreadCursor): string {
  const head = row.lastMessageAt === null ? NO_MESSAGE : row.lastMessageAt.toISOString();
  return `${head}${SEPARATOR}${row.id}`;
}

/** カーソルを読む。🔴 **形が違えば `null`**（呼び出し側が 400 にする。黙って無指定扱いにしない）。 */
export function decodeChatThreadCursor(value: string): ChatThreadCursor | null {
  const index = value.indexOf(SEPARATOR);
  if (index <= 0) return null;
  const head = value.slice(0, index);
  const id = value.slice(index + SEPARATOR.length);
  if (!UUID.test(id)) return null;
  if (head === NO_MESSAGE) return { lastMessageAt: null, id };
  // 🔴 ISO 8601 として読めない値は受けない（`Date` の寛容な解釈に委ねない）。
  const parsed = new Date(head);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString() !== head) return null;
  return { lastMessageAt: parsed, id };
}

/** Zod の `refine` 用（境界で 400 にするための述語）。 */
export function isChatThreadCursor(value: string): boolean {
  return decodeChatThreadCursor(value) !== null;
}

/**
 * 🔴 **並び（`last_message_at DESC NULLS LAST, id DESC`）における「カーソル行より後ろ」**を表す述語。
 *
 * ⚠️ これは**境界（誰に見えるか）の条件ではない**。母集団は RLS の C6 が決める（`read.ts` の 🔴 ①）。
 *    ここに在るのは**順序の中の位置**だけであり、`tenant_id` / `partner_company_id` を 1 つも含まない
 *    （含めたら二重に境界を書いたことになる）。
 *
 * 場合分けは 2 つだけである:
 *   - カーソルが**発言あり**… ①より古い更新 ②同じ更新で `id` が小さい ③**発言なし**（並びで必ず後ろ）
 *   - カーソルが**発言なし**… 発言なしのうち `id` が小さいものだけ（それより後ろは存在しない）
 */
/**
 * 1 つの枝。🔴 Prisma の `WhereInput` は `OR` に**可変配列**を要求するため、
 *    配列そのものは `readonly` にしない（各枝の中身は `readonly` のまま）。
 */
export type ChatThreadCursorClause =
  | { readonly lastMessageAt: { readonly lt: Date } }
  | { readonly lastMessageAt: Date; readonly id: { readonly lt: string } }
  | { readonly lastMessageAt: null }
  | { readonly lastMessageAt: null; readonly id: { readonly lt: string } };

export type ChatThreadCursorWhere = { readonly OR: ChatThreadCursorClause[] };

export function chatThreadCursorWhere(cursor: ChatThreadCursor): ChatThreadCursorWhere {
  if (cursor.lastMessageAt === null) {
    return { OR: [{ lastMessageAt: null, id: { lt: cursor.id } }] };
  }
  return {
    OR: [
      { lastMessageAt: { lt: cursor.lastMessageAt } },
      { lastMessageAt: cursor.lastMessageAt, id: { lt: cursor.id } },
      { lastMessageAt: null },
    ],
  };
}
