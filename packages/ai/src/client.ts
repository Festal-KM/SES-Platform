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
// ⚠️ **SDK の実体化（`createAnthropicMessagesApi`）は未実装**である（docs/05 §7.9 ⑥）
// ============================================================================
// 🔴 `@anthropic-ai/sdk` の**依存は追加済み**（T-07-08。`packages/ai/package.json`）。未了なのは
//    このファイルのアダプタ本体と `docs/dev-plan.md` §5 E-3（API キー取得）である。
//    **モックへフォールバックしない**ため、`real` が選ばれたら `AiClientNotAvailableError` で
//    起動を止める（CLAUDE.md §11.1）。持ち主は T-07-11（docs/05 §11.12 ⑧-1）。
// 🔴 実体化する後続タスクは、**この関数の中身だけ**を埋めれば実接続に切り替わる
//    （`AnthropicApiClient` 以降のロジックとそのテストは書き換えずに済む）。
// 🔴 そのとき `import Anthropic from '@anthropic-ai/sdk'` は**このファイルの静的 import** になる。
//    `@ses/ai` のバレル（`index.ts`）は本ファイルを値 import するため、`apps/web` の
//    サーババンドルにも SDK が載る。それが問題になった時点で、SDK の実体化だけを
//    `@ses/ai/anthropic` サブパスへ分離する（`@ses/connectors/aws` と同じ整理。docs/05 §17.2 #10b）。
// 🔴 `Q-T-5`（ZDR の適用）は設計に影響しない。適用時は本ファイルのクライアント生成に
//    ヘッダを 1 つ足すだけである（マスキングは ZDR の有無にかかわらず必須。SP-07 T-07-01）。

import type { z } from 'zod';
import { AiClientError, AiClientNotAvailableError } from './errors.js';
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
 * 🔴 **`@anthropic-ai/sdk` を実体化する唯一の関数**（= 将来の唯一の SDK import 地点）。
 *
 * ⚠️ 現時点では未実装であり `AiClientNotAvailableError` を投げる（本ファイル冒頭の ⚠️ 参照）。
 *    **モックへ倒さない。** ここへ書くのは、およそ次の 4 行である（依存は追加済み）:
 *
 *    ```ts
 *    const client = new Anthropic({ apiKey: options.apiKey, maxRetries: 0, ... });
 *    const response = await client.messages.parse({
 *      model, max_tokens, system, messages: [{ role: 'user', content: [...] }],
 *      output_config: { format: zodOutputFormat(request.outputSchema) },
 *    }, { timeout: request.timeoutMs });
 *    ```
 * 🔴 `maxRetries: 0` を必ず指定すること。SDK 内部の自動再試行が残ると、`runRole` が数える
 *    試行回数（= `AiUsage` の行数）と実際の呼び出し回数がずれ、原価が過少計上になる
 *    （`packages/connectors` の AWS SDK に `maxAttempts: 1` を強制しているのと同じ理由）。
 */
export function createAnthropicMessagesApi(options: AnthropicSdkOptions): AnthropicMessagesApi {
  // 🔴 まだ SDK を実体化しない。引数の形は実装時にそのまま使うため残す（握り潰しではない）。
  void options;
  throw new AiClientNotAvailableError(
    'real',
    'SDK アダプタが未実装です（docs/05 §7.9 ⑥。持ち主は T-07-11）。' +
      '`@anthropic-ai/sdk` の依存は追加済みであり、残るのは本関数の実装と E-3（API キー取得）です。',
  );
}
