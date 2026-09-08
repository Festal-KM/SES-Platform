// packages/ai/src/run.ts
// 🔴 **`packages/ai` が公開する実行系はこの 1 本だけ**（`runRole`。docs/05 §7.2）。
//    `generateText` / `generateImage` / `moderate` に相当する汎用関数を公開しない ——
//    公開した瞬間に「ロール定義を経ないプロンプト」が送れるようになり、プロンプト版の記録も
//    ロール別原価の分解も成立しなくなる（CLAUDE.md §3.2 / §12.3）。

import { ROLE_PURPOSE, type AiUsageFailureKind } from '@ses/domain';
import type { AiClientRequest, AiClientResponse, AiTokenUsage, AnthropicClient } from './client.js';
import { ZERO_TOKEN_USAGE } from './client.js';
import { AiClientError, AiUsageNotRecordedError } from './errors.js';
import type { RoleModelResolver } from './models.js';
import { decideRetry, MAX_LLM_ATTEMPTS } from './retry.js';
import type { AiCallContext, AiFailure, Provenance, RoleResult, RoleSpec } from './roles/types.js';
import type { AiAttemptUsage, AiCostGuard, AiUsageRecorder } from './usage.js';

/**
 * `runRole` が必要とする外部との接続点。**起動時に 1 回だけ組み立てる**（docs/05 §13.1）。
 *
 * 🔴 4 つとも必須である。省略可能にすると「記録を経由しない呼び出し」「上限を見ない呼び出し」が
 *    書けてしまい、`F-026 AC-1` / `F-027` の担保が「気をつける」に戻る。
 */
export type AiRuntime = {
  readonly client: AnthropicClient;
  readonly usage: AiUsageRecorder;
  readonly costGuard: AiCostGuard;
  readonly models: RoleModelResolver;
  /** 再試行の待機（既定は `setTimeout`）。🔴 テストは即時に解決する関数を渡す。 */
  readonly sleep?: (ms: number) => Promise<void>;
  /** ジッタ用の乱数（既定は `Math.random`）。 */
  readonly random?: () => number;
};

/**
 * 🔴 公開される実行関数の形（docs/05 §7.2）。`spec` / `input` / `ctx` の 3 引数であり、
 *    接続点（`AiRuntime`）は `createRoleRunner` に閉じている。
 */
export type AiRoleRunner = {
  runRole<I, O>(spec: RoleSpec<I, O>, input: I, ctx: AiCallContext): Promise<RoleResult<O>>;
};

/**
 * 入力トークン数の見積り（コスト予約用）。
 *
 * ⚠️ 正確な数ではない。**予約は「呼ぶ前に上限へ当てる」ためのもの**であり、実コストは呼び出し後に
 *    `settle` で補正される（docs/05 §7.6）。英日混在を前提に 1 トークン ≒ 3 文字と保守的に見る
 *    （少なめに見積もると上限を越えてから気づくため、**多め**に倒す）。
 */
