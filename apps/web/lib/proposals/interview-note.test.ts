// apps/web/lib/proposals/interview-note.test.ts
// `S-024` の `note` の組み立て（T-09-10。docs/05 §6.5「`S-024` の実装の決着」）。
//
// 🔴 固定するもの:
//   ① `note` に入るのは利用者の入力と状態を表す固定の語だけ（単価・本文・氏名を受け取る入力面が無い = 型が固定する）
//   ② 接頭辞（`REVIEW_GATE:` / `RESEND:` / `SEND_FAILURE:` / `DRAFT_UPDATED:`）と衝突しない
//   ③ 空欄は `undefined`（#48 の `note` は `min(1)` の任意項目）
//   ④ 固定の語 + 上限いっぱいの要点でも #48 の `note`（2,000 文字）を超えない
import { describe, expect, it } from 'vitest';
import { t } from '@ses/i18n';
import { PROPOSAL_APPROVAL_NOTE_PREFIX, PROPOSAL_SEND_FAILURE_NOTE_PREFIX } from '@ses/db';
import {
  buildProposalInterviewNote,
  formatInterviewDateTimeInput,
  isInterviewInputComplete,
  isTerminalInterviewOperation,
  PROPOSAL_INTERVIEW_MEMO_MAX_LENGTH,
  PROPOSAL_INTERVIEW_OPERATION_KINDS,
  PROPOSAL_INTERVIEW_TERMINAL_OPERATIONS,
  type ProposalInterviewNoteLabels,
} from './interview-note';
import { PROPOSAL_RESEND_NOTE_PREFIX } from './resend';
import { PROPOSAL_NOTE_MAX_LENGTH } from './schemas';
import { PROPOSAL_DRAFT_UPDATED_NOTE_PREFIX } from './service';

const labels: ProposalInterviewNoteLabels = {
  scheduled: t('proposals.interview.note.scheduled'),
  interviewed: t('proposals.interview.note.interviewed'),
  won: t('proposals.interview.note.won'),
  lost: t('proposals.interview.note.lost'),
  withdrawn: t('proposals.interview.note.withdrawn'),
  separator: t('proposals.interview.note.separator'),
  reasonOpen: t('proposals.interview.note.reasonOpen'),
  reasonClose: t('proposals.interview.note.reasonClose'),
};

const empty = { scheduledAt: '', interviewedOn: '', memo: '' };

