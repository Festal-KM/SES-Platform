// apps/worker/src/jobs/gate-run.test.ts
// 🔴 T-07-06: `gate.run` のパイプライン（docs/05 §9.3 / §11）。
//
// 🔴 **LLM は `MockAnthropicClient`（`packages/ai/src/mock/`）を使う**（docs/05 §17.5）。
//    テスト専用の別モックを書かない —— 書いた瞬間に「ユニットでは通るが E2E では違う挙動」に
//    なり、どちらの green も根拠にならなくなる。実 API には接続しない。
// 🔴 DB は `vi.mock('@ses/db')` で差し替える（実 DB を使う検証は
//    `tests/isolation/gate-run.test.ts`。ここで見たいのは**枝分け**である）。
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { GateInput } from '@ses/domain';

const findCachedReviewGate = vi.fn();
const loadGateInput = vi.fn();
const completeReviewGate = vi.fn();
const holdReviewGate = vi.fn();
const writeAuditLog = vi.fn();
const proposalUpdateMany = vi.fn();
const proposalEventCreate = vi.fn();

vi.mock('@ses/db', () => ({
  findCachedReviewGate,
  loadGateInput,
  completeReviewGate,
  holdReviewGate,
  writeAuditLog,
  systemTenantCtx: (tenantId: string, job: { queue: string; jobId: string }) => ({
    tenantId,
    partnerCompanyId: null,
    userId: '',
    role: 'ADMIN',
    lifecycleState: 'ACTIVE',
    job,
  }),
  withTenant: async (_ctx: unknown, fn: (db: unknown) => Promise<unknown>) =>
    fn({
      proposal: { updateMany: proposalUpdateMany },
      proposalEvent: { create: proposalEventCreate },
    }),
  // 🔴 コストガードと記録器のアダプタ（`apps/worker/src/ai/**`）が import する実体。
  reserveAiCost: vi.fn(),
  settleAiCost: vi.fn(),
  recordAiUsage: vi.fn(async () => 'ai-usage-id'),
  countAiUnit: vi.fn(async () => null),
}));

const { createAiClient, catalogRoleModelResolver, AiCostLimitExceededError } = await import('@ses/ai');
const { createGateRunHandler, parseGateRunPayload } = await import('./gate-run.js');
const { InvalidJobPayloadError } = await import('./payload.js');
const db = await import('@ses/db');

const TENANT_ID = '01930000-0000-7000-8000-0000000000a1';
const PROPOSAL_ID = '01930000-0000-7000-8000-0000000000b1';
const CONTENT_HASH = 'c'.repeat(64);
const JOB_ID = `gate.run:PROPOSAL:${PROPOSAL_ID}:${CONTENT_HASH}`;
const NOW = new Date('2026-09-08T01:00:00.000Z');
const SONNET = 'claude-sonnet-5';

const PAYLOAD = {
  tenantId: TENANT_ID,
  targetType: 'PROPOSAL',
  targetId: PROPOSAL_ID,
  contentHash: CONTENT_HASH,
};

function proposalGateInput(overrides: Partial<Extract<GateInput, { targetType: 'PROPOSAL' }>> = {}) {
  return {
    targetType: 'PROPOSAL',
    targetId: PROPOSAL_ID,
    contentHash: CONTENT_HASH,
    audience: { kind: 'EXTERNAL_CLIENT', partnerCompanyIds: [] },
    sections: [
      { field: 'subject', text: 'ご提案' },
      { field: 'body', text: 'Java の経験が 8 年あります。' },
    ],
    forbiddenTerms: { unitPrices: [], endClientNames: [], otherCompanyNames: [] },
    knownPii: { fullNames: [], birthDates: [], emails: [], phones: [], affiliations: [] },
    consistency: { subject: { snapshot: { skills: [] }, requirements: [], registeredSkills: [] } },
    ...overrides,
  } satisfies GateInput;
}

const PASS_OUTPUT = {
  pii: { verdict: 'PASS', findings: [] },
  commerce: { verdict: 'PASS', findings: [] },
  consistencyWarnings: [],
} as const;