export function estimateInputTokens(text: string): number {
  return Math.ceil(text.length / 3);
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

/** 1 回の試行の結果（成功 / 失敗のどちらでも `AiUsage` を 1 行積む）。 */
type AttemptOutcome<O> =
  | { readonly kind: 'ok'; readonly output: O; readonly response: AiClientResponse }
  | {
      readonly kind: 'failed';
      readonly failureKind: AiUsageFailureKind;
      readonly message: string;
      readonly tokens: AiTokenUsage;
      readonly modelId: string;
      readonly retryAfterMs?: number;
    };

/**
 * 🔴 `runRole` を組み立てる唯一の入口（`createConnectors` と同じ位置づけ）。
 *    リクエストごとに呼ばない。
 */
export function createRoleRunner(runtime: AiRuntime): AiRoleRunner {
  const sleep = runtime.sleep ?? defaultSleep;
  const random = runtime.random ?? Math.random;

  async function attemptOnce<I, O>(
    spec: RoleSpec<I, O>,
    modelId: string,
    request: AiClientRequest,
  ): Promise<AttemptOutcome<O>> {
    let response: AiClientResponse;
    try {
      // 手順 4: 構造化出力の指定は `outputSchema` の 1 経路だけ（docs/03 §3.3.3）。
      response = await runtime.client.createStructuredMessage(request);
    } catch (error) {
      // 🔴 クライアントは正規化済みの `AiClientError` を投げる（`normalizeAnthropicError`）。
      //    それ以外（＝ 我々のバグ）は握り潰さずそのまま投げる。
      if (!(error instanceof AiClientError)) throw error;
      return {
        kind: 'failed',
        failureKind: error.kind,
        message: error.message,
        tokens: ZERO_TOKEN_USAGE,
        modelId,
        ...(error.retryAfterMs === undefined ? {} : { retryAfterMs: error.retryAfterMs }),
      };
    }

    // 🔴 手順 5: 受信後に必ず `safeParse`。JSON Schema 側は `minimum` / `maxLength` 等を
    //    無視するため、**これが唯一の担保**である（docs/03 §4.1 / 申し送り 10）。
    //    🔴 失敗しても自由文を正規表現でパースして救わない（CLAUDE.md §3.2）。
    const parsed = spec.outputSchema.safeParse(response.output);
    if (!parsed.success) {
      return {
        kind: 'failed',
        failureKind: 'SCHEMA',
        // 🔴 メッセージに応答本文を含めない（PII / 商流情報が混ざりうる。docs/05 §16.2）。
        message: '構造化出力がスキーマに適合しませんでした。',
        tokens: response.tokens,
        modelId: response.modelId,
      };
    }
    return { kind: 'ok', output: parsed.data, response };
  }

  async function runRole<I, O>(
    spec: RoleSpec<I, O>,
    input: I,
    ctx: AiCallContext,
  ): Promise<RoleResult<O>> {
    // 🔴 用途はロールと 1:1（`ai_usage_purpose_check`）。取り違えた `RoleSpec` を受け付けると、
    //    `AiUsage.purpose` が CHECK に落ちる（= 記録できない）か、ロール別原価（`F-063`）が
    //    別のロールに積まれる。**LLM を呼ぶ前**に落とす（呼んでから落とすと原価だけが出る）。
    if (spec.purpose !== ROLE_PURPOSE[spec.role]) {
      throw new Error(
        `RoleSpec の purpose が不正です（role=${spec.role} / purpose=${spec.purpose}）。` +
          `ROLE_PURPOSE['${spec.role}'] を使ってください（docs/05 §3.8 / §7.1）。`,
      );
    }

    // 手順 1: 入力も Zod で検証する（前工程の出力を受け取る境界。docs/05 §7.1）。
    // 🔴 ここでの失敗はロールの失敗ではなく**呼び出し側の不具合**なので、そのまま throw する
    //    （LLM を呼ばないため `AiUsage` の行も立たない）。
    const parsedInput = spec.inputSchema.parse(input);

    // 手順 2: マスキング済みの型でしかプロンプトを組み立てられない（`RolePrompt`）。
    const prompt = spec.buildPrompt(parsedInput);

    const modelId = await runtime.models.resolve({
      tenantId: ctx.tenantId,
      role: spec.role,
      tier: spec.defaultModel,
    });

    // 🔴 手順 3: 呼び出し**前**に予約する。失敗（`AiCostLimitExceededError`）は catch せず
    //    伝播させる —— 呼び出し側（`gate.run` 等）が「保留（HELD）」として扱うためであり、
    //    ここで握り潰すと上限が無いのと同じになる（docs/05 §7.6 / `F-027 AC-5`）。
    const reservation = await runtime.costGuard.reserve({
      tenantId: ctx.tenantId,
      role: spec.role,
      modelId,
      estimatedInputTokens: estimateInputTokens(prompt.system) + estimateInputTokens(prompt.user),
      maxOutputTokens: spec.maxOutputTokens,
      now: ctx.now(),
    });

    const request: AiClientRequest = {
      modelId,
      system: prompt.system,
      // 🔴 テキストブロックしか作れない（`image` / `document` は型に存在しない。docs/05 §7.2）。
      userBlocks: [{ type: 'text', text: prompt.user }],
      outputSchema: spec.outputSchema,
      maxOutputTokens: spec.maxOutputTokens,
      timeoutMs: spec.timeoutMs,
    };

    const aiUsageIds: string[] = [];
    const attempts: AiAttemptUsage[] = [];
    let success: { output: O; modelId: string } | undefined;
    let lastFailure: AiFailure | undefined;
    let attemptNo = 0;

    while (attemptNo < MAX_LLM_ATTEMPTS) {
      attemptNo += 1;
      const startedAt = ctx.now();
      const outcome = await attemptOnce(spec, modelId, request);
      const finishedAt = ctx.now();
      const tokens = outcome.kind === 'ok' ? outcome.response.tokens : outcome.tokens;
      const usedModelId = outcome.kind === 'ok' ? outcome.response.modelId : outcome.modelId;
      attempts.push({ modelId: usedModelId, tokens });

      // 🔴 手順 6: 試行 1 回につき `AiUsage` を 1 行。**記録できなければ throw する**
      //    （記録を経由しない呼び出しを成功にしない。docs/05 §7.3 の実行時ガード 3）。
      try {
        const aiUsageId = await runtime.usage.record({
          tenantId: ctx.tenantId,
          role: spec.role,
          purpose: spec.purpose,
          modelId: usedModelId,
          promptVersion: spec.promptVersion,
          ...(ctx.targetType === undefined ? {} : { targetType: ctx.targetType }),
          ...(ctx.targetId === undefined ? {} : { targetId: ctx.targetId }),
          tokens,
          attemptNo,
          succeeded: outcome.kind === 'ok',
          ...(outcome.kind === 'ok' ? {} : { failureKind: outcome.failureKind }),
          startedAt,
          finishedAt,
        });
        aiUsageIds.push(aiUsageId);
      } catch (error) {
        throw new AiUsageNotRecordedError(spec.role, attemptNo, { cause: error });
      }

      if (outcome.kind === 'ok') {
        success = { output: outcome.output, modelId: usedModelId };
        break;
      }

      lastFailure = { kind: outcome.failureKind, attempts: attemptNo, message: outcome.message };
      const decision = decideRetry({
        kind: outcome.failureKind,
        attemptNo,
        ...(outcome.retryAfterMs === undefined ? {} : { retryAfterMs: outcome.retryAfterMs }),
        random: random(),
      });
      if (!decision.retry) break;
      if (decision.delayMs > 0) await sleep(decision.delayMs);
    }

    const provenance: Provenance = {
      role: spec.role,
      promptVersion: spec.promptVersion,
      modelId: success?.modelId ?? modelId,
      aiUsageIds,
    };

    if (success !== undefined) {
      // 🔴 手順 6b: 利用者に見せる件数の加算。**成功 1 回につき 1 度だけ**（内部再試行では加算しない。
      //    docs/05 §7.6）。加算できなければ throw する —— 黙って落とすと、使われたのに
      //    残量が減らない（＝ 請求できない）状態が静かに積み上がる。
      await runtime.usage.countUnit({
        tenantId: ctx.tenantId,
        role: spec.role,
        output: success.output,
        occurredAt: ctx.now(),
      });
    }

    // 🔴 手順 7: 予約の補正。**失敗して終わった場合も必ず行う**（失敗した試行にも原価は発生している）。
    await runtime.costGuard.settle({
      tenantId: ctx.tenantId,
      reservation,
      attempts,
      now: ctx.now(),
    });

    // 手順 8
    if (success !== undefined) return { ok: true, output: success.output, provenance };
    return {
      ok: false,
      failure: lastFailure ?? { kind: 'API', attempts: attemptNo, message: 'AI 呼び出しに失敗しました。' },
      provenance,
    };
  }

  return { runRole };
}
