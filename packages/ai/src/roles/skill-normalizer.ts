import { z } from 'zod';
import { ROLE_PURPOSE } from '@ses/domain';
import type { MaskedText } from '../mask.js';
import { currentSkillNormalizerPrompt, PROMPT_KIT } from '../prompts.js';
import { defineRoleSpec } from './define.js';

export type SkillNormalizerInput = { readonly facts: MaskedText };
const inputSchema: z.ZodType<SkillNormalizerInput> = z.object({
  facts: z.custom<MaskedText>((value) => typeof value === 'string' && value.length > 0),
});
export const skillNormalizerOutputSchema = z.object({ skills: z.array(z.string().min(1).max(80)).max(50) });
export type SkillNormalizerOutput = z.infer<typeof skillNormalizerOutputSchema>;
const prompt = currentSkillNormalizerPrompt();
export const skillNormalizerSpec = defineRoleSpec<SkillNormalizerInput, SkillNormalizerOutput>({
  role: 'skill-normalizer', purpose: ROLE_PURPOSE['skill-normalizer'], inputSchema,
  outputSchema: skillNormalizerOutputSchema, promptVersion: prompt.version,
  buildPrompt: (input) => prompt.build(PROMPT_KIT, input), defaultModel: 'DEFAULT',
  maxOutputTokens: 1024, timeoutMs: 30000,
});
