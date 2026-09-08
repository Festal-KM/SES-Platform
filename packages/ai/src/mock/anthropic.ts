// packages/ai/src/mock/anthropic.ts
// 🔴 **Anthropic のモックはこの 1 実装だけ**（docs/05 §17.5 / SP-07 §5）。
//    ユニット・結合・E2E が同じ実装を使う。テスト専用の別モックを書かない ——
//    書いた瞬間に「ユニットでは通るが E2E では違う挙動」という差が生まれ、どちらの green も
//    根拠にならなくなる（`packages/connectors/src/mock/**` と同じ規律）。
//
// 🔴 実 API には**絶対に**接続しない（`development` / `demo` / `sandbox` の E2E で使われる。
//    CLAUDE.md §11）。ネットワークを一切触らない実装である。

import type {
  AiClientRequest,
  AiClientResponse,
  AiTokenUsage,
  AnthropicClient,
} from '../client.js';
import { AiClientError, type AiClientErrorKind } from '../errors.js';

/**
 * 1 回の呼び出しに対する応答の指示。
 *
 * - `output` … 構造化出力をそのまま返す。🔴 **スキーマ違反の再現**は「スキーマに合わない値」を
 *   ここに入れるだけでよい（判定は `runRole` 側の `safeParse` が行う。モックに判定を持たせない）。
 * - `error`  … 正規化済みの `AiClientError` を投げる。`TIMEOUT` / `RATE` / `SPEND_CAP` / `API`。
 *   🔴 `SPEND_CAP` が `enforced_spend_limit_reached`（docs/03 §3.3.4）の再現である。
 */
export type MockAnthropicStep =
  | { readonly kind: 'output'; readonly output: unknown; readonly tokens?: Partial<AiTokenUsage>; readonly modelId?: string }
  | {
      readonly kind: 'error';
      readonly error: AiClientErrorKind;
      readonly retryAfterMs?: number;
      readonly status?: number;
    };

export type MockAnthropicClientOptions = {
  /**
   * 呼び出し順に消費される応答列。
   * 🔴 尽きたら**最後の 1 つを繰り返す**（E2E が「このシナリオでは常にこの応答」を 1 行で書けるように）。
   */
  readonly script?: readonly MockAnthropicStep[];
  /** 応答に載せる既定のトークン数（原価計上の経路を E2E でも動かすため 0 にしない）。 */
  readonly defaultTokens?: AiTokenUsage;
};

const DEFAULT_TOKENS: AiTokenUsage = {
  inputTokens: 1200,
  outputTokens: 300,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
};

/**
 * 🔴 スクリプトが空のまま呼ばれた（＝ 何を返すか誰も決めていない）。
 *
 * **黙って成功も失敗もさせない。** 「未設定なら適当な応答」はモックがいちばんやってはいけない
 * 壊れ方であり、`CLAUDE.md` §11.1 の「未設定ならモックにフォールバック」と同じ性質の事故になる。
 */
export class MockAnthropicNotConfiguredError extends Error {
  constructor() {
    super(
      'MockAnthropicClient に応答が設定されていません。createAiClient(\'mock\', { script: [...] }) で' +
        '返す応答（またはエラー）を明示してください。',
    );
    this.name = 'MockAnthropicNotConfiguredError';
  }
}

export class MockAnthropicClient implements AnthropicClient {
  readonly #script: MockAnthropicStep[];
  readonly #defaultTokens: AiTokenUsage;
  readonly #requests: AiClientRequest[] = [];
  #cursor = 0;

  constructor(options: MockAnthropicClientOptions = {}) {
    this.#script = [...(options.script ?? [])];
    this.#defaultTokens = options.defaultTokens ?? DEFAULT_TOKENS;
  }

  /** 🔴 呼び出し回数。「予約に失敗したら外部呼び出しが 0 回」等の検証はここを見る（T-07-04）。 */
  callCount(): number {
    return this.#requests.length;
  }

  /** 送られた要求（プロンプトのマスキング検証に使う。T-07-02 / E2E #18）。 */
  requests(): readonly AiClientRequest[] {
    return this.#requests;
  }

  /** 続けて返す応答を積む（E2E の 1 シナリオ内で挙動を切り替えるため）。 */
  enqueue(...steps: readonly MockAnthropicStep[]): void {
    this.#script.push(...steps);
  }

  // 🔴 `async` にする（同期 throw をしない）。ポートの契約は「Promise を返す」であり、
  //    設定漏れだけ同期例外になると、呼び出し側の `catch` の書き方で挙動が変わってしまう。
  async createStructuredMessage(request: AiClientRequest): Promise<AiClientResponse> {
    this.#requests.push(request);
    const step = this.#nextStep();
    if (step.kind === 'error') {
      throw new AiClientError(step.error, {
        ...(step.retryAfterMs === undefined ? {} : { retryAfterMs: step.retryAfterMs }),
        ...(step.status === undefined ? {} : { status: step.status }),
      });
    }
    return {
      output: step.output,
      modelId: step.modelId ?? request.modelId,
      tokens: { ...this.#defaultTokens, ...step.tokens },
    };
  }

  #nextStep(): MockAnthropicStep {
    if (this.#script.length === 0) throw new MockAnthropicNotConfiguredError();
    const index = Math.min(this.#cursor, this.#script.length - 1);
    this.#cursor += 1;
    // 上の長さチェックにより必ず存在する。
    return this.#script[index] as MockAnthropicStep;
  }
}
