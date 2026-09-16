// apps/web/lib/proposals/schemas.test.ts
// #36 / #37 の境界検証（docs/05 §6.5「T-09-01 の決着」）。T-09-01。
//
// 🔴 固定するもの:
//   ① #36 は案件・エンジニア・提案先（会社名 + メールアドレス）が必須（`docs/04` §S-020 改訂 10）
//   ② #37 は部分更新だが、提案先の 2 列は**空にできない**（`null` も空文字も 400）
//   ③ `proposalRequestId` / 分離キー / `state` / `contentHash` / `approvedBy` は受け取らない（strip）
//   ④ 添付は `skillSheetId`（UUID | null）だけで受ける
import { describe, expect, it } from 'vitest';
import { PROPOSAL_MANUAL_TRANSITION_TARGET_STATES, PROPOSAL_REQUEST_STATES, PROPOSAL_STATES } from '@ses/domain';
import { ISOLATION_KEYS } from '../api/isolation-keys';
import {
  createProposalBodySchema,
  newProposalQuerySchema,
  transitionProposalBodySchema,
  UPDATE_PROPOSAL_FIELDS,
  updateProposalBodySchema,
  rejectProposalBodySchema,
  createProposalEventBodySchema,
  PROPOSAL_NOTE_MAX_LENGTH,
  proposalListQuerySchema,
} from './schemas';

const PROJECT = '01930000-0000-7000-8000-0000000000f1';
const ENGINEER = '01930000-0000-7000-8000-0000000000e1';
const SHEET = '01930000-0000-7000-8000-000000000501';

const MINIMAL_CREATE = {
  projectId: PROJECT,
  engineerId: ENGINEER,
  recipientCompanyName: '架空エンド株式会社',
  recipientEmail: 'Recipient@Example.test',
};

describe('createProposalBodySchema（#36）', () => {
  it('案件・エンジニア・提案先が揃えば通り、任意項目は null に既定化される', () => {
    const parsed = createProposalBodySchema.parse(MINIMAL_CREATE);
    expect(parsed).toEqual({
      ...MINIMAL_CREATE,
      recipientEmail: 'recipient@example.test',
      offeredUnitPrice: null,
      offeredStartDate: null,
      workStyle: null,
      subject: null,
      body: null,
    });
  });

  it('🔴 提案先の会社名・メールアドレスは必須（空文字・欠落・不正なメールは 400）', () => {
    expect(createProposalBodySchema.safeParse({ ...MINIMAL_CREATE, recipientCompanyName: '' }).success).toBe(false);
    expect(createProposalBodySchema.safeParse({ ...MINIMAL_CREATE, recipientCompanyName: '   ' }).success).toBe(false);
    expect(createProposalBodySchema.safeParse({ ...MINIMAL_CREATE, recipientEmail: 'not-an-email' }).success).toBe(false);
    const withoutEmail: Record<string, unknown> = { ...MINIMAL_CREATE };
    delete withoutEmail.recipientEmail;
    expect(createProposalBodySchema.safeParse(withoutEmail).success).toBe(false);
  });

  it('案件とエンジニアは UUID が必須', () => {
    expect(createProposalBodySchema.safeParse({ ...MINIMAL_CREATE, engineerId: 'x' }).success).toBe(false);
    const withoutProject: Record<string, unknown> = { ...MINIMAL_CREATE };
    delete withoutProject.projectId;
    expect(createProposalBodySchema.safeParse(withoutProject).success).toBe(false);
  });

  it('🔴 proposalRequestId / 分離キー / state / contentHash / approvedBy を受け取らない（strip）', () => {
    const parsed = createProposalBodySchema.parse({
      ...MINIMAL_CREATE,
      proposalRequestId: '01930000-0000-7000-8000-000000000201',
      tenantId: 'x',
      ownerPartnerCompanyId: 'x',
      state: 'APPROVED',
      contentHash: 'abc',
      approvedBy: 'x',
    });
    expect(Object.keys(parsed)).not.toContain('proposalRequestId');
    expect(Object.keys(parsed)).not.toContain('state');
    expect(Object.keys(parsed)).not.toContain('contentHash');
    expect(Object.keys(parsed)).not.toContain('approvedBy');
    for (const key of ISOLATION_KEYS) expect(Object.keys(parsed)).not.toContain(key);
  });

  it('提案条件の範囲（単価は 0 以上の整数、開始日は YYYY-MM-DD）', () => {
    expect(createProposalBodySchema.safeParse({ ...MINIMAL_CREATE, offeredUnitPrice: -1 }).success).toBe(false);
    expect(createProposalBodySchema.safeParse({ ...MINIMAL_CREATE, offeredUnitPrice: 1.5 }).success).toBe(false);
    expect(createProposalBodySchema.safeParse({ ...MINIMAL_CREATE, offeredStartDate: '2026/11/01' }).success).toBe(false);
    expect(createProposalBodySchema.safeParse({ ...MINIMAL_CREATE, offeredUnitPrice: 650000, offeredStartDate: '2026-11-01' }).success).toBe(true);
  });
});

