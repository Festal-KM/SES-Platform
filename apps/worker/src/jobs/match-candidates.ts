// 候補選出の AI 呼び出し。候補の識別子と公開可否の確認は呼び出し元の責務。
import {
  createRoleRunner, matchExplainerSpec,
  type MaskedText, type RoleModelResolver,
  createAiClient,
  mask,
} from '@ses/ai';
import { claimProjectCandidateAiRun, finishProjectCandidateAiRun, systemTenantCtx, type JobIdentity } from '@ses/db';
import { createAiCostGuard } from '../ai/cost-guard.js';
import { createAiUsageRecorder } from '../ai/usage-recorder.js';
import { InvalidJobPayloadError, requireUuid } from './payload.js';

type AiClient = ReturnType<typeof createAiClient>;

/** キューには候補や会話本文を載せず、テナントと要求の識別子だけを載せる。 */
export function parseCandidateMatchPayload(raw: unknown): { readonly tenantId: string; readonly runId: string } {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new InvalidJobPayloadError('match.candidates', 'オブジェクトではありません');
  }
  const record = raw as Record<string, unknown>;
  if (Object.keys(record).some((key) => key !== 'tenantId' && key !== 'runId')) {
    throw new InvalidJobPayloadError('match.candidates', '未定義の項目があります');
  }
  return {
    tenantId: requireUuid('match.candidates', 'tenantId', record.tenantId),
    runId: requireUuid('match.candidates', 'runId', record.runId),
  };
}

export async function runCandidateMatch(input: {
  readonly tenantId: string;
  readonly projectId: string;
  readonly facts: MaskedText;
  readonly job: JobIdentity;
}, deps: {
  readonly aiClient: AiClient;
  readonly models: RoleModelResolver;
  readonly aiDailyCostLimitUsd: string;
  readonly now: () => Date;
}) {
  const runner = createRoleRunner({
    client: deps.aiClient,
    usage: createAiUsageRecorder(input.job),
    costGuard: createAiCostGuard({ job: input.job, dailyLimitUsd: deps.aiDailyCostLimitUsd }),
    models: deps.models,
  });
  return runner.runRole(matchExplainerSpec, { facts: input.facts }, {
    tenantId: input.tenantId, targetType: 'PROJECT', targetId: input.projectId, now: deps.now,
  });
}

/** 保存された入力から AI に必要なスキルだけを取り出す。参照先や余分な欄は送らない。 */
export function candidateFactsForAi(raw: unknown): string {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new Error('候補情報が不正です');
  const value = raw as Record<string, unknown>;
  const strings = (input: unknown): string[] => {
    if (!Array.isArray(input) || input.length > 1000 || input.some((v) => typeof v !== 'string' || v.length > 200)) throw new Error('スキル情報が不正です');
    return input as string[];
  };
  if (!Array.isArray(value.candidates) || value.candidates.length > 1000) throw new Error('候補数が不正です');
  const candidates = value.candidates.map((entry) => {
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) throw new Error('候補が不正です');
    const item = entry as Record<string, unknown>;
    return { token: requireUuid('match.candidates', 'token', item.token), skills: strings(item.skills) };
  });
  return JSON.stringify({ requirements: strings(value.requirements), requestedSkills: strings(value.requestedSkills), candidates });
}

/** ワーカーが要求を取得・一度だけ実行し、利用量記録後に結果を確定する。 */
export function createCandidateMatchHandler(deps: {
  readonly aiClient: AiClient; readonly models: RoleModelResolver;
  readonly aiDailyCostLimitUsd: string; readonly now: () => Date;
}) {
  return async (raw: unknown, jobId: string): Promise<void> => {
    const payload = parseCandidateMatchPayload(raw);
    const job = { queue: 'match.candidates', jobId };
    const ctx = systemTenantCtx(payload.tenantId, job);
    const run = await claimProjectCandidateAiRun(ctx, payload.runId, deps.now());
    if (!run) return;
    try {
      const facts = candidateFactsForAi(run.input);
      if ((JSON.parse(facts) as { candidates: unknown[] }).candidates.length === 0) {
        await finishProjectCandidateAiRun(ctx, { id: payload.runId, now: deps.now(), output: { rationales: [] } });
        return;
      }
      const masked = mask(facts, { fullNames: [], birthDates: [], emails: [], phones: [], affiliations: [], unitPrices: [], endClientNames: [] });
      const result = await runCandidateMatch({ tenantId: ctx.tenantId, projectId: run.projectId, facts: masked.text, job }, deps);
      if (!result.ok) throw new Error('候補選出に失敗しました');
      await finishProjectCandidateAiRun(ctx, { id: payload.runId, now: deps.now(), output: result.output });
    } catch (error) {
      await finishProjectCandidateAiRun(ctx, { id: payload.runId, now: deps.now() });
      throw error;
    }
  };
}
