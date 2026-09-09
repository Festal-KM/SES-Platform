// tests/isolation/gate-run.test.ts
// 🔴 T-07-06 の完了判定を **実 DB + RLS 付きで**実証する（docs/sprints/SP-07 §4 T-07-06）:
//    `F-020 AC-5`（PII 層で氏名が残っていると FAIL + 該当箇所）/ `AC-6`（商流層でエンド企業名が
//    公開範囲外に出ると FAIL）/ `AC-7`（結果が `ReviewGate` に保存され後から参照できる）
//    + AI 失敗時に FAIL になること + `P-A-09`（同じ内容なら再実行しない / `aiFailed` は
//    キャッシュしない）+ `F-027 AC-5`（HELD でも整合層の結果が保存され、再実行に使われる）。
//
// 🔴 通す経路は本番と同じ 1 本である:
//    `gate.run` ハンドラ → `loadGateInput`（packages/db）→ `decideConsistency`（domain）
//    → `mask()` + `runRole(gate-inspector)`（packages/ai）→ `decideGate`（domain）
//    → `ReviewGate` 保存 + 提案の状態確定（withTenant）
//
// 🔴 実 Anthropic API には接続しない（`createAiClient('mock', …)`。docs/05 §17.5 /
//    CLAUDE.md §11.1）。**モックは `MockAnthropicClient` の 1 実装だけ**であり、
//    テスト専用の別モックを書かない。
import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { catalogRoleModelResolver, createAiClient } from '@ses/ai';
import {
  configureTenantDb,
  disconnectTenantDb,
  readReviewGateResult,
  systemTenantCtx,
  withTenant,
  type SystemTenantCtx,
} from '@ses/db';
import { createUnextendedClient, type UnextendedClient } from '@ses/db/testing';
import { createGateRunHandler, type GateRunOutcome } from '../../apps/worker/src/jobs/gate-run.js';
import {
  ENGINEER_A_HOST,
  PARTNER_A2,
  PROJECT_A_PUBLISHED,
  PROPOSAL_A_HOST,
  PROPOSAL_A_P1,
  TENANT_A,
  TENANT_B,
  USER_A_HOST,
} from './support/fixtures.js';
import { startIsolationDatabase, type IsolationDatabase } from './support/postgres.js';

const SETUP_TIMEOUT_MS = 600_000;

const NOW = new Date('2026-09-07T16:00:00.000Z');
const SONNET = 'claude-sonnet-5';
const HAIKU = 'claude-haiku-4-5-20251001';
/** 1 回の呼び出し（見積り $0.05 程度）が通る上限。 */
const DAILY_LIMIT_USD = '5.000000';
/** 🔴 1 回でも通らない上限（`AiCostLimitExceededError` を実際に発生させる）。 */
const TINY_LIMIT_USD = '0.000001';

/** 台帳の氏名（`engineers.display_name`）。本文に残っていれば PII 層 FAIL になるべき値。 */
const ENGINEER_NAME = '山田 太郎';
/** 案件のエンド企業名（`projects.end_client_name`）。公開表示に出れば商流層 FAIL。 */
const END_CLIENT = 'End Client A';
const SKILL_ID = '01930000-0000-7000-8000-0000000009a1';

/** `gate-inspector` が「何も見つけなかった」ときの応答（スキーマ適合）。 */
const CLEAN_OUTPUT = {
  pii: { verdict: 'PASS', findings: [] },
  commerce: { verdict: 'PASS', findings: [] },
  consistencyWarnings: [],
} as const;

type MockStep = NonNullable<NonNullable<Parameters<typeof createAiClient>[1]>['mock']>['script'];

let database: IsolationDatabase;
/** 🔴 「保存されている生の値」の確認と、フィクスチャの用意だけに使う特権接続。 */
let admin: UnextendedClient;
let ctxA: SystemTenantCtx;
let ctxB: SystemTenantCtx;

function jobIdFor(targetType: string, targetId: string, contentHash: string): string {
  return `gate.run:${targetType}:${targetId}:${contentHash}`;
}

