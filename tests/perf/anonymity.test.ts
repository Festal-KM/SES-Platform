// tests/perf/anonymity.test.ts
// 🔴 T-12-06（`docs/sprints/SP-12-phase1-hardening.md` §4 T-12-06 手順 1）: **R-1 の根拠の測定**。
//    `CLAUDE.md` §5 /「§9-13 再識別リスクの評価は Phase 1 のリリース条件」/ `docs/03` §4.13.2-4（一意率の監視指標）。
//
// ---------------------------------------------------------------------------
// 🔴 これは「測定」であって「判定」ではない
// ---------------------------------------------------------------------------
//   本スイートは**閾値で fail しない**。丸めの粒度は 2026-09-10 に人間が承認済み（[Issue #5](https://github.com/Festal-KM/SES-Platform/issues/5)
//   の回答「OK です」）であり、**k-匿名性の件数閾値を Phase 1 に入れないことも同じ回答で確定している**
//   （`docs/03` §4.13.2-4 / `docs/02` A-04）。ここで一意率に `expect` を付けると、
//   「承認された仕様」を「テストの判定」に格上げしてしまい、値が動いた理由を人間が判断する前に赤になる。
//   🔴 したがって `expect` を書くのは**母集団が仕様どおりに揃っているか**（= 測定の前提）だけである。
//   結果は標準出力の Markdown で出し、`docs/dev-plan.md` §8 の意思決定ログに転記する。
//
// ---------------------------------------------------------------------------
// 🔴 何を測るか
// ---------------------------------------------------------------------------
//   `T-12-01` の `seed:perf`（30 テナント / エンジニア 1 万 / 匿名共有 2,000。`docs/03` §3.7.2）を母集団とし、
//   **ホストが実際に見る匿名候補**（`AnonymousCandidateView`）の**丸め後 5 項目の組み合わせの一意率**を出す。
//     ① 母集団規模 — 共有中のエンジニア数 / パートナー社数 / **テナントあたりの分布**（最大・中央・最小）
//     ② 一意率 — 同じ組み合わせが 1 件しか無い候補の割合。2 件以下 / 5 件以下も併記
//     ③ 一意になりやすい条件 — 項目の部分集合ごとの寄与（ablation）と、都道府県 / 単価帯 / 希少スキルの層別
//     ④ 母集団が小さいときの見通し — 部分標本（n = 25〜2,000）での一意率（再評価トリガ N の根拠）
//
//   🔴 **テナント単位で算出する。** ホストが見るのは自テナントの共有候補だけであり、そこが実際の母集団である。
//      全テナント合算で薄めると、実際より安全に見える。
//
// ---------------------------------------------------------------------------
// 🔴 丸めを再実装しない
// ---------------------------------------------------------------------------
//   値は **`GET /api/engineers?projectId=`（#15 = #30 と同じ `listProjectCandidates`）の応答**から採る。
//   すなわち `withSharedCandidateScope` → `listSharedEngineers` → `buildAnonymousCandidateViews` →
//   `anonymizeEngineer`（`packages/domain`）+ `ANONYMIZE_ROUNDING`（`packages/config`）という**本番と同じ 1 本の経路**を通る。
//   🔴 本ファイルは丸めの関数も粒度の定数も持たない（二重実装を作ると「何を承認したのか」が崩れる）。
//   🔴 `withSharedCandidateScope` を直接 import しない（ESLint が `apps/web/lib/candidates/list.ts` の 1 ファイルに
//      限定している。CATCH_ALL を緩めない）。API 境界から読むのは、その制約と「ホストが実際に見る値を測る」が一致するため。
//
// ---------------------------------------------------------------------------
// 実行
// ---------------------------------------------------------------------------
//   `npx vitest run -c vitest.perf.config.ts --maxWorkers=1 --reporter=verbose tests/perf/anonymity.test.ts`
//   ⚠️ **非 TTY（ログへのリダイレクト / CI）では `--reporter=verbose` が要る** —— 既定のレポータは
//      非 TTY で `console.info` を出さず、本スイートの成果物（Markdown の表）が消える。
//
// 🔴 モックは `requireTenantCtx` / `readRequestMeta`（ctx の出所）と `lib/db/bootstrap`（起動時 DI の 2 値）だけ。
//    DB・RLS・共有スコープ・Route Handler・丸めはすべて実物である。外部 API に接続しない（`CLAUDE.md` §11.1）。
// 🔴 合成データのみ（`seed:perf`。`BR-47`）。本番・実データを読まない。
import os from 'node:os';
import { performance } from 'node:perf_hooks';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { configureTenantDb, disconnectTenantDb, type AuthenticatedTenantCtx } from '@ses/db';
import {
  createSeedRng,
  PERF_SEED_PROFILES,
  PERF_SEED_TOTALS,
  perfPartnerShareCount,
  perfSeedIds,
  runSeed,
  type RunSeedResult,
} from '@ses/db/seed';
import { startIsolationDatabase, type IsolationDatabase } from '../isolation/support/postgres.js';

