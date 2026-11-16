import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import {
  createProjectCandidateAiRun, failPendingProjectCandidateAiRun, readProjectCandidateAiRun,
  requireHost, withTenant, type AuthenticatedTenantCtx,
} from '@ses/db';
import { NotFoundError } from '../api/errors';
import { candidateReference } from '../db/bootstrap';
import { requireMatchCandidatesQueue } from '../jobs/match-candidates-queue';
import { listProjectCandidates } from './list';
import { candidateListRows, type CandidateRowView } from './list-rows';
import type { ProjectCandidateListQuery } from './schemas';
import { findRequestedSkills, orderCandidateReasons, prepareCandidateFacts, selectCandidatesForExplanation } from './ai-input';

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
  let initialQuery: ProjectCandidateListQuery | undefined;
  let requiredSkills: string[] = [];
  do {
    const request = initialQuery
      ? { kind: 'CRITERIA' as const, query: { ...initialQuery, cursor } }
      : { kind: 'PROJECT_DEFAULTS' as const, limit: 200 };
    const view = await listProjectCandidates(ctx, projectId, request, deps);
    initialQuery = view.query;
    if (view.total > MAX_CANDIDATES) throw new Error('候補数が上限を超えています');
    requiredSkills = view.project.requirements.flatMap((requirement) => requirement.skillName ? [requirement.skillName] : []);
    rows.push(...candidateListRows(view.items));
    cursor = view.nextCursor ?? undefined;
  } while (cursor);
  return { rows, requiredSkills };
}

/** 自社候補の表示用3件より多いスキルも、辞書名だけを候補比較に使う。 */
async function readOwnSkills(ctx: AuthenticatedTenantCtx, rows: readonly CandidateRowView[]) {
  const ids = rows.flatMap((row) => row.kind === 'OWN' ? [row.id] : []);
  if (ids.length === 0) return new Map<string, readonly string[]>();
  return withTenant(ctx, async (db) => {
    const skills = await db.engineerSkill.findMany({
      where: { engineerId: { in: ids }, ownerPartnerCompanyId: null },
      select: { engineerId: true, skill: { select: { name: true } } },
      orderBy: [{ engineerId: 'asc' }, { skillId: 'asc' }],
    });
    const result = new Map<string, string[]>(ids.map((id) => [id, []]));
    for (const skill of skills) {
      const names = result.get(skill.engineerId) ?? [];
      names.push(skill.skill.name);
      result.set(skill.engineerId, names);
    }
    return result;
  });
}

export async function startAiCandidates(ctx: AuthenticatedTenantCtx, projectId: string, message: string, ipAddress: string | null) {
  requireHost(ctx);
  const population = await readCandidates(ctx, projectId, ipAddress);
  const selected = selectCandidatesForExplanation(population.rows);
  const ownSkills = await readOwnSkills(ctx, selected);
  const allowed = [...population.requiredSkills, ...selected.flatMap((row) => row.kind === 'ANONYMOUS' ? row.allSkills : (ownSkills.get(row.id) ?? row.skills))];
  const prepared = prepareCandidateFacts(selected, randomUUID, ownSkills);
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
  const population = await readCandidates(ctx, projectId, ipAddress);
  const current = new Map(population.rows.map((row) => [`${row.kind}:${row.key}`, row]));
  const candidates = orderCandidateReasons(input.refs.map((ref) => ref.token), result.rationales).flatMap(({ token, reason }) => {
    const ref = refs.get(token);
    if (!ref) throw new Error('AI の候補応答が不正です');
    const candidate = current.get(`${ref.kind}:${ref.key}`);
    return candidate ? [{ candidate, reason }] : [];
  });
  return { status: 'COMPLETED' as const, candidates };
}
