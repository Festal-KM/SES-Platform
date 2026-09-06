// apps/web/lib/format/db-values.ts
// DB の列の値（`Decimal` / `@db.Date`）と API / 画面が扱う素の値の相互変換。T-06-01。
//
// 🔴 **T-05-01 で `lib/engineers/service.ts` に置いた 2 関数（`decimalToNumber` / `toIsoDay`）を
//    ここへ移した**（T-06-01）。案件（`lib/projects/service.ts`）も同じ変換を必要とし、
//    「エンジニアのサービスから案件のサービスが import する」形にすると、機能モジュール間に
//    意味の無い依存が生まれる（後で片方を消せなくなる）。**変換規則は 1 つしか無いので、
//    置き場所も 1 つにする** —— 2 本になると単価と日付の見え方が画面ごとにずれる。
//
// 🔴 `@prisma/client` を import しない（ESLint が禁じる。`CLAUDE.md` §3.1）。`Decimal` は
//    `toString()` だけを要求する構造的な型で受ける。

/**
 * Prisma の `Decimal` を数値にする。
 * 🔴 `null` は `null` のまま返す（0 に畳まない —— 「未設定」と「0 円」は別である）。
 */
export function decimalToNumber(value: { toString(): string } | null): number | null {
  return value === null ? null : Number(value.toString());
}

/**
 * 🔴 **`@db.Date` の列専用**の変換（`available_from` / `start_date` など、そもそも時刻を持たない列）。
 *    Prisma は `date` 列を UTC 深夜の `Date` として読み出すため、**UTC で切り出すのが正確**であり、
 *    TZ 変換を掛けると日付が 1 日ずれる。
 *
 * 🔴 **タイムスタンプ（`updated_at` など）には使わない。** 「日単位に丸めた更新日」
 *    （`S-005` の `updatedOn`）は **JST の暦日**であり、`lib/format/datetime.ts` の
 *    `toJstIsoDay` が持つ。**date-only 列とタイムスタンプでは「丸め」の意味が別物である。**
 */
export function toIsoDay(value: Date): string {
  return value.toISOString().slice(0, 10);
}

/** `@db.Date` の値を `YYYY-MM-DD` にする（`null` は `null`）。 */
export function toDateOnlyString(value: Date | null): string | null {
  return value === null ? null : toIsoDay(value);
}

/**
 * `YYYY-MM-DD` を `@db.Date` に渡す値にする（`null` は `null`）。
 * 🔴 オーバーロードを置くのは、**検索条件（`gte`）が `null` を受け付けない**ためである
 *    （`lib/projects/list.ts` の `startFrom`）。実装は 1 つのまま、
 *    「`null` を渡していない呼び出しは `Date` が返る」ことを型で示す。
 */
export function toDateOnly(value: string): Date;
export function toDateOnly(value: string | null): Date | null;
export function toDateOnly(value: string | null): Date | null {
  return value === null ? null : new Date(`${value}T00:00:00.000Z`);
}
