// packages/db/src/platform/queries/gate-stalls.test.ts
// T-11-05: `GATE_RUNNING` の滞留（docs/02 `F-059 AC-6` / docs/05 §16.5 項目 12）のうち **DB を要らない部分**。
//
// 🔴 `withPlatformRead` を通る側（監査行・GRANT・全テナント横断の読み取り・応答に本文が無いこと）は
//    `tests/isolation/admin-gate-stalls.test.ts`（Testcontainers）が実証する。
//    ここで見るのは候補 → 3 区分の純粋関数 `classifyGateStalls` である:
//      ① 保留行がある提案は `AI_COST_LIMIT_HELD`、failed にある提案は `JOB_FAILED`、どちらも無く閾値超過は `RUNNING_OVERDUE`
//      ② 閾値未満の `GATE_RUNNING` は載らない（実行中の正常な待ちを障害に見せない）。境界は「ちょうど」で載る
//      ③ 🔴 保留行 + failed 記録の両方がある対象は `JOB_FAILED`（失敗が優先。自動復帰が止まっている）
//      ④ `countsByReason` は 3 区分が別キーで、`total` と一致する
//      ⑤ `PROPOSAL` 以外（`PROJECT_PUBLISH`）の保留行・失敗記録はそのまま載る。`GATE_RUNNING` でない提案に残った
//         保留行・失敗記録（削除・パージの残骸）は載らない
//      ⑥ 並びは `since` の昇順（最も長く止まっているものが先頭）。`stalledMinutes` は `now` から決定的に出る
//      ⑦ 未知の `targetType` / 不正な閾値は黙って捨てない
//      ⑧ 🔴 本モジュールが読む列は状態・時刻・ID だけ（ソース走査。`select` に本文・件名・提案先・findings が無い）
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  classifyGateStalls,
  GATE_STALL_REASONS,
  type FailedGateRunJob,
  type GateRunningProposal,
  type HeldReviewGateRow,
} from './gate-stalls.js';

const NOW = new Date('2026-09-16T09:00:00.000Z');
const minutesAgo = (minutes: number): Date => new Date(NOW.getTime() - minutes * 60_000);

const TENANT_A = '01930000-0000-7000-8000-0000000000a1';
const TENANT_B = '01930000-0000-7000-8000-0000000000b1';
const PROPOSAL_HELD = '01930000-0000-7000-8000-000000001101';
const PROPOSAL_FAILED = '01930000-0000-7000-8000-000000001102';
const PROPOSAL_OVERDUE = '01930000-0000-7000-8000-000000001103';
const PROPOSAL_FRESH = '01930000-0000-7000-8000-000000001104';
const PROPOSAL_HELD_AND_FAILED = '01930000-0000-7000-8000-000000001105';
const PROPOSAL_GONE = '01930000-0000-7000-8000-000000001106';
const PROJECT_HELD = '01930000-0000-7000-8000-000000001201';
const PROJECT_FAILED = '01930000-0000-7000-8000-000000001202';

const THRESHOLD = 30;

function classify(input: {
  readonly proposals?: readonly GateRunningProposal[];
  readonly held?: readonly HeldReviewGateRow[];
  readonly failed?: readonly FailedGateRunJob[];
  readonly threshold?: number;
}) {
  return classifyGateStalls(
    { gateRunningProposals: input.proposals ?? [], heldGates: input.held ?? [], failedJobs: input.failed ?? [] },
    { now: NOW, stallThresholdMinutes: input.threshold ?? THRESHOLD },
  );
}

