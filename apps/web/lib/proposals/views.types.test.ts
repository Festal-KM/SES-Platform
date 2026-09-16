// apps/web/lib/proposals/views.types.test.ts
// 🔴 `PartnerProposalView` / `HostProposalView` を**型として**分ける（docs/05 §4.8 / §6.5「T-09-01 の決着」/
//    `F-019 AC-1` `AC-4` / `BR-06` `BR-07`）。T-09-01。
//
// 型テスト（`@ts-expect-error`。コンパイルで落ちる）と、シリアライザの実行時のキー集合の 2 枚で固定する。
// `row` に `engineerId` / `createdBy` / `approvedBy` が**あっても**写像の出力には現れない（列を選んで写す。spread しない）。
import { describe, expect, expectTypeOf, it } from 'vitest';
import {
  HOST_PROPOSAL_VIEW_KEYS,
  PARTNER_PROPOSAL_VIEW_KEYS,
  ProposalSnapshotShapeError,
  toHostProposalView,
  toPartnerProposalView,
  type HostProposalView,
  type PartnerProposalView,
  type ProposalSnapshotRow,
  type ProposalViewRow,
} from './views';

const ROW: ProposalViewRow = {
  id: '01930000-0000-7000-8000-000000000301',
  state: 'DRAFT',
  proposalRequestId: null,
  sendHoldReasonKey: null,
  sendHoldSince: null,
  recipientCompanyName: '架空エンド株式会社',
  recipientEmail: 'to@example.test',
  offeredUnitPrice: { toString: () => '650000.00' },
  offeredStartDate: new Date('2026-11-01T00:00:00.000Z'),
  workStyle: '常駐',
  subject: 'ご提案',
  body: '本文',
  createdAt: new Date('2026-09-15T01:00:00.000Z'),
  updatedAt: new Date('2026-09-15T02:00:00.000Z'),
};

const SNAPSHOT: ProposalSnapshotRow = {
  frozenAt: new Date('2026-09-15T01:00:00.000Z'),
  displayName: '山田 太郎',
  affiliationLabel: '株式会社パートナー',
  skills: [{ skillId: '01930000-0000-7000-8000-0000000009a1', name: 'Java', years: 5, level: 4 }],
  careers: [{ periodFrom: '2024-04', periodTo: null, role: 'PL', description: 'x', technologies: 'Go' }],
  unitPriceMin: { toString: () => '600000.00' },
  unitPriceMax: null,
  availableFrom: new Date('2026-11-01T00:00:00.000Z'),
  prefecture: '13',
  remoteMode: 'HYBRID',
  skillSheetId: '01930000-0000-7000-8000-000000000501',
};

/** 🔴 DB の行にはこれらの列がある。写像の**入力の型**にすら無いことを、余剰プロパティで確かめる。 */
const DB_ROW_WITH_SECRETS = {
  ...ROW,
  engineerId: '01930000-0000-7000-8000-0000000000e2',
  createdBy: '01930000-0000-7000-8000-0000000000d2',
  approvedBy: '01930000-0000-7000-8000-0000000000d1',
  ownerPartnerCompanyId: '01930000-0000-7000-8000-0000000000c1',
  draftBody: 'AI draft',
};

const DEPS = { project: { id: '01930000-0000-7000-8000-0000000000f1', name: 'Project' }, snapshot: SNAPSHOT, contentHash: 'h' };

describe('🔴 F-019 AC-4 / §4.8: PartnerProposalView に他社・上流・重複提案に関するフィールドが存在しない（型）', () => {
  it('owner / duplicateFindings / 他の提案の存在・件数 / エンド企業名 / 販売単価 / engineerId は参照できない', () => {
    const view: PartnerProposalView = toPartnerProposalView(ROW, DEPS);
    expectTypeOf(view).not.toHaveProperty('owner');
    expectTypeOf(view).not.toHaveProperty('duplicateFindings');
    expectTypeOf(view).not.toHaveProperty('otherProposalCount');
    expectTypeOf(view).not.toHaveProperty('rank');
    expectTypeOf(view).not.toHaveProperty('endClientName');
    expectTypeOf(view).not.toHaveProperty('internalUnitPrice');
    expectTypeOf(view).not.toHaveProperty('engineerId');
    expectTypeOf(view).not.toHaveProperty('createdBy');
    // 🔴 T-09-06: 送信の保留（ホスト側の事情）は取引先向けの型に存在しない（docs/05 §10.4 / §4.8）。
    expectTypeOf(view).not.toHaveProperty('sendHold');
    expectTypeOf(view.project).not.toHaveProperty('endClientName');
    // @ts-expect-error F-019 AC-4: 作成した会社はパートナー向けの型に存在しない
    const owner: unknown = view.owner;
    // @ts-expect-error F-037 AC-1: 重複提案の指摘はパートナー向けの型に存在しない
    const duplicateFindings: unknown = view.duplicateFindings;
    expect([owner, duplicateFindings]).toEqual([undefined, undefined]);
    expect(view.audience).toBe('PARTNER');
  });

  it('🔴 写像の出力のキー集合は PARTNER_PROPOSAL_VIEW_KEYS ちょうどである（行に秘匿列があっても写らない）', () => {
    const view = toPartnerProposalView(DB_ROW_WITH_SECRETS, DEPS);
    expect(Object.keys(view).sort()).toEqual([...PARTNER_PROPOSAL_VIEW_KEYS].sort());
    const serialized = JSON.stringify(view);
    for (const secret of [DB_ROW_WITH_SECRETS.engineerId, DB_ROW_WITH_SECRETS.createdBy, DB_ROW_WITH_SECRETS.approvedBy, DB_ROW_WITH_SECRETS.ownerPartnerCompanyId, 'AI draft']) {
      expect(serialized).not.toContain(secret);
    }
  });
});

