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
// 🔴 T-09-03: 自動承認（docs/05 §11.6）。`tenants.auto_approve_enabled` と `approveProposal`（packages/db の 1 実装）。
const tenantFindFirst = vi.fn();
const approveProposal = vi.fn();

vi.mock('@ses/db', () => ({
  findCachedReviewGate,
  loadGateInput,
  completeReviewGate,
  holdReviewGate,
  writeAuditLog,
  approveProposal,
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
      tenant: { findFirst: tenantFindFirst },
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
  // 🔴 既定は人間承認必須（`autoApproveEnabled = false`。CLAUDE.md §3.3）。
  tenantFindFirst.mockResolvedValue({ autoApproveEnabled: false, lifecycleState: 'ACTIVE' });
  approveProposal.mockResolvedValue({ kind: 'APPROVED', reviewGateId: 'gate-id', contentHash: CONTENT_HASH });
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

      // 🔴 T-07-09: `publish` は「案件の公開の確定」であり、提案では常に `null` である。
      expect(outcome).toEqual({ kind: 'ALREADY_DONE', reviewGateId: 'cached-id', publish: null });
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

// ---------------------------------------------------------------------------
// 🔴 T-09-03: 自動モードでの自動承認（docs/05 §11.6 / §10.3 / `F-021 AC-2` `AC-3` `AC-5`）
// ---------------------------------------------------------------------------
describe('🔴 自動承認（docs/05 §11.6）: autoApproveEnabled かつ全層 PASS のときだけ approveProposal(SYSTEM) を呼ぶ', () => {
  const FAIL_OUTPUT = {
    pii: {
      verdict: 'FAIL',
      findings: [
        { kind: 'FULL_NAME', field: 'body', offsetStart: 0, offsetEnd: 4, excerpt: '氏名らしき記載', severity: 'BLOCK' },
      ],
    },
    commerce: { verdict: 'PASS', findings: [] },
    consistencyWarnings: [],
  } as const;

  it('F-021 AC-2: 既定（autoApproveEnabled=false）では全層 PASS でも承認を付与しない（APPROVAL_PENDING に留まる）', async () => {
    const outcome = await createHandler({ script: [{ kind: 'output', output: PASS_OUTPUT }] })(PAYLOAD, JOB_ID);
    expect(outcome).toMatchObject({ kind: 'COMPLETED', transitioned: true, autoApproval: null });
    expect(approveProposal).not.toHaveBeenCalled();
  });

  it('F-021 AC-3 / AC-5: 有効かつ全層 PASS なら、確定の後に approveProposal を SYSTEM で 1 回だけ呼ぶ（自前で APPROVED を書かない）', async () => {
    tenantFindFirst.mockResolvedValue({ autoApproveEnabled: true, lifecycleState: 'ACTIVE' });
    const outcome = await createHandler({ script: [{ kind: 'output', output: PASS_OUTPUT }] })(PAYLOAD, JOB_ID);
    expect(outcome).toMatchObject({ kind: 'COMPLETED', transitioned: true, autoApproval: 'APPROVED' });
    expect(approveProposal).toHaveBeenCalledTimes(1);
    expect(approveProposal.mock.calls[0]?.[1]).toEqual({
      proposalId: PROPOSAL_ID,
      actor: { kind: 'SYSTEM' },
      now: NOW,
      ipAddress: null,
    });
    // 🔴 ジョブが `state='APPROVED'` を直接書く経路は無い（updateMany は GATE_RUNNING → APPROVAL_PENDING の 1 回だけ）。
    expect(proposalUpdateMany).toHaveBeenCalledTimes(1);
    expect(proposalUpdateMany.mock.calls[0]?.[0]).toEqual({
      where: { id: PROPOSAL_ID, state: 'GATE_RUNNING' },
      data: { state: 'APPROVAL_PENDING' },
    });
  });

  it('🔴 F-021 AC-3: 有効でも 1 層 FAIL なら GATE_FAILED に留まり、approveProposal を呼ばない', async () => {
    tenantFindFirst.mockResolvedValue({ autoApproveEnabled: true, lifecycleState: 'ACTIVE' });
    const outcome = await createHandler({ script: [{ kind: 'output', output: FAIL_OUTPUT }] })(PAYLOAD, JOB_ID);
    expect(outcome).toMatchObject({ kind: 'COMPLETED', overall: 'FAIL', transitioned: true, autoApproval: null });
    expect(proposalUpdateMany).toHaveBeenCalledWith({
      where: { id: PROPOSAL_ID, state: 'GATE_RUNNING' },
      data: { state: 'GATE_FAILED' },
    });
    expect(approveProposal).not.toHaveBeenCalled();
  });

  it('🔴 有効でも AI が失敗（判定不能 = FAIL）なら自動承認しない', async () => {
    tenantFindFirst.mockResolvedValue({ autoApproveEnabled: true, lifecycleState: 'ACTIVE' });
    // スキーマ違反は再試行の待ち時間（1s → 4s）を伴わない失敗（上の describe の注記）。枝の検証にはこれで足りる。
    const outcome = await createHandler({ script: [{ kind: 'output', output: { pii: 'broken' } }] })(PAYLOAD, JOB_ID);
    expect(outcome).toMatchObject({ kind: 'COMPLETED', overall: 'FAIL', aiFailed: true, autoApproval: null });
    expect(approveProposal).not.toHaveBeenCalled();
  });

  it('🔴 確定の CAS が 0 件（他の実行に先を越された / 編集で DRAFT に戻った）なら自動承認を試みない', async () => {
    tenantFindFirst.mockResolvedValue({ autoApproveEnabled: true, lifecycleState: 'ACTIVE' });
    proposalUpdateMany.mockResolvedValue({ count: 0 });
    const outcome = await createHandler({ script: [{ kind: 'output', output: PASS_OUTPUT }] })(PAYLOAD, JOB_ID);
    expect(outcome).toMatchObject({ kind: 'COMPLETED', transitioned: false, autoApproval: null });
    expect(approveProposal).not.toHaveBeenCalled();
  });

  it.each(['SUSPENDED', 'CLOSING', 'PURGED'] as const)(
    '🔴 T-09-04: テナントが %s なら autoApproveEnabled かつ全層 PASS でも approveProposal を呼ばない（APPROVAL_PENDING に留まる = 人間承認に倒す）',
    async (lifecycleState) => {
      tenantFindFirst.mockResolvedValue({ autoApproveEnabled: true, lifecycleState });
      const outcome = await createHandler({ script: [{ kind: 'output', output: PASS_OUTPUT }] })(PAYLOAD, JOB_ID);
      expect(outcome).toMatchObject({ kind: 'COMPLETED', overall: 'PASS', transitioned: true, autoApproval: null });
      expect(proposalUpdateMany).toHaveBeenCalledWith({
        where: { id: PROPOSAL_ID, state: 'GATE_RUNNING' },
        data: { state: 'APPROVAL_PENDING' },
      });
      expect(approveProposal).not.toHaveBeenCalled();
    },
  );

  it('🔴 T-09-04: lifecycleState と autoApproveEnabled は tenants の同じ select で読む（片方だけ読む経路を作らない）', async () => {
    tenantFindFirst.mockResolvedValue({ autoApproveEnabled: true, lifecycleState: 'SANDBOX' });
    const outcome = await createHandler({ script: [{ kind: 'output', output: PASS_OUTPUT }] })(PAYLOAD, JOB_ID);
    expect(outcome).toMatchObject({ kind: 'COMPLETED', autoApproval: 'APPROVED' });
    expect(tenantFindFirst).toHaveBeenCalledTimes(1);
    expect(tenantFindFirst).toHaveBeenCalledWith({ select: { autoApproveEnabled: true, lifecycleState: true } });
  });

  it('🔴 T-09-04: テナント行が読めない / 状態が未知なら自動承認しない（安全側）', async () => {
    tenantFindFirst.mockResolvedValue({ autoApproveEnabled: true, lifecycleState: 'BOGUS' });
    expect(await createHandler({ script: [{ kind: 'output', output: PASS_OUTPUT }] })(PAYLOAD, JOB_ID)).toMatchObject({ autoApproval: null });
    tenantFindFirst.mockResolvedValue(null);
    expect(await createHandler({ script: [{ kind: 'output', output: PASS_OUTPUT }] })(PAYLOAD, JOB_ID)).toMatchObject({ autoApproval: null });
    expect(approveProposal).not.toHaveBeenCalled();
  });

  it('approveProposal が GATE_STALE を返したら、その事実を帰結に写す（握り潰さず、APPROVED とも言わない）', async () => {
    tenantFindFirst.mockResolvedValue({ autoApproveEnabled: true, lifecycleState: 'ACTIVE' });
    approveProposal.mockResolvedValue({ kind: 'GATE_STALE' });
    const outcome = await createHandler({ script: [{ kind: 'output', output: PASS_OUTPUT }] })(PAYLOAD, JOB_ID);
    expect(outcome).toMatchObject({ kind: 'COMPLETED', autoApproval: 'GATE_STALE' });
  });
});