describe('buildProposalInterviewNote（S-024 が #48 の note を組む規則）', () => {
  it('SCHEDULE: 「面談日程: YYYY-MM-DD HH:mm」。要点があれば " / " で続ける', () => {
    expect(buildProposalInterviewNote('SCHEDULE', { ...empty, scheduledAt: '2026-10-01T14:00' }, labels)).toBe('面談日程: 2026-10-01 14:00');
    expect(buildProposalInterviewNote('SCHEDULE', { ...empty, scheduledAt: '2026-10-01T14:00', memo: ' 先方オフィス ' }, labels)).toBe(
      '面談日程: 2026-10-01 14:00 / 先方オフィス',
    );
  });

  it('INTERVIEWED: 「面談実施: YYYY-MM-DD」。要点があれば続ける', () => {
    expect(buildProposalInterviewNote('INTERVIEWED', { ...empty, interviewedOn: '2026-10-01' }, labels)).toBe('面談実施: 2026-10-01');
    expect(buildProposalInterviewNote('INTERVIEWED', { ...empty, interviewedOn: '2026-10-01', memo: '技術面は好評' }, labels)).toBe('面談実施: 2026-10-01 / 技術面は好評');
  });

  it('RESULT_PENDING: 要点だけ。空なら undefined（note を送らない）', () => {
    expect(buildProposalInterviewNote('RESULT_PENDING', empty, labels)).toBeUndefined();
    expect(buildProposalInterviewNote('RESULT_PENDING', { ...empty, memo: '来週中に連絡あり' }, labels)).toBe('来週中に連絡あり');
  });

  it('WON / LOST / WITHDRAWN: 「結果: 決定」「結果: 見送り」「辞退」。理由は（）で添える', () => {
    expect(buildProposalInterviewNote('WON', empty, labels)).toBe('結果: 決定');
    expect(buildProposalInterviewNote('LOST', { ...empty, memo: '単価' }, labels)).toBe('結果: 見送り（単価）');
    expect(buildProposalInterviewNote('WITHDRAWN', { ...empty, memo: '本人都合' }, labels)).toBe('辞退（本人都合）');
  });

  it('🔴 見送り（LOST）の語は「送信失敗」「検査で不合格」「依頼を辞退」と別（F-025 AC-3 / BR-23）', () => {
    const lost = buildProposalInterviewNote('LOST', empty, labels) ?? '';
    expect(lost).toContain(t('proposals.state.LOST'));
    for (const other of [t('proposals.state.SUBMIT_FAILED'), t('proposals.state.GATE_FAILED'), t('proposals.list.requestState.DECLINED')]) {
      expect(lost).not.toContain(other);
    }
  });

  it('🔴 組んだ note は書き手の接頭辞（events.ts の分類の印）で始まらない = S-023 では TRANSITION の自由記述として描かれる', () => {
    const prefixes = [PROPOSAL_APPROVAL_NOTE_PREFIX, PROPOSAL_RESEND_NOTE_PREFIX, PROPOSAL_SEND_FAILURE_NOTE_PREFIX, PROPOSAL_DRAFT_UPDATED_NOTE_PREFIX];
    for (const kind of PROPOSAL_INTERVIEW_OPERATION_KINDS) {
      const note = buildProposalInterviewNote(kind, { scheduledAt: '2026-10-01T14:00', interviewedOn: '2026-10-01', memo: '要点' }, labels) ?? '';
      expect(note.length).toBeGreaterThan(0);
      for (const prefix of prefixes) expect(note.startsWith(prefix), `${kind}: ${note}`).toBe(false);
    }
  });

  it('🔴 固定の語 + 上限いっぱいの要点でも #48 の note の上限（2,000）を超えない', () => {
    const memo = 'あ'.repeat(PROPOSAL_INTERVIEW_MEMO_MAX_LENGTH);
    for (const kind of PROPOSAL_INTERVIEW_OPERATION_KINDS) {
      const note = buildProposalInterviewNote(kind, { scheduledAt: '2026-10-01T14:00', interviewedOn: '2026-10-01', memo }, labels) ?? '';
      expect(note.length).toBeLessThanOrEqual(PROPOSAL_NOTE_MAX_LENGTH);
    }
  });

  it('日時入力は TZ 変換せず、T を空白に置き換えるだけ', () => {
    expect(formatInterviewDateTimeInput(' 2026-10-01T09:30 ')).toBe('2026-10-01 09:30');
  });
});

describe('isInterviewInputComplete / 終端の判定', () => {
  it('SCHEDULE は日時、INTERVIEWED は日付が必須。他は入力なしで完了', () => {
    expect(isInterviewInputComplete('SCHEDULE', empty)).toBe(false);
    expect(isInterviewInputComplete('SCHEDULE', { ...empty, scheduledAt: '2026-10-01T14:00' })).toBe(true);
    expect(isInterviewInputComplete('INTERVIEWED', empty)).toBe(false);
    expect(isInterviewInputComplete('INTERVIEWED', { ...empty, interviewedOn: '2026-10-01' })).toBe(true);
    for (const kind of ['RESULT_PENDING', 'WON', 'LOST', 'WITHDRAWN'] as const) expect(isInterviewInputComplete(kind, empty)).toBe(true);
  });

  it('🔴 終端（WON / LOST / WITHDRAWN）だけが確認ステップを持つ', () => {
    expect([...PROPOSAL_INTERVIEW_TERMINAL_OPERATIONS]).toEqual(['WON', 'LOST', 'WITHDRAWN']);
    for (const kind of PROPOSAL_INTERVIEW_OPERATION_KINDS) {
      expect(isTerminalInterviewOperation(kind)).toBe(kind === 'WON' || kind === 'LOST' || kind === 'WITHDRAWN');
    }
  });
});
