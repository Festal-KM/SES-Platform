// apps/web/lib/format/datetime.ts
// 日時表示の共通フォーマッタ（S-002 招待の有効期限と、S-046 でトークン期限を出す場合の
// 共通の出所。`CLAUDE.md` §8.7 の申し送り解消）。
//
// 🔴 以前の `formatExpiresAt`（invite-form.tsx にあった）は `Date#getFullYear()` 等の
//    ローカル TZ ゲッターで組み立てており、**実行環境（SSR はサーバの OS 設定、
//    CSR はブラウザの設定）の暗黙のローカル TZ に依存していた**。サーバとブラウザで TZ が
//    異なるとハイドレーション不整合になり得るうえ、利用者からは「どちらの時刻か」が
//    分からない表示になる。**明示的に JST へ固定し、末尾に `JST` を付す**ことで、
//    実行環境の設定に関係なく常に同じ文字列を描画する（挙動そのものは変えない）。
const JST_FORMATTER = new Intl.DateTimeFormat('ja-JP', {
  timeZone: 'Asia/Tokyo',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});

function part(parts: readonly Intl.DateTimeFormatPart[], type: Intl.DateTimeFormatPartTypes): string {
  return parts.find((entry) => entry.type === type)?.value ?? '';
}

/**
 * ISO 8601 の日時文字列を `YYYY-MM-DD HH:MM JST` の形に変換する。
 * 🔴 解析に失敗した値はそのまま返す（握りつぶさず、原因が追える形で表示に出す）。
 */
export function formatDateTimeJst(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  const parts = JST_FORMATTER.formatToParts(date);
  const year = part(parts, 'year');
  const month = part(parts, 'month');
  const day = part(parts, 'day');
  const hour = part(parts, 'hour');
  const minute = part(parts, 'minute');
  return `${year}-${month}-${day} ${hour}:${minute} JST`;
}
