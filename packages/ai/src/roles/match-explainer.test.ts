import { describe, expect, it } from 'vitest';
import { mask } from '../mask.js';
import { matchExplainerOutputSchema, matchExplainerSpec } from './match-explainer.js';

describe('候補選出の AI ロール', () => {
  it('マスキング済みの候補情報を指示と区切って渡す', () => {
    const facts = mask('{"skills":["Java"]}', {
      fullNames: [], birthDates: [], emails: [], phones: [], affiliations: [],
      unitPrices: [], endClientNames: [],
    }).text;
    const prompt = matchExplainerSpec.buildPrompt({ facts });
    expect(prompt.user).toContain('<untrusted_document>');
    expect(prompt.user).toContain('Java');
    expect(prompt.system).toContain('推測');
    expect(prompt.system).toContain('候補の選択と並びは決定済み');
    expect(prompt.system).toContain('すべての候補');
    expect(matchExplainerSpec.promptVersion).toBe('match-explainer.v1');
  });

  it('候補識別子と理由のある応答だけを受け取る', () => {
    expect(matchExplainerOutputSchema.safeParse({ rationales: [{ token: 'temp', reason: 'Java の経験' }] }).success).toBe(true);
    expect(matchExplainerOutputSchema.safeParse({ rationales: [{ token: '', reason: 'Java' }] }).success).toBe(false);
  });
});
