// packages/ai/src/usage.ts
// 🔴 `AiUsage` の記録と、コスト上限ガードの**接続点（ポート）**（docs/05 §7.3 / §7.6）。
//
// ⚠️ 実装はここに置かない:
//    - `AiUsageRecorder` の実装（`ai_usage` への INSERT と `UsageCounter` の件数加算）… **T-07-03**
//    - `AiCostGuard` の実装（`reserveAiCost` / `settleAiCost`）… **T-07-04**
//    `packages/ai` は `@ses/db` に依存できない（CLAUDE.md §2.1）ため、実装は `apps/*` が
//    起動時に注入する。**ポートを必須にする**ことで「記録を経由しない呼び出し経路」が
//    型として存在しなくなる（docs/05 §7.3 の記録の強制手段 ①）。

import type { AiRole, AiUsageFailureKind, AiUsagePurpose } from '@ses/domain';
import type { AiTokenUsage } from './client.js';

/**
 * `ai_usage` の 1 行（docs/05 §3.8 / §7.3 手順 6）。
 *
 * 🔴 **試行 1 回につき 1 行**（成功・失敗の別を問わない）。再試行は `attemptNo` を増やして
 *    別の行にする（件数クォータには入らないが金額には計上される。docs/05 §7.6）。
 * 🔴 `estimatedCostUsd` は**ここに無い**。金額はトークン数とモデル ID から機械的に決まり、
 *    単価表を持つのは記録側（T-07-03 / T-07-04）である。`runRole` に単価表を持たせると、
 *    単価の更新箇所が 2 つになる（`docs/03` §3.3.1 の表と `packages/ai`）。
 */
export type AiUsageRecordInput = {
  readonly tenantId: string;
  readonly role: AiRole;
  readonly purpose: AiUsagePurpose;
  readonly modelId: string;
  readonly promptVersion: string;
  readonly targetType?: string;
  readonly targetId?: string;
  readonly tokens: AiTokenUsage;
  readonly attemptNo: number;
  readonly succeeded: boolean;
  /** 成功時は undefined。失敗時は必ず入る（`ai_usage_failure_kind_check` の 5 値）。 */
  readonly failureKind?: AiUsageFailureKind;
  readonly startedAt: Date;
  readonly finishedAt: Date;
};

/** 🔴 成功した呼び出しの「利用者に見せる件数」（docs/05 §7.6 の `ROLE_UNIT`）。 */
export type AiUnitCountInput = {
  readonly tenantId: string;
  readonly role: AiRole;
  /**
   * 検証済みの出力。`match-explainer` のように **1 リクエストで N 件**を数えるロールがあるため
   * 出力そのものを渡す（`ROLE_UNIT` の写像表は T-07-03 が持つ）。
   */
  readonly output: unknown;
  readonly occurredAt: Date;
};

/**
 * 🔴 記録を経由しない AI 呼び出し経路を作らないための必須ポート（`F-026 AC-1` / `AC-2`）。
 *
 * - `record` … 手順 6。**失敗したら throw する**（`runRole` は `ok: false` を返さず落ちる）。
 * - `countUnit` … 手順 6b。**`ok: true` のとき 1 呼び出しにつき 1 度だけ**呼ばれる。
 *   🔴 内部再試行では呼ばれない（再試行は件数に加算しない。金額にだけ計上する）。
 *   🔴 `gate-inspector` を件数の分母・分子に入れないのは**実装側の責務**である
 *   （記録しないのではなく見せ方の問題。`F-026 AC-6` / `F-027 AC-7`）。
 */
export type AiUsageRecorder = {
  /** @returns 記録した `AiUsage.id`（`Provenance.aiUsageIds` に積む）。 */
  record(input: AiUsageRecordInput): Promise<string>;
  countUnit(input: AiUnitCountInput): Promise<void>;
};

/**
 * コストの予約（手順 3）が成功したことの証拠。
 *
 * 🔴 中身の解釈は実装（T-07-04）に委ねる。`runRole` は受け取って `settle` にそのまま返すだけであり、
 *    **金額を `packages/ai` の側で保持・計算しない**（IEEE754 で金額を扱わないための徹底でもある）。
 */
export type AiCostReservation = {
  readonly handle: string;
};

/** 1 回の試行の実績（`settle` に渡す。`AiUsage` に積んだ行と 1:1）。 */
export type AiAttemptUsage = {
  readonly modelId: string;
  readonly tokens: AiTokenUsage;
};

/**
 * 🔴 テナント別の 1 日 AI コスト上限のガード（docs/05 §7.6 / `F-027`）。
 *
 * - `reserve` … 🔴 **呼び出しの前**に見積りで予約する。予約できなければ
 *   `AiCostLimitExceededError` を throw し、**外部呼び出しは 0 回**になる。
 *   🔴 上限の対象は 6 ロールすべて（`gate-inspector` を含む）。「上限到達時に
 *   `gate-inspector` をスキップして PASS にする」分岐は存在しない（docs/05 §7.6）。
 * - `settle` … 呼び出し後に実績で補正する。**失敗した試行の分も渡す**（原価は発生している）。
 */
export type AiCostGuard = {
  reserve(input: {
    readonly tenantId: string;
    readonly role: AiRole;
    readonly modelId: string;
    readonly estimatedInputTokens: number;
    readonly maxOutputTokens: number;
    readonly now: Date;
  }): Promise<AiCostReservation>;
  settle(input: {
    readonly tenantId: string;
    readonly reservation: AiCostReservation;
    readonly attempts: readonly AiAttemptUsage[];
    readonly now: Date;
  }): Promise<void>;
};
