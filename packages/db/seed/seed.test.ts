// packages/db/seed/seed.test.ts
// T-02-10: シードの「DB を要らない部分」のユニットテスト。
// 🔴 実際の投入（Testcontainers）は tests/isolation/seed-isolation.test.ts と
//    tests/isolation/double-defense.matrix.test.ts が行う。ここで検証するのは
//    ①環境ガードが投入・削除より前にあること（F-053 AC-6）
//    ②ID が決定的かつ衝突しないこと（F-053 AC-2 の冪等な再生成の前提）
//    ③状態は必ず transition() を通ること（docs/05 §13.6）
//    の 3 点である。
import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { InvalidStateTransitionError, proposalMachine } from '@ses/domain';
import { SeedNotAllowedError } from '@ses/config';
import { SeedArgsError, parseSeedArgs, resolveSeedDatabaseUrl } from './args.js';
import { runSeed, runSeedReset } from './index.js';
import { getSeedPreset } from './presets/index.js';
import { DEMO_SEED_IDS, DEMO_SEED_NAME_RULES, demoPreset, demoSeedCompanyNames } from './presets/demo.js';
import { ISOLATION_SEED_IDS, isolationPreset } from './presets/isolation.js';
import {
  buildPerfTenantPlans,
  PERF_SEED_NAME_RULES,
  PERF_SEED_PROFILES,
  PERF_SEED_TENANT_IDS,
  PERF_SEED_TOTALS,
  perfPartnerEngineerCount,
  perfPartnerShareCount,
  perfPreset,
  perfSeedCompanyNames,
  perfSeedIds,
} from './presets/perf.js';
import { createSeedRng } from './rng.js';
import { addDays, advanceState, dateOnly, seedUuid } from './support.js';

const INVALID_URL = 'postgresql://seed:seed@127.0.0.1:1/none?sslmode=disable';

describe('🔴 環境ガードは投入・削除の前にある（F-053 AC-6 / docs/05 §13.6）', () => {
  it.each(['production', 'sandbox', 'staging', undefined, ''])(
    'APP_ENV=%s では runSeed が接続する前に SeedNotAllowedError で止まる',
    async (appEnv) => {
      await expect(
        runSeed({ appEnv, databaseUrl: INVALID_URL, preset: 'isolation', reset: true }),
      ).rejects.toBeInstanceOf(SeedNotAllowedError);
    },
  );

  it.each(['production', 'sandbox', 'staging'])(
    'APP_ENV=%s では runSeedReset（削除だけ）も拒否される',
    async (appEnv) => {
      await expect(
        runSeedReset({ appEnv, databaseUrl: INVALID_URL, preset: 'isolation' }),
      ).rejects.toBeInstanceOf(SeedNotAllowedError);
    },
  );

  // ✅ T-10-07: `F-053 AC-4` / `BR-63`（`sandbox` に合成データを投入しない。`demo` と `sandbox` を兼ねない）を `demo` プリセットで固定する。
  //    上の `it.each` は `isolation` プリセットで環境ガードを見ており、ここでは**実演用の一式（`demo`）そのもの**が `sandbox` に
  //    入り得ないことを、投入（`reset: true` / `false`）と削除の 3 経路で見る。接続文字列は到達不能な値であり、拒否は接続の前で起きる。
  it.each(['sandbox', 'staging', 'production'])(
    '🔴 F-053 AC-4: APP_ENV=%s では demo プリセットが投入・削除のどちらにも到達しない（seed:demo は sandbox に入らない）',
    async (appEnv) => {
      await expect(runSeed({ appEnv, databaseUrl: INVALID_URL, preset: 'demo', reset: true })).rejects.toBeInstanceOf(SeedNotAllowedError);
      await expect(runSeed({ appEnv, databaseUrl: INVALID_URL, preset: 'demo', reset: false })).rejects.toBeInstanceOf(SeedNotAllowedError);
      await expect(runSeedReset({ appEnv, databaseUrl: INVALID_URL, preset: 'demo' })).rejects.toBeInstanceOf(SeedNotAllowedError);
    },
  );

  // ✅ T-12-01: `perf`（1 万件の母集団）も同じガード。`sandbox`（見込み客の実データ）/ `staging` / `production` に 1 万件の
  //    合成データを流し込む経路が無いことを、投入（`reset: true` / `false`）と削除の 3 経路で固定する。
  it.each(['production', 'sandbox', 'staging', undefined, ''])(
    '🔴 T-12-01: APP_ENV=%s では perf プリセットが投入・削除のどちらにも到達しない（seed:perf は demo / development 専用）',
    async (appEnv) => {
      await expect(runSeed({ appEnv, databaseUrl: INVALID_URL, preset: 'perf', reset: true })).rejects.toBeInstanceOf(SeedNotAllowedError);
      await expect(runSeed({ appEnv, databaseUrl: INVALID_URL, preset: 'perf', reset: false })).rejects.toBeInstanceOf(SeedNotAllowedError);
      await expect(runSeedReset({ appEnv, databaseUrl: INVALID_URL, preset: 'perf' })).rejects.toBeInstanceOf(SeedNotAllowedError);
    },
  );
});

