// 適合 fixture（呼び出し側）: 永続化された値だけを組み立てて渡している。
declare function decideConsistency(input: unknown): { readonly verdict: string };
declare const proposal: unknown;
declare function buildConsistencySubject(source: unknown): unknown;

export const decision = decideConsistency({ subject: buildConsistencySubject(proposal) });