describe('updateProposalBodySchema（#37）', () => {
  it('部分更新: 未指定 = 変更しない（空の body も通る）', () => {
    expect(updateProposalBodySchema.parse({})).toEqual({});
    expect(updateProposalBodySchema.parse({ subject: '  ご提案  ' })).toEqual({ subject: 'ご提案' });
  });

  it('🔴 提案先の 2 列は設定・変更はできるが、空にはできない（null / 空文字 / 不正なメールは 400）', () => {
    expect(updateProposalBodySchema.safeParse({ recipientCompanyName: '架空エンド株式会社' }).success).toBe(true);
    expect(updateProposalBodySchema.safeParse({ recipientCompanyName: null }).success).toBe(false);
    expect(updateProposalBodySchema.safeParse({ recipientCompanyName: '' }).success).toBe(false);
    expect(updateProposalBodySchema.safeParse({ recipientEmail: null }).success).toBe(false);
    expect(updateProposalBodySchema.safeParse({ recipientEmail: 'nope' }).success).toBe(false);
  });

  it('任意項目は null で消せる（本文・件名・条件）', () => {
    expect(updateProposalBodySchema.parse({ subject: null, body: null, offeredUnitPrice: null, offeredStartDate: null, workStyle: null })).toEqual({
      subject: null,
      body: null,
      offeredUnitPrice: null,
      offeredStartDate: null,
      workStyle: null,
    });
  });

  it('添付は skillSheetId（UUID | null）だけで受ける', () => {
    expect(updateProposalBodySchema.parse({ skillSheetId: SHEET })).toEqual({ skillSheetId: SHEET });
    expect(updateProposalBodySchema.parse({ skillSheetId: null })).toEqual({ skillSheetId: null });
    expect(updateProposalBodySchema.safeParse({ skillSheetId: 'x' }).success).toBe(false);
  });

  it('🔴 state / contentHash / engineerId / projectId / 分離キーを受け取らない（strip）', () => {
    const parsed = updateProposalBodySchema.parse({
      state: 'APPROVED',
      contentHash: 'abc',
      engineerId: ENGINEER,
      projectId: PROJECT,
      tenantId: 'x',
      ownerPartnerCompanyId: 'x',
    });
    expect(parsed).toEqual({});
  });

  it('UPDATE_PROPOSAL_FIELDS はスキーマのキーそのものである', () => {
    expect([...UPDATE_PROPOSAL_FIELDS]).toEqual(Object.keys(updateProposalBodySchema.shape));
  });
});

describe('newProposalQuerySchema（S-020 新規の query）', () => {
  it('案件とエンジニアの UUID が必須', () => {
    expect(newProposalQuerySchema.parse({ projectId: PROJECT, engineerId: ENGINEER })).toEqual({ projectId: PROJECT, engineerId: ENGINEER });
    expect(newProposalQuerySchema.safeParse({ projectId: PROJECT }).success).toBe(false);
    expect(newProposalQuerySchema.safeParse({ projectId: 'x', engineerId: ENGINEER }).success).toBe(false);
  });
});

