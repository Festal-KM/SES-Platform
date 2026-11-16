import { isSafeIntakeSkill } from '@ses/domain';
import { createRoleRunner, skillNormalizerSpec, mask, type RoleModelResolver, createAiClient } from '@ses/ai';
import { claimIntakeAiRun, finishIntakeAiRun, systemTenantCtx } from '@ses/db';
import { createAiCostGuard } from '../ai/cost-guard.js';
import { createAiUsageRecorder } from '../ai/usage-recorder.js';
import { InvalidJobPayloadError, requireUuid } from './payload.js';

function parseIntakeInput(input: unknown): { readonly skills: string[] } {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) throw new Error('技術名が不正です');
  const value = input as Record<string, unknown>;
  if (Object.keys(value).some((key) => key !== 'skills') || !Array.isArray(value.skills) || value.skills.length === 0 || value.skills.length > 50
    || value.skills.some((name) => typeof name !== 'string' || name.length === 0 || name.length > 80 || !isSafeIntakeSkill(name))) {
    throw new Error('技術名が不正です');
  }
  return { skills: value.skills as string[] };
}
export function intakeFactsForAi(input: unknown): string {
  const parsed = parseIntakeInput(input);
  if (new Set(parsed.skills).size !== parsed.skills.length) throw new Error('技術名が重複しています');
  return JSON.stringify({ skills: parsed.skills });
}
export function createIntakeParseHandler(deps: {
  readonly aiClient: ReturnType<typeof createAiClient>; readonly models: RoleModelResolver;
  readonly aiDailyCostLimitUsd: string; readonly now: () => Date;
}) {
  return async (raw: unknown, jobId: string): Promise<void> => {
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new InvalidJobPayloadError('intake.parse', 'オブジェクトではありません');
    const payload = raw as Record<string, unknown>;
    if (Object.keys(payload).some((key) => key !== 'tenantId' && key !== 'runId')) throw new InvalidJobPayloadError('intake.parse', '未定義の項目があります');
    const tenantId = requireUuid('intake.parse', 'tenantId', payload.tenantId);
    const runId = requireUuid('intake.parse', 'runId', payload.runId);
    const job = { queue: 'intake.parse', jobId };
    const ctx = systemTenantCtx(tenantId, job);
    const run = await claimIntakeAiRun(ctx, runId, deps.now());
    if (!run) return;
    try {
      const facts = intakeFactsForAi(run.input);
      const original = parseIntakeInput(run.input).skills;
      const masked = mask(facts, { fullNames: [], birthDates: [], emails: [], phones: [], affiliations: [], unitPrices: [], endClientNames: [] });
      const runner = createRoleRunner({ client: deps.aiClient, usage: createAiUsageRecorder(job), costGuard: createAiCostGuard({ job, dailyLimitUsd: deps.aiDailyCostLimitUsd }), models: deps.models });
      const result = await runner.runRole(skillNormalizerSpec, { facts: masked.text }, { tenantId, targetType: 'INTAKE', targetId: runId, now: deps.now });
      if (!result.ok) throw new Error('技術名の整理に失敗しました');
      const allowed = new Set(original);
      if (new Set(result.output.skills).size !== result.output.skills.length || result.output.skills.some((name) => !allowed.has(name))) throw new Error('技術名の応答が不正です');
      await finishIntakeAiRun(ctx, { id: runId, now: deps.now(), output: result.output });
    } catch (error) {
      await finishIntakeAiRun(ctx, { id: runId, now: deps.now() });
      throw error;
    }
  };
}
