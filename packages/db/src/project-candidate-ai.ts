import type { Prisma } from '@prisma/client';
import { requireHost, type AuthenticatedTenantCtx, type SystemTenantCtx } from './context.js';
import { withTenant } from './with-tenant.js';

/** 候補選出の要求は認証済みホスト本人が所有する。 */
export async function createProjectCandidateAiRun(ctx: AuthenticatedTenantCtx, input: {
  readonly projectId: string; readonly payload: Prisma.InputJsonValue; readonly expiresAt: Date;
}) {
  requireHost(ctx);
  return withTenant(ctx, async (db) => {
    const project = await db.project.findFirst({ where: { id: input.projectId }, select: { id: true } });
    if (!project) return null;
    return db.projectCandidateAiRun.create({ data: {
      tenantId: ctx.tenantId, projectId: project.id, requestedBy: ctx.userId,
      status: 'PENDING', input: input.payload, expiresAt: input.expiresAt,
    }, select: { id: true } });
  });
}

/** 本人以外と期限切れには結果を返さない。 */
export async function readProjectCandidateAiRun(ctx: AuthenticatedTenantCtx, input: {
  readonly id: string; readonly projectId: string; readonly now: Date;
}) {
  requireHost(ctx);
  return withTenant(ctx, async (db) => {
    const project = await db.project.findFirst({ where: { id: input.projectId }, select: { id: true } });
    if (!project) return null;
    return db.projectCandidateAiRun.findFirst({
      where: { id: input.id, projectId: input.projectId, requestedBy: ctx.userId, expiresAt: { gt: input.now } },
      select: { status: true, input: true, output: true },
    });
  });
}

export async function failPendingProjectCandidateAiRun(ctx: AuthenticatedTenantCtx, id: string) {
  requireHost(ctx);
  return withTenant(ctx, (db) => db.projectCandidateAiRun.updateMany({
    where: { id, requestedBy: ctx.userId, status: 'PENDING' }, data: { status: 'FAILED' },
  }));
}

/** 1 件の要求を 1 ワーカーだけが処理する。 */
export async function claimProjectCandidateAiRun(ctx: SystemTenantCtx, id: string, now: Date) {
  return withTenant(ctx, async (db) => {
    const claimed = await db.projectCandidateAiRun.updateMany({
      where: { id, status: 'PENDING', expiresAt: { gt: now } }, data: { status: 'RUNNING' },
    });
    if (claimed.count !== 1) return null;
    return db.projectCandidateAiRun.findFirst({ where: { id }, select: { projectId: true, input: true } });
  });
}

/** 期限切れや既に確定した要求を後から上書きしない。 */
export async function finishProjectCandidateAiRun(ctx: SystemTenantCtx, input: {
  readonly id: string; readonly now: Date; readonly output?: Prisma.InputJsonValue;
}) {
  return withTenant(ctx, (db) => db.projectCandidateAiRun.updateMany({
    where: { id: input.id, status: 'RUNNING', expiresAt: { gt: input.now } },
    data: input.output === undefined ? { status: 'FAILED' } : { status: 'COMPLETED', output: input.output },
  }));
}