async function runGate(options: {
  readonly targetType: 'PROPOSAL' | 'PROJECT_PUBLISH';
  readonly targetId: string;
  readonly contentHash: string;
  readonly script: MockStep;
  readonly dailyLimitUsd?: string;
  readonly tenantId?: string;
  /**
   * 🔴 T-07-09: 案件の公開は「これから公開する相手」を `ProjectPublishRequest` で運ぶ
   *    （docs/05 §11.11 ①）。行が無い / 内容のハッシュが一致しない場合、ジョブは
   *    **何も検査せずに `TARGET_NOT_FOUND` で終わる**（PASS にしない）。
   * 🔴 既定を**空**にしているのは、この describe が見ているのが**層の判定**だからである ——
   *    空にすると `audience` が「すでに公開済みの相手」だけに固定され、
   *    T-06-06 以前と同じ母集団で層の判定を確かめられる。
   *    **公開の確定（PASS で行が増える / FAIL で 1 行も増えない）は
   *    `tests/isolation/project-publish-gate.test.ts` が実データの経路で見る。**
   */
  readonly publishTo?: readonly string[];
}): Promise<GateRunOutcome> {
  if (options.targetType === 'PROJECT_PUBLISH') {
    await admin.projectPublishRequest.upsert({
      where: {
        tenantId_projectId: { tenantId: options.tenantId ?? TENANT_A, projectId: options.targetId },
      },
      create: {
        id: randomUUID(),
        tenantId: options.tenantId ?? TENANT_A,
        projectId: options.targetId,
        partnerCompanyIds: [...(options.publishTo ?? [])],
        contentHash: options.contentHash,
        requestedAt: NOW,
        requestedBy: USER_A_HOST,
      },
      update: {
        partnerCompanyIds: [...(options.publishTo ?? [])],
        contentHash: options.contentHash,
      },
    });
  }
  const handler = createGateRunHandler({
    now: () => NOW,
    aiClient: createAiClient('mock', { mock: { script: options.script } }),
    models: catalogRoleModelResolver({ DEFAULT: SONNET, CHEAP: HAIKU }),
    aiDailyCostLimitUsd: options.dailyLimitUsd ?? DAILY_LIMIT_USD,
  });
  return handler(
    {
      tenantId: options.tenantId ?? TENANT_A,
      targetType: options.targetType,
      targetId: options.targetId,
      contentHash: options.contentHash,
    },
    jobIdFor(options.targetType, options.targetId, options.contentHash),
  );
}

/** 提案をゲート実行中の状態に整える（本文・凍結コピー・台帳の PII）。 */
async function prepareProposal(input: {
  readonly proposalId: string;
  readonly body: string;
  readonly snapshotSkills: readonly { skillId: string; name: string; years: number; level: number | null }[];
}): Promise<void> {
  await admin.engineer.update({
    where: { id: ENGINEER_A_HOST },
    data: { displayName: ENGINEER_NAME, contactEmail: 'taro@example.test' },
  });
  await admin.proposal.update({
    where: { id: input.proposalId },
    data: { state: 'GATE_RUNNING', subject: 'ご提案', body: input.body },
  });
  await admin.engineerSnapshot.upsert({
    where: { proposalId: input.proposalId },
    create: {
      id: randomUUID(),
      tenantId: TENANT_A,
      proposalId: input.proposalId,
      displayName: ENGINEER_NAME,
      affiliationLabel: null,
      skills: [...input.snapshotSkills],
      careers: [],
      frozenAt: NOW,
    },
    update: { skills: [...input.snapshotSkills] },
  });
}

beforeAll(async () => {
  database = await startIsolationDatabase();
  admin = createUnextendedClient(database.superuserUrl);
  configureTenantDb({ datasourceUrl: database.tenantUrl });
  ctxA = systemTenantCtx(TENANT_A, { queue: 'gate.run', jobId: 'gate.run:setup' });
  ctxB = systemTenantCtx(TENANT_B, { queue: 'gate.run', jobId: 'gate.run:setup' });
}, SETUP_TIMEOUT_MS);

/**
 * 🔴 消す順序が固定である。`review_gates.ai_usage_id` は `ai_usage` への FK なので、
 *    ゲート結果を先に消さないと `AiUsage` を消せない（消せないまま次のテストへ進むと、
 *    件数の検証が前のテストの行を数えて偽陽性・偽陰性になる）。
 * 🔴 シードの公開ゲート（`project_visibilities.review_gate_id` の FK 先）は消さない。
 */
