// apps/web/lib/proposal-requests/views.types.test.ts
// 🔴 `HostProposalRequestView` に `declineReason` が**存在しない**（`F-018 AC-1`。`undefined` ではなく型が違う）。
//    docs/05 §6.5 #32 / §4.8 / `docs/sprints/SP-08` T-08-06「完了の判定 … 型テスト」。
//
// 型テスト（`@ts-expect-error`。コンパイルで落ちる）と、シリアライザの実行時のキー集合の 2 枚で固定する。
// `row` に `declineReason` / `engineerId` / `partnerCompanyId` が**あっても**写像の出力には現れない
// （列を選んで写す。spread しない）。
import { describe, expect, it } from 'vitest';
import {
  HOST_PROPOSAL_REQUEST_VIEW_KEYS,
  toHostProposalRequestView,
  toPartnerProposalRequestDetailView,
  toPartnerProposalRequestView,
  type HostProposalRequestView,
  type PartnerProposalRequestDetailView,
  type PartnerProposalRequestView,
  type ProposalRequestRow,
} from './views';

const ROW: ProposalRequestRow = {
  id: '01930000-0000-7000-8000-000000000201',
  projectId: '01930000-0000-7000-8000-0000000000f1',
  state: 'DECLINED',
  message: '11 月開始を希望します。',
  expiresAt: new Date('2026-09-22T14:59:59.000Z'),
  createdAt: new Date('2026-09-15T01:00:00.000Z'),
  respondedAt: new Date('2026-09-16T02:00:00.000Z'),
};

/** 🔴 DB の行にはこれらの列がある。写像の**入力の型**にすら無いことを、余剰プロパティで確かめる。 */
const DB_ROW_WITH_SECRETS = {
  ...ROW,
  declineReason: '社内都合により辞退',
  engineerId: '01930000-0000-7000-8000-0000000000e2',
  partnerCompanyId: '01930000-0000-7000-8000-0000000000c1',
  respondedBy: '01930000-0000-7000-8000-0000000000d2',
  issuedBy: '01930000-0000-7000-8000-0000000000d1',
};

describe('🔴 F-018 AC-1: HostProposalRequestView に declineReason が存在しない（型）', () => {
  it('declineReason / engineerId / partnerCompanyId / respondedBy / issuedBy はプロパティとして参照できない', () => {
    const view: HostProposalRequestView = toHostProposalRequestView(ROW, null);
    // @ts-expect-error F-018 AC-1: 辞退理由はホスト向けの型に存在しない
    const declineReason: unknown = view.declineReason;
    // @ts-expect-error docs/05 §4.6: engineer_id をホスト向け応答に載せない
    const engineerId: unknown = view.engineerId;
    // @ts-expect-error 依頼先（共有元）はホストに開示しない（応諾で Proposal ができた時点で開示。経路 2）
    const partnerCompanyId: unknown = view.partnerCompanyId;
    // @ts-expect-error 取引先の担当者はホストに開示しない
    const respondedBy: unknown = view.respondedBy;
    // @ts-expect-error 発行者の ID は応答に要らない
    const issuedBy: unknown = view.issuedBy;
    expect([declineReason, engineerId, partnerCompanyId, respondedBy, issuedBy]).toEqual([
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
    ]);
  });

  it('🔴 写像の出力のキー集合は HOST_PROPOSAL_REQUEST_VIEW_KEYS ちょうどである（行に秘匿列があっても写らない）', () => {
    const view = toHostProposalRequestView(DB_ROW_WITH_SECRETS, { id: ROW.projectId, name: 'Project' });
    expect(Object.keys(view).sort()).toEqual([...HOST_PROPOSAL_REQUEST_VIEW_KEYS].sort());
    const serialized = JSON.stringify(view);
    expect(serialized).not.toContain('社内都合');
    expect(serialized).not.toContain(DB_ROW_WITH_SECRETS.engineerId);
    expect(serialized).not.toContain(DB_ROW_WITH_SECRETS.partnerCompanyId);
    expect(serialized).not.toContain(DB_ROW_WITH_SECRETS.respondedBy);
    expect(serialized).not.toContain('declineReason');
  });

  it('日時は ISO 8601（UTC）に写り、REQUESTED の respondedAt は null', () => {
    const view = toHostProposalRequestView({ ...ROW, state: 'REQUESTED', respondedAt: null }, null);
    expect(view).toEqual({
      id: ROW.id,
      project: null,
      state: 'REQUESTED',
      message: ROW.message,
      expiresAt: '2026-09-22T14:59:59.000Z',
      createdAt: '2026-09-15T01:00:00.000Z',
      respondedAt: null,
    });
  });

  it('DB の CHECK が保証する状態以外は握り潰さず落とす（不変条件違反）', () => {
    expect(() => toHostProposalRequestView({ ...ROW, state: 'LOST' }, null)).toThrow(RangeError);
  });
});

