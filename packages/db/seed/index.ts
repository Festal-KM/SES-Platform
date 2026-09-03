// packages/db/seed/index.ts
// シードの公開入口（`@ses/db/seed`）。CLI（seed/cli.ts）とテスト、そして SP-10 の
// 管理平面 API（API-A16）がここだけを呼ぶ。
//
// 🔴 環境ガード（F-053 AC-6 / docs/05 §13.6）はこの関数の**先頭**にある。
//    「呼び出し側が気をつける」ではなく、投入・削除に到達する前に必ず通る位置に置く。
//    判定そのものは `packages/config` の `assertSeedableAppEnv`（唯一の出所）が行う。
import { PrismaClient } from '@prisma/client';
import { assertSeedableAppEnv } from '@ses/config';
import { countTenantRows } from '../src/seed-sql.js';
import { getSeedPreset } from './presets/index.js';
import { resetPreset } from './reset.js';
import { createSeedRng } from './rng.js';
import { SEED_PRESET_NAMES, type SeedPresetName } from './types.js';

export { SEED_PRESET_NAMES, type SeedContext, type SeedPreset, type SeedPresetName } from './types.js';
export { getSeedPreset, SeedPresetNotImplementedError } from './presets/index.js';
export {
  ISOLATION_FORBIDDEN_MARKERS,
  ISOLATION_SEED_IDS,
  type IsolationPartnerIds,
  type IsolationTenantIds,
} from './presets/isolation.js';
export { createSeedRng, type SeedRng } from './rng.js';

export type RunSeedOptions = {
  /** 🔴 `packages/config` の `APP_ENV`。`demo` / `development` 以外は拒否する（F-053 AC-6）。 */
  readonly appEnv: string | undefined;
  /**
   * 🔴 合成データ投入専用の特権接続（`packages/db/src/seed-sql.ts` 冒頭参照）。
   *    アプリ実行時の `DATABASE_URL`（`app_tenant`）ではない。
   */
  readonly databaseUrl: string;
  readonly preset: SeedPresetName;
  /** `true` で `reset()` → `seed()`（冪等な再生成。F-053 AC-2）。 */
  readonly reset: boolean;
  /** 🔴 「実行日 = T」。テストが固定値を渡せるように引数で受ける（docs/05 §2.2 / §17.6）。 */
  readonly now?: Date;
};

export type RunSeedResult = {
  readonly preset: SeedPresetName;
  readonly tenantIds: readonly string[];
  /** テーブルごとの投入行数（テナント ID で絞った実測）。冪等性の検証に使う。 */
  readonly counts: Readonly<Record<string, number>>;
};

export function isSeedPresetName(value: string): value is SeedPresetName {
  return (SEED_PRESET_NAMES as readonly string[]).includes(value);
}

/**
 * プリセットを投入する。`reset` が真なら削除してから投入する。
 *
 * 🔴 ①環境ガード → ②接続 → ③`reset()` → ④`seed()` の順を崩さない。
 *    削除は「実行前の判定」を通ったあとにしか起こらない（F-053 AC-6）。
 */
export async function runSeed(options: RunSeedOptions): Promise<RunSeedResult> {
  // ① 🔴 ここを通らずに削除・投入へ到達する経路を作らない。
  assertSeedableAppEnv(options.appEnv);

  const preset = getSeedPreset(options.preset);
  const now = options.now ?? new Date();
  // ② 特権接続。呼び出しごとに開いて必ず閉じる（プロセス常駐のクライアントを持たない）。
  const db = new PrismaClient({ datasourceUrl: options.databaseUrl });
  try {
    // ③ reset（対象テナントだけ）
    if (options.reset) {
      await resetPreset(db, preset);
    }
    // ④ seed（固定シードの疑似乱数 + 実行日からの相対日）
    // 🔴 投入全体を 1 つのトランザクションで包まない。Prisma の対話型トランザクションには
    //    時間上限があり、大きなプリセット（`perf` は 1 万件規模。docs/03 §3.7.2）で必ず超えるため。
    //    途中で失敗した場合の回復手段は `--reset` での再実行であり、ID が決定的なので
    //    同じ結果に収束する（F-053 AC-2）。
    await preset.seed({ db, rng: createSeedRng(preset.rngSeed), now });
    const counts = await countTenantRows(db, preset.tenantIds);
    return { preset: preset.name, tenantIds: preset.tenantIds, counts };
  } finally {
    await db.$disconnect();
  }
}

/** `reset` だけを行う（`F-053 AC-2` の「リセット」。投入は行わない）。 */
export async function runSeedReset(
  options: Omit<RunSeedOptions, 'reset' | 'now'>,
): Promise<RunSeedResult> {
  assertSeedableAppEnv(options.appEnv);
  const preset = getSeedPreset(options.preset);
  const db = new PrismaClient({ datasourceUrl: options.databaseUrl });
  try {
    await resetPreset(db, preset);
    const counts = await countTenantRows(db, preset.tenantIds);
    return { preset: preset.name, tenantIds: preset.tenantIds, counts };
  } finally {
    await db.$disconnect();
  }
}