async function resetGateFixtures(): Promise<void> {
  await admin.reviewGate.deleteMany({
    where: { targetId: { in: [PROPOSAL_A_HOST, PROPOSAL_A_P1] } },
  });
  await admin.reviewGate.deleteMany({
    where: { targetId: PROJECT_A_PUBLISHED, contentHash: { not: 'seed-content-hash' } },
  });
  await admin.proposalEvent.deleteMany({
    where: { proposalId: { in: [PROPOSAL_A_HOST, PROPOSAL_A_P1] } },
  });
  await admin.engineerSnapshot.deleteMany({
    where: { proposalId: { in: [PROPOSAL_A_HOST, PROPOSAL_A_P1] } },
  });
  await admin.proposal.updateMany({
    where: { id: { in: [PROPOSAL_A_HOST, PROPOSAL_A_P1] } },
    data: { state: 'DRAFT', subject: null, body: null },
  });
  await admin.aiUsage.deleteMany({});
  await admin.usageCounter.deleteMany({ where: { metric: { startsWith: 'AI_' } } });
  await admin.auditLog.deleteMany({ where: { targetId: PROPOSAL_A_HOST } });
  await admin.engineerSkill.deleteMany({ where: { engineerId: ENGINEER_A_HOST } });
  await admin.project.update({
    where: { id: PROJECT_A_PUBLISHED },
    data: { publicSummary: '公開用の概要' },
  });
  // 🔴 T-07-09: 公開要求は「消費されなかったぶん」が残りうる（FAIL / HELD / 差し替え）。
  //    残すと次のテストの `loadGateInput` が古いハッシュを見て `TARGET_NOT_FOUND` になる。
  await admin.projectPublishRequest.deleteMany({ where: { tenantId: TENANT_A } });
}

beforeEach(resetGateFixtures);
afterEach(resetGateFixtures);

afterAll(async () => {
  await admin?.$disconnect();
  await disconnectTenantDb();
  await database?.stop();
}, SETUP_TIMEOUT_MS);

async function readGate(targetId: string) {
  return admin.reviewGate.findFirst({
    where: { targetId, contentHash: { not: 'seed-content-hash' } },
    orderBy: { executedAt: 'desc' },
  });
}

async function proposalState(id: string): Promise<string> {
  const row = await admin.proposal.findUniqueOrThrow({ where: { id }, select: { state: true } });
  return row.state;
}

describe('🔴 F-020 AC-5: PII 層で氏名が残っていると FAIL になり、該当箇所が指摘として返る', () => {
  it('AI が PASS と言っても、台帳の氏名が本文に残っていれば FAIL（機械的検出が上書きする）', async () => {
    await prepareProposal({
      proposalId: PROPOSAL_A_HOST,
      body: `${ENGINEER_NAME}をご提案します。Java の経験が 8 年あります。`,
      snapshotSkills: [],
    });

    const outcome = await runGate({
      targetType: 'PROPOSAL',
      targetId: PROPOSAL_A_HOST,
      contentHash: 'hash-pii-fail',
      script: [{ kind: 'output', output: CLEAN_OUTPUT }],
    });

    expect(outcome).toMatchObject({ kind: 'COMPLETED', overall: 'FAIL', aiFailed: false });
    const gate = await readGate(PROPOSAL_A_HOST);
    expect(gate?.piiVerdict).toBe('FAIL');
    expect(gate?.commerceVerdict).toBe('PASS');
    expect(gate?.consistencyVerdict).toBe('PASS');

    // 🔴 該当箇所が返る（欄と位置）。原文は保存しない（抜粋は伏せ字）。
    const findings = gate?.findings as {
      layer: string;
      kind: string;
      field: string;
      offsetStart: number;
      offsetEnd: number;
      excerpt: string;
    }[];
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({ layer: 'PII', kind: 'FULL_NAME', field: 'body', offsetStart: 0 });
    expect(findings[0]?.excerpt).not.toContain('山田');
    expect(JSON.stringify(findings)).not.toContain(ENGINEER_NAME);

    // 🔴 1 層でも FAIL なら GATE_FAILED（F-020 処理④）。
    expect(await proposalState(PROPOSAL_A_HOST)).toBe('GATE_FAILED');
  });

  it('🔴 LLM に送られた本文がマスキング済みである（BR-11。氏名が外部 API に出ない）', async () => {
    await prepareProposal({
      proposalId: PROPOSAL_A_HOST,
      body: `${ENGINEER_NAME}をご提案します。`,
      snapshotSkills: [],
    });
    await runGate({
      targetType: 'PROPOSAL',
      targetId: PROPOSAL_A_HOST,
      contentHash: 'hash-masked',
      script: [{ kind: 'output', output: CLEAN_OUTPUT }],
    });

    // 🔴 `AiUsage` にマスキングの記録が残り、送信本文に原文が無いことは
    //    `tests/isolation/gate-prompt-version.test.ts` が要求そのもので見ている。
    //    ここでは「記録が 1 行立ったこと」（F-026 AC-1）だけを確かめる。
    const usage = await admin.aiUsage.findMany({ where: { tenantId: TENANT_A } });
    expect(usage).toHaveLength(1);
    expect(usage[0]).toMatchObject({ role: 'gate-inspector', purpose: 'gate', succeeded: true });
  });
});