const SETUP_TIMEOUT_MS = 900_000;
const MEASURE_TIMEOUT_MS = 900_000;
const META = { deviceKind: 'api', ipAddress: '203.0.113.121' } as const;
/** 「実行日 = T」。seed の相対日の基準であり、稼働可能時期の丸めの基準日でもある。 */
const NOW = new Date();
/** 1 ページの上限（`PAGE_SIZE_MAX`）。母集団 2,750 件を 14 ページで読み切る。 */
const PAGE_LIMIT = 200;
const POSTGRES_LABEL = 'PostgreSQL 17 (postgres:17-bookworm / Testcontainers)';

const requireTenantCtxMock = vi.fn<() => Promise<AuthenticatedTenantCtx>>();
vi.mock('../../apps/web/lib/auth/session', () => ({
  requireTenantCtx: () => requireTenantCtxMock(),
  readRequestMeta: async () => META,
}));

/** 🔴 テスト専用の HMAC 鍵（`phase1-load.test.ts` と同じ理由で `bootstrap` を通さない）。 */
const TEST_SECRET = 'C'.repeat(43) + '=';
const { createCandidateReference } = await import('../../apps/web/lib/anonymize/reference');
const candidateRef = createCandidateReference(TEST_SECRET);
const sendingDomainRuntime = { region: 'ap-northeast-1', verificationRequired: true };
vi.mock('../../apps/web/lib/db/bootstrap', () => ({
  candidateReference: () => candidateRef,
  sendingDomainRuntime: () => sendingDomainRuntime,
}));

const { buildTenantCtx } = await import('../../apps/web/lib/auth/tenant-context');
const engineersRoute = await import('../../apps/web/app/api/(main)/engineers/route');
const { ANONYMOUS_CANDIDATE_VIEW_KEYS } = await import('../../apps/web/lib/anonymize/candidate-view');
type AnonymousCandidateView = import('../../apps/web/lib/anonymize/candidate-view').AnonymousCandidateView;

const LARGEST_INDEX = PERF_SEED_TOTALS.largestTenantIndex;
const LARGEST_PROFILE = PERF_SEED_PROFILES[0]!;
const LARGEST_HOST_ENGINEERS = LARGEST_PROFILE.engineers - LARGEST_PROFILE.partnerEngineers;

let database: IsolationDatabase;
let seedRun: RunSeedResult;
let seedDurationMs = 0;
/** 最大テナント（= 匿名共有の母集団が存在する唯一のテナント）のホストが見る匿名候補の全件。 */
let candidates: readonly AnonymousCandidateView[] = [];
/** テナント index → そのテナントのホストに見える匿名候補の件数（実測）。 */
const sharedPerTenant = new Map<number, number>();
/** 標準出力に出す Markdown。 */
const report: string[] = [];

// ---------------------------------------------------------------------------
// 指紋（🔴 丸めた後の値だけを連結する。丸め自体は API 経路が済ませている）
// ---------------------------------------------------------------------------

type ListBody = {
  readonly items: readonly Record<string, unknown>[];
  readonly total: number;
  readonly nextCursor: string | null;
};

function isAnonymous(item: Record<string, unknown>): boolean {
  return 'candidateRef' in item;
}

/** ① スキル（表示される上位 8 件。**並びも開示されている**ので順序込みで採る）。 */
function skillsKey(view: AnonymousCandidateView): string {
  return view.skills.map((skill) => skill.name).join('+');
}

/** ③ 単価帯。 */
function priceKey(view: AnonymousCandidateView): string {
  const band = view.priceBand;
  if (band === null) return '-';
  return band.kind === 'OPEN' ? `${String(band.fromManYen)}-` : `${String(band.fromManYen)}_${String(band.toManYen)}`;
}