describe('CLI の引数（pnpm seed --preset=... [--reset]）', () => {
  it('--preset は必須（既定値を持たない）', () => {
    expect(() => parseSeedArgs([])).toThrow(SeedArgsError);
    expect(() => parseSeedArgs(['--reset'])).toThrow(SeedArgsError);
  });

  it('未知のプリセット名・未知の引数を拒否する', () => {
    expect(() => parseSeedArgs(['--preset=production'])).toThrow(SeedArgsError);
    expect(() => parseSeedArgs(['--preset=isolation', '--force'])).toThrow(SeedArgsError);
  });

  it('--preset と --reset / --reset-only を解釈する', () => {
    expect(parseSeedArgs(['--preset=isolation'])).toEqual({
      preset: 'isolation',
      reset: false,
      resetOnly: false,
      help: false,
    });
    expect(parseSeedArgs(['--preset=isolation', '--reset'])).toEqual({
      preset: 'isolation',
      reset: true,
      resetOnly: false,
      help: false,
    });
    expect(parseSeedArgs(['--preset=demo', '--reset-only']).resetOnly).toBe(true);
  });

  it('🔴 特権接続の接続文字列が無ければ実行できない（既定値にフォールバックしない）', () => {
    expect(() => resolveSeedDatabaseUrl({})).toThrow(SeedArgsError);
    expect(() => resolveSeedDatabaseUrl({ SEED_DATABASE_URL: '' })).toThrow(SeedArgsError);
    expect(resolveSeedDatabaseUrl({ SEED_DATABASE_URL: INVALID_URL })).toBe(INVALID_URL);
  });
});

describe('プリセットの登録簿', () => {
  it('isolation は実装済み', () => {
    expect(getSeedPreset('isolation')).toBe(isolationPreset);
    expect(isolationPreset.tenantIds).toHaveLength(2);
  });

  it('✅ T-10-06: demo は実装済み（2 テナント。取引先 5 社 / 1 社）', () => {
    expect(getSeedPreset('demo')).toBe(demoPreset);
    expect(demoPreset.tenantIds).toHaveLength(2);
    expect(DEMO_SEED_IDS.tenants[0].partners).toHaveLength(5);
    expect(DEMO_SEED_IDS.tenants[1].partners).toHaveLength(1);
    // 🔴 isolation と ID 空間が重ならない（同じ DB に両方を投入できる）。
    expect(demoPreset.tenantIds).not.toContain(isolationPreset.tenantIds[0]);
  });

  it('✅ T-12-01: perf は実装済み（30 テナント。isolation / demo と ID 空間が重ならない）', () => {
    expect(getSeedPreset('perf')).toBe(perfPreset);
    expect(perfPreset.tenantIds).toHaveLength(30);
    expect(perfPreset.tenantIds).toEqual(PERF_SEED_TENANT_IDS);
    for (const tenantId of [...isolationPreset.tenantIds, ...demoPreset.tenantIds]) {
      expect(perfPreset.tenantIds).not.toContain(tenantId);
    }
  });
});

// ---------------------------------------------------------------------------
// ✅ T-12-01: seed:perf（docs/03 §3.7.2 / docs/05 §13.6）
// ---------------------------------------------------------------------------