describe('🔴 F-020 AC-6: 商流層でエンド企業名が公開範囲外に出ると FAIL になる（F-014 AC-3）', () => {
  it('案件の公開用の記載にエンド企業名が含まれていれば商流層 FAIL', async () => {
    await admin.project.update({
      where: { id: PROJECT_A_PUBLISHED },
      data: { publicSummary: `${END_CLIENT} 向けの基幹システム刷新案件です。` },
    });

    const outcome = await runGate({
      targetType: 'PROJECT_PUBLISH',
      targetId: PROJECT_A_PUBLISHED,
      contentHash: 'hash-commerce-fail',
      script: [{ kind: 'output', output: CLEAN_OUTPUT }],
    });

    expect(outcome).toMatchObject({ kind: 'COMPLETED', overall: 'FAIL' });
    const gate = await readGate(PROJECT_A_PUBLISHED);
    expect(gate?.commerceVerdict).toBe('FAIL');
    expect(gate?.piiVerdict).toBe('PASS');
    const findings = gate?.findings as { layer: string; kind: string; field: string }[];
    expect(findings[0]).toMatchObject({
      layer: 'COMMERCE',
      kind: 'END_CLIENT',
      field: 'public_summary',
    });
    // 🔴 抜粋にエンド企業名そのものを残さない。
    expect(JSON.stringify(findings)).not.toContain(END_CLIENT);
  });

  it('内部単価が公開用の記載に出ていても商流層 FAIL', async () => {
    await admin.project.update({
      where: { id: PROJECT_A_PUBLISHED },
      data: { publicSummary: '想定単価は 900000 円 / 月です。' },
    });

    await runGate({
      targetType: 'PROJECT_PUBLISH',
      targetId: PROJECT_A_PUBLISHED,
      contentHash: 'hash-unit-price',
      script: [{ kind: 'output', output: CLEAN_OUTPUT }],
    });

    const gate = await readGate(PROJECT_A_PUBLISHED);
    expect(gate?.commerceVerdict).toBe('FAIL');
    expect((gate?.findings as { kind: string }[])[0]?.kind).toBe('UNIT_PRICE');
  });

  it('🔴 公開先に含まれない取引先の名前が出ていれば FAIL（パートナー間の相互参照 0 件）', async () => {
    await admin.project.update({
      where: { id: PROJECT_A_PUBLISHED },
      data: { publicSummary: 'Partner A2 も参画予定の案件です。' },
    });

    await runGate({
      targetType: 'PROJECT_PUBLISH',
      targetId: PROJECT_A_PUBLISHED,
      contentHash: 'hash-other-company',
      script: [{ kind: 'output', output: CLEAN_OUTPUT }],
    });

    const gate = await readGate(PROJECT_A_PUBLISHED);
    expect(gate?.commerceVerdict).toBe('FAIL');
    expect((gate?.findings as { kind: string }[])[0]?.kind).toBe('OTHER_COMPANY');
    // 対照: `PARTNER_A2` は公開先ではない（公開済みは PARTNER_A1 だけ）。
    const visibilities = await admin.projectVisibility.findMany({
      where: { projectId: PROJECT_A_PUBLISHED, revokedAt: null },
      select: { partnerCompanyId: true },
    });
    expect(visibilities.map((row) => row.partnerCompanyId)).not.toContain(PARTNER_A2);
  });

  it('公開用の記載が清潔なら 3 層 PASS（対照。空振りしていないこと）', async () => {
    const outcome = await runGate({
      targetType: 'PROJECT_PUBLISH',
      targetId: PROJECT_A_PUBLISHED,
      contentHash: 'hash-clean',
      script: [{ kind: 'output', output: CLEAN_OUTPUT }],
    });
    expect(outcome).toMatchObject({ kind: 'COMPLETED', overall: 'PASS' });
    const gate = await readGate(PROJECT_A_PUBLISHED);
    expect([gate?.piiVerdict, gate?.commerceVerdict, gate?.consistencyVerdict]).toEqual([
      'PASS',
      'PASS',
      'PASS',
    ]);
  });
});

