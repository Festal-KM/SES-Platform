import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import {
  createProjectCandidateAiRun, failPendingProjectCandidateAiRun, readProjectCandidateAiRun,
  requireHost, type AuthenticatedTenantCtx,
} from '@ses/db';
import { NotFoundError } from '../api/errors';
import { candidateReference } from '../db/bootstrap';
import { requireMatchCandidatesQueue } from '../jobs/match-candidates-queue';
import { listProjectCandidates } from './list';
import { candidateListRows, type CandidateRowView } from './list-rows';
import { projectCandidateListQuerySchema } from './schemas';
import { findRequestedSkills, prepareCandidateFacts } from './ai-input';

const MAX_CANDIDATES = 1000;
const RUN_TTL_MS = 15 * 60 * 1000;
const inputSchema = z.object({
  refs: z.array(z.object({ token: z.uuid(), key: z.string(), kind: z.enum(['OWN', 'ANONYMOUS']) })).max(MAX_CANDIDATES),
});
const resultSchema = z.object({ rationales: z.array(z.object({ token: z.uuid(), reason: z.string().min(1).max(300) })).max(20) });

async function readCandidates(ctx: AuthenticatedTenantCtx, projectId: string, ipAddress: string | null) {
  const deps = { candidateRef: candidateReference(), now: () => new Date(), meta: { ipAddress } };
  const rows: CandidateRowView[] = [];
  let cursor: string | undefined;
  let requiredSkills: string[] = [];
  do {
    const query = projectCandidateListQuerySchema.parse({ limit: 200, cursor });
    const view = await listProjectCandidates(ctx, projectId, { kind: 'CRITERIA', query }, deps);
    if (view.total > MAX_CANDIDATES) throw new Error('候補数が上限を超えています');
    requiredSkills = view.project.requirements.flatMap((requirement) => requirement.skillName ? [requirement.skillName] : []);
    rows.push(...candidateListRows(view.items));
    cursor = view.nextCursor ?? undefined;
  } while (cursor);
  return { rows, requiredSkills };
}

export async function startAiCandidates(ctx: AuthenticatedTenantCtx, projectId: string, message: string, ipAddress: string | null) {
  requireHost(ctx);
  const population = await readCandidates(ctx, projectId, ipAddress);
  const allowed = [...population.requiredSkills, ...population.rows.flatMap((row) => row.kind === 'ANONYMOUS' ? row.allSkills : row.skills)];
  const prepared = prepareCandidateFacts(population.rows, randomUUID);
  const refs = [...prepared.byToken].map(([token, row]) => ({ token, key: row.key, kind: row.kind }));
  const run = await createProjectCandidateAiRun(ctx, {
    projectId, expiresAt: new Date(Date.now() + RUN_TTL_MS), payload: {
      requirements: population.requiredSkills, requestedSkills: [...findRequestedSkills(message, allowed)],
      candidates: prepared.input.candidates.map((candidate) => ({ token: candidate.token, skills: [...candidate.skills] })), refs,
    },
  });
  if (!run) throw new NotFoundError();
  try {
    await requireMatchCandidatesQueue().enqueue({ tenantId: ctx.tenantId, runId: run.id });
  } catch (error) {
    await failPendingProjectCandidateAiRun(ctx, run.id);
    throw error;
  }
  return { runId: run.id };
}

export async function readAiCandidates(ctx: AuthenticatedTenantCtx, projectId: string, runId: string, ipAddress: string | null) {
  requireHost(ctx);
  const run = await readProjectCandidateAiRun(ctx, { id: runId, projectId, now: new Date() });
  if (!run) throw new NotFoundError();
  if (run.status === 'FAILED') return { status: 'FAILED' as const };
  if (run.status !== 'COMPLETED') return { status: 'PENDING' as const };
  const input = inputSchema.parse(run.input);
  const result = resultSchema.parse(run.output);
  const refs = new Map(input.refs.map((item) => [item.token, item]));
  const seen = new Set<string>();
  const population = await readCandidates(ctx, projectId, ipAddress);
  const current = new Map(population.rows.map((row) => [`${row.kind}:${row.key}`, row]));
  const candidates = result.rationales.flatMap(({ token, reason }) => {
    const ref = refs.get(token);
    if (!ref || seen.has(token)) throw new Error('AI の候補応答が不正です');
    seen.add(token);
    const candidate = current.get(`${ref.kind}:${ref.key}`);
    return candidate ? [{ candidate, reason }] : [];
  });
  return { status: 'COMPLETED' as const, candidates };
}