/** ⑤ 勤務地（都道府県 + リモート 3 値）。 */
function locationKey(view: AnonymousCandidateView): string {
  return `${view.prefecture ?? '-'}/${view.remoteMode ?? '-'}`;
}

/** ② 経験年数 / ④ 稼働可能時期。 */
function yearsKey(view: AnonymousCandidateView): string {
  return view.yearsBand ?? '-';
}
function availabilityKey(view: AnonymousCandidateView): string {
  return view.availabilityBand ?? '-';
}

/** 🔴 丸め後 5 項目の組み合わせ（= `docs/03` §4.13.2-4 が言う「同一の丸め済み属性の組み合わせ」）。 */
function fingerprint(view: AnonymousCandidateView): string {
  return [skillsKey(view), yearsKey(view), priceKey(view), availabilityKey(view), locationKey(view)].join('|');
}

/**
 * 🔴 スキルを除く 4 項目（②③④⑤）の組み合わせ。
 *
 * 🔴 **なぜ 2 本目の指紋を持つか**: 5 項目の一意率はスキルの並びに支配される（③-1 参照）。
 *    `seed:perf` のスキルは辞書からの重み付き抽選 + 経験年数の乱数であり、**実台帳より組み合わせの
 *    エントロピーが大きい**（実務では Java/Spring/Oracle のように共起が偏る）。
 *    したがって 5 項目の値だけでは「母集団の大小が再識別に効くか」を読み取れない。
 *    スキルを外した 4 項目は分布が実務に近く（都道府県は首都圏・関西に寄せた重み、単価は
 *    45〜95 万円、稼働可能時期は 5 区分、経験年数は 4 区分）、**母集団規模の効きを読むのはこちらである**。
 */
function noSkillsFingerprint(view: AnonymousCandidateView): string {
  return [yearsKey(view), priceKey(view), availabilityKey(view), locationKey(view)].join('|');
}

/** 参考: 画面に出る更新日（`U-06` / §4.13.2-2）まで含めた組み合わせ。5 項目には含まれないが、目には入る。 */
function fingerprintWithUpdatedOn(view: AnonymousCandidateView): string {
  return `${fingerprint(view)}|${view.updatedOn}`;
}

/** 報告で常に対にする 2 本の指紋。 */
const FINGERPRINTS = [
  { label: '5 項目', of: fingerprint },
  { label: '4 項目（スキル除く）', of: noSkillsFingerprint },
] as const;

type Uniqueness = {
  readonly n: number;
  readonly groups: number;
  /** 群の大きさが 1 の候補の割合（= 一意率）。 */
  readonly unique: number;
  readonly atMost2: number;
  readonly atMost5: number;
  readonly largestGroup: number;
};

function groupSizes(keys: readonly string[]): Map<string, number> {
  const sizes = new Map<string, number>();
  for (const key of keys) sizes.set(key, (sizes.get(key) ?? 0) + 1);
  return sizes;
}

/** 群の大きさが `atMost` 以下の**候補**の割合（群の割合ではない）。 */
function shareOfCandidatesInSmallGroups(sizes: ReadonlyMap<string, number>, total: number, atMost: number): number {
  let count = 0;
  for (const size of sizes.values()) if (size <= atMost) count += size;
  return total === 0 ? 0 : count / total;
}

function uniqueness(keys: readonly string[]): Uniqueness {
  const sizes = groupSizes(keys);
  let largest = 0;
  for (const size of sizes.values()) if (size > largest) largest = size;
  return {
    n: keys.length,
    groups: sizes.size,
    unique: shareOfCandidatesInSmallGroups(sizes, keys.length, 1),
    atMost2: shareOfCandidatesInSmallGroups(sizes, keys.length, 2),
    atMost5: shareOfCandidatesInSmallGroups(sizes, keys.length, 5),
    largestGroup: largest,
  };
}

