// tests/isolation/gate-prompt-version.test.ts
// 🔴 T-07-05 の完了判定（docs/sprints/SP-07-ai-layer-gate.md）を **実 DB + RLS 付きで**実証する:
//    「**プロンプト版が `ReviewGate` に保存され、同じ版で再現できる**」（`BR-13` / docs/05 §7.7）。
//
// ここで通す経路は本番と同じ 1 本である:
//   `runRole`（packages/ai）→ `AiUsage` の記録（packages/db）→ `ReviewGate` への保存（withTenant）
//   → 保存された `promptVersion` **だけ**を手掛かりにプロンプトを再現
//
// 🔴 実 Anthropic API には接続しない（`createAiClient('mock', …)`。docs/05 §17.5 / CLAUDE.md §11.1）。
// 🔴 ここで見たいのは「DB に残った版から再現できる」ことである。プロンプトの文面そのものの検証は
//    `packages/ai/src/prompts.test.ts`、スキーマの検証は `roles/gate-inspector.test.ts` が行う。
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { createAiClient, createRoleRunner, gateInspectorSpec, gateInspectorSpecAtVersion, mask } from '@ses/ai';
import type { GateInspectorInput, KnownSensitiveValues } from '@ses/ai';
import {
  configureTenantDb,
  disconnectTenantDb,
  systemTenantCtx,
  withTenant,
  type SystemTenantCtx,
} from '@ses/db';
import { createUnextendedClient, type UnextendedClient } from '@ses/db/testing';
import { catalogRoleModelResolver } from '@ses/ai';
import { createAiCostGuard } from '../../apps/worker/src/ai/cost-guard.js';
import { createAiUsageRecorder } from '../../apps/worker/src/ai/usage-recorder.js';
import { TENANT_A, TENANT_B } from './support/fixtures.js';
import { startIsolationDatabase, type IsolationDatabase } from './support/postgres.js';

const SETUP_TIMEOUT_MS = 600_000;

/** 🔴 「実行日 = T」を固定する（docs/05 §17.6）。JST では 2026-09-08 01:00。 */
const NOW = new Date('2026-09-07T16:00:00.000Z');
const JOB = { queue: 'gate.run', jobId: 'gate.run:PROJECT_PUBLISH:1:hash' } as const;
const SONNET = 'claude-sonnet-5';
const HAIKU = 'claude-haiku-4-5-20251001';
/** 1 回の呼び出し（見積り $0.04 程度）が通る上限。 */
const DAILY_LIMIT_USD = '5.000000';

const TARGET_ID = '01930000-0000-7000-8000-0000000007a5';
const CONTENT_HASH = 'b5f0d1c9a7e34f2b8c1d0e9f6a3b2c1d0e9f8a7b6c5d4e3f2a1b0c9d8e7f6a5b';

/** 🔴 検査対象の本文は必ず `mask()` を通す（`BR-11` / `BR-12`）。 */
const KNOWN: KnownSensitiveValues = {
  fullNames: ['山田 太郎'],
  birthDates: ['1990-04-01'],
  emails: ['taro@example.com'],
  phones: ['090-1234-5678'],
  affiliations: ['株式会社テスト'],
  unitPrices: ['650000'],
  endClientNames: ['エンド商事'],
};

const RAW_BODY = [
  '山田 太郎（株式会社テスト）。連絡先 taro@example.com。',
  'Java と Spring Boot の開発経験が 8 年。2019 年 4 月から 2024 年 3 月まで基幹系の設計を担当。',
].join('\n');

/** モックが返す構造化出力（`gateInspectorOutputSchema` に適合する形）。 */
const AI_OUTPUT = {
  pii: {
    verdict: 'FAIL',
    findings: [
      {
        kind: 'AFFILIATION',
        field: 'body',
        offsetStart: 0,
        offsetEnd: 8,
        excerpt: '[名前]（[所属会社]）',
        severity: 'BLOCK',
      },
    ],
  },
  commerce: { verdict: 'PASS', findings: [] },
  consistencyWarnings: [
    {
      kind: 'SKILL_SHEET_MISMATCH',
      field: 'body',
      offsetStart: null,
      offsetEnd: null,
      excerpt: '経験年数の合計が経歴と一致しません',
      severity: 'WARN',
    },
  ],
} as const;

type AiClient = ReturnType<typeof createAiClient>;
type AiClientRequest = Parameters<AiClient['createStructuredMessage']>[0];

let database: IsolationDatabase;
/** 🔴 「保存されている生の値」の確認だけに使う特権接続。 */
let admin: UnextendedClient;
let ctxA: SystemTenantCtx;
let ctxB: SystemTenantCtx;

