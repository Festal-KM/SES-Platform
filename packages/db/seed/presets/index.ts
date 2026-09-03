// packages/db/seed/presets/index.ts
// プリセットの登録簿（docs/05 §13.6）。
//
// 🔴 未実装のプリセットは「静かに何もしない」ではなく**明示的に失敗させる**。
//    投入したつもりで空のままになるほうが、失敗するより発見が遅れて危ない。
import type { SeedPreset, SeedPresetName } from '../types.js';
import { isolationPreset } from './isolation.js';

export class SeedPresetNotImplementedError extends Error {
  constructor(
    readonly preset: SeedPresetName,
    plannedIn: string,
  ) {
    super(`シードプリセット「${preset}」は未実装です（${plannedIn} の範囲）。`);
    this.name = 'SeedPresetNotImplementedError';
  }
}

const PRESETS: Readonly<Record<SeedPresetName, () => SeedPreset>> = {
  isolation: () => isolationPreset,
  // 営業デモ用の一式（時系列データ・ゲートで止まる資料・匿名共有の候補）は T-10-06。
  demo: () => {
    throw new SeedPresetNotImplementedError('demo', 'SP-10 の T-10-06');
  },
  // 性能検証用（1 万 / 1 万 / 匿名共有 2,000。docs/03 §3.7.2）は性能スプリント。
  perf: () => {
    throw new SeedPresetNotImplementedError('perf', '性能検証のスプリント（docs/03 §3.7.2）');
  },
};

export function getSeedPreset(name: SeedPresetName): SeedPreset {
  return PRESETS[name]();
}

export { isolationPreset };
export {
  ISOLATION_FORBIDDEN_MARKERS,
  ISOLATION_SEED_IDS,
  type IsolationPartnerIds,
  type IsolationTenantIds,
} from './isolation.js';
