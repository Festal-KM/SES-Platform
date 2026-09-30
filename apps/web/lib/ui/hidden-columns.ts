// apps/web/lib/ui/hidden-columns.ts
// 🔴 **列表示切替の状態（どの列を外しているか）を URL のクエリで持つ**（SP-22 `T-22-06`）。
//
// ============================================================================
// 🔴 なぜクライアントの状態にしないのか
// ============================================================================
// 一覧の器（`DataTable`）は**サーバコンポーネント**である（`docs/05` §2.3.5 / `T-22-04`
// 受け入れ基準 3）。`useState` で持つと ①再読込・戻るで消える ②URL を共有した相手と
// 見え方が違う ③器をクライアントへ移す圧力になる、の 3 つが同時に起きる。
// 検索条件が `<form method="get">` で URL に載るのと**同じ規律**で扱う。
//
// ============================================================================
// 🔴 クエリの形（**次の一覧もこの形を使う**。`A-002` が 9 列で控えている）
// ============================================================================
//   `?hide=<列 id>[,<列 id>...]`      例: `/projects?hide=visibility`
//
//   - 名前は **`hide`**（1 つ。`hide_visibility=1` のような列ごとのキーにしない —— 列が増えると
//     クエリのキーが増え、URL から「何を外しているか」が読めなくなる）。
//   - 値は**列 id のカンマ区切り**。🔴 **並びは呼び出し側が渡した許可リストの順に正規化する**
//     （押した順で URL が変わると、同じ見え方に複数の URL が対応してしまう）。
//   - 🔴 **許可リストに無い値・重複は捨てる**（URL 直打ちで存在しない列を渡されても壊れない）。
//   - 🔴 **API に渡さない。** 列の表示・非表示は**表示の話**であり、取得する項目は変わらない
//     （`projectListQuerySchema` はこのキーを持たず、Zod の既定（strip）で無視される）。
// 🔴 **このファイルは I/O を持たない純粋関数だけである**（`app/**` に置くとユニットテストの
//    対象外になるため `lib/**` に置く。`lib/projects/list-rows.ts` 冒頭と同じ理由）。

/** クエリのキー。🔴 画面ごとに違う名前を作らない（1 箇所で持つ）。 */
export const HIDDEN_COLUMNS_PARAM = 'hide';

/** 値の区切り（`hide=a,b`）。 */
const SEPARATOR = ',';

/**
 * URL のクエリ値 → 隠す列の集合。
 *
 * 🔴 **許可リスト（`hideable` を持つ列の id）だけを通し、その並びに正規化する。**
 * ⚠️ `string[]`（`?hide=a&hide=b`）でも受ける —— Next.js の `searchParams` は同名のキーが
 *    複数あると配列で届くため、片方を黙って捨てない。
 */
export function parseHiddenColumns<Id extends string>(
  raw: string | readonly string[] | undefined,
  allowed: readonly Id[],
): readonly Id[] {
  if (raw === undefined) return [];
  const values = new Set(
    (typeof raw === 'string' ? [raw] : raw)
      .flatMap((value) => value.split(SEPARATOR))
      .map((value) => value.trim())
      .filter((value) => value !== ''),
  );
  // 🔴 許可リストの順に並べ替える（同じ見え方が常に同じ URL になる）。
  return allowed.filter((id) => values.has(id));
}

/**
 * 1 列の表示 / 非表示を反転した集合を返す。
 * 🔴 並びは `allowed` の順（`parseHiddenColumns` と同じ正規化）。
 */
export function toggleHiddenColumn<Id extends string>(
  hidden: readonly Id[],
  allowed: readonly Id[],
  columnId: Id,
): readonly Id[] {
  const next = new Set(hidden.filter((id) => allowed.includes(id)));
  if (next.has(columnId)) {
    next.delete(columnId);
  } else if (allowed.includes(columnId)) {
    next.add(columnId);
  }
  return allowed.filter((id) => next.has(id));
}

/**
 * クエリに載せる値（隠す列が無ければ `null` = キーそのものを載せない）。
 * 🔴 **`?hide=` の空値を作らない**（「何も隠していない」は既定であり、URL に痕跡を残さない）。
 */
export function hiddenColumnsParamValue<Id extends string>(hidden: readonly Id[]): string | null {
  return hidden.length === 0 ? null : hidden.join(SEPARATOR);
}
