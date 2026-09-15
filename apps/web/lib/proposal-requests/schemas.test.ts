// apps/web/lib/proposal-requests/schemas.test.ts
// 提案依頼の境界検証（docs/05 §6.5 #31 / #32 / #35。`F-017 AC-4` / `BR-58`）。T-08-06。
//
// 🔴 固定するもの:
//   ① #31 の body は 4 項目だけであり、**単価に関するキーが存在しない**（`F-017 AC-4`）
//   ② `candidateRef` は base64url 22 文字。UUID（`engineerId` をそのまま渡す誤り）は 400
//   ③ 分離キー（`tenantId` / `partnerCompanyId`）を持たない
//   ④ #32 の `state` は 5 状態のいずれか（「失効」のような畳んだ値は無い）
import { describe, expect, it } from 'vitest';
import { PROPOSAL_REQUEST_STATES } from '@ses/domain';
import {
  PROPOSAL_REQUEST_MESSAGE_MAX_LENGTH,
  proposalRequestCreateBodySchema,
  proposalRequestListQuerySchema,
  proposalRequestParamsSchema,
} from './schemas';

const PROJECT = '01930000-0000-7000-8000-0000000000f1';
const REF = 'yM2RkvynFUQclwUcbLMLXw';
const VALID = {
  projectId: PROJECT,
  candidateRef: REF,
  message: '11 月開始を希望します。',
  expiresAt: '2026-09-22T23:59:59+09:00',
};

describe('🔴 #31 body: 4 項目だけで、単価に関するキーが存在しない', () => {
  it('キー集合は projectId / candidateRef / message / expiresAt', () => {
    expect(Object.keys(proposalRequestCreateBodySchema.shape).sort()).toEqual(
      ['candidateRef', 'expiresAt', 'message', 'projectId'].sort(),
    );
    for (const forbidden of ['unitPrice', 'offeredUnitPrice', 'price', 'estimate', 'discount', 'tenantId', 'partnerCompanyId', 'engineerId']) {
      expect(Object.keys(proposalRequestCreateBodySchema.shape)).not.toContain(forbidden);
    }
  });

  it('正常な body は通り、message は trim される', () => {
    const parsed = proposalRequestCreateBodySchema.parse({ ...VALID, message: '  面談は来週可能です。  ' });
    expect(parsed.message).toBe('面談は来週可能です。');
  });

  it.each([
    ['candidateRef が UUID（engineerId をそのまま渡した）', { ...VALID, candidateRef: '01930000-0000-7000-8000-0000000000e2' }],
    ['candidateRef が 21 文字', { ...VALID, candidateRef: REF.slice(0, 21) }],
    ['message が空白だけ', { ...VALID, message: '   ' }],
    ['message が上限超え', { ...VALID, message: 'あ'.repeat(PROPOSAL_REQUEST_MESSAGE_MAX_LENGTH + 1) }],
    ['expiresAt が日付だけ（時刻・オフセット無し）', { ...VALID, expiresAt: '2026-09-22' }],
    ['projectId が UUID でない', { ...VALID, projectId: 'project-1' }],
  ])('🔴 400: %s', (_label, body) => {
    expect(proposalRequestCreateBodySchema.safeParse(body).success).toBe(false);
  });
});

describe('#32 query', () => {
  it('state は 5 状態のいずれか。空文字は「指定なし」', () => {
    for (const state of PROPOSAL_REQUEST_STATES) {
      expect(proposalRequestListQuerySchema.parse({ state }).state).toBe(state);
    }
    expect(proposalRequestListQuerySchema.parse({ state: '' }).state).toBeUndefined();
    expect(proposalRequestListQuerySchema.parse({}).state).toBeUndefined();
    // 🔴 畳んだ値（「失効」相当）は存在しない。
    expect(proposalRequestListQuerySchema.safeParse({ state: 'CLOSED' }).success).toBe(false);
    expect(proposalRequestListQuerySchema.safeParse({ state: 'LOST' }).success).toBe(false);
  });

  it('cursor は行の UUID（並びのキーではない）', () => {
    expect(proposalRequestListQuerySchema.parse({ cursor: PROJECT }).cursor).toBe(PROJECT);
    expect(proposalRequestListQuerySchema.safeParse({ cursor: `0:2026-09-08:${REF}` }).success).toBe(false);
  });
});

describe('#35 params', () => {
  it('id は UUID', () => {
    expect(proposalRequestParamsSchema.parse({ id: PROJECT })).toEqual({ id: PROJECT });
    expect(proposalRequestParamsSchema.safeParse({ id: REF }).success).toBe(false);
  });
});
