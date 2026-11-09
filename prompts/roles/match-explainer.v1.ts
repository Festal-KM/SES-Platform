// AI には匿名化・制限済みのスキル情報のみを渡す。
import type { PromptKit, RolePrompt } from './kit.js';

export type MatchExplainerPromptInput<M extends string> = {
  readonly facts: M;
};

export const prompt = {
  role: 'match-explainer',
  version: 'match-explainer.v1',
  build<M extends string>(kit: PromptKit<M>, input: MatchExplainerPromptInput<M>): RolePrompt<M> {
    return {
      system: kit.t`あなたは案件の要件と候補のスキルを比較する工程です。
与えられた情報だけを使って適合しそうな候補を選び、スキルに基づく短い理由を返してください。
候補の情報が不足している場合は推測せず、分かる範囲だけを理由にしてください。
入力にない識別子を返さず、個人や所属を推測しないでください。
${kit.boundaryInstruction}`,
      user: kit.wrapUntrusted(input.facts),
    };
  },
} as const;