describe('🔴 F-020 AC-7: 結果が ReviewGate に保存され、後から参照できる', () => {
  it('3 層の判定・指摘・警告・出所（版とモデル）が残り、GateResultView として読み出せる', async () => {
    await prepareProposal({ proposalId: PROPOSAL_A_HOST, body: '清潔な本文です。', snapshotSkills: [] });

    await runGate({
      targetType: 'PROPOSAL',
      targetId: PROPOSAL_A_HOST,
      contentHash: 'hash-ac7',
      script: [
        {
          kind: 'output',
          output: {
            pii: { verdict: 'PASS', findings: [] },
            commerce: { verdict: 'PASS', findings: [] },
            consistencyWarnings: [
              {
                kind: 'SKILL_SHEET_MISMATCH',
                field: 'body',
                offsetStart: null,
                offsetEnd: null,
                excerpt: '年数の記載が経歴と一致しません',
                severity: 'WARN',
              },
            ],
          },
        },
      ],
    });

    const gate = await readGate(PROPOSAL_A_HOST);
    expect(gate).toMatchObject({
      execution: 'DONE',
      contentHash: 'hash-ac7',
      role: 'gate-inspector',
      promptVersion: 'gate-inspector.v1',
      modelId: SONNET,
      aiFailed: false,
    });
    expect(gate?.aiUsageId).not.toBeNull();
    expect(gate?.executedAt).not.toBeNull();
    // 🔴 警告は findings と別の列に入る（合否に効かない。BR-61）。
    expect((gate?.aiWarnings as { severity: string }[]).map((row) => row.severity)).toEqual(['WARN']);
    expect(gate?.findings).toEqual([]);

    // 🔴 `withTenant` 経由で読み出せる（#40 / 承認画面が使う経路）。
    const view = await readReviewGateResult(ctxA, {
      targetType: 'PROPOSAL',
      targetId: PROPOSAL_A_HOST,
    });
    expect(view).toMatchObject({ execution: 'DONE', contentHash: 'hash-ac7', aiFailed: false });
  });

  it('🔴 他テナントからは保存されたゲート結果が 1 件も見えない（CLAUDE.md §3.1）', async () => {
    await prepareProposal({ proposalId: PROPOSAL_A_HOST, body: '清潔な本文です。', snapshotSkills: [] });
    await runGate({
      targetType: 'PROPOSAL',
      targetId: PROPOSAL_A_HOST,
      contentHash: 'hash-boundary',
      script: [{ kind: 'output', output: CLEAN_OUTPUT }],
    });

    const fromB = await withTenant(ctxB, (db) =>
      db.reviewGate.findMany({ where: { targetId: PROPOSAL_A_HOST } }),
    );
    expect(fromB).toEqual([]);
    const fromA = await withTenant(ctxA, (db) =>
      db.reviewGate.findMany({ where: { targetId: PROPOSAL_A_HOST } }),
    );
    expect(fromA).toHaveLength(1);
  });
});