describe('✅ T-12-01: seed:perf の配分表（docs/03 §3.7.2「30 テナントに配分し、最大 1 社に 3,000 / 3,000 / 15 社」）', () => {
  it('🔴 合計がちょうどエンジニア 10,000 / 案件 10,000 で、テナントは 30', () => {
    expect(PERF_SEED_PROFILES).toHaveLength(PERF_SEED_TOTALS.tenants);
    expect(PERF_SEED_PROFILES.map((row) => row.tenantIndex)).toEqual(Array.from({ length: 30 }, (_, n) => n + 1));
    expect(PERF_SEED_PROFILES.reduce((sum, row) => sum + row.engineers, 0)).toBe(PERF_SEED_TOTALS.engineers);
    expect(PERF_SEED_PROFILES.reduce((sum, row) => sum + row.projects, 0)).toBe(PERF_SEED_TOTALS.projects);
  });

  it('🔴 最大テナント（1 社）がエンジニア 3,000 / 案件 3,000 / 取引先 15 社で、残り 29 社の取引先は 2〜5 社', () => {
    const largest = PERF_SEED_PROFILES.find((row) => row.tenantIndex === PERF_SEED_TOTALS.largestTenantIndex);
    expect(largest).toMatchObject({ engineers: 3000, projects: 3000, partners: 15 });
    for (const row of PERF_SEED_PROFILES) {
      if (row.tenantIndex === PERF_SEED_TOTALS.largestTenantIndex) continue;
      expect(row.engineers, `tenant ${row.tenantIndex}`).toBeLessThan(3000);
      expect(row.projects, `tenant ${row.tenantIndex}`).toBeLessThan(3000);
      expect(row.partners, `tenant ${row.tenantIndex}`).toBeGreaterThanOrEqual(2);
      expect(row.partners, `tenant ${row.tenantIndex}`).toBeLessThanOrEqual(5);
    }
  });

  it('🔴 均等割ではない（規模の異なるテナントが 5 段階以上あり、最小は 100 件未満）', () => {
    const sizes = new Set(PERF_SEED_PROFILES.map((row) => row.engineers));
    expect(sizes.size).toBeGreaterThanOrEqual(5);
    expect(Math.min(...sizes)).toBeLessThan(100);
    expect(Math.max(...sizes)).toBe(3000);
  });

  it('取引先所属の人数は総数を超えず、各取引先へ均等に割れる（端数は先頭から 1 名ずつ）', () => {
    for (const row of PERF_SEED_PROFILES) {
      expect(row.partnerEngineers).toBeLessThanOrEqual(row.engineers);
      let sum = 0;
      for (let partnerIndex = 1; partnerIndex <= row.partners; partnerIndex += 1) sum += perfPartnerEngineerCount(row, partnerIndex);
      expect(sum, `tenant ${row.tenantIndex}`).toBe(row.partnerEngineers);
    }
  });

  it('🔴 匿名共有 2,000 件はすべて最大テナントの取引先 15 社に置かれ、各社の所属人数を超えない', () => {
    let total = 0;
    for (const row of PERF_SEED_PROFILES) {
      for (let partnerIndex = 1; partnerIndex <= row.partners; partnerIndex += 1) {
        const shares = perfPartnerShareCount(row, partnerIndex);
        if (row.tenantIndex !== PERF_SEED_TOTALS.largestTenantIndex) {
          expect(shares).toBe(0);
        } else {
          expect(shares).toBeGreaterThan(0);
          expect(shares).toBeLessThanOrEqual(perfPartnerEngineerCount(row, partnerIndex));
        }
        total += shares;
      }
    }
    expect(total).toBe(PERF_SEED_TOTALS.engineerShares);
  });

  it('商号は demo と同じ接頭辞規則（株式会社サンプル / 株式会社ダミー / 架空）に従い、30 テナント × 取引先で重複しない', () => {
    expect(DEMO_SEED_NAME_RULES.companyPrefixes.some((prefix) => PERF_SEED_NAME_RULES.hostCompanyPrefix.startsWith(prefix))).toBe(true);
    expect(DEMO_SEED_NAME_RULES.companyPrefixes.some((prefix) => PERF_SEED_NAME_RULES.partnerCompanyPrefix.startsWith(prefix))).toBe(true);
    expect(PERF_SEED_NAME_RULES.familyNames).toBe(DEMO_SEED_NAME_RULES.familyNames);
    const all: string[] = [];
    for (const row of PERF_SEED_PROFILES) {
      const names = perfSeedCompanyNames(row.tenantIndex);
      expect(names.partners).toHaveLength(row.partners);
      all.push(names.host, ...names.partners);
    }
    expect(new Set(all).size).toBe(all.length);
    // demo の商号とも重ならない（同じ DB に両方を投入して A-002 で見分けられる）。
    for (const tenantIndex of [1, 2]) {
      const demo = demoSeedCompanyNames(tenantIndex);
      expect(all).not.toContain(demo.host);
      for (const partner of demo.partners) expect(all).not.toContain(partner);
    }
  });
});

