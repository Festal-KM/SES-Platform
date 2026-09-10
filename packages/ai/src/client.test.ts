// packages/ai/src/client.test.ts
// 🔴 SDK 例外の分類（docs/05 §7.4 / docs/03 §3.3.4）と、SDK 非依存クライアントの振る舞い。
//    実 API には接続しない（`AnthropicMessagesApi` のスタブだけを渡す）。
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  ANTHROPIC_SDK_MAX_RETRIES,
  AnthropicApiClient,
  buildAnthropicClientOptions,
  createAnthropicMessagesApi,
  ENFORCED_SPEND_LIMIT_ERROR_CODE,
  normalizeAnthropicError,
  toAnthropicMessagesCreateParams,
  toAnthropicMessagesResult,
  type AiClientRequest,
  type AnthropicMessagesApi,
  type AnthropicMessagesRequest,
} from './client.js';
import { AiClientError } from './errors.js';
import type { MaskedText } from './mask.js';

const asMasked = (text: string): MaskedText => text as MaskedText;

function request(overrides: Partial<AiClientRequest> = {}): AiClientRequest {
  return {
    modelId: 'model-default',
    system: asMasked('system'),
    userBlocks: [{ type: 'text', text: asMasked('user') }],
    outputSchema: z.object({ ok: z.boolean() }),
    maxOutputTokens: 512,
    timeoutMs: 30_000,
    ...overrides,
  };
}

const TOKENS = { inputTokens: 10, outputTokens: 5, cacheReadTokens: 0, cacheWriteTokens: 0 };

describe('normalizeAnthropicError（分類は 1 箇所に閉じる）', () => {
  it('🔴 429 + enforced_spend_limit_reached は SPEND_CAP（再試行しない側）', () => {
    const error = normalizeAnthropicError({
      status: 429,
      error: { details: { error_code: ENFORCED_SPEND_LIMIT_ERROR_CODE } },
    });
    expect(error.kind).toBe('SPEND_CAP');
    expect(error.status).toBe(429);
  });

  it('details が入れ子でない形（error.details 直下）でも SPEND_CAP と判定する', () => {
    const error = normalizeAnthropicError({ status: 429, details: { error_code: ENFORCED_SPEND_LIMIT_ERROR_CODE } });
    expect(error.kind).toBe('SPEND_CAP');
  });

  it('通常の 429 は RATE で、retry-after（秒）をミリ秒に直して持つ', () => {
    const error = normalizeAnthropicError({ status: 429, headers: { 'retry-after': '3' } });
    expect(error.kind).toBe('RATE');
    expect(error.retryAfterMs).toBe(3000);
  });

  it('Retry-After（大文字）も拾う', () => {
    const error = normalizeAnthropicError({ status: 429, headers: { 'Retry-After': 2 } });
    expect(error.retryAfterMs).toBe(2000);
  });

  it('5xx とタイムアウト・接続断は TIMEOUT', () => {
    expect(normalizeAnthropicError({ status: 503 }).kind).toBe('TIMEOUT');
    expect(normalizeAnthropicError({ name: 'APIConnectionTimeoutError' }).kind).toBe('TIMEOUT');
    expect(normalizeAnthropicError({ code: 'ETIMEDOUT' }).kind).toBe('TIMEOUT');
  });

  it('400 / 401 とその他は API（再試行しない側）', () => {
    expect(normalizeAnthropicError({ status: 400 }).kind).toBe('API');
    expect(normalizeAnthropicError({ status: 401 }).kind).toBe('API');
    expect(normalizeAnthropicError(new Error('unknown')).kind).toBe('API');
  });

  it('すでに正規化済みの AiClientError はそのまま返す（二重分類しない）', () => {
    const original = new AiClientError('RATE', { retryAfterMs: 1000 });
    expect(normalizeAnthropicError(original)).toBe(original);
  });

  it('🔴 応答本文をメッセージに含めない（プロンプト・PII の漏れ経路を作らない）', () => {
    const error = normalizeAnthropicError({ status: 400, error: { message: '山田太郎 の生年月日' } });
    expect(error.message).not.toContain('山田太郎');
  });
});