describe('🔴 AI の失敗は判定不能 = FAIL（PASS へフォールバックしない）', () => {
  it('タイムアウトが続くと PII / 商流は FAIL、整合層は機械的照合の結果のまま', async () => {
    await prepareProposal({ proposalId: PROPOSAL_A_HOST, body: '清潔な本文です。', snapshotSkills: [] });

    const outcome = await runGate({
      targetType: 'PROPOSAL',
      targetId: PROPOSAL_A_HOST,
      contentHash: 'hash-ai-failed',
      script: [{ kind: 'error', error: 'TIMEOUT' }],
    });

    expect(outcome).toMatchObject({ kind: 'COMPLETED', overall: 'FAIL', aiFailed: true });
    const gate = await readGate(PROPOSAL_A_HOST);
    expect(gate).toMatchObject({
      piiVerdict: 'FAIL',
      commerceVerdict: 'FAIL',
      consistencyVerdict: 'PASS',
      aiFailed: true,
      // 🔴 「その版で検査した」という記録にはしない（BR-13）。
      role: null,
      promptVersion: null,
      aiUsageId: null,
    });
    expect(await proposalState(PROPOSAL_A_HOST)).toBe('GATE_FAILED');

    // 🔴 試行はすべて `AiUsage` に残る（原価は発生している。docs/05 §7.4）。
    const usage = await admin.aiUsage.findMany({ where: { tenantId: TENANT_A } });
    expect(usage.length).toBeGreaterThanOrEqual(1);
    expect(usage.every((row) => row.succeeded === false)).toBe(true);
  });

  it('🔴 aiFailed の結果はキャッシュされない（再実行で PASS になりうる）', async () => {
    await prepareProposal({ proposalId: PROPOSAL_A_HOST, body: '清潔な本文です。', snapshotSkills: [] });
    await runGate({
      targetType: 'PROPOSAL',
      targetId: PROPOSAL_A_HOST,
      contentHash: 'hash-retry',
      script: [{ kind: 'error', error: 'TIMEOUT' }],
    });
    // 提案は GATE_FAILED になっているので、再依頼と同じく GATE_RUNNING に戻して再実行する。
    await admin.proposal.update({ where: { id: PROPOSAL_A_HOST }, data: { state: 'GATE_RUNNING' } });

    const second = await runGate({
      targetType: 'PROPOSAL',
      targetId: PROPOSAL_A_HOST,
      contentHash: 'hash-retry',
      script: [{ kind: 'output', output: CLEAN_OUTPUT }],
    });

    expect(second).toMatchObject({ kind: 'COMPLETED', overall: 'PASS', aiFailed: false });
    // 🔴 行は増えない（同じ内容の結果は 1 行に収束する）。
    const rows = await admin.reviewGate.findMany({ where: { targetId: PROPOSAL_A_HOST } });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.aiFailed).toBe(false);
    expect(await proposalState(PROPOSAL_A_HOST)).toBe('APPROVAL_PENDING');
  });
});

describe('🔴 P-A-09: 同じ内容なら再実行しない', () => {
  it('同じ (targetType, targetId, contentHash) の 2 回目は LLM を呼ばない', async () => {
    await prepareProposal({ proposalId: PROPOSAL_A_HOST, body: '清潔な本文です。', snapshotSkills: [] });
    const first = await runGate({
      targetType: 'PROPOSAL',
      targetId: PROPOSAL_A_HOST,
      contentHash: 'hash-cache',
      script: [{ kind: 'output', output: CLEAN_OUTPUT }],
    });
    expect(first.kind).toBe('COMPLETED');
    const usageAfterFirst = await admin.aiUsage.count({ where: { tenantId: TENANT_A } });

    const second = await runGate({
      targetType: 'PROPOSAL',
      targetId: PROPOSAL_A_HOST,
      contentHash: 'hash-cache',
      script: [{ kind: 'output', output: CLEAN_OUTPUT }],
    });

    expect(second.kind).toBe('ALREADY_DONE');
    // 🔴 呼び出しが増えていない = 原価も増えていない。
    expect(await admin.aiUsage.count({ where: { tenantId: TENANT_A } })).toBe(usageAfterFirst);
    expect(await admin.reviewGate.count({ where: { targetId: PROPOSAL_A_HOST } })).toBe(1);
  });

  it('内容が変わって contentHash が違えば再実行する（§11.5 の再検証）', async () => {
    await prepareProposal({ proposalId: PROPOSAL_A_HOST, body: '清潔な本文です。', snapshotSkills: [] });
    await runGate({
      targetType: 'PROPOSAL',
      targetId: PROPOSAL_A_HOST,
      contentHash: 'hash-v1',
      script: [{ kind: 'output', output: CLEAN_OUTPUT }],
    });
    await admin.proposal.update({ where: { id: PROPOSAL_A_HOST }, data: { state: 'GATE_RUNNING' } });

    const second = await runGate({
      targetType: 'PROPOSAL',
      targetId: PROPOSAL_A_HOST,
      contentHash: 'hash-v2',
      script: [{ kind: 'output', output: CLEAN_OUTPUT }],
    });

    expect(second.kind).toBe('COMPLETED');
    expect(await admin.reviewGate.count({ where: { targetId: PROPOSAL_A_HOST } })).toBe(2);
  });
});

