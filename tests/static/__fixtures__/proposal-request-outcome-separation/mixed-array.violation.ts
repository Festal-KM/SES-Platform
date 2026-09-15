// 違反 fixture: Proposal の状態と ProposalRequest の状態を 1 つの配列に畳んだ「失敗」区分。
export const FAILED_LIKE = ['GATE_FAILED', 'SUBMIT_FAILED', 'LOST', 'DECLINED', 'EXPIRED'] as const;
