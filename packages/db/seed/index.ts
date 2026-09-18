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
import { SEED_PRESET_NAMES, type SeedPreset, type SeedPresetName } from './types.js';

export { SEED_PRESET_NAMES, type SeedContext, type SeedPreset, type SeedPresetName } from './types.js';
export { getSeedPreset } from './presets/index.js';
// 🔴 T-05-01: グローバルなスキル辞書（`skills`。射程外 4 表のマスタ）。
export {
  GLOBAL_SKILL_IDS,
  GLOBAL_SKILLS,
  globalSkillId,
  seedGlobalSkills,
  type GlobalSkillSeed,
} from './presets/global-skills.js';
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
} from './presets/isolation.js';
// 🔴 T-10-06: `seed:demo`（合成データ一式。docs/05 §13.6 / F-053）。
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
} from './presets/demo.js';
// 🔴 T-12-01: `seed:perf`（1 万 / 1 万 / 匿名共有 2,000 の負荷測定の母集団。docs/03 §3.7.2）。CLI 専用。
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
} from './presets/perf.js';
export { createSeedRng, type SeedRng } from './rng.js';
// 🔴 T-10-07: テナント ID で絞った行数の実測（読み取りだけ）。結合テストが「reset で消える / 他テナントは消えない」を
//    テーブルを列挙せずに突き合わせるために公開する。`deleteTenantData`（削除の実体）は公開しない —— 環境ガード
//    （`runSeedReset` の先頭）を通らずに消せる経路を作らない。
export { countTenantRows } from '../src/seed-sql.js';

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
  /**
   * 🔴 T-10-06（API-A16 の冪等性）: `SEEDED` = 今回投入した / `ALREADY_SEEDED` = 既に投入済みだったので**何も書かなかった**
   *    （`reset: false` のときだけ起こる）。
   * 🔴 T-10-07（API-A16 `reset` の冪等性）: `RESET_ONLY` = `runSeedReset` がプリセットのテナント行を消した /
   *    `NOTHING_TO_RESET` = 消す前からプリセットのテナント行が 1 つも無かった（**エラーにしない**。2 回目のリセットは正常終了）。
   */
  readonly outcome: 'SEEDED' | 'ALREADY_SEEDED' | 'RESET_ONLY' | 'NOTHING_TO_RESET';
  /**
   * 「実行日 = T」。`SEEDED` なら今回の `now`、`ALREADY_SEEDED` なら**前回の T**（`tenants.lifecycle_changed_at` = プリセットが
   * `now` を書く唯一の列）。`RESET_ONLY` / `NOTHING_TO_RESET` は `null`。
   */
  readonly seededAt: Date | null;
  /**
   * `runSeedReset` のとき: 削除の**直前**にプリセットのテナント ID で絞って数えた行数（= 消した行数）。
   * `counts` は削除後の実測（すべて 0 のはず）であり、区別して持つ。投入の結果では `undefined`。
   */
  readonly deletedCounts?: Readonly<Record<string, number>>;
};

export function isSeedPresetName(value: string): value is SeedPresetName {
  return (SEED_PRESET_NAMES as readonly string[]).includes(value);
}

/**
 * 🔴 前回の投入が途中で止まっている（プリセットのテナントの一部だけが存在する）。
 *    「投入済み」とも「未投入」とも判定できないので、**黙ってどちらかに倒さない**。回復手段は `reset` → `seed`。
 */
export class SeedIncompleteError extends Error {
  constructor(
    readonly preset: SeedPresetName,
    readonly presentTenantIds: readonly string[],
    readonly expectedTenantIds: readonly string[],
  ) {
    super(
      `シードプリセット「${preset}」のテナントが ${presentTenantIds.length} / ${expectedTenantIds.length} 件だけ存在します` +
        '（前回の投入が途中で止まった可能性）。--reset で削除してから投入し直してください（F-053 AC-2）。',
    );
    this.name = 'SeedIncompleteError';
  }
}

export type SeedPresence =
  | { readonly kind: 'ABSENT' }
  | { readonly kind: 'PRESENT'; readonly seededAt: Date }
  | { readonly kind: 'INCOMPLETE'; readonly presentTenantIds: readonly string[] };

/**
 * 🔴 プリセットが投入済みか（API-A16 の冪等キー。docs/05 §13.6「T-10-06 の実装の決着」）。
 *
 * 判定はプリセットの**テナント行の有無**で行う（`tenants.provisioning_request_id` が UNIQUE であり、テナントは
 * プリセットが最初に作る行 = 二重投入すると必ず一意制約に当たる行）。「実行日 = T」は `lifecycle_changed_at`（プリセットが
 * `now` を書く唯一の列）から読み返す。
 * @internal `runSeed` と結合テストからのみ使う。
 */