describe('🔴 F-027 AC-5: AI の日次コスト上限（HELD）', () => {
  it('GATE_FAILED にならず、対象は GATE_RUNNING のまま保持される', async () => {
    await prepareProposal({ proposalId: PROPOSAL_A_HOST, body: '清潔な本文です。', snapshotSkills: [] });

    const outcome = await runGate({
      targetType: 'PROPOSAL',
      targetId: PROPOSAL_A_HOST,
      contentHash: 'hash-held',
      script: [{ kind: 'output', output: CLEAN_OUTPUT }],
      dailyLimitUsd: TINY_LIMIT_USD,
    });

    expect(outcome.kind).toBe('HELD_AI_COST_LIMIT');
    // 🔴 「元データの欠陥」ではないので GATE_FAILED にしない。
    expect(await proposalState(PROPOSAL_A_HOST)).toBe('GATE_RUNNING');

    const gate = await readGate(PROPOSAL_A_HOST);
    expect(gate).toMatchObject({ execution: 'HELD_AI_COST_LIMIT', piiVerdict: null, commerceVerdict: null });
    expect(gate?.heldSince).not.toBeNull();
    // 🔴 LLM を 1 回も呼んでいない（予約に失敗した時点で止まる）。
    expect(await admin.aiUsage.count({ where: { tenantId: TENANT_A } })).toBe(0);
  });

  it('🔴 保留中でも整合層の結果は保存され、上限解除後の再実行がその行を確定させる', async () => {
    // 台帳に裏付けの無いスキルを主張させ、整合層を FAIL にしておく。
    await prepareProposal({
      proposalId: PROPOSAL_A_HOST,
      body: '清潔な本文です。',
      snapshotSkills: [{ skillId: SKILL_ID, name: 'TypeScript', years: 5, level: null }],
    });

    await runGate({
      targetType: 'PROPOSAL',
      targetId: PROPOSAL_A_HOST,
      contentHash: 'hash-held-consistency',
      script: [{ kind: 'output', output: CLEAN_OUTPUT }],
      dailyLimitUsd: TINY_LIMIT_USD,
    });

    const held = await readGate(PROPOSAL_A_HOST);
    // 🔴 機械的照合は動いており、その結果は保持されている。
    expect(held?.consistencyVerdict).toBe('FAIL');
    expect((held?.findings as { layer: string }[]).map((row) => row.layer)).toEqual(['CONSISTENCY']);

    // 上限が解除された後の自動再実行（`gate.hold-release`）と同じ payload・同じ jobId。
    const resumed = await runGate({
      targetType: 'PROPOSAL',
      targetId: PROPOSAL_A_HOST,
      contentHash: 'hash-held-consistency',
      script: [{ kind: 'output', output: CLEAN_OUTPUT }],
    });

    expect(resumed).toMatchObject({ kind: 'COMPLETED', overall: 'FAIL' });
    // 🔴 行は増えない（同じ行を CAS で DONE に完了させる。docs/05 §9.3）。
    const rows = await admin.reviewGate.findMany({ where: { targetId: PROPOSAL_A_HOST } });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      execution: 'DONE',
      heldSince: null,
      consistencyVerdict: 'FAIL',
      piiVerdict: 'PASS',
    });
    expect(await proposalState(PROPOSAL_A_HOST)).toBe('GATE_FAILED');
  });
});

