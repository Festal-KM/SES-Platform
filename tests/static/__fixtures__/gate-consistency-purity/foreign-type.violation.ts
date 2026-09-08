// 違反 fixture: 引数型が**他ファイルで宣言された型**を含む（名前は無害）。
// 実際の破り方は `import type { GateInspectorOutput } from '@ses/ai'` だが、
// 検出の本質は「引数型の出所が gate モジュールの外に出たか」である。

import type { RoleOutput } from './role-output.helper.js';

type Input = {
  readonly subject?: { readonly snapshot: { readonly skills: readonly string[] } };
  readonly upstream: RoleOutput;
};

export function decideConsistency(input: Input): { readonly verdict: 'PASS' | 'FAIL' } {
  return { verdict: input.upstream.verdict };
}
