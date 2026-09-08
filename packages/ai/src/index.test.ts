// packages/ai/src/index.test.ts
// 🔴 起動時 DI（docs/05 §13.1 / CLAUDE.md §11.1）: 未登録の実装をモックで代替しない。
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { AI_IMPLEMENTATION_KINDS, createAiClient } from './index.js';
import { AiClientNotAvailableError } from './errors.js';
import type { AnthropicMessagesApi } from './client.js';
import type { MaskedText } from './mask.js';

const asMasked = (text: string): MaskedText => text as MaskedText;

const TOKENS = { inputTokens: 1, outputTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0 };

describe('createAiClient', () => {
  it('mock は応答スクリプトどおりに答える', async () => {
    const client = createAiClient('mock', { mock: { script: [{ kind: 'output', output: { ok: true } }] } });
    const response = await client.createStructuredMessage({
      modelId: 'model-default',
      system: asMasked('system'),
      userBlocks: [{ type: 'text', text: asMasked('user') }],
      outputSchema: z.object({ ok: z.boolean() }),
      maxOutputTokens: 128,
      timeoutMs: 1000,
    });
    expect(response.output).toEqual({ ok: true });
  });

  it('real は SDK アダプタが渡されていれば組み立てられる', async () => {
    const api: AnthropicMessagesApi = {
      parse: () => Promise.resolve({ output: { ok: true }, modelId: 'model-actual', tokens: TOKENS }),
    };
    const client = createAiClient('real', { messagesApi: api });
    const response = await client.createStructuredMessage({
      modelId: 'model-default',
      system: asMasked('system'),
      userBlocks: [{ type: 'text', text: asMasked('user') }],
      outputSchema: z.object({ ok: z.boolean() }),
      maxOutputTokens: 128,
      timeoutMs: 1000,
    });
    expect(response.modelId).toBe('model-actual');
  });

  it('🔴 real で SDK アダプタが無いときはモックに倒さず throw する（起動を止める）', () => {
    expect(() => createAiClient('real')).toThrow(AiClientNotAvailableError);
  });

  it('🔴 sandboxRecipientScoped は AI に存在しない（宛先分類はメール専用）', () => {
    expect(() => createAiClient('sandboxRecipientScoped')).toThrow(AiClientNotAvailableError);
  });

  it('実装種別の値集合が packages/config と同じ 3 値である（突合は静的テストが行う）', () => {
    expect([...AI_IMPLEMENTATION_KINDS]).toEqual(['real', 'mock', 'sandboxRecipientScoped']);
  });
});
