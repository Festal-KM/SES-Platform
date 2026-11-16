import { describe, expect, it } from 'vitest';
import { intakeFactsForAi } from './intake-parse.js';

describe('登録 AI に渡す情報', () => {
  it('許可した技術名だけを受け取り、原文や個人情報の混入を拒否する', () => {
    expect(JSON.parse(intakeFactsForAi({ skills: ['Java', 'AWS'] }))).toEqual({ skills: ['Java', 'AWS'] });
    expect(() => intakeFactsForAi({ skills: ['Java'], original: '山田太郎・80万円' })).toThrow();
    expect(() => intakeFactsForAi({ skills: ['John Smith'] })).toThrow();
    expect(() => intakeFactsForAi({ skills: ['Java', 'Java'] })).toThrow();
    expect(() => intakeFactsForAi({ skills: [] })).toThrow();
  });
});