describe('classifyGateStalls ①: 3 区分', () => {
  const proposals: GateRunningProposal[] = [
    { tenantId: TENANT_A, id: PROPOSAL_HELD, updatedAt: minutesAgo(90) },
    { tenantId: TENANT_A, id: PROPOSAL_FAILED, updatedAt: minutesAgo(60) },
    { tenantId: TENANT_B, id: PROPOSAL_OVERDUE, updatedAt: minutesAgo(45) },
    { tenantId: TENANT_B, id: PROPOSAL_FRESH, updatedAt: minutesAgo(5) },
  ];
  const held: HeldReviewGateRow[] = [
    { tenantId: TENANT_A, targetType: 'PROPOSAL', targetId: PROPOSAL_HELD, heldSince: minutesAgo(80) },
  ];
  const failed: FailedGateRunJob[] = [
    { tenantId: TENANT_A, targetType: 'PROPOSAL', targetId: PROPOSAL_FAILED, failedAt: minutesAgo(59) },
  ];

  it('保留 / 失敗 / 閾値超過がそれぞれの理由で載り、閾値未満は載らない', () => {
    const result = classify({ proposals, held, failed });
    expect(result.rows.map((row) => [row.targetId, row.reason, row.stalledMinutes])).toEqual([
      [PROPOSAL_HELD, 'AI_COST_LIMIT_HELD', 80],
      [PROPOSAL_FAILED, 'JOB_FAILED', 59],
      [PROPOSAL_OVERDUE, 'RUNNING_OVERDUE', 45],
    ]);
    expect(result.rows.some((row) => row.targetId === PROPOSAL_FRESH)).toBe(false);
  });

  it('since は理由ごとの起点（HELD = held_since / JOB_FAILED = 失敗時刻 / RUNNING_OVERDUE = updated_at）', () => {
    const result = classify({ proposals, held, failed });
    expect(result.rows.map((row) => row.since)).toEqual([minutesAgo(80), minutesAgo(59), minutesAgo(45)]);
  });

  it('④ countsByReason は 3 区分が別キーで、合計が total と一致する。閾値の写しを持つ', () => {
    const result = classify({ proposals, held, failed });
    expect(result.countsByReason).toEqual({ AI_COST_LIMIT_HELD: 1, JOB_FAILED: 1, RUNNING_OVERDUE: 1 });
    expect(result.total).toBe(3);
    expect(Object.keys(result.countsByReason).sort()).toEqual([...GATE_STALL_REASONS].sort());
    expect(result.stallThresholdMinutes).toBe(THRESHOLD);
  });

  it('候補が 0 件なら空（エラーにしない = 「滞留が無い」は正常）', () => {
    expect(classify({})).toEqual({
      rows: [],
      countsByReason: { AI_COST_LIMIT_HELD: 0, JOB_FAILED: 0, RUNNING_OVERDUE: 0 },
      total: 0,
      stallThresholdMinutes: THRESHOLD,
    });
  });
});

describe('classifyGateStalls ②: 閾値の境界', () => {
  it('ちょうど閾値なら RUNNING_OVERDUE として載り、1 ミリ秒手前なら載らない', () => {
    const boundary = classify({
      proposals: [{ tenantId: TENANT_A, id: PROPOSAL_OVERDUE, updatedAt: minutesAgo(THRESHOLD) }],
    });
    expect(boundary.rows.map((row) => row.reason)).toEqual(['RUNNING_OVERDUE']);
    const justUnder = classify({
      proposals: [
        { tenantId: TENANT_A, id: PROPOSAL_OVERDUE, updatedAt: new Date(minutesAgo(THRESHOLD).getTime() + 1) },
      ],
    });
    expect(justUnder.rows).toEqual([]);
    expect(justUnder.countsByReason.RUNNING_OVERDUE).toBe(0);
  });

  it('🔴 保留と失敗には閾値を掛けない（保留 1 分 / 失敗 1 分でも載る）', () => {
    const result = classify({
      proposals: [
        { tenantId: TENANT_A, id: PROPOSAL_HELD, updatedAt: minutesAgo(2) },
        { tenantId: TENANT_A, id: PROPOSAL_FAILED, updatedAt: minutesAgo(2) },
      ],
      held: [{ tenantId: TENANT_A, targetType: 'PROPOSAL', targetId: PROPOSAL_HELD, heldSince: minutesAgo(1) }],
      failed: [{ tenantId: TENANT_A, targetType: 'PROPOSAL', targetId: PROPOSAL_FAILED, failedAt: minutesAgo(1) }],
    });
    expect(result.rows.map((row) => [row.reason, row.stalledMinutes])).toEqual([
      ['AI_COST_LIMIT_HELD', 1],
      ['JOB_FAILED', 1],
    ]);
  });

  it('閾値は呼び出し側の値で変わる（ハードコードしていない）', () => {
    const proposals = [{ tenantId: TENANT_A, id: PROPOSAL_OVERDUE, updatedAt: minutesAgo(20) }];
    expect(classify({ proposals, threshold: 30 }).total).toBe(0);
    expect(classify({ proposals, threshold: 15 }).total).toBe(1);
  });
});

