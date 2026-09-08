// packages/ai/src/index.ts — `@ses/ai` の公開 API。
//
// 🔴 公開する**実行系は `runRole` の 1 本だけ**である（docs/05 §7.2 / CLAUDE.md §3.2）。
//    ここから汎用の生成関数（`generateText` 等）を出さない。
// 🔴 `MockAnthropicClient` のクラスは re-export しない（`packages/connectors` と同じ規律。
//    docs/05 §13.1）。到達経路は `createAiClient(kind, ...)` の 1 本であり、業務コードが
//    「この環境ならモック」というリクエストごとの分岐を書けないようにする。

import { AnthropicApiClient, type AnthropicClient, type AnthropicMessagesApi } from './client.js';
import { AiClientNotAvailableError } from './errors.js';
import { MockAnthropicClient, type MockAnthropicClientOptions } from './mock/index.js';

// 🔴 **クライアントのポート（`AnthropicClient` / `AiClientRequest` / `AnthropicApiClient`）を
//    バレルから出さない。** 出すと `createAiClient(...)` の戻り値を業務コードが直接呼べる形が
//    「公開 API」になり、`runRole` を経ない = `AiUsage` に残らない呼び出しが書けてしまう
//    （docs/05 §7.3 / `F-026 AC-1`）。実際の呼び出し元は
//    `tests/static/ai-single-path.test.ts` が `packages/ai/src/run.ts` 1 本に固定する。
//    ここから出すのは「SDK アダプタを起動時に配線するために要る型」だけである。
export {
  createAnthropicMessagesApi,
  ZERO_TOKEN_USAGE,
  type AiOutputSchema,
  type AiTokenUsage,
  type AnthropicMessagesApi,
  type AnthropicMessagesRequest,
  type AnthropicMessagesResult,
  type AnthropicSdkOptions,
} from './client.js';
export {
  AiClientError,
  AiClientNotAvailableError,
  AiCostLimitExceededError,
  AiUsageNotRecordedError,
  type AiClientErrorKind,
} from './errors.js';
export { type ContentBlock, type MaskedText } from './mask.js';
export { catalogRoleModelResolver, type ModelCatalog, type RoleModelQuery, type RoleModelResolver } from './models.js';
export { decideRetry, MAX_LLM_ATTEMPTS, RETRY_BACKOFF_MS, RETRY_JITTER_RATIO, type RetryDecision, type RetryInput } from './retry.js';
export * from './roles/types.js';
export { createRoleRunner, estimateInputTokens, type AiRoleRunner, type AiRuntime } from './run.js';
export {
  type AiAttemptUsage,
  type AiCostGuard,
  type AiCostReservation,
  type AiUnitCountInput,
  type AiUsageRecordInput,
  type AiUsageRecorder,
} from './usage.js';
// モックの**設定の型**だけは出す（起動時の配線が応答を与えるため）。クラスそのものは出さない。
export type { MockAnthropicClientOptions, MockAnthropicStep } from './mock/index.js';

/**
 * 起動時 DI（docs/05 §13.1）が選ぶ実装種別。
 *
 * 🔴 `packages/config` の `ConnectorImplementationKind` と**同じ値集合**でなければならない。
 *    `packages/ai` は `@ses/config` に依存しない（設定の解釈は 1 箇所に閉じ、ここは結果を
 *    受け取るだけ）ため構造的に一致させ、`tests/static/connector-selection-mirror.test.ts` が
 *    両者のリテラル集合を突合する（`packages/connectors/src/types.ts` と同じ整理）。
 */
export const AI_IMPLEMENTATION_KINDS = ['real', 'mock', 'sandboxRecipientScoped'] as const;

export type AiImplementationKind = (typeof AI_IMPLEMENTATION_KINDS)[number];

export type AiClientRuntimeOptions = {
  /**
   * `real` のときに必須。`createAnthropicMessagesApi()`（SDK アダプタ）の戻り値を渡す。
   * 🔴 未指定でモックへ倒さない（CLAUDE.md §11.1）。
   */
  readonly messagesApi?: AnthropicMessagesApi;
  /** `mock` のときの応答スクリプト（docs/05 §17.5）。 */
  readonly mock?: MockAnthropicClientOptions;
};

/**
 * 🔴 AI クライアントを組み立てる唯一の入口。起動時に 1 回だけ呼ぶ
 *    （`createConnectors` と同じ位置づけ。リクエストごとに呼ばない）。
 *
 * 🔴 `APP_ENV` をここで見ない。分岐は `packages/config` の `resolveConnectorSelection` 1 箇所であり、
 *    本関数はその結果（`selection.ai`）を受け取るだけである。
 * 🔴 `production` でモックが選ばれない担保は 2 段（`envSchema` の枝 / `assertNoMockInProduction`）で
 *    既に効いている。本関数は**未登録の実装をモックで代替しない**ことだけを守る。
 */
export function createAiClient(
  kind: AiImplementationKind,
  options: AiClientRuntimeOptions = {},
): AnthropicClient {
  switch (kind) {
    case 'mock':
      return new MockAnthropicClient(options.mock ?? {});
    case 'real': {
      if (options.messagesApi === undefined) {
        throw new AiClientNotAvailableError(
          'real',
          'createAnthropicMessagesApi() の戻り値（SDK アダプタ）が渡されていません。',
        );
      }
      return new AnthropicApiClient(options.messagesApi);
    }
    default:
      // 🔴 `sandboxRecipientScoped` は**メール専用**の実装種別である（宛先分類で実装が分岐する。
      //    docs/05 §8.2）。AI には宛先の概念が無く、`resolveConnectorSelection` も `ai` に
      //    この値を返さない。渡されたら設定の取り違えなので起動を止める。
      throw new AiClientNotAvailableError(kind, 'AI に宛先分類による差し替えは存在しません。');
  }
}
