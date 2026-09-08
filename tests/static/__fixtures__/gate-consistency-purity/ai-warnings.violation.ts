// 違反 fixture: 引数型に AI の警告が現れる（BR-61 の破り方そのもの）。
// 型の宣言場所は自ファイル内なので「出所」の検査では捕まらない —— 語彙の検査が捕まえる。

type GateInspectorWarning = {
  readonly kind: string;
  readonly excerpt: string;
};

type Input = {
  readonly subject?: { readonly snapshot: { readonly skills: readonly string[] } };
  readonly aiWarnings: readonly GateInspectorWarning[];
};

export function decideConsistency(input: Input): { readonly verdict: 'PASS' | 'FAIL' } {
  return { verdict: input.aiWarnings.length === 0 ? 'PASS' : 'FAIL' };
}
