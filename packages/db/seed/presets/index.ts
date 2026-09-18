// packages/db/seed/presets/index.ts
// プリセットの登録簿（docs/05 §13.6）。
//
// 🔴 3 プリセット（`isolation` / `demo` / `perf`）がすべて実装済み。`SeedPresetName` に名前を足したら
//    ここに登録しないとコンパイルで落ちる（`Record<SeedPresetName, …>`）—— 「静かに何もしない」経路を作らない。
import type { SeedPreset, SeedPresetName } from '../types.js';
import { demoPreset } from './demo.js';
import { isolationPreset } from './isolation.js';
import { perfPreset } from './perf.js';

const PRESETS: Readonly<Record<SeedPresetName, () => SeedPreset>> = {
  isolation: () => isolationPreset,
  // ✅ T-10-06: 営業デモ用の一式（時系列データ・ゲートで止まる資料・匿名共有の候補）。
  demo: () => demoPreset,
  // ✅ T-12-01: 性能検証用（1 万 / 1 万 / 匿名共有 2,000。docs/03 §3.7.2）。🔴 CLI 専用（API-A16 は `demo` 固定）。
  perf: () => perfPreset,
};

export function getSeedPreset(name: SeedPresetName): SeedPreset {
  return PRESETS[name]();
}

export { demoPreset, isolationPreset, perfPreset };
// 🔴 T-10-06: `seed:demo` の ID・氏名規則・資格情報（テスト・`A-012` の実演チェックリストが参照する唯一の出所）。
export {
  DEMO_SEED_DOMAINS,
  DEMO_SEED_IDS,
  DEMO_SEED_NAME_RULES,
  DEMO_SEED_PASSWORD,
  demoSeedCompanyNames,
  demoSeedEmails,
  demoSeedProvisioningRequestId,
  type DemoPartnerIds,
  type DemoProjectIds,
  type DemoProposalIds,
  type DemoProposalRequestIds,
  type DemoTenantIds,
} from './demo.js';
// 🔴 T-05-01: グローバルなスキル辞書（テナントに属さないマスタ）。プリセットに依らず同じ表を指す。
export {
  GLOBAL_SKILL_IDS,
  GLOBAL_SKILLS,
  globalSkillId,
  seedGlobalSkills,
  type GlobalSkillSeed,
} from './global-skills.js';
export {
  ISOLATION_FORBIDDEN_MARKERS,
  ISOLATION_SEED_IDS,
  ISOLATION_SEED_PASSWORD,
  ISOLATION_SEED_PERSON_NAMES,
  ISOLATION_SEED_PLATFORM_USERS,
  isolationSeedCompanyNames,
  isolationSeedEmails,
  isolationSeedProjectNames,
  type IsolationPartnerIds,
  type IsolationPlatformUser,
  type IsolationTenantIds,
} from './isolation.js';
// 🔴 T-12-01: `seed:perf` の配分表・ID・氏名規則（結合テスト・負荷測定〔T-12-02〕が参照する唯一の出所）。
export {
  buildPerfTenantPlan,
  buildPerfTenantPlans,
  PERF_SEED_NAME_RULES,
  PERF_SEED_PASSWORD,
  PERF_SEED_PROFILES,
  PERF_SEED_PROPOSALS_PER_TENANT,
  PERF_SEED_TENANT_IDS,
  PERF_SEED_TOTALS,
  PerfSeedScaleError,
  perfPartnerEngineerCount,
  perfPartnerShareCount,
  perfSeedCompanyNames,
  perfSeedDomain,
  perfSeedEmails,
  perfSeedIds,
  perfSeedProfile,
  perfSeedProvisioningRequestId,
  readPerfSeedScale,
  type PerfEngineerPlan,
  type PerfPartnerIds,
  type PerfProjectPlan,
  type PerfTenantIds,
  type PerfTenantPlan,
  type PerfTenantProfile,
} from './perf.js';
