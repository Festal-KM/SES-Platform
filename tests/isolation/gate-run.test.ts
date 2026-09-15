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
  ENGINEER_A_PARTNER,
  ENGINEER_A_PARTNER2,
  PARTNER_A1,
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
/**
 * 🔴 T-09-13（docs/05 §4.7 二重防御 #12）: パートナー所属エンジニア（`ENGINEER_A_PARTNER`。所有 = `PARTNER_A1`）の
 *    **台帳の現在値**。ホスト文脈からは C3 で 1 行も読めない値であり、本文に残っていて FAIL になることが
 *    「`app_gate_probe` 経由で既知値を読んでいる」ことの直接の証明になる。
 */
const PARTNER_ENGINEER_NAME = '佐藤 花子';
const PARTNER_ENGINEER_EMAIL = 'hanako@partner-a1.example';
const PARTNER_ENGINEER_PHONE = '090-1234-5678';
/** 別パートナー（`PARTNER_A2`）のエンジニアの値。**1 文字も現れてはならない**（§4.7 #13 ①）。 */
const OTHER_PARTNER_ENGINEER_NAME = '鈴木 次郎';
const OTHER_PARTNER_ENGINEER_EMAIL = 'jiro@partner-a2.example';
/** 台帳に登録する Skill 辞書の行（グローバル）。`engineer_skills` の FK 先。 */
const SKILL_BACKED = '01930000-0000-7000-8000-0000000009c1';

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

/** `EngineerSnapshot.careers` の 1 行（docs/05 §3.6 `FrozenCareer`。🔴 行 ID を持たない）。 */
type FrozenCareerRow = {
  readonly periodFrom: string;
  readonly periodTo: string | null;
  readonly role: string;
  readonly description: string;
  readonly technologies: string;
};

