// 適合 fixture: 引数型が自ファイル内で閉じ、AI 由来の語も含まない形。
// （tests/static/gate-consistency-purity.test.ts の検出ロジックの対照。実装ではない）

type SkillFacts = {
  readonly skillId: string;
  readonly years: number;
};

type Input = {
  readonly subject?: {
    readonly snapshot: { readonly skills: readonly SkillFacts[] };
    readonly requirements: readonly SkillFacts[];
    readonly registeredSkills: readonly SkillFacts[];
  };
};

export function decideConsistency(input: Input): { readonly verdict: 'PASS' | 'FAIL' } {
  return { verdict: input.subject === undefined ? 'PASS' : 'FAIL' };
}