describe('✅ T-12-01: seed:perf の計画は決定的（固定シード ses-perf-v1。F-053 AC-2 の前提）', () => {
  const NOW = new Date('2026-09-18T00:00:00.000Z');
  const digest = (value: unknown): string => createHash('sha256').update(JSON.stringify(value)).digest('hex');
  // 1 万件の計画（約 0.5 秒）。この describe の各テストで共有する（生成し直さない）。
  const first = buildPerfTenantPlans(createSeedRng(perfPreset.rngSeed), NOW);
  const HEAVY_TIMEOUT_MS = 60_000;

  it('🔴 同じシード・同じ now で 2 回生成すると、全テナントの氏名・ID・値が一致する', () => {
    const second = buildPerfTenantPlans(createSeedRng(perfPreset.rngSeed), NOW);
    expect(first).toHaveLength(30);
    expect(digest(first)).toBe(digest(second));
    // 抜き取り（ハッシュ一致だけでは「何が一致したか」が読めない）。
    const [a, b] = [first[0], second[0]];
    expect(a?.engineers[0]?.displayName).toBe(b?.engineers[0]?.displayName);
    expect(a?.engineers[2999]?.engineerId).toBe(b?.engineers[2999]?.engineerId);
    expect(a?.projects[2999]?.name).toBe(b?.projects[2999]?.name);
    // シードが違えば別の母集団になる（固定値を返しているだけではない）。
    const other = buildPerfTenantPlans(createSeedRng('ses-perf-other'), NOW);
    expect(digest(other)).not.toBe(digest(first));
  }, HEAVY_TIMEOUT_MS);

  it('🔴 規模が配分表どおりで、共有は最大テナントの取引先所属だけ、氏名は規則の姓 + 空白 + 名', () => {
    const plans = first;
    let engineers = 0;
    let projects = 0;
    let shares = 0;
    let careers = 0;
    for (const plan of plans) {
      expect(plan.engineers).toHaveLength(plan.profile.engineers);
      expect(plan.projects).toHaveLength(plan.profile.projects);
      engineers += plan.engineers.length;
      projects += plan.projects.length;
      for (const engineer of plan.engineers) {
        careers += engineer.careers.length;
        expect(engineer.careers.length).toBeGreaterThanOrEqual(2);
        expect(engineer.careers.length).toBeLessThanOrEqual(4);
        expect(engineer.skills.length).toBeGreaterThanOrEqual(3);
        expect(engineer.skills.length).toBeLessThanOrEqual(8);
        if (engineer.shared) {
          shares += 1;
          expect(plan.profile.tenantIndex).toBe(PERF_SEED_TOTALS.largestTenantIndex);
          expect(engineer.ownerPartnerIndex).not.toBeNull();
        }
        const [family, given, ...rest] = engineer.displayName.split(' ');
        expect(rest).toEqual([]);
        expect(PERF_SEED_NAME_RULES.familyNames as readonly string[]).toContain(family);
        expect(PERF_SEED_NAME_RULES.givenNames as readonly string[]).toContain(given);
      }
    }
    expect(engineers).toBe(PERF_SEED_TOTALS.engineers);
    expect(projects).toBe(PERF_SEED_TOTALS.projects);
    expect(shares).toBe(PERF_SEED_TOTALS.engineerShares);
    // 経歴は 1 人 2〜4 行（約 3 万行）。
    expect(careers).toBeGreaterThan(20_000);
    expect(careers).toBeLessThan(40_000);
  }, HEAVY_TIMEOUT_MS);

  it('🔴 ID がすべて相異なり（エンジニア・案件・取引先・利用者・テナント）、demo / isolation とも重ならない', () => {
    const plans = first;
    const ids: string[] = [];
    for (const plan of plans) {
      const bundle = perfSeedIds(plan.profile.tenantIndex);
      ids.push(bundle.tenantId, bundle.hostOwnerUserId, bundle.hostAdminUserId, ...bundle.hostSalesUserIds, bundle.sendingDomainId, bundle.assignmentId);
      for (const partner of bundle.partners) {
        ids.push(partner.partnerCompanyId, partner.adminUserId, partner.salesUserId, partner.adminMembershipId, partner.salesMembershipId);
      }
      for (const engineer of plan.engineers) ids.push(engineer.engineerId);
      for (const project of plan.projects) ids.push(project.projectId);
      for (let seq = 1; seq <= 4; seq += 1) ids.push(bundle.proposalId(seq));
    }
    expect(ids.length).toBeGreaterThan(20_000);
    expect(new Set(ids).size).toBe(ids.length);
    for (const value of ids) expect(value).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    const foreign = new Set([...demoPreset.tenantIds, ...isolationPreset.tenantIds, DEMO_SEED_IDS.tenants[0].hostOwnerUserId, ISOLATION_SEED_IDS.tenants[0].tenantId]);
    for (const value of ids) expect(foreign.has(value)).toBe(false);
  }, HEAVY_TIMEOUT_MS);

  it('検索が当たる分布: 主要スキル・都道府県・リモート区分・稼働状況が最大テナントにそれぞれ数百件ある', () => {
    const [largest] = first;
    if (largest === undefined) throw new Error('plan');
    const count = (predicate: (engineer: (typeof largest.engineers)[number]) => boolean): number => largest.engineers.filter(predicate).length;
    expect(count((e) => e.skills.some((s) => s.name === 'Java' && s.years >= 3))).toBeGreaterThan(300);
    expect(count((e) => e.prefecture === '13')).toBeGreaterThan(500);
    expect(count((e) => e.prefecture === '13')).toBeLessThan(2500);
    expect(count((e) => e.remoteMode === 'FULL_REMOTE')).toBeGreaterThan(500);
    expect(count((e) => e.availability === 'STANDBY')).toBeGreaterThan(200);
    expect(count((e) => e.unitPriceMin <= 700_000 && e.unitPriceMax >= 700_000)).toBeGreaterThan(300);
    expect(count((e) => e.preferenceNote.includes('フルリモート'))).toBeGreaterThan(200);
    // 都道府県は 47 通りすべてが現れる（`F-009` の都道府県条件がどの値でも空にならない）。
    expect(new Set(largest.engineers.map((e) => e.prefecture)).size).toBe(47);
    // 案件: 公開済み（経路 1）が半数程度、状態は 3 値すべて。
    const published = largest.projects.filter((p) => p.publishedAt !== null).length;
    expect(published).toBeGreaterThan(1000);
    expect(published).toBeLessThan(2000);
    expect(new Set(largest.projects.map((p) => p.status))).toEqual(new Set(['OPEN', 'FILLED', 'SUCCESSOR_WANTED']));
  }, HEAVY_TIMEOUT_MS);
});

