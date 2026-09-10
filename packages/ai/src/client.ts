// packages/ai/src/client.ts
// 🔴 **`@anthropic-ai/sdk` を import してよい唯一のファイル**（CLAUDE.md §3.2 / docs/05 §7.2）。
//    その担保は ESLint の `no-restricted-imports` / `no-restricted-syntax`（`eslint.config.mjs` の
//    ゾーン定義。このファイルだけ `allowSdk: true`）と `tests/static/ai-single-path.test.ts` である。
//
// ============================================================================
// 🔴 なぜ SDK を直接叩かず「ポート」を 2 段に分けるのか
// ============================================================================
// ① **実 Anthropic API を叩かないユニットテスト / E2E** を成立させるため。`runRole` は
//    `AnthropicClient`（本ファイルが定義するポート）だけに依存し、非本番では
//    `MockAnthropicClient`（`./mock/`）が同じポートを実装する（docs/05 §17.5）。
// ② SDK の呼び出し規約（`messages.parse` + `output_config.format = zodOutputFormat(schema)`。
//    docs/03 §3.3.3）を `AnthropicMessagesApi` の 1 面に閉じ込め、**エラーの分類・応答の取り出し・
//    要求の組み立て**（= 業務に効く部分）を SDK 非依存の `AnthropicApiClient` に置くため。
//    `packages/connectors` の `SesApi`（ポート）↔ `SesEmailSender`（ロジック）↔
//    `aws-sdk-api.ts`（SDK アダプタ）と同じ 3 分割である。
//
// ============================================================================
// ✅ **SDK の実体化（`createAnthropicMessagesApi`）は T-07-11 で完了した**（docs/05 §7.9 ⑥）
// ============================================================================
// 🔴 **モックへフォールバックしない**（CLAUDE.md §11.1）。`real` が選ばれた環境では
//    `ANTHROPIC_API_KEY` が `packages/config` の起動時検証で必須であり、無ければ起動が失敗する。
// 🔴 SDK に触れるのは**このファイルだけ**であり、触れ方も 3 つの純粋関数に割ってある
//    （`buildAnthropicClientOptions` / `toAnthropicMessagesCreateParams` /
//    `toAnthropicMessagesResult`）。**実 API に接続せずに全ての写像を検証できる**ようにするためで、
//    残る `createAnthropicMessagesApi` の本体は「純粋関数の出力を SDK に渡して戻り値を写す」
//    数行だけである（`packages/connectors/src/email/ses/aws-sdk-api.ts` と同じ整理）。
// 🔴 **`maxRetries: 0` は絶対**（`buildAnthropicClientOptions` が返し、`client.test.ts` が固定する）。
//    SDK 内部の自動再試行が残ると、`runRole` が数える試行回数（= `AiUsage` の行数）と実際の
//    呼び出し回数がずれ、原価が過少計上になる（AWS SDK に `maxAttempts: 1` を強制しているのと
//    同じ理由。docs/05 §17.2 #10b）。
// ⚠️ `@ses/ai` のバレル（`index.ts`）は本ファイルを値 import するため、`apps/web` の
//    サーババンドルにも SDK が載る。それが問題になった時点で、SDK の実体化だけを
//    `@ses/ai/anthropic` サブパスへ分離する（`@ses/connectors/aws` と同じ整理。docs/05 §17.2 #10b）。
// 🔴 `Q-T-5`（ZDR の適用）は設計に影響しない。適用時は `buildAnthropicClientOptions` に
//    ヘッダを 1 つ足すだけである（マスキングは ZDR の有無にかかわらず必須。SP-07 T-07-01）。

import { Anthropic } from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import type { z } from 'zod';
import { AiClientError } from './errors.js';
import type { ContentBlock, MaskedText } from './mask.js';

/**
 * 出力スキーマ（docs/03 §4.1 / §3.3.3）。
 *
 * 🔴 **Zod スキーマから `zodOutputFormat` を経由する経路が、出力定義の唯一の経路である。**
 *    アプリコードが生の `output_config` を組み立てる経路を作らない（docs/03 §3.3.3 の 🔴）。
 */