function pct(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

// ---------------------------------------------------------------------------
// セットアップ
// ---------------------------------------------------------------------------

async function ctxOf(tenantIndex: number): Promise<AuthenticatedTenantCtx> {
  const ids = perfSeedIds(tenantIndex);
  const ctx = await buildTenantCtx(
    { tenantId: ids.tenantId, partnerCompanyId: null, userId: ids.hostSalesUserIds[0], twoFactorVerified: true },
    { deviceKind: 'api' },
  );
  if (ctx === null) throw new Error(`テナント ${String(tenantIndex)} のホスト SALES の ctx を作れません（seed の前提の破綻）。`);
  return ctx;
}

async function getPage(ctx: AuthenticatedTenantCtx, query: string): Promise<ListBody> {
  requireTenantCtxMock.mockResolvedValue(ctx);
  const response = await engineersRoute.GET(new Request(`https://app.test/api/engineers?${query}`));
  if (response.status !== 200) {
    throw new Error(`GET /api/engineers?${query} → ${String(response.status)}: ${await response.text()}`);
  }
  return (await response.json()) as ListBody;
}

/** 案件 1 件に対するホストの候補一覧を**全ページ**読み、匿名候補だけを返す。 */
async function readAllAnonymous(tenantIndex: number): Promise<readonly AnonymousCandidateView[]> {
  const ctx = await ctxOf(tenantIndex);
  const projectId = perfSeedIds(tenantIndex).projectId(1);
  const collected: AnonymousCandidateView[] = [];
  let cursor: string | null = null;
  let guard = 0;
  for (;;) {
    guard += 1;
    if (guard > 200) throw new Error('ページングが終わりません（カーソルの実装の破綻）。');
    const query = `projectId=${projectId}&limit=${String(PAGE_LIMIT)}${cursor === null ? '' : `&cursor=${encodeURIComponent(cursor)}`}`;
    const page: ListBody = await getPage(ctx, query);
    for (const item of page.items) {
      if (isAnonymous(item)) collected.push(item as unknown as AnonymousCandidateView);
    }
    if (page.nextCursor === null) break;
    cursor = page.nextCursor;
  }
  return collected;
}

beforeAll(async () => {
  database = await startIsolationDatabase({ seed: 'none' });
  const seedStartedAt = performance.now();
  seedRun = await runSeed({
    appEnv: 'development',
    databaseUrl: database.superuserUrl,
    preset: 'perf',
    reset: false,
    now: NOW,
  });
  seedDurationMs = performance.now() - seedStartedAt;
  configureTenantDb({ datasourceUrl: database.tenantUrl });

  // 🔴 テナント単位の母集団を実測する（配分表を信じるのではなく、ホストの応答で数える）。
  //    最大テナントは全件、それ以外は 1 ページ目に匿名候補が 1 件も無いことを見る（配分表では 0 件）。
  candidates = await readAllAnonymous(LARGEST_INDEX);
  sharedPerTenant.set(LARGEST_INDEX, candidates.length);
  for (const profile of PERF_SEED_PROFILES) {
    if (profile.tenantIndex === LARGEST_INDEX) continue;
    const ctx = await ctxOf(profile.tenantIndex);
    const page = await getPage(ctx, `projectId=${perfSeedIds(profile.tenantIndex).projectId(1)}&limit=${String(PAGE_LIMIT)}`);
    sharedPerTenant.set(profile.tenantIndex, page.items.filter(isAnonymous).length);
  }
}, SETUP_TIMEOUT_MS);

afterAll(async () => {
  const cpu = os.cpus()[0]?.model.trim() ?? 'unknown CPU';
  console.info(
    [
      '',
      `## T-12-06 匿名 5 項目の一意率の実測（${NOW.toISOString()}）`,
      `- 環境: ${cpu} / ${String(os.cpus().length)} threads / ${(os.totalmem() / 1024 ** 3).toFixed(1)} GB / node ${process.version} / ${os.platform()} ${os.release()} / ${POSTGRES_LABEL}`,
      `- シード: perf v1（${seedRun?.outcome ?? '-'}。${String(Math.round(seedDurationMs))} ms）。engineers ${String(seedRun?.counts.engineers ?? '-')} / engineer_shares ${String(seedRun?.counts.engineer_shares ?? '-')}`,
      '- 丸め: `anonymizeEngineer`（packages/domain）+ `ANONYMIZE_ROUNDING`（packages/config）。**本ファイルは丸めを持たない**',
      '',
      ...report,
      '',
    ].join('\n'),
  );
  await disconnectTenantDb();
  await database?.stop();
}, SETUP_TIMEOUT_MS);

// ---------------------------------------------------------------------------
// ① 母集団規模
// ---------------------------------------------------------------------------

describe('① 母集団規模（T-12-06 手順 2 ①）', () => {
  it('🔴 seed:perf の匿名共有 2,000 件が、最大テナントのホストの候補一覧に全件現れている', () => {
    expect(seedRun.counts.engineer_shares).toBe(PERF_SEED_TOTALS.engineerShares);
    expect(candidates).toHaveLength(PERF_SEED_TOTALS.engineerShares);
    // 応答のキーは 8 個ちょうど（開示項目が増えていない = 測定対象が仕様どおり）。
    for (const view of candidates) {
      expect(Object.keys(view).sort()).toEqual([...ANONYMOUS_CANDIDATE_VIEW_KEYS]);
    }
  });

  it('🔴 テナントあたりの分布を出す（ホストが見る母集団の単位はテナントである）', () => {
    const counts = [...sharedPerTenant.entries()].sort((a, b) => a[0] - b[0]).map(([, count]) => count);
    const sorted = [...counts].sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)] as number;
    const partnersSharing = Array.from({ length: LARGEST_PROFILE.partners }, (_, n) =>
      perfPartnerShareCount(LARGEST_PROFILE, n + 1),
    );
    const totalPartners = PERF_SEED_PROFILES.reduce((acc, profile) => acc + profile.partners, 0);

    report.push(
      '### ① 母集団規模',
      '',
      '| 指標 | 実測 |',
      '|---|---|',
      `| 共有中（revoked_at IS NULL）のエンジニア | ${String(candidates.length)} 件 |`,
      `| 匿名共有が存在するテナント | ${String(counts.filter((c) => c > 0).length)} / ${String(PERF_SEED_PROFILES.length)} |`,
      `| テナントあたりの共有件数（最大 / 中央 / 最小） | ${String(sorted[sorted.length - 1] ?? 0)} / ${String(median)} / ${String(sorted[0] ?? 0)} |`,
      `| パートナー社数（全テナント計 / 最大テナント / うち共有中） | ${String(totalPartners)} / ${String(LARGEST_PROFILE.partners)} / ${String(partnersSharing.filter((c) => c > 0).length)} |`,
      `| 1 社あたりの共有件数（最大テナント。最大 / 最小） | ${String(Math.max(...partnersSharing))} / ${String(Math.min(...partnersSharing))} |`,
      `| ホスト自社エンジニア（最大テナント。混在する分母） | ${String(LARGEST_HOST_ENGINEERS)} 件 |`,
      '',
      '⚠️ `seed:perf` は**検索の最悪ケース**を作る配分であり、匿名共有 2,000 件を最大テナント 1 社に集中させている',
      '（`docs/03` §3.7.2 / `PERF_SEED_TOTALS.engineerShares`）。したがって「テナントあたりの中央値 0」は',
      '**実運用の分布の推定ではなく、測定用の配分**である。実運用で想定される小さい母集団は ④ の部分標本で見る。',
      '',
    );
    expect(counts.filter((count) => count > 0)).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// ② 一意率
// ---------------------------------------------------------------------------

describe('② 丸め後の組み合わせの一意率（T-12-06 手順 2 ③ / docs/03 §4.13.2-4）', () => {
  it('🔴 5 項目の組み合わせの一意率を算出する（閾値では判定しない）', () => {
    const full = uniqueness(candidates.map(fingerprint));
    const withDay = uniqueness(candidates.map(fingerprintWithUpdatedOn));
    const noSkills = uniqueness(candidates.map(noSkillsFingerprint));
    report.push(
      '### ② 一意率（テナント単位。母集団 = 最大テナントの 2,000 件）',
      '',
      '| 指紋の取り方 | 候補数 | 異なる組み合わせ | 一意（1 件）| 2 件以下 | 5 件以下 | 最大の群 |',
      '|---|---:|---:|---:|---:|---:|---:|',
      `| 🔴 **丸め後 5 項目**（A-04） | ${String(full.n)} | ${String(full.groups)} | **${pct(full.unique)}** | ${pct(full.atMost2)} | ${pct(full.atMost5)} | ${String(full.largestGroup)} |`,
      `| 参考: 5 項目 + 更新日（U-06 の表示列） | ${String(withDay.n)} | ${String(withDay.groups)} | ${pct(withDay.unique)} | ${pct(withDay.atMost2)} | ${pct(withDay.atMost5)} | ${String(withDay.largestGroup)} |`,
      `| 🔴 参考: スキルを除く 4 項目（母集団規模の効きはこちらで読む） | ${String(noSkills.n)} | ${String(noSkills.groups)} | **${pct(noSkills.unique)}** | ${pct(noSkills.atMost2)} | ${pct(noSkills.atMost5)} | ${String(noSkills.largestGroup)} |`,
      '',
    );
    // 🔴 測定であって判定ではない。値そのものに `expect` を置かない（このファイル冒頭の理由）。
    expect(full.n).toBe(PERF_SEED_TOTALS.engineerShares);
  });
});

// ---------------------------------------------------------------------------
// ③ 一意になりやすい条件
// ---------------------------------------------------------------------------

describe('③ 一意になりやすい条件（T-12-06 手順 2 ③「特定されうる条件」）', () => {
  it('🔴 項目の部分集合ごとの寄与（どの項目が指紋を作っているか）', () => {
    // 🔴 「仮に〜した場合」の行は**緩和策の効き目を測るための ablation** であり、実装の変更ではない
    //    （丸めは `anonymizeEngineer` のままで、ここでは測った出力を切り詰めているだけ）。
    //    粒度を変えるには `docs/03` §4.13.1 の改訂と再承認が要る（`CLAUDE.md` §8.6 / §8.7）。
    const skillsUnordered = (v: AnonymousCandidateView): string =>
      v.skills.map((skill) => skill.name).sort().join('+');
    const skillsTop = (v: AnonymousCandidateView, take: number): string =>
      v.skills.slice(0, take).map((skill) => skill.name).join('+');

    const subsets: readonly { readonly label: string; readonly key: (v: AnonymousCandidateView) => string }[] = [
      { label: '① スキル（上位 8 件・順序込み = 現行）のみ', key: skillsKey },
      { label: '① スキル（上位 8 件・**順不同の集合**。並び順を伏せた場合）のみ', key: skillsUnordered },
      { label: '① スキル（仮に**上位 3 件**に絞った場合・順序込み）のみ', key: (v) => skillsTop(v, 3) },
      { label: '② 経験年数のみ', key: yearsKey },
      { label: '③ 単価帯のみ', key: priceKey },
      { label: '④ 稼働可能時期のみ', key: availabilityKey },
      { label: '⑤ 勤務地 + リモートのみ', key: locationKey },
      {
        label: '②③④⑤（スキルを除く 4 項目）',
        key: (v) => [yearsKey(v), priceKey(v), availabilityKey(v), locationKey(v)].join('|'),
      },
      { label: '①⑤（スキル + 勤務地）', key: (v) => [skillsKey(v), locationKey(v)].join('|') },
      { label: '①③（スキル + 単価帯）', key: (v) => [skillsKey(v), priceKey(v)].join('|') },
      { label: '🔴 ①〜⑤（開示される全部 = 現行）', key: fingerprint },
      {
        label: '①〜⑤（仮にスキルを**上位 3 件**に絞った場合）',
        key: (v) => [skillsTop(v, 3), yearsKey(v), priceKey(v), availabilityKey(v), locationKey(v)].join('|'),
      },
      {
        label: '①〜⑤（仮にスキルを**上位 1 件**に絞った場合）',
        key: (v) => [skillsTop(v, 1), yearsKey(v), priceKey(v), availabilityKey(v), locationKey(v)].join('|'),
      },
    ];
    report.push(
      '### ③-1 どの項目が指紋を作っているか（部分集合ごとの一意率）',
      '',
      '| 指紋に使った項目 | 異なる値 | 一意 | 2 件以下 | 5 件以下 |',
      '|---|---:|---:|---:|---:|',
    );
    for (const subset of subsets) {
      const stat = uniqueness(candidates.map(subset.key));
      report.push(
        `| ${subset.label} | ${String(stat.groups)} | ${pct(stat.unique)} | ${pct(stat.atMost2)} | ${pct(stat.atMost5)} |`,
      );
    }
    report.push('');
    expect(candidates.length).toBeGreaterThan(0);
  });

  it('🔴 層別の一意率（都道府県 / 単価帯 / 稼働可能時期 / スキル件数 / 最も希少なスキルの出現数）', () => {
    // 🔴 層別は 2 本の指紋の**両方**で出す。5 項目だけだと全層 100% で「どの層が危ないか」が読めない。
    const uniqueFlags = FINGERPRINTS.map((entry) => {
      const keys = candidates.map(entry.of);
      const sizes = groupSizes(keys);
      return keys.map((key) => (sizes.get(key) ?? 0) === 1);
    });

    /** スキル名 → その名称を開示している候補の数（＝ 希少さの尺度）。 */
    const skillFrequency = new Map<string, number>();
    for (const view of candidates) {
      for (const skill of view.skills) skillFrequency.set(skill.name, (skillFrequency.get(skill.name) ?? 0) + 1);
    }
    const rarestSkillFrequency = (view: AnonymousCandidateView): number => {
      let min = Number.POSITIVE_INFINITY;
      for (const skill of view.skills) {
        const frequency = skillFrequency.get(skill.name) ?? 0;
        if (frequency < min) min = frequency;
      }
      return Number.isFinite(min) ? min : 0;
    };
    const frequencyBand = (frequency: number): string => {
      if (frequency <= 50) return 'a. 〜50 件（最も希少）';
      if (frequency <= 150) return 'b. 51〜150 件';
      if (frequency <= 400) return 'c. 151〜400 件';
      return 'd. 401 件〜（ありふれている）';
    };

    const strata: readonly { readonly label: string; readonly of: (v: AnonymousCandidateView) => string }[] = [
      { label: '都道府県', of: (v) => v.prefecture ?? '-' },
      { label: '単価帯', of: priceKey },
      { label: '稼働可能時期', of: availabilityKey },
      { label: '経験年数', of: yearsKey },
      { label: 'リモート可否', of: (v) => v.remoteMode ?? '-' },
      { label: '開示スキル件数', of: (v) => String(v.skills.length).padStart(2, '0') },
      { label: '最も希少なスキルの出現数', of: (v) => frequencyBand(rarestSkillFrequency(v)) },
    ];

    /** 層ごとに「候補数 / 5 項目の一意率 / 4 項目の一意率」を数える。 */
    const tally = (
      keyOf: (view: AnonymousCandidateView) => string,
    ): Map<string, { total: number; unique5: number; unique4: number }> => {
      const buckets = new Map<string, { total: number; unique5: number; unique4: number }>();
      candidates.forEach((view, index) => {
        const bucketKey = keyOf(view);
        const bucket = buckets.get(bucketKey) ?? { total: 0, unique5: 0, unique4: 0 };
        bucket.total += 1;
        if (uniqueFlags[0]?.[index] === true) bucket.unique5 += 1;
        if (uniqueFlags[1]?.[index] === true) bucket.unique4 += 1;
        buckets.set(bucketKey, bucket);
      });
      return buckets;
    };
    /** 🔴 4 項目の一意率の高い順 10 行だけ出す（47 都道府県を全部出しても読めない）。 */
    const TOP_ROWS = 10;

    for (const stratum of strata) {
      const buckets = tally(stratum.of);
      const sorted = [...buckets.entries()].sort(
        (a, b) => b[1].unique4 / b[1].total - a[1].unique4 / a[1].total || b[1].total - a[1].total,
      );
      report.push(
        `### ③-2 層別の一意率 — ${stratum.label}（4 項目の一意率の高い順。上位 ${String(TOP_ROWS)} 層）`,
        '',
        `| ${stratum.label} | 候補数 | 5 項目の一意率 | 4 項目の一意率 |`,
        '|---|---:|---:|---:|',
        ...sorted
          .slice(0, TOP_ROWS)
          .map(
            ([bucketKey, bucket]) =>
              `| ${bucketKey} | ${String(bucket.total)} | ${pct(bucket.unique5 / bucket.total)} | ${pct(bucket.unique4 / bucket.total)} |`,
          ),
        sorted.length > TOP_ROWS ? `（ほか ${String(sorted.length - TOP_ROWS)} 層は省略）` : '',
        '',
      );
    }

    // 🔴 「特定されうる条件」を名指しするための 3 項目の掛け合わせ。**4 項目の一意率**で並べる
    //    （5 項目で並べると全セル 100% になり、条件を名指しできない）。
    const cells = tally((view) => `${view.prefecture ?? '-'} × ${priceKey(view)} × ${availabilityKey(view)}`);
    const top = [...cells.entries()]
      .filter(([, cell]) => cell.total >= 5)
      .sort((a, b) => b[1].unique4 / b[1].total - a[1].unique4 / a[1].total || b[1].total - a[1].total)
      .slice(0, TOP_ROWS);
    const bottom = [...cells.entries()]
      .filter(([, cell]) => cell.total >= 5)
      .sort((a, b) => a[1].unique4 / a[1].total - b[1].unique4 / b[1].total || b[1].total - a[1].total)
      .slice(0, 5);
    report.push(
      `### ③-3 都道府県 × 単価帯 × 稼働可能時期（候補 5 件以上のセル。4 項目の一意率の高い順 ${String(TOP_ROWS)} 件 / 低い順 5 件）`,
      '',
      '| セル | 候補数 | 5 項目の一意率 | 4 項目の一意率 |',
      '|---|---:|---:|---:|',
      ...top.map(
        ([cellKey, cell]) =>
          `| ${cellKey} | ${String(cell.total)} | ${pct(cell.unique5 / cell.total)} | ${pct(cell.unique4 / cell.total)} |`,
      ),
      '| … | | | |',
      ...bottom.map(
        ([cellKey, cell]) =>
          `| ${cellKey} | ${String(cell.total)} | ${pct(cell.unique5 / cell.total)} | ${pct(cell.unique4 / cell.total)} |`,
      ),
      '',
    );
    expect(top.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// ④ 母集団が小さいときの見通し（再評価トリガ N の根拠）
// ---------------------------------------------------------------------------

describe('④ 部分標本での一意率（再評価トリガの根拠）', () => {
  it('🔴 母集団を縮めたときに一意率がどう動くかを出す', { timeout: MEASURE_TIMEOUT_MS }, () => {
    // 🔴 決定的な標本抽出（`createSeedRng`。`Math.random()` を使わない = 同じ母集団なら同じ表になる）。
    const rng = createSeedRng('ses-anonymity-subsample-v1');
    const sizes = [10, 25, 50, 100, 200, 400, 800, 1_500, PERF_SEED_TOTALS.engineerShares];
    const repeats = 20;
    const indices = candidates.map((_, index) => index);
    report.push(
      '### ④ 部分標本（テナントあたりの共有件数を n としたときの一意率。標本ごと 20 回の平均）',
      '',
      '🔴 5 項目は n に関係なく上限に張り付く（スキルの並びが指紋だから）。**母集団規模の効きは 4 項目の列で読む。**',
      '',
      '| n（テナントの共有件数）| 5 項目: 一意 | 5 項目: 5 件以下 | 4 項目: 一意 | 4 項目: 2 件以下 | 4 項目: 5 件以下 |',
      '|---:|---:|---:|---:|---:|---:|',
    );
    for (const size of sizes) {
      const rounds = size >= indices.length ? 1 : repeats;
      const sums = [
        { unique: 0, atMost2: 0, atMost5: 0 },
        { unique: 0, atMost2: 0, atMost5: 0 },
      ];
      for (let round = 0; round < rounds; round += 1) {
        // 部分 Fisher–Yates（先頭 `size` 件だけ確定させる）。🔴 2 本の指紋で**同じ標本**を使う。
        const pool = [...indices];
        for (let i = 0; i < size; i += 1) {
          const j = i + rng.int(0, pool.length - 1 - i);
          const tmp = pool[i] as number;
          pool[i] = pool[j] as number;
          pool[j] = tmp;
        }
        const sample = pool.slice(0, size).map((index) => candidates[index] as AnonymousCandidateView);
        FINGERPRINTS.forEach((entry, which) => {
          const stat = uniqueness(sample.map(entry.of));
          const sum = sums[which] as { unique: number; atMost2: number; atMost5: number };
          sum.unique += stat.unique;
          sum.atMost2 += stat.atMost2;
          sum.atMost5 += stat.atMost5;
        });
      }
      const five = sums[0] as { unique: number; atMost2: number; atMost5: number };
      const four = sums[1] as { unique: number; atMost2: number; atMost5: number };
      report.push(
        `| ${String(size)} | ${pct(five.unique / rounds)} | ${pct(five.atMost5 / rounds)} | **${pct(four.unique / rounds)}** | ${pct(four.atMost2 / rounds)} | ${pct(four.atMost5 / rounds)} |`,
      );
    }
    report.push('');
    expect(indices).toHaveLength(PERF_SEED_TOTALS.engineerShares);
  });
});
