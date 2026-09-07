// apps/web/lib/projects/publish-gate.test.ts
// 🔴 ゲート接続点のスタブが、**どんな入力でも公開を成立させない**ことを固定する。T-06-06。
//
// なぜこのテストが要るか（`CLAUDE.md` §11.1 と同型の壊れ方）: ゲート本体が入るまでの間に
// 「とりあえず PASS」を返す実装が紛れ込むと、**ゲートを 1 度も通していない案件が取引先に見え、
// しかも画面は「公開しました」と表示する**（`F-014 AC-3` を破ったことに誰も気づけない）。
// 差し替えるのは SP-07（T-07-09）であり、そのときも「同期的に公開が成立する枝」は作らない。
import { describe, expect, it } from 'vitest';
import type { AuthenticatedTenantCtx } from '@ses/db';
import { heldProjectPublishGate, PROJECT_PUBLISH_GATE_TARGET_TYPE } from './publish-gate';

/** 🔴 ctx の中身はスタブの結果に影響しない（＝ 文脈次第で素通しする枝が無い）。 */
const CTX = { tenantId: 't', partnerCompanyId: null } as unknown as AuthenticatedTenantCtx;

describe('🔴 SP-06 のゲート接続点は公開を保留する', () => {
  it('公開先が 1 社でも複数でも `held: true` を返し、`reviewGateId` は `null`', async () => {
    for (const partnerCompanyIds of [['p1'], ['p1', 'p2'], []]) {
      expect(await heldProjectPublishGate(CTX, { projectId: 'proj', partnerCompanyIds })).toEqual({
        held: true,
        reviewGateId: null,
      });
    }
  });

  it('🔴 `review_gates` の対象種別は `PROJECT_PUBLISH`（docs/05 §3.6 の 5 種の 1 つ）', () => {
    expect(PROJECT_PUBLISH_GATE_TARGET_TYPE).toBe('PROJECT_PUBLISH');
  });
});