describe('transitionProposalBodySchema（#48。T-09-02。docs/05 §6.5「#48 の実装の決着」）', () => {
  it('to は手動遷移の遷移先 7 値だけを受け、note は任意', () => {
    expect(transitionProposalBodySchema.parse({ to: 'WON' })).toEqual({ to: 'WON' });
    expect(transitionProposalBodySchema.parse({ to: 'WITHDRAWN', note: ' 先方都合により辞退 ' })).toEqual({
      to: 'WITHDRAWN',
      note: '先方都合により辞退',
    });
    for (const to of PROPOSAL_MANUAL_TRANSITION_TARGET_STATES) {
      expect(transitionProposalBodySchema.safeParse({ to }).success, to).toBe(true);
    }
  });

  it('🔴 承認・送信・ゲート側の状態は入力面に存在しない（400）: APPROVED / SUBMITTING / SUBMITTED / SUBMIT_FAILED / GATE_RUNNING / APPROVAL_PENDING / GATE_FAILED', () => {
    const reserved = PROPOSAL_STATES.filter(
      (state) => !(PROPOSAL_MANUAL_TRANSITION_TARGET_STATES as readonly string[]).includes(state),
    );
    expect(reserved).toEqual([
      'GATE_RUNNING',
      'GATE_FAILED',
      'APPROVAL_PENDING',
      'APPROVED',
      'SUBMITTING',
      'SUBMITTED',
      'SUBMIT_FAILED',
    ]);
    for (const to of reserved) {
      expect(transitionProposalBodySchema.safeParse({ to }).success, to).toBe(false);
    }
    expect(transitionProposalBodySchema.safeParse({ to: 'NOPE' }).success).toBe(false);
    expect(transitionProposalBodySchema.safeParse({}).success).toBe(false);
  });

  it('note は空白だけなら 400、長すぎても 400', () => {
    expect(transitionProposalBodySchema.safeParse({ to: 'LOST', note: '   ' }).success).toBe(false);
    expect(transitionProposalBodySchema.safeParse({ to: 'LOST', note: 'x'.repeat(2_001) }).success).toBe(false);
    expect(transitionProposalBodySchema.safeParse({ to: 'LOST', note: 'x'.repeat(2_000) }).success).toBe(true);
  });

  it('🔴 from / state / 分離キー / approvedBy / contentHash を受け取らない（strip）', () => {
    const parsed = transitionProposalBodySchema.parse({
      to: 'INTERVIEWED',
      from: 'DRAFT',
      state: 'APPROVED',
      approvedBy: ENGINEER,
      contentHash: 'x',
      ...Object.fromEntries(ISOLATION_KEYS.map((key) => [key, PROJECT])),
    });
    expect(parsed).toEqual({ to: 'INTERVIEWED' });
  });
});

// ---------------------------------------------------------------------------
// 🔴 T-09-03: #42 の body（理由必須）。#41 は body を持たない（スキーマ自体が存在しない）。
// ---------------------------------------------------------------------------
describe('rejectProposalBodySchema（#42。T-09-03）', () => {
  it('理由は必須（空・空白だけ・欠落は 400）', () => {
    expect(rejectProposalBodySchema.safeParse({}).success).toBe(false);
    expect(rejectProposalBodySchema.safeParse({ reason: '' }).success).toBe(false);
    expect(rejectProposalBodySchema.safeParse({ reason: '   ' }).success).toBe(false);
    expect(rejectProposalBodySchema.safeParse({ reason: 'x'.repeat(2_001) }).success).toBe(false);
    expect(rejectProposalBodySchema.parse({ reason: '  単価を見直してください  ' })).toEqual({ reason: '単価を見直してください' });
  });

  it('🔴 state / to / 分離キー / ゲート結果を受け取らない（strip）', () => {
    const parsed = rejectProposalBodySchema.parse({
      reason: 'r',
      to: 'DRAFT',
      state: 'APPROVED',
      gate: { pii: 'PASS' },
      force: true,
      ...Object.fromEntries(ISOLATION_KEYS.map((key) => [key, PROJECT])),
    });
    expect(parsed).toEqual({ reason: 'r' });
  });
});

