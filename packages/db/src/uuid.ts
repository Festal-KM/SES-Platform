// packages/db/src/uuid.ts
// 🔴 主キーの値をアプリ側で採番する必要がある経路のためだけの UUID v7 生成器（RFC 9562 §5.7）。
//
// 🔴 なぜ要るか（docs/05 §5.2 / migration 20260904010000 §5）:
//    `app_platform_write` は `invitations` / `tenant_sending_domains` に **`INSERT` だけ**を
//    持ち `SELECT` を持たない。したがって `INSERT ... RETURNING`（Prisma の `create()`）は
//    使えず `createMany()`（RETURNING 無し）で書くしかない。**採番された ID を読み返せない**ため、
//    `account.mail` の `targetId`（招待 ID）を渡すには**書く前に ID を決めておく**必要がある。
//    テナント（API-A4）も同じで、`withPlatformWrite` は `SET LOCAL app.target_tenant_id` を
//    トランザクションの先頭で発行するため、テナント ID は書く前に確定していなければならない。
//
// 🔴 v4（`crypto.randomUUID()`）を使わない理由: スキーマの全 ID は `@default(uuid(7))` であり、
//    時系列に単調増加することを前提に**カーソルページング**（docs/05 §6.1。`orderBy` の
//    タイブレークに ID を使う）と B-tree の局所性が設計されている。同じ表に v4 が混ざると
//    その前提が静かに崩れる。
import { randomFillSync } from 'node:crypto';

const HEX = '0123456789abcdef';

function toHex(bytes: Uint8Array): string {
  let out = '';
  for (const byte of bytes) {
    out += HEX[(byte >> 4) & 0x0f];
    out += HEX[byte & 0x0f];
  }
  return out;
}

/**
 * UUID v7 を 1 つ生成する（RFC 9562 §5.7）。
 *
 * レイアウト: 48 bit の Unix ミリ秒 + 4 bit のバージョン（7）+ 12 bit の乱数
 *           + 2 bit のバリアント（0b10）+ 62 bit の乱数。
 *
 * @param at 埋め込むタイムスタンプ。🔴 既定を持たせず**必ず呼び出し側が渡す**
 *           （ジョブ・結合テストが決定的な値を使えるようにするため）。
 */
export function uuidV7(at: Date): string {
  const milliseconds = at.getTime();
  if (!Number.isFinite(milliseconds)) {
    throw new RangeError('uuidV7: 不正な日時が渡されました。');
  }
  if (milliseconds < 0 || milliseconds > 0xffff_ffff_ffff) {
    throw new RangeError('uuidV7: タイムスタンプが 48 bit に収まりません。');
  }

  const bytes = new Uint8Array(16);
  randomFillSync(bytes);

  // 上位 48 bit = Unix ミリ秒（ビッグエンディアン）。
  const high = Math.floor(milliseconds / 0x1_0000_0000); // 上位 16 bit
  const low = milliseconds >>> 0; // 下位 32 bit
  bytes[0] = (high >>> 8) & 0xff;
  bytes[1] = high & 0xff;
  bytes[2] = (low >>> 24) & 0xff;
  bytes[3] = (low >>> 16) & 0xff;
  bytes[4] = (low >>> 8) & 0xff;
  bytes[5] = low & 0xff;

  // バージョン 7 / バリアント 0b10（残りのビットは乱数のまま）。
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x70;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;

  const hex = toHex(bytes);
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20, 32),
  ].join('-');
}

const UUID_HEX_LENGTH = 32;
/** バージョン桁の位置（レイアウトの 7 バイト目の上位ニブル）。 */
const VERSION_NIBBLE_INDEX = 12;
/** 上位 48 bit（= 12 桁）が Unix ミリ秒。 */
const TIMESTAMP_HEX_LENGTH = 12;

/**
 * UUID v7 に埋め込まれた生成時刻を取り出す（RFC 9562 §5.7 の上位 48 bit）。v7 でなければ `null`。
 *
 * 🔴 **「作成時刻の列」の代わりに使ってよい場面は限られる。** 使ってよいのは、
 *    docs/05 §3 のスキーマに作成時刻の列が無く、かつ**その行の ID が `@default(uuid(7))` で
 *    採番されている**表だけである（本リポジトリの全 ID がそれである。本ファイル冒頭の 🔴）。
 *    docs/05 §16.5 が `email_dispatches` の滞留判定で「`updated_at`（無ければ `id` の uuidv7 時刻）」
 *    と定めているのと同じ扱いであり、**列を勝手に足さない**ための読み替えである。
 *    ⚠️ 逆に、列がある表でこれを使わない（列の値が正であり、ID は採番の順序でしかない）。
 */
export function uuidV7TimeOf(value: string): Date | null {
  const hex = value.replace(/-/g, '').toLowerCase();
  if (hex.length !== UUID_HEX_LENGTH || !/^[0-9a-f]+$/.test(hex)) return null;
  if (hex[VERSION_NIBBLE_INDEX] !== '7') return null;
  const milliseconds = Number.parseInt(hex.slice(0, TIMESTAMP_HEX_LENGTH), 16);
  return Number.isFinite(milliseconds) ? new Date(milliseconds) : null;
}