describe('ID は決定的で衝突しない（F-053 AC-2 の前提）', () => {
  it('seedUuid は同じ入力から同じ値を返し、UUID の形をしている', () => {
    const a = seedUuid({ presetCode: '150a', tenantIndex: 1, entityCode: 2, seq: 3 });
    const b = seedUuid({ presetCode: '150a', tenantIndex: 1, entityCode: 2, seq: 3 });
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    expect(seedUuid({ presetCode: '150a', tenantIndex: 2, entityCode: 2, seq: 3 })).not.toBe(a);
  });

  it('🔴 isolation プリセットの ID がすべて相異なる（同じ ID を 2 つの行に割り当てない）', () => {
    const ids: string[] = [];
    const collect = (value: unknown): void => {
      if (typeof value === 'string') {
        if (/^[0-9a-f-]{36}$/.test(value)) ids.push(value);
        return;
      }
      if (Array.isArray(value)) {
        for (const item of value) collect(item);
        return;
      }
      if (value !== null && typeof value === 'object') {
        for (const item of Object.values(value)) collect(item);
      }
    };
    collect(ISOLATION_SEED_IDS);
    expect(ids.length).toBeGreaterThan(60);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('🔴 demo プリセットの ID がすべて相異なる（F-053 AC-2 の前提。isolation の ID とも重ならない）', () => {
    const ids: string[] = [];
    const collect = (value: unknown): void => {
      if (typeof value === 'string') {
        if (/^[0-9a-f-]{36}$/.test(value)) ids.push(value);
        return;
      }
      if (Array.isArray(value)) {
        for (const item of value) collect(item);
        return;
      }
      if (value !== null && typeof value === 'object') {
        for (const item of Object.values(value)) collect(item);
      }
    };
    collect(DEMO_SEED_IDS);
    collect(ISOLATION_SEED_IDS);
    expect(ids.length).toBeGreaterThan(120);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('demo の会社名は架空であることが語から分かる接頭辞に従う（F-053 AC-1 / BR-47）', () => {
    for (const tenantIndex of [1, 2]) {
      const names = demoSeedCompanyNames(tenantIndex);
      const prefixes = DEMO_SEED_NAME_RULES.companyPrefixes;
      expect(prefixes.some((prefix) => names.host.startsWith(prefix))).toBe(true);
      for (const partner of names.partners) {
        expect(prefixes.some((prefix) => partner.startsWith(prefix))).toBe(true);
      }
    }
    // 2 テナントの取引先の商号が重ならない（A-002 の一覧で見分けられる）。
    const alpha = demoSeedCompanyNames(1).partners;
    const beta = demoSeedCompanyNames(2).partners;
    expect(alpha.some((name) => beta.includes(name))).toBe(false);
  });

  it('2 テナントの ID が 1 つも重ならない（テナント越境テストの前提）', () => {
    const [first, second] = ISOLATION_SEED_IDS.tenants;
    expect(first.tenantId).not.toBe(second.tenantId);
    expect(first.partners[0].partnerCompanyId).not.toBe(second.partners[0].partnerCompanyId);
  });
});

describe('固定シードの疑似乱数（docs/03 §4.19）', () => {
  it('同じシードなら同じ列を返す', () => {
    const a = createSeedRng('ses-isolation-v1');
    const b = createSeedRng('ses-isolation-v1');
    const drawA = [a.next(), a.int(1, 100), a.pick(['x', 'y', 'z'])];
    const drawB = [b.next(), b.int(1, 100), b.pick(['x', 'y', 'z'])];
    expect(drawA).toEqual(drawB);
  });

  it('シードが違えば列が変わる（固定値を返しているだけではない）', () => {
    const a = createSeedRng('seed-a');
    const b = createSeedRng('seed-b');
    expect(a.next()).not.toBe(b.next());
  });
});

describe('🔴 状態は transition() を通してしか進まない（docs/05 §13.6）', () => {
  it('遷移表にない組は CAS を実行する前に例外になる', async () => {
    const update = vi.fn(async () => 1);
    await expect(
      advanceState(proposalMachine, {
        id: 'p1',
        from: 'DRAFT',
        // DRAFT から APPROVED へ飛ぶ（承認を経ない実行遷移の入口）。
        steps: [{ to: 'APPROVED' as const }],
        update,
      }),
    ).rejects.toBeInstanceOf(InvalidStateTransitionError);
    expect(update).not.toHaveBeenCalled();
  });

  it('CAS が 1 件でなければ失敗する（前提が壊れたまま進まない）', async () => {
    await expect(
      advanceState(proposalMachine, {
        id: 'p1',
        from: 'DRAFT',
        steps: [{ to: 'GATE_RUNNING' as const }],
        update: async () => 0,
      }),
    ).rejects.toThrow(/CAS が 0 件/);
  });

  it('許可された道順は 1 手ずつ CAS される（飛び級しない）', async () => {
    const calls: Array<{ from: string; to: string }> = [];
    const final = await advanceState(proposalMachine, {
      id: 'p1',
      from: 'DRAFT',
      steps: [{ to: 'GATE_RUNNING' as const }, { to: 'APPROVAL_PENDING' as const }],
      update: async ({ from, to }) => {
        calls.push({ from, to });
        return 1;
      },
    });
    expect(final).toBe('APPROVAL_PENDING');
    expect(calls).toEqual([
      { from: 'DRAFT', to: 'GATE_RUNNING' },
      { from: 'GATE_RUNNING', to: 'APPROVAL_PENDING' },
    ]);
  });
});

describe('相対日（docs/05 §13.6「実行日 = T からの相対日」）', () => {
  it('addDays / dateOnly が基準日から決定的に導出される', () => {
    const base = new Date('2026-09-03T04:05:06.000Z');
    expect(addDays(base, 55).toISOString()).toBe('2026-10-28T04:05:06.000Z');
    expect(dateOnly(addDays(base, 55)).toISOString()).toBe('2026-10-28T00:00:00.000Z');
  });
});
