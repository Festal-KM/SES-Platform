// packages/domain/src/quota/limit-level.ts
// 🔴 上限に対する「接近 / 到達」の水準と、その遷移（docs/02 `F-027` 処理④⑤ / 章 7.7「上限接近時」/
//    `F-027 AC-4`「80% に達した時点で通知」）。T-10-03。
//
// ============================================================================
// 🔴 水準は 3 値。単位（件数 / バイト / micro-USD）を問わず同じ式で決める
// ============================================================================
// 「80%」は `packages/config` の `QUOTA_WARNING_THRESHOLD_PERCENT` から渡される（ここに書かない）。
// 到達（`REACHED`）の意味は上限の種類ごとに違う（停止 / 従量へ移行 / アップロード停止。`limits.ts`）が、
// **「いつ通知するか」の閾値の計算だけは 1 実装**にする —— 単位ごとに「80%」の計算を書き分けると、
// 端数の丸め方が揺れて「片方の単位だけ 79.6% で通知される」ことになる。
//
// 🔴 `bigint` で受ける。バイト数は `Number` の安全整数を超えうる（`decideStorageUpload` と同じ理由）。
//    件数・micro-USD は呼び出し側が `BigInt()` で持ち上げる（1 実装のために型を揃える）。

/**
 * 🔴 `usage_limit_states.level` の CHECK 値集合（migration 20260920000000）と**同一の文字列**。
 *    `tests/static/schema-enum-drift.test.ts` が突合する。
 */
export const USAGE_LIMIT_LEVELS = ['BELOW', 'NEARING', 'REACHED'] as const;

export type UsageLimitLevel = (typeof USAGE_LIMIT_LEVELS)[number];

export type LimitLevelInput = {
  readonly used: bigint;
  readonly limit: bigint;
  /** 接近の閾値（%）。`QUOTA_WARNING_THRESHOLD_PERCENT`（1〜99）。 */
  readonly warnPercent: number;
};

function rank(level: UsageLimitLevel): number {
  return USAGE_LIMIT_LEVELS.indexOf(level);
}

/**
 * 🔴 水準の判定（純粋関数）。
 *
 * - `REACHED`: `used >= limit`（枠を使い切った。**超えたかどうかではない** —— 使い切った時点で
 *   次の 1 件は通らない（メール / 件数）か従量になる（AI 件数）ので、利用者に伝えるのはこの時点である）
 * - `NEARING`: `used × 100 >= limit × warnPercent`（整数演算。浮動小数点の比率を作らない）
 * - `BELOW`: それ以外
 */
export function decideLimitLevel(input: LimitLevelInput): UsageLimitLevel {
  if (input.limit <= 0n) {
    throw new RangeError(`limit は 1 以上である必要があります（受け取った値: ${input.limit}）。`);
  }
  if (input.used < 0n) {
    throw new RangeError(`used は 0 以上である必要があります（受け取った値: ${input.used}）。`);
  }
  if (!Number.isInteger(input.warnPercent) || input.warnPercent < 1 || input.warnPercent > 99) {
    throw new RangeError(
      `warnPercent は 1〜99 の整数である必要があります（受け取った値: ${input.warnPercent}）。`,
    );
  }
  if (input.used >= input.limit) return 'REACHED';
  if (input.used * 100n >= input.limit * BigInt(input.warnPercent)) return 'NEARING';
  return 'BELOW';
}

/**
 * 水準の遷移の種別。
 *
 * - `RAISED`: 上がった（`BELOW → NEARING` / `NEARING → REACHED` / `BELOW → REACHED`）。通知の契機。
 * - `RELEASED`: 🔴 **到達が解けた**（`REACHED → NEARING | BELOW`）。監査ログ「解除」の契機。
 * - `LOWERED`: 接近が解けた（`NEARING → BELOW`）。記録しない（到達していないので「解除」ではない）。
 * - `UNCHANGED`: 変化なし。**何もしない**（1 日に何度評価しても通知・記録が増えない根拠）。
 *
 * 🔴 `previous === null`（初回評価）は `BELOW` からの遷移とみなす。既に上限に達したテナントで
 *    本機能を有効にしたとき、最初の評価で「到達」が記録・通知される（黙って `REACHED` 行だけを
 *    作らない。`BR-24`「黙って劣化させない」）。
 */
export type LimitLevelTransition = 'UNCHANGED' | 'RAISED' | 'LOWERED' | 'RELEASED';

export function decideLimitTransition(
  previous: UsageLimitLevel | null,
  next: UsageLimitLevel,
): LimitLevelTransition {
  const from = previous ?? 'BELOW';
  if (from === next) return 'UNCHANGED';
  if (rank(next) > rank(from)) return 'RAISED';
  if (from === 'REACHED') return 'RELEASED';
  return 'LOWERED';
}
