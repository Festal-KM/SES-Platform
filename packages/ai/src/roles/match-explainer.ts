import { z } from 'zod';
import { ROLE_PURPOSE } from '@ses/domain';
import type { MaskedText } from '../mask.js';
import { currentMatchExplainerPrompt, PROMPT_KIT } from '../prompts.js';
import { defineRoleSpec } from './define.js';

// 構造化した候補・要件をマスキングした後の文字列だけを受け取る。
export type MatchExplainerInput = { readonly facts: MaskedText };
const inputSchema: z.ZodType<MatchExplainerInput> = z.object({
  facts: z.custom<MaskedText>((value) => typeof value === 'string' && value.length > 0),
});

export const matchExplainerOutputSchema = z.object({
  rationales: z.array(z.object({
    token: z.string().min(1).max(128),
    reason: z.string().min(1).max(300),
  })).max(20),
});
export type MatchExplainerOutput = z.infer<typeof matchExplainerOutputSchema>;

const prompt = currentMatchExplainerPrompt();
export const matchExplainerSpec = defineRoleSpec<MatchExplainerInput, MatchExplainerOutput>({
  role: 'match-explainer',
  purpose: ROLE_PURPOSE['match-explainer'],
  inputSchema,
  outputSchema: matchExplainerOutputSchema,
  promptVersion: prompt.version,
  buildPrompt: (input) => prompt.build(PROMPT_KIT, input),
  defaultModel: 'DEFAULT',
  maxOutputTokens: 2048,
  timeoutMs: 20000,
});