export type AiOutputSchema = z.ZodType<unknown>;

/** 課金・原価計上に使うトークン数（docs/05 §3.8 `AiUsage`）。 */
export type AiTokenUsage = {
  readonly inputTokens: number;
  readonly outputTokens: number;
  /** 🔴 キャッシュ読出は ITPM に算入されず単価も安い（docs/03 §3.3.4）。入力と混ぜない。 */
  readonly cacheReadTokens: number;
  readonly cacheWriteTokens: number;
};

export const ZERO_TOKEN_USAGE: AiTokenUsage = {
  inputTokens: 0,
  outputTokens: 0,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
};

/**
 * `AnthropicClient` への 1 回の要求。
 *
 * 🔴 `system` / `userBlocks` は `MaskedText` のみ（`./mask.js`）。生の `string` も
 *    `image` / `document` ブロックも**型として渡せない**（docs/05 §7.2 / §7.8 ④）。
 */
export type AiClientRequest = {
  readonly modelId: string;
  readonly system: MaskedText;
  readonly userBlocks: readonly ContentBlock[];
  readonly outputSchema: AiOutputSchema;
  readonly maxOutputTokens: number;
  readonly timeoutMs: number;
};

export type AiClientResponse = {
  /**
   * 🔴 **未検証**の構造化出力。呼び出し側（`runRole`）が `outputSchema.safeParse` で再検証する。
   *    JSON Schema 側は `minimum` / `maxLength` 等を無視するため、それが唯一の担保である
   *    （docs/03 §3.3.3 / §4.1）。ここで検証済みの型にしてはならない。
   */
  readonly output: unknown;
  /** 実際に応答したモデル ID（要求と異なりうるため応答側の値を記録する）。 */
  readonly modelId: string;
  readonly tokens: AiTokenUsage;
};

/**
 * 🔴 LLM を呼ぶ唯一のポート。`packages/ai` の内部からのみ使う
 *    （公開する実行系は `runRole` の 1 本だけ。docs/05 §7.2）。
 *
 * 🔴 `generateText` / `generateImage` / `moderate` に相当する汎用メソッドを持たない。
 *    ロール定義（`RoleSpec`）を経ないプロンプトは送れない。
 */
export type AnthropicClient = {
  createStructuredMessage(request: AiClientRequest): Promise<AiClientResponse>;
};

/** SDK に渡す 1 回分の要求（`AnthropicApiClient` が組み立て、SDK アダプタがそのまま流す）。 */
export type AnthropicMessagesRequest = {
  readonly model: string;
  /** 🔴 ここでブランドは落ちる（SDK 境界）。落ちてよいのは、**組み立て済み**の文字列だからである。 */
  readonly system: string;
  readonly userTexts: readonly string[];
  /** 🔴 アダプタが `zodOutputFormat(schema)` に渡す（docs/03 §3.3.3）。 */
  readonly outputSchema: AiOutputSchema;
  readonly maxOutputTokens: number;
  readonly timeoutMs: number;
};

export type AnthropicMessagesResult = {
  readonly output: unknown;
  readonly modelId: string;
  readonly tokens: AiTokenUsage;
};

/**
 * SDK（`client.messages.parse`）の呼び出し面。
 *
 * ⚠️ **実装は SDK アダプタ 1 つだけ**であり、それを作れるのは `createAnthropicMessagesApi` である。
 *    テストは実 SDK ではなくこの形のスタブを渡す（実 API に接続しない）。
 */
export type AnthropicMessagesApi = {
  parse(request: AnthropicMessagesRequest): Promise<AnthropicMessagesResult>;
};

/**
 * SDK アダプタの上に載る、SDK 非依存のクライアント実装。
 *
 * 担うのは 3 つだけ:
 *   ① 要求の組み立て（`MaskedText` → SDK 形）
 *   ② 応答の取り出し（🔴 検証はしない。`runRole` の `safeParse` が唯一の担保）
 *   ③ 例外の正規化（`normalizeAnthropicError`）
 * 🔴 再試行・上限判定・利用量記録はここに置かない（`runRole` の手順として 1 箇所に集約する。
 *    docs/05 §7.3）。ここに再試行を書くと、`AiUsage` の行数と実際の呼び出し回数がずれる。
 */