describe('proposalListQuerySchema（#45。T-09-09。docs/05 §6.5「#45 / #46 / #47 の実装の決着」）', () => {
  it('state は 14 値だけを受け、1 個（文字列）でも 2 個以上（配列）でも配列に均す。空は指定なし', () => {
    for (const state of PROPOSAL_STATES) {
      expect(proposalListQuerySchema.parse({ state }).state).toEqual([state]);
    }
    expect(proposalListQuerySchema.parse({ state: ['GATE_FAILED', 'SUBMIT_FAILED'] }).state).toEqual(['GATE_FAILED', 'SUBMIT_FAILED']);
    expect(proposalListQuerySchema.parse({ state: '' }).state).toBeUndefined();
    expect(proposalListQuerySchema.parse({}).state).toBeUndefined();
  });

  it('🔴 ProposalRequest の 5 状態（DECLINED 等）は state に入らない（別エンティティ。400）。「失敗」のような畳んだ値も無い', () => {
    for (const state of PROPOSAL_REQUEST_STATES) {
      expect(proposalListQuerySchema.safeParse({ state }).success).toBe(false);
    }
    expect(proposalListQuerySchema.safeParse({ state: 'FAILED' }).success).toBe(false);
    expect(proposalListQuerySchema.safeParse({ state: ['LOST', 'DECLINED'] }).success).toBe(false);
  });

  it('projectId / engineerId は UUID、q は 1〜200 文字（空は指定なし）、cursor は UUID、limit は 1〜200（既定 50）', () => {
    const parsed = proposalListQuerySchema.parse({ projectId: PROJECT, engineerId: ENGINEER, q: '  架空  ', cursor: SHEET, limit: '20' });
    expect(parsed).toMatchObject({ projectId: PROJECT, engineerId: ENGINEER, q: '架空', cursor: SHEET, limit: 20 });
    expect(proposalListQuerySchema.parse({ q: '   ' }).q).toBeUndefined();
    expect(proposalListQuerySchema.parse({}).limit).toBe(50);
    expect(proposalListQuerySchema.safeParse({ projectId: 'not-a-uuid' }).success).toBe(false);
    expect(proposalListQuerySchema.safeParse({ cursor: 'not-a-uuid' }).success).toBe(false);
    expect(proposalListQuerySchema.safeParse({ limit: '201' }).success).toBe(false);
    expect(proposalListQuerySchema.safeParse({ q: 'x'.repeat(201) }).success).toBe(false);
  });

  it('🔴 分離キーを持たない（strip）', () => {
    const parsed = proposalListQuerySchema.parse(Object.fromEntries(ISOLATION_KEYS.map((key) => [key, PROJECT])));
    for (const key of ISOLATION_KEYS) expect(parsed).not.toHaveProperty(key);
  });
});

describe('createProposalEventBodySchema（#47。T-09-09）', () => {
  it('kind は NOTE の 1 値、note は必須（trim 後 1〜2,000 文字）', () => {
    expect(createProposalEventBodySchema.parse({ kind: 'NOTE', note: '  先方に電話済み  ' })).toEqual({ kind: 'NOTE', note: '先方に電話済み' });
    expect(createProposalEventBodySchema.safeParse({ kind: 'NOTE', note: '' }).success).toBe(false);
    expect(createProposalEventBodySchema.safeParse({ kind: 'NOTE', note: '   ' }).success).toBe(false);
    expect(createProposalEventBodySchema.safeParse({ kind: 'NOTE' }).success).toBe(false);
    expect(createProposalEventBodySchema.safeParse({ kind: 'NOTE', note: 'x'.repeat(PROPOSAL_NOTE_MAX_LENGTH + 1) }).success).toBe(false);
    expect(createProposalEventBodySchema.safeParse({ kind: 'NOTE', note: 'x'.repeat(PROPOSAL_NOTE_MAX_LENGTH) }).success).toBe(true);
  });

  it('🔴 STATE / ATTACHMENT を書ける入力面が無い（400）。fromState / toState / attachmentKey / 分離キーは strip', () => {
    expect(createProposalEventBodySchema.safeParse({ kind: 'STATE', note: 'x' }).success).toBe(false);
    expect(createProposalEventBodySchema.safeParse({ kind: 'ATTACHMENT', note: 'x' }).success).toBe(false);
    const parsed = createProposalEventBodySchema.parse({
      kind: 'NOTE',
      note: 'x',
      fromState: 'DRAFT',
      toState: 'APPROVED',
      attachmentKey: SHEET,
      ...Object.fromEntries(ISOLATION_KEYS.map((key) => [key, PROJECT])),
    });
    expect(parsed).toEqual({ kind: 'NOTE', note: 'x' });
  });
});
