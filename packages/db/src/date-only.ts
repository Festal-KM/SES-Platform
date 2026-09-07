// packages/db/src/date-only.ts
// `@db.Date`（時刻を持たない列）に渡す値の組み立て。T-06-05。
//
// 🔴 **T-06-01 で `apps/web/lib/format/db-values.ts` に置いていた `toDateOnly` をここへ移した**
//    （T-06-05）。理由は 1 つ: **検索条件の評価が `packages/db/src/search/**` へ移った**ため、
//    同じ変換が `apps/web`（書き込み経路の `startDate` / `availableFrom`）と
//    `packages/db`（検索の述語）の両方から要る。2 本に分けると、
//    「検索は UTC 深夜、書き込みは JST 深夜」のようなずれが後から入りうる。
//    `apps/web` 側は本関数を re-export するだけにしてある（既存の import 先は変わらない）。
//
// 🔴 読み出し側の変換（`Date` → `YYYY-MM-DD`）は `apps/web` に残す。あちらは**表示の丸め**であり、
//    JST の暦日に丸める `toJstIsoDay`（タイムスタンプ用）と対で意味を持つ（`db-values.ts` の注記）。

/**
 * `YYYY-MM-DD` を `@db.Date` に渡す値にする（`null` は `null`）。
 *
 * 🔴 **UTC 深夜として組み立てる。** Prisma は `date` 列を UTC 深夜の `Date` として読み書きするため、
 *    ここで TZ 変換を掛けると日付が 1 日ずれる（読み出し側 `toIsoDay` の JSDoc と対）。
 * 🔴 オーバーロードを置くのは、**検索条件（`gte` / `lte`）が `null` を受け付けない**ためである。
 *    実装は 1 つのまま、「`null` を渡していない呼び出しは `Date` が返る」ことを型で示す。
 */
export function toDateOnly(value: string): Date;
export function toDateOnly(value: string | null): Date | null;
export function toDateOnly(value: string | null): Date | null {
  return value === null ? null : new Date(`${value}T00:00:00.000Z`);
}
