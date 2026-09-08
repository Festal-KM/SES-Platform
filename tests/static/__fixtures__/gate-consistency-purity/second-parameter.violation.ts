// 違反 fixture: 第 2 引数に AI の出力を足す（「入力型は綺麗なまま」の抜け道）。
// 検査は **すべての引数** を見る。

type Input = {
  readonly subject?: { readonly snapshot: { readonly skills: readonly string[] } };
};

type InspectorResult = { readonly warnings: readonly string[] };

export function decideConsistency(
  input: Input,
  aiResult: InspectorResult,
): { readonly verdict: 'PASS' | 'FAIL' } {
  return { verdict: input.subject === undefined && aiResult.warnings.length === 0 ? 'PASS' : 'FAIL' };
}
