// 違反 fixture の相方: 別ファイルで宣言された型（`packages/ai` のロール出力に相当）。
// 名前を無害に見せかけても、**出所**の検査で捕まることの対照である。

export type RoleOutput = {
  readonly verdict: 'PASS' | 'FAIL';
  readonly notes: readonly string[];
};
