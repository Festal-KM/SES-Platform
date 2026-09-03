// packages/db/seed/seed.test.ts
// T-02-10: シードの「DB を要らない部分」のユニットテスト。
// 🔴 実際の投入（Testcontainers）は tests/isolation/seed-isolation.test.ts と
//    tests/isolation/double-defense.matrix.test.ts が行う。ここで検証するのは
//    ①環境ガードが投入・削除より前にあること（F-053 AC-6）
//    ②ID が決定的かつ衝突しないこと（F-053 AC-2 の冪等な再生成の前提）
//    ③状態は必ず transition() を通ること（docs/05 §13.6）
//    の 3 点である。
import { describe, expect, it, vi } from 'vitest';
import { InvalidStateTransitionError, proposalMachine } from '@ses/domain';
import { SeedNotAllowedError } from '@ses/config';
import { SeedArgsError, parseSeedArgs, resolveSeedDatabaseUrl } from './args.js';
import { runSeed, runSeedReset } from './index.js';
import { SeedPresetNotImplementedError, getSeedPreset } from './presets/index.js';
import { ISOLATION_SEED_IDS, isolationPreset } from './presets/isolation.js';
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

  it('🔴 未実装のプリセットは静かに何もせず終わらない', () => {
    expect(() => getSeedPreset('demo')).toThrow(SeedPresetNotImplementedError);
    expect(() => getSeedPreset('perf')).toThrow(SeedPresetNotImplementedError);
  });
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
