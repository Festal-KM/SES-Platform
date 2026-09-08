// packages/ai/src/retry.ts
// 🔴 再試行の可否と待ち時間を決める純粋関数（docs/05 §7.4 / docs/02 章 8.7）。
//
// 🔴 **LLM の再試行は `runRole` の内部だけで行う。** ジョブ側では再試行しない
//    （ロールジョブは `attempts: 1`）。ジョブごと再実行すると `AiUsage` が二重に積まれ、
//    原価が実態より多く見える（`F-026 AC-1` の「呼び出し 1 回につき 1 件」が崩れる）。

import type { AiUsageFailureKind } from '@ses/domain';

/** 🔴 初回 + 再試行 2 回 = 合計 3 回（docs/05 §7.4）。設定値にしない。 */
export const MAX_LLM_ATTEMPTS = 3;

/** バックオフの基準（1s → 4s）。ジッタは ±20%（docs/05 §7.4）。 */
export const RETRY_BACKOFF_MS = [1000, 4000] as const;
export const RETRY_JITTER_RATIO = 0.2;

export type RetryDecision =
  | { readonly retry: false }
  | { readonly retry: true; readonly delayMs: number };

export type RetryInput = {
  readonly kind: AiUsageFailureKind;
  /** 失敗した試行の番号（1 始まり）。 */
  readonly attemptNo: number;
  /** 429 の `retry-after`（ミリ秒）。あればバックオフとの**大きい方**を採る。 */
  readonly retryAfterMs?: number;
  /** ジッタ用。0〜1 の一様乱数（テストでは固定値を注入する）。 */
  readonly random: number;
};

/**
 * 🔴 再試行してよい失敗（docs/05 §7.4 / docs/03 §3.3.4-3）:
 *   - `SCHEMA`  … 応答を破棄して**同一プロンプトで**やり直す（自由文を正規表現で救わない）
 *   - `TIMEOUT` … タイムアウト / 5xx
 *   - `RATE`    … 429（`retry-after` あり）
 * 🔴 再試行しない:
 *   - `SPEND_CAP` … 月間支出上限。再試行しても必ず同じ結果になり、原価だけが増える
 *   - `API`       … 400 / 401。人間の対応が要る
 */
function isRetryableKind(kind: AiUsageFailureKind): boolean {
  return kind === 'SCHEMA' || kind === 'TIMEOUT' || kind === 'RATE';
}

export function decideRetry(input: RetryInput): RetryDecision {
  if (input.attemptNo >= MAX_LLM_ATTEMPTS) return { retry: false };
  if (!isRetryableKind(input.kind)) return { retry: false };

  // 🔴 スキーマ違反は待っても直らない（サーバ側の混雑ではない）。即座にやり直す。
  if (input.kind === 'SCHEMA') return { retry: true, delayMs: 0 };

  const base = RETRY_BACKOFF_MS[Math.min(input.attemptNo, RETRY_BACKOFF_MS.length) - 1] ?? 0;
  // random ∈ [0,1) → 係数 ∈ [0.8, 1.2)
  const jittered = Math.round(base * (1 - RETRY_JITTER_RATIO + 2 * RETRY_JITTER_RATIO * input.random));
  const delayMs = Math.max(jittered, input.retryAfterMs ?? 0);
  return { retry: true, delayMs };
}