/** 提案をゲート実行中の状態に整える（本文・凍結コピー・台帳の PII）。 */
async function prepareProposal(input: {
  readonly proposalId: string;
  readonly body: string;
  readonly snapshotSkills: readonly { skillId: string; name: string; years: number; level: number | null }[];
  /**
   * 🔴 T-09-12: 凍結された経歴（`field='snapshot'` の検査対象。docs/05 §6.5）。既定は 0 行。
   *    `create` と `update` の**両方**に書く —— `update` に無いと前のテストの行が残留して
   *    「経歴 0 行のはず」のテストが前のテストの経歴を検査してしまう。
   */
  readonly careers?: readonly FrozenCareerRow[];
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
      careers: [...(input.careers ?? [])],
      frozenAt: NOW,
    },
    update: { skills: [...input.snapshotSkills], careers: [...(input.careers ?? [])] },
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
  await admin.engineerSkill.deleteMany({
    where: { engineerId: { in: [ENGINEER_A_HOST, ENGINEER_A_PARTNER, ENGINEER_A_PARTNER2] } },
  });
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

  it('🔴 T-09-12: 本文が清潔でも、凍結された経歴（field=snapshot）に台帳の氏名が残っていれば PII 層 FAIL', async () => {
    // 🔴 docs/05 §6.5「凍結行はゲートの検査対象である」—— 業務内容には現所属会社名・氏名が書かれるのが
    //    常態であり、経歴を検査から外すと PII 層が経歴の側から素通りする（`BR-15` / `F-020 AC-1`）。
    await prepareProposal({
      proposalId: PROPOSAL_A_HOST,
      body: '清潔な本文です。',
      snapshotSkills: [],
      careers: [
        {
          periodFrom: '2020-01',
          periodTo: null,
          role: 'PL',
          description: `${ENGINEER_NAME}が担当した案件`,
          technologies: '',
        },
      ],
    });

    const outcome = await runGate({
      targetType: 'PROPOSAL',
      targetId: PROPOSAL_A_HOST,
      contentHash: 'hash-career-pii-fail',
      script: [{ kind: 'output', output: CLEAN_OUTPUT }],
    });

    expect(outcome).toMatchObject({ kind: 'COMPLETED', overall: 'FAIL', aiFailed: false });
    const gate = await readGate(PROPOSAL_A_HOST);
    expect(gate?.piiVerdict).toBe('FAIL');
    const findings = gate?.findings as { layer: string; kind: string; field: string }[];
    // 🔴 指摘の欄は `snapshot`（連結後の経歴の文字列に対する位置）。本文（`body`）ではない。
    expect(findings.some((finding) => finding.field === 'snapshot')).toBe(true);
    expect(findings).toContainEqual(
      expect.objectContaining({ layer: 'PII', kind: 'FULL_NAME', field: 'snapshot' }),
    );
    expect(findings.some((finding) => finding.field === 'body')).toBe(false);
    expect(JSON.stringify(findings)).not.toContain(ENGINEER_NAME);
    expect(await proposalState(PROPOSAL_A_HOST)).toBe('GATE_FAILED');
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

  it('🔴 T-09-12: 凍結された経歴（field=snapshot）にエンド企業名が書かれていれば商流層 FAIL（F-014 AC-3 が経歴側から素通りしない）', async () => {
    // `PROPOSAL_A_HOST` の案件は `PROJECT_A_PUBLISHED`（`end_client_name = END_CLIENT`。fixtures）。
    await prepareProposal({
      proposalId: PROPOSAL_A_HOST,
      body: '清潔な本文です。',
      snapshotSkills: [],
      careers: [
        {
          periodFrom: '2022-04',
          periodTo: '2024-03',
          role: 'SE',
          description: `${END_CLIENT} 向け基幹刷新`,
          technologies: 'Java',
        },
      ],
    });

    const outcome = await runGate({
      targetType: 'PROPOSAL',
      targetId: PROPOSAL_A_HOST,
      contentHash: 'hash-career-commerce-fail',
      script: [{ kind: 'output', output: CLEAN_OUTPUT }],
    });

    expect(outcome).toMatchObject({ kind: 'COMPLETED', overall: 'FAIL', aiFailed: false });
    const gate = await readGate(PROPOSAL_A_HOST);
    expect(gate?.commerceVerdict).toBe('FAIL');
    expect(gate?.piiVerdict).toBe('PASS');
    const findings = gate?.findings as { layer: string; kind: string; field: string }[];
    expect(findings).toContainEqual(
      expect.objectContaining({ layer: 'COMMERCE', kind: 'END_CLIENT', field: 'snapshot' }),
    );
    // 🔴 抜粋にエンド企業名そのものを残さない。
    expect(JSON.stringify(findings)).not.toContain(END_CLIENT);
    expect(await proposalState(PROPOSAL_A_HOST)).toBe('GATE_FAILED');
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

/**
 * 🔴 T-09-13（docs/05 §11.14 ⑧ / §4.7 二重防御 #12）: **パートナー所属エンジニアの提案でも 3 層の判定が下る。**
 *
 * T-07-06 時点では「パートナー所属エンジニアの提案は台帳を読めず、ゲート結果を 1 行も書かずに落ちる」
 * （fail-closed。§11.9 ⑦。旧 reason は欠番）だった。§11.14 の限定経路（`app_gate_probe` +
 * SECURITY DEFINER 2 関数）で事象そのものが消えたため、**主張を反転させる**（期待値の書き換えではない）。
 *
 * 証明の 3 点:
 *   ① 清潔な本文 + 台帳に裏付けのある凍結スキル → **3 層 PASS**・`ReviewGate` 1 行・`APPROVAL_PENDING`
 *      （= `engineer_skills` の 3 列を読んでいる。読めていなければ整合層は FAIL になる）
 *   ② 本文に**台帳の現在値**（`display_name` / `contact_email` / `contact_phone`）を残す → **PII 層 FAIL**
 *      （`FULL_NAME` / `CONTACT`）。凍結コピーには連絡先が無いので、これは「連絡先の既知値を読んでいる」
 *      ことの直接の証明（§11.14 ② の 1〜4）。別パートナーのエンジニアの値は本文に無いので指摘にならない
 *   ③ 台帳に裏付けの無い凍結スキル → **整合層 FAIL**（`SKILL_SHEET_MISMATCH`）
 */
describe('🔴 T-09-13: パートナー所属エンジニアの提案でも 3 層の判定が下り、ReviewGate が 1 行書かれる（docs/05 §4.7 #12）', () => {
  /** パートナー所属エンジニアの提案をゲート実行中に整える（台帳の PII と別パートナーの対照値を含む）。 */
  async function preparePartnerProposal(input: {
    readonly body: string;
    readonly snapshotSkills: readonly { skillId: string; name: string; years: number; level: number | null }[];
  }): Promise<void> {
    await admin.skill.upsert({
      where: { id: SKILL_BACKED },
      create: { id: SKILL_BACKED, name: 'Kotlin(gate-run)', category: 'LANGUAGE', sortKey: 901 },
      update: {},
    });
    await admin.engineer.update({
      where: { id: ENGINEER_A_PARTNER },
      data: {
        displayName: PARTNER_ENGINEER_NAME,
        contactEmail: PARTNER_ENGINEER_EMAIL,
        contactPhone: PARTNER_ENGINEER_PHONE,
        birthDate: new Date('1992-03-15T00:00:00.000Z'),
      },
    });
    // 🔴 対照: 別パートナーのエンジニアにも値を入れる。本経路で読めてはならない値。
    await admin.engineer.update({
      where: { id: ENGINEER_A_PARTNER2 },
      data: { displayName: OTHER_PARTNER_ENGINEER_NAME, contactEmail: OTHER_PARTNER_ENGINEER_EMAIL },
    });
    // 台帳の裏付け（パートナー所有。owner_partner_company_id はトリガが engineers から継承する）。
    await admin.engineerSkill.create({
      data: {
        tenantId: TENANT_A,
        engineerId: ENGINEER_A_PARTNER,
        skillId: SKILL_BACKED,
        yearsOfExperience: 6,
        level: 4,
        source: 'MANUAL',
      },
    });
    await admin.proposal.update({
      where: { id: PROPOSAL_A_P1 },
      data: { state: 'GATE_RUNNING', subject: 'ご提案', body: input.body },
    });
    await admin.engineerSnapshot.upsert({
      where: { proposalId: PROPOSAL_A_P1 },
      create: {
        id: randomUUID(),
        tenantId: TENANT_A,
        proposalId: PROPOSAL_A_P1,
        displayName: PARTNER_ENGINEER_NAME,
        affiliationLabel: null,
        skills: [...input.snapshotSkills],
        careers: [],
        frozenAt: NOW,
      },
      update: { skills: [...input.snapshotSkills], careers: [] },
    });
  }

  it('前提: 提案の所有はパートナー、エンジニアはパートナー所属で、ホスト文脈からは台帳が 1 行も読めない（空振り防止）', async () => {
    await preparePartnerProposal({ body: '清潔な本文です。', snapshotSkills: [] });
    const proposal = await admin.proposal.findUniqueOrThrow({
      where: { id: PROPOSAL_A_P1 },
      select: { ownerPartnerCompanyId: true, engineerId: true },
    });
    expect(proposal.ownerPartnerCompanyId).toBe(PARTNER_A1);
    expect(proposal.engineerId).toBe(ENGINEER_A_PARTNER);
    // 🔴 C3: ホスト文脈（withTenant）からは台帳が見えない。これが §11.9 ⑦ の事象の前提であり、
    //    本経路が「C3 を緩めた」のではなく「限定経路を足した」ことの対照になる。
    const visible = await withTenant(ctxA, (db) => db.engineer.count({ where: { id: ENGINEER_A_PARTNER } }));
    expect(visible).toBe(0);
  });

  it('① 清潔な本文 + 台帳に裏付けのある凍結スキル → 3 層 PASS・ReviewGate 1 行・APPROVAL_PENDING', async () => {
    await preparePartnerProposal({
      body: 'ご提案します。Kotlin の経験が 6 年あります。',
      snapshotSkills: [{ skillId: SKILL_BACKED, name: 'Kotlin(gate-run)', years: 6, level: 4 }],
    });

    const outcome = await runGate({
      targetType: 'PROPOSAL',
      targetId: PROPOSAL_A_P1,
      contentHash: 'hash-partner-pass',
      script: [{ kind: 'output', output: CLEAN_OUTPUT }],
    });

    expect(outcome).toMatchObject({ kind: 'COMPLETED', overall: 'PASS', aiFailed: false, transitioned: true });
    expect(await admin.reviewGate.count({ where: { targetId: PROPOSAL_A_P1 } })).toBe(1);
    const gate = await readGate(PROPOSAL_A_P1);
    expect(gate).toMatchObject({
      execution: 'DONE',
      piiVerdict: 'PASS',
      commerceVerdict: 'PASS',
      consistencyVerdict: 'PASS',
    });
    expect(await proposalState(PROPOSAL_A_P1)).toBe('APPROVAL_PENDING');
  });

  it('🔴 ② 本文に台帳の現在値（氏名・メール・電話）が残っていれば PII 層 FAIL（FULL_NAME / CONTACT）—— 連絡先の既知値を読んでいる証明', async () => {
    await preparePartnerProposal({
      body: `${PARTNER_ENGINEER_NAME}をご提案します。連絡先: ${PARTNER_ENGINEER_EMAIL} / ${PARTNER_ENGINEER_PHONE}`,
      snapshotSkills: [],
    });

    const outcome = await runGate({
      targetType: 'PROPOSAL',
      targetId: PROPOSAL_A_P1,
      contentHash: 'hash-partner-pii-fail',
      // 🔴 AI は「何も無い」と言う。機械的検出（既知値）だけで FAIL になることを示す。
      script: [{ kind: 'output', output: CLEAN_OUTPUT }],
    });

    expect(outcome).toMatchObject({ kind: 'COMPLETED', overall: 'FAIL', aiFailed: false });
    expect(await admin.reviewGate.count({ where: { targetId: PROPOSAL_A_P1 } })).toBe(1);
    const gate = await readGate(PROPOSAL_A_P1);
    expect(gate?.piiVerdict).toBe('FAIL');
    expect(gate?.commerceVerdict).toBe('PASS');
    expect(gate?.consistencyVerdict).toBe('PASS');

    const findings = gate?.findings as { layer: string; kind: string; field: string; excerpt: string }[];
    const kinds = findings.filter((finding) => finding.layer === 'PII').map((finding) => finding.kind);
    expect(kinds).toContain('FULL_NAME');
    // 🔴 メールと電話の 2 件。凍結コピーには連絡先が無いので、これは台帳（app_gate_probe 経由）から来た既知値である。
    expect(kinds.filter((kind) => kind === 'CONTACT')).toHaveLength(2);
    // 🔴 指摘に原文が無い（抜粋は伏せ字）。
    const serialized = JSON.stringify(findings);
    expect(serialized).not.toContain(PARTNER_ENGINEER_NAME);
    expect(serialized).not.toContain(PARTNER_ENGINEER_EMAIL);
    expect(serialized).not.toContain(PARTNER_ENGINEER_PHONE);
    expect(await proposalState(PROPOSAL_A_P1)).toBe('GATE_FAILED');
  });

  it('🔴 ② の対照: 別パートナーのエンジニアの氏名は既知値に入っていない（本文に書いても機械的検出は指摘しない）', async () => {
    // 🔴 §4.7 #13 ①の gate.run 側の写し: 読んでいるのが「その提案の対象 1 人分」であることを、
    //    別パートナーの氏名が本文にあっても FULL_NAME にならないことで示す（氏名はパターン検出でも拾えない）。
    await preparePartnerProposal({
      body: `${OTHER_PARTNER_ENGINEER_NAME}という別会社の方の話です。`,
      snapshotSkills: [],
    });

    const outcome = await runGate({
      targetType: 'PROPOSAL',
      targetId: PROPOSAL_A_P1,
      contentHash: 'hash-partner-other-name',
      script: [{ kind: 'output', output: CLEAN_OUTPUT }],
    });

    expect(outcome).toMatchObject({ kind: 'COMPLETED', overall: 'PASS', aiFailed: false });
    const gate = await readGate(PROPOSAL_A_P1);
    expect(gate?.piiVerdict).toBe('PASS');
    expect(gate?.findings).toEqual([]);
  });

  it('③ 台帳に裏付けの無い凍結スキルは整合層 FAIL（SKILL_SHEET_MISMATCH）', async () => {
    await preparePartnerProposal({
      body: '清潔な本文です。',
      snapshotSkills: [{ skillId: SKILL_ID, name: 'TypeScript', years: 5, level: null }],
    });

    const outcome = await runGate({
      targetType: 'PROPOSAL',
      targetId: PROPOSAL_A_P1,
      contentHash: 'hash-partner-consistency-fail',
      script: [{ kind: 'output', output: CLEAN_OUTPUT }],
    });

    expect(outcome).toMatchObject({ kind: 'COMPLETED', overall: 'FAIL', aiFailed: false });
    expect(await admin.reviewGate.count({ where: { targetId: PROPOSAL_A_P1 } })).toBe(1);
    const gate = await readGate(PROPOSAL_A_P1);
    expect(gate?.piiVerdict).toBe('PASS');
    expect(gate?.consistencyVerdict).toBe('FAIL');
    const findings = gate?.findings as { layer: string; kind: string }[];
    expect(findings).toContainEqual(expect.objectContaining({ layer: 'CONSISTENCY', kind: 'SKILL_SHEET_MISMATCH' }));
    expect(await proposalState(PROPOSAL_A_P1)).toBe('GATE_FAILED');
  });
});

describe('🔴 検査できない対象を PASS に倒さない（F-020 AC-1）', () => {
  it('🔴 T-09-13: GATE_RUNNING でない提案（DRAFT）は検査せず TARGET_NOT_FOUND（ReviewGate は 0 行。docs/05 §11.14 ⑥-2）', async () => {
    await prepareProposal({ proposalId: PROPOSAL_A_HOST, body: '本文です。', snapshotSkills: [] });
    await admin.proposal.update({ where: { id: PROPOSAL_A_HOST }, data: { state: 'DRAFT' } });

    await expect(
      runGate({
        targetType: 'PROPOSAL',
        targetId: PROPOSAL_A_HOST,
        contentHash: 'hash-not-running',
        script: [{ kind: 'output', output: CLEAN_OUTPUT }],
      }),
    ).resolves.toEqual({ kind: 'TARGET_NOT_FOUND' });

    expect(await admin.reviewGate.count({ where: { targetId: PROPOSAL_A_HOST } })).toBe(0);
    expect(await proposalState(PROPOSAL_A_HOST)).toBe('DRAFT');
    // 🔴 LLM も呼ばれていない（入口で止まっている）。
    expect(await admin.aiUsage.count({ where: { tenantId: TENANT_A } })).toBe(0);
  });

  it('🔴 T-09-12: 凍結された経歴の形が壊れている（careers が配列でない）提案は PASS にせず落ちる', async () => {
    // 🔴 0 行は `[]` で保存する規約（docs/05 §3.6）。`null` は「凍結し忘れ」であり、読めないまま
    //    PASS にすると PII 層・商流層が経歴の側から素通りする（`toFrozenCareers` の fail-closed）。
    await prepareProposal({ proposalId: PROPOSAL_A_HOST, body: '本文です。', snapshotSkills: [] });
    // 🔴 生 SQL で JSON の null を書く（`@prisma/client` の `Prisma.JsonNull` は packages/db の外から
    //    import できない。ESLint の生 PrismaClient 迂回禁止）。列は NOT NULL だが JSON 値の null は入る。
    await admin.$executeRaw`UPDATE engineer_snapshots SET careers = 'null'::jsonb WHERE proposal_id = ${PROPOSAL_A_HOST}::uuid`;

    await expect(
      runGate({
        targetType: 'PROPOSAL',
        targetId: PROPOSAL_A_HOST,
        contentHash: 'hash-careers-null',
        script: [{ kind: 'output', output: CLEAN_OUTPUT }],
      }),
    ).rejects.toThrowError(/SNAPSHOT_CAREERS_NOT_ARRAY/);

    expect(await admin.reviewGate.count({ where: { targetId: PROPOSAL_A_HOST } })).toBe(0);
    expect(await proposalState(PROPOSAL_A_HOST)).toBe('GATE_RUNNING');
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
