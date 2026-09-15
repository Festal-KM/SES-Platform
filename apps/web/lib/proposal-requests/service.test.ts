// apps/web/lib/proposal-requests/service.test.ts
// 提案依頼の状態遷移と期限検証のユニットテスト（`CLAUDE.md` §4.2 `ProposalRequest` / `F-018` 処理⑤⑥ /
// docs/05 §6.5「#31 / #35 の実装の決着」）。T-08-06。
//
// 🔴 ここで固定するもの（DB 無し）:
//   ① `REQUESTED → WITHDRAWN_BY_HOST` は遷移表にあり、それ以外の状態からの取り下げは
//      `InvalidStateTransitionError`（サイレントに無視しない。`BR-33`）。判定は `@ses/domain` の 1 か所であり、
//      `withdrawProposalRequest` はこれを呼ぶだけである（実 DB を通した確認は
//      `tests/isolation/proposal-requests.test.ts`）
//   ② 返答期限は「現在より後、かつ 30 日以内」。外れたら 400（`ValidationError`）で、`details` は
//      フィールドパスだけ（値を載せない）
//   ③ 監査 action は `*.create` / `*.update` の接尾辞（`S-041` のフィルタから漏れない）
import { describe, expect, it } from 'vitest';
import { PROPOSAL_REQUEST_AUDIT_ACTION_CREATE } from '@ses/db';
import {
  InvalidStateTransitionError,
  PROPOSAL_REQUEST_STATES,
  proposalRequestMachine,
  type ProposalRequestState,
} from '@ses/domain';
import { ValidationError } from '../api/errors';
import {
  PROPOSAL_REQUEST_AUDIT_ACTIONS,
  PROPOSAL_REQUEST_OPERATIONS,
  validateExpiresAt,
} from './service';

const NOW = new Date('2026-09-15T03:00:00.000Z');

/** DB から読んだ状態は型が広がる —— その形を再現する（宣言した戻り値型で CFA の絞り込みを断つ）。 */
function widen(state: ProposalRequestState): ProposalRequestState {
  return state;
}

describe('🔴 F-018 状態遷移: REQUESTED → WITHDRAWN_BY_HOST だけがホストの取り下げとして成立する', () => {
  it('REQUESTED からの取り下げは遷移表にある', () => {
    expect(proposalRequestMachine.transition('REQUESTED', 'WITHDRAWN_BY_HOST')).toBe('WITHDRAWN_BY_HOST');
    expect(proposalRequestMachine.canTransition('REQUESTED', 'WITHDRAWN_BY_HOST')).toBe(true);
  });

  it.each(
    PROPOSAL_REQUEST_STATES.filter((state): state is Exclude<ProposalRequestState, 'REQUESTED'> => state !== 'REQUESTED'),
  )('🔴 %s からの取り下げは InvalidStateTransitionError（422）', (from) => {
    expect(proposalRequestMachine.canTransition(from, 'WITHDRAWN_BY_HOST')).toBe(false);
    // 🔴 DB から読んだ状態は型が広がるため、実行時の判定で必ず落ちることを見る。
    expect(() => proposalRequestMachine.transition(widen(from), 'WITHDRAWN_BY_HOST')).toThrow(
      InvalidStateTransitionError,
    );
    try {
      proposalRequestMachine.transition(widen(from), 'WITHDRAWN_BY_HOST');
    } catch (error) {
      expect(error).toBeInstanceOf(InvalidStateTransitionError);
      if (error instanceof InvalidStateTransitionError) {
        expect(error.entity).toBe('ProposalRequest');
        expect(error.from).toBe(from);
        expect(error.to).toBe('WITHDRAWN_BY_HOST');
        expect(error.httpStatus).toBe(422);
      }
    }
  });

  it('🔴 WITHDRAWN_BY_HOST は終端である（状態を足していない。CLAUDE.md §4.2 の図が全体）', () => {
    expect(proposalRequestMachine.isTerminal('WITHDRAWN_BY_HOST')).toBe(true);
    expect(proposalRequestMachine.nextStates('REQUESTED')).toEqual([
      'ACCEPTED',
      'DECLINED',
      'WITHDRAWN_BY_HOST',
      'EXPIRED',
    ]);
    expect([...PROPOSAL_REQUEST_STATES]).toEqual(['REQUESTED', 'ACCEPTED', 'DECLINED', 'WITHDRAWN_BY_HOST', 'EXPIRED']);
  });
});

describe('返答期限の検証（現在より後、かつ 30 日以内）', () => {
  it('現在の 1 秒後から 30 日後（ちょうど）までは通る', () => {
    expect(validateExpiresAt('2026-09-15T03:00:01.000Z', NOW).toISOString()).toBe('2026-09-15T03:00:01.000Z');
    expect(validateExpiresAt('2026-10-15T03:00:00.000Z', NOW).toISOString()).toBe('2026-10-15T03:00:00.000Z');
    // オフセット付きも受ける（画面は JST の日末を送る）。
    expect(validateExpiresAt('2026-09-22T23:59:59+09:00', NOW).toISOString()).toBe('2026-09-22T14:59:59.000Z');
  });

  it.each([
    ['現在と同時刻', '2026-09-15T03:00:00.000Z'],
    ['過去', '2026-09-14T00:00:00.000Z'],
    ['30 日 + 1 秒後', '2026-10-15T03:00:01.000Z'],
    ['解析できない', 'not-a-date'],
  ])('🔴 %s は 400（details はフィールドパスだけで、値を載せない）', (_label, iso) => {
    try {
      validateExpiresAt(iso, NOW);
      expect.fail('ValidationError が投げられていない');
    } catch (error) {
      expect(error).toBeInstanceOf(ValidationError);
      if (error instanceof ValidationError) {
        expect(error.httpStatus).toBe(400);
        expect(error.details).toEqual(['body.expiresAt']);
        expect(JSON.stringify(error.details)).not.toContain(iso.slice(0, 10));
      }
    }
  });
});

describe('監査 action（docs/05 §16.1。独自 action を作らない）', () => {
  it('発行は *.create、取り下げは *.update + operation=WITHDRAW、遷移拒否は state.invalid_transition', () => {
    expect(PROPOSAL_REQUEST_AUDIT_ACTION_CREATE).toBe('proposal_request.create');
    expect(PROPOSAL_REQUEST_AUDIT_ACTIONS.update).toBe('proposal_request.update');
    expect(PROPOSAL_REQUEST_AUDIT_ACTIONS.invalidTransition).toBe('state.invalid_transition');
    expect(PROPOSAL_REQUEST_OPERATIONS.withdraw).toBe('WITHDRAW');
  });
});
