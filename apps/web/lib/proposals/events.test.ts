// apps/web/lib/proposals/events.test.ts
// 🔴 `ProposalEvent.note` の分類（`S-023` の履歴の描き分けの根拠）。T-09-09。
//
// 接頭辞は**書き手の定数**から引く（`PROPOSAL_APPROVAL_NOTE_PREFIX` / `PROPOSAL_RESEND_NOTE_PREFIX` / `PROPOSAL_SEND_FAILURE_NOTE_PREFIX` /
// `PROPOSAL_DRAFT_UPDATED_NOTE_PREFIX`）。ここでは実値も突き合わせ、書き手が印を変えたら分類が同時にずれることを固定する。
import { describe, expect, it } from 'vitest';
import { PROPOSAL_APPROVAL_NOTE_PREFIX, PROPOSAL_SEND_FAILURE_NOTE_PREFIX } from '@ses/db';
import { classifyProposalEventNote, toProposalEventView, type ProposalEventRow } from './events';
import { PROPOSAL_RESEND_NOTE_PREFIX } from './resend';
import { PROPOSAL_DRAFT_UPDATED_NOTE_PREFIX } from './service';

const ROW: ProposalEventRow = {
  id: '01930000-0000-7000-8000-000000000e01',
  kind: 'STATE',
  fromState: 'APPROVAL_PENDING',
  toState: 'APPROVED',
  actorUserId: null,
  note: `${PROPOSAL_APPROVAL_NOTE_PREFIX}01930000-0000-7000-8000-000000000901`,
  attachmentKey: null,
  occurredAt: new Date('2026-09-16T00:00:00.000Z'),
};