describe('classifyGateStalls ③: 保留行と失敗記録の両方がある対象', () => {
  it('🔴 JOB_FAILED が優先する（同 jobId の failed が残ると gate.hold-release の再 enqueue が捨てられ、自動復帰しない）', () => {
    const result = classify({
      proposals: [{ tenantId: TENANT_A, id: PROPOSAL_HELD_AND_FAILED, updatedAt: minutesAgo(100) }],
      held: [
        { tenantId: TENANT_A, targetType: 'PROPOSAL', targetId: PROPOSAL_HELD_AND_FAILED, heldSince: minutesAgo(90) },
      ],
      failed: [
        { tenantId: TENANT_A, targetType: 'PROPOSAL', targetId: PROPOSAL_HELD_AND_FAILED, failedAt: minutesAgo(10) },
      ],
    });
    expect(result.rows).toEqual([
      {
        tenantId: TENANT_A,
        targetType: 'PROPOSAL',
        targetId: PROPOSAL_HELD_AND_FAILED,
        reason: 'JOB_FAILED',
        since: minutesAgo(10),
        stalledMinutes: 10,
      },
    ]);
    expect(result.countsByReason).toEqual({ AI_COST_LIMIT_HELD: 0, JOB_FAILED: 1, RUNNING_OVERDUE: 0 });
  });

  it('同じ対象に失敗記録が複数（内容のハッシュ違い）あれば、最も新しい失敗時刻を採る（1 行に畳む）', () => {
    const result = classify({
      proposals: [{ tenantId: TENANT_A, id: PROPOSAL_FAILED, updatedAt: minutesAgo(100) }],
      failed: [
        { tenantId: TENANT_A, targetType: 'PROPOSAL', targetId: PROPOSAL_FAILED, failedAt: minutesAgo(50) },
        { tenantId: TENANT_A, targetType: 'PROPOSAL', targetId: PROPOSAL_FAILED, failedAt: minutesAgo(20) },
        { tenantId: TENANT_A, targetType: 'PROPOSAL', targetId: PROPOSAL_FAILED, failedAt: minutesAgo(40) },
      ],
    });
    expect(result.rows.map((row) => [row.reason, row.stalledMinutes])).toEqual([['JOB_FAILED', 20]]);
    expect(result.total).toBe(1);
  });
});

describe('classifyGateStalls ⑤: PROPOSAL 以外の対象と、対象の無い残骸', () => {
  it('PROJECT_PUBLISH の保留行・失敗記録はそのまま載る（対象の生存は確認できないため）', () => {
    const result = classify({
      held: [{ tenantId: TENANT_B, targetType: 'PROJECT_PUBLISH', targetId: PROJECT_HELD, heldSince: minutesAgo(3) }],
      failed: [
        { tenantId: TENANT_B, targetType: 'PROJECT_PUBLISH', targetId: PROJECT_FAILED, failedAt: minutesAgo(7) },
      ],
    });
    expect(result.rows.map((row) => [row.targetType, row.targetId, row.reason, row.stalledMinutes])).toEqual([
      ['PROJECT_PUBLISH', PROJECT_FAILED, 'JOB_FAILED', 7],
      ['PROJECT_PUBLISH', PROJECT_HELD, 'AI_COST_LIMIT_HELD', 3],
    ]);
  });

  it('PROJECT_PUBLISH で保留行と失敗記録の両方があれば JOB_FAILED（③ と同じ優先順位）', () => {
    const result = classify({
      held: [{ tenantId: TENANT_B, targetType: 'PROJECT_PUBLISH', targetId: PROJECT_HELD, heldSince: minutesAgo(30) }],
      failed: [{ tenantId: TENANT_B, targetType: 'PROJECT_PUBLISH', targetId: PROJECT_HELD, failedAt: minutesAgo(5) }],
    });
    expect(result.rows.map((row) => row.reason)).toEqual(['JOB_FAILED']);
    expect(result.total).toBe(1);
  });

  it('🔴 GATE_RUNNING でない提案に残った保留行・失敗記録は載らない（対象が無いものを滞留と呼ばない）', () => {
    const result = classify({
      proposals: [],
      held: [{ tenantId: TENANT_A, targetType: 'PROPOSAL', targetId: PROPOSAL_GONE, heldSince: minutesAgo(500) }],
      failed: [{ tenantId: TENANT_A, targetType: 'PROPOSAL', targetId: PROPOSAL_GONE, failedAt: minutesAgo(400) }],
    });
    expect(result.rows).toEqual([]);
    expect(result.total).toBe(0);
  });

  it('🔴 テナントが違えば同じ対象 ID でも別物（分離キーが照合に含まれる）', () => {
    const result = classify({
      proposals: [{ tenantId: TENANT_A, id: PROPOSAL_FAILED, updatedAt: minutesAgo(100) }],
      failed: [{ tenantId: TENANT_B, targetType: 'PROPOSAL', targetId: PROPOSAL_FAILED, failedAt: minutesAgo(10) }],
    });
    // A の提案には失敗記録が無い → 閾値超過なので RUNNING_OVERDUE。B の失敗記録は対象が無いので載らない。
    expect(result.rows.map((row) => [row.tenantId, row.reason])).toEqual([[TENANT_A, 'RUNNING_OVERDUE']]);
  });
});

