import { describe, expect, it } from 'vitest';
import { mask } from '../mask.js';
import { skillNormalizerOutputSchema, skillNormalizerSpec } from './skill-normalizer.js';

describe('登録時のスキル整理', () => {
  it('技術名を区切った入力として渡し、応答を検証する', () => {
    const facts = mask('{"skills":["Java"]}', { fullNames: [], birthDates: [], emails: [], phones: [], affiliations: [], unitPrices: [], endClientNames: [] }).text;
    expect(skillNormalizerSpec.buildPrompt({ facts }).user).toContain('<untrusted_document>');
    expect(skillNormalizerOutputSchema.safeParse({ skills: ['Java'] }).success).toBe(true);
    expect(skillNormalizerOutputSchema.safeParse({ skills: Array(51).fill('Java') }).success).toBe(false);
  });
});
