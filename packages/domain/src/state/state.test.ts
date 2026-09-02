// packages/domain/src/state/state.test.ts
// 状態機械の型置き場（T-01-07）の回帰ガード。CLAUDE.md §4.2 / docs/05 §3.6 / §3.7 / §3.3 が定める
// 状態の個数・値がずれたら機械的に落とす（transition() 本体は SP-08/09/16/17 で追加する）。
import { describe, expect, it } from 'vitest';
import { ASSIGNMENT_STATES } from './assignment.js';
import { CONTRACT_STATES } from './contract.js';
import { PROPOSAL_STATES } from './proposal.js';
import { PROPOSAL_REQUEST_STATES } from './proposalRequest.js';
import { TENANT_LIFECYCLE_STATES } from './tenant.js';

describe('5 状態機械の型置き場（CLAUDE.md §4.2）', () => {
  it('ProposalState は 14 状態がすべて揃っている（docs/05 §3.6）', () => {
    expect(PROPOSAL_STATES).toEqual([
      'DRAFT',
      'GATE_RUNNING',
      'GATE_FAILED',
      'APPROVAL_PENDING',
      'APPROVED',
      'SUBMITTING',
      'SUBMITTED',
      'SUBMIT_FAILED',
      'INTERVIEW_SCHEDULED',
      'INTERVIEWED',
      'RESULT_PENDING',
      'WON',
      'LOST',
      'WITHDRAWN',
    ]);
    expect(new Set(PROPOSAL_STATES).size).toBe(PROPOSAL_STATES.length);
  });

  it('ProposalRequestState は 5 状態がすべて揃っている（docs/05 §3.6）', () => {
    expect(PROPOSAL_REQUEST_STATES).toEqual([
      'REQUESTED',
      'ACCEPTED',
      'DECLINED',
      'WITHDRAWN_BY_HOST',
      'EXPIRED',
    ]);
  });

  it('AssignmentState は 5 状態がすべて揃っている（docs/05 §3.7）', () => {
    expect(ASSIGNMENT_STATES).toEqual(['SCHEDULED', 'ACTIVE', 'EXTENSION_REVIEW', 'ENDING', 'ENDED']);
  });

  it('ContractState は 7 状態がすべて揃っている（docs/05 §3.7）', () => {
    expect(CONTRACT_STATES).toEqual([
      'DRAFT',
      'SENDING',
      'SEND_FAILED',
      'UNDER_REVIEW',
      'EXECUTED',
      'WITHDRAWN',
      'EXPIRED',
    ]);
  });

  it('TenantLifecycleState は 5 状態がすべて揃っている（docs/05 §3.3）', () => {
    expect(TENANT_LIFECYCLE_STATES).toEqual(['SANDBOX', 'ACTIVE', 'SUSPENDED', 'CLOSING', 'PURGED']);
  });
});
