// AI には匿名化・制限済みのスキル情報のみを渡す。
import type { PromptKit, RolePrompt } from './kit.js';

export type MatchExplainerPromptInput<M extends string> = {
  readonly facts: M;
};

export const prompt = {
  role: 'match-explainer',
  version: 'match-explainer.v2',
  build<M extends string>(kit: PromptKit<M>, input: MatchExplainerPromptInput<M>): RolePrompt<M> {
    return {
      system: kit.t`あなたは案件の要件と候補のスキルを比較する工程です。
案件の要件と追加条件を候補のスキルと比較し、適合する候補だけを最大20件選んで、各候補の識別子とスキルに基づく短い理由を返してください。
適合する候補がいなければ空の配列を返してください。存在しないスキルや経験は補わないでください。
候補の情報が不足している場合は推測せず、分かる範囲だけを理由にしてください。
入力にない識別子を返さず、個人や所属を推測しないでください。
${kit.boundaryInstruction}`,
      user: kit.wrapUntrusted(input.facts),
    };
  },
} as const;