describe('classifyProposalEventNote: 書き手の接頭辞で 6 種に分ける', () => {
  it('書き手の定数の実値（変えたら履歴の描き分けが同時にずれる）', () => {
    expect(PROPOSAL_APPROVAL_NOTE_PREFIX).toBe('REVIEW_GATE:');
    expect(PROPOSAL_RESEND_NOTE_PREFIX).toBe('RESEND:');
    expect(PROPOSAL_SEND_FAILURE_NOTE_PREFIX).toBe('SEND_FAILURE:');
    expect(PROPOSAL_DRAFT_UPDATED_NOTE_PREFIX).toBe('DRAFT_UPDATED:');
  });

  it('STATE: 承認 / 再送 / 送信失敗 / 素の遷移（却下の理由・#48 のメモ・null）', () => {
    expect(classifyProposalEventNote('STATE', `${PROPOSAL_APPROVAL_NOTE_PREFIX}gate-1`, 'HOST')).toEqual({ kind: 'APPROVAL', reviewGateId: 'gate-1' });
    expect(classifyProposalEventNote('STATE', `${PROPOSAL_RESEND_NOTE_PREFIX}電話で未着を確認`, 'HOST')).toEqual({ kind: 'RESEND', reason: '電話で未着を確認' });
    expect(classifyProposalEventNote('STATE', `${PROPOSAL_SEND_FAILURE_NOTE_PREFIX}UNKNOWN:TimeoutError`, 'HOST')).toEqual({
      kind: 'SEND_FAILURE',
      failureKind: 'UNKNOWN:TimeoutError',
    });
    expect(classifyProposalEventNote('STATE', '単価を見直してください', 'HOST')).toEqual({ kind: 'TRANSITION', note: '単価を見直してください' });
    expect(classifyProposalEventNote('STATE', null, 'HOST')).toEqual({ kind: 'TRANSITION', note: null });
  });

  it('🔴 取引先には再送の理由と送信失敗の種別を伏せる（出来事は残す）。承認の検査 ID と却下の理由は見える', () => {
    expect(classifyProposalEventNote('STATE', `${PROPOSAL_RESEND_NOTE_PREFIX}電話で未着を確認`, 'PARTNER')).toEqual({ kind: 'RESEND', reason: null });
    expect(classifyProposalEventNote('STATE', `${PROPOSAL_SEND_FAILURE_NOTE_PREFIX}UNKNOWN:TimeoutError`, 'PARTNER')).toEqual({ kind: 'SEND_FAILURE', failureKind: null });
    expect(classifyProposalEventNote('STATE', `${PROPOSAL_APPROVAL_NOTE_PREFIX}gate-1`, 'PARTNER')).toEqual({ kind: 'APPROVAL', reviewGateId: 'gate-1' });
    expect(classifyProposalEventNote('STATE', '単価を見直してください', 'PARTNER')).toEqual({ kind: 'TRANSITION', note: '単価を見直してください' });
  });

  it('NOTE: 下書きの更新（項目名の配列）/ 人手のメモ / 空文字は OTHER', () => {
    expect(classifyProposalEventNote('NOTE', `${PROPOSAL_DRAFT_UPDATED_NOTE_PREFIX}subject,body`, 'HOST')).toEqual({ kind: 'DRAFT_UPDATED', fields: ['subject', 'body'] });
    expect(classifyProposalEventNote('NOTE', `${PROPOSAL_DRAFT_UPDATED_NOTE_PREFIX}`, 'PARTNER')).toEqual({ kind: 'DRAFT_UPDATED', fields: [] });
    expect(classifyProposalEventNote('NOTE', '先方に電話済み', 'PARTNER')).toEqual({ kind: 'NOTE', note: '先方に電話済み' });
    expect(classifyProposalEventNote('NOTE', '', 'HOST')).toEqual({ kind: 'OTHER', note: '' });
    expect(classifyProposalEventNote('NOTE', null, 'HOST')).toEqual({ kind: 'OTHER', note: null });
  });

  it('🔴 人手のメモが接頭辞と同じ文字列で始まっても STATE 側の印には化けない（kind が違う）。ATTACHMENT / 未知は OTHER', () => {
    expect(classifyProposalEventNote('NOTE', `${PROPOSAL_RESEND_NOTE_PREFIX}x`, 'HOST')).toEqual({ kind: 'NOTE', note: `${PROPOSAL_RESEND_NOTE_PREFIX}x` });
    expect(classifyProposalEventNote('ATTACHMENT', 'sheet', 'HOST')).toEqual({ kind: 'OTHER', note: 'sheet' });
    expect(classifyProposalEventNote('BOGUS', null, 'HOST')).toEqual({ kind: 'OTHER', note: null });
  });
});

describe('toProposalEventView', () => {
  it('actorUserId = null はシステム。人間は表示名（読めなければ null）。actorUserId そのものは応答に載らない', () => {
    const system = toProposalEventView(ROW, new Map(), 'HOST');
    expect(system).toEqual({
      id: ROW.id,
      occurredAt: '2026-09-16T00:00:00.000Z',
      actor: { kind: 'SYSTEM' },
      kind: 'STATE',
      fromState: 'APPROVAL_PENDING',
      toState: 'APPROVED',
      entry: { kind: 'APPROVAL', reviewGateId: '01930000-0000-7000-8000-000000000901' },
      attachmentKey: null,
    });
    const userId = '01930000-0000-7000-8000-0000000000d1';
    const human = toProposalEventView({ ...ROW, actorUserId: userId, note: null }, new Map([[userId, '承認 花子']]), 'HOST');
    expect(human.actor).toEqual({ kind: 'USER', displayName: '承認 花子' });
    expect(JSON.stringify(human)).not.toContain(userId);
    expect(toProposalEventView({ ...ROW, actorUserId: userId }, new Map(), 'PARTNER').actor).toEqual({ kind: 'USER', displayName: null });
  });

  it('未知の状態は握り潰さない', () => {
    expect(() => toProposalEventView({ ...ROW, toState: 'BOGUS' }, new Map(), 'HOST')).toThrow(RangeError);
  });
});
