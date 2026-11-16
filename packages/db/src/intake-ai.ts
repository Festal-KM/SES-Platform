import type { Prisma } from '@prisma/client';
import { requireHost, type AuthenticatedTenantCtx, type SystemTenantCtx } from './context.js';
import { withTenant } from './with-tenant.js';

/** 本人の登録途中の AI 要求。原文を保存しない。 */
export async function createIntakeAiRun(ctx: AuthenticatedTenantCtx, input: {
  readonly kind: 'PROJECT' | 'ENGINEER'; readonly payload: Prisma.InputJsonValue; readonly expiresAt: Date;
}) {
  requireHost(ctx);
  return withTenant(ctx, (db) => db.intakeAiRun.create({ data: {
    tenantId: ctx.tenantId, requestedBy: ctx.userId, kind: input.kind,
    status: 'PENDING', input: input.payload, expiresAt: input.expiresAt,
  }, select: { id: true } }));
}
export async function readIntakeAiRun(ctx: AuthenticatedTenantCtx, input: { readonly id: string; readonly now: Date }) {
  requireHost(ctx);
  return withTenant(ctx, (db) => db.intakeAiRun.findFirst({
    where: { id: input.id, requestedBy: ctx.userId, expiresAt: { gt: input.now } },
    select: { status: true, input: true, output: true },
  }));
}
export async function failPendingIntakeAiRun(ctx: AuthenticatedTenantCtx, id: string) {
  requireHost(ctx);
  return withTenant(ctx, (db) => db.intakeAiRun.updateMany({ where: { id, requestedBy: ctx.userId, status: 'PENDING' }, data: { status: 'FAILED' } }));
}
export async function claimIntakeAiRun(ctx: SystemTenantCtx, id: string, now: Date) {
  return withTenant(ctx, async (db) => {
    const claimed = await db.intakeAiRun.updateMany({ where: { id, status: 'PENDING', expiresAt: { gt: now } }, data: { status: 'RUNNING' } });
    if (claimed.count !== 1) return null;
    return db.intakeAiRun.findFirst({ where: { id }, select: { input: true } });
  });
}
export async function finishIntakeAiRun(ctx: SystemTenantCtx, input: { readonly id: string; readonly now: Date; readonly output?: Prisma.InputJsonValue }) {
  return withTenant(ctx, (db) => db.intakeAiRun.updateMany({
    where: { id: input.id, status: 'RUNNING', expiresAt: { gt: input.now } },
    data: input.output === undefined ? { status: 'FAILED' } : { status: 'COMPLETED', output: input.output },
  }));
}
