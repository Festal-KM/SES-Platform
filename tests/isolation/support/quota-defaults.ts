// tests/isolation/support/quota-defaults.ts
// 🔴 T-12-12: 執行点（`email-send.ts` / `send-proposal.ts` / `send-hold-release.ts` / `issueSkillSheetUploadUrl`）の deps は
//    固定の `dailyLimit` / `storageLimitBytes` ではなく `quotaDefaults`（`TenantQuotaDefaults`）を受け、実際の上限は
//    `resolveTenantQuotas`（既定値 + `tenant_quota_overrides`）が解く。結合テストは実 DB を使うので、既定値をここから渡すだけで
//    本番と同じ経路（上書きが無ければ既定値）を通る。
import type { TenantQuotaDefaults } from '@ses/db';

const GB = 1024n * 1024n * 1024n;

/** `packages/config` の既定値と同じ形（`docs/03` §7.6.2 の Standard。金額は含まない）。 */
export const TEST_QUOTA_DEFAULTS: TenantQuotaDefaults = {
  aiUnitQuotas: {
    AI_UNIT_SHEET_PARSE: 180,
    AI_UNIT_MATCH_RATIONALE: 6_200,
    AI_UNIT_PROPOSAL_DRAFT: 180,
    AI_UNIT_RENEWAL_SUMMARY: 20,
  },
  emailDailyLimit: 500,
  storageLimitBytes: 50n * GB,
};

/** 既定値の一部を差し替える（テストが「既定値 3 通」のような前提を作るため）。 */
export function quotaDefaultsWith(overrides: Partial<TenantQuotaDefaults>): TenantQuotaDefaults {
  return { ...TEST_QUOTA_DEFAULTS, ...overrides };
}