function createHandler(mockOptions: NonNullable<Parameters<typeof createAiClient>[1]>['mock']) {
  return createGateRunHandler({
    now: () => NOW,
    aiClient: createAiClient('mock', { mock: mockOptions }),
    models: catalogRoleModelResolver({ DEFAULT: SONNET, CHEAP: 'claude-haiku-4-5-20251001' }),
    aiDailyCostLimitUsd: '5.000000',
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  findCachedReviewGate.mockResolvedValue(null);
  loadGateInput.mockResolvedValue({ kind: 'FOUND', input: proposalGateInput() });
  completeReviewGate.mockResolvedValue({ kind: 'SAVED', id: 'gate-id' });
  holdReviewGate.mockResolvedValue({ id: 'held-id', contentHash: CONTENT_HASH, heldSince: NOW, consistencyVerdict: 'PASS' });
  proposalUpdateMany.mockResolvedValue({ count: 1 });
  proposalEventCreate.mockResolvedValue({});
  writeAuditLog.mockResolvedValue(undefined);
  vi.mocked(db.reserveAiCost).mockResolvedValue({
    kind: 'RESERVED',
    handle: 'v1:2026-09-08:40000',
    reservedUsd: '0.040000',
    periodKey: '2026-09-08',
  });
  vi.mocked(db.settleAiCost).mockResolvedValue({
    actualUsd: '0.030000',
    valueUsd: '0.030000',
    reservedUsd: '0.000000',
    periodKey: '2026-09-08',
  });
});

describe('payload の門番', () => {
  it('必須項目が欠けていたら落とす', () => {
    expect(() => parseGateRunPayload({ ...PAYLOAD, targetId: undefined })).toThrowError(
      InvalidJobPayloadError,
    );
  });

  it('🔴 未知の targetType を黙って通さない', () => {
    expect(() => parseGateRunPayload({ ...PAYLOAD, targetType: 'ANYTHING' })).toThrowError(
      InvalidJobPayloadError,
    );
  });

  it('正しい payload は素通しする', () => {
    expect(parseGateRunPayload(PAYLOAD)).toEqual(PAYLOAD);
  });
});

describe('gate.run（docs/05 §11）', () => {
  it('3 層 PASS なら ReviewGate を保存し、提案を APPROVAL_PENDING へ CAS する', async () => {
    const outcome = await createHandler({ script: [{ kind: 'output', output: PASS_OUTPUT }] })(
      PAYLOAD,
      JOB_ID,
    );

    expect(outcome).toMatchObject({ kind: 'COMPLETED', overall: 'PASS', aiFailed: false, transitioned: true });
    expect(completeReviewGate).toHaveBeenCalledTimes(1);
    expect(completeReviewGate.mock.calls[0]?.[1]).toMatchObject({
      piiVerdict: 'PASS',
      commerceVerdict: 'PASS',
      consistencyVerdict: 'PASS',
      aiFailed: false,
      role: 'gate-inspector',
      promptVersion: 'gate-inspector.v1',
      modelId: SONNET,
      aiUsageId: 'ai-usage-id',
    });
    expect(proposalUpdateMany).toHaveBeenCalledWith({
      where: { id: PROPOSAL_ID, state: 'GATE_RUNNING' },
      data: { state: 'APPROVAL_PENDING' },
    });
  });

  it('🔴 1 層でも FAIL なら GATE_FAILED へ遷移し、指摘が保存される（F-020 処理④）', async () => {
    const outcome = await createHandler({
      script: [
        {
          kind: 'output',
          output: {
            pii: {
              verdict: 'FAIL',
              findings: [
                {
                  kind: 'FULL_NAME',
                  field: 'body',
                  offsetStart: 0,
                  offsetEnd: 4,
                  excerpt: '氏名らしき記載',
                  severity: 'BLOCK',
                },
              ],
            },
            commerce: { verdict: 'PASS', findings: [] },
            consistencyWarnings: [],
          },
        },
      ],
    })(PAYLOAD, JOB_ID);

    expect(outcome).toMatchObject({ kind: 'COMPLETED', overall: 'FAIL' });
    expect(completeReviewGate.mock.calls[0]?.[1]).toMatchObject({ piiVerdict: 'FAIL' });
    expect(proposalUpdateMany).toHaveBeenCalledWith({
      where: { id: PROPOSAL_ID, state: 'GATE_RUNNING' },
      data: { state: 'GATE_FAILED' },
    });
  });

  describe('🔴 AI の失敗（F-020 の AI 利用欄）', () => {
    it.each([
      ['タイムアウト', [{ kind: 'error' as const, error: 'TIMEOUT' as const }]],
      ['API エラー', [{ kind: 'error' as const, error: 'API' as const }]],
      ['スキーマ違反', [{ kind: 'output' as const, output: { pii: 'broken' } }]],
    // 🔴 タイムアウト / API エラーは `runRole` の内部で最大 2 回まで再試行する（docs/05 §7.4）。
    //    バックオフは 1s → 4s（ジッタ ±20%）なので、1 ケースに実時間で 5 秒前後かかる。
    //    **待ち時間を差し替える口を本番の `GateRunDeps` に足さない**（テストのためだけの分岐を
    //    製品側に増やさない）。ここは既定のテスト時間（5 秒）を明示的に伸ばして受け止める。
    ])('%s は PII / 商流を FAIL にし、PASS へフォールバックしない', async (_label, script) => {
      const outcome = await createHandler({ script })(PAYLOAD, JOB_ID);

      expect(outcome).toMatchObject({ kind: 'COMPLETED', overall: 'FAIL', aiFailed: true });
      const saved = completeReviewGate.mock.calls[0]?.[1];
      expect(saved).toMatchObject({
        piiVerdict: 'FAIL',
        commerceVerdict: 'FAIL',
        // 🔴 整合層は AI と独立に確定している。
        consistencyVerdict: 'PASS',
        aiFailed: true,
        // 🔴 「その版で検査した」記録にしない（BR-13）。
        role: null,
        promptVersion: null,
        aiUsageId: null,
      });
      expect(proposalUpdateMany).toHaveBeenCalledWith({
        where: { id: PROPOSAL_ID, state: 'GATE_RUNNING' },
        data: { state: 'GATE_FAILED' },
      });
    }, 20_000);
  });

  describe('🔴 AI の日次コスト上限（HELD。F-027 AC-5）', () => {
    beforeEach(() => {
      vi.mocked(db.reserveAiCost).mockResolvedValue({
        kind: 'LIMIT_REACHED',
        limitUsd: '5.000000',
        headroomUsd: '0.000000',
        resetAt: new Date('2026-09-08T15:00:00.000Z'),
        periodKey: '2026-09-08',
      });
    });

    it('🔴 GATE_FAILED にせず保留し、ジョブは正常終了する', async () => {
      const outcome = await createHandler({ script: [{ kind: 'output', output: PASS_OUTPUT }] })(
        PAYLOAD,
        JOB_ID,
      );

      expect(outcome).toEqual({ kind: 'HELD_AI_COST_LIMIT', reviewGateId: 'held-id' });
      // 🔴 合否を確定させない（`completeReviewGate` を呼ばない）。
      expect(completeReviewGate).not.toHaveBeenCalled();
      // 🔴 対象は `GATE_RUNNING` のまま（状態を動かさない）。
      expect(proposalUpdateMany).not.toHaveBeenCalled();
    });

    it('🔴 整合層の結果は保持され、上限解除後の再実行に使われる形で保存される', async () => {
      loadGateInput.mockResolvedValue({
        kind: 'FOUND',
        input: proposalGateInput({
          consistency: {
            subject: {
              snapshot: { skills: [{ skillId: 's1', label: 'React', years: 1, level: null }] },
              requirements: [{ kind: 'MUST', skill: { id: 's1', label: 'React' }, requiredYears: 3 }],
              registeredSkills: [{ skillId: 's1', years: 1, level: null }],
            },
          },
        }),
      });

      await createHandler({ script: [{ kind: 'output', output: PASS_OUTPUT }] })(PAYLOAD, JOB_ID);

      expect(holdReviewGate.mock.calls[0]?.[1]).toMatchObject({
        targetType: 'PROPOSAL',
        targetId: PROPOSAL_ID,
        contentHash: CONTENT_HASH,
        consistencyVerdict: 'FAIL',
        heldSince: NOW,
      });
      const findings = holdReviewGate.mock.calls[0]?.[1]?.findings as { layer: string }[];
      expect(findings).toHaveLength(1);
      expect(findings[0]?.layer).toBe('CONSISTENCY');
    });
  });

  describe('🔴 キャッシュ（P-A-09）', () => {
    it('同じ内容の確定結果があれば LLM を呼ばない', async () => {
      findCachedReviewGate.mockResolvedValue({
        id: 'cached-id',
        aiFailed: false,
        piiVerdict: 'PASS',
        commerceVerdict: 'PASS',
        consistencyVerdict: 'PASS',
      });
      const client = createAiClient('mock', { mock: { script: [{ kind: 'output', output: PASS_OUTPUT }] } });
      const handler = createGateRunHandler({
        now: () => NOW,
        aiClient: client,
        models: catalogRoleModelResolver({ DEFAULT: SONNET, CHEAP: SONNET }),
        aiDailyCostLimitUsd: '5.000000',
      });

      const outcome = await handler(PAYLOAD, JOB_ID);

      expect(outcome).toEqual({ kind: 'ALREADY_DONE', reviewGateId: 'cached-id' });
      expect(loadGateInput).not.toHaveBeenCalled();
      expect(completeReviewGate).not.toHaveBeenCalled();
      expect(db.reserveAiCost).not.toHaveBeenCalled();
    });
  });

  it('🔴 保留行の完了 CAS が 0 件なら結果を破棄し、状態も動かさない（多重化防止の 3 段目）', async () => {
    completeReviewGate.mockResolvedValue({ kind: 'RACED' });
    const outcome = await createHandler({ script: [{ kind: 'output', output: PASS_OUTPUT }] })(
      PAYLOAD,
      JOB_ID,
    );
    expect(outcome).toEqual({ kind: 'RACED' });
    expect(proposalUpdateMany).not.toHaveBeenCalled();
  });

  it('対象が消えていたら PASS にせず TARGET_NOT_FOUND を返す', async () => {
    loadGateInput.mockResolvedValue({ kind: 'NOT_FOUND' });
    const outcome = await createHandler({ script: [{ kind: 'output', output: PASS_OUTPUT }] })(
      PAYLOAD,
      JOB_ID,
    );
    expect(outcome).toEqual({ kind: 'TARGET_NOT_FOUND' });
    expect(completeReviewGate).not.toHaveBeenCalled();
  });

  it('🔴 提案が GATE_RUNNING でなければ状態を上書きしない（内容が編集された場合）', async () => {
    proposalUpdateMany.mockResolvedValue({ count: 0 });
    const outcome = await createHandler({ script: [{ kind: 'output', output: PASS_OUTPUT }] })(
      PAYLOAD,
      JOB_ID,
    );
    expect(outcome).toMatchObject({ kind: 'COMPLETED', transitioned: false });
    expect(proposalEventCreate).not.toHaveBeenCalled();
    expect(writeAuditLog).not.toHaveBeenCalled();
  });

  it('状態を変えたら AuditLog（actorKind=SYSTEM）を書く（docs/05 §9.1 / §16.1）', async () => {
    await createHandler({ script: [{ kind: 'output', output: PASS_OUTPUT }] })(PAYLOAD, JOB_ID);
    expect(writeAuditLog.mock.calls[0]?.[1]).toMatchObject({
      action: 'proposal.update',
      actorKind: 'SYSTEM',
      targetType: 'PROPOSAL',
      targetId: PROPOSAL_ID,
      summary: { operation: 'GATE_RESULT', overall: 'PASS' },
    });
  });

  it('🔴 LLM へ送る本文はマスキング済みで、警告は findings と別に保存される', async () => {
    loadGateInput.mockResolvedValue({
      kind: 'FOUND',
      input: proposalGateInput({
        sections: [{ field: 'body', text: '山田 太郎をご紹介します。' }],
        knownPii: {
          fullNames: ['山田 太郎'],
          birthDates: [],
          emails: [],
          phones: [],
          affiliations: [],
        },
      }),
    });

    await createHandler({
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
    })(PAYLOAD, JOB_ID);

    const saved = completeReviewGate.mock.calls[0]?.[1];
    // 🔴 台帳の氏名が本文に残っている → 機械的検出で PII 層は FAIL（AI が PASS でも覆る）。
    expect(saved).toMatchObject({ piiVerdict: 'FAIL' });
    const findings = saved?.findings as { layer: string; severity: string }[];
    const warnings = saved?.aiWarnings as { severity: string }[];
    expect(findings.every((row) => row.severity === 'BLOCK')).toBe(true);
    expect(warnings.map((row) => row.severity)).toEqual(['WARN']);
  });

  it('🔴 AiCostLimitExceededError 以外の例外は握り潰さない', async () => {
    loadGateInput.mockRejectedValue(new Error('boom'));
    await expect(
      createHandler({ script: [{ kind: 'output', output: PASS_OUTPUT }] })(PAYLOAD, JOB_ID),
    ).rejects.toThrowError('boom');
    // 対照: 上限の例外だけが HELD に写る。
    expect(new AiCostLimitExceededError({
      resetAt: NOW,
      limitUsd: '1.000000',
      remainingUsd: '0.000000',
    })).toBeInstanceOf(Error);
  });
});