describe('🔴 F-019 AC-1: HostProposalView のエンジニア情報は snapshot（凍結側）だけ（型）', () => {
  it('engineerId / engineer（台帳の現在値）/ careers の現在値を参照できない。owner は持つ', () => {
    const view: HostProposalView = toHostProposalView(ROW, DEPS, { kind: 'PARTNER', partnerCompanyName: 'Partner A1' });
    expectTypeOf(view).not.toHaveProperty('engineerId');
    expectTypeOf(view).not.toHaveProperty('engineer');
    expectTypeOf(view).not.toHaveProperty('duplicateFindings');
    expectTypeOf(view.snapshot).not.toHaveProperty('engineerId');
    // @ts-expect-error F-019 AC-1: 台帳の行 ID はホスト向けの型に存在しない（凍結側だけを読む）
    const engineerId: unknown = view.engineerId;
    expect(engineerId).toBeUndefined();
    expect(view.audience).toBe('HOST');
    expect(view.owner).toEqual({ kind: 'PARTNER', partnerCompanyName: 'Partner A1' });
    expect(view.snapshot.displayName).toBe('山田 太郎');
  });

  it('🔴 写像の出力のキー集合は HOST_PROPOSAL_VIEW_KEYS ちょうどである', () => {
    const view = toHostProposalView(DB_ROW_WITH_SECRETS, DEPS, { kind: 'HOST' });
    expect(Object.keys(view).sort()).toEqual([...HOST_PROPOSAL_VIEW_KEYS].sort());
    expect(JSON.stringify(view)).not.toContain(DB_ROW_WITH_SECRETS.engineerId);
    expect(JSON.stringify(view)).not.toContain(DB_ROW_WITH_SECRETS.createdBy);
  });

  it('🔴 T-09-06: 送信の保留はホスト向けの型だけが持ち、理由と時刻を写す（片方だけの行は不変条件違反）', () => {
    const since = new Date('2026-09-16T00:00:00.000Z');
    const held = toHostProposalView({ ...ROW, state: 'APPROVED', sendHoldReasonKey: 'PROVIDER_QUOTA', sendHoldSince: since }, DEPS, { kind: 'HOST' });
    expect(held.sendHold).toEqual({ reasonKey: 'PROVIDER_QUOTA', since: since.toISOString() });
    expect(toHostProposalView(ROW, DEPS, { kind: 'HOST' }).sendHold).toBeNull();
    expect(() => toHostProposalView({ ...ROW, sendHoldReasonKey: 'RATE_LIMIT', sendHoldSince: null }, DEPS, { kind: 'HOST' })).toThrow(RangeError);
    expect(() => toHostProposalView({ ...ROW, sendHoldReasonKey: 'NOT_A_REASON', sendHoldSince: since }, DEPS, { kind: 'HOST' })).toThrow(RangeError);
    // 取引先向けの写像は保留列を読まない（値があっても出力に現れない）。
    const partner = toPartnerProposalView({ ...ROW, sendHoldReasonKey: 'PROVIDER_QUOTA', sendHoldSince: since }, DEPS);
    expect(JSON.stringify(partner)).not.toContain('PROVIDER_QUOTA');
  });
});

describe('共通部の写像', () => {
  it('🔴 提案先が空文字（経路 4 の応諾直後）なら recipient は null（無言で空を返さない）', () => {
    const view = toPartnerProposalView({ ...ROW, recipientCompanyName: '', recipientEmail: '', proposalRequestId: '01930000-0000-7000-8000-000000000201' }, DEPS);
    expect(view.recipient).toBeNull();
    expect(view.origin).toBe('PROPOSAL_REQUEST');
  });

  it('提案先が両方埋まっていれば recipient を持ち、origin は OWN', () => {
    const view = toHostProposalView(ROW, DEPS, { kind: 'HOST' });
    expect(view.recipient).toEqual({ companyName: '架空エンド株式会社', email: 'to@example.test' });
    expect(view.origin).toBe('OWN');
    expect(view.terms).toEqual({ offeredUnitPrice: 650000, offeredStartDate: '2026-11-01', workStyle: '常駐' });
    expect(view.content).toEqual({ subject: 'ご提案', body: '本文', bodyOrigin: 'MANUAL' });
    expect(view.snapshot).toEqual({
      frozenAt: '2026-09-15T01:00:00.000Z',
      displayName: '山田 太郎',
      affiliationLabel: '株式会社パートナー',
      skills: [{ skillId: '01930000-0000-7000-8000-0000000009a1', name: 'Java', years: 5, level: 4 }],
      careerCount: 1,
      unitPriceMin: 600000,
      unitPriceMax: null,
      availableFrom: '2026-11-01',
      prefecture: '13',
      remoteMode: 'HYBRID',
    });
    expect(view.attachment).toEqual({ skillSheetId: '01930000-0000-7000-8000-000000000501' });
    expect(view.contentHash).toBe('h');
  });

  it('取引先で公開が解除された案件は project が null', () => {
    expect(toPartnerProposalView(ROW, { ...DEPS, project: null }).project).toBeNull();
  });

  it('凍結コピーの形が壊れていたら握り潰さない', () => {
    expect(() => toHostProposalView(ROW, { ...DEPS, snapshot: { ...SNAPSHOT, skills: 'x' } }, { kind: 'HOST' })).toThrow(ProposalSnapshotShapeError);
    expect(() => toHostProposalView(ROW, { ...DEPS, snapshot: { ...SNAPSHOT, careers: null } }, { kind: 'HOST' })).toThrow(ProposalSnapshotShapeError);
    expect(() => toHostProposalView({ ...ROW, state: 'BOGUS' }, DEPS, { kind: 'HOST' })).toThrow(RangeError);
  });
});
