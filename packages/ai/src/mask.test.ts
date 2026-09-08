// packages/ai/src/mask.test.ts
// 🔴 **型テスト**（docs/05 §7.2 / §7.8 / docs/03 §4.2）。
//    「マスキングを迂回する入力経路が存在しない」ことと「画像を送れない」ことは、実行時の
//    アサーションではなく**コンパイルできないこと**でしか担保できない。
//    `@ts-expect-error` が意味を持つのは型検査に掛かるときだけなので、`packages/ai` の
//    `pnpm typecheck` は `tsconfig.typecheck.json`（テストを含む）で走らせている。
//
// ⚠️ マスキング関数 `mask()` 本体のテスト（氏名・生年月日・連絡先・会社名・単価・エンド企業名の
//    6 種が除去されること）は **T-07-02** の範囲である。
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import type { AiClientRequest } from './client.js';
import type { ContentBlock, MaskedText } from './mask.js';

const asMasked = (text: string): MaskedText => text as MaskedText;

function buildRequest(system: MaskedText, blocks: readonly ContentBlock[]): AiClientRequest {
  return {
    modelId: 'model-default',
    system,
    userBlocks: blocks,
    outputSchema: z.object({ ok: z.boolean() }),
    maxOutputTokens: 128,
    timeoutMs: 1000,
  };
}

describe('🔴 LLM への入力は MaskedText しか受け取らない', () => {
  it('マスキング済みテキストは渡せる（対照）', () => {
    const request = buildRequest(asMasked('system'), [{ type: 'text', text: asMasked('user') }]);
    expect(request.userBlocks).toHaveLength(1);
  });

  it('生の string は system に渡せない（コンパイルエラー）', () => {
    // @ts-expect-error 🔴 マスキングを経ていない string を LLM へ送る経路は存在しない（BR-11）。
    const request = buildRequest('生の本文', []);
    expect(request.system).toBe('生の本文');
  });

  it('生の string はコンテンツブロックにも渡せない（コンパイルエラー）', () => {
    // @ts-expect-error 🔴 同上。ブロック単位でも迂回できない。
    const blocks: readonly ContentBlock[] = [{ type: 'text', text: '生の本文' }];
    expect(blocks).toHaveLength(1);
  });

  it('🔴 image ブロックは型として存在しない（顔写真を送れない。docs/03 §4.2）', () => {
    // @ts-expect-error 🔴 'image' は ContentBlock の union に無い。
    const blocks: readonly ContentBlock[] = [{ type: 'image', source: { data: 'BASE64' } }];
    expect(blocks).toHaveLength(1);
  });

  it('🔴 document ブロックも型として存在しない（PDF 原本を送れない）', () => {
    // @ts-expect-error 🔴 'document' は ContentBlock の union に無い。
    const blocks: readonly ContentBlock[] = [{ type: 'document', source: { data: 'BASE64' } }];
    expect(blocks).toHaveLength(1);
  });
});
