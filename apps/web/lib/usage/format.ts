// apps/web/lib/usage/format.ts
// `S-038` 利用量と上限（docs/04 §S-038 / `F-027 AC-6`）の表示用の単位換算。T-10-04。
//
// 🔴 純粋関数だけを置く（`@ses/db` / Next.js に依存しない）。`UsageView`（`./view.ts`）の値を
//    「件数 / 通数 / GB / 人」の見え方に変えるだけであり、金額の換算はここに**存在しない**
//    （唯一の金額 `overageEstimateJpy` は円の文字列をそのまま 3 桁区切りにするだけで、単価も為替も持たない）。
// 🔴 `toLocaleString` を使わない（`lib/format/number.ts` と同じ理由。サーバ描画とクライアント描画で
//    桁区切りがずれる）。バイト数は `bigint` で受ける（`Number` の安全整数を超えうる）。
import { formatThousands } from '../format/number';

const GIB = 1024n * 1024n * 1024n;

/** 文字列（`UsageView.storage.*` は `bigint` を JSON に載せるため文字列）または `bigint` を `bigint` に揃える。 */
function toBigInt(value: bigint | string): bigint {
  if (typeof value === 'bigint') return value;
  if (!/^\d+$/.test(value)) {
    throw new RangeError(`バイト数の文字列が不正です（${value}）。`);
  }
  return BigInt(value);
}

/**
 * バイト数を GB（GiB。小数 1 桁）で表す。単位の語は呼び出し側が `packages/i18n` から渡す。
 * 例: 12.3
 */
export function formatGigabytes(bytes: bigint | string): string {
  const tenths = (toBigInt(bytes) * 10n) / GIB;
  const whole = tenths / 10n;
  const fraction = tenths % 10n;
  return `${formatThousands(Number(whole))}.${fraction.toString()}`;
}

/**
 * 使用率（%。整数に切り捨て）。🔴 上限を超えていれば 100 を超える値をそのまま返す（従量に移行した
 * 件数クォータは「120%」と読める方が正しい。100 で頭打ちにするのは描画側のバーの幅だけ）。
 * 上限が 0 以下なら 0（表示で例外を出さない。判定は `packages/domain` が別に行う）。
 */
export function percentUsed(used: bigint | number, limit: bigint | number): number {
  const usedBig = typeof used === 'bigint' ? used : BigInt(Math.trunc(used));
  const limitBig = typeof limit === 'bigint' ? limit : BigInt(Math.trunc(limit));
  if (limitBig <= 0n || usedBig <= 0n) return 0;
  return Number((usedBig * 100n) / limitBig);
}

/** バーの幅に使う値（0〜100 に丸める）。 */
export function clampPercent(percent: number): number {
  if (!Number.isFinite(percent) || percent < 0) return 0;
  return percent > 100 ? 100 : Math.trunc(percent);
}

export type RemainingLabels = {
  /** 例: 「あと」 */
  readonly prefix: string;
  /** 例: 「件」「通」 */
  readonly unit: string;
};

/**
 * 「あと 62 件 / 180 件」の形（docs/04 §S-038 の表）。
 * 🔴 残量が 0（使い切り）でも「あと 0 件 / 180 件」と出す —— 0 を隠すと使い切ったことが読めない。
 */
export function formatRemaining(remaining: number, quota: number, labels: RemainingLabels): string {
  return `${labels.prefix} ${formatThousands(remaining)} ${labels.unit} / ${formatThousands(quota)} ${labels.unit}`;
}

/** 「118 / 500 通」の形（使用 / 上限）。 */
export function formatUsedOfLimit(used: number, limit: number, unit: string): string {
  return `${formatThousands(used)} / ${formatThousands(limit)} ${unit}`;
}

/**
 * 請求見込み（円）。`UsageView.overageEstimateJpy` は整数の文字列（`null` は「算出できない」で、ここには来ない）。
 * 🔴 整数の文字列でなければそのまま返す（握りつぶさず、原因が追える形で表示に出す。`formatDateTimeJst` と同じ）。
 */
export function formatJpy(value: string, unit: string): string {
  if (!/^-?\d+$/.test(value)) return `${value} ${unit}`;
  return `${formatThousands(Number(value))} ${unit}`;
}