function gateInput(): GateInspectorInput {
  return {
    audienceKind: 'PARTNER',
    sections: [{ field: 'body', text: mask(RAW_BODY, KNOWN).text }],
  };
}

/**
 * 本番と同じ配線でロールを 1 回実行する。
 * 🔴 `usage` / `costGuard` は `apps/worker` のアダプタ（＝ 実 DB を書く実装）である。
 */
async function runGateInspector(ctx: SystemTenantCtx): Promise<{
  readonly promptVersion: string;
  readonly modelId: string;
  readonly aiUsageId: string;
  readonly sent: AiClientRequest;
}> {
  const sent: AiClientRequest[] = [];
  const mock = createAiClient('mock', { mock: { script: [{ kind: 'output', output: AI_OUTPUT }] } });
  // 送られた要求を控える薄い記録役（モックの実装は 1 つのまま。docs/05 §17.5）。
  const client: AiClient = {
    createStructuredMessage(request) {
      sent.push(request);
      return mock.createStructuredMessage(request);
    },
  };

  const runner = createRoleRunner({
    client,
    usage: createAiUsageRecorder(JOB),
    costGuard: createAiCostGuard({ job: JOB, dailyLimitUsd: DAILY_LIMIT_USD }),
    models: catalogRoleModelResolver({ DEFAULT: SONNET, CHEAP: HAIKU }),
  });

  const result = await runner.runRole(gateInspectorSpec, gateInput(), {
    tenantId: ctx.tenantId,
    targetType: 'PROJECT',
    targetId: TARGET_ID,
    now: () => NOW,
  });

  expect(result.ok, JSON.stringify(result.ok ? {} : result.failure)).toBe(true);
  const [aiUsageId] = result.provenance.aiUsageIds;
  const [request] = sent;
  if (aiUsageId === undefined || request === undefined) throw new Error('AiUsage / 要求が記録されていない');
  return {
    promptVersion: result.provenance.promptVersion,
    modelId: result.provenance.modelId,
    aiUsageId,
    sent: request,
  };
}

/** 🔴 ゲートの結果を保存する（`withTenant` = RLS + Prisma 拡張の二重防御を通る経路）。 */
async function saveReviewGate(
  ctx: SystemTenantCtx,
  provenance: { promptVersion: string; modelId: string; aiUsageId: string },
): Promise<string> {
  return withTenant(ctx, async (db) => {
    const row = await db.reviewGate.create({
      data: {
        // 🔴 分離キーは**認証コンテキストから**取る（リクエスト入力から受け取らない。CLAUDE.md §3.1）。
        //    値が ctx と違えば Prisma 拡張が例外にする（`tests/isolation/double-defense.test.ts`）。
        tenantId: ctx.tenantId,
        targetType: 'PROJECT_PUBLISH',
        targetId: TARGET_ID,
        contentHash: CONTENT_HASH,
        execution: 'DONE',
        // 🔴 PII 層・商流層は AI の判定（docs/05 §11.2）。
        piiVerdict: AI_OUTPUT.pii.verdict,
        commerceVerdict: AI_OUTPUT.commerce.verdict,
        // 🔴 整合層は AI ではなく機械的照合が決める（`BR-61`。ここでは既に確定した値を入れる）。
        consistencyVerdict: 'PASS',
        findings: [...AI_OUTPUT.pii.findings.map((finding) => ({ layer: 'PII', ...finding }))],
        // 🔴 警告は findings とは別の列に入る（合否に影響しない。docs/05 §11.4）。
        aiWarnings: [...AI_OUTPUT.consistencyWarnings.map((warning) => ({ layer: 'CONSISTENCY', ...warning }))],
        role: 'gate-inspector',
        // 🔴 これが `BR-13` の本体である（生成物に使用プロンプト版を保存する）。
        promptVersion: provenance.promptVersion,
        modelId: provenance.modelId,
        aiUsageId: provenance.aiUsageId,
        aiFailed: false,
        executedAt: NOW,
      },
      select: { id: true },
    });
    return row.id;
  });
}

beforeAll(async () => {
  database = await startIsolationDatabase();
  admin = createUnextendedClient(database.superuserUrl);
  configureTenantDb({ datasourceUrl: database.tenantUrl });
  ctxA = systemTenantCtx(TENANT_A, JOB);
  ctxB = systemTenantCtx(TENANT_B, JOB);
}, SETUP_TIMEOUT_MS);

afterEach(async () => {
  await admin.reviewGate.deleteMany({ where: { targetId: TARGET_ID } });
  await admin.aiUsage.deleteMany({});
  await admin.usageCounter.deleteMany({ where: { metric: { startsWith: 'AI_' } } });
});

