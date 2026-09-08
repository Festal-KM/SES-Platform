// packages/ai/src/mock/anthropic.test.ts
// 🔴 モックは E2E・結合・ユニットで**同一実装**である（docs/05 §17.5）。その振る舞いを固定する。
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import type { AiClientRequest } from '../client.js';
import { AiClientError } from '../errors.js';
import type { MaskedText } from '../mask.js';
import { MockAnthropicClient, MockAnthropicNotConfiguredError } from './anthropic.js';

const asMasked = (text: string): MaskedText => text as MaskedText;

function request(): AiClientRequest {
  return {
    modelId: 'model-default',
    system: asMasked('system'),
    userBlocks: [{ type: 'text', text: asMasked('user') }],
    outputSchema: z.object({ ok: z.boolean() }),
    maxOutputTokens: 128,
    timeoutMs: 1000,
  };
}

describe('MockAnthropicClient', () => {
  it('🔴 応答が設定されていなければ throw する（黙って成功も失敗もさせない）', async () => {
    const client = new MockAnthropicClient();
    await expect(client.createStructuredMessage(request())).rejects.toBeInstanceOf(
      MockAnthropicNotConfiguredError,
    );
  });

  it('スクリプトを順に消費し、尽きたら最後の応答を繰り返す', async () => {
    const client = new MockAnthropicClient({
      script: [
        { kind: 'output', output: { ok: false } },
        { kind: 'output', output: { ok: true } },
      ],
    });

    expect((await client.createStructuredMessage(request())).output).toEqual({ ok: false });
    expect((await client.createStructuredMessage(request())).output).toEqual({ ok: true });
    expect((await client.createStructuredMessage(request())).output).toEqual({ ok: true });
    expect(client.callCount()).toBe(3);
  });

  it('エラーは正規化済みの AiClientError として投げる（分類はモックが決めない）', async () => {
    const client = new MockAnthropicClient({
      script: [{ kind: 'error', error: 'SPEND_CAP', status: 429 }],
    });

    await expect(client.createStructuredMessage(request())).rejects.toBeInstanceOf(AiClientError);
    await client.createStructuredMessage(request()).catch((error: unknown) => {
      expect((error as AiClientError).kind).toBe('SPEND_CAP');
      expect((error as AiClientError).status).toBe(429);
    });
  });

  it('要求を記録する（マスキング検証・プロンプトインジェクション検証で参照する）', async () => {
    const client = new MockAnthropicClient({ script: [{ kind: 'output', output: { ok: true } }] });
    await client.createStructuredMessage(request());

    expect(client.requests()).toHaveLength(1);
    expect(client.requests()[0]?.system).toBe('system');
  });

  it('トークン数を返す（原価計上の経路が E2E でも動く）', async () => {
    const client = new MockAnthropicClient({
      script: [{ kind: 'output', output: { ok: true }, tokens: { outputTokens: 42 } }],
    });
    const response = await client.createStructuredMessage(request());

    expect(response.tokens.outputTokens).toBe(42);
    expect(response.tokens.inputTokens).toBeGreaterThan(0);
  });

  it('enqueue で後から応答を足せる（1 シナリオ内で挙動を切り替える）', async () => {
    const client = new MockAnthropicClient({ script: [{ kind: 'output', output: { ok: true } }] });
    client.enqueue({ kind: 'error', error: 'TIMEOUT' });

    await client.createStructuredMessage(request());
    await expect(client.createStructuredMessage(request())).rejects.toBeInstanceOf(AiClientError);
  });
});