export class AnthropicApiClient implements AnthropicClient {
  readonly #api: AnthropicMessagesApi;

  constructor(api: AnthropicMessagesApi) {
    this.#api = api;
  }

  async createStructuredMessage(request: AiClientRequest): Promise<AiClientResponse> {
    let result: AnthropicMessagesResult;
    try {
      result = await this.#api.parse({
        model: request.modelId,
        system: request.system,
        userTexts: request.userBlocks.map((block) => block.text),
        outputSchema: request.outputSchema,
        maxOutputTokens: request.maxOutputTokens,
        timeoutMs: request.timeoutMs,
      });
    } catch (error) {
      // 🔴 分類はここ 1 箇所（`AiClientError` として投げ直す）。呼び出し側で `instanceof` の
      //    枝を増やさない。
      throw normalizeAnthropicError(error);
    }
    if (result.output === undefined) {
      // 応答は返ったが構造化出力が無い（`stop_reason: max_tokens` など）。
      // 🔴 自由文を正規表現で救わない（CLAUDE.md §3.2）。スキーマ違反として扱わせるため
      //    `null` を返し、`runRole` の `safeParse` に判定させる。
      return { output: null, modelId: result.modelId, tokens: result.tokens };
    }
    return { output: result.output, modelId: result.modelId, tokens: result.tokens };
  }
}

/** 例外オブジェクトから数値のステータスを取り出す（SDK / fetch のどちらの形でも拾えるように）。 */
function statusOf(error: unknown): number | undefined {
  if (typeof error !== 'object' || error === null) return undefined;
  const status = (error as { status?: unknown }).status;
  return typeof status === 'number' ? status : undefined;
}

/** `retry-after`（秒）を拾う。ヘッダは大小文字を区別しない形で持たれうる。 */
function retryAfterMsOf(error: unknown): number | undefined {
  if (typeof error !== 'object' || error === null) return undefined;
  const headers = (error as { headers?: unknown }).headers;
  if (typeof headers !== 'object' || headers === null) return undefined;
  const raw =
    (headers as Record<string, unknown>)['retry-after'] ?? (headers as Record<string, unknown>)['Retry-After'];
  const seconds = typeof raw === 'string' ? Number.parseFloat(raw) : typeof raw === 'number' ? raw : Number.NaN;
  return Number.isFinite(seconds) && seconds >= 0 ? Math.round(seconds * 1000) : undefined;
}

/**
 * 🔴 月間支出上限の識別（docs/03 §3.3.4）。
 *    「429 かつ `error.details.error_code === 'enforced_spend_limit_reached'`」であり、
 *    `retry-after` が付かない。**これを通常の 429 と混ぜると、無意味な再試行で原価だけが増える。**
 */
export const ENFORCED_SPEND_LIMIT_ERROR_CODE = 'enforced_spend_limit_reached';

function isEnforcedSpendLimit(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  // SDK は `error.error`（API のエラー本体）を持つ。`{ error: { details: { error_code } } }` /
  // `{ details: { error_code } }` のどちらの入れ子でも拾えるようにする。
  const candidates: unknown[] = [error, (error as { error?: unknown }).error];
  for (const candidate of candidates) {
    if (typeof candidate !== 'object' || candidate === null) continue;
    const details = (candidate as { details?: unknown }).details;
    if (typeof details !== 'object' || details === null) continue;
    if ((details as { error_code?: unknown }).error_code === ENFORCED_SPEND_LIMIT_ERROR_CODE) return true;
  }
  return false;
}

function isTimeoutLike(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  const name = (error as { name?: unknown }).name;
  if (name === 'AbortError' || name === 'TimeoutError' || name === 'APIConnectionTimeoutError') return true;
  const code = (error as { code?: unknown }).code;
  return code === 'ETIMEDOUT' || code === 'ECONNRESET' || code === 'ECONNREFUSED';
}

