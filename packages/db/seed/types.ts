// packages/db/seed/types.ts
// シードプリセットの共通契約（docs/05 §13.6）。
import type { PrismaClient } from '@prisma/client';
import type { SeedRng } from './rng.js';

/** docs/05 §13.6 の 3 プリセット。 */
export const SEED_PRESET_NAMES = ['isolation', 'demo', 'perf'] as const;

export type SeedPresetName = (typeof SEED_PRESET_NAMES)[number];

export type SeedContext = {
  /**
   * 🔴 合成データ投入専用の特権接続（`packages/db/src/seed-sql.ts` の冒頭参照）。
   *    アプリの経路（`withTenant`）ではない。実行できる環境は `packages/config` が縛る。
   */
  readonly db: PrismaClient;
  /** 固定シードの疑似乱数（F-053 AC-2）。 */
  readonly rng: SeedRng;
  /** 🔴 「実行日 = T」。時系列データはすべてここからの相対日で作る（docs/05 §13.6）。 */
  readonly now: Date;
};

export type SeedPreset = {
  readonly name: SeedPresetName;
  /** 固定シード文字列（プリセットごとに一意）。 */
  readonly rngSeed: string;
  /** 🔴 `reset()` の対象。プリセットが作るテナントだけを消す（他のデータに触れない）。 */
  readonly tenantIds: readonly string[];
  seed(ctx: SeedContext): Promise<void>;
};
