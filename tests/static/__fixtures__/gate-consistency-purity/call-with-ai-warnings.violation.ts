// 違反 fixture（呼び出し側）: gate-inspector の出力を整合層の入力に流し込んでいる。
// 🔴 T-07-06（パイプライン）でいちばん起きやすい破り方であり、引数型だけでは
//    （`as` を 1 つ書かれると）止まらない。呼び出し式そのものを見る。
declare function decideConsistency(input: unknown): { readonly verdict: string };
declare const subject: unknown;
declare const aiResult: { readonly output: { readonly consistencyWarnings: readonly string[] } };

export const decision = decideConsistency({
  subject,
  aiWarnings: aiResult.output.consistencyWarnings,
});
