// 違反 fixture: 型名で union を作っている（ProposalState | ProposalRequestState）。
type ProposalState = 'DRAFT' | 'LOST';
type ProposalRequestState = 'REQUESTED' | 'DECLINED';
export type AnyState = ProposalState | ProposalRequestState;