describe('AnthropicApiClient（SDK 非依存の呼び出しロジック）', () => {
  it('要求を SDK 形へ組み立て、応答をそのまま（未検証で）返す', async () => {
    const seen: AnthropicMessagesRequest[] = [];
    const api: AnthropicMessagesApi = {
      parse(input) {
        seen.push(input);
        return Promise.resolve({ output: { ok: true }, modelId: 'model-actual', tokens: TOKENS });
      },
    };

    const input = request();
    const response = await new AnthropicApiClient(api).createStructuredMessage(input);

    expect(seen[0]).toMatchObject({
      model: 'model-default',
      system: 'system',
      userTexts: ['user'],
      maxOutputTokens: 512,
      timeoutMs: 30_000,
    });
    // 🔴 `outputSchema` を**そのまま**渡す（アダプタが zodOutputFormat に掛ける唯一の経路。
    //    途中で JSON Schema へ変換する経路を作らない）。
    expect(seen[0]?.outputSchema).toBe(input.outputSchema);
    expect(response).toEqual({ output: { ok: true }, modelId: 'model-actual', tokens: TOKENS });
  });

  it('構造化出力が無い応答は null を返す（自由文を正規表現で救わない）', async () => {
    const api: AnthropicMessagesApi = {
      parse: () => Promise.resolve({ output: undefined, modelId: 'model-actual', tokens: TOKENS }),
    };
    const response = await new AnthropicApiClient(api).createStructuredMessage(request());
    expect(response.output).toBeNull();
  });

  it('例外は AiClientError に正規化して投げ直す', async () => {
    const api: AnthropicMessagesApi = { parse: () => Promise.reject({ status: 503 }) };
    await expect(new AnthropicApiClient(api).createStructuredMessage(request())).rejects.toMatchObject({
      name: 'AiClientError',
      kind: 'TIMEOUT',
    });
  });
});

describe('🔴 SDK アダプタの写像（T-07-11。実 API には接続しない）', () => {
  it('🔴 maxRetries は 0 である（SDK 内部の再試行を残すと AiUsage の行数と実呼び出し数がずれる）', () => {
    expect(buildAnthropicClientOptions({ apiKey: 'sk-ant-dummy' }).maxRetries).toBe(0);
    expect(ANTHROPIC_SDK_MAX_RETRIES).toBe(0);
  });

  it('baseUrl を渡したときだけ baseURL が載る（未指定なら SDK の既定に任せる）', () => {
    expect(buildAnthropicClientOptions({ apiKey: 'k' })).toEqual({ apiKey: 'k', maxRetries: 0 });
    expect(buildAnthropicClientOptions({ apiKey: 'k', baseUrl: 'https://example.test' })).toEqual({
      apiKey: 'k',
      maxRetries: 0,
      baseURL: 'https://example.test',
    });
  });

  it('🔴 タイムアウトはクライアント既定に置かない（要求ごとに runRole が決める）', () => {
    expect(buildAnthropicClientOptions({ apiKey: 'k' })).not.toHaveProperty('timeout');
  });

  it('要求は text ブロックだけに写る（image / document を作る経路が無い）', () => {
    const schema = z.object({ ok: z.boolean() });
    const params = toAnthropicMessagesCreateParams({
      model: 'model-x',
      system: 'sys',
      userTexts: ['a', 'b'],
      outputSchema: schema,
      maxOutputTokens: 256,
      timeoutMs: 1_000,
    });
    expect(params.model).toBe('model-x');
    expect(params.max_tokens).toBe(256);
    expect(params.system).toBe('sys');
    expect(params.messages).toEqual([
      {
        role: 'user',
        content: [
          { type: 'text', text: 'a' },
          { type: 'text', text: 'b' },
        ],
      },
    ]);
    // 🔴 出力定義は zodOutputFormat を通った 1 経路だけ（生の output_config を組み立てない）。
    expect(params.output_config.format).toBeDefined();
  });

  it('応答の写像: parsed_output / model / usage の 4 値（キャッシュを入力に混ぜない）', () => {
    expect(
      toAnthropicMessagesResult(
        {
          parsed_output: { ok: true },
          model: 'model-actual',
          usage: {
            input_tokens: 11,
            output_tokens: 7,
            cache_read_input_tokens: 3,
            cache_creation_input_tokens: 5,
          },
        },
        'model-requested',
      ),
    ).toEqual({
      output: { ok: true },
      modelId: 'model-actual',
      tokens: { inputTokens: 11, outputTokens: 7, cacheReadTokens: 3, cacheWriteTokens: 5 },
    });
  });

  it('parsed_output が null なら undefined に畳む（AnthropicApiClient が null を返す枝に合流する）', () => {
    const result = toAnthropicMessagesResult(
      { parsed_output: null, model: 'm', usage: { input_tokens: 1, output_tokens: 1 } },
      'model-requested',
    );
    expect(result.output).toBeUndefined();
    expect(result.tokens).toEqual({
      inputTokens: 1,
      outputTokens: 1,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
    });
  });

  it('model / usage が欠けた応答でも要求モデル ID と 0 トークンに落ちる（例外にしない）', () => {
    expect(toAnthropicMessagesResult({}, 'model-requested')).toEqual({
      output: undefined,
      modelId: 'model-requested',
      tokens: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 },
    });
  });

  it('🔴 createAnthropicMessagesApi はネットワークに出ない（生成しただけでは 1 回も呼ばない）', () => {
    // 生成は SDK クライアントを作るだけであり、実 API への接続は `parse` の呼び出しまで起きない。
    expect(createAnthropicMessagesApi({ apiKey: 'sk-ant-dummy' })).toHaveProperty('parse');
  });
});
