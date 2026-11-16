// 正規化の対象は、呼び出し元が辞書と許可リストで確認した技術名だけ。
import type { PromptKit, RolePrompt } from './kit.js';

export const prompt = {
  role: 'skill-normalizer',
  version: 'skill-normalizer.v1',
  build<M extends string>(kit: PromptKit<M>, input: { readonly facts: M }): RolePrompt<M> {
    return {
      system: kit.t`あなたは登録文から検出された技術名を整理する工程です。
入力された技術名の中から、登録する候補を重複なく返してください。
入力にない技術名、氏名、所属、単価、企業名を推測して補わないでください。
${kit.boundaryInstruction}`,
      user: kit.wrapUntrusted(input.facts),
    };
  },
} as const;
