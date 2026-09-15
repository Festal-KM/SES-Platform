// 適合 fixture: それぞれのエンティティの状態だけを並べている（別々の配列・別々の型）。
export const PROPOSAL_TERMINALS = ['WON', 'LOST', 'WITHDRAWN'] as const;
export const REQUEST_TERMINALS = ['ACCEPTED', 'DECLINED', 'WITHDRAWN_BY_HOST', 'EXPIRED'] as const;
export type RequestClosed = 'DECLINED' | 'WITHDRAWN_BY_HOST' | 'EXPIRED';
export type ProposalFailure = 'GATE_FAILED' | 'SUBMIT_FAILED';
export const WORDS = ['DECLINED', 'please'] as const; // 単独の状態名は他方と混ざっていない
