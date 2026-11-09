import { describe, expect, it } from 'vitest';
import { candidateFactsForAi, parseCandidateMatchPayload } from './match-candidates.js';

const tenantId = '11111111-1111-4111-8111-111111111111';
const runId = '22222222-2222-4222-8222-222222222222';

describe('候補選出ジョブの入力', () => {
  it('テナントと要求の識別子だけを受け付ける', () => {
    expect(parseCandidateMatchPayload({ tenantId, runId })).toEqual({ tenantId, runId });
  });
  it('不正な識別子と候補や会話を含む余分な項目を拒否する', () => {
    expect(() => parseCandidateMatchPayload({ tenantId, runId: 'invalid' })).toThrow();
    expect(() => parseCandidateMatchPayload({ tenantId, runId, message: '個人情報' })).toThrow();
  });
  it('AI に渡す情報から参照先や余分な項目を取り除く', () => {
    const facts = candidateFactsForAi({ requirements: ['Java'], requestedSkills: [], candidates: [
      { token: runId, skills: ['Java'], name: '個人名', price: '秘密単価' },
    ], refs: [{ token: runId, key: '秘密の識別子' }] });
    expect(JSON.parse(facts)).toEqual({ requirements: ['Java'], requestedSkills: [], candidates: [{ token: runId, skills: ['Java'] }] });
    expect(facts).not.toMatch(/個人名|秘密単価|秘密の識別子/);
  });
});
