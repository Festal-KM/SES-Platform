// packages/domain/src/usage/usd.ts
// 🔴 USD の十進文字列 ↔ 整数（micro-USD）の相互変換。金額を扱う計算の**唯一の土台**。T-07-04。
//
// ============================================================================
// 🔴 なぜ `number` を経由しないのか
// ============================================================================
// 本プロダクトの金額は請求根拠（`CLAUDE.md` §10.2 / `F-063`）であり、`0.1 + 0.2` の世界で
// 積んではならない。DB 側は `Decimal(20,6)`（`usage_counters`）と `Decimal(12,6)`（`ai_usage`）で
// あり、**最小単位は 1 micro-USD** である。したがってアプリ側も micro-USD の `bigint` で計算し、
// 境界（SQL / 記録）でだけ十進文字列に戻す。
//
// 🔴 `packages/domain/src/ai/pricing.ts`（単価 × トークン数 → USD）と、コスト上限の判定
//    （`packages/domain/src/quota/ai-cost.ts`）と、予約・補正（`packages/db`）が**同じ変換**を使う。
//    3 箇所に書き分けると、丸めの向きが 1 箇所だけずれても誰も気づけない。

/** 1 USD = 1,000,000 micro-USD（`Decimal(_,6)` の刻みと一致する）。 */
export const USD_MICRO_SCALE = 1_000_000n;

/** 🔴 SQL へ渡す前・SQL から読んだ後の門番（`NaN` / 指数表記 / 桁あふれを止める）。 */
const USD_PATTERN = /^-?\d{1,20}(\.\d{1,6})?$/;

/**
 * 十進文字列 → micro-USD（整数）。
 *
 * 🔴 書式が不正なら `RangeError` にする。**0 として扱わない** —— 金額の欠損は
 *    「使ったのに請求できない」「上限が効かない」のどちらかに直結する。
 */
export function parseUsdMicros(value: string): bigint {
  if (!USD_PATTERN.test(value)) {
    throw new RangeError(
      `USD の書式が不正です（${value}）。整数部 20 桁・小数部 6 桁までの十進数で渡してください。`,
    );
  }
  const negative = value.startsWith('-');
  const [whole = '0', fraction = ''] = (negative ? value.slice(1) : value).split('.');
  const micros = BigInt(whole) * USD_MICRO_SCALE + BigInt(fraction.padEnd(6, '0'));
  return negative ? -micros : micros;
}

/**
 * micro-USD（整数）→ 十進文字列（`Decimal(_,6)` にそのまま入る形）。
 *
 * 🔴 常に小数 6 桁で返す（`'0.000000'`）。桁を詰めると、DB に入れた値と読み出した値の
 *    文字列比較がテストごとに揺れる。
 */
export function formatUsdMicros(micros: bigint): string {
  const negative = micros < 0n;
  const absolute = negative ? -micros : micros;
  const whole = absolute / USD_MICRO_SCALE;
  const fraction = (absolute % USD_MICRO_SCALE).toString().padStart(6, '0');
  return `${negative ? '-' : ''}${whole.toString()}.${fraction}`;
}
