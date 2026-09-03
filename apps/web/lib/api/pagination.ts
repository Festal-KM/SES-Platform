// apps/web/lib/api/pagination.ts
// docs/05 §6.1「ページング: カーソル方式。`?cursor=&limit=`（既定 50、最大 200）。
// `total` は境界適用後の `COUNT`」/ §4.8「見えない ＝ 存在しない」。T-03-04（SP-03）。
//
// 🔴 なぜオフセットではなくカーソルか（`F-004 AC-4` に直結する）:
//    オフセットページングは「何件目か」を入力に取る。境界の外の行が母集団に混ざっていると
//    ページの中身がずれるため、**ずれ方から他社の行の存在を推測できる**。カーソルは
//    「最後に見た行の次から」であり、他社の行は母集団に存在しないので影響しない。
//
// 🔴 `total` / 並び順の規律（docs/05 §4.8）:
//    - `total` は**一覧と同じ `where`** の `COUNT` である（別のクエリで数え直さない）。
//    - `ORDER BY` に「全体件数」「順位」を持ち込まない。境界外の行の有無で順位が動くと、
//      並び順そのものが他社の存在を漏らす。
//    - 「他にも N 件あります」「あなたは N 番目」に相当するフィールドを型に持たない。
import { PAGE_CURSOR_MAX_LENGTH, PAGE_SIZE_DEFAULT, PAGE_SIZE_MAX } from '@ses/config';
import { z } from 'zod';
import { assertNoIsolationKeys, type AssertNoIsolationKeys } from './isolation-keys';

/**
 * 一覧 API 共通のクエリ（docs/05 §6.1）。各ルートは `.extend()` して絞り込み条件を足す。
 *
 * 🔴 `limit` が上限を超えたら **400**（黙って 200 に丸めない）。丸めると
 *    「返ってきた件数が要求と違う」ことの理由が利用者にもログにも残らない。
 */
export const cursorPageQuerySchema = z.object({
  cursor: z.string().trim().min(1).max(PAGE_CURSOR_MAX_LENGTH).optional(),
  // クエリ文字列は常に文字列で届くため coerce する。未指定なら既定値。
  limit: z.coerce.number().int().min(1).max(PAGE_SIZE_MAX).default(PAGE_SIZE_DEFAULT),
});

export type CursorPageQuery = z.infer<typeof cursorPageQuerySchema>;

/** 🔴 分離キーが混入したらコンパイルエラーになる。 */
export type CursorPageQueryIsolationGuard = AssertNoIsolationKeys<CursorPageQuery>;

assertNoIsolationKeys(Object.keys(cursorPageQuerySchema.shape), 'cursorPageQuerySchema');

/**
 * 一覧応答の共通形。
 * 🔴 `total` は**任意**である。持つ場合は必ず一覧と同じ `where` の `COUNT` にする
 *    （docs/05 §4.8）。持たない一覧に「概数」を足さない。
 */
export type CursorPage<T> = {
  readonly items: readonly T[];
  /** 次ページが無ければ `null`。🔴 残件数は返さない（境界外の存在を漏らさないため）。 */
  readonly nextCursor: string | null;
};

/**
 * Prisma の `take` に渡す件数（+1 件多く読む）。
 * 🔴 「次ページがあるか」を `COUNT` ではなく **1 件多く読む**ことで判定する。
 *    別クエリで数えると、`where` を書き分ける隙ができる（境界の適用漏れの温床）。
 */
export function takeForCursorPage(limit: number): number {
  return limit + 1;
}

/**
 * `takeForCursorPage(limit)` 件読んだ行から 1 ページ分を切り出す。
 * `toCursor` は「その行の次から」を表す不透明な文字列を作る（通常は行の ID）。
 */
export function buildCursorPage<T>(
  rows: readonly T[],
  limit: number,
  toCursor: (row: T) => string,
): CursorPage<T> {
  const hasNext = rows.length > limit;
  const items = hasNext ? rows.slice(0, limit) : [...rows];
  const last = items[items.length - 1];
  return {
    items,
    nextCursor: hasNext && last !== undefined ? toCursor(last) : null,
  };
}