/**
 * 🔴 SDK / ネットワークの例外を `AiClientError` に正規化する（docs/05 §7.4 / docs/03 §3.3.4）。
 *
 * | 入力 | kind | 再試行 |
 * |---|---|---|
 * | 429 + `enforced_spend_limit_reached` | `SPEND_CAP` | 🔴 しない |
 * | 429（`retry-after` あり） | `RATE` | する（`retry-after` を尊重） |
 * | 5xx / タイムアウト / 接続断 | `TIMEOUT` | する（バックオフ） |
 * | 400 / 401 / その他 | `API` | 🔴 しない |
 *
 * 🔴 メッセージに応答本文を含めない（プロンプト・PII が混ざりうる。CLAUDE.md §3.4 / docs/05 §16.2）。
 */
export function normalizeAnthropicError(error: unknown): AiClientError {
  if (error instanceof AiClientError) return error;

  const status = statusOf(error);
  const retryAfterMs = retryAfterMsOf(error);

  if (status === 429 || isEnforcedSpendLimit(error)) {
    const kind = isEnforcedSpendLimit(error) ? 'SPEND_CAP' : 'RATE';
    return new AiClientError(kind, {
      ...(status === undefined ? {} : { status }),
      ...(retryAfterMs === undefined ? {} : { retryAfterMs }),
      cause: error,
    });
  }
  if ((status !== undefined && status >= 500) || isTimeoutLike(error)) {
    return new AiClientError('TIMEOUT', {
      ...(status === undefined ? {} : { status }),
      ...(retryAfterMs === undefined ? {} : { retryAfterMs }),
      cause: error,
    });
  }
  return new AiClientError('API', { ...(status === undefined ? {} : { status }), cause: error });
}

/** `createAnthropicMessagesApi` に渡す起動時の値（🔴 環境変数は `packages/config` が検証済みのものを受け取る）。 */
export type AnthropicSdkOptions = {
  /** 🔴 ログ・エラー・監査ログに出さない（CLAUDE.md §3.4 / §3.5）。 */
  readonly apiKey: string;
  readonly baseUrl?: string;
};

/**
 * 🔴 **SDK の自動再試行は必ず 0 回**（docs/05 §7.9 ⑥ / §17.2 #10b）。
 *
 * 再試行は `runRole` の内部（手順 7）が数え、1 試行につき `AiUsage` を 1 行書く。SDK が
 * 裏で再送すると **実際の呼び出し回数のほうが多くなる** ——「記録を経由しない AI 呼び出しを
 * 作らない」（`BR-09` / `BR-10`）が、コードを 1 行も足さずに破れる形である。
 */
export const ANTHROPIC_SDK_MAX_RETRIES = 0;

/** `new Anthropic(...)` に渡す値（🔴 純粋関数。テストが `maxRetries: 0` をここで固定する）。 */
export type AnthropicClientOptions = {
  readonly apiKey: string;
  readonly maxRetries: typeof ANTHROPIC_SDK_MAX_RETRIES;
  readonly baseURL?: string;
};

/**
 * SDK クライアントの生成引数を組み立てる（🔴 副作用なし。値を作るだけ）。
 *
 * 🔴 `timeout` をここに置かない —— タイムアウトは**要求ごと**に `runRole` が決める
 *    （ロールごとに違う。`RoleSpec.timeoutMs`）。クライアント既定に置くと、要求側の指定と
 *    どちらが効いているのか読めなくなる。
 */
export function buildAnthropicClientOptions(options: AnthropicSdkOptions): AnthropicClientOptions {
  return {
    apiKey: options.apiKey,
    maxRetries: ANTHROPIC_SDK_MAX_RETRIES,
    ...(options.baseUrl === undefined ? {} : { baseURL: options.baseUrl }),
  };
}