describe('classifyGateStalls ⑥: 並びと分数', () => {
  it('since の昇順（最も長く止まっているものが先頭）。同値は tenantId → targetType → targetId の昇順', () => {
    const sameTime = minutesAgo(40);
    const result = classify({
      proposals: [
        { tenantId: TENANT_B, id: PROPOSAL_OVERDUE, updatedAt: sameTime },
        { tenantId: TENANT_A, id: PROPOSAL_FRESH, updatedAt: sameTime },
        { tenantId: TENANT_A, id: PROPOSAL_OVERDUE, updatedAt: sameTime },
        { tenantId: TENANT_A, id: PROPOSAL_HELD, updatedAt: minutesAgo(200) },
      ],
      held: [{ tenantId: TENANT_A, targetType: 'PROPOSAL', targetId: PROPOSAL_HELD, heldSince: minutesAgo(199) }],
    });
    expect(result.rows.map((row) => [row.tenantId, row.targetId])).toEqual([
      [TENANT_A, PROPOSAL_HELD],
      [TENANT_A, PROPOSAL_OVERDUE],
      [TENANT_A, PROPOSAL_FRESH],
      [TENANT_B, PROPOSAL_OVERDUE],
    ]);
  });

  it('stalledMinutes は切り捨て・0 以上（since が now より後でも負にならない）', () => {
    const result = classify({
      held: [
        {
          tenantId: TENANT_A,
          targetType: 'PROJECT_PUBLISH',
          targetId: PROJECT_HELD,
          heldSince: new Date(NOW.getTime() - 90_000),
        },
        {
          tenantId: TENANT_A,
          targetType: 'PROJECT_PUBLISH',
          targetId: PROJECT_FAILED,
          heldSince: new Date(NOW.getTime() + 60_000),
        },
      ],
    });
    expect(result.rows.map((row) => row.stalledMinutes)).toEqual([1, 0]);
  });
});

describe('classifyGateStalls ⑦: 不正な入力は黙って捨てない', () => {
  it('未知の targetType（failed / held のどちらでも）は例外', () => {
    expect(() =>
      classify({ failed: [{ tenantId: TENANT_A, targetType: 'ENGINEER', targetId: PROPOSAL_GONE, failedAt: NOW }] }),
    ).toThrow(/targetType に未知の値/);
    expect(() =>
      classify({ held: [{ tenantId: TENANT_A, targetType: 'engineer', targetId: PROPOSAL_GONE, heldSince: NOW }] }),
    ).toThrow(/targetType に未知の値/);
  });

  it.each([0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY])('閾値 %s は RangeError', (threshold) => {
    expect(() => classify({ threshold })).toThrow(RangeError);
  });
});

describe('classifyGateStalls ⑧: 本モジュールが読む列は状態・時刻・ID だけ（ソース走査）', () => {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const source = readFileSync(path.join(here, 'gate-stalls.ts'), 'utf8');

  it('🔴 select に件名・本文・提案先・エンジニア・単価・findings が無い', () => {
    for (const forbidden of [
      'subject',
      'body',
      'draftBody',
      'recipientEmail',
      'recipientCompanyName',
      'offeredUnitPrice',
      'engineerId',
      'projectId',
      'findings',
      'aiWarnings',
      'displayName',
    ]) {
      expect(source, `${forbidden} を読んでいる`).not.toMatch(new RegExp(`\\b${forbidden}\\s*:\\s*true`));
    }
  });

  it('読み取りは proposal / reviewGate の 2 本で、どちらも select を明示している', () => {
    expect(source.match(/db\.proposal\.findMany\(/g)?.length).toBe(1);
    expect(source.match(/db\.reviewGate\.findMany\(/g)?.length).toBe(1);
    expect(source).toContain('select: { tenantId: true, id: true, updatedAt: true }');
    expect(source).toContain('select: { tenantId: true, targetType: true, targetId: true, heldSince: true }');
    // 🔴 書き込み・生 SQL・BullMQ に到達しない（運営者の retry は存在しない）。
    expect(source).not.toMatch(/\.(update|updateMany|create|delete|upsert)\(/);
    expect(source).not.toMatch(/\$(queryRaw|executeRaw)/);
    expect(source).not.toMatch(/from 'bullmq'|@ses\/connectors|ioredis/);
  });
});
