import { describe, expect, it } from 'vitest';
import type { CandidateRowView } from './list-rows';
import { orderCandidateReasons, prepareCandidateFacts, resolveCandidateTokens, selectCandidatesForExplanation } from './ai-input';

const own: CandidateRowView = {
  kind: 'OWN', key: 'private-id', id: 'private-id', displayName: '個人名', skills: ['Java'],
  moreSkills: null, skillCount: 1, years: '5', unitPrice: '秘密単価', availableFrom: '今月',
  location: '東京', availabilityStatus: '待機', updatedOn: '2026-11-01',
};
const shared: CandidateRowView = {
  kind: 'ANONYMOUS', key: 'private-ref', candidateRef: 'private-ref', skills: ['AWS'],
  allSkills: ['AWS', 'Linux'], moreSkills: null, skillCount: 2, years: '5〜10',
  unitPrice: '秘密単価', availableFrom: '来月', location: '東京', updatedOn: '2026-11-01',
};

describe('AI に渡す候補情報', () => {
  it('既存の順で最大20人を選び、AI の返却順や欠落で選択を変えない', () => {
    expect(selectCandidatesForExplanation(Array.from({ length: 21 }, () => own))).toHaveLength(20);
    expect(orderCandidateReasons(['a', 'b'], [{ token: 'b', reason: 'B' }, { token: 'a', reason: 'A' }])).toEqual([
      { token: 'a', reason: 'A' }, { token: 'b', reason: 'B' },
    ]);
    expect(() => orderCandidateReasons(['a', 'b'], [{ token: 'a', reason: 'A' }])).toThrow();
    expect(() => orderCandidateReasons(['a'], [{ token: 'a', reason: 'A' }, { token: 'a', reason: '重複' }])).toThrow();
    expect(() => orderCandidateReasons(['a'], [{ token: 'b', reason: '未知' }])).toThrow();
  });
  it('スキルと一時識別子だけを渡し、元の候補は外部送信しない', () => {
    const tokens = ['一時1', '一時2'];
    const result = prepareCandidateFacts([own, shared], () => tokens.shift() ?? '');
    expect(result.input).toEqual({ candidates: [
      { token: '一時1', skills: ['Java'] },
      { token: '一時2', skills: ['AWS', 'Linux'] },
    ] });
    expect(JSON.stringify(result.input)).not.toMatch(/個人名|秘密単価|private/);
    expect(resolveCandidateTokens(['一時2'], result.byToken)).toEqual([shared]);
  });

  it('未知または重複した候補は受け付けない', () => {
    const result = prepareCandidateFacts([own], () => '一時1');
    expect(() => resolveCandidateTokens(['未知'], result.byToken)).toThrow();
    expect(() => resolveCandidateTokens(['一時1', '一時1'], result.byToken)).toThrow();
    expect(() => prepareCandidateFacts([own, shared], () => '同じ')).toThrow();
  });
});