export async function readSeedPresence(db: PrismaClient, preset: SeedPreset): Promise<SeedPresence> {
  const rows = await db.tenant.findMany({
    where: { id: { in: [...preset.tenantIds] } },
    select: { id: true, lifecycleChangedAt: true },
  });
  if (rows.length === 0) return { kind: 'ABSENT' };
  if (rows.length !== preset.tenantIds.length) {
    return { kind: 'INCOMPLETE', presentTenantIds: rows.map((row) => row.id) };
  }
  const seededAt = rows.reduce(
    (latest, row) => (row.lifecycleChangedAt > latest ? row.lifecycleChangedAt : latest),
    rows[0]?.lifecycleChangedAt ?? new Date(0),
  );
  return { kind: 'PRESENT', seededAt };
}

/**
 * プリセットを投入する。`reset` が真なら削除してから投入する。
 *
 * 🔴 ①環境ガード → ②接続 → ③`reset()` → ④`seed()` の順を崩さない。
 *    削除は「実行前の判定」を通ったあとにしか起こらない（F-053 AC-6）。
 * 🔴 T-10-06: `reset: false` で投入済みなら**何も書かず** `ALREADY_SEEDED` を返す（API-A16 の「投入済み（前回 T = …）」）。
 *    一部だけ存在する場合は `SeedIncompleteError`（黙って上書きも追記もしない）。
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
    } else {
      const presence = await readSeedPresence(db, preset);
      if (presence.kind === 'PRESENT') {
        const counts = await countTenantRows(db, preset.tenantIds);
        return { preset: preset.name, tenantIds: preset.tenantIds, counts, outcome: 'ALREADY_SEEDED', seededAt: presence.seededAt };
      }
      if (presence.kind === 'INCOMPLETE') {
        throw new SeedIncompleteError(preset.name, presence.presentTenantIds, preset.tenantIds);
      }
    }
    // ④ seed（固定シードの疑似乱数 + 実行日からの相対日）
    // 🔴 投入全体を 1 つのトランザクションで包まない。Prisma の対話型トランザクションには
    //    時間上限があり、大きなプリセット（`perf` は 1 万件規模。docs/03 §3.7.2）で必ず超えるため。
    //    途中で失敗した場合の回復手段は `--reset` での再実行であり、ID が決定的なので
    //    同じ結果に収束する（F-053 AC-2）。
    await preset.seed({ db, rng: createSeedRng(preset.rngSeed), now });
    const counts = await countTenantRows(db, preset.tenantIds);
    return { preset: preset.name, tenantIds: preset.tenantIds, counts, outcome: 'SEEDED', seededAt: now };
  } finally {
    await db.$disconnect();
  }
}

/**
 * `reset` だけを行う（`F-053 AC-2` の「リセット」。投入は行わない —— 削除と投入は別操作であり、実演者が「空の状態」を
 * 見せたいこともある）。
 *
 * 🔴 ①環境ガード → ②接続 → ③削除前の有無と行数 → ④`reset()` の順を崩さない（F-053 AC-6）。
 * 🔴 T-10-07: 冪等である。プリセットのテナント行が無ければ `NOTHING_TO_RESET`（エラーにしない）。
 *    削除そのもの（`deleteTenantData`）は有無に関わらず流す —— 対象は「プリセットのテナント ID を持つ行」だけであり
 *    0 行なら何も起きない。テナント行が無いのに子の行だけが残る形は作られない（`deleteTenantData` は 1 トランザクション）が、
 *    「有無の判定を信じて削除を省く」より「毎回同じ削除を流す」方が終状態が 1 つに決まる。
 */
export async function runSeedReset(
  options: Omit<RunSeedOptions, 'reset' | 'now'>,
): Promise<RunSeedResult> {
  assertSeedableAppEnv(options.appEnv);
  const preset = getSeedPreset(options.preset);
  const db = new PrismaClient({ datasourceUrl: options.databaseUrl });
  try {
    const presence = await readSeedPresence(db, preset);
    const deletedCounts = await countTenantRows(db, preset.tenantIds);
    await resetPreset(db, preset);
    const counts = await countTenantRows(db, preset.tenantIds);
    return {
      preset: preset.name,
      tenantIds: preset.tenantIds,
      counts,
      outcome: presence.kind === 'ABSENT' ? 'NOTHING_TO_RESET' : 'RESET_ONLY',
      seededAt: null,
      deletedCounts,
    };
  } finally {
    await db.$disconnect();
  }
}
