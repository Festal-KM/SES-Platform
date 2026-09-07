// apps/web/lib/api/query-filters.ts
// 一覧 API / 検索フォームの query に共通する前処理（docs/05 §6.1 / §6.4 #15 / #25）。T-06-04。
//
// 🔴 **T-06-03 が `lib/projects/schemas.ts` に置いた `optionalFilter` をここへ移した。**
//    T-06-04 で `S-005`（人材台帳）にも同じ形の検索フォームが入り、**同じ前処理が 2 本になると
//    片方だけが空文字を畳まなくなる**（＝ 一方の検索フォームだけが「条件を入れずに検索」で
//    400 になる）。前処理の規則は 1 つしか無いので、置き場所も 1 つにする
//    （`lib/format/db-values.ts` を作ったときと同じ判断）。
//
// 🔴 ここに**業務の条件を書かない**。あくまで「ブラウザの素の `<form method="get">` が送る形」を
//    Zod が読める形に均すだけである。
import { z } from 'zod';

/**
 * 🔴 **空文字を「指定なし」に畳んでから検証する**（検索フォーム専用）。
 *
 * `S-005` / `S-010` の検索は素の `<form method="get">` である（`docs/04` §S-005 / §S-010
 * 「検索は同期」）。ブラウザは**未入力の欄も送る**ため、条件を 1 つも入れずに検索すると
 * `?q=&status=&prefecture=` が届く。畳まないと `min(1)` / `enum` / `coerce.number` が落ちて
 * **検索フォームの送信そのものが 400** になる（`Number('')` は `0` なので、
 * 数値の条件では「畳まないと 0 が指定されたことになる」という別の壊れ方もする）。
 * 🔴 空白だけの入力も同じ扱いにする（`'   '` を `%   %` として検索させない）。
 * 🔴 `.strict()` にはしない（未知キーの有無で応答が変わると、キーの存在を外から探れる。
 *    `engineers/schemas.ts` の注記と同じ）。
 */
export function optionalFilter<T extends z.ZodType>(schema: T) {
  return z.preprocess(
    (value) => (typeof value === 'string' && value.trim() === '' ? undefined : value),
    schema.optional(),
  );
}

/**
 * 🔴 **複数選択（`<select multiple>` / `?skills=A&skills=B`）を配列に均す。**
 *
 * `searchParamsToObject`（`withApiRoute`）は **1 個なら文字列・2 個以上なら配列**を返すため、
 * 「1 件だけ選んだ検索」と「2 件以上選んだ検索」でスキーマが変わってしまう。ここで必ず配列にする。
 * 🔴 空文字だけの要素は捨て、**残りが 0 件なら「指定なし」**（`undefined`）にする ——
 *    `<select multiple>` は未選択なら値を送らないが、`?skills=` を手で付けた URL も同じ扱いにする。
 */
export function optionalListFilter<T extends z.ZodType>(schema: T) {
  return z.preprocess((value) => {
    if (value === undefined || value === null) return undefined;
    const raw = Array.isArray(value) ? value : [value];
    const items = raw.filter((item) => typeof item === 'string' && item.trim() !== '');
    return items.length === 0 ? undefined : items;
  }, schema.optional());
}

/** チェックが入ったときにブラウザが送る値（`value="1"` を使うが、既存の URL も受ける）。 */
const CHECKED_VALUES: ReadonlySet<string> = new Set(['1', 'true', 'on']);

/**
 * 🔴 **チェックボックス（既定オフ）**（`F-009 AC-5` / `docs/02` A-03）。
 *
 * HTML のチェックボックスは**オフのときキーごと送らない**ので、`undefined` は必ずオフである。
 * 🔴 **未知の値もオフとして扱い、400 にしない。** ここで 400 にすると、値の綴りが変わった
 *    リンクを踏んだだけで検索フォーム全体が落ちる。加えて、この 2 つの絞り込みは
 *    **オフ = 候補を隠さない**側であり（`docs/02` A-03「一覧には出しつつ明示的なフィルタで絞る」）、
 *    判定に迷ったときは**候補が消えない側**へ倒すのが安全である
 *    （`limit` の上限超過を 400 にするのとは向きが逆になる —— あちらは「黙って件数が変わる」
 *    ことが問題であり、こちらは「黙って候補が消える」ことを避ける）。
 */
export function checkboxFilter() {
  return z.preprocess(
    (value) => typeof value === 'string' && CHECKED_VALUES.has(value.trim().toLowerCase()),
    z.boolean(),
  );
}