describe('PartnerProposalRequestView（取引先向け。自社の行だけ）', () => {
  it('自社の台帳の表示名を持ち、公開されていない案件は null になる', () => {
    const view: PartnerProposalRequestView = toPartnerProposalRequestView(DB_ROW_WITH_SECRETS, null, {
      id: DB_ROW_WITH_SECRETS.engineerId,
      displayName: '山田 太郎',
    });
    expect(view.project).toBeNull();
    expect(view.engineer).toEqual({ id: DB_ROW_WITH_SECRETS.engineerId, displayName: '山田 太郎' });
    // 🔴 辞退理由は**一覧の型には無い**（T-08-07 で足したのは詳細型 `PartnerProposalRequestDetailView` だけ）。
    // @ts-expect-error 一覧の型には declineReason が無い（詳細型にだけある）
    const declineReason: unknown = view.declineReason;
    expect(declineReason).toBeUndefined();
    expect(Object.keys(view).sort()).toEqual(
      ['createdAt', 'engineer', 'expiresAt', 'id', 'message', 'project', 'respondedAt', 'state'].sort(),
    );
  });
});

describe('🔴 T-08-07 PartnerProposalRequestDetailView（S-018）: declineReason はここにだけ、ホスト向けには無い', () => {
  const DETAIL_ROW = { ...DB_ROW_WITH_SECRETS };

  it('取引先の詳細は declineReason / proposalId を持ち、依頼先・応答者・発行者は型として受け取れない', () => {
    const view: PartnerProposalRequestDetailView = toPartnerProposalRequestDetailView(
      DETAIL_ROW,
      null,
      { id: DETAIL_ROW.engineerId, displayName: '山田 太郎' },
      null,
    );
    expect(view.declineReason).toBe('社内都合により辞退');
    expect(view.proposalId).toBeNull();
    expect(view.project).toBeNull();
    // @ts-expect-error 依頼先（自社）の ID は応答に要らない
    const partnerCompanyId: unknown = view.partnerCompanyId;
    // @ts-expect-error 応答者の ID は応答に要らない
    const respondedBy: unknown = view.respondedBy;
    // @ts-expect-error 発行者の ID は応答に要らない
    const issuedBy: unknown = view.issuedBy;
    expect([partnerCompanyId, respondedBy, issuedBy]).toEqual([undefined, undefined, undefined]);
    expect(Object.keys(view).sort()).toEqual(
      ['createdAt', 'declineReason', 'engineer', 'expiresAt', 'id', 'message', 'project', 'proposalId', 'respondedAt', 'state'].sort(),
    );
  });

  it('🔴 F-018 AC-1: ホスト向けの型に「詳細」は存在せず、HostProposalRequestView は declineReason を持てない（型）', () => {
    const host: HostProposalRequestView = toHostProposalRequestView(DETAIL_ROW, null);
    // @ts-expect-error F-018 AC-1: 辞退理由はホスト向けの型に存在しない
    const declineReason: unknown = host.declineReason;
    expect(declineReason).toBeUndefined();
    // 🔴 実行時: 行に辞退理由があってもホスト向けの写像には 1 文字も写らない（前後比較は実 DB テストが持つ）。
    expect(JSON.stringify(host)).not.toContain('社内都合');
    expect(Object.keys(host)).not.toContain('declineReason');
    expect(Object.keys(host)).not.toContain('proposalId');
  });
});