/**
 * `messages.parse` に渡す本体（🔴 純粋関数）。
 *
 * 🔴 `output_config.format` に `zodOutputFormat(schema)` を掛けるのは**ここだけ**である
 *    （docs/03 §3.3.3 の 🔴「生の `output_config` を組み立てる経路を作らない」）。
 * 🔴 コンテンツブロックは `text` しか作れない（`AnthropicMessagesRequest.userTexts` が
 *    `string[]` であり、`image` / `document` を渡す形が型として存在しない。docs/05 §7.10）。
 */
export function toAnthropicMessagesCreateParams(request: AnthropicMessagesRequest): {
  readonly model: string;
  readonly max_tokens: number;
  readonly system: string;
  readonly messages: readonly { readonly role: 'user'; readonly content: readonly { readonly type: 'text'; readonly text: string }[] }[];
  readonly output_config: { readonly format: unknown };
} {
  return {
    model: request.model,
    max_tokens: request.maxOutputTokens,
    system: request.system,
    messages: [
      {
        role: 'user',
        content: request.userTexts.map((text) => ({ type: 'text' as const, text })),
      },
    ],
    output_config: { format: zodOutputFormat(request.outputSchema) },
  };
}

/** SDK の `Usage` から我々の 4 値へ（🔴 キャッシュ読出・書込を入力トークンに混ぜない）。 */
type AnthropicUsageShape = {
  readonly input_tokens: number;
  readonly output_tokens: number;
  readonly cache_read_input_tokens?: number | null;
  readonly cache_creation_input_tokens?: number | null;
};

/** `messages.parse` の戻り値から我々の形へ（🔴 純粋関数。検証はしない）。 */
export function toAnthropicMessagesResult(
  message: {
    readonly parsed_output?: unknown;
    readonly model?: string;
    readonly usage?: AnthropicUsageShape;
  },
  requestedModelId: string,
): AnthropicMessagesResult {
  const usage = message.usage;
  return {
    // 🔴 `null`（構造化出力が無い）は `undefined` に畳む。`AnthropicApiClient` が
    //    「出力が無い」を 1 つの枝で扱い、`runRole` の `safeParse` に判定させるためである。
    output: message.parsed_output ?? undefined,
    modelId: message.model ?? requestedModelId,
    tokens: {
      inputTokens: usage?.input_tokens ?? 0,
      outputTokens: usage?.output_tokens ?? 0,
      cacheReadTokens: usage?.cache_read_input_tokens ?? 0,
      cacheWriteTokens: usage?.cache_creation_input_tokens ?? 0,
    },
  };
}

/**
 * 🔴 **`@anthropic-ai/sdk` を実体化する唯一の関数**（= 唯一の SDK 呼び出し地点）。
 *
 * 🔴 ここに置いてよいのは「純粋関数の出力を SDK に渡し、戻り値を純粋関数で写す」ことだけである。
 *    再試行・上限判定・利用量記録・マスキングをここに書かない（`runRole` の手順に集約する。
 *    docs/05 §7.3 / §7.4）。
 * 🔴 例外はここで正規化しない —— `AnthropicApiClient.createStructuredMessage` が
 *    `normalizeAnthropicError` に通す（分類は 1 箇所。同関数の 🔴）。
 */
export function createAnthropicMessagesApi(options: AnthropicSdkOptions): AnthropicMessagesApi {
  const client = new Anthropic(buildAnthropicClientOptions(options));
  return {
    async parse(request: AnthropicMessagesRequest): Promise<AnthropicMessagesResult> {
      const message = await client.messages.parse(
        // 🔴 `zodOutputFormat` の戻り値は SDK の内部型（`AutoParseableOutputFormat`）であり、
        //    我々の純粋関数はそれを `unknown` として運ぶ（型を写し取ると SDK の型が
        //    `client.ts` の外へ漏れる）。SDK 境界のここでだけ形を合わせる。
        toAnthropicMessagesCreateParams(request) as unknown as Parameters<
          typeof client.messages.parse
        >[0],
        { timeout: request.timeoutMs },
      );
      return toAnthropicMessagesResult(message, request.model);
    },
  };
}