describe('🔴 整合層の合否は LLM の応答で変わらない（BR-61 / F-020 AC-3。T-07-07 からの申し送り）', () => {
  const RESPONSES: readonly { readonly label: string; readonly script: MockStep }[] = [
    { label: '3 層とも問題なし', script: [{ kind: 'output', output: CLEAN_OUTPUT }] },
    {
      label: '整合層の警告あり',
      script: [
        {
          kind: 'output',
          output: {
            ...CLEAN_OUTPUT,
            consistencyWarnings: [
              {
                kind: 'MUST_REQUIREMENT_MISMATCH',
                field: 'body',
                offsetStart: null,
                offsetEnd: null,
                excerpt: '要件との齟齬の可能性',
                severity: 'WARN',
              },
            ],
          },
        },
      ],
    },
    {
      label: '整合層の警告が 2 件',
      script: [
        {
          kind: 'output',
          output: {
            ...CLEAN_OUTPUT,
            consistencyWarnings: [
              {
                kind: 'SKILL_SHEET_MISMATCH',
                field: 'body',
                offsetStart: null,
                offsetEnd: null,
                excerpt: 'a',
                severity: 'WARN',
              },
              {
                kind: 'MUST_REQUIREMENT_MISMATCH',
                field: 'subject',
                offsetStart: null,
                offsetEnd: null,
                excerpt: 'b',
                severity: 'WARN',
              },
            ],
          },
        },
      ],
    },
    { label: 'スキーマ違反', script: [{ kind: 'output', output: { pii: 'broken' } }] },
    { label: 'タイムアウト', script: [{ kind: 'error', error: 'TIMEOUT' }] },
  ];

  it.each(RESPONSES)(
    '$label でも consistencyVerdict と対象の状態が変わらない',
    async ({ label, script }) => {
      await prepareProposal({
        proposalId: PROPOSAL_A_HOST,
        body: '清潔な本文です。',
        // 台帳に無いスキルの主張 → 整合層は必ず FAIL。
        snapshotSkills: [{ skillId: SKILL_ID, name: 'TypeScript', years: 5, level: null }],
      });

      await runGate({
        targetType: 'PROPOSAL',
        targetId: PROPOSAL_A_HOST,
        contentHash: `hash-independence-${label}`,
        script,
      });

      const gate = await readGate(PROPOSAL_A_HOST);
      // 🔴 応答が何であっても整合層の合否は 1 ビットも変わらない。
      expect(gate?.consistencyVerdict).toBe('FAIL');
      const consistencyFindings = (gate?.findings as { layer: string; kind: string; excerpt: string }[]).filter(
        (row) => row.layer === 'CONSISTENCY',
      );
      expect(consistencyFindings).toEqual([
        {
          layer: 'CONSISTENCY',
          kind: 'SKILL_SHEET_MISMATCH',
          field: 'snapshot',
          offsetStart: null,
          offsetEnd: null,
          excerpt: 'TypeScript',
          severity: 'BLOCK',
        },
      ]);
      // 🔴 対象の状態も変わらない（整合層が FAIL である以上、常に GATE_FAILED）。
      expect(await proposalState(PROPOSAL_A_HOST)).toBe('GATE_FAILED');
    },
  );
});

describe('🔴 検査できない対象を PASS に倒さない（F-020 AC-1）', () => {
  it('パートナー所属エンジニアの提案は台帳を読めず、ゲート結果を 1 行も書かずに落ちる', async () => {
    await admin.proposal.update({
      where: { id: PROPOSAL_A_P1 },
      data: { state: 'GATE_RUNNING', subject: 'ご提案', body: '本文です。' },
    });
    await admin.engineerSnapshot.create({
      data: {
        id: randomUUID(),
        tenantId: TENANT_A,
        proposalId: PROPOSAL_A_P1,
        displayName: 'Partner Engineer',
        skills: [],
        careers: [],
        frozenAt: NOW,
      },
    });

    await expect(
      runGate({
        targetType: 'PROPOSAL',
        targetId: PROPOSAL_A_P1,
        contentHash: 'hash-partner-owned',
        script: [{ kind: 'output', output: CLEAN_OUTPUT }],
      }),
    ).rejects.toThrowError(/ENGINEER_LEDGER_UNREADABLE/);

    // 🔴 ゲート結果が無い ＝ 承認 CAS も送信の事前判定も満たさない（共有状態へ進めない）。
    expect(await admin.reviewGate.count({ where: { targetId: PROPOSAL_A_P1 } })).toBe(0);
    expect(await proposalState(PROPOSAL_A_P1)).toBe('GATE_RUNNING');
  });

  it('まだ配線されていない対象種別は PASS にせず落ちる（チャット添付 / 契約書 / スキルシート共有）', async () => {
    await expect(
      runGate({
        targetType: 'PROPOSAL',
        targetId: randomUUID(),
        contentHash: 'hash-missing',
        script: [{ kind: 'output', output: CLEAN_OUTPUT }],
      }),
    ).resolves.toEqual({ kind: 'TARGET_NOT_FOUND' });
  });
});