afterAll(async () => {
  await admin?.$disconnect();
  await disconnectTenantDb();
  await database?.stop();
}, SETUP_TIMEOUT_MS);

describe('🔴 プロンプト版が ReviewGate に保存され、同じ版で再現できる（BR-13 / docs/05 §7.7）', () => {
  it('① 実行 → 保存 → 読み出しで、同じ版が ReviewGate と AiUsage の両方に残る', async () => {
    const executed = await runGateInspector(ctxA);
    const gateId = await saveReviewGate(ctxA, executed);

    const saved = await withTenant(ctxA, (db) =>
      db.reviewGate.findUniqueOrThrow({
        where: { id: gateId },
        select: { promptVersion: true, role: true, modelId: true, aiUsageId: true, aiFailed: true },
      }),
    );
    expect(saved.promptVersion).toBe('gate-inspector.v1');
    expect(saved.role).toBe('gate-inspector');
    expect(saved.modelId).toBe(SONNET);
    expect(saved.aiFailed).toBe(false);

    // 🔴 `AiUsage` にも同じ版が入る（原価とゲート結果が同じ版を指す。docs/05 §7.3）。
    const usage = await admin.aiUsage.findUniqueOrThrow({
      where: { id: saved.aiUsageId ?? '' },
      select: { promptVersion: true, role: true, purpose: true, attemptNo: true, succeeded: true },
    });
    expect(usage).toMatchObject({
      promptVersion: 'gate-inspector.v1',
      role: 'gate-inspector',
      purpose: 'gate',
      attemptNo: 1,
      succeeded: true,
    });
  });

  it('🔴 ② 保存された版だけを手掛かりに、実際に送ったプロンプトを再現できる', async () => {
    const executed = await runGateInspector(ctxA);
    const gateId = await saveReviewGate(ctxA, executed);

    const saved = await withTenant(ctxA, (db) =>
      db.reviewGate.findUniqueOrThrow({ where: { id: gateId }, select: { promptVersion: true } }),
    );
    expect(saved.promptVersion).not.toBeNull();

    // 🔴 「そのとき使った版」で組み立て直す（現行版を使わない）。
    const reproduced = gateInspectorSpecAtVersion(saved.promptVersion ?? '').buildPrompt(gateInput());

    expect(reproduced.system).toBe(executed.sent.system);
    expect(reproduced.user).toBe(executed.sent.userBlocks[0]?.text);
    // 対照: 実際に送った本文がマスキング済みであること（原文が残っていない）。
    expect(executed.sent.system).toContain('伏せ字');
    expect(executed.sent.userBlocks[0]?.text).not.toContain('山田 太郎');
    expect(executed.sent.userBlocks[0]?.text).not.toContain('taro@example.com');
    expect(executed.sent.userBlocks[0]?.text).toContain('Spring Boot');
  });

  it('🔴 ③ 版が違えば再現できない（欠番の版へ暗黙にフォールバックしない）', () => {
    expect(() => gateInspectorSpecAtVersion('gate-inspector.v2')).toThrowError(/gate-inspector.v2/);
  });

  it('🔴 ④ 警告は aiWarnings 列に入り、合否（findings / verdict）に混ざらない（BR-61）', async () => {
    const executed = await runGateInspector(ctxA);
    const gateId = await saveReviewGate(ctxA, executed);

    const saved = await withTenant(ctxA, (db) =>
      db.reviewGate.findUniqueOrThrow({
        where: { id: gateId },
        select: { findings: true, aiWarnings: true, consistencyVerdict: true },
      }),
    );
    const findings = saved.findings as { layer: string; severity: string }[];
    const warnings = saved.aiWarnings as { layer: string; severity: string }[];
    expect(findings.every((finding) => finding.layer !== 'CONSISTENCY')).toBe(true);
    // 🔴 整合層の警告は必ず WARN であり、合否（consistencyVerdict）は AI の出力に触れていない。
    expect(warnings.map((warning) => warning.severity)).toEqual(['WARN']);
    expect(saved.consistencyVerdict).toBe('PASS');
  });

  it('🔴 ⑤ 他テナントからは保存されたゲート結果が 1 件も見えない（CLAUDE.md §3.1）', async () => {
    const executed = await runGateInspector(ctxA);
    await saveReviewGate(ctxA, executed);

    const fromB = await withTenant(ctxB, (db) => db.reviewGate.findMany({ where: { targetId: TARGET_ID } }));
    expect(fromB).toEqual([]);
    // 対照: 自テナントからは見える（このテスト自体が空振りしていない）。
    const fromA = await withTenant(ctxA, (db) => db.reviewGate.findMany({ where: { targetId: TARGET_ID } }));
    expect(fromA).toHaveLength(1);
  });
});
